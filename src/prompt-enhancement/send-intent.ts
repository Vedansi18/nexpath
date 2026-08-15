import {
  createPromptEnhancementPopupEventV1,
  type PromptEnhancementPopupEventInputV1,
  type PromptEnhancementPopupEventV1,
  type PromptEnhancementPopupSessionV1,
} from './popup-session.js';

/**
 * stage-2-2 UI/application boundary. This emits a typed user intent only; it does
 * not validate content, deliver text, invoke a host, or claim execution.
 */
export interface PromptEnhancementSendIntentAdapterStateV1 {
  consumedIntentKeys: readonly string[];
}

export interface PromptEnhancementSendIntentV1 {
  intentType: 'send_current' | 'send_original';
  intentKey: string;
  event: PromptEnhancementPopupEventV1;
  identity: {
    enhancementId: string;
    currentBodyId: string;
    bodyRevision: number;
    validationDecisionId: string;
  };
  editedBodyText?: string;
  additionalDetailsText?: string;
  additionalDetailsBodyRevision?: number;
  originalPromptText?: string;
  realUserInitiated: true;
}

export type PromptEnhancementSendIntentResultV1 =
  | {
      state: 'intent_ready';
      intent: PromptEnhancementSendIntentV1;
      adapterState: PromptEnhancementSendIntentAdapterStateV1;
    }
  | {
      state: 'no_intent';
      reasonCodes: readonly string[];
      adapterState: PromptEnhancementSendIntentAdapterStateV1;
    };

export function buildPromptEnhancementSendIntentAdapterStateV1(): PromptEnhancementSendIntentAdapterStateV1 {
  return { consumedIntentKeys: [] };
}

export function buildPromptEnhancementSendIntentV1(input: {
  adapterState: PromptEnhancementSendIntentAdapterStateV1;
  event: PromptEnhancementPopupEventInputV1;
  editedBodyText?: string;
  additionalDetailsText?: string;
  originalPromptText?: string;
}): PromptEnhancementSendIntentResultV1 {
  const session = input.event.session;
  const reasons: string[] = [];
  const isCurrent = input.event.eventType === 'deliver_current_body';
  const isOriginal = input.event.eventType === 'use_original';
  const intentKey = `${session.enhancementId}:${input.event.eventType}:${input.event.actionId}:${session.currentBodyId}:${session.bodyRevision}`;

  if (!isCurrent && !isOriginal) reasons.push('event_is_not_send_intent');
  if (input.adapterState.consumedIntentKeys.includes(intentKey)) reasons.push('duplicate_send_intent');
  if (input.event.realUserInitiated !== true) reasons.push('not_real_user_initiated');
  if (!Number.isFinite(input.event.timestampMs) || input.event.timestampMs < 0) reasons.push('invalid_send_intent_timestamp');
  if (input.event.actionId.trim().length === 0) reasons.push('missing_send_action_id');
  if (input.event.currentBodyId !== session.currentBodyId || input.event.bodyRevision !== session.bodyRevision) {
    reasons.push('stale_or_mismatched_send_identity');
  }
  if (blockedLifecycleStates.has(session.popupLifecycleState)) {
    reasons.push('send_not_available_in_current_lifecycle');
  }
  if (input.event.eventType === 'deliver_current_body') {
    if (session.sendabilityState !== 'send_current') reasons.push('current_body_not_sendable');
    if (session.preSendBoundaryState.editabilityState !== 'editable') reasons.push('current_body_not_editable');
    if (session.additionalDetailsState === 'dirty_unsubmitted') reasons.push('dirty_additional_details_requires_apply_or_clear');
    if (typeof input.editedBodyText !== 'string' || input.editedBodyText.trim().length === 0) reasons.push('missing_edited_body_text');
  }
  if (input.event.eventType === 'use_original') {
    if (!session.loadingFallbackControls.useOriginalAvailable) reasons.push('original_action_unavailable');
    if (typeof input.originalPromptText !== 'string' || input.originalPromptText.trim().length === 0) reasons.push('missing_original_prompt_text');
  }

  const event = createPromptEnhancementPopupEventV1(input.event);
  if (event.staleOrMismatched || event.reasonCodes.length > 0) reasons.push(...event.reasonCodes);
  if (isCurrent && event.sendPolicy !== 'send_current') reasons.push('typed_current_send_policy_rejected');
  if (isOriginal && event.sendPolicy !== 'send_original') reasons.push('typed_original_send_policy_rejected');
  const uniqueReasons = [...new Set(reasons)];
  if (uniqueReasons.length > 0) {
    return { state: 'no_intent', reasonCodes: uniqueReasons, adapterState: input.adapterState };
  }

  const intent: PromptEnhancementSendIntentV1 = {
    intentType: isCurrent ? 'send_current' : 'send_original',
    intentKey,
    event,
    identity: {
      enhancementId: session.enhancementId,
      currentBodyId: session.currentBodyId,
      bodyRevision: session.bodyRevision,
      validationDecisionId: session.validationDecisionId,
    },
    ...(isCurrent ? {
      editedBodyText: input.editedBodyText,
      ...(input.additionalDetailsText !== undefined ? {
        additionalDetailsText: input.additionalDetailsText,
        additionalDetailsBodyRevision: session.bodyRevision,
      } : {}),
    } : {
      originalPromptText: input.originalPromptText,
    }),
    realUserInitiated: true,
  };
  return {
    state: 'intent_ready',
    intent,
    adapterState: {
      consumedIntentKeys: [...input.adapterState.consumedIntentKeys, intentKey],
    },
  };
}

const blockedLifecycleStates = new Set<PromptEnhancementPopupSessionV1['popupLifecycleState']>([
  'not_applicable_no_popup',
  'initial_loading',
  'action_loading',
  'validation_repair',
  'blocked_or_no_send_high_risk',
  'skipped_or_rejected',
  'delivered_to_input',
]);

