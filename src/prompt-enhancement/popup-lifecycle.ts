import { validatePromptEnhancementPrepareResultV1, type PromptEnhancementPrepareResultV1, type PromptEnhancementActionType as PromptEnhancementPopupActionType } from './contracts.js';
import { buildPromptEnhancementPopupRenderModelV1, type PromptEnhancementPopupRenderModelInputV1 } from './popup-render-model.js';
import type { PromptEnhancementPopupSessionV1 } from './popup-session.js';

export type PromptEnhancementUiLifecycleStateV1 =
  | 'closed'
  | 'opening'
  | 'loading'
  | 'ready'
  | 'deferred'
  | 'stale'
  | 'unavailable'
  | 'fallback'
  | 'blocked_no_send';

export interface PromptEnhancementPopupLifecycleModelV1 {
  state: PromptEnhancementUiLifecycleStateV1;
  surface: 'one_popup' | 'none';
  identity?: {
    enhancementId: string;
    currentBodyId: string;
    bodyRevision: number;
    validationDecisionId: string;
  };
  bodyVisible: boolean;
  permittedActionTypes: readonly PromptEnhancementPopupActionType[];
  events: {
    sendIntent: 'typed_control_only' | 'none';
    feedback: 'typed_control_only' | 'none';
    cancel: 'typed_control_only' | 'none';
  };
  exposure: 'count_after_visible_ack' | 'not_counted';
  reasonCodes: readonly PromptEnhancementUiLifecycleReasonCodeV1[];
}

export type PromptEnhancementUiLifecycleReasonCodeV1 =
  | 'typed_payload_accepted'
  | 'typed_no_popup'
  | 'invalid_payload'
  | 'stale_payload'
  | 'unsupported_host'
  | 'deferred_by_typed_priority'
  | 'typed_fallback'
  | 'typed_no_send'
  | 'typed_loading';

export interface PromptEnhancementPopupLifecycleInputV1 extends Omit<PromptEnhancementPopupRenderModelInputV1, 'result'> {
  result: unknown;
}

export function buildPromptEnhancementPopupLifecycleModelV1(
  input: PromptEnhancementPopupLifecycleInputV1,
): PromptEnhancementPopupLifecycleModelV1 {
  const validation = validatePromptEnhancementPrepareResultV1(input.result);
  if (!validation.ok) return closed('invalid_payload');

  const rendered = buildPromptEnhancementPopupRenderModelV1({
    ...input,
    result: input.result as PromptEnhancementPrepareResultV1,
  });
  if (rendered.state === 'no_popup') {
    if (rendered.reasonCodes.some((reason) => reason.includes('stale') || reason.includes('mismatch'))) return closed('stale_payload', 'stale');
    if (rendered.reasonCodes.includes('typed_no_popup_disposition')) return closed('typed_no_popup');
    if (rendered.reasonCodes.includes('delivery_surface_mismatch')) return closed('unsupported_host', 'unavailable');
    return closed('invalid_payload');
  }

  const { session } = rendered.model;
  const state = lifecycleStateFor(session);
  const bodyVisible = state === 'ready' || state === 'opening' || state === 'fallback';
  const permittedActionTypes = state === 'closed' || state === 'stale' || state === 'unavailable' || state === 'blocked_no_send'
    ? []
    : rendered.model.controls.directional.map((entry) => entry.action.actionType).concat(
      state === 'ready' || state === 'opening' || state === 'fallback'
        ? [rendered.model.controls.currentBody.actionType, rendered.model.controls.original.actionType, rendered.model.controls.close.actionType]
        : [rendered.model.controls.close.actionType],
    );
  return {
    state,
    surface: 'one_popup',
    identity: rendered.model.identity,
    bodyVisible,
    permittedActionTypes: [...new Set(permittedActionTypes)],
    events: state === 'ready' || state === 'opening' || state === 'fallback'
      ? { sendIntent: 'typed_control_only', feedback: 'typed_control_only', cancel: 'typed_control_only' }
      : { sendIntent: 'none', feedback: 'none', cancel: 'none' },
    exposure: session.visibleSurfaceAckState === 'pe_body_visible' ? 'count_after_visible_ack' : 'not_counted',
    reasonCodes: reasonCodesFor(state),
  };
}

function lifecycleStateFor(session: PromptEnhancementPopupSessionV1): PromptEnhancementUiLifecycleStateV1 {
  if (session.extensionCapabilityState === 'extension_payload_mismatch' || session.extensionCapabilityState === 'extension_fallback_non_old_copy_unavailable') return 'unavailable';
  if (session.visibleSurfaceAckState === 'unsupported_host_or_extension' || session.visibleSurfaceAckState === 'no_tty') return 'unavailable';
  if (session.popupArbitrationState === 'pe_review_priority_product_feedback_waits' || session.popupArbitrationState === 'old_advisory_shown_no_pe_exposure') return 'deferred';
  if (session.popupLifecycleState === 'initial_loading' || session.popupLifecycleState === 'action_loading' || session.popupLifecycleState === 'validation_repair') return 'loading';
  if (session.popupLifecycleState === 'fallback_current_or_original') return 'fallback';
  if (session.popupLifecycleState === 'blocked_or_no_send_high_risk' || session.popupLifecycleState === 'skipped_or_rejected' || session.sendabilityState === 'no_send') return 'blocked_no_send';
  if (session.visibleSurfaceAckState === 'render_requested' || session.visibleSurfaceAckState === 'not_counted_as_shown') return 'opening';
  return 'ready';
}

function reasonCodesFor(state: PromptEnhancementUiLifecycleStateV1): readonly PromptEnhancementUiLifecycleReasonCodeV1[] {
  switch (state) {
    case 'opening':
    case 'ready': return ['typed_payload_accepted'];
    case 'loading': return ['typed_loading'];
    case 'deferred': return ['deferred_by_typed_priority'];
    case 'fallback': return ['typed_fallback'];
    case 'unavailable': return ['unsupported_host'];
    case 'blocked_no_send': return ['typed_no_send'];
    case 'stale': return ['stale_payload'];
    case 'closed': return ['typed_no_popup'];
  }
}

function closed(reason: PromptEnhancementUiLifecycleReasonCodeV1, state: PromptEnhancementUiLifecycleStateV1 = 'closed'): PromptEnhancementPopupLifecycleModelV1 {
  return {
    state,
    surface: 'none',
    bodyVisible: false,
    permittedActionTypes: [],
    events: { sendIntent: 'none', feedback: 'none', cancel: 'none' },
    exposure: 'not_counted',
    reasonCodes: [reason],
  };
}

