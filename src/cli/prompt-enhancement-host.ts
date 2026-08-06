import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  PromptEnhancementPrepareRequestV1,
  PromptEnhancementPrepareResultV1,
} from '../prompt-enhancement/contracts.js';
import { validatePromptEnhancementCliPopupResultV1 } from '../prompt-enhancement/cli-submit-popup.js';
import { computePopupGeometry, detectScreenResolution, type PopupGeometry } from '../decision-session/screen-geometry.js';
import type {
  PromptEnhancementPopupHostInputV1,
  PromptEnhancementPopupHostOutputV1,
} from './commands/prompt-enhancement-popup-host.js';

export const PROMPT_ENHANCEMENT_LINUX_TERMINAL_COMMANDS_V1 = [
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

export type PromptEnhancementLinuxTerminalCommandV1 =
  (typeof PROMPT_ENHANCEMENT_LINUX_TERMINAL_COMMANDS_V1)[number];

export type PromptEnhancementCliHostCapabilityV1 =
  | {
      state: 'available';
      method: 'direct_tty';
    }
  | {
      state: 'available';
      method: 'linux_terminal';
      terminalCommand: PromptEnhancementLinuxTerminalCommandV1;
    }
  | {
      // Windows: the popup is rendered in a NEW console window spawned via `cmd /c start` (the Stop
      // hook has no usable in-process console). Mirrors the advisory's Windows path.
      state: 'available';
      method: 'windows_terminal';
    }
  | {
      // macOS: the popup is rendered in a NEW Terminal.app window spawned via `osascript` (the Stop
      // hook may have no usable /dev/tty). Mirrors the advisory's macOS path.
      state: 'available';
      method: 'mac_terminal';
    }
  | {
      state: 'unavailable';
      method: 'none';
      reasonCode: 'unsupported_platform' | 'no_gui_session' | 'no_supported_terminal';
    };

export interface PromptEnhancementCliHostProbeDependenciesV1 {
  platform?: NodeJS.Platform;
  env?: Pick<NodeJS.ProcessEnv, 'DISPLAY' | 'WAYLAND_DISPLAY'>;
  probeDirectTty?: () => boolean;
  commandExists?: (command: PromptEnhancementLinuxTerminalCommandV1) => boolean;
  readCommandVersion?: (command: PromptEnhancementLinuxTerminalCommandV1) => string | undefined;
}

// Owner decision: the PE popup has NO timeout — the host waits for the user
// indefinitely. The poll loop only ends when the renderer writes a result or the
// terminal exits; there is no deadline.
const PROMPT_ENHANCEMENT_POPUP_HOST_POLL_INTERVAL_MS_V1 = 50;
const PROMPT_ENHANCEMENT_POPUP_HOST_PROTOCOL_VERSION_V1 = 1;
const PROMPT_ENHANCEMENT_POPUP_WINDOW_TITLE_V1 = 'Nexpath · Prompt enhancement';

export interface PromptEnhancementLinuxTerminalLaunchPlanV1 {
  // A bare argv: `command` is the program to spawn and `args` its arguments. Widened to `string` so
  // the Windows launcher can use `cmd.exe` (the Linux plan still returns a terminal-command name).
  command: string;
  args: readonly string[];
}

export type PromptEnhancementCliPopupHostLaunchResultV1 =
  | { state: 'not_applicable'; reasonCode: 'direct_tty' }
  | { state: 'host_unavailable'; reasonCode: 'unsupported_platform' | 'no_gui_session' | 'no_supported_terminal' }
  | { state: 'launch_failed'; reasonCode: 'terminal_spawn_failed' | 'terminal_exit_nonzero' | 'terminal_renderer_not_ready' }
  | { state: 'completed'; output: PromptEnhancementPopupHostOutputV1 };

interface PromptEnhancementSpawnedTerminalV1 {
  unref(): void;
  kill(signal?: NodeJS.Signals | number): boolean;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
}

export interface PromptEnhancementCliPopupHostLaunchDependenciesV1 {
  makeTempDir: () => string;
  writeInputFile: (path: string, input: PromptEnhancementPopupHostInputV1) => void;
  spawnTerminal: (plan: PromptEnhancementLinuxTerminalLaunchPlanV1) => Promise<PromptEnhancementSpawnedTerminalV1>;
  readResultFile: (path: string) => PromptEnhancementPopupHostOutputV1 | undefined;
  readReadyFile: (path: string) => boolean;
  sleep: (milliseconds: number) => Promise<void>;
  cleanupTempDir: (path: string) => void;
  detectPopupGeometry: () => Promise<PopupGeometry | undefined>;
}

function probeDirectTty(): boolean {
  // Mirror the popup's console open (cli-submit-popup.ts): Linux + macOS use /dev/tty; Windows uses
  // the console device (CONIN$ for input, CONOUT$ for output). Probe the same device(s) so this
  // capability accurately predicts whether the popup can attach.
  const fds: number[] = [];
  try {
    if (process.platform === 'win32') {
      fds.push(openSync('\\\\.\\CONIN$', 'r'));
      fds.push(openSync('\\\\.\\CONOUT$', 'w'));
    } else {
      fds.push(openSync('/dev/tty', 'r+'));
    }
    return true;
  } catch {
    return false;
  } finally {
    for (const fd of fds) {
      try {
        closeSync(fd);
      } catch {
        // A failed capability-probe cleanup must not crash the hook.
      }
    }
  }
}

function commandExists(command: PromptEnhancementLinuxTerminalCommandV1): boolean {
  const result = spawnSync('which', [command], {
    stdio: 'ignore',
    timeout: 2_000,
  });
  return result.status === 0;
}

function readCommandVersion(command: PromptEnhancementLinuxTerminalCommandV1): string | undefined {
  const result = spawnSync(command, ['--version'], {
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 2_000,
  });
  return typeof result.stdout === 'string' ? result.stdout : undefined;
}

function supportsBlockingGnomeTerminal(version: string | undefined): boolean {
  const match = version?.match(/(\d+)\.(\d+)/);
  if (!match) return true;
  const major = Number.parseInt(match[1], 10);
  const minor = Number.parseInt(match[2], 10);
  return major > 3 || (major === 3 && minor >= 36);
}

/**
 * Resolve only the interactive surface available to the PE CLI consumer.
 *
 * The resolver performs no rendering or launching. It is intentionally
 * separate from Decision Session UI/state and fails closed to a typed reason.
 */
export function resolvePromptEnhancementCliHostCapabilityV1(
  dependencies: PromptEnhancementCliHostProbeDependenciesV1 = {},
): PromptEnhancementCliHostCapabilityV1 {
  const platform = dependencies.platform ?? process.platform;
  if (platform === 'win32') {
    // Windows: the Stop hook has no usable in-process console — opening CONIN$/CONOUT$ there renders
    // to a NON-VISIBLE console, so the popup "shows" invisibly. Always spawn a new window instead
    // (mirrors the advisory's `cmd /c start`); the child renders in that window's real console.
    return { state: 'available', method: 'windows_terminal' };
  }
  if (platform === 'darwin') {
    // macOS: always spawn a new Terminal.app window (mirrors the advisory's osascript path) — the Stop
    // hook may have no usable in-process /dev/tty, so never rely on it. Matches the old popup's
    // all-platform "always a spawned window" behaviour.
    return { state: 'available', method: 'mac_terminal' };
  }
  if (platform !== 'linux') {
    return { state: 'unavailable', method: 'none', reasonCode: 'unsupported_platform' };
  }

  // Linux: prefer the in-process /dev/tty when the hook has a controlling terminal, otherwise spawn a
  // GUI terminal below (unchanged behaviour).
  const directTtyAvailable = dependencies.probeDirectTty ?? probeDirectTty;
  try {
    if (directTtyAvailable()) return { state: 'available', method: 'direct_tty' };
  } catch {
    // Continue to the Linux terminal-spawn fallback below.
  }

  const env = dependencies.env ?? process.env;
  if (!env.DISPLAY && !env.WAYLAND_DISPLAY) {
    return { state: 'unavailable', method: 'none', reasonCode: 'no_gui_session' };
  }

  const hasCommand = dependencies.commandExists ?? commandExists;
  const getVersion = dependencies.readCommandVersion ?? readCommandVersion;
  for (const terminalCommand of PROMPT_ENHANCEMENT_LINUX_TERMINAL_COMMANDS_V1) {
    let available = false;
    try {
      available = hasCommand(terminalCommand);
    } catch {
      continue;
    }
    if (!available) continue;

    if (terminalCommand === 'gnome-terminal') {
      let version: string | undefined;
      try {
        version = getVersion(terminalCommand);
      } catch {
        version = undefined;
      }
      if (!supportsBlockingGnomeTerminal(version)) continue;
    }

    return { state: 'available', method: 'linux_terminal', terminalCommand };
  }

  return { state: 'unavailable', method: 'none', reasonCode: 'no_supported_terminal' };
}

/**
 * Build only the generic Linux terminal argv for the already-resolved PE host.
 * The request/result body is private-file data and never becomes an argv value.
 */
export function planPromptEnhancementLinuxTerminalLaunchV1(input: {
  terminalCommand: PromptEnhancementLinuxTerminalCommandV1;
  nodePath: string;
  cliEntryPath: string;
  inputFile: string;
  resultFile: string;
  readinessFile: string;
  dbPath: string;
  /** ~70% × 70% centred popup window geometry; omitted → the terminal's default size. */
  geometry?: PopupGeometry;
}): PromptEnhancementLinuxTerminalLaunchPlanV1 {
  const childArgs = [
    input.nodePath,
    input.cliEntryPath,
    'prompt-enhancement-popup-host',
    '--input-file', input.inputFile,
    '--result-file', input.resultFile,
    '--readiness-file', input.readinessFile,
    '--db', input.dbPath,
  ];

  // Size the popup window to the supplied ~70%×70% geometry, using each
  // emulator's native flag (char cells for X11-style; pixels for kitty/foot).
  // Reused from the decision-session screen-geometry pattern.
  const g = input.geometry;
  const cellGeom = g ? [`--geometry=${g.cols}x${g.rows}+${g.xPx}+${g.yPx}`] : [];
  const xtermGeom = g ? ['-geometry', `${g.cols}x${g.rows}+${g.xPx}+${g.yPx}`] : [];
  const kittyGeom = g ? ['-o', `initial_window_width=${g.widthPx}px`, '-o', `initial_window_height=${g.heightPx}px`, '-o', 'remember_window_size=no'] : [];
  const alacrittyGeom = g ? ['--dimensions', `${g.cols}`, `${g.rows}`] : [];
  const footGeom = g ? [`--window-size-pixels=${g.widthPx}x${g.heightPx}`] : [];
  const T = PROMPT_ENHANCEMENT_POPUP_WINDOW_TITLE_V1;

  switch (input.terminalCommand) {
    case 'xdg-terminal-exec':
      return { command: input.terminalCommand, args: childArgs };
    case 'gnome-terminal':
      return { command: input.terminalCommand, args: ['--wait', `--title=${T}`, ...cellGeom, '--', ...childArgs] };
    case 'konsole':
      return { command: input.terminalCommand, args: ['-p', `tabtitle=${T}`, '-e', ...childArgs] };
    case 'xfce4-terminal':
      return { command: input.terminalCommand, args: ['--disable-server', `--title=${T}`, ...cellGeom, '-x', ...childArgs] };
    case 'kitty':
      return { command: input.terminalCommand, args: [...kittyGeom, '--title', T, ...childArgs] };
    case 'alacritty':
      return { command: input.terminalCommand, args: [...alacrittyGeom, '--title', T, '-e', ...childArgs] };
    case 'wezterm':
      return { command: input.terminalCommand, args: ['start', '--', ...childArgs] };
    case 'foot':
      return { command: input.terminalCommand, args: [...footGeom, `--title=${T}`, ...childArgs] };
    case 'x-terminal-emulator':
      return { command: input.terminalCommand, args: ['-e', ...childArgs] };
    case 'xterm':
      return { command: input.terminalCommand, args: [...xtermGeom, '-T', T, '-e', ...childArgs] };
  }
}

/**
 * The batch launcher executed inside the spawned Windows console window. Every path is double-quoted
 * so cmd.exe handles spaces natively — no reliance on `start`/argv escaping, which is fragile for
 * space-containing paths (e.g. a clone under "nexpath testing\"). Node is invoked by its ABSOLUTE
 * path, so it does not depend on the new window's PATH. This is the robust, standard way to launch a
 * child process with arbitrary paths on Windows.
 */
export function buildPromptEnhancementWindowsLauncherScriptV1(input: {
  nodeExecPath: string;
  cliEntryPath: string;
  inputFile: string;
  resultFile: string;
  readinessFile: string;
  dbPath: string;
}): string {
  // Paths never legitimately contain a double-quote; strip any defensively so the quoting can't be
  // broken out of (the request body itself is passed as a file, never on this command line).
  const quote = (p: string): string => `"${p.replace(/"/g, '')}"`;
  const command = [
    quote(input.nodeExecPath),
    quote(input.cliEntryPath),
    'prompt-enhancement-popup-host',
    '--input-file', quote(input.inputFile),
    '--result-file', quote(input.resultFile),
    '--readiness-file', quote(input.readinessFile),
    '--db', quote(input.dbPath),
  ].join(' ');
  // `@echo off` for a clean window; CRLF line endings for a well-formed .cmd. On success the child
  // exits 0 and the window closes; on any real error (non-zero exit) `pause` keeps the window open so
  // the message is visible instead of the window flashing and vanishing (better UX + diagnosis).
  return ['@echo off', command, 'if errorlevel 1 pause', ''].join('\r\n');
}

/**
 * Windows popup launch: open a NEW console window that runs the batch launcher above, via
 * `cmd /c start /WAIT "<title>" cmd /c "<launcher.cmd>"`.
 *
 * IMPORTANT: `start` must run a *program* (here `cmd /c <launcher.cmd>`), NOT the `.cmd` file directly.
 * `start "<title>" "<launch.cmd>"` routes the `.cmd` through ShellExecute's file association, which
 * fails on real Windows with "The system cannot find the path specified." — this is exactly the shape
 * the working advisory popup uses (`start … node <script>` runs a program too). The launcher path is
 * in a temp dir (no spaces), so `start` needs no fragile quoting; every real, possibly-space-containing
 * path is quoted INSIDE the batch. `/WAIT` keeps the parent alive until the window closes; the child
 * renders in that window's real, visible console.
 */
export function planPromptEnhancementWindowsTerminalLaunchV1(input: {
  launcherScriptPath: string;
}): PromptEnhancementLinuxTerminalLaunchPlanV1 {
  return {
    // Resolve the command interpreter from the system (`%ComSpec%`) rather than assuming a fixed
    // `cmd.exe` on PATH — this works across non-standard Windows installs and locales. Falls back to
    // the on-PATH `cmd.exe` only if the env var is absent.
    command: process.env.ComSpec ?? 'cmd.exe',
    args: ['/c', 'start', '/WAIT', PROMPT_ENHANCEMENT_POPUP_WINDOW_TITLE_V1, 'cmd', '/c', input.launcherScriptPath],
  };
}

/**
 * The shell launcher executed inside the spawned macOS Terminal.app window. Every path is
 * single-quoted so /bin/sh handles spaces natively, and node is invoked by its ABSOLUTE path — the
 * same robust approach as the Windows batch launcher (no fragile inline quoting).
 */
export function buildPromptEnhancementMacLauncherScriptV1(input: {
  nodeExecPath: string;
  cliEntryPath: string;
  inputFile: string;
  resultFile: string;
  readinessFile: string;
  dbPath: string;
}): string {
  // Paths never legitimately contain a single-quote; strip any defensively so the sh quoting holds.
  const quote = (p: string): string => `'${p.replace(/'/g, '')}'`;
  const command = [
    quote(input.nodeExecPath),
    quote(input.cliEntryPath),
    'prompt-enhancement-popup-host',
    '--input-file', quote(input.inputFile),
    '--result-file', quote(input.resultFile),
    '--readiness-file', quote(input.readinessFile),
    '--db', quote(input.dbPath),
  ].join(' ');
  return ['#!/bin/sh', command, ''].join('\n');
}

/**
 * AppleScript that opens a new Terminal.app window, runs `shellCommand; exit`, waits for it to finish,
 * then closes the window. Replicated from the advisory's buildTerminalAppleScript so the PE host does
 * not import the heavy decision-session tty module.
 */
function buildPromptEnhancementMacAppleScriptV1(shellCommand: string, geom: PopupGeometry | null): string {
  const escaped = shellCommand.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const sizeBlock = geom
    ? `try
        set bounds of (first window whose selected tab is theTab) to {${geom.xPx}, ${geom.yPx}, ${geom.xPx + geom.widthPx}, ${geom.yPx + geom.heightPx}}
    end try`
    : 'set number of rows of (first window whose selected tab is theTab) to 50';
  return `tell application "Terminal"
    activate
    set theTab to do script "${escaped}; exit"
    ${sizeBlock}
    delay 1
    repeat
        delay 0.5
        try
            if not (busy of theTab) then exit repeat
        on error
            exit repeat
        end try
    end repeat
    try
        close (first window whose selected tab is theTab)
    end try
end tell`;
}

/**
 * macOS popup launch: open a NEW Terminal.app window (via `osascript`) that runs the shell launcher
 * above through `sh`. The launcher path lives in a temp dir (no spaces), so the AppleScript embedding
 * is clean; every real, possibly-space-containing path is quoted INSIDE the launcher. osascript is
 * synchronous — the AppleScript waits for the child to finish, then closes the window. Mirrors the
 * advisory's macOS path.
 */
export function planPromptEnhancementMacTerminalLaunchV1(input: {
  launcherScriptPath: string;
  geometry?: PopupGeometry;
}): PromptEnhancementLinuxTerminalLaunchPlanV1 {
  const shCommand = `sh '${input.launcherScriptPath.replace(/'/g, '')}'`;
  return {
    command: 'osascript',
    args: ['-e', buildPromptEnhancementMacAppleScriptV1(shCommand, input.geometry ?? null)],
  };
}

function makeTempDir(): string {
  const dir = join(tmpdir(), `nexpath-pe-popup-host-${randomUUID()}`);
  mkdirSync(dir, { mode: 0o700 });
  chmodSync(dir, 0o700);
  return dir;
}

function writeInputFile(path: string, input: PromptEnhancementPopupHostInputV1): void {
  const fd = openSync(path, 'wx', 0o600);
  try {
    writeFileSync(fd, JSON.stringify(input), 'utf8');
    chmodSync(path, 0o600);
  } finally {
    closeSync(fd);
  }
}

function readReadyFile(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    return lstatSync(path).isFile() && readFileSync(path, 'utf8') === 'ready';
  } catch {
    return false;
  }
}

