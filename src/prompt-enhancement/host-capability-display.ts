import type {
  PromptEnhancementDeliveryMetadataV1,
  PromptEnhancementHostSurface,
} from './contracts.js';
import type {
  PromptEnhancementDeliveryEvidenceState,
} from './popup-session.js';
import type {
  PromptEnhancementHostCapabilityEvidenceState,
  PromptEnhancementHostCapabilityEvaluationV1,
} from './delivery.js';

export type PromptEnhancementHostDisplayStatusV1 =
  | 'inserted'
  | 'copied'
  | 'manual_paste_required'
  | 'manual_submit_required'
  | 'failed'
  | 'unknown'
  | 'unsupported'
  | 'waiting';

export type PromptEnhancementHostResultFreshnessV1 =
  | 'current'
  | 'stale'
  | 'mismatched'
  | 'unknown';

export interface PromptEnhancementHostCapabilityDisplayInputV1 {
  evaluation: unknown;
  deliveryEvidenceState?: PromptEnhancementDeliveryEvidenceState;
  resultFreshness?: PromptEnhancementHostResultFreshnessV1;
}

export interface PromptEnhancementHostCapabilityDisplayModelV1 {
  status: PromptEnhancementHostDisplayStatusV1;
  publicLabel: string;
  capabilityState: PromptEnhancementDeliveryMetadataV1['hostCapabilityState'];
  deliveryChannel: PromptEnhancementHostSurface;
  extensionPayloadState: PromptEnhancementDeliveryMetadataV1['extensionPayloadState'];
  fallbackRequired: boolean;
  requiresFreshExplicitUserAction: true;
  claims: {
    sent: false;
    execution: false;
    consent: false;
    completion: false;
    sequenceAdvancement: false;
    semanticAuthority: false;
  };
  privacy: {
    rawPayloadExcluded: true;
    promptAndBodyExcluded: true;
    clipboardExcluded: true;
    privatePathsExcluded: true;
    internalReasonDetailsExcluded: true;
  };
  reasonCodes: readonly string[];
}

const PUBLIC_LABELS: Record<PromptEnhancementHostDisplayStatusV1, string> = {
  inserted: 'Prompt inserted; review it and submit manually.',
  copied: 'Prompt copied; paste it into the host and submit manually.',
  manual_paste_required: 'Paste the prompt into the host manually.',
  manual_submit_required: 'Submit the prompt manually after review.',
  failed: 'Prompt delivery failed; no message was sent.',
  unknown: 'Prompt delivery status is unknown; no message was sent.',
  unsupported: 'This host does not support prompt delivery.',
  waiting: 'Waiting for a typed host delivery result.',
};

const EVIDENCE_STATES: readonly PromptEnhancementHostCapabilityEvidenceState[] = [
  'claude_cli_stop_bridge_supported',
  'extension_typed_payload_supported',
  'host_unsupported',
  'host_unknown',
  'direct_insert_success_text_only',
  'direct_insert_failure',
  'foreground_unavailable',
  'stale_capability_data',
  'clipboard_manual_copy_source_precedent_only',
];

const DELIVERY_EVIDENCE_STATES: readonly PromptEnhancementDeliveryEvidenceState[] = [
  'direct_insert_to_existing_chat_input',
  'auto_paste_to_existing_chat_attempted',
  'clipboard_only_manual_paste_required',
  'foreground_attempted_not_acknowledgment',
  'delivery_failed_or_unknown',
  'submit_unconfirmed_manual_user_action_required',
];

function isCapabilityEvaluation(value: unknown): value is PromptEnhancementHostCapabilityEvaluationV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return EVIDENCE_STATES.includes(candidate.evidenceState as PromptEnhancementHostCapabilityEvidenceState)
    && (candidate.deliveryChannel === 'cli_stop_bridge' || candidate.deliveryChannel === 'extension_bridge' || candidate.deliveryChannel === 'manual_fallback' || candidate.deliveryChannel === 'future_host_hold_proven')
    && (candidate.hostCapabilityState === 'stop_bridge_only' || candidate.hostCapabilityState === 'unsupported' || candidate.hostCapabilityState === 'future_hold_proven')
    && (candidate.extensionPayloadState === 'not_applicable' || candidate.extensionPayloadState === 'typed_payload_required' || candidate.extensionPayloadState === 'fallback_without_authority')
    && typeof candidate.fallbackRequired === 'boolean'
    && candidate.canUseAsSemanticAuthority === false
    && candidate.canClaimUserConsent === false
    && candidate.canClaimExecution === false
    && candidate.canClaimCompletion === false
    && candidate.canClaimSequenceAdvancement === false
    && Array.isArray(candidate.reasonCodes)
    && candidate.reasonCodes.every((reason) => typeof reason === 'string');
}

