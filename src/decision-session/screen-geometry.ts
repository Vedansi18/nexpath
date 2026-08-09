// Per-OS screen detection + popup geometry computation for the
// decision-session popup window.
//
// Detection chain (in order of precedence):
//   1. NEXPATH_SCREEN_WIDTH + NEXPATH_SCREEN_HEIGHT env vars
//      (universal override — useful for headless / unusual setups).
//   2. OS-specific primary detection:
//        Windows  → PowerShell + System.Windows.Forms.Screen
//        macOS    → osascript + Finder window-of-desktop bounds
//        Linux    → xdpyinfo / xrandr / wlr-randr
//   3. OS-specific fallback detection (where applicable):
//        Windows  → wmic desktopmonitor
//   4. null — caller passes no geometry and the popup opens at the
//      terminal-emulator's default size.
//
// Detection failures NEVER throw — every shell-out is wrapped in a
// try/catch that resolves to null so the popup-open path stays
// fault-tolerant.

import { spawnSync } from 'node:child_process';

// ── Public types ────────────────────────────────────────────────────────────

/** Detected screen pixel dimensions. Both > 0 when present. */
export interface ScreenSize {
  widthPx:  number;
  heightPx: number;
}

/**
 * Computed popup window geometry. Includes both pixel dimensions (for
 * emulators that accept pixels — kitty, foot, macOS Terminal, Windows
 * Terminal via wt --pos) AND cell dimensions (for emulators that
 * accept only cells — xterm, gnome-terminal, alacritty, xfce4-terminal,
 * Windows mode CON fallback).
 */
export interface PopupGeometry {
  /** Popup width in pixels (= ROUND(screen.widthPx × POPUP_SIZE_RATIO)). */
  widthPx:  number;
  /** Popup height in pixels (= ROUND(screen.heightPx × POPUP_SIZE_RATIO)). */
  heightPx: number;
  /** Centered X origin in pixels. */
  xPx:      number;
  /** Centered Y origin in pixels. */
  yPx:      number;
  /** Cell-width equivalent of widthPx using the active cell-width default. */
  cols:     number;
  /** Cell-height equivalent of heightPx using the active cell-height default. */
  rows:     number;
}

// ── Constants ───────────────────────────────────────────────────────────────

/** Default cell width in pixels for a conservative monospace font. */
export const DEFAULT_CELL_WIDTH_PX  = 10;

/** Default cell height in pixels for a conservative monospace font. */
export const DEFAULT_CELL_HEIGHT_PX = 20;

/** Fraction of each screen axis the popup should occupy. */
export const POPUP_SIZE_RATIO = 0.7;

/** Hardcoded last-resort screen size for cases where every detection path fails but a popup is still attempted. */
export const FALLBACK_SCREEN_SIZE: ScreenSize = { widthPx: 1920, heightPx: 1080 };

// ── Right-dock popup geometry (owner request 2026-08-08) ─────────────────────
// A right-side docked panel: ~60% width × 100% working-area height, flush to the
// right edge. Separate from the centred `computePopupGeometry` above so existing
// (centred) callers are unaffected; this is opt-in geometry for the docked mode.

/** Default fraction of the WORKING-AREA width the docked popup occupies. */
export const DEFAULT_POPUP_WIDTH_RATIO = 0.60;

/** Minimum popup width in character cells — the docked panel never narrows below this. */
export const POPUP_MIN_COLS = 80;

/** Maximum popup width in pixels — an ultrawide guard so 60% of a very wide screen stays readable. */
export const POPUP_MAX_WIDTH_PX = 1600;

/** Which screen edge the docked popup is flush to. */
export type PopupDockSide = 'right' | 'left' | 'center';

/** Default dock side (owner request: right). */
export const DEFAULT_POPUP_DOCK_SIDE: PopupDockSide = 'right';

/**
 * A rectangular region the popup docks within — the screen's WORKING AREA
 * (screen minus taskbar / menu bar / panels). `x`/`y` are the region's origin
 * in screen pixels (usually 0,0, but non-zero when the taskbar is on the left/top).
 */
