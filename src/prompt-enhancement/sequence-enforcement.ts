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
import {
  isPromptEnhancementSequenceOffsetRangeV1,
  type PromptEnhancementSequenceOffsetRangeV1,
} from './sequence-payload.js';

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

/**
 * The safety fields the AUTHORITY CHECK does not decide, and only those.
 *
 * The two it does decide are absent by construction rather than by convention. Supplied, they would
 * have to be supplied before the check ran — which is the only order available to a caller — so the
 * graph would carry a summary asserting a verdict the failures beside it might contradict. §5.3's
 * whole correction is that a result's graph and its summary can never describe different runs, and
 * a caller cannot honour that for a question it has not asked yet.
 */
export type PromptEnhancementSequenceItemSafetyInputV1 =
  Omit<PromptEnhancementSafetySummaryV1, 'validationStatus' | 'authorityEscalationState'>;

/** What one item's wording is checked against, and the identity the failures point at. */
export interface PromptEnhancementSequenceItemCheckInputV1 {
  /** The item's own slice, whose authority the wording may not exceed. Null on kinds with none. */
  sliceText: string | null;
  /** What the composer wrote for this item. */
  generatedWording: string;
  /** So a failure names the item it belongs to rather than the sequence. */
  sequenceItemId: string;
  /**
   * The posture the check does not decide — how the body was produced, not whether it passed.
   *
   * The sequence's source and privacy states are carried; whether a required floor is present is
   * the composer's finding and arrives here already made. ⛔ The validation status and the authority
   * escalation state are NOT among them: this function answers those.
   */
  safetyState: PromptEnhancementSequenceItemSafetyInputV1;
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
  // Written from the failures this function just produced, never taken from the caller. The two
  // fields ARE the check's answer, so a summary that carried them in would be stating the verdict
  // before the question was asked — and the graph would then hold a summary saying `valid` beside
  // a blocking authority failure, which is the self-contradicting record §5.3 exists to rule out.
  const status = hasBlockingFailure ? 'invalid_non_sendable' : 'valid';
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
    safetyState: {
      ...input.safetyState,
      validationStatus: status,
      authorityEscalationState: status,
    },
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
  /**
   * The body the packager served — item N's stored wording, before the user touched it.
   *
   * The floor's position indexes THIS text, so the two arrive together or neither is usable.
   */
  servedBodyText: string;
  /** The body as the user is about to send it, edits and all. */
  sentBodyText: string;
  /**
   * Where the safety floor sits inside the served body, as stored with the wording. Null on every
   * item that needed none, which is most items.
   *
   * A recorded position rather than a rule for recognising safety sentences. The floor is written
   * by the composer in its own words, so there is no fixed sentence to look for, and deciding which
   * sentence "looks like" a safeguard is the inference the standing constraint bars — it would fail
   * in both directions, protecting an ordinary sentence and missing a real floor.
   */
  safetyClauseRef: PromptEnhancementSequenceOffsetRangeV1 | null;
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
  // Resolved against the served body, never against the sent one. Reading the range out of the
  // edited text would move it under every edit above the floor and report on whatever landed at
  // those offsets — which is how a check like this comes to guard the wrong sentence silently.
  const clause = input.safetyClauseRef !== null
    && isPromptEnhancementSequenceOffsetRangeV1(input.safetyClauseRef, input.servedBodyText.length)
    ? input.servedBodyText.slice(input.safetyClauseRef.start, input.safetyClauseRef.end)
    : null;
  const removed = clause !== null
    && clause.trim().length > 0
    && !input.sentBodyText.includes(clause);

  const failures: PromptEnhancementValidationFailureV1[] = !removed ? [] : [{
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
    validityState: removed
      ? 'invalid_due_user_edit_or_safety_removal'
      : 'valid_for_current_body_revision',
    failures,
    phaseState: validatePromptEnhancementUserEditPhase({
      failures,
      hasBlockingFailure: failures.length > 0,
      fallbackMode: 'none',
    }),
  };
}
