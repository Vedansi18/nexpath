export const PROMPT_ENHANCEMENT_B5_1B_H1_REQUIRED_DEPENDENCIES_V1 = [
  'DEP-B5-02',
  'DEP-TEST-01',
] as const;

export type PromptEnhancementB5_1bH1ConditionV1 =
  | 'shared_gate_not_permitted'
  | 'unselected_or_degraded_no_fire'
  | 'malformed_provider_timeout_or_unsupported'
  | 'valid_typed_current_body'
  | 'closed_disposition_no_side_effects';

export type PromptEnhancementB5_1bH1ExpectedSinkV1 =
  | 'no_pe_facade_call'
  | 'no_popup_not_applicable'
  | 'typed_fallback_or_blocked_no_send'
  | 'show_current_body'
  | 'typed_closed_state_no_side_effects';

export interface PromptEnhancementB5_1bH1NegativeRowV1 {
  rowId: string;
  condition: PromptEnhancementB5_1bH1ConditionV1;
  requiredDisposition: string;
  expectedSink: PromptEnhancementB5_1bH1ExpectedSinkV1;
  localTestRefs: readonly string[];
  approvedFixtureIds: readonly string[];
  contractRevision: string | null;
  exactCommand: string;
  environment: string;
  expectedNoSideEffects: readonly string[];
  forbiddenInference: readonly string[];
  oracleOwner: 'content_semantics' | 'ui_app' | 'host_transport' | 'cross_layer_acceptance';
  observedOutcome: 'not_run_pending_approved_inputs' | 'pass' | 'hard_fail';
  passFail: 'blocked_pending_approved_inputs' | 'pass' | 'hard_fail';
}

export interface PromptEnhancementB5_1bH1NegativeMapPacketV1 {
  packetId: 'negative-disposition-map-v1';
  status: 'acceptance_blocked_pending_approved_inputs' | 'ready_for_execution';
  readinessClaimAllowed: false;
  requiredDependencies: typeof PROMPT_ENHANCEMENT_B5_1B_H1_REQUIRED_DEPENDENCIES_V1;
  rows: readonly PromptEnhancementB5_1bH1NegativeRowV1[];
  consumesExistingRunAutoPacket: true;
  sharedGateMeaningChanged: false;
  classifierReordered: false;
  hostTransportImplemented: false;
  legacyAuthorityCreated: false;
  reasonCodes: readonly string[];
}

const FOCUSED_COMMAND = 'npx vitest run src/cli/commands/auto.test.ts -t "stage-5-1b-H1"';

const COMMON_NO_SIDE_EFFECTS = [
  'no_pe_popup_session',
  'no_pe_body_mutation',
  'no_send_intent',
  'no_delivery_state',
  'no_sequence_activation',
  'no_feedback_or_completion_event',
] as const;

const COMMON_FORBIDDEN = [
  'hold_or_replace_submitted_prompt',
  'automatic_send',
  'host_delivery_claim',
  'legacy_decision_session_authority',
  'raw_transport_authority',
] as const;

