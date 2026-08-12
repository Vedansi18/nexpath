import type {
  PromptEnhancementActionType,
  PromptEnhancementValidationStatus,
  PromptEnhancementFutureSequenceRuntimeEventV1,
  PromptEnhancementHandoffMetadataV1,
  PromptEnhancementPrepareResultV1,
  PromptEnhancementSafetySummaryV1,
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
  /**
   * The safety decision identity for THIS body revision.
   *
   * It is bound to the body id and the revision as a triple, so inheriting it while swapping the
   * other two leaves the result naming a decision that belongs to the first prompt. It arrives with
   * the body for the same reason the verdict does: the packager reports both and produces neither.
   */
  validationDecisionId: string;
  /**
   * The run that produced THIS text — the batch, not the composer run that wrote the first prompt.
   */
  composerRunId: string;
  /**
   * The safety verdict for THIS item, as the three fields a result carries it in.
   *
   * All three or none. The graph alone, set beside the first body's summaries, produces a result
   * whose graph describes one body and whose summaries describe another — and a safety claim nobody
   * made about this body is the outcome the fabrication rule exists to prevent, arrived at by
   * mixing rather than by inventing.
   *
   * They travel WITH the item for the same reason the verdict does: the packager reports the
   * verdict and never computes it. Where they are stored is the per-item check's contract to
   * settle, not this component's.
   */
  itemSafetySummary: PromptEnhancementSafetySummaryV1;
  itemValidationSummary: PromptEnhancementSafetySummaryV1;
  /** The validation status this body was cleared under, arriving with the rest of its verdict. */
  itemGeneratedSafeStatus: PromptEnhancementValidationStatus;
  /**
   * The handoff decision for THIS body.
   *
   * One decision is made once, about the body the sequence was offered from. Carried onto every
   * continuation it becomes the source ref recorded as this item's evidence — a trail of four
   * references to one decision that was made about none of them.
   */
  handoffDecisionId: string;
}

/**
 * What a continuation surface actually offers.
 *
 * The first popup's list cannot be carried across. Two of its entries — `shorter` and
 * `apply_details` — are full re-plans, and a continuation is past activation, where an item is
 * never regenerated at all: the result would be advertising, on a frozen sequence, the two actions
 * whose whole effect is to unfreeze it. Each entry also carries the body id and revision it belongs
 * to, so a carried entry points at the previous body as well.
 *
 * Absent rather than present-and-disabled. A disabled `Shorter` still says the sequence has one.
 */
const CONTINUATION_ACTION_TYPES_V1: readonly PromptEnhancementActionType[] = [
  'use_current_body',
  'close',
];

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
    // Names the decision for the revision below, not the one the first prompt was cleared under.
    validationDecisionId: input.validationDecisionId,
    currentBody: {
      ...input.acceptedResult.currentBody,
      currentBodyId: input.currentBodyId,
      bodyRevision: input.bodyRevision,
      composerRunId: input.composerRunId,
      // The stored wording, unchanged. This is the only field the item list supplies directly, and
      // reading it is the entirety of what "packaging" means.
      //
      // BOTH fields. The body carries its text twice and they are required to be equal, so setting
      // one leaves a result whose rendered body is item N and whose text is still the first prompt
      // — the packager serving the wrong prompt while every field it was asked about looked right.
      renderedPromptBody: item.generatedWording,
      text: item.generatedWording,
      // Not bookkeeping: this is the one bit that says Nexpath wrote this body. Marked as the
      // user's, a continuation re-enters the planner and plans a sequence out of our own writing.
      sentPromptOrigin: 'sequence_handoff_owned_body',
      nexpathGeneratedPromptRef: input.nexpathGeneratedPromptRef,
      // The FOURTH copy of the same bit. Three of them said Nexpath wrote this and this one still
      // said the first prompt did; nothing type-checks the difference, because each is only
      // required to be a string.
      generatedOriginState: 'pe_generated_body',
      // Nobody has touched this body — it has not been shown yet. Inherited from a body the user
      // DID edit, it says they edited a prompt they have not seen, on the field the never-interfere
      // ruling turns on.
      userDirtyState: 'clean',
      // Arrives with the rest of the item's verdict, for the same reason the summaries do.
      generatedSafeStatus: input.itemGeneratedSafeStatus,
    },
    // The composer boundary carries its OWN copy of the origin, and one updated while the other is
    // not is worse than neither: whichever a reader consults then decides whether a continuation
    // re-enters the planner, and nothing says which wins. They move together.
    composerBoundary: {
      ...input.acceptedResult.composerBoundary,
      composerRunId: input.composerRunId,
      sentPromptOrigin: 'sequence_handoff_owned_body',
      nexpathGeneratedPromptRef: input.nexpathGeneratedPromptRef,
    },
    // Only what this surface offers, re-pointed at the body the entries now belong to.
    availableActions: input.acceptedResult.availableActions
      .filter((action) => CONTINUATION_ACTION_TYPES_V1.includes(action.actionType))
      .map((action) => ({
        ...action,
        currentBodyId: input.currentBodyId,
        bodyRevision: input.bodyRevision,
      })),
    // The verdict the item carries, passed through. Not recomputed at the Stop either: re-running a
    // check on frozen text can only agree with itself or contradict itself, and a contradiction has
    // no defined handling.
    // The third entry in the same origin row as the two fields above, and the one that carries the
    // echo guard. A continuation body Nexpath wrote, still described as the first prompt's origin,
    // is the same bit read from a different place and answered differently.
    generatedOrigin: {
      ...input.acceptedResult.generatedOrigin,
      bodyId: input.currentBodyId,
      bodyRevision: input.bodyRevision,
      generatedOriginState: 'pe_generated_body',
      echoRecursionGuard: {
        ...input.acceptedResult.generatedOrigin.echoRecursionGuard,
        sourcePromptEchoState: 'pe_generated_echo',
      },
    },
    validationGraph: item.itemValidationGraph,
    safetySummary: input.itemSafetySummary,
    validationSummary: input.itemValidationSummary,
    // Assigned below, once it exists. The result carries its own copy of the metadata and two
    // copies pointing at different bodies is the failure this whole pass keeps finding.
    handoffMetadata: undefined,
  };

  const handoffMetadata: PromptEnhancementHandoffMetadataV1 = {
    ...accepted,
    handoffDecisionId: input.handoffDecisionId,
    // The two fields it is validated against, taken from the body just built rather than the one it
    // was written for.
    currentBodyId: input.currentBodyId,
    bodyRevision: input.bodyRevision,
    // True because the two lines above just made it true, for this revision.
    currentBodyValidityState: 'valid_for_current_body_revision',
    // From THIS item's verdict, and specifically from the VALIDATION summary: that is the field the
    // completeness check compares this against, and the two summaries are separate fields that can
    // hold different states.
    riskConfirmationState: input.itemValidationSummary.sensitiveActionState,
    // Named for the first popup and REQUIRED by the contract for exactly the two kinds a
    // continuation carries — dropping it fails the metadata outright. So it stays, re-pointed at
    // this body like everything else, and what keeps the numbers straight is that the progress
    // pair is a separate carrier: this one is bound metadata, not what that surface renders.
    compactFirstPopupSequenceSummary: accepted.compactFirstPopupSequenceSummary === undefined
      ? undefined
      : {
        ...accepted.compactFirstPopupSequenceSummary,
        currentBodyId: input.currentBodyId,
        bodyRevision: input.bodyRevision,
      },
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
      // One value in both places. Two objects that have to be kept in step is how the previous
      // body's metadata survived beside the current one's.
      result: { ...result, handoffMetadata },
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
