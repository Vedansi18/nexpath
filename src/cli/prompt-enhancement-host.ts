import { closeSync, openSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

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
