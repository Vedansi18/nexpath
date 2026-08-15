/**
 * Minimal active-sequence state machine for the multi-prompt sequence continuation flow.
 *
 * Locked semantics this module enforces (continuation design, reconfirmed 2026-08-08):
 * - Current-host/project scoped; Stop timing is a user-decision moment only — a transition
 *   here is bookkeeping of what the USER explicitly chose, never completion proof.
 * - NO auto-send and NO automatic pointer advance: every transition requires an explicit
 *   typed action with an action id; advancing to the next item only OFFERS it (the send is
 *   a separate explicit action on the popup).
 * - Custom interruption keeps the current item pending — the pointer does NOT advance and
 *   the same item is offered again at the next eligible Stop.
 * - Cancel is sequence-scoped (terminal for THIS sequence only — not a global disable).
 * - No durable resurrection, no manual resume, no restart recovery: terminal states are
 *   immutable; every action against them is rejected with a typed reason.
 *
 * Pure module: no store, no clock, no I/O — callers persist the returned state. Invalid
 * transitions return typed reason codes; nothing throws on the hook path.
 */

export const PROMPT_ENHANCEMENT_SEQUENCE_RUNTIME_STATUSES_V1 = [
  'item_pending',
  'awaiting_response',
  'completed',
  'cancelled',
  'abandoned',
] as const;

export type PromptEnhancementSequenceRuntimeStatusV1 =
  (typeof PROMPT_ENHANCEMENT_SEQUENCE_RUNTIME_STATUSES_V1)[number];

const TERMINAL_STATUSES: readonly PromptEnhancementSequenceRuntimeStatusV1[] = [
  'completed',
  'cancelled',
  'abandoned',
];

/** Item-count bounds for one sequence (bounds owned by the engine contract; enforced fail-closed here). */
export const PROMPT_ENHANCEMENT_SEQUENCE_MIN_ITEM_COUNT_V1 = 2;
export const PROMPT_ENHANCEMENT_SEQUENCE_MAX_ITEM_COUNT_V1 = 30;

export interface PromptEnhancementSequenceRuntimeStateV1 {
  /** Sequence identity from the typed handoff — ids only, never prompt text. */
  sequenceId:       string;
  /** The enhancement this sequence came from (correlation id). */
  enhancementId:    string;
  projectRoot:      string;
  sessionId:        string;
  /** Total items in the sequence (first item included). */
  itemCount:        number;
  /** 0-based item currently offered or sent. */
  currentItemIndex: number;
  status:           PromptEnhancementSequenceRuntimeStatusV1;
  /** Last applied explicit action id — duplicate replays are rejected, keeping transitions idempotent. */
  lastActionId:     string | null;
}

export type PromptEnhancementSequenceRuntimeActionV1 =
  /** User explicitly sends the currently offered item (popup send). */
  | { type: 'send_current_item'; actionId: string; itemIndex: number }
  /** Stop decision moment after a sent item's response: OFFER the next item (or finish when none remain). Never a send. */
  | { type: 'advance_to_next_item'; actionId: string }
  /** Custom interruption ("something else first"): popup closed, pointer stays — same item returns later. */
  | { type: 'keep_current_item'; actionId: string }
  /** Sequence-scoped cancel (terminal for this sequence only). */
  | { type: 'cancel_sequence'; actionId: string }
  /** Local scrub of a sequence that will never continue (e.g. stale row) — terminal. */
  | { type: 'abandon_sequence'; actionId: string };

export type PromptEnhancementSequenceRuntimeReasonCodeV1 =
  | 'sequence_id_required'
  | 'enhancement_id_required'
  | 'project_root_required'
  | 'session_id_required'
  | 'invalid_item_count'
  | 'invalid_item_index'
  | 'invalid_status'
  | 'action_id_required'
  | 'duplicate_action_id'
  | 'terminal_state_immutable'
  | 'invalid_status_for_action'
  | 'item_index_mismatch';

export type PromptEnhancementSequenceRuntimeTransitionV1 =
  | 'item_sent'
  | 'next_item_offered'
  | 'sequence_completed'
  | 'item_kept_pending'
  | 'sequence_cancelled'
  | 'sequence_abandoned';

export type PromptEnhancementSequenceRuntimeTransitionResultV1 =
  | { ok: true; state: PromptEnhancementSequenceRuntimeStateV1; transition: PromptEnhancementSequenceRuntimeTransitionV1 }
  | { ok: false; reasonCode: PromptEnhancementSequenceRuntimeReasonCodeV1 };

export interface PromptEnhancementSequenceRuntimeCreateInputV1 {
  sequenceId:    string;
  enhancementId: string;
  projectRoot:   string;
  sessionId:     string;
  itemCount:     number;
}

export type PromptEnhancementSequenceRuntimeCreateResultV1 =
  | { ok: true; state: PromptEnhancementSequenceRuntimeStateV1 }
  | { ok: false; reasonCode: PromptEnhancementSequenceRuntimeReasonCodeV1 };

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validate a (possibly persisted) runtime state. Store reads run this fail-closed: an
 * invalid row is treated as absent, so a corrupt/foreign row can never drive a popup.
 */
