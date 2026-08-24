import { describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';
import { stageCli, buildShim, CLI_ENTRY_REL, STAGE_STAMP_FILENAME, type StageDeps } from './cli-stage.js';

/** In-memory fs harness for the injected deps. */
function harness(seed: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(seed));
  const dirs = new Set<string>();
  const copied: Array<[string, string]> = [];
  const deps: StageDeps = {
    exists: (p) => files.has(p) || dirs.has(p),
    mkdirp: (p) => void dirs.add(p),
    copyDir: (s, d) => {
      copied.push([s, d]);
      dirs.add(d);
      // simulate the copied package.json now existing at the destination
      files.set(join(d, 'package.json'), files.get(join(s, 'package.json')) ?? '{}');
    },
    readFile: (p) => {
      const v = files.get(p);
      if (v === undefined) throw new Error(`ENOENT ${p}`);
      return v;
    },
    writeFile: (p, data) => void files.set(p, data),
    chmod: vi.fn(),
    platform: 'linux',
  };
  return { files, dirs, copied, deps };
}

const HOME = '/home/u/.nexpath';
const BUNDLE = '/ext/nexpath-cli';

describe('stageCli', () => {
  it('returns no-bundle when bundledCliDir is null', () => {
    const { deps } = harness();
    expect(stageCli(null, HOME, deps).status).toBe('no-bundle');
  });

  it('returns no-bundle when the bundle dir does not exist', () => {
    const { deps } = harness();
    expect(stageCli(BUNDLE, HOME, deps).status).toBe('no-bundle');
  });

  it('errors when the bundled package.json has no version', () => {
    const { deps } = harness({ [BUNDLE]: '', [join(BUNDLE, 'package.json')]: '{}' });
    const r = stageCli(BUNDLE, HOME, deps);
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/no version/);
  });

  it('stages a fresh copy + writes the shim + computes the entry path', () => {
    const { deps, copied, files } = harness({
      [BUNDLE]: '',
      [join(BUNDLE, 'package.json')]: JSON.stringify({ version: '0.1.3' }),
    });
    const r = stageCli(BUNDLE, HOME, deps);
    expect(r.status).toBe('staged');
    expect(r.version).toBe('0.1.3');
    expect(r.stagedDir).toBe(join(HOME, 'cli', '0.1.3'));
    expect(r.cliEntry).toBe(join(HOME, 'cli', '0.1.3', CLI_ENTRY_REL));
    expect(r.shimPath).toBe(join(HOME, 'bin', 'nexpath'));
    expect(copied).toEqual([[BUNDLE, join(HOME, 'cli', '0.1.3')]]);
    // shim written + executable
    expect(files.get(join(HOME, 'bin', 'nexpath'))).toContain('exec node');
  });

  it('reuses an already-current copy (no re-copy) but refreshes the shim', () => {
    const staged = join(HOME, 'cli', '0.1.3');
    const { deps, copied } = harness({
      [BUNDLE]: '',
      [join(BUNDLE, 'package.json')]: JSON.stringify({ version: '0.1.3' }),
      [join(staged, 'package.json')]: JSON.stringify({ version: '0.1.3' }),
      // RC17: "already-current" now also requires the CLI entry — a manifest
      // alone is a partial dir and must be repaired by a re-copy.
      [join(staged, CLI_ENTRY_REL)]: '// staged entry',
    });
    const r = stageCli(BUNDLE, HOME, deps);
    expect(r.status).toBe('already-current');
    expect(copied).toEqual([]); // did NOT copy again
    expect(r.cliEntry).toBe(join(staged, CLI_ENTRY_REL));
  });

  it('a new bundled version stages a new versioned dir', () => {
    const { deps } = harness({
      [BUNDLE]: '',
      [join(BUNDLE, 'package.json')]: JSON.stringify({ version: '0.1.4' }),
      [join(HOME, 'cli', '0.1.3', 'package.json')]: '{"version":"0.1.3"}',
    });
    const r = stageCli(BUNDLE, HOME, deps);
    expect(r.status).toBe('staged');
    expect(r.stagedDir).toBe(join(HOME, 'cli', '0.1.4'));
  });
});