function readResultFile(path: string): PromptEnhancementPopupHostOutputV1 | undefined {
  if (!existsSync(path)) return undefined;
  try {
    if (!lstatSync(path).isFile()) return undefined;
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const output = parsed as Record<string, unknown>;
    if (output.protocolVersion !== PROMPT_ENHANCEMENT_POPUP_HOST_PROTOCOL_VERSION_V1) return undefined;
    if (!validatePromptEnhancementCliPopupResultV1(output.result)) return undefined;
    return {
      protocolVersion: PROMPT_ENHANCEMENT_POPUP_HOST_PROTOCOL_VERSION_V1,
      result: output.result,
    };
  } catch {
    return undefined;
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function spawnTerminal(plan: PromptEnhancementLinuxTerminalLaunchPlanV1): Promise<PromptEnhancementSpawnedTerminalV1> {
  const child = spawn(plan.command, [...plan.args], { detached: true, stdio: 'ignore', shell: false });
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  child.unref();
  return child;
}

function cleanupTempDir(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

function defaultLaunchDependencies(): PromptEnhancementCliPopupHostLaunchDependenciesV1 {
  return {
    makeTempDir,
    writeInputFile,
    spawnTerminal,
    readResultFile,
    readReadyFile,
    sleep,
    cleanupTempDir,
    detectPopupGeometry: async () => {
      try {
        const screen = await detectScreenResolution();
        return screen ? computePopupGeometry(screen) : undefined;
      } catch {
        return undefined;
      }
    },
  };
}

/**
 * Launch the already-built hidden popup child through a resolved Linux terminal
 * and exchange only private typed files. It does not decide hook output or
 * mutate PE semantics; PE1.3 returns transport status for the later adapter.
 */
export async function runPromptEnhancementCliPopupHostLaunchV1(input: {
  capability: PromptEnhancementCliHostCapabilityV1;
  request: PromptEnhancementPrepareRequestV1;
  result: PromptEnhancementPrepareResultV1;
  cliEntryPath: string;
  dbPath: string;
  nodePath?: string;
}, overrides: Partial<PromptEnhancementCliPopupHostLaunchDependenciesV1> = {}): Promise<PromptEnhancementCliPopupHostLaunchResultV1> {
  if (input.capability.state === 'unavailable') {
    return { state: 'host_unavailable', reasonCode: input.capability.reasonCode };
  }
  if (input.capability.method === 'direct_tty') return { state: 'not_applicable', reasonCode: 'direct_tty' };

  const dependencies = { ...defaultLaunchDependencies(), ...overrides };
  const tempDir = dependencies.makeTempDir();
  const inputFile = join(tempDir, 'input.json');
  const resultFile = join(tempDir, 'result.json');
  const readinessFile = join(tempDir, 'ready');
  let child: PromptEnhancementSpawnedTerminalV1 | undefined;
  let terminalExitNonZero = false;
  let rendererReady = false;

  try {
    const childInput: PromptEnhancementPopupHostInputV1 = {
      protocolVersion: PROMPT_ENHANCEMENT_POPUP_HOST_PROTOCOL_VERSION_V1,
      request: input.request,
      result: input.result,
    };
    dependencies.writeInputFile(inputFile, childInput);
    const geometry = await dependencies.detectPopupGeometry();
    let plan: PromptEnhancementLinuxTerminalLaunchPlanV1;
    if (input.capability.method === 'windows_terminal') {
      // Write the batch launcher into the temp dir (cleaned up in `finally`), then spawn a window
      // that runs it. All real paths are quoted inside the batch, so the spawn command stays clean.
      const launcherScriptPath = join(tempDir, 'launch.cmd');
      const launcherScript = buildPromptEnhancementWindowsLauncherScriptV1({
        nodeExecPath: input.nodePath ?? process.execPath,
        cliEntryPath: input.cliEntryPath,
        inputFile,
        resultFile,
        readinessFile,
        dbPath: input.dbPath,
      });
      writeFileSync(launcherScriptPath, launcherScript, 'utf8');
      if (process.env.NEXPATH_DEBUG) process.stderr.write(`[nexpath] launch.cmd (${launcherScriptPath}):\n${launcherScript}\n`);
      plan = planPromptEnhancementWindowsTerminalLaunchV1({ launcherScriptPath });
    } else if (input.capability.method === 'mac_terminal') {
      // Write the shell launcher (0o700) into the temp dir, then open a Terminal.app window that runs
      // it. All real paths are quoted inside the launcher, so the AppleScript stays clean.
      const launcherScriptPath = join(tempDir, 'launch.sh');
      writeFileSync(launcherScriptPath, buildPromptEnhancementMacLauncherScriptV1({
        nodeExecPath: input.nodePath ?? process.execPath,
        cliEntryPath: input.cliEntryPath,
        inputFile,
        resultFile,
        readinessFile,
        dbPath: input.dbPath,
      }), { mode: 0o700 });
      plan = planPromptEnhancementMacTerminalLaunchV1({ launcherScriptPath, geometry });
    } else {
      plan = planPromptEnhancementLinuxTerminalLaunchV1({
        terminalCommand: input.capability.terminalCommand,
        nodePath: input.nodePath ?? process.execPath,
        cliEntryPath: input.cliEntryPath,
        geometry,
        inputFile,
        resultFile,
        readinessFile,
        dbPath: input.dbPath,
      });
    }
    if (process.env.NEXPATH_DEBUG) {
      process.stderr.write(`[nexpath] PE popup spawn: ${plan.command} ${JSON.stringify(plan.args)}\n`);
    }
    try {
      child = await dependencies.spawnTerminal(plan);
      child.once('exit', (code, signal) => {
        terminalExitNonZero = code !== 0 || signal !== null;
      });
    } catch {
      return { state: 'launch_failed', reasonCode: 'terminal_spawn_failed' };
    }

    // No deadline — the popup waits for the user indefinitely (owner decision).
    // The loop ends only when the renderer writes a result, or the terminal
    // exits without one (crash / window closed emits a non-zero exit or signal).
    for (;;) {
      rendererReady ||= dependencies.readReadyFile(readinessFile);
      const output = dependencies.readResultFile(resultFile);
      if (output) {
        return rendererReady
          ? { state: 'completed', output }
          : { state: 'launch_failed', reasonCode: 'terminal_renderer_not_ready' };
      }
      if (terminalExitNonZero) return { state: 'launch_failed', reasonCode: 'terminal_exit_nonzero' };
      await dependencies.sleep(PROMPT_ENHANCEMENT_POPUP_HOST_POLL_INTERVAL_MS_V1);
    }
  } finally {
    if (child) {
      try { child.kill('SIGTERM'); } catch { /* best-effort timeout/cleanup termination */ }
    }
    try { dependencies.cleanupTempDir(tempDir); } catch { /* cleanup must not crash the hook */ }
  }
}
