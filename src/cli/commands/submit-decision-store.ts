/**
 * CLI-side persistence for the submit-time decision (hook milestone H3, Gap 2b).
 *
 * The missing link: the hook blocks a prompt and must hand the replacement to the
 * extension, which runs in a different process. This writes the record the
 * extension's `readPendingSubmitDecision` consumes.
 *
 * ── WHY THE SHAPE IS DUPLICATED, NOT IMPORTED ────────────────────────────────
 * `src/ext-vscode` is a separate npm package; `src/cli` cannot import from it and
 * vice versa — the `G-ROOTDIR`/TS6059 wall the PE milestone hit six times. So the
 * record shape and the path convention are restated here and **pinned against the
 * extension's copy by test** (`submit-decision-store.test.ts` asserts both the
 * literal path segments and every field name). Divergence fails the suite rather
 * than silently breaking the handoff at runtime.
 *
 * ── OWNERSHIP ────────────────────────────────────────────────────────────────
 * Everything here is Vedansi-owned (`src/cli/commands/**`). Hiren's
 * `engine-option-generator.ts` and Bhavnesh's `TtySelectFn.ts` are **consumed via
 * injected ports at the call site and never imported here** — this file has no
 * `decision-session` dependency at all.
 *
 * ── WRITE ATOMICITY ──────────────────────────────────────────────────────────
 * Written to a temp file then renamed. The extension polls on an interval and
 * could otherwise observe a half-written file; `rename` is atomic on the same
 * filesystem, so a reader sees either the old state or a complete record — never
 * a partial one. The extension's parser rejects malformed JSON anyway, but that
 * would silently drop a real decision, so preventing the torn read matters.
 */
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';

/** Must match `submit-decision-record.ts`'s constant in the extension package. */
export const SUBMIT_DECISION_SCHEMA_V1 = 1 as const;

/** Must match `submitDecisionPath()` in the extension package — pinned by test. */
export function submitDecisionPath(projectRoot: string): string {
  return join(projectRoot, '.nexpath', 'submit-decision.json');
}

export interface WriteSubmitDecisionInput {
  projectRoot: string;
  decisionId: string;
  replacementText: string;
  createdAt: number;
  host: 'windsurf' | 'cursor';
  /**
   * When the hook DECIDED to block, captured before persisting.
   *
   * The dev plan mandates five timestamps
   * (`block issued → decision persisted → extension observed → inject dispatched
   * → submit dispatched`). Without this the measured handoff excludes the hook's
   * own decision time — which, under option-A ordering, contains `auto`'s LLM
   * classification and is the largest term in the budget.
   */
  blockIssuedAt: number;
  /**
   * PID of the hook process that issued the block.
   *
   * ── WHY (the block/injection race) ──────────────────────────────────────
   * This record is persisted BEFORE `exit(2)`. Windsurf only cancels the prompt
   * when the hook process actually exits, so between persistence and exit there
   * is a window in which the original prompt is still live. If the extension
   * injected during that window the user would get TWO prompts: the original
   * (never cancelled) and the replacement.
   *
   * Process liveness is the reliable cross-process signal — "hook alive" ⇒ "exit
   * code not yet delivered" ⇒ "not safe to inject". The reader defers while this
   * pid is alive rather than assuming the poll interval outruns the gap.
   */
  hookPid: number;
}

export interface SubmitDecisionStoreDeps {
  mkdirFn?: (dir: string) => Promise<void>;
  writeFn?: (path: string, data: string) => Promise<void>;
  renameFn?: (from: string, to: string) => Promise<void>;
}

/**
 * Persist a decision for the extension to pick up.
 *
 * **Throws on failure, deliberately.** The decider treats a persist failure as
 * "allow" — it must not block a prompt whose replacement was never written, or
 * the user's prompt is cancelled with nothing to inject. Swallowing the error
 * here would hide that from the decider and produce exactly that outcome.
 */
export async function writeSubmitDecision(
  input: WriteSubmitDecisionInput,
  deps: SubmitDecisionStoreDeps = {},
): Promise<void> {
  if (!input.replacementText || input.replacementText.length === 0) {
    // Mirrors the extension-side validator: an empty replacement would clear the
    // composer and silently lose the turn, so it is never written.
    throw new Error('submit decision: refusing to persist an empty replacement');
  }

  // JSON.stringify DROPS undefined, so an unset timestamp would produce a record
  // silently missing the field — which the extension validator rejects, losing a
  // real decision. Fail here instead: the decider treats a throw as 'allow'.
  if (typeof input.blockIssuedAt !== 'number' || !Number.isFinite(input.blockIssuedAt)) {
    throw new Error('submit decision: blockIssuedAt must be a finite number');
  }
  if (typeof input.hookPid !== 'number' || !Number.isInteger(input.hookPid) || input.hookPid <= 0) {
    // Same JSON.stringify-drops-undefined trap as blockIssuedAt: a missing pid
    // would make the reader unable to tell whether the hook had exited.
    throw new Error('submit decision: hookPid must be a positive integer');
  }

  const finalPath = submitDecisionPath(input.projectRoot);
  const tmpPath = `${finalPath}.tmp`;
  const mkdirFn = deps.mkdirFn ?? (async (d: string) => { await mkdir(d, { recursive: true }); });
  const writeFn = deps.writeFn ?? ((p: string, d: string) => writeFile(p, d, 'utf8'));
  const renameFn = deps.renameFn ?? ((a: string, b: string) => rename(a, b));

  const record = {
    schemaVersion: SUBMIT_DECISION_SCHEMA_V1,
    decisionId: input.decisionId,
    replacementText: input.replacementText,
    createdAt: input.createdAt,
    host: input.host,
    blockIssuedAt: input.blockIssuedAt,
    hookPid: input.hookPid,
  };

  await mkdirFn(dirname(finalPath));
  await writeFn(tmpPath, JSON.stringify(record));
  await renameFn(tmpPath, finalPath);
}
