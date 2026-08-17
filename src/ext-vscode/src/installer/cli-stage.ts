import { existsSync, mkdirSync, cpSync, readFileSync, writeFileSync, chmodSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Stage the nexpath CLI that ships INSIDE the .vsix into a stable per-user
 * location, and write a stable `nexpath` launcher shim.
 *
 * Why a stable per-user copy (not run it straight from the extension dir):
 *   - `nexpath install` writes agent hooks that embed the CLI's own path
 *     (`process.argv[1]`). The extension's install dir is *versioned* and is
 *     wiped/replaced on every extension update, which would break those hooks.
 *     Copying to `~/.nexpath/cli/<version>/` gives a path that survives updates
 *     and is only replaced when the bundled CLI version actually changes.
 *   - The shim (`~/.nexpath/bin/nexpath[.cmd]`) gives the VS Code extension's
 *     existing IPC layer a `nexpath`-shaped binary to spawn (via `NEXPATH_BIN`),
 *     without changing how IPC resolves the binary.
 *
 * Pure aside from injected fs ops, so it unit-tests without a real filesystem.
 * Layer C is untouched — this only copies files + writes a shim.
 */

export type StageStatus = 'staged' | 'already-current' | 'no-bundle' | 'error';

export interface StageResult {
  status: StageStatus;
  /** ~/.nexpath/cli/<version> once known, else null. */
  stagedDir: string | null;
  /** Absolute path to the staged CLI entry (dist/cli/index.js), else null. */
  cliEntry: string | null;
  /** ~/.nexpath/bin/nexpath[.cmd] launcher shim, else null. */
  shimPath: string | null;
  version: string | null;
  error?: string;
}

export interface StageDeps {
  exists?: (p: string) => boolean;
  mkdirp?: (p: string) => void;
  copyDir?: (src: string, dest: string) => void;
  readFile?: (p: string) => string;
  writeFile?: (p: string, data: string) => void;
  chmod?: (p: string, mode: number) => void;
  platform?: NodeJS.Platform;
  /** Stat the CLI entry for the freshness fingerprint (RC20). null ⇒ unknown. */
  statFile?: (p: string) => { size: number; mtimeMs: number } | null;
}

/**
 * Stamp written inside the staged dir recording WHICH bundle produced it.
 *
 * ── RC20 (Windows tester, 2026-08-17): the staleness bug this kills ─────────
 * Staging was keyed on the CLI VERSION alone (`~/.nexpath/cli/<version>`), and
 * the CLI version legitimately stays `0.1.3` across an entire development
 * cycle. So the FIRST vsix a machine ever installed won the directory forever:
 * every later extension update reported `already-current` and kept running the
 * OLD CLI. On the tester's machine that CLI predated the Cursor hook writer and
 * the submit-flow flag writer, so setup "succeeded" while registering nothing
 * the new flow needs — the extension then re-ran setup on every activation and
 * the submit flow could never arm. Version equality is not identity: stamp the
 * bundle's fingerprint and re-copy whenever it changes.
 */
export const STAGE_STAMP_FILENAME = '.nexpath-stage.json';

function defaultStatFile(p: string): { size: number; mtimeMs: number } | null {
  try {
    const st = statSync(p);
    return { size: st.size, mtimeMs: st.mtimeMs };
  } catch {
    return null;
  }
}

/**
 * Identity of a CLI copy: version + the entry file's size and mtime. A rebuilt
 * or re-extracted bundle changes at least one of them, and comparing is cheap
 * (one stat) — no hashing of a multi-MB dist on every activation.
 */
function fingerprint(
  version: string,
  entryPath: string,
  statFile: (p: string) => { size: number; mtimeMs: number } | null,
): string | null {
  const st = statFile(entryPath);
  if (!st) return null;
  return `${version}|${st.size}|${Math.round(st.mtimeMs)}`;
}

function readVersion(dir: string, readFile: (p: string) => string): string | null {
  try {
    const pkg = JSON.parse(readFile(join(dir, 'package.json'))) as { version?: unknown };
    return typeof pkg.version === 'string' && pkg.version.length > 0 ? pkg.version : null;
  } catch {
    return null;
  }
}

/** The CLI entry, relative to a staged/bundled CLI root. */
export const CLI_ENTRY_REL = join('dist', 'cli', 'index.js');

/**
 * Build the shim source. POSIX: a tiny `sh` exec wrapper; Windows: a `.cmd`.
 * Both forward all args to `node <stagedCliEntry>`, so the extension's IPC can
 * spawn a stable `nexpath` regardless of where the staged version lives.
 */
export function buildShim(cliEntry: string, platform: NodeJS.Platform): { name: string; body: string; mode: number } {
  if (platform === 'win32') {
    return {
      name: 'nexpath.cmd',
      body: `@echo off\r\nnode "${cliEntry}" %*\r\n`,
      mode: 0o755,
    };
  }
  return {
    name: 'nexpath',
    body: `#!/bin/sh\nexec node "${cliEntry}" "$@"\n`,
    mode: 0o755,
  };
}

/**
 * Stage the bundled CLI + write the launcher shim.
 *
 * @param bundledCliDir absolute path to the CLI bundled in the .vsix
 *   (the `<extension>/nexpath-cli` dir), or null if the build did not bundle it.
 * @param nexpathHome   the user's `~/.nexpath` directory.
 */
export function stageCli(
  bundledCliDir: string | null,
  nexpathHome: string,
  deps: StageDeps = {},
): StageResult {
  const exists = deps.exists ?? existsSync;
  const mkdirp = deps.mkdirp ?? ((p) => void mkdirSync(p, { recursive: true }));
  const copyDir = deps.copyDir ?? ((s, d) => cpSync(s, d, { recursive: true }));
  const readFile = deps.readFile ?? ((p) => readFileSync(p, 'utf8'));
  const writeFile = deps.writeFile ?? ((p, data) => writeFileSync(p, data, 'utf8'));
  const chmod = deps.chmod ?? ((p, mode) => chmodSync(p, mode));
  const platform = deps.platform ?? process.platform;
  const statFile = deps.statFile ?? defaultStatFile;

  const empty: StageResult = { status: 'no-bundle', stagedDir: null, cliEntry: null, shimPath: null, version: null };

  if (!bundledCliDir || !exists(bundledCliDir)) return empty;

  const version = readVersion(bundledCliDir, readFile);
  if (!version) {
    return { ...empty, status: 'error', error: 'bundled CLI package.json has no version' };
  }

  const stagedDir = join(nexpathHome, 'cli', version);
  const cliEntry = join(stagedDir, CLI_ENTRY_REL);
  const binDir = join(nexpathHome, 'bin');
  const shim = buildShim(cliEntry, platform);
  const shimPath = join(binDir, shim.name);

  // Always (re)write the shim so it points at the current staged version even
  // when the copy itself is reused.
  const writeShim = () => {
    try {
      mkdirp(binDir);
      writeFile(shimPath, shim.body);
      chmod(shimPath, shim.mode);
    } catch {
      // Shim is a convenience for IPC binary resolution; hooks embed the real
      // path directly, so a shim write failure is non-fatal.
    }
  };

  // Reuse the staged copy ONLY when it is the SAME copy the bundle now carries.
  // RC17 (macOS Cursor tester, 2026-08-15): "already staged" must be judged by
  // the CLI ENTRY, not the manifest. A partially-created version dir (manifest
  // present, dist/ absent — e.g. an interrupted copy) previously wedged staging
  // FOREVER: every attempt returned already-current, the setup runner's
  // `npm ci` succeeded, and `node dist/cli/index.js` died MODULE_NOT_FOUND
  // with no self-heal path. Checking the entry lets the copy below repair it.
  // RC20 (Windows tester, 2026-08-17): and the entry must be the CURRENT one —
  // see STAGE_STAMP_FILENAME. When the bundle cannot be fingerprinted (stat
  // unavailable) we fall back to RC17's existence rule rather than re-copying
  // on every activation.
  const stampPath = join(stagedDir, STAGE_STAMP_FILENAME);
  const bundleFp = fingerprint(version, join(bundledCliDir, CLI_ENTRY_REL), statFile);
  const stagedFp = ((): string | null => {
    if (!exists(stampPath)) return null;
    try {
      const parsed = JSON.parse(readFile(stampPath)) as { fingerprint?: unknown };
      return typeof parsed.fingerprint === 'string' ? parsed.fingerprint : null;
    } catch {
      return null;
    }
  })();
  const complete = exists(join(stagedDir, 'package.json')) && exists(cliEntry);
  const current = bundleFp === null ? complete : complete && stagedFp === bundleFp;
  if (current) {
    writeShim();
    return { status: 'already-current', stagedDir, cliEntry, shimPath, version };
  }

  try {
    mkdirp(join(nexpathHome, 'cli'));
    copyDir(bundledCliDir, stagedDir);
    // Stamp AFTER a successful copy so a failed copy is never mistaken for a
    // fresh one on the next activation.
    if (bundleFp !== null) {
      try { writeFile(stampPath, JSON.stringify({ fingerprint: bundleFp }, null, 2)); } catch { /* best-effort */ }
    }
    writeShim();
    return { status: 'staged', stagedDir, cliEntry, shimPath, version };
  } catch (err) {
    // RC20b: a REFRESH that fails must not be worse than not refreshing. RC20
    // made re-copies routine (every extension update), and a copy can fail for
    // reasons that say nothing about the existing copy — on Windows especially,
    // `cpSync` over a file a running hook process holds open throws EBUSY.
    // Returning 'error' there would make `offerSetupIfNeeded` bail with
    // "auto-setup not offered", disabling setup entirely on a machine that has
    // a perfectly usable (if slightly older) staged CLI. Keep serving the
    // existing copy instead; the next activation retries the refresh.
    if (complete) {
      writeShim();
      return { status: 'already-current', stagedDir, cliEntry, shimPath, version };
    }
    return { ...empty, status: 'error', version, error: (err as Error).message };
  }
}
