import {
  PROMPT_ENHANCEMENT_CONTRACT_VERSION,
  type PromptEnhancementFutureSequenceRuntimeGateEvidenceV1,
  type PromptEnhancementFutureSequenceRuntimeGateInputV1,
  type PromptEnhancementFutureSequenceRuntimeGateResultV1,
  type PromptEnhancementFutureSequenceRuntimeMissingGateCodeV1,
  type PromptEnhancementFutureSequenceRuntimeOperationV1,
  type PromptEnhancementHandoffMetadataV1,
} from './contracts.js';

const REQUIRED_GATE_CODES: readonly PromptEnhancementFutureSequenceRuntimeMissingGateCodeV1[] = [
  'lifecycle_policy_pending',
  'engine_receiver_contract_pending',
  'future_sequence_runtime_source_pending',
  'cost_numeric_acceptance_pending',
  'cross_layer_snapshot_pending',
  'signed_owner_by_deliverable_register_pending',
  'pending_named_owner_register_rows_pending',
  'host_hold_commit_contract_pending',
  'provider_api_availability_pending',
  'privacy_storage_policy_pending',
  'focused_runtime_fixtures_pending',
  'current_v1_runtime_implementation_no_go',
];

const OPERATION_REASON_CODES: Record<PromptEnhancementFutureSequenceRuntimeOperationV1, string> = {
  create_sequence_state: 'future_sequence_1_sequence_identity_state_no_go',
  accept_handoff_start_order: 'future_sequence_2_handoff_start_order_no_go',
  continue_current_item: 'future_sequence_3_continuation_no_go',
  custom_prompt_path: 'future_sequence_3_custom_prompt_path_no_go',
  cancel_active_sequence: 'future_sequence_3_cancel_no_go',
  abandon_active_sequence: 'future_sequence_3_abandon_no_go',
  resume_active_sequence: 'future_sequence_3_resume_no_go',
  response_finished_stop_completion: 'future_sequence_4_stop_completion_non_proof',
  runtime_acceptance: 'future_sequence_5_runtime_acceptance_no_go',
};

const EVIDENCE_TO_GATE_CODE: readonly [
  keyof PromptEnhancementFutureSequenceRuntimeGateEvidenceV1,
  PromptEnhancementFutureSequenceRuntimeMissingGateCodeV1,
][] = [
  ['lifecyclePolicyApproved', 'lifecycle_policy_pending'],
  ['engineReceiverContractApproved', 'engine_receiver_contract_pending'],
  ['futureSequenceRuntimeSourceAvailable', 'future_sequence_runtime_source_pending'],
  ['costNumericAcceptanceApproved', 'cost_numeric_acceptance_pending'],
  ['crossLayerOwnerSnapshotApproved', 'cross_layer_snapshot_pending'],
  ['signedOwnerByDeliverableRegisterApproved', 'signed_owner_by_deliverable_register_pending'],
  ['pendingNamedOwnerRegisterRowsClosed', 'pending_named_owner_register_rows_pending'],
  ['hostHoldCommitContractProven', 'host_hold_commit_contract_pending'],
  ['providerApiAvailabilityProven', 'provider_api_availability_pending'],
  ['privacyStoragePolicyApproved', 'privacy_storage_policy_pending'],
  ['focusedRuntimeFixturesPassed', 'focused_runtime_fixtures_pending'],
];

export const PROMPT_ENHANCEMENT_FUTURE_SEQUENCE_RUNTIME_REQUIRED_GATES_V1 = REQUIRED_GATE_CODES;

export function evaluatePromptEnhancementFutureSequenceRuntimeGateV1(
  input: PromptEnhancementFutureSequenceRuntimeGateInputV1,
): PromptEnhancementFutureSequenceRuntimeGateResultV1 {
  const reasonCodes = unique([
    'future_sequence_runtime_gated_v1',
    OPERATION_REASON_CODES[input.operation],
    ...handoffReasonCodes(input),
    ...eventReasonCodes(input),
    ...configReasonCodes(input),
    ...legacyAuthorityReasonCodes(input),
    ...rawContentReasonCodes(input),
  ]);

  return {
    schemaVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
    operation: input.operation,
    allowed: false,
    status: 'blocked_future_sequence_runtime_v1',
    fallbackMode: 'current_or_original_fallback_no_runtime',
    sequenceIdentityState: 'not_created_v1',
    acceptedStartOrderState: 'not_created_v1',
    continuationState: 'not_created_v1',
    customPromptPathState: 'not_created_v1',
    cancelAbandonResumeState: 'not_created_v1',
    stopCompletionState: 'not_proof_v1',
    runtimeAcceptanceState: 'no_go_v1',
    queueState: 'not_created_v1',
    autoSendState: 'prohibited_v1',
    pointerAdvancementState: 'prohibited_v1',
    terminalReopenState: 'rejected_v1',
    futurePromptBodyState: 'not_generated_not_stored_not_rendered',
    persistencePolicyState: 'ids_counts_status_only_no_raw_content',
    configState: configState(input),
    handoffRuntimeAuthorityState: handoffRuntimeAuthorityState(input.handoffMetadata),
    legacyAuthoritySignalsRejected: true,
    stopOrResponseEventAuthorityState: 'non_proof_no_runtime',
    missingGateCodes: missingGateCodes(input.evidence),
    reasonCodes,
  };
}