export interface WorkArea {
  x:        number;
  y:        number;
  widthPx:  number;
  heightPx: number;
}

// ── Env-var keys ────────────────────────────────────────────────────────────

/** Screen width override (pixels). Bypasses OS detection when both width + height are set. */
export const ENV_SCREEN_WIDTH  = 'NEXPATH_SCREEN_WIDTH';

/** Screen height override (pixels). Bypasses OS detection when both width + height are set. */
export const ENV_SCREEN_HEIGHT = 'NEXPATH_SCREEN_HEIGHT';

/** Cell-width override (pixels) for cells-only emulators. */
export const ENV_CELL_WIDTH    = 'NEXPATH_CELL_WIDTH_PX';

/** Cell-height override (pixels) for cells-only emulators. */
export const ENV_CELL_HEIGHT   = 'NEXPATH_CELL_HEIGHT_PX';

/** Docked-popup width-ratio override (0 < r ≤ 1). Bypasses DEFAULT_POPUP_WIDTH_RATIO when valid. */
export const ENV_POPUP_WIDTH_RATIO = 'NEXPATH_POPUP_WIDTH_RATIO';

/** Docked-popup dock-side override (`right` | `left` | `center`). Also the opt-in signal on Linux. */
export const ENV_POPUP_DOCK = 'NEXPATH_POPUP_DOCK';

// ── Helpers ─────────────────────────────────────────────────────────────────

