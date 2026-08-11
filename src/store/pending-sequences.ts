import type { Store } from './db.js';
import { saveStore } from './db.js';
import {
  validatePromptEnhancementSequenceRuntimeStateV1,
  type PromptEnhancementSequenceRuntimeStateV1,
  type PromptEnhancementSequenceRuntimeStatusV1,
} from '../prompt-enhancement/sequence-runtime.js';
import {
  validatePromptEnhancementSequencePayloadV1,
  type PromptEnhancementSequenceOffsetRangeV1,
  type PromptEnhancementSequencePayloadV1,
} from '../prompt-enhancement/sequence-payload.js';

/**
 * Pending multi-prompt sequence — local bookkeeping for the Stop-hook continuation flow.
 *
 * Mirrors `pending-prompt-enhancements.ts`: one active row per project_root, fail-closed
 * validation on read. The row carries ids, counts and status in columns and the planned item
 * list in additive payload columns; a payload that fails structural validation is scrubbed on
 * read exactly like an invalid state, so a corrupt list can never reach a popup.
 * A row here never authorizes the continuation surface by itself: the runtime gate stays
 * the authority, and a row is never proof of completion.
 */
export interface PendingPromptSequence {
  id:               number;
  projectRoot:      string;
  sessionId:        string;
  sequenceId:       string;
  enhancementId:    string;
  itemCount:        number;
  currentItemIndex: number;
  status:           PromptEnhancementSequenceRuntimeStatusV1;
  lastActionId:     string | null;
  createdAt:        number;
  updatedAt:        number;
  payload:          PromptEnhancementSequencePayloadV1;
}

const ACTIVE_STATUSES: readonly PromptEnhancementSequenceRuntimeStatusV1[] = [
  'item_pending',
  'awaiting_response',
];

function runtimeStateOf(row: PendingPromptSequence): PromptEnhancementSequenceRuntimeStateV1 {
  return {
    sequenceId:       row.sequenceId,
    enhancementId:    row.enhancementId,
    projectRoot:      row.projectRoot,
    sessionId:        row.sessionId,
    itemCount:        row.itemCount,
    currentItemIndex: row.currentItemIndex,
    status:           row.status,
    lastActionId:     row.lastActionId,
  };
}

/**
 * Replace any existing sequence rows for the project with the given state and payload. Only
 * one sequence per project_root is kept at a time (single-row-per-project rule, matching the
 * pending-PE store). An invalid state or payload is refused — nothing is written.
 *
 * The payload is a required second argument rather than something this function reads and
 * preserves behind the caller's back. This is a DELETE-and-INSERT writer: it either receives
 * the payload or destroys it, and a caller holding a state with no payload should fail to
 * compile rather than silently wipe the columns on the first write.
 */
