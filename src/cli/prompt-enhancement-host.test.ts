import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  PROMPT_ENHANCEMENT_LINUX_TERMINAL_COMMANDS_V1,
  planPromptEnhancementLinuxTerminalLaunchV1,
  resolvePromptEnhancementCliHostCapabilityV1,
  runPromptEnhancementCliPopupHostLaunchV1,
  type PromptEnhancementLinuxTerminalCommandV1,
} from './prompt-enhancement-host.js';
import type { PromptEnhancementPrepareRequestV1, PromptEnhancementPrepareResultV1 } from '../prompt-enhancement/contracts.js';

function unavailableCommands() {
  return vi.fn((_command: PromptEnhancementLinuxTerminalCommandV1) => false);
}

describe('PE1.1 — prompt enhancement CLI host capability resolver', () => {
  it('selects a usable direct TTY before probing GUI terminals', () => {
    const commandExists = unavailableCommands();
    const result = resolvePromptEnhancementCliHostCapabilityV1({
      platform: 'linux',
      env: {},
      probeDirectTty: () => true,
      commandExists,
    });

    expect(result).toEqual({ state: 'available', method: 'direct_tty' });
    expect(commandExists).not.toHaveBeenCalled();
  });

  it('fails closed on a genuinely unsupported platform without probing host resources', () => {
    const probeDirectTty = vi.fn(() => true);
    const commandExists = unavailableCommands();
    const result = resolvePromptEnhancementCliHostCapabilityV1({
      platform: 'aix', // not linux / darwin / win32
      env: { DISPLAY: ':0' },
      probeDirectTty,
      commandExists,
    });

    expect(result).toEqual({
      state: 'unavailable',
      method: 'none',
      reasonCode: 'unsupported_platform',
    });
    expect(probeDirectTty).not.toHaveBeenCalled();
    expect(commandExists).not.toHaveBeenCalled();
  });

  it('supports macOS via the direct /dev/tty console', () => {
    const commandExists = unavailableCommands();
    const result = resolvePromptEnhancementCliHostCapabilityV1({
      platform: 'darwin',
      env: {},
      probeDirectTty: () => true,
      commandExists,
    });
    expect(result).toEqual({ state: 'available', method: 'direct_tty' });
    expect(commandExists).not.toHaveBeenCalled();
  });

  it('supports Windows via the direct CONIN$/CONOUT$ console', () => {
    const commandExists = unavailableCommands();
    const result = resolvePromptEnhancementCliHostCapabilityV1({
      platform: 'win32',
      env: {},
      probeDirectTty: () => true,
      commandExists,
    });
    expect(result).toEqual({ state: 'available', method: 'direct_tty' });
    expect(commandExists).not.toHaveBeenCalled();
  });

  it('fails closed (no spawn) on Windows/macOS when the direct console is unavailable', () => {
    const commandExists = unavailableCommands();
    for (const platform of ['win32', 'darwin'] as const) {
      const result = resolvePromptEnhancementCliHostCapabilityV1({
        platform,
        env: {},
        probeDirectTty: () => false,
        commandExists,
      });
      expect(result).toEqual({ state: 'unavailable', method: 'none', reasonCode: 'no_supported_terminal' });
    }
    // The Linux-only terminal-spawn path is never probed on Windows/macOS.
    expect(commandExists).not.toHaveBeenCalled();
  });

  it('returns no_gui_session when direct TTY and Linux display surfaces are absent', () => {
    const commandExists = unavailableCommands();
    const result = resolvePromptEnhancementCliHostCapabilityV1({
      platform: 'linux',
      env: {},
      probeDirectTty: () => false,
      commandExists,
    });

    expect(result).toEqual({
      state: 'unavailable',
      method: 'none',
      reasonCode: 'no_gui_session',
    });
    expect(commandExists).not.toHaveBeenCalled();
  });

  it('selects the first supported terminal in the locked priority order', () => {
    const commandExists = vi.fn((command: PromptEnhancementLinuxTerminalCommandV1) =>
      command === 'gnome-terminal' || command === 'xterm',
    );
    const result = resolvePromptEnhancementCliHostCapabilityV1({
      platform: 'linux',
      env: { DISPLAY: ':0' },
      probeDirectTty: () => false,
      commandExists,
      readCommandVersion: () => 'GNOME Terminal 3.44.0',
    });

    expect(result).toEqual({
      state: 'available',
      method: 'linux_terminal',
      terminalCommand: 'gnome-terminal',
    });
    expect(commandExists.mock.calls.map(([command]) => command)).toEqual([
      'xdg-terminal-exec',
      'gnome-terminal',
    ]);
    expect(PROMPT_ENHANCEMENT_LINUX_TERMINAL_COMMANDS_V1.at(-1)).toBe('xterm');
  });

  it('accepts a Wayland session without DISPLAY', () => {
    const result = resolvePromptEnhancementCliHostCapabilityV1({
      platform: 'linux',
      env: { WAYLAND_DISPLAY: 'wayland-0' },
      probeDirectTty: () => false,
      commandExists: (command) => command === 'foot',
    });

    expect(result).toEqual({
      state: 'available',
      method: 'linux_terminal',
      terminalCommand: 'foot',
    });
  });

  it('skips gnome-terminal below 3.36 and continues to the next supported terminal', () => {
    const result = resolvePromptEnhancementCliHostCapabilityV1({
      platform: 'linux',
      env: { DISPLAY: ':0' },
      probeDirectTty: () => false,
      commandExists: (command) => command === 'gnome-terminal' || command === 'konsole',
      readCommandVersion: () => 'GNOME Terminal 3.28.2',
    });

    expect(result).toEqual({
      state: 'available',
      method: 'linux_terminal',
      terminalCommand: 'konsole',
    });
  });

  it('accepts gnome-terminal when its version cannot be determined', () => {
    const result = resolvePromptEnhancementCliHostCapabilityV1({
      platform: 'linux',
      env: { DISPLAY: ':0' },
      probeDirectTty: () => false,
      commandExists: (command) => command === 'gnome-terminal',
      readCommandVersion: () => undefined,
    });

    expect(result).toEqual({
      state: 'available',
      method: 'linux_terminal',
      terminalCommand: 'gnome-terminal',
    });
  });

  it('returns no_supported_terminal when no known terminal command is installed', () => {
    const commandExists = unavailableCommands();
    const result = resolvePromptEnhancementCliHostCapabilityV1({
      platform: 'linux',
      env: { DISPLAY: ':0' },
      probeDirectTty: () => false,
      commandExists,
    });

    expect(result).toEqual({
      state: 'unavailable',
      method: 'none',
      reasonCode: 'no_supported_terminal',
    });
    expect(commandExists).toHaveBeenCalledTimes(
      PROMPT_ENHANCEMENT_LINUX_TERMINAL_COMMANDS_V1.length,
    );
  });

  it('returns no_supported_terminal when capability probes throw', () => {
    const result = resolvePromptEnhancementCliHostCapabilityV1({
      platform: 'linux',
      env: { DISPLAY: ':0' },
      probeDirectTty: () => {
        throw new Error('probe unavailable');
      },
      commandExists: () => {
        throw new Error('command probe unavailable');
      },
    });

    expect(result).toEqual({
      state: 'unavailable',
      method: 'none',
      reasonCode: 'no_supported_terminal',
    });
  });
});