function parsePositiveInt(s: string | undefined): number | null {
  if (s === undefined || s === '') return null;
  const n = parseInt(s, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function getCellWidth(): number {
  return parsePositiveInt(process.env[ENV_CELL_WIDTH]) ?? DEFAULT_CELL_WIDTH_PX;
}

function getCellHeight(): number {
  return parsePositiveInt(process.env[ENV_CELL_HEIGHT]) ?? DEFAULT_CELL_HEIGHT_PX;
}

/**
 * Effective docked-popup width ratio: the NEXPATH_POPUP_WIDTH_RATIO override when it parses to a
 * value in (0, 1]; otherwise DEFAULT_POPUP_WIDTH_RATIO. Exported for unit testability.
 */
export function getPopupWidthRatio(): number {
  const raw = process.env[ENV_POPUP_WIDTH_RATIO];
  if (raw !== undefined && raw !== '') {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0 && n <= 1) return n;
  }
  return DEFAULT_POPUP_WIDTH_RATIO;
}

/**
 * Effective dock side: the NEXPATH_POPUP_DOCK override when it is `right`|`left`|`center`
 * (case-insensitive); otherwise DEFAULT_POPUP_DOCK_SIDE. Exported for unit testability.
 */
export function getPopupDockSide(): PopupDockSide {
  const raw = process.env[ENV_POPUP_DOCK]?.trim().toLowerCase();
  if (raw === 'right' || raw === 'left' || raw === 'center') return raw;
  return DEFAULT_POPUP_DOCK_SIDE;
}

/**
 * Parse a `WIDTHxHEIGHT` pattern from arbitrary text (xdpyinfo, xrandr,
 * wlr-randr output). Returns null when no match or either value is <= 0.
 *
 * Matches the first `<int>x<int>` occurrence — caller must pass text that
 * already isolates the line of interest if multiple resolutions appear.
 *
 * Exported for unit testability.
 */
export function parseDimensionsPattern(text: string): ScreenSize | null {
  const m = text.match(/(\d+)\s*x\s*(\d+)/);
  if (!m) return null;
  const widthPx  = parseInt(m[1], 10);
  const heightPx = parseInt(m[2], 10);
  if (!Number.isFinite(widthPx)  || widthPx  <= 0) return null;
  if (!Number.isFinite(heightPx) || heightPx <= 0) return null;
  return { widthPx, heightPx };
}

/**
 * Parse PowerShell `Write-Output $b.Width; Write-Output $b.Height` two-
 * line output into a ScreenSize. Returns null on malformed / empty input.
 *
 * Exported for unit testability.
 */
export function parsePowerShellOutput(stdout: string): ScreenSize | null {
  const lines = stdout.trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const widthPx  = parsePositiveInt(lines[0]);
  const heightPx = parsePositiveInt(lines[1]);
  if (widthPx === null || heightPx === null) return null;
  return { widthPx, heightPx };
}

/**
 * Parse `wmic desktopmonitor get screenwidth,screenheight /format:list`
 * output into a ScreenSize. Looks for `ScreenWidth=N` and
 * `ScreenHeight=N` lines anywhere in the input.
 *
 * Exported for unit testability.
 */
export function parseWmicOutput(stdout: string): ScreenSize | null {
  const wm = stdout.match(/ScreenWidth=(\d+)/);
  const hm = stdout.match(/ScreenHeight=(\d+)/);
  if (!wm || !hm) return null;
  const widthPx  = parsePositiveInt(wm[1]);
  const heightPx = parsePositiveInt(hm[1]);
  if (widthPx === null || heightPx === null) return null;
  return { widthPx, heightPx };
}

/**
 * Parse `osascript` AppleScript output of the form "W,H" into a
 * ScreenSize. Returns null on malformed input.
 *
 * Exported for unit testability.
 */
export function parseMacOsascriptOutput(stdout: string): ScreenSize | null {
  const parts = stdout.trim().split(',');
  if (parts.length < 2) return null;
  const widthPx  = parsePositiveInt(parts[0]);
  const heightPx = parsePositiveInt(parts[1]);
  if (widthPx === null || heightPx === null) return null;
  return { widthPx, heightPx };
}

/**
 * Parse `system_profiler SPDisplaysDataType` output into a ScreenSize. Prefers the
 * "UI Looks like: W x H" line (the effective POINTS resolution — what macOS Terminal window bounds
 * use), falling back to the first "Resolution: W x H". Returns null when neither is present. Used as
 * the no-Automation-permission fallback for macOS screen detection. Exported for unit testability.
 */
export function parseMacSystemProfilerOutput(stdout: string): ScreenSize | null {
  const ui = stdout.match(/UI Looks like:\s*(\d+)\s*x\s*(\d+)/i);
  const res = stdout.match(/Resolution:\s*(\d+)\s*x\s*(\d+)/i);
  const m = ui ?? res;
  if (!m) return null;
  const widthPx  = parsePositiveInt(m[1]);
  const heightPx = parsePositiveInt(m[2]);
  if (widthPx === null || heightPx === null) return null;
  return { widthPx, heightPx };
}

/**
 * Parse `xdpyinfo` output (looks for the "dimensions: WxH pixels" line).
 * Returns null when the line is not present.
 *
 * Exported for unit testability.
 */
export function parseXdpyinfoOutput(stdout: string): ScreenSize | null {
  const m = stdout.match(/dimensions:\s+(\d+)x(\d+)\s+pixels/);
  if (!m) return null;
  const widthPx  = parsePositiveInt(m[1]);
  const heightPx = parsePositiveInt(m[2]);
  if (widthPx === null || heightPx === null) return null;
  return { widthPx, heightPx };
}

/**
 * Parse `xrandr` output (looks for the FIRST `connected primary WxH+X+Y`
 * line, falling back to `connected WxH+X+Y` when no primary marker is
 * present). Returns null when no connected output is found.
 *
 * Exported for unit testability.
 */
export function parseXrandrOutput(stdout: string): ScreenSize | null {
  const m = stdout.match(/connected\s+(?:primary\s+)?(\d+)x(\d+)\+/);
  if (!m) return null;
  const widthPx  = parsePositiveInt(m[1]);
  const heightPx = parsePositiveInt(m[2]);
  if (widthPx === null || heightPx === null) return null;
  return { widthPx, heightPx };
}

/**
 * Read the universal env-var screen-size override. Returns the parsed
 * `ScreenSize` when BOTH NEXPATH_SCREEN_WIDTH and NEXPATH_SCREEN_HEIGHT
 * are present and positive integers; otherwise null.
 *
 * Exported for unit testability.
 */
export function getEnvScreenOverride(): ScreenSize | null {
  const widthPx  = parsePositiveInt(process.env[ENV_SCREEN_WIDTH]);
  const heightPx = parsePositiveInt(process.env[ENV_SCREEN_HEIGHT]);
  if (widthPx === null || heightPx === null) return null;
  return { widthPx, heightPx };
}

// ── Per-OS detection ────────────────────────────────────────────────────────

function detectScreenWindows(): ScreenSize | null {
  // Primary path: PowerShell + System.Windows.Forms.Screen.
  try {
    const r = spawnSync('powershell', [
      '-NoProfile', '-NonInteractive', '-Command',
      'Add-Type -AssemblyName System.Windows.Forms; ' +
      '$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; ' +
      'Write-Output $b.Width; Write-Output $b.Height',
    ], { encoding: 'utf8', timeout: 5000 });
    if (r.status === 0 && r.stdout) {
      const parsed = parsePowerShellOutput(r.stdout);
      if (parsed) return parsed;
    }
  } catch { /* fall through */ }

  // Fallback: wmic desktopmonitor (deprecated post Win11 24H2 but still common).
  try {
    const r = spawnSync('wmic', [
      'desktopmonitor', 'get', 'screenwidth,screenheight', '/format:list',
    ], { encoding: 'utf8', timeout: 5000 });
    if (r.status === 0 && r.stdout) {
      const parsed = parseWmicOutput(r.stdout);
      if (parsed) return parsed;
    }
  } catch { /* fall through */ }

  return null;
}

/**
 * Parse the JXA visible-frame output "x,y,width,height" (already converted to Terminal's TOP-LEFT
 * point coordinates) into a WorkArea. x/y may legitimately be 0 (or y = menu-bar height). Returns
 * null on malformed input. Exported for unit testability.
 */
export function parseMacVisibleFrameOutput(stdout: string): WorkArea | null {
  const parts = stdout.trim().split(',').map((p) => p.trim());
  if (parts.length < 4) return null;
  const x = parseInt(parts[0], 10);
  const y = parseInt(parts[1], 10);
  const widthPx  = parsePositiveInt(parts[2]);
  const heightPx = parsePositiveInt(parts[3]);
  if (!Number.isFinite(x) || x < 0) return null;
  if (!Number.isFinite(y) || y < 0) return null;
  if (widthPx === null || heightPx === null) return null;
  return { x, y, widthPx, heightPx };
}

/**
 * Detect the macOS main-screen VISIBLE FRAME (usable area excluding the menu bar + Dock) as a
 * dockable WorkArea, in Terminal's TOP-LEFT point coordinates. Uses AppKit's
 * `NSScreen.mainScreen.visibleFrame` via JXA — this reads the CALLING process's own screen info, so
 * it needs NO Automation permission (unlike Finder scripting). NSScreen uses a bottom-left origin, so
 * the JXA converts the visible frame's top to top-left coords: `top = frame.h - (visible.y +
 * visible.h)` (= the menu-bar gap). Returns null on any failure (caller falls back to full screen).
 */
export function detectMacVisibleFrame(): WorkArea | null {
  try {
    const jxa = [
      'ObjC.import("AppKit");',
      'var s = $.NSScreen.mainScreen;',
      'var f = s.frame; var v = s.visibleFrame;',
      'var topY = f.size.height - (v.origin.y + v.size.height);',
      '[Math.round(v.origin.x), Math.round(topY), Math.round(v.size.width), Math.round(v.size.height)].join(",")',
    ].join(' ');
    const r = spawnSync('osascript', ['-l', 'JavaScript', '-e', jxa], { encoding: 'utf8', timeout: 5000 });
    if (r.status === 0 && r.stdout) {
      const parsed = parseMacVisibleFrameOutput(r.stdout);
      if (parsed) return parsed;
    }
  } catch { /* fall through */ }
  return null;
}

function detectScreenMac(): ScreenSize | null {
  // Primary: Finder desktop bounds (points). Works only when the hook has macOS Automation
  // permission for Finder — a Claude-spawned Stop hook usually does NOT, so this often fails.
  try {
    const script =
      'tell application "Finder" to set b to bounds of window of desktop\n' +
      'return ((item 3 of b) as string) & "," & ((item 4 of b) as string)';
    const r = spawnSync('osascript', ['-e', script], { encoding: 'utf8', timeout: 5000 });
    if (r.status === 0 && r.stdout) {
      const parsed = parseMacOsascriptOutput(r.stdout);
      if (parsed) return parsed;
    }
  } catch { /* fall through */ }

  // Fallback (mac fix 2026-08-08): `system_profiler` reads the display WITHOUT any Automation
  // permission, so the popup can still be sized/positioned when Finder scripting is blocked. Prefer
  // the "UI Looks like: W x H" line (effective POINTS — what Terminal bounds use); fall back to
  // "Resolution: W x H".
  try {
    const r = spawnSync('system_profiler', ['SPDisplaysDataType'], { encoding: 'utf8', timeout: 8000 });
    if (r.status === 0 && r.stdout) {
      const parsed = parseMacSystemProfilerOutput(r.stdout);
      if (parsed) return parsed;
    }
  } catch { /* fall through */ }

  return null;
}

function detectScreenLinux(): ScreenSize | null {
  // No display server → no detection possible.
  if (!process.env['DISPLAY'] && !process.env['WAYLAND_DISPLAY']) return null;

  // xdpyinfo (X11 / XWayland).
  try {
    const r = spawnSync('xdpyinfo', [], { encoding: 'utf8', timeout: 5000 });
    if (r.status === 0 && r.stdout) {
      const parsed = parseXdpyinfoOutput(r.stdout);
      if (parsed) return parsed;
    }
  } catch { /* fall through */ }

  // xrandr (X11 / XWayland).
  try {
    const r = spawnSync('xrandr', [], { encoding: 'utf8', timeout: 5000 });
    if (r.status === 0 && r.stdout) {
      const parsed = parseXrandrOutput(r.stdout);
      if (parsed) return parsed;
    }
  } catch { /* fall through */ }

  // wlr-randr (Wayland on wlroots-based compositors: Sway, Hyprland, etc.).
  try {
    const r = spawnSync('wlr-randr', [], { encoding: 'utf8', timeout: 5000 });
    if (r.status === 0 && r.stdout) {
      const parsed = parseDimensionsPattern(r.stdout);
      if (parsed) return parsed;
    }
  } catch { /* fall through */ }

  return null;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Detect the primary screen's pixel resolution. Returns null when every
 * detection path fails so the caller can fall back to the terminal-
 * emulator's default popup size.
 *
 * Async signature gives room for future native-API backends; the current
 * implementation resolves synchronously via spawnSync wrapped in
 * Promise.resolve.
 */
export async function detectScreenResolution(): Promise<ScreenSize | null> {
  const env = getEnvScreenOverride();
  if (env) return env;

  switch (process.platform) {
    case 'win32':  return detectScreenWindows();
    case 'darwin': return detectScreenMac();
    case 'linux':  return detectScreenLinux();
    default:       return null;
  }
}

/**
 * Pure: compute a 70% × 70% popup geometry centered on the given screen.
 * Returns both pixel and cell dimensions so each spawn path can pick
 * whichever its emulator accepts. Cell math uses
 * NEXPATH_CELL_WIDTH_PX / NEXPATH_CELL_HEIGHT_PX env-var overrides
 * when set; otherwise the conservative defaults.
 *
 * Edge cases:
 *   - `cols` and `rows` are clamped to a minimum of 1 so divide-by-zero
 *     or zero-cell-size inputs cannot produce a 0-cell popup.
 *   - `xPx` and `yPx` use Math.round; a 1-pixel asymmetry is acceptable
 *     visual centering.
 */
export function computePopupGeometry(screen: ScreenSize): PopupGeometry {
  const widthPx  = Math.round(screen.widthPx  * POPUP_SIZE_RATIO);
  const heightPx = Math.round(screen.heightPx * POPUP_SIZE_RATIO);
  const xPx      = Math.round((screen.widthPx  - widthPx)  / 2);
  const yPx      = Math.round((screen.heightPx - heightPx) / 2);

  const cellW = getCellWidth();
  const cellH = getCellHeight();
  const cols  = Math.max(1, Math.floor(widthPx  / cellW));
  const rows  = Math.max(1, Math.floor(heightPx / cellH));

  return { widthPx, heightPx, xPx, yPx, cols, rows };
}

/**
 * Pure: compute a right-docked popup geometry within a working area — ~60% width × 100% height,
 * flush to the chosen edge (default right). Returns px + cell dims, same shape as
 * `computePopupGeometry`, so every spawn path can pick whichever its emulator accepts.
 *
 * Width is clamped: never wider than `maxWidthPx` (ultrawide guard), never narrower than
 * `minCols` cells, and never wider than the work area itself. Height is 100% of the work area.
 * `ratio` and `dock` default to the env-overridable effective values.
 *
 * Edge cases:
 *   - a work area narrower than `minCols` cells → width is the full work-area width (cannot exceed it).
 *   - `cols`/`rows` are floored and clamped to ≥ 1 so a zero-cell popup is impossible.
 */
export function computeDockedPopupGeometry(
  work: WorkArea,
  opts: {
    ratio?:     number;
    dock?:      PopupDockSide;
    minCols?:   number;
    maxWidthPx?: number;
  } = {},
): PopupGeometry {
  const ratio      = opts.ratio      ?? getPopupWidthRatio();
  const dock       = opts.dock       ?? getPopupDockSide();
  const minCols    = opts.minCols    ?? POPUP_MIN_COLS;
  const maxWidthPx = opts.maxWidthPx ?? POPUP_MAX_WIDTH_PX;

  const cellW = getCellWidth();
  const cellH = getCellHeight();

  const minWidthPx = minCols * cellW;
  let widthPx = Math.round(work.widthPx * ratio);
  widthPx = Math.min(widthPx, maxWidthPx);   // ultrawide guard
  widthPx = Math.max(widthPx, minWidthPx);   // readability floor
  widthPx = Math.min(widthPx, work.widthPx); // never exceed the work area
  const heightPx = work.heightPx;            // 100% of the working-area height

  const xPx = dock === 'right'
    ? work.x + work.widthPx - widthPx
    : dock === 'left'
      ? work.x
      : work.x + Math.round((work.widthPx - widthPx) / 2);
  const yPx = work.y;

  const cols = Math.max(1, Math.floor(widthPx  / cellW));
  const rows = Math.max(1, Math.floor(heightPx / cellH));

  return { widthPx, heightPx, xPx, yPx, cols, rows };
}

/**
 * Parse PowerShell `PrimaryScreen.WorkingArea` output — four lines: X, Y, Width, Height — into a
 * WorkArea. Returns null on malformed / short input (X and Y may legitimately be 0). Exported for
 * unit testability.
 */
export function parseWorkAreaPowerShellOutput(stdout: string): WorkArea | null {
  const lines = stdout.trim().split(/\r?\n/).map((l) => l.trim());
  if (lines.length < 4) return null;
  const x = parseInt(lines[0], 10);
  const y = parseInt(lines[1], 10);
  const widthPx  = parsePositiveInt(lines[2]);
  const heightPx = parsePositiveInt(lines[3]);
  if (!Number.isFinite(x) || x < 0) return null;
  if (!Number.isFinite(y) || y < 0) return null;
  if (widthPx === null || heightPx === null) return null;
  return { x, y, widthPx, heightPx };
}

function detectWorkAreaWindows(): WorkArea | null {
  try {
    const r = spawnSync('powershell', [
      '-NoProfile', '-NonInteractive', '-Command',
      'Add-Type -AssemblyName System.Windows.Forms; ' +
      '$w = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea; ' +
      'Write-Output $w.X; Write-Output $w.Y; Write-Output $w.Width; Write-Output $w.Height',
    ], { encoding: 'utf8', timeout: 5000 });
    if (r.status === 0 && r.stdout) {
      const parsed = parseWorkAreaPowerShellOutput(r.stdout);
      if (parsed) return parsed;
    }
  } catch { /* fall through */ }
  return null;
}

/**
 * Detect the primary screen's WORKING AREA (screen minus taskbar / menu bar / panels) as a
 * dockable region. Fallback chain, never throws:
 *   1. Windows → PowerShell PrimaryScreen.WorkingArea (excludes the taskbar).
 *   2. Any OS  → full-screen detection (`detectScreenResolution`) with origin {0,0}. On macOS the
 *      Finder desktop bounds already exclude the menu bar; on Linux panels are not auto-excluded
 *      (minor overlap, refined per-emulator when wired).
 *   3. FALLBACK_SCREEN_SIZE with origin {0,0}.
 * Always resolves — the docked geometry can always be computed.
 */
export async function detectWorkArea(): Promise<WorkArea> {
  if (process.platform === 'win32') {
    const win = detectWorkAreaWindows();
    if (win) return win;
  }
  const screen = await detectScreenResolution();
  if (screen) return { x: 0, y: 0, widthPx: screen.widthPx, heightPx: screen.heightPx };
  return { x: 0, y: 0, widthPx: FALLBACK_SCREEN_SIZE.widthPx, heightPx: FALLBACK_SCREEN_SIZE.heightPx };
}

// ── Shared spawn helpers (P5) — used by BOTH the PE host (cli) and the advisory ─
// (decision-session) so the Windows positioning + Ubuntu Wayland handling live in
// exactly one place. All pure; no I/O.

/** Linux display server, for choosing how a spawned popup window is positioned. */
export type PromptEnhancementDisplayServerV1 = 'x11' | 'wayland' | 'unknown';

/**
 * Detect the Linux display server from the environment. `XDG_SESSION_TYPE` is authoritative when
 * present; otherwise infer from `WAYLAND_DISPLAY` / `DISPLAY`. Pure. Matters because GTK terminals
 * default to NATIVE Wayland, where an X11 `--geometry` position offset is ignored — forcing
 * `GDK_BACKEND=x11` routes them through XWayland (default on recent Ubuntu), where it positions.
 */
export function detectLinuxDisplayServerV1(
  env: NodeJS.ProcessEnv = process.env,
): PromptEnhancementDisplayServerV1 {
  const sessionType = (env.XDG_SESSION_TYPE ?? '').trim().toLowerCase();
  if (sessionType === 'wayland') return 'wayland';
  if (sessionType === 'x11') return 'x11';
  if (env.WAYLAND_DISPLAY) return 'wayland';
  if (env.DISPLAY) return 'x11';
  return 'unknown';
}

/** GTK terminal command names that default to native Wayland and need GDK_BACKEND=x11 to honour --geometry. */
export const GTK_X11_GEOMETRY_TERMINALS_V1: readonly string[] = ['gnome-terminal', 'xfce4-terminal'];

/**
 * Wrap a Linux terminal spawn `{ command, args }` with `env GDK_BACKEND=x11 …` when the session is
 * Wayland, the terminal is a GTK one that needs XWayland to position, and a geometry is actually
 * being applied. On X11 / unknown, or for non-GTK terminals, or without geometry, the plan is
 * returned unchanged. Pure. `env` execs into the terminal, so `--wait`/exit semantics are preserved.
 */
export function wrapLinuxSpawnForWaylandX11V1(
  plan: { command: string; args: readonly string[] },
  opts: { displayServer: PromptEnhancementDisplayServerV1; terminalCommand: string; hasGeometry: boolean },
): { command: string; args: string[] } {
  if (opts.hasGeometry && opts.displayServer === 'wayland' && GTK_X11_GEOMETRY_TERMINALS_V1.includes(opts.terminalCommand)) {
    return { command: 'env', args: ['GDK_BACKEND=x11', plan.command, ...plan.args] };
  }
  return { command: plan.command, args: [...plan.args] };
}

/**
 * The PowerShell script (written as a sibling .ps1, run via `-File`) that right-docks a popup's
 * console window: GetConsoleWindow (kernel32) + MoveWindow (user32) move+size the CURRENT console
 * to the docked pixel rect. Written as a separate file so there is NO batch/PowerShell/C# quoting
 * to get wrong; `$ErrorActionPreference = SilentlyContinue` + the caller's `2>nul` make it fully
 * fail-open. Pure.
 */
export function buildWindowsConsolePositionScriptV1(geometry: PopupGeometry): string {
  // Windows-Terminal-aware docking (2026-08-09): on Windows 11 with Windows Terminal the popup runs in a
  // hidden ConPTY pseudo-console, so GetConsoleWindow() is NOT the visible window — MoveWindow/mode-con
  // targeted the wrong window and the popup came up un-docked / wrong size (header scrolled off). Resolve
  // the REAL top-level window by our distinctive "Nexpath …" title (every popup title starts with
  // "Nexpath") via Get-Process → MainWindowHandle, and fall back to the console window for the classic
  // conhost case. Then SetWindowPos applies the docked position AND size in ONE call (60% wide, flush
  // right, full height) and raises it — working on Windows Terminal and conhost alike. Best-effort +
  // fully fail-open ($ErrorActionPreference + the caller's 2>nul): if no window resolves, the popup stays
  // visible at its default position — never invisible.
  const { xPx, yPx, widthPx, heightPx } = geometry;
  return [
    '$ErrorActionPreference = "SilentlyContinue"',
    'Add-Type @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public class NexpathWin {',
    '  [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();',
    '  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);',
    '  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);',
    '}',
    '"@',
    // Prefer the process whose MAIN window carries our "Nexpath …" title (the Windows Terminal window on
    // Win11); fall back to the console window (classic conhost, where that IS the visible window).
    "$proc = Get-Process | Where-Object { $_.MainWindowTitle -like 'Nexpath*' -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1",
    'if ($proc) { $h = $proc.MainWindowHandle } else { $h = [NexpathWin]::GetConsoleWindow() }',
    '[void][NexpathWin]::ShowWindow($h, 1)',   // SW_SHOWNORMAL: restore if minimized; harmless when normal
    // SetWindowPos: position + size + show + raise (HWND_TOP=IntPtr.Zero, SWP_SHOWWINDOW=0x0040) on the
    // real window — one call docks it on both Windows Terminal and conhost.
    `[void][NexpathWin]::SetWindowPos($h, [IntPtr]::Zero, ${xPx}, ${yPx}, ${widthPx}, ${heightPx}, 0x0040)`,
    '',
  ].join('\r\n');
}

/**
 * Build a Windows `.cmd` launcher that (fail-open) sizes the console in CELLS via `mode con` then
 * POSITIONS it via a sibling MoveWindow .ps1 (best-effort, `2>nul`), then runs `commandLine`. Both
 * positioning steps run BEFORE the command, in the same console, so a caller's `cmd /c start /WAIT`
 * + wait model is unchanged. Omitting `geometry` yields a launcher with no sizing/positioning
 * (byte-identical to a plain command launcher). Pure. `commandLine` must be a fully-formed,
 * already-quoted command (the caller owns its quoting).
 */
export function buildWindowsConsoleLauncherScriptV1(input: {
  commandLine: string;
  geometry?: PopupGeometry;
  positionScriptPath?: string;
}): string {
  const quote = (p: string): string => `"${p.replace(/"/g, '')}"`;
  const lines = ['@echo off'];
  if (input.geometry) {
    lines.push(`mode con: cols=${input.geometry.cols} lines=${input.geometry.rows}`);
    if (input.positionScriptPath) {
      lines.push(`powershell -NoProfile -ExecutionPolicy Bypass -File ${quote(input.positionScriptPath)} 2>nul`);
    }
  }
  lines.push(input.commandLine);
  lines.push('if errorlevel 1 pause', '');
  return lines.join('\r\n');
}
