import type { Store } from '../store/db.js';
import {
  recordPromptEnhancementGeneratedOrigin,
  recordPromptEnhancementSourceUse,
  resolvePromptEnhancementGeneratedOrigin,
  type PromptEnhancementGeneratedOriginResolution,
  type PromptEnhancementLearningEligibilityFlags,
} from '../store/prompt-enhancement.js';
import type {
  PromptEnhancementCurrentBodyV1,
  PromptEnhancementDeliveryMetadataV1,
  PromptEnhancementGeneratedOriginMetadataV1,
  PromptEnhancementGeneratedOriginState,
  PromptEnhancementHostSurface,
  PromptEnhancementSendPolicy,
} from './contracts.js';
import type { PromptEnhancementPromptSubmitProcessingPolicy } from './popup-session.js';

export type PromptEnhancementDeliveryOutcomeKind =
  | 'stop_bridge_block'
  | 'no_send'
  | 'unsupported_host_fallback'
  | 'delivery_not_ready';

export type PromptEnhancementDeliveryReadinessState =
  | 'ready'
  | 'deterministic_fallback_ready'
  | 'provider_api_unavailable_original_fallback'
  | 'original_only_no_popup'
  | 'no_pending'
  | 'no_tty'
  | 'no_renderer'
  | 'loop_guard'
  | 'disabled_frequency'
  | 'validation_blocked';

export interface PromptEnhancementOriginLineageV1 {
  actionId: string;
  additionalDetailsActionId?: string;
  sequenceId?: string;
  sequenceItemId?: string;
  sequenceRuntimeState: 'not_sequence' | 'metadata_only_no_runtime' | 'future_runtime_gated';
}

export interface PromptEnhancementDeliveryRequestV1 {
  deliveryAttemptId: string;
  projectRoot: string;
  enhancementId: string;
  currentBody: PromptEnhancementCurrentBodyV1;
  actionId: string;
  sendPolicy: PromptEnhancementSendPolicy;
  deliveryChannel?: PromptEnhancementHostSurface;
  hostCapabilityState?: PromptEnhancementDeliveryMetadataV1['hostCapabilityState'];
  extensionPayloadState?: PromptEnhancementDeliveryMetadataV1['extensionPayloadState'];
  hostCapabilityEvidenceRefs?: readonly string[];
  exposureAcknowledgementState?: PromptEnhancementDeliveryMetadataV1['exposureAcknowledgementState'];
  fallbackState?: string;
  readinessState?: PromptEnhancementDeliveryReadinessState;
  additionalDetailsActionId?: string;
  sequenceId?: string;
  sequenceItemId?: string;
  promptSubmitProcessingPolicy?: PromptEnhancementPromptSubmitProcessingPolicy;
  now?: number;
}

export interface PromptEnhancementStopBridgeDecisionV1 {
  decision: 'block';
  reason: string;
  rawReasonIsTextCarrierOnly: true;
}

export interface PromptEnhancementDeliveryResultV1 {
  deliveryAttemptId: string;
  outcome: PromptEnhancementDeliveryOutcomeKind;
  transportedBody: 'current_body' | 'original_prompt' | 'none';
  stopBridgeDecision: PromptEnhancementStopBridgeDecisionV1 | null;
  delivery: PromptEnhancementDeliveryMetadataV1;
  generatedOrigin: PromptEnhancementGeneratedOriginMetadataV1 | null;
  originLineage: PromptEnhancementOriginLineageV1 | null;
  sourceUseIds: readonly string[];
  promptSubmitProcessingPolicy: PromptEnhancementPromptSubmitProcessingPolicy;
  invariants: {
    sourceUseRecordedBeforeTransport: boolean;
    sameTurnReplacementClaimed: false;
    autoSendClaimed: false;
    rawStopReasonIsSemanticAuthority: false;
    rawTransportIsSemanticAuthority: false;
  };
  reasonCodes: readonly string[];
}

export interface PromptEnhancementExtensionDeliveryPayloadV1 {
  schemaVersion: 1;
  payloadKind: 'prompt_enhancement_editable_body_delivery';
  deliveryAttemptId: string;
  enhancementId: string;
  bodyId: string;
  bodyRevision: number;
  generatedOriginId: string;
  sourceUseIds: readonly string[];
  actionId: string;
  originLineage: PromptEnhancementOriginLineageV1;
  sendPolicy: Exclude<PromptEnhancementSendPolicy, 'no_popup'>;
  fallbackState: string;
  hostCapabilityState: PromptEnhancementDeliveryMetadataV1['hostCapabilityState'];
  extensionPayloadState: 'typed_payload_required';
  bodyTextPolicy: 'transport_body_text_only_not_authority';
  rawTransportIsSemanticAuthority: false;
}

