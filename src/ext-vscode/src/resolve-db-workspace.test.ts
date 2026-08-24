import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, symlinkSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveWorkspaceFromDbPath,
  _resetResolveDbWorkspaceCache,
  canonicalizeCwd,
} from './resolve-db-workspace.js';

describe('canonicalizeCwd', () => {
  it('resolves a symlinked path to its real path (the /tmp→/private/tmp class of mac bug)', (ctx) => {
    const real = mkdtempSync(join(realpathSync(tmpdir()), 'nexpath-canon-real-'));
    const link = real + '-link';
    try {
      try {
        symlinkSync(real, link, 'dir');
      } catch (err) {
        // Windows refuses symlink creation unless Developer Mode is on or the
        // process is elevated (EPERM/EACCES). That is an OS policy, not a
        // defect in canonicalizeCwd — skip so the suite reports the truth
        // instead of a failure the code cannot fix. Everywhere symlinks can be
        // created, this still asserts in full.
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'EPERM' || code === 'EACCES') {
          ctx.skip();
          return;
        }
        throw err;
      }
      // auto records project_root = realpath(cwd); stop must look up the same.
      expect(canonicalizeCwd(link)).toBe(realpathSync(link));
      expect(canonicalizeCwd(link)).toBe(real);
    } finally {
      try { rmSync(link); } catch { /* ignore */ }
      rmSync(real, { recursive: true, force: true });
    }
  });

  it('is idempotent on an already-canonical path', () => {
    const real = mkdtempSync(join(realpathSync(tmpdir()), 'nexpath-canon-idem-'));
    try {
      expect(canonicalizeCwd(real)).toBe(real);
    } finally {
      rmSync(real, { recursive: true, force: true });
    }
  });

  it('falls back to the input string when the path does not exist', () => {
    const missing = join(tmpdir(), 'nexpath-canon-does-not-exist-zzz');
    expect(canonicalizeCwd(missing)).toBe(missing);
  });
});

/**
 * Unit coverage for the R4.3 multi-workspace defect fix. The watcher pipeline
 * relies on this helper to map a `state.vscdb` path → the actual workspace
 * folder fsPath, so prompts captured cross-workspace land in `prompt-store.db`
 * with the correct `project_root`.
 */

const makeFs = (entries: Record<string, string | Error>) => ({
  readFileSync: (p: string, _enc: 'utf8'): string => {
    const v = entries[p];
    if (v === undefined) {
      const err = new Error('ENOENT') as Error & { code?: string };
      err.code = 'ENOENT';
      throw err;
    }
    if (v instanceof Error) throw v;
    return v;
  },
});

/**
 * The path the source will actually look up for a given `state.vscdb`:
 * `join(dirname(dbPath), 'workspace.json')`. Building the fake-fs key the same
 * way keeps it matching on Windows, where `join` yields backslashes and a
 * hard-coded POSIX key silently missed — making the negative-path tests pass
 * for the wrong reason and the positive ones fail.
 */
const workspaceJsonKey = (dbPath: string): string =>
  join(dirname(dbPath), 'workspace.json');

/**
 * A `folder` URI that Node can convert on THIS platform.
 *
 * `fileURLToPath` REJECTS a non-drive path on Windows — `file:///home/u` throws
 * "File URL path must be absolute" — and the source correctly turns that throw
 * into `null`. A POSIX-only fixture therefore stops testing the parse on
 * Windows and starts testing the error path instead. Real Windows
 * `workspace.json` always carries a drive letter, so adding one keeps the
 * fixture faithful to production rather than papering over the difference.
 *
 * This is one of the few places a platform branch is warranted: the URI *form*
 * must differ, so no amount of separator normalisation would do.
 */
const folderUri = (posixPath: string): string =>
  process.platform === 'win32' ? `file:///C:${posixPath}` : `file://${posixPath}`;

/** The fsPath the source will return for `folderUri(p)` on this platform. */
const expectedFsPath = (posixPath: string): string =>
  fileURLToPath(folderUri(posixPath));

describe('resolveWorkspaceFromDbPath', () => {
  beforeEach(() => {
    _resetResolveDbWorkspaceCache();
  });

  it('returns the fs path for a normal Cursor workspace.json (folder URI)', () => {
    const dbPath = join('/ws-storage', 'abc', 'state.vscdb');
    const fs = makeFs({
      [workspaceJsonKey(dbPath)]: JSON.stringify({
        folder: folderUri('/home/u/repos/myproj'),
      }),
    });
    const got = resolveWorkspaceFromDbPath(dbPath, { fs });
    expect(got).toBe(expectedFsPath('/home/u/repos/myproj'));
  });

  it('returns null when workspace.json is missing (empty-window storage entry)', () => {
    const fs = makeFs({});
    const got = resolveWorkspaceFromDbPath(
      '/ws-storage/xyz/state.vscdb',
      { fs },
    );
    expect(got).toBeNull();
  });

  it('returns null when workspace.json is unparseable JSON', () => {
    const fs = makeFs({
      '/ws-storage/abc/workspace.json': 'not-json-at-all',
    });
    const got = resolveWorkspaceFromDbPath(
      '/ws-storage/abc/state.vscdb',
      { fs },
    );
    expect(got).toBeNull();
  });

  it('returns null for multi-root .code-workspace entries (configuration, not folder)', () => {
    const fs = makeFs({
      '/ws-storage/abc/workspace.json': JSON.stringify({
        configuration: 'file:///home/u/my.code-workspace',
      }),
    });
    const got = resolveWorkspaceFromDbPath(
      '/ws-storage/abc/state.vscdb',
      { fs },
    );
    expect(got).toBeNull();
  });

  it('returns null when folder is not a file:// URI (defensive)', () => {
    const fs = makeFs({
      '/ws-storage/abc/workspace.json': JSON.stringify({
        folder: 'http://example.com/remote-fs',
      }),
    });
    const got = resolveWorkspaceFromDbPath(
      '/ws-storage/abc/state.vscdb',
      { fs },
    );
    expect(got).toBeNull();
  });

  it('caches results by directory — repeated lookups read fs only once', () => {
    let reads = 0;
    const dbPath = join('/ws-storage', 'abc', 'state.vscdb');
    const key = workspaceJsonKey(dbPath);
    const fs = {
      readFileSync: (p: string, _enc: 'utf8'): string => {
        reads += 1;
        if (p === key) {
          return JSON.stringify({ folder: folderUri('/home/u/a') });
        }
        throw new Error('unexpected path: ' + p);
      },
    };
    const a = resolveWorkspaceFromDbPath(dbPath, { fs });
    const b = resolveWorkspaceFromDbPath(dbPath, { fs });
    expect(a).toBe(expectedFsPath('/home/u/a'));
    expect(b).toBe(expectedFsPath('/home/u/a'));
    expect(reads).toBe(1);
  });

  it('caches negative results too — missing workspace.json is not re-probed', () => {
    let reads = 0;
    const fs = {
      readFileSync: (_p: string, _enc: 'utf8'): string => {
        reads += 1;
        throw new Error('ENOENT');
      },
    };
    expect(
      resolveWorkspaceFromDbPath('/ws-storage/empty/state.vscdb', { fs }),
    ).toBeNull();
    expect(
      resolveWorkspaceFromDbPath('/ws-storage/empty/state.vscdb', { fs }),
    ).toBeNull();
    expect(reads).toBe(1);
  });
});