function launchInput() {
  return {
    capability: { state: 'available' as const, method: 'linux_terminal' as const, terminalCommand: 'gnome-terminal' as const },
    request: { sourcePrompt: { text: 'RAW PE REQUEST MUST STAY OUT OF ARGV' } } as PromptEnhancementPrepareRequestV1,
    result: { currentBody: { text: 'RAW ENHANCED BODY MUST STAY OUT OF ARGV' } } as PromptEnhancementPrepareResultV1,
    cliEntryPath: '/opt/nexpath/dist/cli/index.js',
    dbPath: '/tmp/nexpath-test.db',
    nodePath: '/usr/bin/node',
  };
}

function child(exitCode: number | null = null, exitSignal: NodeJS.Signals | null = null) {
  const callbacks = new Map<string, (code: number | null, signal: NodeJS.Signals | null) => void>();
  const value = {
    unref: vi.fn(),
    kill: vi.fn(() => true),
    once: vi.fn((event: 'exit', callback: (code: number | null, signal: NodeJS.Signals | null) => void) => {
      callbacks.set(event, callback);
      if (event === 'exit' && (exitCode !== null || exitSignal !== null)) callback(exitCode, exitSignal);
      return value;
    }),
  };
  return value;
}

describe('PE1.3 — Linux PE popup host launcher', () => {
  it('builds terminal argv with only executable and private-file values', () => {
    const input = launchInput();
    const gnome = planPromptEnhancementLinuxTerminalLaunchV1({
      terminalCommand: 'gnome-terminal', nodePath: input.nodePath, cliEntryPath: input.cliEntryPath,
      inputFile: '/tmp/private/input.json', resultFile: '/tmp/private/result.json', readinessFile: '/tmp/private/ready', dbPath: input.dbPath,
    });
    const xdg = planPromptEnhancementLinuxTerminalLaunchV1({
      terminalCommand: 'xdg-terminal-exec', nodePath: input.nodePath, cliEntryPath: input.cliEntryPath,
      inputFile: '/tmp/private/input.json', resultFile: '/tmp/private/result.json', readinessFile: '/tmp/private/ready', dbPath: input.dbPath,
    });

    expect(gnome).toEqual({
      command: 'gnome-terminal',
      args: ['--wait', '--title=Nexpath · Prompt enhancement', '--', '/usr/bin/node', '/opt/nexpath/dist/cli/index.js', 'prompt-enhancement-popup-host', '--input-file', '/tmp/private/input.json', '--result-file', '/tmp/private/result.json', '--readiness-file', '/tmp/private/ready', '--db', '/tmp/nexpath-test.db'],
    });
    expect(xdg.args).toEqual(['/usr/bin/node', '/opt/nexpath/dist/cli/index.js', 'prompt-enhancement-popup-host', '--input-file', '/tmp/private/input.json', '--result-file', '/tmp/private/result.json', '--readiness-file', '/tmp/private/ready', '--db', '/tmp/nexpath-test.db']);
    expect(JSON.stringify(gnome.args)).not.toContain('RAW PE REQUEST');
    expect(JSON.stringify(gnome.args)).not.toContain('RAW ENHANCED BODY');
  });

  it('inserts a ~70% popup window geometry when supplied, before the child args', () => {
    const input = launchInput();
    const geometry = { widthPx: 1344, heightPx: 756, xPx: 288, yPx: 162, cols: 134, rows: 37 };
    const withGeom = planPromptEnhancementLinuxTerminalLaunchV1({
      terminalCommand: 'gnome-terminal', nodePath: input.nodePath, cliEntryPath: input.cliEntryPath,
      inputFile: '/tmp/private/input.json', resultFile: '/tmp/private/result.json', readinessFile: '/tmp/private/ready', dbPath: input.dbPath,
      geometry,
    });
    expect(withGeom.args).toContain('--geometry=134x37+288+162');
    // The geometry is a gnome-terminal option, so it precedes the -- separator.
    expect(withGeom.args.indexOf('--geometry=134x37+288+162')).toBeLessThan(withGeom.args.indexOf('--'));
    // Omitting geometry falls back to the terminal's default size (no --geometry).
    const plain = planPromptEnhancementLinuxTerminalLaunchV1({
      terminalCommand: 'gnome-terminal', nodePath: input.nodePath, cliEntryPath: input.cliEntryPath,
      inputFile: '/tmp/private/input.json', resultFile: '/tmp/private/result.json', readinessFile: '/tmp/private/ready', dbPath: input.dbPath,
    });
    expect(plain.args.some((argument) => argument.startsWith('--geometry'))).toBe(false);
  });

  it('creates private files, parses a typed child result, and cleans its temp directory', async () => {
    const observed: { dir?: string; inputText?: string; inputMode?: number; dirMode?: number; plan?: unknown } = {};
    const fakeChild = child();
    const result = await runPromptEnhancementCliPopupHostLaunchV1(launchInput(), {
      spawnTerminal: async (plan) => {
        observed.plan = plan;
        const args = [...plan.args];
        const inputFile = args[args.indexOf('--input-file') + 1]!;
        observed.dir = dirname(inputFile);
        observed.inputText = readFileSync(inputFile, 'utf8');
        observed.inputMode = statSync(inputFile).mode & 0o777;
        observed.dirMode = statSync(observed.dir).mode & 0o777;
        return fakeChild;
      },
      readResultFile: () => ({ protocolVersion: 1, result: { state: 'selected_original' } }),
      readReadyFile: () => true,
    });

    expect(result).toEqual({ state: 'completed', output: { protocolVersion: 1, result: { state: 'selected_original' } } });
    expect(observed.inputMode).toBe(0o600);
    expect(observed.dirMode).toBe(0o700);
    expect(observed.inputText).toContain('RAW PE REQUEST MUST STAY OUT OF ARGV');
    expect(JSON.stringify(observed.plan)).not.toContain('RAW PE REQUEST');
    expect(fakeChild.kill).toHaveBeenCalledWith('SIGTERM');
    expect(() => statSync(observed.dir!)).toThrow();
  });

  it('returns launch_failed and cleans up when terminal spawn fails or exits non-zero', async () => {
    const cleanupTempDir = vi.fn();
    const spawnFailed = await runPromptEnhancementCliPopupHostLaunchV1(launchInput(), {
      makeTempDir: () => '/tmp/pe1-3-spawn-failed',
      writeInputFile: vi.fn(),
      spawnTerminal: async () => { throw new Error('launch failed'); },
      cleanupTempDir,
    });
    const exitFailed = await runPromptEnhancementCliPopupHostLaunchV1(launchInput(), {
      makeTempDir: () => '/tmp/pe1-3-exit-failed',
      writeInputFile: vi.fn(),
      spawnTerminal: async () => child(1),
      cleanupTempDir,
    });
    const signalFailed = await runPromptEnhancementCliPopupHostLaunchV1(launchInput(), {
      makeTempDir: () => '/tmp/pe1-3-signal-failed',
      writeInputFile: vi.fn(),
      spawnTerminal: async () => child(null, 'SIGTERM'),
      cleanupTempDir,
    });

    expect(spawnFailed).toEqual({ state: 'launch_failed', reasonCode: 'terminal_spawn_failed' });
    expect(exitFailed).toEqual({ state: 'launch_failed', reasonCode: 'terminal_exit_nonzero' });
    expect(signalFailed).toEqual({ state: 'launch_failed', reasonCode: 'terminal_exit_nonzero' });
    expect(cleanupTempDir).toHaveBeenCalledWith('/tmp/pe1-3-spawn-failed');
    expect(cleanupTempDir).toHaveBeenCalledWith('/tmp/pe1-3-exit-failed');
    expect(cleanupTempDir).toHaveBeenCalledWith('/tmp/pe1-3-signal-failed');
  });

  it('polls indefinitely with no deadline — the popup waits for the user until a result appears', async () => {
    const cleanupTempDir = vi.fn();
    const sleep = vi.fn(async () => {});
    const fakeChild = child();
    // The result is absent for the first few polls (user is still deciding),
    // then the renderer writes it. With no timeout, the host must keep polling
    // rather than cut the user off.
    let polls = 0;
    const result = await runPromptEnhancementCliPopupHostLaunchV1(launchInput(), {
      makeTempDir: () => '/tmp/pe1-3-wait',
      writeInputFile: vi.fn(),
      spawnTerminal: async () => fakeChild,
      readResultFile: () => (polls++ < 25 ? undefined : { protocolVersion: 1, result: { state: 'selected_original' } }),
      sleep,
      readReadyFile: () => true,
      cleanupTempDir,
    });

    expect(result).toEqual({ state: 'completed', output: { protocolVersion: 1, result: { state: 'selected_original' } } });
    expect(sleep).toHaveBeenCalledTimes(25);
    expect(fakeChild.kill).toHaveBeenCalledWith('SIGTERM');
    expect(cleanupTempDir).toHaveBeenCalledWith('/tmp/pe1-3-wait');
  });

  it('rejects a child result that arrives before the first-render marker', async () => {
    const rawBody = 'must-not-cross-pre-visible-boundary';
    const result = await runPromptEnhancementCliPopupHostLaunchV1(launchInput(), {
      makeTempDir: () => '/tmp/pe3-1-unready-result',
      writeInputFile: vi.fn(),
      spawnTerminal: async () => child(),
      readReadyFile: () => false,
      readResultFile: () => ({ protocolVersion: 1, result: { state: 'selected_current', bodyText: rawBody } }),
      cleanupTempDir: vi.fn(),
    });

    expect(result).toEqual({ state: 'launch_failed', reasonCode: 'terminal_renderer_not_ready' });
    expect(JSON.stringify(result)).not.toContain(rawBody);
  });

  it('fails closed when a ready child exposes a symlink result path', async () => {
    const externalDir = mkdtempSync('/tmp/nexpath-pe3-1-symlink-');
    const externalResult = `${externalDir}/external-result.json`;
    const rawBody = 'must-not-read-through-result-symlink';
    writeFileSync(externalResult, JSON.stringify({ protocolVersion: 1, result: { state: 'selected_current', bodyText: rawBody } }), 'utf8');

    try {
      // The child exits (non-zero) after planting a symlinked result path. With
      // no timeout, the host ends on that exit — and because it refuses to read
      // through the symlink, the raw body never crosses back.
      const result = await runPromptEnhancementCliPopupHostLaunchV1(launchInput(), {
        spawnTerminal: async (plan) => {
          const args = [...plan.args];
          const readinessFile = args[args.indexOf('--readiness-file') + 1]!;
          const resultFile = args[args.indexOf('--result-file') + 1]!;
          writeFileSync(readinessFile, 'ready', { mode: 0o600 });
          symlinkSync(externalResult, resultFile);
          return child(1);
        },
      });

      expect(result).toEqual({ state: 'launch_failed', reasonCode: 'terminal_exit_nonzero' });
      expect(JSON.stringify(result)).not.toContain(rawBody);
    } finally {
      rmSync(externalDir, { recursive: true, force: true });
    }
  });

  it('does not allocate files for direct-TTY or unavailable host capability', async () => {
    const makeTempDir = vi.fn();
    const direct = await runPromptEnhancementCliPopupHostLaunchV1({
      ...launchInput(),
      capability: { state: 'available', method: 'direct_tty' },
    }, { makeTempDir });
    const unavailable = await runPromptEnhancementCliPopupHostLaunchV1({
      ...launchInput(),
      capability: { state: 'unavailable', method: 'none', reasonCode: 'no_gui_session' },
    }, { makeTempDir });

    expect(direct).toEqual({ state: 'not_applicable', reasonCode: 'direct_tty' });
    expect(unavailable).toEqual({ state: 'host_unavailable', reasonCode: 'no_gui_session' });
    expect(makeTempDir).not.toHaveBeenCalled();
  });
});
