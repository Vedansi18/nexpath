import type { PromptEnhancementPrepareResultV1 } from './contracts.js';
import { validatePromptEnhancementHandoffMetadataV1 } from './handoff-metadata.js';
import {
  createPromptEnhancementSequenceRuntimeStateV1,
  PROMPT_ENHANCEMENT_SEQUENCE_MAX_ITEM_COUNT_V1,
  type PromptEnhancementSequenceRuntimeReasonCodeV1,
  type PromptEnhancementSequenceRuntimeStateV1,
} from './sequence-runtime.js';
import {
  emptyPromptEnhancementSequencePayloadV1,
  validatePromptEnhancementSequencePayloadV1,
  type PromptEnhancementSequencePayloadV1,
  type PromptEnhancementSequenceItemV1,
  type PromptEnhancementSequenceOffsetRangeV1,
} from './sequence-payload.js';
import { promptEnhancementSequencePolicyForOutcomeV1 } from './sequence-planner-entry.js';
import { redactSecrets } from '../store/redact.js';

/**
 * First-send sequence intake for the continuation flow: consume the typed handoff/sequence
 * summary from a prepared result at the moment the user EXPLICITLY sends the first sequence
 * prompt from the MPS popup, and produce the local bookkeeping state (ids/counts only).
 *
 * Fail-closed by design: a missing, invalid, foreign-project, or empty-remainder handoff is
 * a typed no-op — the ordinary flow continues, no partial state is written, nothing throws.
 * Recording a row here authorizes NOTHING by itself: future prompt text is never stored, and
 * the runtime gate remains the sole authority for whether a continuation surface may open.
 */

export type PromptEnhancementSequenceIntakeReasonCodeV1 =
  | 'handoff_missing'
  | 'handoff_invalid'
  | 'summary_missing'
  | 'scope_mismatch'
  | 'no_remaining_items'
  | PromptEnhancementSequenceRuntimeReasonCodeV1;

export type PromptEnhancementSequenceIntakeResultV1 =
  | {
      state: 'sequence_recorded';
      runtime: PromptEnhancementSequenceRuntimeStateV1;
      // The durable payload travels with the state from the moment it first exists. Intake is
      // the first persist, so a return shape that carried only the state would leave the caller
      // with nothing to write into the payload columns.
      payload: PromptEnhancementSequencePayloadV1;
      // MPS continuation content foundation (2026-08-14): two additive side fields the store
      // persists beside the row for the continuation Stop to consume later (MPS-12 original slice
      // + the packager's continuable-kind check). Nothing reads them yet.
      // ⛔ `redactedOriginalPromptText` is the REDACTED, length-preserving copy — never raw text —
      // and neither field is ever emitted in telemetry.
      redactedOriginalPromptText: string | null;
      handoffKind:                string | null;
    }
  | { state: 'no_sequence'; reasonCode: PromptEnhancementSequenceIntakeReasonCodeV1 };

export interface PromptEnhancementSequenceIntakeInputV1 {
  result:      PromptEnhancementPrepareResultV1;
  projectRoot: string;
  sessionId:   string;
  /**
   * MPS P1b-iii (8c): the WORDED items 2…N produced by the background batch while the popup was open,
   * with the sequence's directive ranges. Present ⇒ the accepted row is written with its full item
   * list (the sequence is now ready to serve when the runtime gate opens). Absent ⇒ the pre-8c
   * empty-list behaviour. A list that does not line up with the row (count/bounds/wording) is dropped
   * fail-closed back to the empty payload — an accepted row is never written with an invalid list.
   */
  wordedItems?:      readonly PromptEnhancementSequenceItemV1[];
  promptDirectives?: readonly PromptEnhancementSequenceOffsetRangeV1[];
}

