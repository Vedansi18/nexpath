/**
 * RC57 (Windows/Devin 2026-08-24): `spawn EINVAL` on every windsurf-hook
 * decider run — Node ≥18.20/20.12 (CVE-2024-27980) REFUSES to spawn a
 * `.bat`/`.cmd` file without a shell, and both `nexpathCmd()` resolvers
 * prefer `$NEXPATH_BIN`, which setup points at the `nexpath.cmd` shim on
 * Windows. Devin hands its FULL environment to hook subprocesses, so the
 * shim reached the hook and every stop spawn died before starting; Cursor
 * sanitizes its hook env, which is why the same machine's Cursor flow worked
 * minutes earlier (its decider fell through to self-reinvocation).
 *
 * The safe equivalent is not "spawn the shim via cmd.exe" (argument-quoting
 * hazards, the exact CVE surface) — it is to IGNORE the batch shim and
 * re-invoke `process.execPath` + this CLI script, which is byte-for-byte the
 * same CLI the shim wraps and is already running this very process.
 */
export function isWindowsBatchShim(
  path: string | undefined,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform !== 'win32' || !path) return false;
  const p = path.trim().toLowerCase();
  return p.endsWith('.cmd') || p.endsWith('.bat');
}
