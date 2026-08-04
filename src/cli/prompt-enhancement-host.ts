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

export const PROMPT_ENHANCEMENT_POPUP_HOST_DEADLINE_MS_V1 = 52_000;
const PROMPT_ENHANCEMENT_POPUP_HOST_POLL_INTERVAL_MS_V1 = 50;
const PROMPT_ENHANCEMENT_POPUP_HOST_PROTOCOL_VERSION_V1 = 1;
const PROMPT_ENHANCEMENT_POPUP_WINDOW_TITLE_V1 = 'Nexpath · Prompt enhancement';

export interface PromptEnhancementLinuxTerminalLaunchPlanV1 {
  command: PromptEnhancementLinuxTerminalCommandV1;
  args: readonly string[];
}

export type PromptEnhancementCliPopupHostLaunchResultV1 =
  | { state: 'not_applicable'; reasonCode: 'direct_tty' }
  | { state: 'host_unavailable'; reasonCode: 'unsupported_platform' | 'no_gui_session' | 'no_supported_terminal' }
  | { state: 'launch_failed'; reasonCode: 'terminal_spawn_failed' | 'terminal_exit_nonzero' | 'terminal_renderer_not_ready' }
  | { state: 'timed_out' }
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
  now: () => number;
  cleanupTempDir: (path: string) => void;
  detectPopupGeometry: () => Promise<PopupGeometry | undefined>;
}

function probeDirectTty(): boolean {
  let fd: number | undefined;
  try {
    fd = openSync('/dev/tty', 'r+');
    return true;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) {
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
  if (platform !== 'linux') {
    return { state: 'unavailable', method: 'none', reasonCode: 'unsupported_platform' };
  }

  const directTtyAvailable = dependencies.probeDirectTty ?? probeDirectTty;
  try {
    if (directTtyAvailable()) return { state: 'available', method: 'direct_tty' };
  } catch {
    // Continue to the GUI terminal capability path.
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
    now: () => Date.now(),
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
  deadlineMs?: number;
}, overrides: Partial<PromptEnhancementCliPopupHostLaunchDependenciesV1> = {}): Promise<PromptEnhancementCliPopupHostLaunchResultV1> {
  if (input.capability.state === 'unavailable') {
    return { state: 'host_unavailable', reasonCode: input.capability.reasonCode };
  }
  if (input.capability.method === 'direct_tty') return { state: 'not_applicable', reasonCode: 'direct_tty' };

  const dependencies = { ...defaultLaunchDependencies(), ...overrides };
  const deadlineMs = input.deadlineMs ?? PROMPT_ENHANCEMENT_POPUP_HOST_DEADLINE_MS_V1;
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
    const plan = planPromptEnhancementLinuxTerminalLaunchV1({
      terminalCommand: input.capability.terminalCommand,
      nodePath: input.nodePath ?? process.execPath,
      cliEntryPath: input.cliEntryPath,
      geometry,
      inputFile,
      resultFile,
      readinessFile,
      dbPath: input.dbPath,
    });
    try {
      child = await dependencies.spawnTerminal(plan);
      child.once('exit', (code, signal) => {
        terminalExitNonZero = code !== 0 || signal !== null;
      });
    } catch {
      return { state: 'launch_failed', reasonCode: 'terminal_spawn_failed' };
    }

    const deadlineAt = dependencies.now() + deadlineMs;
    for (;;) {
      rendererReady ||= dependencies.readReadyFile(readinessFile);
      const output = dependencies.readResultFile(resultFile);
      if (output) {
        return rendererReady
          ? { state: 'completed', output }
          : { state: 'launch_failed', reasonCode: 'terminal_renderer_not_ready' };
      }
      if (terminalExitNonZero) return { state: 'launch_failed', reasonCode: 'terminal_exit_nonzero' };
      if (dependencies.now() >= deadlineAt) {
        return rendererReady
          ? { state: 'timed_out' }
          : { state: 'launch_failed', reasonCode: 'terminal_renderer_not_ready' };
      }
      await dependencies.sleep(Math.min(PROMPT_ENHANCEMENT_POPUP_HOST_POLL_INTERVAL_MS_V1, Math.max(1, deadlineAt - dependencies.now())));
    }
  } finally {
    if (child) {
      try { child.kill('SIGTERM'); } catch { /* best-effort timeout/cleanup termination */ }
    }
    try { dependencies.cleanupTempDir(tempDir); } catch { /* cleanup must not crash the hook */ }
  }
}
