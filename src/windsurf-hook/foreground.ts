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
 * Titles to raise. Only one popup is open per turn (`nexpath stop` shows the
 * feedback popup OR the advisory popup, never both), so each tick tries both and
 * raises whichever window exists.
 */
const POPUP_TITLES: readonly string[] = [ADVISORY_POPUP_TITLE, FEEDBACK_POPUP_TITLE];

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

/** Try once to raise the window with `title`. Returns true when activation reports success. */
function defaultActivate(tool: 'wmctrl' | 'xdotool', title: string): boolean {
  try {
    if (tool === 'wmctrl') {
      return spawnSync('wmctrl', ['-a', title], { stdio: 'ignore', timeout: 2000 }).status === 0;
    }
    const found = spawnSync('xdotool', ['search', '--name', title], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000,
    });
    const id = (found.stdout ?? '').trim().split('\n').filter(Boolean)[0];
    if (!id) return false;
    return spawnSync('xdotool', ['windowactivate', id], { stdio: 'ignore', timeout: 2000 }).status === 0;
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
