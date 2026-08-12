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
  // The rewrite check runs BEFORE the delete: this is the only point at which a stored value can
  // be replaced, so refusing here is what makes "written once, never rewritten" true. It looks up
  // THIS sequence only — a different sequence is a different offer, with its own items and its own
  // record of what the user did with it.
  const prior = storedFrozenFields(store, state.projectRoot, state.sequenceId);
  if (prior && !frozenFieldsRespected(prior, payload)) return false;
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

/**
 * Serialize with a stable key order so two structurally equal values compare equal. Used only to
 * decide whether a frozen field CHANGED — rewriting an item with the identical value is legal, so
 * a key-order difference must not read as a change.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

/**
 * Read the stored payload for THIS sequence, without the active-status filter and without
 * scrubbing. The frozen-field check must see a terminal row — a completed sequence's items and a
 * declined offer's record are both still frozen — and must not delete anything on its way to a
 * decision.
 *
 * Scoped by sequence id, not by project. A terminal row is never removed by the read path, so the
 * previous sequence's row is still present when the next one is written; comparing across the two
 * would freeze one sequence's plan onto a different sequence, and a single declined offer would
 * refuse every later sequence in that project.
 */
function storedFrozenFields(
  store: Store,
  projectRoot: string,
  sequenceId: string,
): { items: readonly Record<string, unknown>[]; offerDisposition: string } | null {
  const result = store.db.exec(
    `SELECT items_json, offer_disposition FROM pending_prompt_sequences
     WHERE project_root = ? AND sequence_id = ? ORDER BY updated_at DESC LIMIT 1`,
    [projectRoot, sequenceId],
  );
  const raw = result[0]?.values[0];
  if (!raw) return null;
  const items = parseJsonArray(raw[0]);
  return {
    items: (items ?? []) as readonly Record<string, unknown>[],
    offerDisposition: raw[1] as string,
  };
}

const FROZEN_ITEM_FIELDS = ['generatedWording', 'itemValidationGraph'] as const;

/**
 * The write-time half of the immutability rule, which cannot be a read-time check: a validator
 * handed one row cannot tell a first write from a rewrite, so this is the only place it can live.
 *
 * `null -> value` is the one legal transition on an item's wording and on its validation verdict.
 * `value -> a different value` is refused, and the whole write is refused with it — an item that
 * comes back must come back identical, and a verdict must not change on unchanged text.
 *
 * The disposition is write-once for the same reason: it records what the user did with the OFFER.
 * A later cancel changes the sequence's status, not that decision, so a write that disagrees with
 * the stored value is refused rather than merged. One offer, one record — a later sequence in the
 * same project is a different offer and is not constrained by this one.
 *
 * Items are matched by position, which is the same correspondence the rest of the row uses. There
 * is deliberately no rule here for an item that disappears from a shorter list: the row exists
 * only after activation, and the plan is frozen at activation, so that transition is not one this
 * writer is specified to see.
 */
function frozenFieldsRespected(
  prior: { items: readonly Record<string, unknown>[]; offerDisposition: string },
  next: PromptEnhancementSequencePayloadV1,
): boolean {
  if (prior.offerDisposition !== next.offerDisposition) return false;
  const shared = Math.min(prior.items.length, next.items.length);
  for (let index = 0; index < shared; index += 1) {
    const before = prior.items[index];
    const after = next.items[index] as unknown as Record<string, unknown>;
    for (const field of FROZEN_ITEM_FIELDS) {
      const written = before?.[field] !== null && before?.[field] !== undefined;
      if (written && canonical(before[field]) !== canonical(after?.[field])) return false;
    }
  }
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
