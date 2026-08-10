import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cursorAdapter, cursorConfigDir, type PlatformOverride } from './cursor.js';
import type { InstallContext } from '../types.js';

// Passes through to the real implementation for every other test in this
// file — only wrapped so a single test below can assert the exact path
// string the adapter builds, without depending on real fs semantics for a
// win32-shaped (backslash) path that isn't a real path on this host.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, existsSync: vi.fn(actual.existsSync) };
});

// Fixed at 'linux' (not process.platform) so these ctx-driven tests exercise
// the same POSIX fixture shape (mkdirSync(join(tmp, '.config', 'Cursor')))
// regardless of which OS actually runs the suite. Before ctx.platform existed,
// detect()/chatHistoryPaths() always fell back to the real host platform, so
// on a real Windows machine they built an APPDATA-shaped path that could never
// match a fixture directory created at `<tmp>/.config/Cursor`.
const makeCtx = (home: string): InstallContext & PlatformOverride => ({
  home,
  cwd: join(home, 'cwd'),
  yes: true,
  dbPath: ':memory:',
  platform: 'linux',
});

describe('cursorConfigDir', () => {
  it('returns the linux path under ~/.config/Cursor', () => {
    expect(cursorConfigDir('/home/u', 'linux')).toBe('/home/u/.config/Cursor');
  });

  it('returns the darwin path under Application Support', () => {
    expect(cursorConfigDir('/Users/u', 'darwin')).toBe(
      '/Users/u/Library/Application Support/Cursor',
    );
  });

  it('returns the win32 path under APPDATA when provided', () => {
    // All-backslash: this is what path.win32.join actually produces. The
    // previous expected value ended in a forward slash before "Cursor" —
    // correct only by accident, because the source used to build every case
    // with the host's native join(), so this "win32" case was really being
    // exercised in whatever separator the CI machine's OS used.
    expect(
      cursorConfigDir('C:\\Users\\u', 'win32', 'C:\\Users\\u\\AppData\\Roaming'),
    ).toBe('C:\\Users\\u\\AppData\\Roaming\\Cursor');
  });

  it('falls back to <home>/AppData/Roaming on win32 when APPDATA missing', () => {
    expect(cursorConfigDir('C:/U', 'win32')).toContain('Cursor');
  });

  it('ignores the real process.platform and honours the explicit argument on any host', () => {
    // The whole point of the platform parameter: these three must agree with
    // each other regardless of which OS is actually running this test.
    expect(cursorConfigDir('/home/u', 'linux')).toBe('/home/u/.config/Cursor');
    expect(cursorConfigDir('/Users/u', 'darwin')).toBe('/Users/u/Library/Application Support/Cursor');
    expect(cursorConfigDir('C:\\Users\\u', 'win32', 'C:\\Users\\u\\AppData\\Roaming'))
      .toBe('C:\\Users\\u\\AppData\\Roaming\\Cursor');
  });
});

describe('cursorAdapter — static fields', () => {
  it('has the expected id, label, category', () => {
    expect(cursorAdapter.id).toBe('cursor');
    expect(cursorAdapter.label).toBe('Cursor');
    expect(cursorAdapter.category).toBe('vscode-extension');
  });

  it('declares Open VSX + VS Code Marketplace ids', () => {
    expect(cursorAdapter.marketplace.openVsx).toBe('nexpath.nexpath-vscode');
    expect(cursorAdapter.marketplace.vsCode).toBe('nexpath.nexpath-vscode');
  });
});

describe('cursorAdapter.detect', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cursor-detect-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns false when ~/.config/Cursor/ does not exist', () => {
    expect(cursorAdapter.detect(makeCtx(tmp))).toBe(false);
  });

  it('returns true when ~/.config/Cursor/ does exist (linux fixture)', () => {
    mkdirSync(join(tmp, '.config', 'Cursor'), { recursive: true });
    expect(cursorAdapter.detect(makeCtx(tmp))).toBe(true);
  });
});

