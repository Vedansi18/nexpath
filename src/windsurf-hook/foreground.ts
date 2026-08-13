/**
 * Bring the Layer-C popup window (advisory OR feedback) to the foreground —
 * Linux only, for the Windsurf Cascade-hook path.
 *
 * On Windsurf, `nexpath stop` is spawned by the Cascade hook (this CLI's
 * `windsurf-hook` command), NOT by the VS Code extension — so the extension's
 * `ext-vscode/src/popup-foreground.ts` never runs. Under GNOME focus-stealing
 * prevention the popup window opens BEHIND Windsurf, so we raise it here with the
 * same wmctrl/xdotool mechanism. Graceful no-op on non-Linux / no display / no
 * tool installed.
 *
 * This mirrors `ext-vscode/src/popup-foreground.ts` (the Cursor path); the two
 * live in separate packages so the logic (and the window titles) are
 * intentionally duplicated. Keep the titles below in sync with Layer C's
 * TtySelectFn `WINDOW_TITLE` and feedback-tty `WINDOW_TITLE`.
 */
import { spawnSync } from 'node:child_process';

// Must match Layer C's popup window titles (TtySelectFn / feedback-tty).
const ADVISORY_POPUP_TITLE = 'Nexpath — Action Required';
const FEEDBACK_POPUP_TITLE = 'Nexpath — Feedback';
/**
 * Must match `PROMPT_ENHANCEMENT_POPUP_WINDOW_TITLE_V1` in
 * `src/cli/prompt-enhancement-host.ts`, which passes it as `--title` to the
 * terminal emulator it launches. Note the separator is a middle dot (`·`), not
 * the em dash (`—`) of the two titles above — wmctrl/xdotool match the literal
 * text, so the wrong character silently raises nothing.
 */
const PROMPT_ENHANCEMENT_POPUP_TITLE = 'Nexpath · Prompt enhancement';

/**
 * Titles to raise. Only one popup is open per turn (`nexpath stop` shows the
 * feedback popup, the advisory popup, or the prompt-enhancement popup — never
 * two), so each tick tries each and raises whichever window exists.
 *
 * The prompt-enhancement popup only opens a window on the spawn-terminal path;
 * on the in-process `/dev/tty` path there is nothing to raise, and a title that
 * matches no window is a no-op.
 */
const POPUP_TITLES: readonly string[] = [
  ADVISORY_POPUP_TITLE,
  FEEDBACK_POPUP_TITLE,
  PROMPT_ENHANCEMENT_POPUP_TITLE,
];

export interface ForegroundDeps {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  /** Injected runner for tests; returns true if the command "succeeded". */
  hasCommand?: (cmd: string) => boolean;
  activate?: (tool: 'wmctrl' | 'xdotool', title: string) => boolean;
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
  /** Poll cadence / cap (defaults: every 500ms, up to ~6s). */
  intervalMs?: number;
  maxTries?: number;
}

function defaultHasCommand(cmd: string): boolean {
  try {
    return spawnSync('which', [cmd], { stdio: 'ignore', timeout: 2000 }).status === 0;
  } catch {
    return false;
  }
}

/**
 * Try once to raise the window with `title` — WITHOUT taking keyboard focus.
 *
 * ⚠ RC10 (live root cause, captured byte-by-byte 2026-08-13): the original
 * implementation ACTIVATED the popup (`wmctrl -a` / `xdotool windowactivate`),
 * which steals keyboard focus the moment the window appears. The user is
 * usually mid-typing at that exact moment — the popup opens at SUBMIT time —
 * so their in-flight keystrokes (Space/Enter/arrows are the most common keys)
 * landed IN THE POPUP, silently navigating and "selecting" it within seconds.
 * Measured on the popup's own TTY: `Down Up Space Down Enter` arriving with no
 * synthetic key tool running — the user's own fingers. To the user it looks
 * like "the popup flashed open and closed itself and my prompt got replaced".
 *
 * So: raise ABOVE (visible), never FOCUS. `wmctrl -r <title> -b add,above`
 * marks it always-on-top; `xdotool windowraise` raises the stacking order.
 * Neither moves keyboard focus, so typing keeps flowing to the editor and the
 * popup is interacted with only when the user deliberately clicks into it.
 */
function defaultActivate(tool: 'wmctrl' | 'xdotool', title: string): boolean {
  try {
    if (tool === 'wmctrl') {
      return spawnSync('wmctrl', ['-r', title, '-b', 'add,above'], { stdio: 'ignore', timeout: 2000 }).status === 0;
    }
    const found = spawnSync('xdotool', ['search', '--name', title], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000,
    });
    const id = (found.stdout ?? '').trim().split('\n').filter(Boolean)[0];
    if (!id) return false;
    return spawnSync('xdotool', ['windowraise', id], { stdio: 'ignore', timeout: 2000 }).status === 0;
  } catch {
    return false;
  }
}

/**
 * Fire-and-forget: repeatedly try to bring the popup window to the front until it
 * succeeds or the attempt budget runs out. Safe to call right after spawning
 * `nexpath stop`; never throws.
 */
export function bringPopupToFront(deps: ForegroundDeps = {}): void {
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  // macOS/Windows already foreground their popup; only Linux needs help.
  if (platform !== 'linux') return;
  if (!env.DISPLAY && !env.WAYLAND_DISPLAY) return;

  const hasCommand = deps.hasCommand ?? defaultHasCommand;
  const activate = deps.activate ?? defaultActivate;
  const tool: 'wmctrl' | 'xdotool' | null =
    hasCommand('wmctrl') ? 'wmctrl' : hasCommand('xdotool') ? 'xdotool' : null;
  if (!tool) return; // graceful no-op — nothing breaks

  const _setInterval = deps.setInterval ?? setInterval;
  const _clearInterval = deps.clearInterval ?? clearInterval;
  const intervalMs = deps.intervalMs ?? 500;
  const maxTries = deps.maxTries ?? 12; // ~6s

  let tries = 0;
  let timer: ReturnType<typeof _setInterval> | undefined;
  const stop = (): void => { if (timer !== undefined) _clearInterval(timer); };
  timer = _setInterval(() => {
    tries += 1;
    // Raise whichever popup is open — advisory or feedback. `.some` short-circuits.
    const ok = POPUP_TITLES.some((title) => activate(tool, title));
    if (ok || tries >= maxTries) stop();
  }, intervalMs);
  // Don't keep the (short-lived) windsurf-hook process alive for this.
  if (typeof (timer as { unref?: () => void }).unref === 'function') {
    (timer as { unref: () => void }).unref();
  }
}
