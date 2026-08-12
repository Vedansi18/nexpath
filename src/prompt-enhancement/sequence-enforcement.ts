import type {
  PromptEnhancementCallVisibilityMode,
  PromptEnhancementHandoffMetadataV1,
  PromptEnhancementSafetySummaryV1,
  PromptEnhancementValidationFailureV1,
  PromptEnhancementValidationGraphV1,
} from './contracts.js';
import {
  promptEnhancementGeneratedEscalatesAuthorityV1,
  validatePromptEnhancementSequencePhase,
  validatePromptEnhancementUserEditPhase,
} from './safety-sendability.js';

/**
 * The two enforcement times that had a label and no location.
 *
 * Four moments carry rules. Planning and reading already have somewhere that runs them — the planner
 * and the stored-payload validator. Composition and the edit did not: "composition-time" named a
 * moment, and the check it referred to lived in a function nothing outside its own module could
 * call.
 *
 * Both checks here report THROUGH the phase validators that already ship rather than beside them.
 * That is not tidiness. The stored verdict is a validation GRAPH, and a graph is made of phase
 * states and failures — a check that runs outside the phase architecture produces neither, so the
 * graph would have to be assembled by hand, which is the fabrication the packager is forbidden.
 */

/** What one item's wording is checked against, and the identity the failures point at. */
export interface PromptEnhancementSequenceItemCheckInputV1 {
  /** The item's own slice, whose authority the wording may not exceed. Null on kinds with none. */
  sliceText: string | null;
  /** What the composer wrote for this item. */
  generatedWording: string;
  /** So a failure names the item it belongs to rather than the sequence. */
  sequenceItemId: string;
  /** Carried onto the graph unchanged: it describes how the body was produced, not whether it passed. */
  safetyState: PromptEnhancementSafetySummaryV1;
  providerRuntimeState: PromptEnhancementCallVisibilityMode;
  optionalCallAvailabilityState: PromptEnhancementValidationGraphV1['optionalCallAvailabilityState'];
}

/**
 * The per-item authority check, as a stored verdict.
 *
 * The hole it closes: the single-prompt validator runs on the single-prompt body and never on
 * per-item wording, and every sequence item IS a generated body. Without this, a slice that asked
 * for a plan can be worded as an instruction to carry the work out and nothing in the system
 * notices.
 *
 * It calls the shipping helper. Not a copy of it — the shipping one is the copy that was hardened,
 * and a second would drift from it while looking identical at the call site.
 *
 * The verdict is produced ONCE, with the wording, and stored beside it. Re-running it at each Stop
 * was the alternative and it has no defined outcome: a second run over frozen text can only agree
 * with itself or contradict itself, and a contradiction arrives with the user already holding a body
 * the engine accepted.
 */
export function buildPromptEnhancementSequenceItemValidationGraphV1(
  input: PromptEnhancementSequenceItemCheckInputV1,
): PromptEnhancementValidationGraphV1 {
  const failures: PromptEnhancementValidationFailureV1[] = [];

  // A kind that carries no slice has no authority of its own to exceed, so there is nothing to
  // compare against — not a pass by default, an absence of the question.
  if (input.sliceText !== null
    && promptEnhancementGeneratedEscalatesAuthorityV1(input.sliceText, input.generatedWording)) {
    failures.push({
      failureCode: 'sequence_item_wording_exceeds_slice_authority',
      stage: 'sequence',
      severity: 'blocking',
      blocking: true,
      affectedSectionIds: [],
      affectedBodySpanRefs: [input.sequenceItemId],
      affectedSourceRefIds: [],
      affectedActionIds: [],
      publicSafeReasonCategory: 'validation_failed',
      privateDebugDetailPolicy: 'none',
    });
  }

  const hasBlockingFailure = failures.some((failure) => failure.blocking);
  return {
    graphVersion: 1,
    graphOwner: 'content_semantics',
    // Reported through the slot named for exactly this case. The phase state is what makes the
    // stored graph a graph rather than a summary with empty arrays beside it.
    phaseStates: [
      validatePromptEnhancementSequencePhase({
        failures,
        hasBlockingFailure,
        fallbackMode: 'none',
      }),
    ],
    failures,
    safetyState: input.safetyState,
    providerRuntimeState: input.providerRuntimeState,
    optionalCallAvailabilityState: input.optionalCallAvailabilityState,
    // Neither may be flipped to make a sequence check fit. Nexpath does not read agent replies, and
    // what the transport carried is never proof that anything was validated.
    rawTransportIsValidationProof: false,
    evaluatesAgentResponseQuality: false,
    // A Stop is the user's decision point, never proof the previous item finished — so nothing here
    // may advance the pointer on its own.
    canAutoAdvanceSequencePointer: false,
  };
}

