import { PROMPT_ENHANCEMENT_CONTRACT_VERSION } from './contracts.js';
import type { PromptEnhancementAcceptanceFixtureV1 } from './acceptance-matrix.js';

/**
 * The defaults every acceptance fixture inherits, in one place.
 *
 * Lifted out of the matrix so a second register can declare fixtures without copying them. A copy
 * would be the failure the matrix exists to prevent, one level up: two sets of defaults drifting
 * while every fixture built from either still validates.
 *
 * The type import is type-only, so this module has no runtime edge back to the matrix.
 *
 * ⛔ `actualResult` and `hardFailResult` default to `not_run_shape_only` and a caller must not pass
 * `pass` for either. A fixture is SHAPE-DEFINED when it is placed; marking one as passing is what
 * turns a written register into a claimed one, and the packet forbids reading it that way.
 */
export function promptEnhancementAcceptanceFixtureV1(
  input: Partial<PromptEnhancementAcceptanceFixtureV1> & Pick<
    PromptEnhancementAcceptanceFixtureV1,
    | 'fixtureId'
    | 'family'
    | 'inputPrompt'
    | 'expectedFamily'
    | 'expectedIntent'
    | 'expectedCapability'
    | 'mandatorySlotsOrSafeguards'
    | 'sourceReasonMetadata'
    | 'evidenceSourceKinds'
    | 'registryLinkedFixtureIds'
    | 'hardFailFocus'
  >,
): PromptEnhancementAcceptanceFixtureV1 {
  return {
    owner: input.owner ?? 'content_semantics',
    version: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
    sourceContextClass: input.sourceContextClass ?? 'current_source_plus_pe_fixture',
    projectSourceScope: 'current_project_only',
    expectedPopupState: input.expectedPopupState ?? 'popup',
    currentEditableBodyState: input.currentEditableBodyState ?? 'current_body_required_when_popup',
    memoryFatigueFeedbackState: input.memoryFatigueFeedbackState ?? ['neutral_or_explicit_fixture_state'],
    actionAvailability: input.actionAvailability ?? ['use_current_body', 'use_original', 'shorter', 'more_thorough', 'more_project_grounded', 'apply_details', 'feedback', 'close'],
    fallbackCostProviderState: input.fallbackCostProviderState ?? ['provider_available_or_public_safe_fallback', 'cost_visibility_cannot_weaken_behavior'],
    generatedOriginState: input.generatedOriginState ?? ['ordinary_user_prompt_or_typed_pe_origin_only'],
    privacyExpectation: input.privacyExpectation ?? ['ids_counts_status_only', 'raw_prompt_body_source_feedback_excluded'],
    expectedObservableOutcome: input.expectedObservableOutcome ?? ['typed_contract_state_or_public_safe_reason_code'],
    actualResult: input.actualResult ?? 'not_run_shape_only',
    rubricObservations: input.rubricObservations ?? ['owner_oracle_required_before_readiness_claim'],
    hardFailResult: input.hardFailResult ?? 'not_run_shape_only',
    reproducibleEvidence: input.reproducibleEvidence ?? [`test:${input.fixtureId}`],
    linkedOwnerDecision: input.linkedOwnerDecision ?? null,
    oracleIds: input.oracleIds ?? [`oracle:${input.fixtureId}`],
    ...input,
  };
}
