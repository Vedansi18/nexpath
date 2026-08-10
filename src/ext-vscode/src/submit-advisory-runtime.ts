/**
 * Extension-side runtime for the submit-time advisory (hook milestone H3, Gap 2).
 *
 * Two small pieces the wiring in `extension.ts` needs, kept here rather than
 * inline so both are unit-testable without an extension host.
 *
 * ── THE SWITCH ───────────────────────────────────────────────────────────────
 * This is the extension-side twin of the CLI's
 * `isWindsurfPromptSubmitAdvisoryEnabled` (`src/cli/commands/windsurf-hook.ts`).
 * It is duplicated ON PURPOSE rather than imported: `src/ext-vscode` is a separate
 * npm package and cannot import from `src/cli` — the same `rootDir`/`TS6059` wall
 * the PE milestone hit six times (see `G-ROOTDIR`). The duplication is a single
 * literal plus an exact-equality read, and `submit-advisory-runtime.test.ts` pins
 * the env-var NAME so the two halves can never silently diverge.
 *
 * Read semantics match the CLI exactly: enabled only for the literal `'1'`.
 * Unset, `'0'`, `'true'` — anything else — leaves today's behaviour untouched.
 *
 * ── THE STORE READ ───────────────────────────────────────────────────────────
 * The hook persists a decision, blocks the prompt, and exits; the extension picks
 * the decision up. The handoff is a small JSON file per project root rather than a
 * SQLite table because the extension must read it from a *different process* that
 * has already exited, and a plain file needs no schema migration in a phase that
 * may yet be reshaped.
 *
 * Every failure resolves to `null` — missing file, unreadable file, malformed
 * JSON, or a record that fails validation. `null` means "nothing pending", which
 * is the fail-open outcome (`A3`): the user simply keeps whatever the hook left.
 */
import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
  parseSubmitDecisionJsonV1,
  type SubmitDecisionRecordV1,
} from './submit-decision-record.js';

/** Must stay byte-identical to the CLI's constant — pinned by test. */
export const WINDSURF_SUBMIT_ADVISORY_ENV = 'NEXPATH_WINDSURF_PROMPTSUBMIT_ADVISORY';

/** True only for the exact string `'1'`. Default OFF — never a loose truthy read. */
export function isWindsurfSubmitAdvisoryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[WINDSURF_SUBMIT_ADVISORY_ENV] === '1';
}

/** Where the hook parks a decision for a given project root. */
export function submitDecisionPath(projectRoot: string): string {
  return join(projectRoot, '.nexpath', 'submit-decision.json');
}

export interface SubmitDecisionReaderDeps {
  /** Injected for tests; defaults to the real fs read. */
  read?: (path: string) => Promise<string>;
  /** Injected for tests; defaults to the real fs unlink. */
  remove?: (path: string) => Promise<void>;
  /** Injected for tests; defaults to a real `kill(pid, 0)` liveness probe. */
  isProcessAlive?: (pid: number) => boolean;
}

/**
 * Read (and consume) the pending decision for a root.
 *
 * **Consumed on read, deliberately.** The record is a one-shot handoff: leaving it
 * in place would let a later turn re-deliver a decision the user already saw. The
 * poller has its own `decisionId` dedup and a stale-turn guard, but deleting here
 * means a *restarted* extension cannot replay an old decision either — the guards
 * are per-process and would not catch that.
 *
 * Deletion failure is ignored: the record was already parsed successfully, and the
 * poller's guards still prevent a duplicate delivery within this process. Failing
 * the read because cleanup failed would lose a valid decision for no benefit.
 */
/**
 * Is a pid still running? Cross-OS: `kill(pid, 0)` sends no signal and is
 * supported on Linux, macOS and Windows. `EPERM` means the process EXISTS but is
 * not ours, so it counts as alive; only `ESRCH` (no such process) means gone.
 * Any unexpected error is treated as ALIVE, which defers rather than risking the
 * double-prompt — the conservative direction.
 */
export function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException)?.code !== 'ESRCH';
  }
}

export async function readPendingSubmitDecision(
  projectRoot: string,
  deps: SubmitDecisionReaderDeps = {},
): Promise<SubmitDecisionRecordV1 | null> {
  const path = submitDecisionPath(projectRoot);
  const read = deps.read ?? ((p: string) => readFile(p, 'utf8'));
  const remove = deps.remove ?? ((p: string) => unlink(p));
  const isAlive = deps.isProcessAlive ?? defaultIsProcessAlive;

  let text: string;
  try {
    text = await read(path);
  } catch {
    return null; // absent is the overwhelmingly common case, and not an error
  }

  const record = parseSubmitDecisionJsonV1(text);
  if (!record) return null; // malformed / wrong version / half-written

  // Only Windsurf decisions may be delivered here. A Cursor record reaching this
  // reader would mean a wiring mistake; delivering it would inject into the wrong
  // host, so it is dropped rather than trusted.
  if (record.host !== 'windsurf') return null;

  // ── BLOCK/INJECTION RACE GUARD ────────────────────────────────────────────
  // The hook persists this record BEFORE `exit(2)`, and Windsurf only cancels
  // the prompt once the process actually exits. Injecting inside that window
  // would submit the replacement while the ORIGINAL prompt is still live — two
  // prompts for one submission.
  //
  // Process liveness is the signal: hook alive ⇒ exit code not yet delivered.
  // The check sits BEFORE `remove` deliberately — this reader is one-shot, so
  // consuming and then deferring would destroy the decision permanently. A
  // deferred record stays on disk and is retried on the next poll.
  if (isAlive(record.hookPid)) return null;

  try {
    await remove(path);
  } catch {
    // ignored on purpose — see the note above
  }
  return record;
}