describe('cursorAdapter.chatHistoryPaths', () => {
  it('returns the workspaceStorage base path under the Cursor config dir', () => {
    const paths = cursorAdapter.chatHistoryPaths(makeCtx('/home/u'));
    expect(paths).toHaveLength(1);
    expect(paths[0]).toContain('Cursor');
    expect(paths[0]).toContain('User/workspaceStorage');
  });

  it('joins with backslashes on win32 ctx, proving the adapter forwards platform/appdata (not just cursorConfigDir in isolation)', () => {
    const ctx = {
      ...makeCtx('C:\\Users\\u'),
      platform: 'win32' as const,
      appdata: 'C:\\Users\\u\\AppData\\Roaming',
    };
    const paths = cursorAdapter.chatHistoryPaths(ctx);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toBe('C:\\Users\\u\\AppData\\Roaming\\Cursor\\User\\workspaceStorage');
  });
});

describe('cursorAdapter.detect on win32 ctx', () => {
  // win32Path.join always returns a backslash-separated string, even on a
  // POSIX host — that string is never a real filesystem path on this
  // machine, so this proves platform/appdata forwarding via the exact
  // argument passed to existsSync rather than via real fs side effects.
  it('checks a backslash-joined win32 path, proving detect() forwards platform/appdata', () => {
    const mocked = vi.mocked(existsSync);
    mocked.mockClear();
    const ctx = {
      ...makeCtx('C:\\Users\\u'),
      platform: 'win32' as const,
      appdata: 'C:\\Users\\u\\AppData\\Roaming',
    };
    cursorAdapter.detect(ctx);
    expect(mocked).toHaveBeenCalledWith('C:\\Users\\u\\AppData\\Roaming\\Cursor');
  });
});

describe('cursorAdapter.extractPrompt', () => {
  it('returns null (decoding happens in the extension, not the CLI adapter)', () => {
    expect(cursorAdapter.extractPrompt('any.key', { anything: true })).toBeNull();
    expect(cursorAdapter.extractPrompt('aiService.prompts', '[]')).toBeNull();
  });
});

describe('cursorAdapter.install', () => {
  let tmp: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cursor-install-'));
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    logSpy.mockRestore();
  });

  it('skips when Cursor is not detected and returns status=skipped', async () => {
    const r = await cursorAdapter.install(makeCtx(tmp));
    expect(r.status).toBe('skipped');
    const allLogs = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(allLogs).toContain('not detected');
  });

  it('prints deep-link instructions when Cursor IS detected', async () => {
    mkdirSync(join(tmp, '.config', 'Cursor'), { recursive: true });
    const r = await cursorAdapter.install(makeCtx(tmp));
    expect(r.status).toBe('installed');
    const allLogs = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(allLogs).toContain('Open VSX');
    expect(allLogs).toContain('open-vsx.org');
    expect(allLogs).toContain('marketplace.visualstudio.com');
    expect(allLogs).toContain('cursor --install-extension');
    expect(allLogs).toContain('nexpath.nexpath-vscode');
  });

  it('suppresses the marketplace deep-links when NEXPATH_EXT_SETUP is set (extension-driven)', async () => {
    mkdirSync(join(tmp, '.config', 'Cursor'), { recursive: true });
    const prev = process.env.NEXPATH_EXT_SETUP;
    process.env.NEXPATH_EXT_SETUP = '1';
    try {
      const r = await cursorAdapter.install(makeCtx(tmp));
      expect(r.status).toBe('installed');
      const allLogs = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(allLogs).not.toContain('Open VSX');
      expect(allLogs).not.toContain('open-vsx.org');
      expect(allLogs).not.toContain('cursor --install-extension');
      expect(allLogs).toContain('ready');
    } finally {
      if (prev === undefined) delete process.env.NEXPATH_EXT_SETUP;
      else process.env.NEXPATH_EXT_SETUP = prev;
    }
  });
});

describe('cursorAdapter.uninstall', () => {
  let tmp: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cursor-uninstall-'));
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    logSpy.mockRestore();
  });

  it('logs the skip line when Cursor is not detected', async () => {
    await cursorAdapter.uninstall(makeCtx(tmp));
    const allLogs = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(allLogs).toContain('not detected');
  });

  it('logs the uninstall instructions when Cursor IS detected', async () => {
    mkdirSync(join(tmp, '.config', 'Cursor'), { recursive: true });
    await cursorAdapter.uninstall(makeCtx(tmp));
    const allLogs = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(allLogs).toContain('uninstall');
    expect(allLogs).toContain('cursor --uninstall-extension');
  });
});