export function intakePromptEnhancementSequenceOnFirstSendV1(
  input: PromptEnhancementSequenceIntakeInputV1,
): PromptEnhancementSequenceIntakeResultV1 {
  const handoff = input.result.uiView.handoffAndSequenceSummary;
  if (!handoff) return { state: 'no_sequence', reasonCode: 'handoff_missing' };
  // Re-validate fail-closed even though the engine validated at emission — the intake is the
  // last gate before a durable row, and a row must never come from an unvalidated payload.
  // The scope argument binds the handoff to THIS project (cross-project policy is 'reject').
  const validation = validatePromptEnhancementHandoffMetadataV1(
    handoff,
    input.result.currentBody,
    input.result.safetySummary,
    { requestId: input.result.requestId, projectRoot: input.projectRoot },
  );
  if (!validation.ok) {
    const scopeMismatch = handoff.scope.projectRoot !== input.projectRoot;
    return { state: 'no_sequence', reasonCode: scopeMismatch ? 'scope_mismatch' : 'handoff_invalid' };
  }
  const summary = handoff.compactFirstPopupSequenceSummary;
  if (!summary) return { state: 'no_sequence', reasonCode: 'summary_missing' };
  // The first prompt was just sent; the sequence only exists if something remains after it.
  if (summary.remainingTaskCount < 1) {
    return { state: 'no_sequence', reasonCode: 'no_remaining_items' };
  }
  const created = createPromptEnhancementSequenceRuntimeStateV1({
    sequenceId:    handoff.handoffDecisionId,
    enhancementId: input.result.enhancementId,
    projectRoot:   input.projectRoot,
    sessionId:     input.sessionId,
    // Counts only, never text: total = the sent first item + the remaining items, CAPPED at the
    // locked max (owner request 2026-08-08). A prompt with more than the cap's worth of points
    // still records a valid sequence clamped to the cap — it is never dropped for being too long.
    itemCount:     Math.min(summary.remainingTaskCount + 1, PROMPT_ENHANCEMENT_SEQUENCE_MAX_ITEM_COUNT_V1),
  });
  if (!created.ok) return { state: 'no_sequence', reasonCode: created.reasonCode };
  // The bound is taken from the body's original text, which is the prompt AS RECEIVED — the string
  // slices are cut from, so the one the offsets index. The copy kept in the prompts table is
  // redacted, but redaction is length-preserving by design (see `store/redact.ts`), so the two
  // agree character for character and a stored range selects the same words in either.
  const originalLength = input.result.currentBody.originalPromptText.length;

  // P1b-iii (8c): when the background batch produced the worded items, the accepted row carries its
  // full list — the sequence is ready to serve once the runtime gate opens. The list is validated
  // against the runtime the intake just created (count/bounds/wording/policy); anything that does not
  // line up is dropped fail-closed to the empty payload, so an accepted row is never invalid. When no
  // items were produced (non-sequence, batch skipped/failed) the empty list is written, as before.
  const payload = buildPromptEnhancementSequenceIntakePayloadV1(originalLength, created.state, input);

  return {
    state:   'sequence_recorded',
    runtime: created.state,
    payload,
    // Persist the REDACTED, length-preserving original (never the raw text): redaction preserves
    // length by design, so the future offsets index it character-for-character, and it is already
    // stored redacted in the prompts table — no new privacy exposure. The handoffKind is a single
    // enum value (ids-only-safe). Both are local-store only and never emitted in telemetry.
    redactedOriginalPromptText: redactSecrets(input.result.currentBody.originalPromptText),
    handoffKind:                input.result.handoffMetadata?.handoffKind ?? null,
  };
}

/**
 * Build the intake payload for a recorded sequence. With no worded items (the pre-8c state, or a batch
 * that was skipped/failed) it is the empty list. With worded items it is the full accepted payload —
 * BUT only if that payload validates against the row the intake just created: the batch list must line
 * up on count (=== itemCount), bounds (offsets in range), and wording (every stored item worded); the
 * policy is the deterministic sequence value. A list that does not line up is dropped back to the empty
 * payload, so an accepted row is never written invalid (the store validates on write and would reject
 * it anyway) — the wording is simply not carried this time.
 */
function buildPromptEnhancementSequenceIntakePayloadV1(
  originalLength: number,
  runtime: PromptEnhancementSequenceRuntimeStateV1,
  input: PromptEnhancementSequenceIntakeInputV1,
): PromptEnhancementSequencePayloadV1 {
  const empty = emptyPromptEnhancementSequencePayloadV1(originalLength);
  if (!input.wordedItems || input.wordedItems.length === 0) return empty;
  const full: PromptEnhancementSequencePayloadV1 = {
    items:                     input.wordedItems,
    promptDirectives:          input.promptDirectives ?? [],
    suggestedNextPromptPolicy: promptEnhancementSequencePolicyForOutcomeV1('sequence'),
    originalLength,
    offerDisposition:          'accepted',
  };
  const context = { itemCount: runtime.itemCount, status: runtime.status };
  return validatePromptEnhancementSequencePayloadV1(full, context).ok ? full : empty;
}
