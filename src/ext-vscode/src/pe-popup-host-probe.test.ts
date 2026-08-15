/**
 * pe-popup-host-probe tests (owner ruling 2026-08-11: popup-first on Windsurf).
 *
 * Three concerns, in order:
 *  1. The probe's own platform/terminal matrix, including the fail direction
 *     (uncertain ⇒ NOT capable ⇒ pePoller stays active — never a lost PE).
 *  2. DRIFT PIN against the real CLI source: the mirror cannot import
 *     `src/cli/prompt-enhancement-host.ts` (G-ROOTDIR/TS6059), so these tests
 *     READ that file as text and fail if the terminal list, the gnome version
 *     rule, or the win32/darwin always-available branches drift.
 *  3. Structural pins on `extension.ts` wiring (comments stripped): the gate
 *     exists in code, the probe runs ONCE at activation (not per poll), and
 *     the bridge dep is wired — prose can't satisfy any of these.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isPePopupHostLikelyAvailable,
  supportsBlockingGnomeTerminalMirror,
  PE_POPUP_LINUX_TERMINALS,
} from './pe-popup-host-probe.js';

const throwingHas = (): never => { throw new Error('must not be consulted'); };
const throwingVersion = (): never => { throw new Error('must not be consulted'); };

describe('isPePopupHostLikelyAvailable — platform matrix', () => {
  it('win32 → capable, without consulting env or commands (CLI always spawns a window there)', () => {
    expect(isPePopupHostLikelyAvailable({
      platform: 'win32', env: {}, hasCommand: throwingHas, readVersion: throwingVersion,
    })).toBe(true);
  });

  it('darwin → capable, without consulting env or commands (CLI always spawns Terminal.app)', () => {
    expect(isPePopupHostLikelyAvailable({
      platform: 'darwin', env: {}, hasCommand: throwingHas, readVersion: throwingVersion,
    })).toBe(true);
  });

  it('non-linux non-mac non-windows platform → NOT capable (CLI: unsupported_platform)', () => {
    expect(isPePopupHostLikelyAvailable({
      platform: 'freebsd', env: { DISPLAY: ':0' }, hasCommand: () => true,
    })).toBe(false);
  });

  it('linux without DISPLAY or WAYLAND_DISPLAY → NOT capable, commands never probed', () => {
    expect(isPePopupHostLikelyAvailable({
      platform: 'linux', env: {}, hasCommand: throwingHas,
    })).toBe(false);
  });

  it('linux GUI but no terminal on PATH → NOT capable', () => {
    expect(isPePopupHostLikelyAvailable({
      platform: 'linux', env: { DISPLAY: ':0' }, hasCommand: () => false,
    })).toBe(false);
  });

  it('linux WAYLAND-only session with one terminal → capable', () => {
    expect(isPePopupHostLikelyAvailable({
      platform: 'linux', env: { WAYLAND_DISPLAY: 'wayland-0' },
      hasCommand: (c) => c === 'kitty',
    })).toBe(true);
  });

  it('a throwing hasCommand candidate is skipped, later candidates still probed', () => {
    expect(isPePopupHostLikelyAvailable({
      platform: 'linux', env: { DISPLAY: ':0' },
      hasCommand: (c) => { if (c !== 'xterm') throw new Error('boom'); return true; },
    })).toBe(true);
  });

  it('every candidate throwing → NOT capable (fail direction: poller stays active)', () => {
    expect(isPePopupHostLikelyAvailable({
      platform: 'linux', env: { DISPLAY: ':0' }, hasCommand: throwingHas,
    })).toBe(false);
  });
});

describe('isPePopupHostLikelyAvailable — the gnome-terminal version rule', () => {
  const gnomeOnly = (readVersion: (c: string) => string | undefined) =>
    isPePopupHostLikelyAvailable({
      platform: 'linux', env: { DISPLAY: ':0' },
      hasCommand: (c) => c === 'gnome-terminal', readVersion,
    });

  it('gnome-terminal 3.35 (no --wait) is skipped → NOT capable when it is the only terminal', () => {
    expect(gnomeOnly(() => 'GNOME Terminal 3.35.2')).toBe(false);
  });

  it('gnome-terminal 3.36 → capable', () => {
    expect(gnomeOnly(() => 'GNOME Terminal 3.36.0')).toBe(true);
  });

  it('unreadable version → assumed capable (CLI: no match ⇒ true)', () => {
    expect(gnomeOnly(() => undefined)).toBe(true);
  });

  it('readVersion throwing → treated as unreadable → capable', () => {
    expect(gnomeOnly(() => { throw new Error('boom'); })).toBe(true);
  });

  it('an old gnome-terminal does not mask a later working terminal', () => {
    expect(isPePopupHostLikelyAvailable({
      platform: 'linux', env: { DISPLAY: ':0' },
      hasCommand: (c) => c === 'gnome-terminal' || c === 'xterm',
      readVersion: () => 'GNOME Terminal 3.28.1',
    })).toBe(true); // 3.28 skipped via continue → xterm still wins
  });
});

describe('DRIFT PIN — the mirror matches src/cli/prompt-enhancement-host.ts', () => {
  const cliSrc = readFileSync(
    join(__dirname, '..', '..', 'cli', 'prompt-enhancement-host.ts'),
    'utf8',
  );

  it('terminal list matches PROMPT_ENHANCEMENT_LINUX_TERMINAL_COMMANDS_V1 exactly, in order', () => {
    const m = cliSrc.match(
      /PROMPT_ENHANCEMENT_LINUX_TERMINAL_COMMANDS_V1 = \[([\s\S]*?)\]/,
    );
    expect(m).not.toBeNull();
    const cliList = [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect([...PE_POPUP_LINUX_TERMINALS]).toEqual(cliList);
  });

  it('gnome version rule matches supportsBlockingGnomeTerminal verbatim', () => {
    expect(cliSrc).toMatch(/major > 3 \|\| \(major === 3 && minor >= 36\)/);
    // And the mirror implements the same boundary:
    expect(supportsBlockingGnomeTerminalMirror('3.35.9')).toBe(false);
    expect(supportsBlockingGnomeTerminalMirror('3.36.0')).toBe(true);
    expect(supportsBlockingGnomeTerminalMirror('4.0')).toBe(true);
    expect(supportsBlockingGnomeTerminalMirror(undefined)).toBe(true);
  });

  it('CLI still treats win32 and darwin as always-available spawned windows', () => {
    expect(cliSrc).toMatch(/method: 'windows_terminal'/);
    expect(cliSrc).toMatch(/method: 'mac_terminal'/);
  });

  it('CLI linux capability: GUI session still consulted; direct_tty path exists (2026-08-15 reconciliation)', () => {
    // Reconciled 2026-08-15 (combined-branch pull): the CLI no longer HARD-requires a GUI session on
    // linux — it prefers an in-process /dev/tty render (method 'direct_tty') and keeps it as a last
    // resort even with no DISPLAY/WAYLAND_DISPLAY. The MIRROR above deliberately keeps the GUI
    // requirement: an extension-spawned CLI has no controlling terminal (the CLI's own comment: the
    // hook "may have no usable in-process /dev/tty"), so on THIS surface the only linux render path
    // is a spawned terminal window, which does need a GUI session.
    expect(cliSrc).toMatch(/env\.DISPLAY \|\| env\.WAYLAND_DISPLAY/);
    expect(cliSrc).toMatch(/method: 'direct_tty'/);
  });
});

describe('STRUCTURAL PINS — extension.ts wiring (comments stripped)', () => {
  const codeOnly = (src: string) =>
    src.split('\n').filter((l) => {
      const t = l.trimStart();
      return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
    }).join('\n');
  const flat = codeOnly(readFileSync(join(__dirname, 'extension.ts'), 'utf8'))
    .replace(/\s+/g, ' ');

  it('the pePoller read is gated on the probe result IN CODE', () => {
    expect(flat).toContain(
      'pePopupHostAvailable ? Promise.resolve(null) : readPendingPromptEnhancement(root)',
    );
  });

  it('the probe runs ONCE at activation, bound to a const — never per poll', () => {
    expect(flat).toContain('const pePopupHostAvailable = isPePopupHostLikelyAvailable()');
    const calls = flat.match(/isPePopupHostLikelyAvailable\(/g) ?? [];
    expect(calls).toHaveLength(1);
  });

  it('the advisory poller gets the PE-event bridge dep, wired to the any-status meta reader', () => {
    expect(flat).toContain('readPeEventMeta: (root) => readLatestPromptEnhancementMeta(root)');
  });
});