describe('buildShim', () => {
  it('posix shim execs node against the staged entry', () => {
    const s = buildShim('/home/u/.nexpath/cli/0.1.3/dist/cli/index.js', 'linux');
    expect(s.name).toBe('nexpath');
    expect(s.body).toContain('#!/bin/sh');
    expect(s.body).toContain('exec node "/home/u/.nexpath/cli/0.1.3/dist/cli/index.js" "$@"');
  });

  it('windows shim is a .cmd that forwards args', () => {
    const s = buildShim('C:\\Users\\u\\.nexpath\\cli\\0.1.3\\dist\\cli\\index.js', 'win32');
    expect(s.name).toBe('nexpath.cmd');
    expect(s.body).toContain('node "C:\\Users\\u\\.nexpath\\cli\\0.1.3\\dist\\cli\\index.js" %*');
  });
});

/**
 * RC17 (macOS Cursor tester, 2026-08-15): a partially-created staged dir
 * (package.json present, dist/cli/index.js ABSENT — e.g. an interrupted copy)
 * wedged staging forever: every attempt returned 'already-current', so the
 * setup runner's `npm ci` succeeded and `node dist/cli/index.js` died
 * MODULE_NOT_FOUND with no self-heal. "Already staged" must be judged by the
 * CLI entry, not the manifest.
 */
describe('⭐ RC17 — partial staged dir self-heals', () => {
  const bundled = '/ext/nexpath-cli';
  const home = '/home/u/.nexpath';
  const baseDeps = () => {
    const copies: Array<[string, string]> = [];
    return {
      copies,
      deps: {
        readFile: (p: string) => p.includes('package.json') ? '{"version":"0.1.3"}' : '',
        mkdirp: () => {},
        copyDir: (s: string, d: string) => { copies.push([s, d]); },
        writeFile: () => {},
        chmod: () => {},
        platform: 'darwin' as const,
      },
    };
  };

  it('manifest present but entry missing ⇒ RE-COPIES (status staged, not already-current)', () => {
    const { copies, deps } = baseDeps();
    const res = stageCli(bundled, home, {
      ...deps,
      exists: (p: string) =>
        p === bundled
        || p.endsWith('package.json'),          // staged manifest exists…
        // …but dist/cli/index.js does NOT
    });
    expect(res.status).toBe('staged');
    expect(copies).toHaveLength(1);
  });

  it('manifest AND entry present ⇒ already-current, no copy', () => {
    const { copies, deps } = baseDeps();
    const res = stageCli(bundled, home, {
      ...deps,
      exists: () => true,
    });
    expect(res.status).toBe('already-current');
    expect(copies).toHaveLength(0);
  });
});

/**
 * RC20 (Windows/Cursor tester, 2026-08-17): staging was keyed on the CLI
 * VERSION alone, and that version stays `0.1.3` across an entire development
 * cycle — so the first vsix a machine installed owned `~/.nexpath/cli/0.1.3`
 * forever and every later extension update kept running the OLD CLI (one that
 * predated the Cursor hook writer and the submit-flow flag writer: setup
 * "succeeded" while registering nothing, so the submit flow could never arm).
 */