/**
 * What the user did to the body before sending it.
 *
 * A STATE and never a boolean. The lock is explicit that a generic boolean is not enough: a reader
 * has to be able to tell a body-revision change from a safety removal, and one bit cannot say which.
 */
export type PromptEnhancementSequenceEditValidityV1 =
  PromptEnhancementHandoffMetadataV1['currentBodyValidityState'];

export interface PromptEnhancementSequenceEditCheckInputV1 {
  /** The body as the user is about to send it, edits and all. */
  sentBodyText: string;
  /**
   * The safety sentences this item was composed with — the confirmation floor, a sensitive-action
   * marker. Empty when the item carried none, which is most items.
   *
   * Supplied rather than re-derived. Deriving them from the sent body is circular: the question is
   * whether something that WAS there still is.
   */
  requiredSafetyClauses: readonly string[];
  sequenceItemId: string;
}

export interface PromptEnhancementSequenceEditCheckResultV1 {
  validityState: PromptEnhancementSequenceEditValidityV1;
  failures: readonly PromptEnhancementValidationFailureV1[];
  phaseState: ReturnType<typeof validatePromptEnhancementUserEditPhase>;
}

/**
 * Does the safety requirement survive the edit?
 *
 * ONE question, and the narrowness is the rule rather than a simplification of it. An ordinary edit
 * passes through untouched — not tidied, not second-guessed, not compared against what the composer
 * wrote. Widened even slightly, every edit becomes a negotiation with the engine, and the user stops
 * trusting that the text they typed is the text that gets sent.
 *
 * So an edit that leaves the safety clauses in place returns the SAME state an unedited body has.
 * Only their removal produces a different one, and the value is the one named for that case.
 */
export function checkPromptEnhancementSequenceEditV1(
  input: PromptEnhancementSequenceEditCheckInputV1,
): PromptEnhancementSequenceEditCheckResultV1 {
  const removed = input.requiredSafetyClauses.filter(
    (clause) => clause.trim().length > 0 && !input.sentBodyText.includes(clause),
  );

  const failures: PromptEnhancementValidationFailureV1[] = removed.length === 0 ? [] : [{
    failureCode: 'sequence_item_safety_clause_removed_by_edit',
    stage: 'user_edit',
    severity: 'blocking',
    blocking: true,
    affectedSectionIds: [],
    affectedBodySpanRefs: [input.sequenceItemId],
    affectedSourceRefIds: [],
    affectedActionIds: [],
    publicSafeReasonCategory: 'validation_failed',
    privateDebugDetailPolicy: 'none',
  }];

  return {
    // An ordinary edit does not move this. The edit re-runs nothing and invalidates nothing, and a
    // state that flipped on any edit would be reporting interference that is not happening.
    validityState: removed.length === 0
      ? 'valid_for_current_body_revision'
      : 'invalid_due_user_edit_or_safety_removal',
    failures,
    phaseState: validatePromptEnhancementUserEditPhase({
      failures,
      hasBlockingFailure: failures.length > 0,
      fallbackMode: 'none',
    }),
  };
}