export interface PromptEnhancementExtensionPayloadValidation {
  ok: boolean;
  reasonCodes: readonly string[];
}

export type PromptEnhancementHostCapabilityEvidenceState =
  | 'claude_cli_stop_bridge_supported'
  | 'extension_typed_payload_supported'
  | 'host_unsupported'
  | 'host_unknown'
  | 'direct_insert_success_text_only'
  | 'direct_insert_failure'
  | 'foreground_unavailable'
  | 'stale_capability_data'
  | 'clipboard_manual_copy_source_precedent_only';

export interface PromptEnhancementHostCapabilityEvaluationV1 {
  evidenceState: PromptEnhancementHostCapabilityEvidenceState;
  deliveryChannel: PromptEnhancementHostSurface;
  hostCapabilityState: PromptEnhancementDeliveryMetadataV1['hostCapabilityState'];
  extensionPayloadState: PromptEnhancementDeliveryMetadataV1['extensionPayloadState'];
  fallbackRequired: boolean;
  canUseAsSemanticAuthority: false;
  canClaimUserConsent: false;
  canClaimExecution: false;
  canClaimCompletion: false;
  canClaimSequenceAdvancement: false;
  reasonCodes: readonly string[];
}

export interface PromptEnhancementTransportDiagnosticInputV1 {
  diagnosticId: string;
  deliveryAttemptId?: string;
  bodyId?: string;
  bodyRevision?: number;
  hostCapabilityEvidenceState?: PromptEnhancementHostCapabilityEvidenceState;
  fallbackState?: string;
  errorKind?: string;
  rawStdout?: string;
  rawStderr?: string;
  rawError?: unknown;
  projectRoot?: string;
  promptText?: string;
  generatedBodyText?: string;
  sourceExcerpt?: string;
  customFeedbackText?: string;
  extensionOutputText?: string;
  prebuildArtifactPath?: string;
}

export interface PromptEnhancementTransportDiagnosticV1 {
  diagnosticId: string;
  deliveryAttemptId?: string;
  bodyId?: string;
  bodyRevision?: number;
  hostCapabilityEvidenceState?: PromptEnhancementHostCapabilityEvidenceState;
  fallbackState?: string;
  errorKind?: string;
  rawStdoutExcluded: true;
  rawStderrExcluded: true;
  rawErrorExcluded: true;
  projectRootExcluded: true;
  promptTextExcluded: true;
  generatedBodyTextExcluded: true;
  sourceExcerptExcluded: true;
  customFeedbackTextExcluded: true;
  extensionOutputTextExcluded: true;
  prebuildArtifactExcluded: true;
  privateIdsExcluded: true;
  reasonCodes: readonly string[];
}

export interface PromptEnhancementPromptSubmitOriginEvidenceV1 {
  evidenceKind:
    | 'typed_generated_origin'
    | 'raw_stop_reason_only'
    | 'last_injected_prompt_only'
    | 'clipboard_text_only'
    | 'extension_label_only'
    | 'old_ds_row'
    | 'product_feedback'
    | 'prompt_history'
    | 'served_variant_row'
    | 'transcript_corroboration'
    | 'raw_extension_payload'
    | 'malformed_generated_origin'
    | 'unsupported_version'
    | 'missing_host_capability'
    | 'missing';
  projectRoot: string;
  bodyId?: string;
  bodyRevision?: number;
  generatedOriginId?: string;
  now?: number;
  maxAgeMs?: number;
}

export interface PromptEnhancementPromptSubmitOriginResolutionV1 {
  generatedOriginTrusted: boolean;
  processingPolicy: PromptEnhancementPromptSubmitProcessingPolicy;
  generatedOrigin: PromptEnhancementGeneratedOriginResolution | null;
  rawTransportIsSemanticAuthority: false;
  lastInjectedPromptIsAuthority: false;
  normalUserPromptFullProcessingPreserved: boolean;
  reasonCodes: readonly string[];
}