describe('⭐ RC20 — a stale staged CLI is re-copied (version equality ≠ identity)', () => {
  const BUNDLE = '/ext/nexpath-cli';
  const HOME = '/home/u/.nexpath';
  const STAGED = join(HOME, 'cli', '0.1.3');
  const STAMP = join(STAGED, STAGE_STAMP_FILENAME);
  const BUNDLE_ENTRY = join(BUNDLE, CLI_ENTRY_REL);

  const run = (opts: { stamp?: string | null; bundleStat?: { size: number; mtimeMs: number } | null }) => {
    const copies: Array<[string, string]> = [];
    const written = new Map<string, string>();
    const res = stageCli(BUNDLE, HOME, {
      exists: (p) => p === BUNDLE || p.endsWith('package.json') || p.endsWith(CLI_ENTRY_REL)
        || (p === STAMP && opts.stamp !== undefined && opts.stamp !== null),
      readFile: (p) => {
        if (p === STAMP) return opts.stamp ?? '';
        return '{"version":"0.1.3"}';
      },
      writeFile: (p, d) => { written.set(p, d); },
      copyDir: (s, d) => { copies.push([s, d]); },
      mkdirp: () => {},
      chmod: () => {},
      platform: 'win32',
      // NOTE: `??` would swallow an explicit null, which is the case under test.
      statFile: (p) => (p === BUNDLE_ENTRY
        ? ('bundleStat' in opts ? opts.bundleStat! : { size: 1000, mtimeMs: 5000 })
        : null),
    });
    return { res, copies, written };
  };

  it('⭐ legacy staged dir with NO stamp (the Windows machine) ⇒ re-copied + stamped', () => {
    const { res, copies, written } = run({ stamp: null });
    expect(res.status).toBe('staged');
    expect(copies).toEqual([[BUNDLE, STAGED]]);
    expect(JSON.parse(written.get(STAMP)!)).toEqual({ fingerprint: '0.1.3|1000|5000' });
  });

  it('⭐ same version but a REBUILT bundle (different fingerprint) ⇒ re-copied', () => {
    const { res, copies, written } = run({ stamp: JSON.stringify({ fingerprint: '0.1.3|999|1' }) });
    expect(res.status).toBe('staged');
    expect(copies).toHaveLength(1);
    expect(written.get(STAMP)).toContain('0.1.3|1000|5000');
  });

  it('identical bundle ⇒ already-current, no copy (no churn on every activation)', () => {
    const { res, copies } = run({ stamp: JSON.stringify({ fingerprint: '0.1.3|1000|5000' }) });
    expect(res.status).toBe('already-current');
    expect(copies).toEqual([]);
  });

  it('corrupt stamp ⇒ treated as unknown ⇒ re-copied (self-heals)', () => {
    const { res, copies } = run({ stamp: '{not json' });
    expect(res.status).toBe('staged');
    expect(copies).toHaveLength(1);
  });

  it('bundle not stattable ⇒ falls back to the RC17 existence rule (never re-copies forever)', () => {
    const { res, copies } = run({ stamp: null, bundleStat: null });
    expect(res.status).toBe('already-current');
    expect(copies).toEqual([]);
  });
});

/**
 * RC20b: RC20 made re-copies routine, so a FAILED refresh must degrade to the
 * existing copy — not to 'error', which makes offerSetupIfNeeded bail with
 * "auto-setup not offered" and disables setup entirely. (Windows: cpSync over a
 * file a running hook holds open throws EBUSY.)
 */
describe('⭐ RC20b — a failed refresh keeps serving the existing staged copy', () => {
  const boom = () => { throw new Error('EBUSY: resource busy or locked'); };

  it('copy failure + complete existing copy ⇒ already-current (setup still works)', () => {
    const res = stageCli('/ext/nexpath-cli', '/home/u/.nexpath', {
      exists: (p) => p === '/ext/nexpath-cli' || p.endsWith('package.json') || p.endsWith(CLI_ENTRY_REL),
      readFile: () => '{"version":"0.1.3"}',
      writeFile: () => {},
      copyDir: boom,
      mkdirp: () => {},
      chmod: () => {},
      statFile: () => ({ size: 10, mtimeMs: 20 }),
    });
    expect(res.status).toBe('already-current');
    expect(res.cliEntry).toContain('0.1.3');
  });

  it('copy failure + NO usable copy ⇒ still a real error (never pretend)', () => {
    const res = stageCli('/ext/nexpath-cli', '/home/u/.nexpath', {
      exists: (p) => p === '/ext/nexpath-cli' || p === join('/ext/nexpath-cli', 'package.json'),
      readFile: () => '{"version":"0.1.3"}',
      writeFile: () => {},
      copyDir: boom,
      mkdirp: () => {},
      chmod: () => {},
      statFile: () => ({ size: 10, mtimeMs: 20 }),
    });
    expect(res.status).toBe('error');
    expect(res.error).toMatch(/EBUSY/);
  });
});
