import {
  applyPromptEnhancementSequenceRuntimeActionV1,
  type PromptEnhancementSequenceRuntimeReasonCodeV1,
  type PromptEnhancementSequenceRuntimeStateV1,
} from './sequence-runtime.js';
import {
  packagePromptEnhancementSequenceContinuationV1,
  type PromptEnhancementSequencePackagerInputV1,
  type PromptEnhancementSequencePackagedContinuationV1,
  type PromptEnhancementSequencePackagerRefusalV1,
} from './sequence-packager.js';
import {
  buildPromptEnhancementMpsContinuationPopupV1,
  type PromptEnhancementMpsContinuationBuildResultV1,
  type PromptEnhancementMpsContinuationInputV1,
} from './continuation-popup.js';

/**
 * Pure intent delivery for the MPS continuation flow (P4). Maps the two decision moments of a
 * continuation Stop onto the P1 state machine, so the Stop-hook launcher (P5) only has to
 * persist the returned state and act on the returned decision — no runtime logic lives inline.
 *
 * Locked semantics enforced here (continuation split 3):
 * - The OFFER step never sends: at a continuation Stop it advances the pointer to OFFER the next
 *   item (from `awaiting_response`) or re-offers the SAME still-pending item; it never auto-sends.
 * - `send`          → the user explicitly sent the offered item → mark it in flight + inject it.
 * - `interruption`  → keep the SAME item pending (pointer unchanged) — it returns next Stop.
 * - `declined`      → identical persistence to interruption: the offered item stays pending.
 * - `cancel`        → sequence-scoped terminal; the row is scrubbed and PEF feedback is shown.
 * - Stop is a decision moment only — never completion proof; completion happens solely when the
 *   pointer advances past the last item with an explicit action.
 *
 * `actionId` is supplied by the caller (unique per Stop) so transitions stay idempotent and the
 * module stays pure/testable.
 */

export type PromptEnhancementSequenceContinuationOfferResultV1 =
  | { state: 'offer'; itemIndex: number; offeredState: PromptEnhancementSequenceRuntimeStateV1; advanced: boolean }
  | { state: 'sequence_complete'; terminalState: PromptEnhancementSequenceRuntimeStateV1 }
  | { state: 'no_offer'; reasonCode: PromptEnhancementSequenceRuntimeReasonCodeV1 | 'not_offerable_status' };

/**
 * Decide what a continuation Stop offers, given the active row's current state.
 * - `awaiting_response` → advance to OFFER the next item (or complete if none remain).
 * - `item_pending`      → re-offer the SAME item (a prior interruption/decline left it pending).
 * - anything else       → no offer.
 */
export function prepareSequenceContinuationOfferV1(
  state: PromptEnhancementSequenceRuntimeStateV1,
  actionId: string,
): PromptEnhancementSequenceContinuationOfferResultV1 {
  if (state.status === 'item_pending') {
    // Re-offer the same still-pending item — no state change, no new action id consumed.
    return { state: 'offer', itemIndex: state.currentItemIndex, offeredState: state, advanced: false };
  }
  if (state.status === 'awaiting_response') {
    const advanced = applyPromptEnhancementSequenceRuntimeActionV1(state, { type: 'advance_to_next_item', actionId });
    if (!advanced.ok) return { state: 'no_offer', reasonCode: advanced.reasonCode };
    if (advanced.transition === 'sequence_completed') {
      return { state: 'sequence_complete', terminalState: advanced.state };
    }
    return { state: 'offer', itemIndex: advanced.state.currentItemIndex, offeredState: advanced.state, advanced: true };
  }
  return { state: 'no_offer', reasonCode: 'not_offerable_status' };
}

/**
 * The packaging read-point (MPS-14 sub-phase 2.1): a ready package for the popup, or no popup at all.
 *
 * `package` — the packaged continuation is fed VERBATIM to the popup builder (2.2); its fields are the
 * builder's inputs under the same names.
 * `no_popup` — the packager refused (a state that should already be impossible). There is NO popup and
 * NO fallback body: the launcher falls through to the ordinary Claude flow. ⛔ The packager never
 * composes, skips to the next item, or serves an empty body — serving nothing is the correct outcome.
 */
export type PromptEnhancementSequenceContinuationPackageV1 =
  | { kind: 'package'; packaged: PromptEnhancementSequencePackagedContinuationV1 }
  | { kind: 'no_popup'; refusal: PromptEnhancementSequencePackagerRefusalV1 };

/**
 * Package the offered continuation item (2.1). ONE packager call per continuation Stop — the packager
 * reads the stored wording + verdict for the offered item and re-points the handoff/event at THIS body;
 * it composes nothing. On refusal the caller shows no popup and takes the ordinary flow. The caller
 * supplies the input (this body's identity ids, 0-based `currentItemIndex` — index 0 is the already-sent
 * first prompt, so a continuation is `1 … itemCount-1`); ⛔ the ids must be this body's, never the first
 * prompt's. The package must not be cached across Stops — package once per Stop (MPS-8 re-read rule).
 */