const ROWS: readonly PromptEnhancementB5_1bH1NegativeRowV1[] = [
  {
    rowId: 'stage-5-1b-H1-01',
    condition: 'shared_gate_not_permitted',
    requiredDisposition: 'no PE-facade call; no PE disposition fabricated',
    expectedSink: 'no_pe_facade_call',
    localTestRefs: ['auto.test.ts::keeps the PE facade at zero calls across representative shared early gates'],
    approvedFixtureIds: [], contractRevision: null, exactCommand: FOCUSED_COMMAND,
    environment: 'NO_COLOR=1; approved H1 contract/source revision pending',
    expectedNoSideEffects: COMMON_NO_SIDE_EFFECTS,
    forbiddenInference: [...COMMON_FORBIDDEN, 'rerun_classifier', 'generic_prompt_authority'],
    oracleOwner: 'cross_layer_acceptance', observedOutcome: 'not_run_pending_approved_inputs', passFail: 'blocked_pending_approved_inputs',
  },
  {
    rowId: 'stage-5-1b-H1-02',
    condition: 'unselected_or_degraded_no_fire',
    requiredDisposition: 'no PE-facade call or validated no_popup_not_applicable',
    expectedSink: 'no_popup_not_applicable',
    localTestRefs: ['auto.test.ts::passes validated current, original-fallback, and no-popup dispositions without inventing UI authority'],
    approvedFixtureIds: [], contractRevision: null, exactCommand: FOCUSED_COMMAND,
    environment: 'NO_COLOR=1; approved H1 contract/source revision pending',
    expectedNoSideEffects: COMMON_NO_SIDE_EFFECTS,
    forbiddenInference: [...COMMON_FORBIDDEN, 'metadata_to_popup', 'metadata_to_body', 'metadata_to_delivery'],
    oracleOwner: 'content_semantics', observedOutcome: 'not_run_pending_approved_inputs', passFail: 'blocked_pending_approved_inputs',
  },
  {
    rowId: 'stage-5-1b-H1-03',
    condition: 'malformed_provider_timeout_or_unsupported',
    requiredDisposition: 'validated fallback_to_original, blocked_no_send, or no_popup_not_applicable',
    expectedSink: 'typed_fallback_or_blocked_no_send',
    localTestRefs: ['auto.test.ts::rejects invalid request/result and facade errors into typed no-popup fallback'],
    approvedFixtureIds: [], contractRevision: null, exactCommand: FOCUSED_COMMAND,
    environment: 'NO_COLOR=1; approved H1 contract/source revision pending',
    expectedNoSideEffects: COMMON_NO_SIDE_EFFECTS,
    forbiddenInference: [...COMMON_FORBIDDEN, 'user_selected_fallback_inference', 'prompt_mutation'],
    oracleOwner: 'content_semantics', observedOutcome: 'not_run_pending_approved_inputs', passFail: 'blocked_pending_approved_inputs',
  },
  {
    rowId: 'stage-5-1b-H1-04',
    condition: 'valid_typed_current_body',
    requiredDisposition: 'show_current_body',
    expectedSink: 'show_current_body',
    localTestRefs: ['auto.test.ts::passes validated current, original-fallback, and no-popup dispositions without inventing UI authority'],
    approvedFixtureIds: [], contractRevision: null, exactCommand: FOCUSED_COMMAND,
    environment: 'NO_COLOR=1; approved H1 contract/source revision pending',
    expectedNoSideEffects: ['no_delivery_proof_from_render', 'no_execution_proof_from_focus_or_text', 'no_host_transport_claim'],
    forbiddenInference: ['render_to_delivery', 'focus_to_execution', 'legacy_field_authority', 'transport_field_authority'],
    oracleOwner: 'ui_app', observedOutcome: 'not_run_pending_approved_inputs', passFail: 'blocked_pending_approved_inputs',
  },
  {
    rowId: 'stage-5-1b-H1-05',
    condition: 'closed_disposition_no_side_effects',
    requiredDisposition: 'preserve unrelated runtime; keep typed fallback/blocked/no-popup state no-send',
    expectedSink: 'typed_closed_state_no_side_effects',
    localTestRefs: ['auto.test.ts::passes validated current, original-fallback, and no-popup dispositions without inventing UI authority'],
    approvedFixtureIds: [], contractRevision: null, exactCommand: FOCUSED_COMMAND,
    environment: 'NO_COLOR=1; approved H1 contract/source revision pending',
    expectedNoSideEffects: COMMON_NO_SIDE_EFFECTS,
    forbiddenInference: [...COMMON_FORBIDDEN, 'suppress_unrelated_decision_session', 'alter_product_feedback'],
    oracleOwner: 'cross_layer_acceptance', observedOutcome: 'not_run_pending_approved_inputs', passFail: 'blocked_pending_approved_inputs',
  },
];

export function buildPromptEnhancementB5_1bH1NegativeMapV1(): PromptEnhancementB5_1bH1NegativeMapPacketV1 {
  return {
    packetId: 'negative-disposition-map-v1',
    status: 'acceptance_blocked_pending_approved_inputs',
    readinessClaimAllowed: false,
    requiredDependencies: PROMPT_ENHANCEMENT_B5_1B_H1_REQUIRED_DEPENDENCIES_V1,
    rows: ROWS,
    consumesExistingRunAutoPacket: true,
    sharedGateMeaningChanged: false,
    classifierReordered: false,
    hostTransportImplemented: false,
    legacyAuthorityCreated: false,
    reasonCodes: ['approved_h1_contract_revision_missing', 'approved_fixture_ids_missing', 'negative_fixture_execution_pending'],
  };
}