export function buildPromptEnhancementHostCapabilityDisplayModelV1(
  input: PromptEnhancementHostCapabilityDisplayInputV1,
): PromptEnhancementHostCapabilityDisplayModelV1 {
  if (!isCapabilityEvaluation(input.evaluation)) return model('unknown', 'missing_or_invalid_typed_capability', true);

  if (input.resultFreshness === 'stale' || input.resultFreshness === 'mismatched') {
    return model('unknown', `${input.resultFreshness}_host_result_no_send`, true, input.evaluation);
  }
  if (input.resultFreshness === 'unknown') {
    return model('unknown', 'unknown_host_result_no_send', true, input.evaluation);
  }

  const status = statusFor(input.evaluation.evidenceState, input.deliveryEvidenceState);
  return model(status, reasonFor(status, input.evaluation.evidenceState), input.evaluation.fallbackRequired, input.evaluation);
}

function statusFor(
  evidenceState: PromptEnhancementHostCapabilityEvidenceState,
  deliveryEvidenceState?: PromptEnhancementDeliveryEvidenceState,
): PromptEnhancementHostDisplayStatusV1 {
  switch (deliveryEvidenceState) {
    case 'direct_insert_to_existing_chat_input': return 'inserted';
    case 'auto_paste_to_existing_chat_attempted':
    case 'foreground_attempted_not_acknowledgment': return 'waiting';
    case 'clipboard_only_manual_paste_required': return 'copied';
    case 'submit_unconfirmed_manual_user_action_required': return 'manual_submit_required';
    case 'delivery_failed_or_unknown': return 'unknown';
  }

  switch (evidenceState) {
    case 'direct_insert_success_text_only': return 'inserted';
    case 'direct_insert_failure':
    case 'foreground_unavailable': return 'failed';
    case 'host_unsupported': return 'unsupported';
    case 'host_unknown':
    case 'stale_capability_data': return 'unknown';
    case 'clipboard_manual_copy_source_precedent_only': return 'manual_paste_required';
    case 'claude_cli_stop_bridge_supported':
    case 'extension_typed_payload_supported': return 'waiting';
  }
}

function reasonFor(
  status: PromptEnhancementHostDisplayStatusV1,
  evidenceState: PromptEnhancementHostCapabilityEvidenceState,
): string {
  return `${status}_from_typed_${evidenceState}`;
}

function model(
  status: PromptEnhancementHostDisplayStatusV1,
  reasonCode: string,
  fallbackRequired: boolean,
  evaluation?: PromptEnhancementHostCapabilityEvaluationV1,
): PromptEnhancementHostCapabilityDisplayModelV1 {
  return {
    status,
    publicLabel: PUBLIC_LABELS[status],
    capabilityState: evaluation?.hostCapabilityState ?? 'unsupported',
    deliveryChannel: evaluation?.deliveryChannel ?? 'manual_fallback',
    extensionPayloadState: evaluation?.extensionPayloadState ?? 'fallback_without_authority',
    fallbackRequired,
    requiresFreshExplicitUserAction: true,
    claims: {
      sent: false,
      execution: false,
      consent: false,
      completion: false,
      sequenceAdvancement: false,
      semanticAuthority: false,
    },
    privacy: {
      rawPayloadExcluded: true,
      promptAndBodyExcluded: true,
      clipboardExcluded: true,
      privatePathsExcluded: true,
      internalReasonDetailsExcluded: true,
    },
    reasonCodes: [reasonCode],
  };
}

export { DELIVERY_EVIDENCE_STATES };