const GENERATED_DELIVERY_POLICY: PromptEnhancementPromptSubmitProcessingPolicy = 'pe_generated_delivery_skip_classification';
const NORMAL_USER_PROMPT_POLICY: PromptEnhancementPromptSubmitProcessingPolicy = 'normal_user_prompt_full_processing';
const UNKNOWN_ORIGIN_POLICY: PromptEnhancementPromptSubmitProcessingPolicy = 'unknown_origin_conservative';

const NON_LEARNING_FLAGS: PromptEnhancementLearningEligibilityFlags = {
  promptHistory: false,
  profile: false,
  stage: false,
  language: false,
  missingSignalMemory: false,
  feedback: false,
  telemetry: false,
  sourceUseTracking: true,
};

export function preparePromptEnhancementStopBridgeDelivery(
  store: Store,
  input: PromptEnhancementDeliveryRequestV1,
): PromptEnhancementDeliveryResultV1 {
  const delivery = deliveryMetadata(input);
  const policy = input.promptSubmitProcessingPolicy ?? defaultPromptSubmitProcessingPolicy(input);
  const readinessState = input.readinessState ?? 'ready';
  if (input.sendPolicy === 'no_send' || input.sendPolicy === 'no_popup') {
    return {
      deliveryAttemptId: input.deliveryAttemptId,
      outcome: 'no_send',
      transportedBody: 'none',
      stopBridgeDecision: null,
      delivery,
      generatedOrigin: null,
      originLineage: null,
      sourceUseIds: [],
      promptSubmitProcessingPolicy: policy,
      invariants: baseInvariants(false),
      reasonCodes: ['no_transport_requested', 'raw_transport_not_authority'],
    };
  }

  if (isBlockingReadinessState(readinessState)) {
    return {
      deliveryAttemptId: input.deliveryAttemptId,
      outcome: 'delivery_not_ready',
      transportedBody: 'none',
      stopBridgeDecision: null,
      delivery,
      generatedOrigin: null,
      originLineage: null,
      sourceUseIds: [],
      promptSubmitProcessingPolicy: NORMAL_USER_PROMPT_POLICY,
      invariants: baseInvariants(false),
      reasonCodes: [readinessState, 'no_transport_without_ready_state', 'raw_transport_not_authority'],
    };
  }

  if (delivery.hostCapabilityState === 'unsupported') {
    return {
      deliveryAttemptId: input.deliveryAttemptId,
      outcome: 'unsupported_host_fallback',
      transportedBody: 'none',
      stopBridgeDecision: null,
      delivery,
      generatedOrigin: null,
      originLineage: null,
      sourceUseIds: [],
      promptSubmitProcessingPolicy: UNKNOWN_ORIGIN_POLICY,
      invariants: baseInvariants(false),
      reasonCodes: ['host_capability_unsupported', 'fallback_without_authority'],
    };
  }

  const sourceUseIds = recordDeliverySourceUses(store, input);
  const generatedOrigin = generatedOriginMetadata(input, sourceUseIds, policy);
  const originLineage = originLineageFor(input);
  recordPromptEnhancementGeneratedOrigin(store, {
    generatedOriginId: generatedOrigin.generatedOriginId,
    projectRoot: input.projectRoot,
    enhancementId: input.enhancementId,
    bodyId: generatedOrigin.bodyId,
    bodyRevision: generatedOrigin.bodyRevision,
    generatedOriginState: generatedOrigin.generatedOriginState,
    deliveryChannel: generatedOrigin.deliveryChannel,
    promptSubmitProcessingPolicy: policy,
    learningEligible: false,
    learningEligibilityFlags: NON_LEARNING_FLAGS,
    sourceUseIds,
    actionIds: actionLineageIds(originLineage),
    fallbackState: input.fallbackState ?? 'not_fallback',
    privacyStoragePolicy: 'raw_text_excluded_by_default',
    reasonCodes: [
      'generated_origin_metadata_written',
      'source_use_recorded_before_transport',
      'raw_transport_not_authority',
      'no_same_turn_replacement_assumption',
      readinessState,
    ],
    now: (input.now ?? Date.now()) + 1,
  });

  return {
    deliveryAttemptId: input.deliveryAttemptId,
    outcome: 'stop_bridge_block',
    transportedBody: input.sendPolicy === 'send_current' ? 'current_body' : 'original_prompt',
    stopBridgeDecision: {
      decision: 'block',
      reason: transportedText(input),
      rawReasonIsTextCarrierOnly: true,
    },
    delivery,
    generatedOrigin,
    originLineage,
    sourceUseIds,
    promptSubmitProcessingPolicy: policy,
    invariants: baseInvariants(sourceUseIds.length > 0),
    reasonCodes: [
      'stop_bridge_delivery_prepared',
      'generated_origin_metadata_written',
      'source_use_recorded_before_transport',
      'raw_transport_not_authority',
      'no_same_turn_replacement_assumption',
      readinessState,
    ],
  };
}

