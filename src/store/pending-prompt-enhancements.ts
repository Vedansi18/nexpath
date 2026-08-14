import type { Store } from './db.js';
import { saveStore } from './db.js';
import {
  validatePromptEnhancementPrepareRequestV1,
  validatePromptEnhancementPrepareResultV1,
  type PromptEnhancementPrepareRequestV1,
  type PromptEnhancementPrepareResultV1,
} from '../prompt-enhancement/contracts.js';
import type { PromptEnhancementSequenceItemV1 } from '../prompt-enhancement/sequence-payload.js';

/**
 * Pending Prompt Enhancement — the UserPromptSubmit `auto` hook prepares a PE and stores it
 * here WITHOUT showing a popup (owner decision B-i, 2026-08-04); the Stop hook reads it,
 * shows the PE popup, and injects the enhanced prompt as a new turn.
 *
 * Mirrors `pending-advisories.ts`: one pending row per project_root, JSON-serialised typed
 * payload, fail-closed validation on read.
 */
export interface PendingPromptEnhancement {
  id:          number;
  projectRoot: string;
  sessionId:   string;
  promptCount: number;
  status:      'pending' | 'shown';
  createdAt:   number;
  request:     PromptEnhancementPrepareRequestV1;
  result:      PromptEnhancementPrepareResultV1;
  /**
   * MPS P1b-ii: the UserPromptSubmit planner's full item list, carried so the Stop-hook background
   * wording batch can read it (planner and popup+batch run in different processes — owner B-i).
   * Undefined on every non-sequence prepare and on old rows / any corrupt stored value (fail-closed
   * → the batch simply does not run). Items are offsets/roles into the original; no wording yet.
   */
  plannerItems?: readonly PromptEnhancementSequenceItemV1[];
}

export interface UpsertPendingPromptEnhancementInput {
  projectRoot: string;
  sessionId:   string;
  promptCount: number;
  request:     PromptEnhancementPrepareRequestV1;
  result:      PromptEnhancementPrepareResultV1;
  /** MPS P1b-ii planner item list (see {@link PendingPromptEnhancement.plannerItems}). */
  plannerItems?: readonly PromptEnhancementSequenceItemV1[];
}

/**
 * Replace any existing pending PE for the project with a fresh one. Only one pending PE per
 * project_root is kept at a time (matches the pending-advisory single-row-per-project rule).
 */
export function upsertPendingPromptEnhancement(
  store: Store,
  input: UpsertPendingPromptEnhancementInput,
): void {
  store.db.run(
    'DELETE FROM pending_prompt_enhancements WHERE project_root = ?',
    [input.projectRoot],
  );
  store.db.run(
    `INSERT INTO pending_prompt_enhancements
       (project_root, session_id, prompt_count, status, created_at, request_json, result_json, planner_items_json)
     VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)`,
    [
      input.projectRoot,
      input.sessionId,
      input.promptCount,
      Date.now(),
      JSON.stringify(input.request),
      JSON.stringify(input.result),
      // Nullable: only sequence prepares carry a planner item list; non-sequence stores NULL.
      input.plannerItems ? JSON.stringify(input.plannerItems) : null,
    ],
  );
  saveStore(store);
}

function parseTyped<T>(raw: unknown, validate: (value: unknown) => { ok: boolean }): T | null {
  if (typeof raw !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return validate(parsed).ok ? (parsed as T) : null;
}

/**
 * Parse the carried planner item list, fail-closed. NULL (old rows / non-sequence prepares),
 * non-JSON, or a shape that is not an array of `{ itemKind: string, … }` all read back as
 * undefined — the batch then simply does not run. This is a lightweight structural guard only;
 * the background wording batch performs the full semantic validation (offsets, coverage) with the
 * original length it holds at consumption time.
 */
function parsePlannerItems(raw: unknown): readonly PromptEnhancementSequenceItemV1[] | undefined {
  if (typeof raw !== 'string') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  const wellFormed = parsed.every(
    (item) => item !== null && typeof item === 'object'
      && typeof (item as { itemKind?: unknown }).itemKind === 'string',
  );
  return wellFormed ? (parsed as readonly PromptEnhancementSequenceItemV1[]) : undefined;
}

/**
 * Return the most recent pending PE for a project, or null if none / corrupt. When sessionId is
 * provided only PEs from that session are returned. A row whose stored JSON fails typed
 * validation is treated as absent (fail-closed) — the Stop hook then shows no PE popup.
 */
export function getPendingPromptEnhancement(
  store: Store,
  projectRoot: string,
  sessionId?: string,
): PendingPromptEnhancement | null {
  const sessionFilter = sessionId !== undefined ? ' AND session_id = ?' : '';
  const params: (string | number)[] = sessionId !== undefined
    ? [projectRoot, sessionId]
    : [projectRoot];
  const result = store.db.exec(
    `SELECT id, project_root, session_id, prompt_count, status, created_at, request_json, result_json, planner_items_json
     FROM pending_prompt_enhancements
     WHERE project_root = ?${sessionFilter} AND status = 'pending'
     ORDER BY created_at DESC
     LIMIT 1`,
    params,
  );
  const row = result[0]?.values[0];
  if (!row) return null;
  const request = parseTyped<PromptEnhancementPrepareRequestV1>(row[6], validatePromptEnhancementPrepareRequestV1);
  const resultPayload = parseTyped<PromptEnhancementPrepareResultV1>(row[7], validatePromptEnhancementPrepareResultV1);
  if (!request || !resultPayload) return null;
  // Additive/nullable: a corrupt or absent item list only disables the batch, never the popup —
  // so a bad planner_items_json must NOT fail-close the whole pending PE (unlike request/result).
  const plannerItems = parsePlannerItems(row[8]);
  return {
    id:          row[0] as number,
    projectRoot: row[1] as string,
    sessionId:   row[2] as string,
    promptCount: row[3] as number,
    status:      row[4] as 'pending' | 'shown',
    createdAt:   row[5] as number,
    request,
    result:      resultPayload,
    ...(plannerItems ? { plannerItems } : {}),
  };
}

/** Mark a pending PE as shown so the Stop hook doesn't re-show it. */
export function markPromptEnhancementShown(store: Store, id: number): void {
  store.db.run(
    "UPDATE pending_prompt_enhancements SET status = 'shown' WHERE id = ?",
    [id],
  );
  saveStore(store);
}