export function assertPromptEnhancementFutureSequenceRuntimeBlockedV1(
  result: PromptEnhancementFutureSequenceRuntimeGateResultV1,
): boolean {
  return result.allowed === false
    && result.status === 'blocked_future_sequence_runtime_v1'
    && result.sequenceIdentityState === 'not_created_v1'
    && result.queueState === 'not_created_v1'
    && result.autoSendState === 'prohibited_v1'
    && result.pointerAdvancementState === 'prohibited_v1'
    && result.futurePromptBodyState === 'not_generated_not_stored_not_rendered';
}

function missingGateCodes(
  evidence: PromptEnhancementFutureSequenceRuntimeGateEvidenceV1 | undefined,
): readonly PromptEnhancementFutureSequenceRuntimeMissingGateCodeV1[] {
  return unique([
    ...EVIDENCE_TO_GATE_CODE
      .filter(([field]) => evidence?.[field] !== true)
      .map(([, code]) => code),
    'current_v1_runtime_implementation_no_go',
  ]);
}

function handoffReasonCodes(input: PromptEnhancementFutureSequenceRuntimeGateInputV1): readonly string[] {
  if (!input.handoffMetadata) return ['missing_typed_handoff_metadata'];
  if (!handoffIsV1Safe(input.handoffMetadata)) return ['unsafe_handoff_metadata_rejected'];
  return ['handoff_metadata_is_metadata_only_no_runtime'];
}

function handoffRuntimeAuthorityState(
  handoff: PromptEnhancementHandoffMetadataV1 | undefined,
): PromptEnhancementFutureSequenceRuntimeGateResultV1['handoffRuntimeAuthorityState'] {
  if (!handoff) return 'missing_typed_handoff_no_runtime';
  return handoffIsV1Safe(handoff) ? 'metadata_only_no_runtime' : 'unsafe_handoff_rejected_no_runtime';
}

function handoffIsV1Safe(handoff: PromptEnhancementHandoffMetadataV1): boolean {
  return handoff.handoffMetadataVersion === PROMPT_ENHANCEMENT_CONTRACT_VERSION
    && handoff.sequenceActivationPolicy === 'blocked_pending_sequence_runtime_and_cost_gates'
    && handoff.futurePromptTextPolicy === 'not_generated_not_stored_not_rendered'
    && handoff.suggestedNextPromptRefs.length === 0
    && handoff.activationState === 'no_activation_v1'
    && handoff.userHandoffConsentState !== 'explicitly_accepted_approved_runtime'
    && handoff.applicability.receiverCanActivateRuntime === false
    && handoff.runtimeGuards.createsRuntimeQueue === false
    && handoff.runtimeGuards.permitsContinuation === false
    && handoff.runtimeGuards.activeRuntimeState === 'not_created_v1'
    && handoff.runtimeGuards.autoSendPolicy === 'prohibited'
    && handoff.runtimeGuards.pointerAdvancementPolicy === 'prohibited'
    && handoff.runtimeGuards.completionProofPolicy === 'not_claimed'
    && handoff.runtimeGuards.responseWatcherPolicy === 'not_created_v1'
    && handoff.runtimeGuards.durableResumePolicy === 'not_created_v1'
    && handoff.privacyStoragePolicy.futurePromptBodiesStored === false
    && handoff.privacyStoragePolicy.oldDecisionSessionStoresAreAuthority === false
    && handoff.privacyStoragePolicy.productFeedbackIsPeHandoffSignal === false
    && handoff.privacyStoragePolicy.telemetryPolicy === 'ids_counts_status_only';
}

