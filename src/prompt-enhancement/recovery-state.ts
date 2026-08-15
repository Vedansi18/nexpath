import { validatePromptEnhancementPrepareResultV1, type PromptEnhancementActionType, type PromptEnhancementPrepareResultV1 } from './contracts.js';
import { buildPromptEnhancementPopupRenderModelV1, type PromptEnhancementPopupRenderModelInputV1 } from './popup-render-model.js';
import type { PromptEnhancementPopupSessionV1 } from './popup-session.js';

export type PromptEnhancementRecoveryStateV1 = 'none' | 'cancelled_no_send' | 'blocked_no_send' | 'retryable_failure' | 'fallback_explicit_choice' | 'unsupported' | 'stale_invalid';
export type PromptEnhancementRecoveryReasonV1 = 'not_a_recovery_state' | 'cancelled' | 'blocked' | 'retryable_failure' | 'explicit_fallback_required' | 'unsupported_host' | 'stale_or_invalid';

export interface PromptEnhancementRecoveryModelV1 {
  state: PromptEnhancementRecoveryStateV1;
  surface: 'one_popup' | 'none';
  identity?: { enhancementId: string; currentBodyId: string; bodyRevision: number; validationDecisionId: string };
  bodyExposure: 'not_exposed';
  preservedState: 'identity_only' | 'not_available';
  permittedActionTypes: readonly PromptEnhancementActionType[];
  events: { sendIntent: 'none'; cancel: 'typed_control_only' | 'none'; fallbackSelection: 'typed_control_only' | 'none'; retry: 'none' };
  publicMessage: string;
  publicReason: PromptEnhancementRecoveryReasonV1;
  noAutomaticSend: true;
  privateDetailsExcluded: true;
}

export interface PromptEnhancementRecoveryInputV1 extends Omit<PromptEnhancementPopupRenderModelInputV1, 'result'> { result: unknown }

const PUBLIC_MESSAGES: Record<PromptEnhancementRecoveryReasonV1, string> = {
  not_a_recovery_state: 'Review the enhanced prompt before sending.',
  cancelled: 'No message was sent.',
  blocked: 'No message was sent.',
  retryable_failure: 'Prompt enhancement needs another try.',
  explicit_fallback_required: 'Prompt enhancement is unavailable; choose an available safe option.',
  unsupported_host: 'Prompt enhancement is not available in this host.',
  stale_or_invalid: 'This prompt enhancement is no longer current.',
};

export function buildPromptEnhancementRecoveryModelV1(input: PromptEnhancementRecoveryInputV1): PromptEnhancementRecoveryModelV1 {
  const validation = validatePromptEnhancementPrepareResultV1(input.result);
  if (!validation.ok) return terminal('stale_invalid', 'stale_or_invalid');
  const rendered = buildPromptEnhancementPopupRenderModelV1({ ...input, result: input.result as PromptEnhancementPrepareResultV1 });
  if (rendered.state === 'no_popup') return noPopupRecovery(rendered.reasonCodes);
  const session = rendered.model.session;
  const state = recoveryStateFor(input.result as PromptEnhancementPrepareResultV1, session);
  if (state === 'none') {
    return { state, surface: 'one_popup', identity: rendered.model.identity, bodyExposure: 'not_exposed', preservedState: 'not_available', permittedActionTypes: [], events: { sendIntent: 'none', cancel: 'none', fallbackSelection: 'none', retry: 'none' }, publicMessage: PUBLIC_MESSAGES.not_a_recovery_state, publicReason: 'not_a_recovery_state', noAutomaticSend: true, privateDetailsExcluded: true };
  }
  const permittedActionTypes = state === 'fallback_explicit_choice' ? fallbackActions(rendered.model.controls, session) : [];
  return { state, surface: 'one_popup', identity: rendered.model.identity, bodyExposure: 'not_exposed', preservedState: state === 'retryable_failure' || state === 'fallback_explicit_choice' ? 'identity_only' : 'not_available', permittedActionTypes, events: { sendIntent: 'none', cancel: 'typed_control_only', fallbackSelection: state === 'fallback_explicit_choice' && permittedActionTypes.length > 0 ? 'typed_control_only' : 'none', retry: 'none' }, publicMessage: PUBLIC_MESSAGES[reasonFor(state)], publicReason: reasonFor(state), noAutomaticSend: true, privateDetailsExcluded: true };
}

