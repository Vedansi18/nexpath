import { describe, expect, it, vi } from 'vitest';
import {
  PROMPT_ENHANCEMENT_LINUX_TERMINAL_COMMANDS_V1,
  resolvePromptEnhancementCliHostCapabilityV1,
  type PromptEnhancementLinuxTerminalCommandV1,
} from './prompt-enhancement-host.js';

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

  it('fails closed on an unsupported platform without probing host resources', () => {
    const probeDirectTty = vi.fn(() => true);
    const commandExists = unavailableCommands();
    const result = resolvePromptEnhancementCliHostCapabilityV1({
      platform: 'win32',
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

  it('returns no_supported_terminal when probes fail or no known command is available', () => {
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