describe('cursorAdapter registry registration', () => {
  it('is registered with the global registry under id "cursor"', async () => {
    // Importing the side-effect entry registers all adapters
    await import('../index.js');
    const { getAdapter } = await import('../registry.js');
    expect(getAdapter('cursor')).toBe(cursorAdapter);
  });
});

describe('⭐ H5 — the submit hook is actually WIRED into install/uninstall', () => {
  // The gap this closes: writeCursorHooks existed with 17 passing tests but was
  // never called, so `nexpath install` would never create .cursor/hooks.json and
  // the hook could never fire. Correct and tested in isolation, dead in
  // production - the same class of defect as the clipboard-as-primary bug in H4.
  const realArgv1 = process.argv[1];

  // Mirrors the fixture the existing detect tests use: detect() checks the
  // PLATFORM config dir (~/.config/Cursor on posix), not ~/.cursor.
  function ctxIn(home: string) {
    return { home, cwd: home, dryRun: false, platform: 'linux' } as never;
  }

  it('install writes the hook to the USER-level path', async () => {
    const home = mkdtempSync(join(tmpdir(), 'nexpath-cur-adapter-'));
    try {
      mkdirSync(join(home, '.config', 'Cursor'), { recursive: true }); // detect() fixture
      process.argv[1] = '/opt/nexpath/dist/cli/index.js';
      await cursorAdapter.install(ctxIn(home));
      const file = join(home, '.cursor', 'hooks.json');
      expect(existsSync(file)).toBe(true);
      const hooks = JSON.parse(readFileSync(file, 'utf8')).hooks as Record<string, Array<{ command: string }>>;
      expect(hooks.beforeSubmitPrompt[0].command).toContain('cursor-hook');
    } finally {
      process.argv[1] = realArgv1;
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('install is idempotent — running twice does not duplicate', async () => {
    const home = mkdtempSync(join(tmpdir(), 'nexpath-cur-adapter-'));
    try {
      mkdirSync(join(home, '.config', 'Cursor'), { recursive: true });
      process.argv[1] = '/opt/nexpath/dist/cli/index.js';
      await cursorAdapter.install(ctxIn(home));
      await cursorAdapter.install(ctxIn(home));
      const hooks = JSON.parse(readFileSync(join(home, '.cursor', 'hooks.json'), 'utf8')).hooks as Record<string, unknown[]>;
      expect(hooks.beforeSubmitPrompt).toHaveLength(1);
    } finally {
      process.argv[1] = realArgv1;
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('uninstall removes it again — symmetric', async () => {
    // Leaving the hook behind would keep invoking a CLI the user just removed.
    const home = mkdtempSync(join(tmpdir(), 'nexpath-cur-adapter-'));
    try {
      mkdirSync(join(home, '.config', 'Cursor'), { recursive: true });
      process.argv[1] = '/opt/nexpath/dist/cli/index.js';
      await cursorAdapter.install(ctxIn(home));
      await cursorAdapter.uninstall(ctxIn(home));
      const hooks = JSON.parse(readFileSync(join(home, '.cursor', 'hooks.json'), 'utf8')).hooks as Record<string, unknown>;
      expect(hooks.beforeSubmitPrompt).toBeUndefined();
    } finally {
      process.argv[1] = realArgv1;
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('writes ONLY the user-level path — never the enterprise one', async () => {
    // /etc/cursor/hooks.json needs root and is not ours to touch.
    const home = mkdtempSync(join(tmpdir(), 'nexpath-cur-adapter-'));
    try {
      mkdirSync(join(home, '.config', 'Cursor'), { recursive: true });
      process.argv[1] = '/opt/nexpath/dist/cli/index.js';
      await cursorAdapter.install(ctxIn(home));
      expect(existsSync(join(home, 'etc', 'cursor', 'hooks.json'))).toBe(false);
    } finally {
      process.argv[1] = realArgv1;
      rmSync(home, { recursive: true, force: true });
    }
  });
});