function eventReasonCodes(input: PromptEnhancementFutureSequenceRuntimeGateInputV1): readonly string[] {
  const reasons: string[] = [];
  const event = input.event;
  if (!event) return ['runtime_event_absent_or_untrusted'];
  if (event.contractVersion !== PROMPT_ENHANCEMENT_CONTRACT_VERSION) reasons.push('runtime_event_contract_version_unsupported');
  if (event.projectScope !== undefined && event.projectScope !== input.projectRoot) reasons.push('runtime_event_project_scope_mismatch');
  if (event.requestId !== undefined && event.requestId !== input.requestId) reasons.push('runtime_event_request_mismatch');
  if (event.createdAtMs === undefined) reasons.push('runtime_event_created_at_missing');
  if (event.idempotencyKey === undefined || event.idempotencyKey.length === 0) reasons.push('runtime_event_idempotency_key_missing');
  if (event.sequenceId === undefined && input.operation !== 'create_sequence_state' && input.operation !== 'accept_handoff_start_order') {
    reasons.push('runtime_event_sequence_id_missing');
  }
  if (event.sequenceItemId === undefined && (
    input.operation === 'continue_current_item' ||
    input.operation === 'custom_prompt_path' ||
    input.operation === 'cancel_active_sequence' ||
    input.operation === 'abandon_active_sequence' ||
    input.operation === 'resume_active_sequence' ||
    input.operation === 'response_finished_stop_completion'
  )) {
    reasons.push('runtime_event_sequence_item_id_missing');
  }
  if (event.explicitUserActionState !== 'present_future_only') reasons.push('explicit_user_action_absent');
  if (event.continuationActionState !== undefined && event.continuationActionState !== input.operation) {
    reasons.push('runtime_event_action_state_mismatch');
  }
  if (event.terminalTransitionState !== undefined && event.terminalTransitionState !== 'none') reasons.push('terminal_transition_rejected_v1');
  if (event.hostCapabilityState !== 'future_hold_proven') reasons.push('host_hold_commit_not_proven');
  if (event.stopEventState === 'stop_fired_non_proof' || event.stopEventState === 'response_finished_candidate_unproven') {
    reasons.push('stop_or_response_finished_is_non_proof');
  }
  if (event.stateFreshness === 'stale' || event.stateFreshness === 'duplicate' || event.stateFreshness === 'unknown' || event.stateFreshness === 'corrupt') {
    reasons.push(`runtime_event_${event.stateFreshness}_noop`);
  }
  if (event.stateFreshness === 'terminal') reasons.push('terminal_reopen_rejected');
  return reasons.length > 0 ? reasons : ['runtime_event_cannot_authorize_v1'];
}

function configReasonCodes(input: PromptEnhancementFutureSequenceRuntimeGateInputV1): readonly string[] {
  const config = input.configSnapshot;
  if (!config) return ['sequence_config_missing_no_runtime'];
  const reasons: string[] = [];
  if (
    config.observedConfigKey !== undefined
    && config.observedConfigKey !== 'prompt_enhancement.sequence.enabled'
  ) {
    reasons.push('sequence_config_key_rejected_as_pe_runtime_authority');
  }
  if (config.sequenceEnabled !== 'on' && config.sequenceEnabled !== 'off') reasons.push('sequence_config_invalid_no_runtime');
  if (config.sequenceEnabled === 'off') reasons.push('sequence_config_off_reduces_behavior_only');
  if (config.userFacingItemCountConfigPresent) reasons.push('user_facing_sequence_item_count_config_rejected');
  if (config.oldDecisionSessionConfigPresent) reasons.push('old_ds_config_rejected_as_pe_runtime_authority');
  return reasons.length > 0 ? reasons : ['sequence_config_on_is_not_runtime_go'];
}

function configState(
  input: PromptEnhancementFutureSequenceRuntimeGateInputV1,
): PromptEnhancementFutureSequenceRuntimeGateResultV1['configState'] {
  if (input.configSnapshot?.sequenceEnabled === 'on') return 'validated_on_no_runtime';
  if (input.configSnapshot?.sequenceEnabled === 'off') return 'validated_off_no_runtime';
  return 'invalid_no_runtime';
}

function legacyAuthorityReasonCodes(input: PromptEnhancementFutureSequenceRuntimeGateInputV1): readonly string[] {
  const legacy = input.legacyAuthoritySignals;
  if (!legacy) return ['no_legacy_authority_signal'];
  return Object.values(legacy).some((value) => value !== undefined && value !== '')
    ? ['legacy_ds_hook_ui_transport_authority_rejected']
    : ['no_legacy_authority_signal'];
}

function rawContentReasonCodes(input: PromptEnhancementFutureSequenceRuntimeGateInputV1): readonly string[] {
  const raw = input.rawContentPresence;
  if (!raw) return ['raw_content_absent_from_gate_result'];
  return Object.values(raw).some(Boolean)
    ? ['raw_prompt_body_or_source_content_rejected']
    : ['raw_content_absent_from_gate_result'];
}

function unique<T extends string>(values: readonly T[]): readonly T[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}
