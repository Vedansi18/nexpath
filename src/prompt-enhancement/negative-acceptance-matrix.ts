export const PROMPT_ENHANCEMENT_B5_2_REQUIRED_DEPENDENCIES_V1 = [
  'DEP-stage-5-02',
  'DEP-TEST-01',
] as const;

export type PromptEnhancementB5_2NegativeInputV1 =
  | 'old_decision_session_rows'
  | 'product_feedback'
  | 'prompt_history'
  | 'raw_stop_reason'
  | 'selected_prompt'
  | 'clipboard_text'
  | 'last_injected_prompt'
  | 'extension_labels'
  | 'missing_host_capability'
  | 'missing_or_malformed_generated_origin';

export interface PromptEnhancementB5_2NegativeRowV1 {
  rowId: string;
  invalidInput: PromptEnhancementB5_2NegativeInputV1;
  contractRevision: string | null;
  sourceRevision: string | null;
  fixtureIds: readonly string[];
  expectedNoAuthorityOutcome: string;
  expectedUiFallback: 'blocked_no_send' | 'no_popup_not_applicable' | 'fallback_to_original' | 'typed_state_only';
  expectedNoSideEffects: readonly string[];
  owner: 'content_semantics' | 'ui_app' | 'host_transport' | 'cross_layer_acceptance';
  focusedCommand: string;
  environment: string;
  observedResult: 'not_run_pending_owner_evidence' | 'pass' | 'hard_fail';
  passFail: 'blocked_pending_owner_evidence' | 'pass' | 'hard_fail';
  evidenceRefs: readonly string[];
}

export interface PromptEnhancementB5_2NegativeAcceptanceMatrixV1 {
  packetId: 'stage-5-2-cross-layer-negative-acceptance-matrix-v1';
  status: 'acceptance_blocked_pending_owner_evidence' | 'ready_for_owner_review';
  readinessClaimAllowed: false;
  requiredDependencies: typeof PROMPT_ENHANCEMENT_B5_2_REQUIRED_DEPENDENCIES_V1;
  rows: readonly PromptEnhancementB5_2NegativeRowV1[];
  genericQaSubstitutionForbidden: true;
  oldDecisionSessionSubstitutionForbidden: true;
  transportSuccessSubstitutionForbidden: true;
  rawPrivatePayloadSubstitutionForbidden: true;
  localInferenceSubstitutionForbidden: true;
  reasonCodes: readonly string[];
}

const FOCUSED_COMMAND = 'npx vitest run src/prompt-enhancement/negative-acceptance-matrix.test.ts';
const NO_SIDE_EFFECTS = [
  'no_pe_popup_activation',
  'no_send_or_delivery',
  'no_sequence_activation',
  'no_feedback_event',
  'no_generated_origin_creation',
  'no_launch_readiness_claim',
] as const;

const ROWS: readonly PromptEnhancementB5_2NegativeRowV1[] = [
  ['stage-5-2-01', 'old_decision_session_rows', 'content_semantics', 'typed no-authority state; old Decision Session rows are not PE input', 'typed_state_only'],
  ['stage-5-2-02', 'product_feedback', 'content_semantics', 'typed no-authority state; product feedback cannot activate or explain PE', 'typed_state_only'],
  ['stage-5-2-03', 'prompt_history', 'content_semantics', 'typed no-authority state; history/served variants cannot activate PE', 'typed_state_only'],
  ['stage-5-2-04', 'raw_stop_reason', 'host_transport', 'typed no-authority state; raw Stop reason is transport data only', 'typed_state_only'],
  ['stage-5-2-05', 'selected_prompt', 'content_semantics', 'typed no-authority state; selectedPrompt cannot authorize PE', 'typed_state_only'],
  ['stage-5-2-06', 'clipboard_text', 'host_transport', 'typed no-authority state; clipboard text is not semantic or delivery proof', 'typed_state_only'],
  ['stage-5-2-07', 'last_injected_prompt', 'ui_app', 'typed no-authority state; prior injection cannot create current PE origin', 'typed_state_only'],
  ['stage-5-2-08', 'extension_labels', 'host_transport', 'typed no-authority state; visible host labels cannot create capability or completion proof', 'typed_state_only'],
  ['stage-5-2-09', 'missing_host_capability', 'host_transport', 'typed unsupported/blocked no-send state; missing capability cannot become delivery proof', 'blocked_no_send'],
  ['stage-5-2-10', 'missing_or_malformed_generated_origin', 'content_semantics', 'typed no-popup/blocked state; origin absence cannot become generated-origin proof', 'no_popup_not_applicable'],
].map(([rowId, invalidInput, owner, expectedNoAuthorityOutcome, expectedUiFallback]) => ({
  rowId,
  invalidInput,
  contractRevision: null,
  sourceRevision: null,
  fixtureIds: [],
  expectedNoAuthorityOutcome,
  expectedUiFallback,
  expectedNoSideEffects: NO_SIDE_EFFECTS,
  owner,
  focusedCommand: FOCUSED_COMMAND,
  environment: 'NO_COLOR=1; DEP-stage-5-02/DEP-TEST-01 evidence pending',
  observedResult: 'not_run_pending_owner_evidence',
  passFail: 'blocked_pending_owner_evidence',
  evidenceRefs: [],
})) as readonly PromptEnhancementB5_2NegativeRowV1[];

export function buildPromptEnhancementB5_2NegativeAcceptanceMatrixV1(): PromptEnhancementB5_2NegativeAcceptanceMatrixV1 {
  return {
    packetId: 'stage-5-2-cross-layer-negative-acceptance-matrix-v1',
    status: 'acceptance_blocked_pending_owner_evidence',
    readinessClaimAllowed: false,
    requiredDependencies: PROMPT_ENHANCEMENT_B5_2_REQUIRED_DEPENDENCIES_V1,
    rows: ROWS,
    genericQaSubstitutionForbidden: true,
    oldDecisionSessionSubstitutionForbidden: true,
    transportSuccessSubstitutionForbidden: true,
    rawPrivatePayloadSubstitutionForbidden: true,
    localInferenceSubstitutionForbidden: true,
    reasonCodes: ['dep_b5_02_evidence_missing', 'dep_test_01_evidence_missing', 'owner_fixture_oracles_pending'],
  };
}
