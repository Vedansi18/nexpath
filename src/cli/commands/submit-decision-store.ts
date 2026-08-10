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
  };

  await mkdirFn(dirname(finalPath));
  await writeFn(tmpPath, JSON.stringify(record));
  await renameFn(tmpPath, finalPath);
}