export function validatePromptEnhancementSequenceRuntimeStateV1(
  value: unknown,
): { ok: boolean; reasonCodes: readonly PromptEnhancementSequenceRuntimeReasonCodeV1[] } {
  const reasonCodes: PromptEnhancementSequenceRuntimeReasonCodeV1[] = [];
  const state = value as Partial<PromptEnhancementSequenceRuntimeStateV1> | null | undefined;
  if (!state || typeof state !== 'object') return { ok: false, reasonCodes: ['invalid_status'] };
  if (!nonEmpty(state.sequenceId)) reasonCodes.push('sequence_id_required');
  if (!nonEmpty(state.enhancementId)) reasonCodes.push('enhancement_id_required');
  if (!nonEmpty(state.projectRoot)) reasonCodes.push('project_root_required');
  if (!nonEmpty(state.sessionId)) reasonCodes.push('session_id_required');
  if (
    typeof state.itemCount !== 'number' ||
    !Number.isInteger(state.itemCount) ||
    state.itemCount < PROMPT_ENHANCEMENT_SEQUENCE_MIN_ITEM_COUNT_V1 ||
    state.itemCount > PROMPT_ENHANCEMENT_SEQUENCE_MAX_ITEM_COUNT_V1
  ) {
    reasonCodes.push('invalid_item_count');
  }
  if (
    typeof state.currentItemIndex !== 'number' ||
    !Number.isInteger(state.currentItemIndex) ||
    state.currentItemIndex < 0 ||
    (typeof state.itemCount === 'number' && state.currentItemIndex >= state.itemCount)
  ) {
    reasonCodes.push('invalid_item_index');
  }
  if (!PROMPT_ENHANCEMENT_SEQUENCE_RUNTIME_STATUSES_V1.includes(state.status as PromptEnhancementSequenceRuntimeStatusV1)) {
    reasonCodes.push('invalid_status');
  }
  return { ok: reasonCodes.length === 0, reasonCodes };
}

/**
 * Create the runtime state at the moment the FIRST item was explicitly sent from the first
 * popup: item 0 is in flight (`awaiting_response`). The continuation flow starts from here —
 * the next eligible Stop may OFFER item 1 via `advance_to_next_item`.
 */
export function createPromptEnhancementSequenceRuntimeStateV1(
  input: PromptEnhancementSequenceRuntimeCreateInputV1,
): PromptEnhancementSequenceRuntimeCreateResultV1 {
  const candidate: PromptEnhancementSequenceRuntimeStateV1 = {
    sequenceId:       input.sequenceId,
    enhancementId:    input.enhancementId,
    projectRoot:      input.projectRoot,
    sessionId:        input.sessionId,
    itemCount:        input.itemCount,
    currentItemIndex: 0,
    status:           'awaiting_response',
    lastActionId:     null,
  };
  const validity = validatePromptEnhancementSequenceRuntimeStateV1(candidate);
  if (!validity.ok) return { ok: false, reasonCode: validity.reasonCodes[0] };
  return { ok: true, state: candidate };
}

/**
 * Apply one explicit typed action. Every rejection is a typed reason code — the caller
 * (Stop-hook adapter) falls back to the ordinary flow, never a partial state.
 */
export function applyPromptEnhancementSequenceRuntimeActionV1(
  state: PromptEnhancementSequenceRuntimeStateV1,
  action: PromptEnhancementSequenceRuntimeActionV1,
): PromptEnhancementSequenceRuntimeTransitionResultV1 {
  const validity = validatePromptEnhancementSequenceRuntimeStateV1(state);
  if (!validity.ok) return { ok: false, reasonCode: validity.reasonCodes[0] };
  if (!nonEmpty(action.actionId)) return { ok: false, reasonCode: 'action_id_required' };
  // Idempotent replay guard: the same explicit action never applies twice.
  if (state.lastActionId !== null && action.actionId === state.lastActionId) {
    return { ok: false, reasonCode: 'duplicate_action_id' };
  }
  // Terminal states are immutable — no resume, no restart, no reuse (locked).
  if (TERMINAL_STATUSES.includes(state.status)) {
    return { ok: false, reasonCode: 'terminal_state_immutable' };
  }

  switch (action.type) {
    case 'send_current_item': {
      if (state.status !== 'item_pending') return { ok: false, reasonCode: 'invalid_status_for_action' };
      if (action.itemIndex !== state.currentItemIndex) return { ok: false, reasonCode: 'item_index_mismatch' };
      return {
        ok: true,
        transition: 'item_sent',
        state: { ...state, status: 'awaiting_response', lastActionId: action.actionId },
      };
    }
    case 'advance_to_next_item': {
      if (state.status !== 'awaiting_response') return { ok: false, reasonCode: 'invalid_status_for_action' };
      const nextIndex = state.currentItemIndex + 1;
      if (nextIndex >= state.itemCount) {
        // Every item was explicitly sent — nothing left to offer. Completion of the SEQUENCE
        // bookkeeping only; never a claim about the work's outcome.
        return {
          ok: true,
          transition: 'sequence_completed',
          state: { ...state, status: 'completed', lastActionId: action.actionId },
        };
      }
      return {
        ok: true,
        transition: 'next_item_offered',
        state: { ...state, currentItemIndex: nextIndex, status: 'item_pending', lastActionId: action.actionId },
      };
    }
    case 'keep_current_item': {
      if (state.status !== 'item_pending') return { ok: false, reasonCode: 'invalid_status_for_action' };
      // Pointer intentionally unchanged — the same item is offered again at the next Stop.
      return {
        ok: true,
        transition: 'item_kept_pending',
        state: { ...state, lastActionId: action.actionId },
      };
    }
    case 'cancel_sequence': {
      return {
        ok: true,
        transition: 'sequence_cancelled',
        state: { ...state, status: 'cancelled', lastActionId: action.actionId },
      };
    }
    case 'abandon_sequence': {
      return {
        ok: true,
        transition: 'sequence_abandoned',
        state: { ...state, status: 'abandoned', lastActionId: action.actionId },
      };
    }
  }
}