export function packageSequenceContinuationOfferV1(
  input: PromptEnhancementSequencePackagerInputV1,
): PromptEnhancementSequenceContinuationPackageV1 {
  const result = packagePromptEnhancementSequenceContinuationV1(input);
  if (!result.ok) return { kind: 'no_popup', refusal: result.refusal };
  return { kind: 'package', packaged: result.packaged };
}

/**
 * Feed a packaged continuation (2.1) into the popup builder (2.2).
 *
 * The packager's `result` / `handoffMetadata` / `event` are the builder's inputs under the SAME names
 * and the SAME types — passed VERBATIM here, with no mapping/adapter layer between them. Only the
 * popup's own inputs are supplied: `cancel` is the locked cancel-remaining-sequence row
 * (`blocked_no_send`, MPS-2 §5b), and `additionalDetails` is the popup's typed-details field state
 * (absent on first open). The builder validates the three fields and returns a ready popup model or a
 * typed `no_popup` — returned as-is; this step decides nothing the builder does not.
 */
export function buildContinuationPopupFromPackageV1(
  packaged: PromptEnhancementSequencePackagedContinuationV1,
  additionalDetails?: PromptEnhancementMpsContinuationInputV1['additionalDetails'],
): PromptEnhancementMpsContinuationBuildResultV1 {
  return buildPromptEnhancementMpsContinuationPopupV1({
    result: packaged.result,
    handoffMetadata: packaged.handoffMetadata,
    event: packaged.event,
    additionalDetails,
    cancel: { state: 'available', disposition: 'blocked_no_send' },
  });
}

/** The continuation-shell outcome shape this delivery consumes (subset the launcher forwards). */
export type PromptEnhancementSequenceContinuationShellOutcomeV1 =
  | { state: 'send'; bodyText: string }
  | { state: 'interruption' }
  | { state: 'declined' }
  | { state: 'cancelled' };

export type PromptEnhancementSequenceContinuationDeliveryV1 =
  /** Explicit send: persist the in-flight state + inject the body as a new turn (echo-guarded by the caller). */
  | { kind: 'inject'; bodyText: string; nextState: PromptEnhancementSequenceRuntimeStateV1 }
  /** Interruption / decline: persist the unchanged pending state — the same item returns next Stop. */
  | { kind: 'keep'; nextState: PromptEnhancementSequenceRuntimeStateV1 }
  /** Cancel: terminal — the caller scrubs the row and opens the PEF feedback popup. */
  | { kind: 'cancel'; nextState: PromptEnhancementSequenceRuntimeStateV1 }
  /** A rejected transition (stale/duplicate/invalid) — the caller leaves the row untouched, ordinary flow. */
  | { kind: 'reject'; reasonCode: PromptEnhancementSequenceRuntimeReasonCodeV1 };

/**
 * Map a continuation-shell outcome onto the state machine, from the OFFERED state (the item the
 * popup was shown for). Every transition is explicit and typed; nothing throws.
 */
export function deliverSequenceContinuationOutcomeV1(
  offeredState: PromptEnhancementSequenceRuntimeStateV1,
  outcome: PromptEnhancementSequenceContinuationShellOutcomeV1,
  actionId: string,
): PromptEnhancementSequenceContinuationDeliveryV1 {
  switch (outcome.state) {
    case 'send': {
      const sent = applyPromptEnhancementSequenceRuntimeActionV1(offeredState, {
        type: 'send_current_item', actionId, itemIndex: offeredState.currentItemIndex,
      });
      if (!sent.ok) return { kind: 'reject', reasonCode: sent.reasonCode };
      return { kind: 'inject', bodyText: outcome.bodyText, nextState: sent.state };
    }
    case 'interruption': {
      const kept = applyPromptEnhancementSequenceRuntimeActionV1(offeredState, { type: 'keep_current_item', actionId });
      if (!kept.ok) return { kind: 'reject', reasonCode: kept.reasonCode };
      return { kind: 'keep', nextState: kept.state };
    }
    case 'declined': {
      // Declining (Esc) leaves the offered item pending, exactly like an interruption — it returns
      // at the next Stop. No new action is applied; the already-persisted offered state stands.
      return { kind: 'keep', nextState: offeredState };
    }
    case 'cancelled': {
      const cancelled = applyPromptEnhancementSequenceRuntimeActionV1(offeredState, { type: 'cancel_sequence', actionId });
      if (!cancelled.ok) return { kind: 'reject', reasonCode: cancelled.reasonCode };
      return { kind: 'cancel', nextState: cancelled.state };
    }
  }
}