export function createPromptEnhancementExtensionDeliveryPayload(
  result: PromptEnhancementDeliveryResultV1,
): PromptEnhancementExtensionDeliveryPayloadV1 | null {
  if (!result.generatedOrigin || result.delivery.sendPolicy === 'no_popup') return null;
  if (result.delivery.extensionPayloadState !== 'typed_payload_required') return null;
  return {
    schemaVersion: 1,
    payloadKind: 'prompt_enhancement_editable_body_delivery',
    deliveryAttemptId: result.deliveryAttemptId,
    enhancementId: result.generatedOrigin.enhancementId,
    bodyId: result.generatedOrigin.bodyId,
    bodyRevision: result.generatedOrigin.bodyRevision,
    generatedOriginId: result.generatedOrigin.generatedOriginId,
    sourceUseIds: result.sourceUseIds,
    actionId: result.generatedOrigin.actionId ?? 'unknown_action',
    originLineage: result.originLineage ?? {
      actionId: result.generatedOrigin.actionId ?? 'unknown_action',
      sequenceRuntimeState: 'not_sequence',
    },
    sendPolicy: result.delivery.sendPolicy,
    fallbackState: result.reasonCodes.includes('fallback_without_authority') ? 'fallback_without_authority' : 'not_fallback',
    hostCapabilityState: result.delivery.hostCapabilityState,
    extensionPayloadState: 'typed_payload_required',
    bodyTextPolicy: 'transport_body_text_only_not_authority',
    rawTransportIsSemanticAuthority: false,
  };
}

export function validatePromptEnhancementExtensionDeliveryPayload(
  payload: unknown,
): PromptEnhancementExtensionPayloadValidation {
  if (!isRecord(payload)) return { ok: false, reasonCodes: ['payload_not_object'] };
  const legacyKeys = ['advisory', 'options', 'selectedPrompt', 'selected_prompt', 'promptOptions', 'lastInjectedPrompt'];
  const presentLegacyKeys = legacyKeys.filter((key) => key in payload);
  if (presentLegacyKeys.length > 0) {
    return { ok: false, reasonCodes: ['legacy_decision_session_payload_rejected', ...presentLegacyKeys.map((key) => `legacy_key:${key}`)] };
  }
  const rawTransportKeys = ['rawStdout', 'rawStderr', 'stderr', 'stdout', 'rawError', 'errorStack', 'clipboardText', 'optionLabel'];
  const presentRawKeys = rawTransportKeys.filter((key) => key in payload);
  if (presentRawKeys.length > 0) {
    return { ok: false, reasonCodes: ['raw_transport_payload_rejected', ...presentRawKeys.map((key) => `raw_key:${key}`)] };
  }
  const requiredStringKeys = [
    'payloadKind',
    'deliveryAttemptId',
    'enhancementId',
    'bodyId',
    'generatedOriginId',
    'actionId',
    'sendPolicy',
    'fallbackState',
    'hostCapabilityState',
    'extensionPayloadState',
    'bodyTextPolicy',
  ];
  const missing = requiredStringKeys.filter((key) => typeof payload[key] !== 'string' || payload[key].length === 0);
  const invalid =
    payload.schemaVersion !== 1 ||
    payload.payloadKind !== 'prompt_enhancement_editable_body_delivery' ||
    !Number.isInteger(payload.bodyRevision) ||
    payload.extensionPayloadState !== 'typed_payload_required' ||
    payload.bodyTextPolicy !== 'transport_body_text_only_not_authority' ||
    payload.rawTransportIsSemanticAuthority !== false ||
    !Array.isArray(payload.sourceUseIds) ||
    payload.sourceUseIds.length === 0 ||
    !isValidOriginLineage(payload.originLineage);
  if (missing.length > 0 || invalid) {
    return { ok: false, reasonCodes: ['typed_extension_payload_invalid', ...missing.map((key) => `missing:${key}`)] };
  }
  return { ok: true, reasonCodes: ['typed_extension_payload_valid', 'raw_transport_not_authority'] };
}

