/**
 * RC50 — duplicate hook-invocation guard (Bhavnesh's 2026-08-23 report §8.1).
 *
 * Cursor on Windows executes MULTIPLE registrations per submit (project-level
 * + byte-identical user-level; a stale claude-settings entry made three).
 * Every registration runs the same command — so one submit would open one
 * popup PER REGISTRATION. Cursor's payload carries a per-submit
 * `generation_id`; the first invocation claims it, later ones with the same
 * key answer `continue` immediately.
 *
 * ── RC56: ATOMIC claim ───────────────────────────────────────────────────────
 * The first cut kept a read-modify-write JSON registry — but the duplicate
 * invocations arrive 2–100 ms apart (measured on the Windows tester), and two
 * processes can both pass the read before either write lands: a coin-flip
 * race, i.e. occasional DOUBLE POPUPS exactly when everything else works.
 * The claim is now an EXCLUSIVE FILE CREATE (`wx`): the filesystem itself
 * arbitrates — exactly one process ever wins a key, no read-modify-write
 * window at all. Stale markers are pruned best-effort on each call.
 *
 * Fail-open by construction: no generation id, or any fs error other than
 * EEXIST ⇒ NOT a duplicate ⇒ exactly the un-guarded behaviour.
 */
import { writeFileSync, mkdirSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const CURSOR_INVOCATION_DIRNAME = 'cursor-hook-invocations';
export const CURSOR_INVOCATION_MAX_AGE_MS = 10 * 60_000;

export function cursorInvocationDir(projectRoot: string): string {
  return join(projectRoot, '.nexpath', CURSOR_INVOCATION_DIRNAME);
}

/** Marker filename for one (event, generationId) — fs-safe. */
export function cursorInvocationMarkerName(event: string, generationId: string): string {
  return `${event}-${generationId}`.replace(/[^A-Za-z0-9._-]/g, '_');
}

export interface CursorInvocationGuardDeps {
  now?: () => number;
  /** Exclusive create — MUST throw with code EEXIST when the file exists. */
  writeExclusiveFn?: (p: string) => void;
  mkdirFn?: (p: string) => void;
  readdirFn?: (p: string) => string[];
  /** mtime (ms) of a marker, for pruning. */
  mtimeMsFn?: (p: string) => number;
  removeFn?: (p: string) => void;
}

/**
 * True when this (event, generationId) was already CLAIMED by another
 * invocation — the caller answers `continue` and does nothing else. The first
 * caller claims atomically and gets false.
 */
export function checkAndRecordCursorInvocation(
  projectRoot: string,
  event: string,
  generationId: string | undefined,
  deps: CursorInvocationGuardDeps = {},
): boolean {
  try {
    if (!generationId) return false;
    const dir = cursorInvocationDir(projectRoot);
    const marker = join(dir, cursorInvocationMarkerName(event, generationId));
    const mkdir = deps.mkdirFn ?? ((p: string) => mkdirSync(p, { recursive: true }));
    const writeExclusive = deps.writeExclusiveFn ?? ((p: string) => writeFileSync(p, '', { flag: 'wx' }));
    try { mkdir(dir); } catch { /* exists / creatable race — the create below decides */ }
    try {
      writeExclusive(marker); // ← the atomic claim
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'EEXIST') return true; // someone else won this key
      return false; // any other fs problem: fail-open, run the flow
    }
    // Won the claim — prune stale markers best-effort (never affects the answer).
    try {
      const now = (deps.now ?? (() => Date.now()))();
      const readdir = deps.readdirFn ?? readdirSync;
      const mtimeMs = deps.mtimeMsFn ?? ((p: string) => statSync(p).mtimeMs);
      const remove = deps.removeFn ?? ((p: string) => rmSync(p, { force: true }));
      for (const name of readdir(dir)) {
        const p = join(dir, name);
        try { if (now - mtimeMs(p) > CURSOR_INVOCATION_MAX_AGE_MS) remove(p); } catch { /* best-effort */ }
      }
    } catch { /* pruning is optional */ }
    return false;
  } catch {
    return false; // fail-open — never block the primary invocation
  }
}
