/**
 * Bring the Layer-C popup window (advisory OR feedback) to the foreground — Linux only.
 *
 * `nexpath stop` opens either the advisory decision-session popup or the
 * feedback popup (never both in one turn) as a SEPARATE OS window
 * (Layer C, untouched). macOS and Windows already foreground it at launch:
 *   - macOS:   `osascript … tell application "Terminal" activate`
 *   - Windows: `cmd /c start …`  (ShellExecuteEx → SW_SHOWNORMAL)
 * Linux's `gnome-terminal` (and the other emulators) have NO equivalent "raise"
 * flag, so under GNOME's focus-stealing prevention the window opens BEHIND the
 * focused editor (Cursor) — testers "hardly see" or miss the popup. There is no
 * flag-only fix for a separate window; the standard mechanism is a WM activation
 * call. This module supplies that, extension-side (Layer B) — no Layer C change.
 *
 * It polls because the window appears ~1s after `nexpath stop` is spawned, and
 * is a graceful no-op when: not Linux, no display, or neither wmctrl nor xdotool
 * is installed (falls back to the prior behaviour — nothing breaks).
 */
import { spawnSync } from 'node:child_process';

/** Advisory popup title — must match Layer C's TtySelectFn `WINDOW_TITLE`. */
export const POPUP_WINDOW_TITLE = 'Nexpath — Action Required';
/** Feedback popup title — must match Layer C's feedback-tty `WINDOW_TITLE`. */
export const FEEDBACK_WINDOW_TITLE = 'Nexpath — Feedback';
/**
 * Prompt-enhancement popup title.
 *
 * Must match `PROMPT_ENHANCEMENT_POPUP_WINDOW_TITLE_V1` in
 * `src/cli/prompt-enhancement-host.ts`, which passes it as `--title` to each
 * terminal emulator it launches. That constant is not exported and lives in a
 * separate package, so the literal is duplicated here — the same deliberate
 * duplication the two titles above already use.
 *
 * Note the separator: this one is a middle dot (`·`), NOT the em dash (`—`)
 * used by the advisory and feedback titles. wmctrl/xdotool match on the literal
 * text, so the wrong character silently fails to raise anything.
 */
export const PROMPT_ENHANCEMENT_WINDOW_TITLE = 'Nexpath · Prompt enhancement';

/**
 * Titles bringPopupToFront tries to raise. Only one popup is open at a time
 * (`nexpath stop` shows the feedback popup, the advisory popup, or the
 * prompt-enhancement popup — never two), so each poll tick tries each and
 * raises whichever window exists.
 *
 * The prompt-enhancement popup only opens a window on the spawn-terminal path;
 * on the in-process `/dev/tty` path it renders in the existing terminal and
 * there is nothing to raise. A title that matches no window is a no-op, so
 * listing it is safe on both paths.
 */
const POPUP_TITLES: readonly string[] = [
  POPUP_WINDOW_TITLE,
  FEEDBACK_WINDOW_TITLE,
  PROMPT_ENHANCEMENT_WINDOW_TITLE,
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
 * ⚠ RC10 (2026-08-13, mirrored from `windsurf-hook/foreground.ts` — the two
 * raisers are intentionally duplicated across packages): activating the popup
 * stole keyboard focus mid-typing, so the user's in-flight keystrokes landed
 * in the popup and silently selected/dismissed it — measured on the popup's
 * TTY as `Down Up Space Down Enter` with no synthetic key tool running.
 * Raise ABOVE (`add,above` / `windowraise`); never focus. The user interacts
 * with the popup only when they deliberately click into it.
 */
function defaultActivate(tool: 'wmctrl' | 'xdotool', title: string): boolean {
  try {
    if (tool === 'wmctrl') {
      // `-r <title> -b add,above` marks it always-on-top without focusing it.
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
  if (!tool) return; // graceful no-op — prior behaviour, nothing breaks

  const _setInterval = deps.setInterval ?? setInterval;
  const _clearInterval = deps.clearInterval ?? clearInterval;
  const intervalMs = deps.intervalMs ?? 500;
  const maxTries = deps.maxTries ?? 12; // ~6s

  let tries = 0;
  // `let` + undefined-guard so the tick never references the handle before it's
  // assigned (robust even if a timer impl fired the callback synchronously).
  let timer: ReturnType<typeof _setInterval> | undefined;
  const stop = (): void => { if (timer !== undefined) _clearInterval(timer); };
  timer = _setInterval(() => {
    tries += 1;
    // Raise whichever popup is open — advisory or feedback. `.some` short-circuits
    // so at most one activation runs once a window is found.
    const ok = POPUP_TITLES.some((title) => activate(tool, title));
    if (ok || tries >= maxTries) stop();
  }, intervalMs);
  // Don't keep the extension host event loop alive for this.
  if (typeof (timer as { unref?: () => void }).unref === 'function') {
    (timer as { unref: () => void }).unref();
  }
}