export function evaluatePromptEnhancementHostCapability(
  evidenceState: PromptEnhancementHostCapabilityEvidenceState,
): PromptEnhancementHostCapabilityEvaluationV1 {
  switch (evidenceState) {
    case 'claude_cli_stop_bridge_supported':
      return hostCapabilityEvaluation(evidenceState, 'cli_stop_bridge', 'stop_bridge_only', 'not_applicable', false, [
        'stop_bridge_supported',
        'raw_stop_reason_text_only',
      ]);
    case 'extension_typed_payload_supported':
      return hostCapabilityEvaluation(evidenceState, 'extension_bridge', 'stop_bridge_only', 'typed_payload_required', false, [
        'typed_extension_payload_supported',
        'host_evidence_not_semantic_authority',
      ]);
    case 'host_unsupported':
      return hostCapabilityEvaluation(evidenceState, 'manual_fallback', 'unsupported', 'fallback_without_authority', true, [
        'host_capability_unsupported',
        'fallback_without_authority',
      ]);
    case 'host_unknown':
      return hostCapabilityEvaluation(evidenceState, 'manual_fallback', 'unsupported', 'fallback_without_authority', true, [
        'host_capability_unknown',
        'fallback_without_authority',
      ]);
    case 'direct_insert_success_text_only':
      return hostCapabilityEvaluation(evidenceState, 'extension_bridge', 'stop_bridge_only', 'typed_payload_required', false, [
        'direct_insert_success_text_only',
        'insertion_success_not_execution_proof',
      ]);
    case 'direct_insert_failure':
      return hostCapabilityEvaluation(evidenceState, 'manual_fallback', 'unsupported', 'fallback_without_authority', true, [
        'direct_insert_failed',
        'fallback_without_authority',
      ]);
    case 'foreground_unavailable':
      return hostCapabilityEvaluation(evidenceState, 'manual_fallback', 'unsupported', 'fallback_without_authority', true, [
        'foreground_unavailable',
        'foreground_not_visible_acknowledgement',
      ]);
    case 'stale_capability_data':
      return hostCapabilityEvaluation(evidenceState, 'manual_fallback', 'unsupported', 'fallback_without_authority', true, [
        'stale_capability_data',
        'fallback_without_authority',
      ]);
    case 'clipboard_manual_copy_source_precedent_only':
      return hostCapabilityEvaluation(evidenceState, 'manual_fallback', 'unsupported', 'fallback_without_authority', true, [
        'clipboard_manual_copy_source_precedent_only',
        'clipboard_text_not_authority',
      ]);
  }
}

export function createPromptEnhancementTransportDiagnostic(
  input: PromptEnhancementTransportDiagnosticInputV1,
): PromptEnhancementTransportDiagnosticV1 {
  return {
    diagnosticId: input.diagnosticId,
    deliveryAttemptId: input.deliveryAttemptId,
    bodyId: input.bodyId,
    bodyRevision: input.bodyRevision,
    hostCapabilityEvidenceState: input.hostCapabilityEvidenceState,
    fallbackState: input.fallbackState,
    errorKind: input.errorKind,
    rawStdoutExcluded: true,
    rawStderrExcluded: true,
    rawErrorExcluded: true,
    projectRootExcluded: true,
    promptTextExcluded: true,
    generatedBodyTextExcluded: true,
    sourceExcerptExcluded: true,
    customFeedbackTextExcluded: true,
    extensionOutputTextExcluded: true,
    prebuildArtifactExcluded: true,
    privateIdsExcluded: true,
    reasonCodes: [
      'transport_diagnostic_sanitized',
      'ids_enums_counts_status_only',
      'raw_transport_not_authority',
      ...diagnosticExclusionCodes(input),
    ],
  };
}

