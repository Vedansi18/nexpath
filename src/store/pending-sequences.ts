import type { Store } from './db.js';
import { saveStore } from './db.js';
import {
  validatePromptEnhancementSequenceRuntimeStateV1,
  type PromptEnhancementSequenceRuntimeStateV1,
  type PromptEnhancementSequenceRuntimeStatusV1,
} from '../prompt-enhancement/sequence-runtime.js';

/**
 * Pending multi-prompt sequence — local bookkeeping for the Stop-hook continuation flow.
 *
 * Mirrors `pending-prompt-enhancements.ts`: one active row per project_root, fail-closed
 * validation on read. Unlike the pending-PE row this stores NO payload JSON — ids, counts,
 * and status only (future prompt bodies are not generated, stored, or rendered by design).
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
 * Replace any existing sequence rows for the project with the given state. Only one
 * sequence per project_root is kept at a time (single-row-per-project rule, matching the
 * pending-PE store). An invalid state is refused — nothing is written.
 */
export function upsertPendingPromptSequence(
  store: Store,
  state: PromptEnhancementSequenceRuntimeStateV1,
): boolean {
  if (!validatePromptEnhancementSequenceRuntimeStateV1(state).ok) return false;
  const now = Date.now();
  store.db.run('DELETE FROM pending_prompt_sequences WHERE project_root = ?', [state.projectRoot]);
  store.db.run(
    `INSERT INTO pending_prompt_sequences
       (project_root, session_id, sequence_id, enhancement_id, item_count, current_item_index,
        status, last_action_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    ],
  );
  saveStore(store);
  return true;
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
            current_item_index, status, last_action_id, created_at, updated_at
     FROM pending_prompt_sequences
     WHERE project_root = ? AND status IN ('item_pending', 'awaiting_response')
     ORDER BY updated_at DESC
     LIMIT 1`,
    [projectRoot],
  );
  const raw = result[0]?.values[0];
  if (!raw) return null;
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
  };
  const staleSession = sessionId !== undefined && row.sessionId !== sessionId;
  const invalid = !validatePromptEnhancementSequenceRuntimeStateV1(runtimeStateOf(row)).ok
    || !ACTIVE_STATUSES.includes(row.status);
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
