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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  parseSubmitDecisionJsonV1,
  type SubmitDecisionRecordV1,
} from './submit-decision-record.js';

/** Must stay byte-identical to the CLI's constant — pinned by test. */
export const WINDSURF_SUBMIT_ADVISORY_ENV = 'NEXPATH_WINDSURF_PROMPTSUBMIT_ADVISORY';

/**
 * The config-backed submit-flow flag (owner ruling 2026-08-12) — the shipped,
 * developer-controlled switch. MIRROR of the CLI's `submit-flow-config.ts`:
 * `~/.nexpath/submit-flow.json` = `{ "cursor": bool, "windsurf": bool }`. Env var
 * (below) overrides it. Cannot import the CLI resolver (separate package,
 * G-ROOTDIR), so the filename + shape are duplicated and pinned by a contract
 * test. Kept out of the nexpath config table on purpose so it never appears in
 * `nexpath status`/`config` — invisible to end users by construction.
 */
export const SUBMIT_FLOW_FLAG_FILENAME = 'submit-flow.json';

/**
 * Read the shipped flag file. EXPORTED so tests can (a) pin its semantics and
 * (b) inject a stub into the switch resolvers below — without the stub, the
 * suite's result depends on whatever `~/.nexpath/submit-flow.json` happens to
 * be on the developer's machine (found live 2026-08-13: the whole env-semantics
 * describe failed on any machine where the shipped flag was ON).
 */
export function readSubmitFlowFlag(host: 'cursor' | 'windsurf'): boolean {
  try {
    const raw = readFileSync(join(homedir(), '.nexpath', SUBMIT_FLOW_FLAG_FILENAME), 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed[host] === true;
  } catch {
    return false; // absent / unreadable / garbage ⇒ old flow (safe default)
  }
}

/** How the resolvers consult the flag file; injectable for hermetic tests. */
export type ReadSubmitFlowFlagFn = (host: 'cursor' | 'windsurf') => boolean;

/**
 * Windsurf submit-flow ON? Env var (`'1'`/`'0'`) is the developer override and
 * wins; otherwise the shipped `~/.nexpath/submit-flow.json` flag decides;
 * otherwise OFF (old flow byte-identical). Mirrors the CLI resolver.
 */
export function isWindsurfSubmitAdvisoryEnabled(
  env: NodeJS.ProcessEnv = process.env,
  readFlag: ReadSubmitFlowFlagFn = readSubmitFlowFlag,
): boolean {
  const v = env[WINDSURF_SUBMIT_ADVISORY_ENV];
  if (v === '1') return true;
  if (v === '0') return false;
  return readFlag('windsurf');
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
  /** Which host's records to accept. Defaults to `'windsurf'` (H3 behaviour). */
  expectedHost?: 'windsurf' | 'cursor';
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

/**
 * Cursor's switch — the extension-side mirror of the CLI's
 * `NEXPATH_CURSOR_PROMPTSUBMIT_ADVISORY`.
 *
 * Duplicated from the CLI for the same reason as the Windsurf one: `src/cli` and
 * `src/ext-vscode` are separate packages that cannot import each other. Pinned by
 * test so the two halves cannot silently diverge. Independent of Windsurf's
 * switch — the platforms must be enablable separately.
 */
export const CURSOR_SUBMIT_ADVISORY_ENV = 'NEXPATH_CURSOR_PROMPTSUBMIT_ADVISORY';

/**
 * Cursor submit-flow ON? Same resolution as Windsurf: env override (`'1'`/`'0'`)
 * wins, else the shipped `~/.nexpath/submit-flow.json` flag, else OFF.
 */
export function isCursorSubmitAdvisoryEnabled(
  env: NodeJS.ProcessEnv = process.env,
  readFlag: ReadSubmitFlowFlagFn = readSubmitFlowFlag,
): boolean {
  const v = env[CURSOR_SUBMIT_ADVISORY_ENV];
  if (v === '1') return true;
  if (v === '0') return false;
  return readFlag('cursor');
}

/**
 * Non-consuming PEEK at the pending submit decision (H8, `G-ARBITRATION`
 * Finding 1).
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * The hook's VED-PE-10 guard writes the replacement into
 * `session_states.lastInjectedPrompt` so `auto` skips the injected turn. On
 * Windsurf that SAME field is also the DS advisory-poller's delivery-bridge
 * signal (`advisory-poller.ts` — "bridge the popup selection"), so the DS
 * poller would inject the replacement a SECOND time alongside the submit
 * poller's own delivery. The DS poller's guard needs to ask "is this text a
 * submit-flow replacement?" — and it may ask BEFORE the submit poller has
 * consumed the decision (tick order is non-deterministic), so the answer must
 * not consume the record. No `remove`, no `hookPid` liveness gate (we are not
 * delivering — just identifying), no side effects at all.
 */
export async function peekPendingSubmitDecision(
  projectRoot: string,
  deps: SubmitDecisionReaderDeps = {},
): Promise<SubmitDecisionRecordV1 | null> {
  const path = submitDecisionPath(projectRoot);
  const read = deps.read ?? ((p: string) => readFile(p, 'utf8'));
  const expectedHost = deps.expectedHost ?? 'windsurf';

  let text: string;
  try {
    text = await read(path);
  } catch {
    return null; // absent is the common case, not an error
  }
  const record = parseSubmitDecisionJsonV1(text);
  if (!record) return null;
  if (record.host !== expectedHost) return null;
  return record;
}

export async function readPendingSubmitDecision(
  projectRoot: string,
  deps: SubmitDecisionReaderDeps = {},
): Promise<SubmitDecisionRecordV1 | null> {
  const path = submitDecisionPath(projectRoot);
  const read = deps.read ?? ((p: string) => readFile(p, 'utf8'));
  const remove = deps.remove ?? ((p: string) => unlink(p));
  const isAlive = deps.isProcessAlive ?? defaultIsProcessAlive;
  const expectedHost = deps.expectedHost ?? 'windsurf';

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
  // Deliver only a record written FOR THIS HOST. Cross-host delivery would
  // inject into the wrong editor, so a mismatch is dropped rather than trusted.
  // H6: the expected host is now a parameter — before, `cursor` records were
  // dropped unconditionally, so the Cursor path could never have delivered.
  if (record.host !== expectedHost) return null;

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