export function resolvePromptEnhancementPromptSubmitOrigin(
  store: Store,
  evidence: PromptEnhancementPromptSubmitOriginEvidenceV1,
): PromptEnhancementPromptSubmitOriginResolutionV1 {
  if (
    evidence.evidenceKind !== 'typed_generated_origin' ||
    !evidence.bodyId ||
    typeof evidence.bodyRevision !== 'number' ||
    !Number.isInteger(evidence.bodyRevision)
  ) {
    return untrustedOrigin(['typed_generated_origin_missing', `${evidence.evidenceKind}_not_authority`]);
  }
  const bodyRevision = evidence.bodyRevision;
  const generatedOrigin = resolvePromptEnhancementGeneratedOrigin(store, {
    projectRoot: evidence.projectRoot,
    bodyId: evidence.bodyId,
    bodyRevision,
  });
  if (!generatedOrigin) return untrustedOrigin(['generated_origin_row_missing', 'normal_user_processing_preserved']);
  if (evidence.generatedOriginId && evidence.generatedOriginId !== generatedOrigin.generatedOriginId) {
    return untrustedOrigin(['generated_origin_id_mismatch', 'normal_user_processing_preserved']);
  }
  if (evidence.maxAgeMs !== undefined && evidence.now !== undefined && evidence.now - generatedOrigin.createdAt > evidence.maxAgeMs) {
    return untrustedOrigin(['generated_origin_stale', 'normal_user_processing_preserved']);
  }
  if (generatedOrigin.generatedOriginState === 'user_original') {
    return {
      generatedOriginTrusted: false,
      processingPolicy: NORMAL_USER_PROMPT_POLICY,
      generatedOrigin,
      rawTransportIsSemanticAuthority: false,
      lastInjectedPromptIsAuthority: false,
      normalUserPromptFullProcessingPreserved: true,
      reasonCodes: ['user_original_processed_normally', 'raw_transport_not_authority'],
    };
  }
  if (
    isPromptEnhancementGeneratedState(generatedOrigin.generatedOriginState) &&
    generatedOrigin.promptSubmitProcessingPolicy === GENERATED_DELIVERY_POLICY &&
    sourceSideEffectsDisabled(generatedOrigin.learningEligibilityFlags)
  ) {
    return {
      generatedOriginTrusted: true,
      processingPolicy: GENERATED_DELIVERY_POLICY,
      generatedOrigin,
      rawTransportIsSemanticAuthority: false,
      lastInjectedPromptIsAuthority: false,
      normalUserPromptFullProcessingPreserved: false,
      reasonCodes: [
        'typed_generated_origin_trusted',
        'classification_skip_scoped_to_delivery_echo',
        'ds_advisory_processing_not_authorized',
        'ordinary_prompt_history_side_effects_disabled',
      ],
    };
  }
  return untrustedOrigin(['generated_origin_policy_not_trusted', 'normal_user_processing_preserved'], generatedOrigin);
}

function recordDeliverySourceUses(store: Store, input: PromptEnhancementDeliveryRequestV1): readonly string[] {
  const now = input.now ?? Date.now();
  const rows = sourceUseRows(input);
  for (const row of rows) {
    recordPromptEnhancementSourceUse(store, {
      ...row,
      now,
    });
  }
  return rows.map((row) => row.sourceUseId);
}

function sourceUseRows(input: PromptEnhancementDeliveryRequestV1) {
  const body = input.currentBody;
  if (input.sendPolicy === 'send_original' || input.sendPolicy === 'original_only') {
    return [{
      sourceUseId: `${input.deliveryAttemptId}:source:original`,
      projectRoot: input.projectRoot,
      enhancementId: input.enhancementId,
      bodyId: body.currentBodyId,
      bodyRevision: body.bodyRevision,
      sourceKind: 'source_a_user_prompt',
      sourceId: body.originalPromptSectionId === 'not_applicable_original_only' ? body.currentBodyId : body.originalPromptSectionId,
      sectionIds: [body.originalPromptSectionId === 'not_applicable_original_only' ? body.currentBodyId : body.originalPromptSectionId],
      useKind: 'body_section' as const,
      memoryEvidence: false,
      reasonCodes: ['send_original_source_use_before_transport', 'raw_transport_not_authority'],
    }];
  }
  const attributionRows = body.sourceAttribution.map((source, index) => ({
    sourceUseId: `${input.deliveryAttemptId}:source:${index + 1}`,
    projectRoot: input.projectRoot,
    enhancementId: input.enhancementId,
    bodyId: body.currentBodyId,
    bodyRevision: body.bodyRevision,
    sourceKind: source.sourceKind,
    sourceId: source.sourceId,
    sectionIds: body.sections
      .filter((section) => section.sourceIds.includes(source.sourceId))
      .map((section) => section.sectionId),
    useKind: 'body_section' as const,
    memoryEvidence: false,
    reasonCodes: ['send_current_source_use_before_transport', 'raw_transport_not_authority'],
  }));
  if (attributionRows.length > 0) return attributionRows;
  return [{
    sourceUseId: `${input.deliveryAttemptId}:source:body`,
    projectRoot: input.projectRoot,
    enhancementId: input.enhancementId,
    bodyId: body.currentBodyId,
    bodyRevision: body.bodyRevision,
    sourceKind: 'generated_origin',
    sourceId: body.nexpathGeneratedPromptRef || body.currentBodyId,
    sectionIds: body.sections.map((section) => section.sectionId),
    useKind: 'body_section' as const,
    memoryEvidence: false,
    reasonCodes: ['generated_body_source_use_before_transport', 'raw_transport_not_authority'],
  }];
}

