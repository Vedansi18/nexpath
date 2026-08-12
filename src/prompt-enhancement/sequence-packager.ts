import type {
  PromptEnhancementFutureSequenceRuntimeEventV1,
  PromptEnhancementHandoffMetadataV1,
  PromptEnhancementPrepareResultV1,
} from './contracts.js';
import type { PromptEnhancementSequenceItemV1 } from './sequence-payload.js';

/**
 * The Stop-time packager.
 *
 * At every continuation Stop it READS item N's stored parts and packages them as the result the
 * popup builder expects. It composes nothing. That is not a division of labour but the whole
 * mechanism behind "same item, same text": there is no path here that could produce different
 * wording, so an item offered, interrupted, and offered again comes back byte-identical because
 * nothing between the two readings can change it.
 *
 * It reports safety verdicts and never produces them. A packager that filled in a validation status
 * would be asserting a verdict nobody computed, on a body the user is one keystroke from sending —
 * worse than showing no popup at all.
 *
 * And it does not deduplicate. A replayed event makes it re-read and re-package, which is harmless
 * precisely because the text is identical; what must not happen twice is the POINTER ADVANCING, and
 * that is guarded one layer down by the action id, in the only place that can see the transition.
 */

/** The two numbers the continuation popup needs and the contract never carried. */
export interface PromptEnhancementSequenceProgressV1 {
  /**
   * Items behind the current one.
   *
   * This is `currentItemIndex` itself: the index is 0-based and item 0 was already sent at intake,
   * so the count of items already dealt with IS the index.
   */
  done: number;
  /** The whole item count — the same total the first popup showed. */
  total: number;
}

export interface PromptEnhancementSequencePackagerInputV1 {
  /**
   * The prepare result the accepted sequence was offered from.
   *
   * Structure only. Route, plan, policy and UI shape are carried from it unchanged and the body is
   * swapped, because those describe the sequence rather than any one item — and rebuilding them
   * here would mean deciding them again at a Stop, which is composition by another name.
   */
  acceptedResult: PromptEnhancementPrepareResultV1;
  /** The stored item list, exactly as written. */
  items: readonly PromptEnhancementSequenceItemV1[];
  /**
   * Which item to serve. 0-BASED, and index 0 is the first prompt, already sent at intake — so a
   * continuation is always 1 … itemCount-1.
   */
  currentItemIndex: number;
  /** From the sequence row. Stored once and read here rather than counted again. */
  itemCount: number;
  sequenceId: string;
  sequenceItemId: string;
  currentItemRevision: number;
  /** The revision this body carries. The event must agree with it or the popup refuses. */
  bodyRevision: number;
  currentBodyId: string;
  nexpathGeneratedPromptRef: string;
}

/** The two kinds a continuation popup accepts. Anything else is refused at the popup boundary. */
const CONTINUATION_HANDOFF_KINDS_V1: readonly PromptEnhancementHandoffMetadataV1['handoffKind'][] = [
  'first_prompt_handoff_candidate',
  'compact_sequence_summary_candidate',
];

export type PromptEnhancementSequencePackagerRefusalV1 =
  | 'accepted_result_has_no_handoff_metadata'
  | 'handoff_kind_not_continuable'
  | 'index_is_the_first_item'
  | 'index_out_of_range'
  | 'item_count_disagrees_with_items'
  | 'item_wording_missing'
  | 'item_safety_verdict_missing';

export interface PromptEnhancementSequencePackagedContinuationV1 {
  result: PromptEnhancementPrepareResultV1;
  /**
   * Re-pointed at the body it accompanies, not carried across unchanged.
   *
   * It is validated AGAINST the current body — the id and the revision are compared — and the
   * packager swaps both. The accepted sequence's own metadata therefore mismatches by construction,
   * which is why "carry it through" is not available however much it looks like the cheap option.
   */
  handoffMetadata: PromptEnhancementHandoffMetadataV1;
  event: PromptEnhancementFutureSequenceRuntimeEventV1;
  progress: PromptEnhancementSequenceProgressV1;
}

export type PromptEnhancementSequencePackagerResultV1 =
  | { ok: true; packaged: PromptEnhancementSequencePackagedContinuationV1 }
  | { ok: false; refusal: PromptEnhancementSequencePackagerRefusalV1 };

/**
 * Package item N.
 *
 * Every refusal here is a state that should already be impossible, and each is refused rather than
 * compensated for. An item with no wording means the row failed its read invariant and was scrubbed
 * before this ran; the packager must not answer that by composing, by skipping to the next item, or
 * by serving an empty body. Serving nothing is the correct outcome of a state that cannot occur.
 */