function noPopupRecovery(reasonCodes: readonly string[]): PromptEnhancementRecoveryModelV1 {
  if (reasonCodes.some((reason) => reason.includes('stale') || reason.includes('mismatch') || reason.includes('invalid'))) return terminal('stale_invalid', 'stale_or_invalid');
  if (reasonCodes.includes('delivery_surface_mismatch')) return terminal('unsupported', 'unsupported_host');
  return terminal('cancelled_no_send', 'cancelled');
}

function terminal(state: Exclude<PromptEnhancementRecoveryStateV1, 'none' | 'retryable_failure' | 'fallback_explicit_choice'>, publicReason: Exclude<PromptEnhancementRecoveryReasonV1, 'not_a_recovery_state' | 'retryable_failure' | 'explicit_fallback_required'>): PromptEnhancementRecoveryModelV1 {
  return { state, surface: 'none', bodyExposure: 'not_exposed', preservedState: 'not_available', permittedActionTypes: [], events: { sendIntent: 'none', cancel: 'none', fallbackSelection: 'none', retry: 'none' }, publicMessage: PUBLIC_MESSAGES[publicReason], publicReason, noAutomaticSend: true, privateDetailsExcluded: true };
}

function recoveryStateFor(result: PromptEnhancementPrepareResultV1, session: PromptEnhancementPopupSessionV1): PromptEnhancementRecoveryStateV1 {
  if (session.extensionCapabilityState === 'extension_payload_mismatch' || session.extensionCapabilityState === 'extension_fallback_non_old_copy_unavailable') return 'unsupported';
  if (session.visibleSurfaceAckState === 'unsupported_host_or_extension' || session.visibleSurfaceAckState === 'no_tty') return 'unsupported';
  if (result.disposition === 'no_popup_not_applicable') return 'cancelled_no_send';
  if (result.disposition === 'blocked_no_send' || session.popupLifecycleState === 'blocked_or_no_send_high_risk' || session.popupLifecycleState === 'skipped_or_rejected' || session.sendabilityState === 'no_send') return 'blocked_no_send';
  if (result.disposition === 'fallback_to_original' || session.popupLifecycleState === 'fallback_current_or_original' || session.sendabilityState === 'original_only') return 'fallback_explicit_choice';
  if (session.visibleSurfaceAckState === 'render_failure' || session.fallbackMode === 'timeout_no_send' || session.fallbackMode === 'provider_api_unavailable' || session.fallbackMode === 'validation_failed_no_send' || session.fallbackMode === 'delivery_unavailable' || session.fallbackMode === 'direct_insert_unavailable') return 'retryable_failure';
  return 'none';
}

function reasonFor(state: Exclude<PromptEnhancementRecoveryStateV1, 'none'>): Exclude<PromptEnhancementRecoveryReasonV1, 'not_a_recovery_state'> {
  if (state === 'cancelled_no_send') return 'cancelled';
  if (state === 'blocked_no_send') return 'blocked';
  if (state === 'retryable_failure') return 'retryable_failure';
  if (state === 'fallback_explicit_choice') return 'explicit_fallback_required';
  if (state === 'unsupported') return 'unsupported_host';
  return 'stale_or_invalid';
}

function fallbackActions(controls: { currentBody: { actionType: PromptEnhancementActionType; availability: string }; original: { actionType: PromptEnhancementActionType; availability: string } }, session: PromptEnhancementPopupSessionV1): readonly PromptEnhancementActionType[] {
  const actions: PromptEnhancementActionType[] = [];
  if (session.sendabilityState === 'send_current' && controls.currentBody.availability === 'available') actions.push('use_current_body');
  if (session.loadingFallbackControls.useOriginalAvailable && controls.original.availability === 'available') actions.push('use_original');
  return actions;
}