function generatedOriginMetadata(
  input: PromptEnhancementDeliveryRequestV1,
  sourceUseIds: readonly string[],
  policy: PromptEnhancementPromptSubmitProcessingPolicy,
): PromptEnhancementGeneratedOriginMetadataV1 {
  const generatedOriginState = generatedOriginStateForSend(input);
  return {
    generatedOriginId: `${input.deliveryAttemptId}:origin`,
    generatedOriginState,
    enhancementId: input.enhancementId,
    bodyId: input.currentBody.currentBodyId,
    bodyRevision: input.currentBody.bodyRevision,
    actionId: input.actionId,
    deliveryAttemptId: input.deliveryAttemptId,
    deliveryChannel: input.deliveryChannel ?? 'cli_stop_bridge',
    sourceUseIds,
    echoRecursionGuard: {
      bodyFingerprintRef: input.currentBody.nexpathGeneratedPromptRef,
      sourcePromptEchoState: generatedOriginState === 'user_original' ? 'not_echo' : 'pe_generated_echo',
      lastInjectedPromptIsAuthority: false,
    },
    learningEligibility: {
      promptHistory: false,
      profile: false,
      stage: false,
      language: false,
      memory: false,
      telemetry: false,
      sourceUseTracking: true,
    },
  };
}

function deliveryMetadata(input: PromptEnhancementDeliveryRequestV1): PromptEnhancementDeliveryMetadataV1 {
  return {
    deliveryChannel: input.deliveryChannel ?? 'cli_stop_bridge',
    sendPolicy: input.sendPolicy,
    stopReasonCarriesTextOnly: true,
    rawTransportIsSemanticAuthority: false,
    hostCapabilityState: input.hostCapabilityState ?? 'stop_bridge_only',
    extensionPayloadState: input.extensionPayloadState ?? 'not_applicable',
    hostCapabilityEvidenceRefs: input.hostCapabilityEvidenceRefs ?? [],
    exposureAcknowledgementState: input.exposureAcknowledgementState ?? 'sent',
  };
}

function originLineageFor(input: PromptEnhancementDeliveryRequestV1): PromptEnhancementOriginLineageV1 {
  return {
    actionId: input.actionId,
    additionalDetailsActionId: input.additionalDetailsActionId,
    sequenceId: input.sequenceId,
    sequenceItemId: input.sequenceItemId,
    sequenceRuntimeState: input.sequenceId || input.sequenceItemId ? 'metadata_only_no_runtime' : 'not_sequence',
  };
}

function actionLineageIds(lineage: PromptEnhancementOriginLineageV1): readonly string[] {
  return [
    lineage.actionId,
    lineage.additionalDetailsActionId,
    lineage.sequenceId,
    lineage.sequenceItemId,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);
}

function isBlockingReadinessState(state: PromptEnhancementDeliveryReadinessState): boolean {
  return [
    'no_pending',
    'no_tty',
    'no_renderer',
    'loop_guard',
    'disabled_frequency',
    'validation_blocked',
  ].includes(state);
}

function transportedText(input: PromptEnhancementDeliveryRequestV1): string {
  return input.sendPolicy === 'send_current' ? input.currentBody.text : input.currentBody.originalPromptText;
}

function generatedOriginStateForSend(input: PromptEnhancementDeliveryRequestV1): PromptEnhancementGeneratedOriginState {
  return input.sendPolicy === 'send_current' ? input.currentBody.generatedOriginState : 'user_original';
}

function defaultPromptSubmitProcessingPolicy(input: PromptEnhancementDeliveryRequestV1): PromptEnhancementPromptSubmitProcessingPolicy {
  if (input.sendPolicy === 'send_current' && isPromptEnhancementGeneratedState(input.currentBody.generatedOriginState)) {
    return GENERATED_DELIVERY_POLICY;
  }
  if (input.hostCapabilityState === 'unsupported') return UNKNOWN_ORIGIN_POLICY;
  return NORMAL_USER_PROMPT_POLICY;
}