export function packagePromptEnhancementSequenceContinuationV1(
  input: PromptEnhancementSequencePackagerInputV1,
): PromptEnhancementSequencePackagerResultV1 {
  if (input.items.length !== input.itemCount) {
    return { ok: false, refusal: 'item_count_disagrees_with_items' };
  }
  // Index 0 is the prompt the user already sent. Offering it again is not a continuation.
  if (input.currentItemIndex === 0) return { ok: false, refusal: 'index_is_the_first_item' };
  if (!Number.isSafeInteger(input.currentItemIndex)
    || input.currentItemIndex < 0
    || input.currentItemIndex >= input.items.length) {
    return { ok: false, refusal: 'index_out_of_range' };
  }

  const accepted = input.acceptedResult.handoffMetadata;
  // An accepted sequence was offered through this metadata, so its absence is not a shape the
  // packager can fill in — there is no structure to re-point.
  if (accepted === undefined) {
    return { ok: false, refusal: 'accepted_result_has_no_handoff_metadata' };
  }
  if (!CONTINUATION_HANDOFF_KINDS_V1.includes(accepted.handoffKind)) {
    return { ok: false, refusal: 'handoff_kind_not_continuable' };
  }

  const item = input.items[input.currentItemIndex] as PromptEnhancementSequenceItemV1;
  if (item.generatedWording === null || item.generatedWording.trim().length === 0) {
    return { ok: false, refusal: 'item_wording_missing' };
  }
  // Reported, never produced. Without a stored verdict there is nothing to report, and inventing
  // one is the failure this refusal exists to make impossible.
  if (item.itemValidationGraph === null) {
    return { ok: false, refusal: 'item_safety_verdict_missing' };
  }

  const result: PromptEnhancementPrepareResultV1 = {
    ...input.acceptedResult,
    // A continuation popup exists to show the current body. The accepted result's disposition was a
    // decision about a different body, and left as it was every continuation is refused.
    disposition: 'show_current_body',
    currentBody: {
      ...input.acceptedResult.currentBody,
      currentBodyId: input.currentBodyId,
      bodyRevision: input.bodyRevision,
      // The stored wording, unchanged. This is the only field the item list supplies directly, and
      // reading it is the entirety of what "packaging" means.
      renderedPromptBody: item.generatedWording,
      // Not bookkeeping: this is the one bit that says Nexpath wrote this body. Marked as the
      // user's, a continuation re-enters the planner and plans a sequence out of our own writing.
      sentPromptOrigin: 'sequence_handoff_owned_body',
      nexpathGeneratedPromptRef: input.nexpathGeneratedPromptRef,
    },
    // The verdict the item carries, passed through. Not recomputed at the Stop either: re-running a
    // check on frozen text can only agree with itself or contradict itself, and a contradiction has
    // no defined handling.
    validationGraph: item.itemValidationGraph,
  };

  const handoffMetadata: PromptEnhancementHandoffMetadataV1 = {
    ...accepted,
    // The two fields it is validated against, taken from the body just built rather than the one it
    // was written for.
    currentBodyId: input.currentBodyId,
    bodyRevision: input.bodyRevision,
    // True because the two lines above just made it true, for this revision.
    currentBodyValidityState: 'valid_for_current_body_revision',
    // A carry, not a computation: the packager reports the safety state and never decides it.
    riskConfirmationState: input.acceptedResult.safetySummary.sensitiveActionState,
  };

  const event: PromptEnhancementFutureSequenceRuntimeEventV1 = {
    requestId: input.acceptedResult.requestId,
    projectScope: input.acceptedResult.projectRoot,
    sequenceId: input.sequenceId,
    sequenceItemId: input.sequenceItemId,
    currentItemRevision: input.currentItemRevision,
    currentItemIndex: input.currentItemIndex,
    // The popup refuses unless this matches the body it is shown with.
    bodyRevision: input.bodyRevision,
    contractVersion: 1,
    stateFreshness: 'current',
    continuationActionState: 'continue_current_item',
    terminalTransitionState: 'none',
    // A Stop is the user's decision point and NOT proof the previous item finished. Both accepted
    // values say so in their own names, and nothing in the system could supply that proof.
    stopEventState: 'stop_fired_non_proof',
  };

  return {
    ok: true,
    packaged: {
      result,
      handoffMetadata,
      event,
      progress: {
        // Never the summary's remaining count. That figure is fixed at items.length - 1 on the
        // first popup; giving it a second, live meaning here is the same overload that produced the
        // item-count defect — one name, two quantities, and the wrong one rendered.
        done: input.currentItemIndex,
        total: input.itemCount,
      },
    },
  };
}
