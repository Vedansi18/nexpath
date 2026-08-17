import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  PROMPT_ENHANCEMENT_LINUX_TERMINAL_COMMANDS_V1,
  buildPromptEnhancementMacLauncherScriptV1,
  buildPromptEnhancementWindowsLauncherScriptV1,
  buildPromptEnhancementWindowsPositionScriptV1,
  detectPromptEnhancementLinuxDisplayServerV1,
  planPromptEnhancementLinuxTerminalLaunchV1,
  planPromptEnhancementMacTerminalLaunchV1,
  planPromptEnhancementWindowsTerminalLaunchV1,
  resolvePromptEnhancementCliHostCapabilityV1,
  runPromptEnhancementCliPopupHostLaunchV1,
  runPromptEnhancementCliMpsContinuationHostLaunchV1,
  type PromptEnhancementLinuxTerminalCommandV1,
} from './prompt-enhancement-host.js';
import type { PromptEnhancementPrepareRequestV1, PromptEnhancementPrepareResultV1 } from '../prompt-enhancement/contracts.js';
import { computeDockedPopupGeometry } from '../decision-session/screen-geometry.js';

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

  it('P4 opt-in force-dock: NEXPATH_POPUP_DOCK + GUI session prefers a spawned window over direct-TTY', () => {
    const probeDirectTty = vi.fn(() => true); // direct-TTY IS available…
    const result = resolvePromptEnhancementCliHostCapabilityV1({
      platform: 'linux',
      env: { DISPLAY: ':0', NEXPATH_POPUP_DOCK: 'right' },
      probeDirectTty,
      commandExists: (c) => c === 'gnome-terminal',
      readCommandVersion: () => '3.52.0',
    });
    // …but force-dock chooses the spawnable terminal so the window can be right-docked.
    expect(result).toEqual({ state: 'available', method: 'linux_terminal', terminalCommand: 'gnome-terminal' });
  });

  it('P4 force-dock is fail-open: with no spawnable terminal it falls back to direct-TTY (never loses the popup)', () => {
    const result = resolvePromptEnhancementCliHostCapabilityV1({
      platform: 'linux',
      env: { DISPLAY: ':0', NEXPATH_POPUP_DOCK: 'right' },
      probeDirectTty: () => true,
      commandExists: unavailableCommands(),
    });
    expect(result).toEqual({ state: 'available', method: 'direct_tty' });
  });

  it('P4 default (NEXPATH_POPUP_DOCK unset) is UNCHANGED: direct-TTY still wins over spawning', () => {
    const commandExists = vi.fn((c: PromptEnhancementLinuxTerminalCommandV1) => c === 'gnome-terminal');
    const result = resolvePromptEnhancementCliHostCapabilityV1({
      platform: 'linux',
      env: { DISPLAY: ':0' }, // no force-dock
      probeDirectTty: () => true,
      commandExists,
    });
    expect(result).toEqual({ state: 'available', method: 'direct_tty' });
    expect(commandExists).not.toHaveBeenCalled(); // direct-TTY short-circuits before probing terminals
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

  it('always spawns a Terminal.app window on macOS (never the in-process /dev/tty)', () => {
    const commandExists = unavailableCommands();
    const probeDirectTty = vi.fn(() => true);
    const result = resolvePromptEnhancementCliHostCapabilityV1({
      platform: 'darwin',
      env: {},
      probeDirectTty, // ignored on darwin — it always spawns
      commandExists,
    });
    expect(result).toEqual({ state: 'available', method: 'mac_terminal' });
    expect(probeDirectTty).not.toHaveBeenCalled();
    expect(commandExists).not.toHaveBeenCalled();
  });

  it('always spawns a new console window on Windows (never the invisible in-process console)', () => {
    const commandExists = unavailableCommands();
    const probeDirectTty = vi.fn(() => true);
    const result = resolvePromptEnhancementCliHostCapabilityV1({
      platform: 'win32',
      env: {},
      probeDirectTty, // ignored on win32 — it always spawns
      commandExists,
    });
    expect(result).toEqual({ state: 'available', method: 'windows_terminal' });
    // Windows never probes the in-process console or the Linux terminals.
    expect(probeDirectTty).not.toHaveBeenCalled();
    expect(commandExists).not.toHaveBeenCalled();
  });

  it('Windows and macOS both spawn a window regardless of the in-process console (like the old popup)', () => {
    const commandExists = unavailableCommands();
    const mac = resolvePromptEnhancementCliHostCapabilityV1({
      platform: 'darwin', env: {}, probeDirectTty: () => false, commandExists,
    });
    expect(mac).toEqual({ state: 'available', method: 'mac_terminal' });
    const win = resolvePromptEnhancementCliHostCapabilityV1({
      platform: 'win32', env: {}, probeDirectTty: () => false, commandExists,
    });
    expect(win).toEqual({ state: 'available', method: 'windows_terminal' });
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

describe('P4 — Linux display-server detection', () => {
  it('XDG_SESSION_TYPE is authoritative (wayland / x11)', () => {
    expect(detectPromptEnhancementLinuxDisplayServerV1({ XDG_SESSION_TYPE: 'wayland', DISPLAY: ':0' })).toBe('wayland');
    expect(detectPromptEnhancementLinuxDisplayServerV1({ XDG_SESSION_TYPE: 'x11', WAYLAND_DISPLAY: 'wayland-0' })).toBe('x11');
  });
  it('falls back to WAYLAND_DISPLAY / DISPLAY when XDG_SESSION_TYPE is absent', () => {
    expect(detectPromptEnhancementLinuxDisplayServerV1({ WAYLAND_DISPLAY: 'wayland-0' })).toBe('wayland');
    expect(detectPromptEnhancementLinuxDisplayServerV1({ DISPLAY: ':0' })).toBe('x11');
  });
  it('returns unknown with no display env', () => {
    expect(detectPromptEnhancementLinuxDisplayServerV1({})).toBe('unknown');
  });
});

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
    // Right-dock (P2): a docked geometry renders flush-right (+x+0) before the -- separator.
    const docked = computeDockedPopupGeometry({ x: 0, y: 0, widthPx: 1920, heightPx: 1080 });
    const rightDock = planPromptEnhancementLinuxTerminalLaunchV1({
      terminalCommand: 'gnome-terminal',
      nodePath: '/usr/bin/node', cliEntryPath: '/x/cli.js',
      inputFile: '/x/in', resultFile: '/x/out', readinessFile: '/x/ready', dbPath: '/x/db',
      geometry: docked,
    });
    // 1920×1080 → 115 cols × 54 rows, x=768 (flush right), y=0 (top).
    expect(rightDock.args).toContain(`--geometry=${docked.cols}x${docked.rows}+${docked.xPx}+${docked.yPx}`);
    expect(rightDock.args).toContain('--geometry=115x54+768+0');
    expect(rightDock.args.indexOf('--geometry=115x54+768+0')).toBeLessThan(rightDock.args.indexOf('--'));

    // P4 Wayland: a GTK terminal with a docked geometry on Wayland is wrapped with
    // `env GDK_BACKEND=x11` so --geometry positions via XWayland (recent Ubuntu default).
    const wayland = planPromptEnhancementLinuxTerminalLaunchV1({
      terminalCommand: 'gnome-terminal',
      nodePath: '/usr/bin/node', cliEntryPath: '/x/cli.js',
      inputFile: '/x/in', resultFile: '/x/out', readinessFile: '/x/ready', dbPath: '/x/db',
      geometry: docked, displayServer: 'wayland',
    });
    expect(wayland.command).toBe('env');
    expect(wayland.args[0]).toBe('GDK_BACKEND=x11');
    expect(wayland.args[1]).toBe('gnome-terminal');
    expect(wayland.args).toContain('--geometry=115x54+768+0');
    // On X11 the wrap is NOT applied (native geometry already positions).
    const x11 = planPromptEnhancementLinuxTerminalLaunchV1({
      terminalCommand: 'gnome-terminal',
      nodePath: '/usr/bin/node', cliEntryPath: '/x/cli.js',
      inputFile: '/x/in', resultFile: '/x/out', readinessFile: '/x/ready', dbPath: '/x/db',
      geometry: docked, displayServer: 'x11',
    });
    expect(x11.command).toBe('gnome-terminal');
    // A non-GTK terminal (kitty) on Wayland is NOT wrapped (size-only by design).
    const kitty = planPromptEnhancementLinuxTerminalLaunchV1({
      terminalCommand: 'kitty',
      nodePath: '/usr/bin/node', cliEntryPath: '/x/cli.js',
      inputFile: '/x/in', resultFile: '/x/out', readinessFile: '/x/ready', dbPath: '/x/db',
      geometry: docked, displayServer: 'wayland',
    });
    expect(kitty.command).toBe('kitty');
    // Wayland but NO geometry → no wrap (nothing to position).
    const waylandNoGeom = planPromptEnhancementLinuxTerminalLaunchV1({
      terminalCommand: 'gnome-terminal',
      nodePath: '/usr/bin/node', cliEntryPath: '/x/cli.js',
      inputFile: '/x/in', resultFile: '/x/out', readinessFile: '/x/ready', dbPath: '/x/db',
      displayServer: 'wayland',
    });
    expect(waylandNoGeom.command).toBe('gnome-terminal');

    // Omitting geometry falls back to the terminal's default size (no --geometry).
    const plain = planPromptEnhancementLinuxTerminalLaunchV1({
      terminalCommand: 'gnome-terminal', nodePath: input.nodePath, cliEntryPath: input.cliEntryPath,
      inputFile: '/tmp/private/input.json', resultFile: '/tmp/private/result.json', readinessFile: '/tmp/private/ready', dbPath: input.dbPath,
    });
    expect(plain.args.some((argument) => argument.startsWith('--geometry'))).toBe(false);
  });

  it('plans a Windows new-window spawn that runs the batch via cmd /c (not start file-association)', () => {
    const plan = planPromptEnhancementWindowsTerminalLaunchV1({ launcherScriptPath: 'C:/Temp/pe/launch.cmd' });
    expect(plan.command).toBe(process.env.ComSpec ?? 'cmd.exe'); // system interpreter, not a hardcoded path
    // start runs a PROGRAM (`cmd /c <launch.cmd>`), never the .cmd directly — running the .cmd via
    // start's file-association fails with "The system cannot find the path specified." on Windows.
    expect(plan.args).toEqual(['/c', 'start', '/WAIT', 'Nexpath · Prompt enhancement', 'cmd', '/c', 'C:/Temp/pe/launch.cmd']);
  });

  it('P6 no-jump: minimized:true adds /MIN so the window never flashes at centre before docking', () => {
    const plan = planPromptEnhancementWindowsTerminalLaunchV1({ launcherScriptPath: 'C:/Temp/pe/launch.cmd', minimized: true });
    expect(plan.args).toEqual(['/c', 'start', '/MIN', '/WAIT', 'Nexpath · Prompt enhancement', 'cmd', '/c', 'C:/Temp/pe/launch.cmd']);
  });

  it('builds a Windows batch launcher with node by absolute path and every path quoted (spaces intact)', () => {
    const script = buildPromptEnhancementWindowsLauncherScriptV1({
      nodeExecPath: 'C:/Program Files/nodejs/node.exe',
      cliEntryPath: 'C:/Users/Admin/Desktop/nexpath testing/nexpath/dist/cli/index.js',
      inputFile: 'C:/Temp/pe/input.json',
      resultFile: 'C:/Temp/pe/result.json',
      readinessFile: 'C:/Temp/pe/ready',
      dbPath: 'C:/Users/Admin/.nexpath/prompt-store.db',
    });
    expect(script).toContain('@echo off');
    // node invoked by its absolute (quoted) path; the space-containing CLI path stays quoted + intact.
    expect(script).toContain('"C:/Program Files/nodejs/node.exe" "C:/Users/Admin/Desktop/nexpath testing/nexpath/dist/cli/index.js" prompt-enhancement-popup-host');
    expect(script).toContain('--input-file "C:/Temp/pe/input.json"');
    expect(script).toContain('--db "C:/Users/Admin/.nexpath/prompt-store.db"');
    // On a real error the window stays open (shows the message) instead of flashing shut.
    expect(script).toContain('if errorlevel 1 pause');
    // No geometry supplied → byte-identical to before: no sizing/positioning lines (regression guard).
    expect(script).not.toContain('mode con');
    expect(script).not.toContain('powershell');
  });

  it('right-docks the Windows console (P3): mode con sizes + position .ps1 positions, before node, fail-open', () => {
    const geometry = computeDockedPopupGeometry({ x: 0, y: 0, widthPx: 1920, heightPx: 1080 });
    const script = buildPromptEnhancementWindowsLauncherScriptV1({
      nodeExecPath: 'C:/nodejs/node.exe', cliEntryPath: 'C:/n/dist/cli/index.js',
      inputFile: 'C:/T/in', resultFile: 'C:/T/out', readinessFile: 'C:/T/ready', dbPath: 'C:/T/db',
      geometry, positionScriptPath: 'C:/T/position.ps1',
    });
    // Cell sizing via mode con (115 cols × 54 rows for FHD).
    expect(script).toContain(`mode con: cols=${geometry.cols} lines=${geometry.rows}`);
    expect(script).toContain('mode con: cols=115 lines=54');
    // Positioning via the sibling .ps1, best-effort (2>nul, no errorlevel stop).
    expect(script).toContain('powershell -NoProfile -ExecutionPolicy Bypass -File "C:/T/position.ps1" 2>nul');
    // Sizing + positioning run BEFORE node, so the wait model (start /WAIT + polling) is unchanged.
    const nodeIdx = script.indexOf('prompt-enhancement-popup-host');
    expect(script.indexOf('mode con')).toBeLessThan(nodeIdx);
    expect(script.indexOf('powershell')).toBeLessThan(nodeIdx);
  });

  it('builds a fail-open position .ps1 that resolves the real top-level window by title and SetWindowPos docks it', () => {
    const geometry = computeDockedPopupGeometry({ x: 0, y: 0, widthPx: 1920, heightPx: 1080 });
    const ps = buildPromptEnhancementWindowsPositionScriptV1(geometry);
    expect(ps).toContain('$ErrorActionPreference = "SilentlyContinue"'); // fully fail-open
    // Windows Terminal: resolve the visible window by our "Nexpath …" title, not the hidden pseudo-console.
    expect(ps).toContain("MainWindowTitle -like 'Nexpath*'");
    // Phase 2: resolve exactly this popup by picking the most-recently-started match.
    expect(ps).toContain('Sort-Object StartTime -Descending');
    expect(ps).toContain('GetConsoleWindow'); // conhost fallback
    // Dock position + size in one SetWindowPos call on the real window.
    expect(ps).toContain('SetWindowPos($h, [IntPtr]::Zero, 768, 0, 1152, 1080, 0x0040)');
  });

  it('plans a macOS Terminal.app spawn via osascript that runs the shell launcher', () => {
    const plan = planPromptEnhancementMacTerminalLaunchV1({ launcherScriptPath: '/tmp/pe/launch.sh' });
    expect(plan.command).toBe('osascript');
    expect(plan.args[0]).toBe('-e');
    const script = plan.args[1]!;
    expect(script).toContain('tell application "Terminal"');
    expect(script).toContain("sh '/tmp/pe/launch.sh'"); // launcher run via sh, quoted
    expect(script).toContain('do script');
  });

  it('right-docks the macOS Terminal.app window via AppleScript bounds (P2)', () => {
    // 1920×1080 docked → 1152×1080 @(768,0). AppleScript bounds = {x, y, x+w, y+h}.
    const docked = computeDockedPopupGeometry({ x: 0, y: 0, widthPx: 1920, heightPx: 1080 });
    const plan = planPromptEnhancementMacTerminalLaunchV1({ launcherScriptPath: '/tmp/pe/launch.sh', geometry: docked });
    const script = plan.args[1]!;
    expect(script).toContain(`set bounds of (first window whose selected tab is theTab) to {${docked.xPx}, ${docked.yPx}, ${docked.xPx + docked.widthPx}, ${docked.yPx + docked.heightPx}}`);
    expect(script).toContain('set bounds of (first window whose selected tab is theTab) to {768, 0, 1920, 1080}');
  });

  it('builds a macOS shell launcher with node by absolute path and every path single-quoted (spaces intact)', () => {
    const script = buildPromptEnhancementMacLauncherScriptV1({
      nodeExecPath: '/usr/local/bin/node',
      cliEntryPath: '/Users/admin/Desktop/nexpath testing/nexpath/dist/cli/index.js',
      inputFile: '/tmp/pe/input.json',
      resultFile: '/tmp/pe/result.json',
      readinessFile: '/tmp/pe/ready',
      dbPath: '/Users/admin/.nexpath/prompt-store.db',
    });
    expect(script.startsWith('#!/bin/sh')).toBe(true);
    expect(script).toContain("'/usr/local/bin/node' '/Users/admin/Desktop/nexpath testing/nexpath/dist/cli/index.js' prompt-enhancement-popup-host");
    expect(script).toContain("--input-file '/tmp/pe/input.json'");
    expect(script).toContain("--db '/Users/admin/.nexpath/prompt-store.db'");
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
    // POSIX file modes — Windows has no 0o600/0o700 equivalent, so assert them only off win32 (P5).
    if (process.platform !== 'win32') {
      expect(observed.inputMode).toBe(0o600);
      expect(observed.dirMode).toBe(0o700);
    }
    expect(observed.inputText).toContain('RAW PE REQUEST MUST STAY OUT OF ARGV');
    expect(JSON.stringify(observed.plan)).not.toContain('RAW PE REQUEST');
    expect(fakeChild.kill).toHaveBeenCalledWith('SIGTERM');
    expect(() => statSync(observed.dir!)).toThrow();
  });

  it('macOS: gives osascript a BOUNDED window to close the Terminal window before returning (never a hang)', async () => {
    // Live iMac report 2026-08-07: the parent killed osascript the instant the result file
    // appeared, so its AppleScript never reached the close-window step — the Terminal window
    // stayed open showing "[Process completed]" over a stale frame.
    const sleeps: number[] = [];
    const macChild = child(); // never exits -> the wait must still end after the bounded polls
    const result = await runPromptEnhancementCliPopupHostLaunchV1(
      { ...launchInput(), capability: { state: 'available' as const, method: 'mac_terminal' as const } },
      {
        spawnTerminal: async () => macChild,
        readResultFile: () => ({ protocolVersion: 1, result: { state: 'selected_original' } }),
        readReadyFile: () => true,
        sleep: async (ms: number) => { sleeps.push(ms); },
      },
    );
    expect(result.state).toBe('completed');
    expect(sleeps.filter((ms) => ms === 200)).toHaveLength(40); // bounded close-wait ran fully
    expect(macChild.kill).toHaveBeenCalledWith('SIGTERM'); // fallback kill still fires after the wait
  });

  it('macOS: returns immediately once osascript exits on its own (window already closed) — and Linux never waits', async () => {
    const sleeps: number[] = [];
    const macDone = await runPromptEnhancementCliPopupHostLaunchV1(
      { ...launchInput(), capability: { state: 'available' as const, method: 'mac_terminal' as const } },
      {
        spawnTerminal: async () => child(0), // AppleScript already closed the window and exited
        readResultFile: () => ({ protocolVersion: 1, result: { state: 'selected_original' } }),
        readReadyFile: () => true,
        sleep: async (ms: number) => { sleeps.push(ms); },
      },
    );
    expect(macDone.state).toBe('completed');
    expect(sleeps.filter((ms) => ms === 200)).toHaveLength(0);
    const linuxSleeps: number[] = [];
    const linux = await runPromptEnhancementCliPopupHostLaunchV1(launchInput(), {
      spawnTerminal: async () => child(),
      readResultFile: () => ({ protocolVersion: 1, result: { state: 'selected_original' } }),
      readReadyFile: () => true,
      sleep: async (ms: number) => { linuxSleeps.push(ms); },
    });
    expect(linux.state).toBe('completed');
    expect(linuxSleeps.filter((ms) => ms === 200)).toHaveLength(0); // Linux flow unchanged: no close-wait
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

  // symlinkSync throws EPERM on Windows without Developer Mode, so this POSIX-symlink safety case is
  // skipped there (P5); the fail-closed behaviour it guards is exercised on Linux/macOS.
  it.skipIf(process.platform === 'win32')('fails closed when a ready child exposes a symlink result path', async () => {
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

describe('MPS Phase 2 (Option D) — continuation (2nd popup) window launcher', () => {
  function continuationLaunchInput() {
    return {
      capability: { state: 'available', method: 'linux_terminal', terminalCommand: 'gnome-terminal' },
      continuation: {
        result: { currentBody: { text: 'NEXT ITEM BODY MUST STAY OUT OF ARGV' } },
        handoffMetadata: {},
        event: {},
        progress: { done: 1, total: 2 },
        itemKind: 'task',
      },
      cliEntryPath: '/opt/nexpath/dist/cli/index.js',
      dbPath: '/tmp/nexpath-test.db',
      nodePath: '/usr/bin/node',
    } as unknown as Parameters<typeof runPromptEnhancementCliMpsContinuationHostLaunchV1>[0];
  }

  it('spawns the SAME child command, keeps the payload out of argv, parses the outcome, cleans up', async () => {
    const observed: { plan?: unknown; inputText?: string } = {};
    const fakeChild = child();
    const result = await runPromptEnhancementCliMpsContinuationHostLaunchV1(continuationLaunchInput(), {
      spawnTerminal: async (plan) => {
        observed.plan = plan;
        const args = [...plan.args];
        const inputFile = args[args.indexOf('--input-file') + 1]!;
        observed.inputText = readFileSync(inputFile, 'utf8');
        return fakeChild;
      },
      readContinuationResultFile: () => ({ protocolVersion: 1, continuationOutcome: { state: 'send', bodyText: 'NEXT ITEM BODY' } }),
      readReadyFile: () => true,
    });

    expect(result).toEqual({ state: 'completed', output: { protocolVersion: 1, continuationOutcome: { state: 'send', bodyText: 'NEXT ITEM BODY' } } });
    // Option D: the SAME hidden child command as the first popup → identical cross-platform spawn path.
    expect(JSON.stringify(observed.plan)).toContain('prompt-enhancement-popup-host');
    // The continuation payload travels via the private input FILE, never argv.
    expect(observed.inputText).toContain('"continuation"');
    expect(JSON.stringify(observed.plan)).not.toContain('NEXT ITEM BODY MUST STAY OUT OF ARGV');
    expect(fakeChild.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('macOS routes through the SAME mac launcher builder — the child command is inside launch.sh', async () => {
    const observed: { plan?: string; script?: string } = {};
    const fakeChild = child(0); // exits 0 → skips the mac close-wait
    const result = await runPromptEnhancementCliMpsContinuationHostLaunchV1(
      { ...continuationLaunchInput(), capability: { state: 'available', method: 'mac_terminal' } } as unknown as Parameters<typeof runPromptEnhancementCliMpsContinuationHostLaunchV1>[0],
      {
        spawnTerminal: async (plan) => {
          observed.plan = JSON.stringify(plan);
          // On macOS the command lives inside the launch.sh the mac builder wrote; read it to prove parity.
          const applescript = String(plan.args[plan.args.length - 1] ?? '');
          const match = applescript.match(/sh '([^']+launch\.sh)'/);
          if (match) observed.script = readFileSync(match[1]!, 'utf8');
          return fakeChild;
        },
        readContinuationResultFile: () => ({ protocolVersion: 1, continuationOutcome: { state: 'declined' } }),
        readReadyFile: () => true,
        sleep: async () => { /* no real wait */ },
      },
    );
    expect(result.state).toBe('completed');
    expect(observed.plan).toContain('osascript'); // routed through the mac plan builder
    expect(observed.script).toContain('prompt-enhancement-popup-host'); // SAME child command inside launch.sh
  });

  it('Windows routes through the SAME windows launcher builder — the child command is inside launch.cmd', async () => {
    const observed: { plan?: string; script?: string } = {};
    const fakeChild = child();
    const result = await runPromptEnhancementCliMpsContinuationHostLaunchV1(
      { ...continuationLaunchInput(), capability: { state: 'available', method: 'windows_terminal' } } as unknown as Parameters<typeof runPromptEnhancementCliMpsContinuationHostLaunchV1>[0],
      {
        spawnTerminal: async (plan) => {
          observed.plan = JSON.stringify(plan);
          const cmdPath = [...plan.args].reverse().find((arg) => arg.endsWith('.cmd'));
          if (cmdPath) observed.script = readFileSync(cmdPath, 'utf8');
          return fakeChild;
        },
        readContinuationResultFile: () => ({ protocolVersion: 1, continuationOutcome: { state: 'interruption' } }),
        readReadyFile: () => true,
        detectPopupGeometry: async () => undefined,
      },
    );
    expect(result.state).toBe('completed');
    expect(observed.plan).toContain('cmd'); // routed through the windows plan builder (cmd /c start …)
    expect(observed.script).toContain('prompt-enhancement-popup-host'); // SAME child command inside launch.cmd
  });

  it('a result written before the renderer is ready is a failed launch (fail-closed)', async () => {
    const fakeChild = child();
    const result = await runPromptEnhancementCliMpsContinuationHostLaunchV1(continuationLaunchInput(), {
      spawnTerminal: async () => fakeChild,
      readContinuationResultFile: () => ({ protocolVersion: 1, continuationOutcome: { state: 'send', bodyText: 'X' } }),
      readReadyFile: () => false, // never signalled ready
    });
    expect(result).toEqual({ state: 'launch_failed', reasonCode: 'terminal_renderer_not_ready' });
  });

  it('returns not_applicable for direct_tty and host_unavailable for an unavailable capability', async () => {
    const notApplicable = await runPromptEnhancementCliMpsContinuationHostLaunchV1(
      { ...continuationLaunchInput(), capability: { state: 'available', method: 'direct_tty' } } as unknown as Parameters<typeof runPromptEnhancementCliMpsContinuationHostLaunchV1>[0],
    );
    expect(notApplicable).toEqual({ state: 'not_applicable', reasonCode: 'direct_tty' });

    const unavailable = await runPromptEnhancementCliMpsContinuationHostLaunchV1(
      { ...continuationLaunchInput(), capability: { state: 'unavailable', method: 'none', reasonCode: 'unsupported_platform' } } as unknown as Parameters<typeof runPromptEnhancementCliMpsContinuationHostLaunchV1>[0],
    );
    expect(unavailable).toEqual({ state: 'host_unavailable', reasonCode: 'unsupported_platform' });
  });
});