function baseInvariants(sourceUseRecordedBeforeTransport: boolean): PromptEnhancementDeliveryResultV1['invariants'] {
  return {
    sourceUseRecordedBeforeTransport,
    sameTurnReplacementClaimed: false,
    autoSendClaimed: false,
    rawStopReasonIsSemanticAuthority: false,
    rawTransportIsSemanticAuthority: false,
  };
}

function isPromptEnhancementGeneratedState(state: string): boolean {
  return state === 'pe_generated_body' || state === 'pe_user_edited_body';
}

function sourceSideEffectsDisabled(flags: PromptEnhancementLearningEligibilityFlags): boolean {
  return (
    flags.promptHistory === false &&
    flags.profile === false &&
    flags.stage === false &&
    flags.language === false &&
    flags.missingSignalMemory === false &&
    flags.feedback === false &&
    flags.telemetry === false &&
    flags.sourceUseTracking === true
  );
}

function untrustedOrigin(
  reasonCodes: readonly string[],
  generatedOrigin: PromptEnhancementGeneratedOriginResolution | null = null,
): PromptEnhancementPromptSubmitOriginResolutionV1 {
  return {
    generatedOriginTrusted: false,
    processingPolicy: NORMAL_USER_PROMPT_POLICY,
    generatedOrigin,
    rawTransportIsSemanticAuthority: false,
    lastInjectedPromptIsAuthority: false,
    normalUserPromptFullProcessingPreserved: true,
    reasonCodes,
  };
}

function hostCapabilityEvaluation(
  evidenceState: PromptEnhancementHostCapabilityEvidenceState,
  deliveryChannel: PromptEnhancementHostSurface,
  hostCapabilityState: PromptEnhancementDeliveryMetadataV1['hostCapabilityState'],
  extensionPayloadState: PromptEnhancementDeliveryMetadataV1['extensionPayloadState'],
  fallbackRequired: boolean,
  reasonCodes: readonly string[],
): PromptEnhancementHostCapabilityEvaluationV1 {
  return {
    evidenceState,
    deliveryChannel,
    hostCapabilityState,
    extensionPayloadState,
    fallbackRequired,
    canUseAsSemanticAuthority: false,
    canClaimUserConsent: false,
    canClaimExecution: false,
    canClaimCompletion: false,
    canClaimSequenceAdvancement: false,
    reasonCodes,
  };
}

function diagnosticExclusionCodes(input: PromptEnhancementTransportDiagnosticInputV1): readonly string[] {
  const codes: string[] = [];
  if (input.rawStdout !== undefined) codes.push('raw_stdout_excluded');
  if (input.rawStderr !== undefined) codes.push('raw_stderr_excluded');
  if (input.rawError !== undefined) codes.push('raw_error_excluded');
  if (input.projectRoot !== undefined) codes.push('project_root_excluded');
  if (input.promptText !== undefined) codes.push('prompt_text_excluded');
  if (input.generatedBodyText !== undefined) codes.push('generated_body_text_excluded');
  if (input.sourceExcerpt !== undefined) codes.push('source_excerpt_excluded');
  if (input.customFeedbackText !== undefined) codes.push('custom_feedback_text_excluded');
  if (input.extensionOutputText !== undefined) codes.push('extension_output_text_excluded');
  if (input.prebuildArtifactPath !== undefined) codes.push('generated_prebuild_artifact_excluded');
  return codes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidOriginLineage(value: unknown): value is PromptEnhancementOriginLineageV1 {
  if (!isRecord(value)) return false;
  if (typeof value.actionId !== 'string' || value.actionId.length === 0) return false;
  if (
    value.additionalDetailsActionId !== undefined &&
    (typeof value.additionalDetailsActionId !== 'string' || value.additionalDetailsActionId.length === 0)
  ) return false;
  if (value.sequenceId !== undefined && (typeof value.sequenceId !== 'string' || value.sequenceId.length === 0)) return false;
  if (value.sequenceItemId !== undefined && (typeof value.sequenceItemId !== 'string' || value.sequenceItemId.length === 0)) return false;
  return value.sequenceRuntimeState === 'not_sequence' ||
    value.sequenceRuntimeState === 'metadata_only_no_runtime' ||
    value.sequenceRuntimeState === 'future_runtime_gated';
}