export function upsertPendingPromptSequence(
  store: Store,
  state: PromptEnhancementSequenceRuntimeStateV1,
  payload: PromptEnhancementSequencePayloadV1,
): boolean {
  if (!validatePromptEnhancementSequenceRuntimeStateV1(state).ok) return false;
  // Validated against the state, not alone: the list length and the row's item count are one
  // quantity stored twice, and only the pair can catch them disagreeing.
  if (!validatePromptEnhancementSequencePayloadV1(payload, { itemCount: state.itemCount }).ok) {
    return false;
  }
  const now = Date.now();
  store.db.run('DELETE FROM pending_prompt_sequences WHERE project_root = ?', [state.projectRoot]);
  store.db.run(
    `INSERT INTO pending_prompt_sequences
       (project_root, session_id, sequence_id, enhancement_id, item_count, current_item_index,
        status, last_action_id, created_at, updated_at,
        items_json, prompt_directives_json, suggested_next_prompt_policy, original_length,
        offer_disposition)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      state.projectRoot,
      state.sessionId,
      state.sequenceId,
      state.enhancementId,
      state.itemCount,
      state.currentItemIndex,
      state.status,
      state.lastActionId,
      now,
      now,
      JSON.stringify(payload.items),
      JSON.stringify(payload.promptDirectives),
      payload.suggestedNextPromptPolicy,
      payload.originalLength,
      payload.offerDisposition,
    ],
  );
  saveStore(store);
  return true;
}

/** Parse a JSON column fail-closed: a malformed or non-array value reads as absent. */
function parseJsonArray(raw: unknown): unknown[] | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Return the active (non-terminal) sequence for a project, or null. When sessionId is
 * provided, a row from another session is treated as stale: it is scrubbed (deleted) and
 * null is returned — a sequence never crosses sessions (no durable resurrection). A row
 * that fails typed validation is likewise scrubbed fail-closed, so a corrupt row can never
 * drive a popup.
 */
export function getActivePendingPromptSequence(
  store: Store,
  projectRoot: string,
  sessionId?: string,
): PendingPromptSequence | null {
  const result = store.db.exec(
    `SELECT id, project_root, session_id, sequence_id, enhancement_id, item_count,
            current_item_index, status, last_action_id, created_at, updated_at,
            items_json, prompt_directives_json, suggested_next_prompt_policy, original_length,
            offer_disposition
     FROM pending_prompt_sequences
     WHERE project_root = ? AND status IN ('item_pending', 'awaiting_response')
     ORDER BY updated_at DESC
     LIMIT 1`,
    [projectRoot],
  );
  const raw = result[0]?.values[0];
  if (!raw) return null;
  const items = parseJsonArray(raw[11]);
  const promptDirectives = parseJsonArray(raw[12]);
  const payload = {
    items:                     (items ?? []) as PendingPromptSequence['payload']['items'],
    promptDirectives:          (promptDirectives ?? []) as readonly PromptEnhancementSequenceOffsetRangeV1[],
    suggestedNextPromptPolicy: raw[13] as PromptEnhancementSequencePayloadV1['suggestedNextPromptPolicy'],
    originalLength:            raw[14] as number,
    offerDisposition:          raw[15] as PromptEnhancementSequencePayloadV1['offerDisposition'],
  };
  const row: PendingPromptSequence = {
    id:               raw[0] as number,
    projectRoot:      raw[1] as string,
    sessionId:        raw[2] as string,
    sequenceId:       raw[3] as string,
    enhancementId:    raw[4] as string,
    itemCount:        raw[5] as number,
    currentItemIndex: raw[6] as number,
    status:           raw[7] as PromptEnhancementSequenceRuntimeStatusV1,
    lastActionId:     (raw[8] as string | null) ?? null,
    createdAt:        raw[9] as number,
    updatedAt:        raw[10] as number,
    payload,
  };
  const staleSession = sessionId !== undefined && row.sessionId !== sessionId;
  // A malformed JSON column is not an empty list: reading it as one would serve a sequence
  // whose items were silently lost. It is a corrupt row and scrubs like any other.
  const invalid = !validatePromptEnhancementSequenceRuntimeStateV1(runtimeStateOf(row)).ok
    || !ACTIVE_STATUSES.includes(row.status)
    || items === null
    || promptDirectives === null
    || !validatePromptEnhancementSequencePayloadV1(payload, { itemCount: row.itemCount }).ok;
  if (staleSession || invalid) {
    store.db.run('DELETE FROM pending_prompt_sequences WHERE id = ?', [row.id]);
    saveStore(store);
    return null;
  }
  return row;
}

/**
 * Persist a state-machine transition result onto an existing row. The caller applies the
 * transition via `applyPromptEnhancementSequenceRuntimeActionV1` and passes the returned
 * state; an invalid state is refused — the row is left untouched.
 */
export function updatePendingPromptSequenceState(
  store: Store,
  id: number,
  state: PromptEnhancementSequenceRuntimeStateV1,
): boolean {
  if (!validatePromptEnhancementSequenceRuntimeStateV1(state).ok) return false;
  store.db.run(
    `UPDATE pending_prompt_sequences
     SET status = ?, current_item_index = ?, last_action_id = ?, updated_at = ?
     WHERE id = ?`,
    [state.status, state.currentItemIndex, state.lastActionId, Date.now(), id],
  );
  // A vanished row (scrubbed between read and write) must surface as a failed transition,
  // not a silent no-op — the caller then falls back to the ordinary flow.
  const updated = store.db.getRowsModified() > 0;
  saveStore(store);
  return updated;
}

/** Delete every sequence row for a project (terminal scrub / clean session state). */
export function deletePendingPromptSequencesForProject(store: Store, projectRoot: string): number {
  store.db.run('DELETE FROM pending_prompt_sequences WHERE project_root = ?', [projectRoot]);
  const deleted = store.db.getRowsModified();
  saveStore(store);
  return deleted;
}
