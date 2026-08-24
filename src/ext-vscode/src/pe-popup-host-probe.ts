/**
 * PE popup-host probe (owner ruling 2026-08-11: Windsurf must behave like the
 * CLI — popup-first, never a pre-insert).
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * P10's `pePoller` was built on the premise that a pending PE "has no popup on
 * Windsurf at all" (`pe-poller.ts:16-23`), so it inserts the pending body into
 * Cascade directly. The live E2E (2026-08-11, screenshots archived) DISPROVED
 * that premise: `stop`'s spawned-terminal PE host opened the popup on this GUI
 * Linux. Result: the body landed in Cascade's input BEFORE the popup — a
 * behaviour neither the CLI nor Cursor has, and a double-insert setup if "Use
 * enhanced" is then chosen.
 *
 * The correct gate is exactly P10's original premise, made explicit: the
 * pePoller may deliver ONLY when the popup host is impossible. When a popup CAN
 * open, the popup is the sole decision surface — CLI-identical on every host.
 *
 * ── FAITHFUL MIRROR, NOT AN INVENTION ────────────────────────────────────────
 * Mirrors `resolvePromptEnhancementCliHostCapabilityV1`
 * (`src/cli/prompt-enhancement-host.ts:163-221`) — the spawned-window half only,
 * because the hook context never has a direct TTY (`stop.ts:574` takes the
 * spawn branch there). Cannot be imported (`G-ROOTDIR`/TS6059), so the terminal
 * list and the gnome-terminal version rule are restated verbatim and pinned by
 * test against drift:
 *   - win32  → always popup-capable (`:167-172` — always spawns a window)
 *   - darwin → always popup-capable (`:173-178` — always Terminal.app)
 *   - linux  → GUI session (DISPLAY/WAYLAND_DISPLAY) AND one supported terminal
 *     (`:193-218`), with gnome-terminal requiring ≥ 3.36 (`:149-155`)
 *
 * ── FAIL DIRECTION ───────────────────────────────────────────────────────────
 * Uncertain ⇒ report NOT capable ⇒ the pePoller stays active ⇒ worst case is
 * today's known pre-insert — never a lost enhancement. (A false "capable" would
 * silence the poller with no popup to take over: the row would sit pending with
 * nothing delivering it.)
 */
import { spawnSync } from 'node:child_process';

/** Verbatim mirror of `PROMPT_ENHANCEMENT_LINUX_TERMINAL_COMMANDS_V1` — pinned by test. */
export const PE_POPUP_LINUX_TERMINALS = [
  'xdg-terminal-exec',
  'gnome-terminal',
  'konsole',
  'xfce4-terminal',
  'kitty',
  'alacritty',
  'wezterm',
  'foot',
  'x-terminal-emulator',
  'xterm',
] as const;

/** Verbatim mirror of `supportsBlockingGnomeTerminal` (`prompt-enhancement-host.ts:149-155`). */
export function supportsBlockingGnomeTerminalMirror(version: string | undefined): boolean {
  const match = version?.match(/(\d+)\.(\d+)/);
  if (!match) return true;
  const major = Number.parseInt(match[1], 10);
  const minor = Number.parseInt(match[2], 10);
  return major > 3 || (major === 3 && minor >= 36);
}

export interface PePopupHostProbeDeps {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  hasCommand?: (cmd: string) => boolean;
  readVersion?: (cmd: string) => string | undefined;
}

function defaultHasCommand(cmd: string): boolean {
  try {
    return spawnSync('which', [cmd], { stdio: 'ignore', timeout: 2000 }).status === 0;
  } catch {
    return false;
  }
}

function defaultReadVersion(cmd: string): string | undefined {
  try {
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf8', timeout: 2000 });
    return typeof r.stdout === 'string' ? r.stdout : undefined;
  } catch {
    return undefined;
  }
}

/**
 * True when `stop`'s PE popup host could open a window on this system — in
 * which case the popup is the sole delivery surface and the pePoller must not
 * pre-insert. Never throws; any error reports NOT capable (see fail direction).
 */
export function isPePopupHostLikelyAvailable(deps: PePopupHostProbeDeps = {}): boolean {
  try {
    const platform = deps.platform ?? process.platform;
    if (platform === 'win32') return true;
    if (platform === 'darwin') return true;
    if (platform !== 'linux') return false;

    const env = deps.env ?? process.env;
    if (!env.DISPLAY && !env.WAYLAND_DISPLAY) return false;

    const has = deps.hasCommand ?? defaultHasCommand;
    const readVersion = deps.readVersion ?? defaultReadVersion;
    for (const cmd of PE_POPUP_LINUX_TERMINALS) {
      let available = false;
      try { available = has(cmd); } catch { continue; }
      if (!available) continue;
      if (cmd === 'gnome-terminal') {
        let version: string | undefined;
        try { version = readVersion(cmd); } catch { version = undefined; }
        if (!supportsBlockingGnomeTerminalMirror(version)) continue;
      }
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
