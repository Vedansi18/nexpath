import {
  validatePromptEnhancementPrepareResultV1,
  type PromptEnhancementPrepareResultV1,
  type PromptEnhancementHostSurface,
} from './contracts.js';
import {
  buildPromptEnhancementPopupSessionV1,
  type PromptEnhancementPopupSessionInputV1,
  type PromptEnhancementPopupSessionV1,
} from './popup-session.js';

export type PromptEnhancementUiBoundaryResultV1 =
  | {
      state: 'no_popup';
      reasonCodes: readonly string[];
      session?: undefined;
    }
  | {
      state: 'session_ready';
      reasonCodes: readonly string[];
      session: PromptEnhancementPopupSessionV1;
    };

export interface PromptEnhancementUiBoundaryInputV1 {
  result: unknown;
  timestampMs: number;
  deliverySurface?: PromptEnhancementHostSurface;
  sessionOverrides?: Omit<PromptEnhancementPopupSessionInputV1, 'viewPayload' | 'validationDecisionId' | 'timestampMs' | 'deliverySurface'>;
}

/**
 * Host-independent H1.2 adapter. It is the only boundary allowed to turn a
 * validated PE result into popup-session state. A renderer/host must consume the
 * returned typed session; it must not infer authority from body text or transport.
 */
export function buildPromptEnhancementUiBoundarySessionV1(
  input: PromptEnhancementUiBoundaryInputV1,
): PromptEnhancementUiBoundaryResultV1 {
  const validation = validatePromptEnhancementPrepareResultV1(input.result);
  if (!validation.ok) {
    return {
      state: 'no_popup',
      reasonCodes: ['invalid_prepare_result', ...validation.reasonCodes],
    };
  }

  const result = input.result as PromptEnhancementPrepareResultV1;
  if (result.disposition === 'no_popup_not_applicable' || result.uiView.body.sendPolicy === 'no_popup') {
    return {
      state: 'no_popup',
      reasonCodes: ['typed_no_popup_disposition'],
    };
  }

  if (!Number.isFinite(input.timestampMs) || input.timestampMs < 0) {
    return {
      state: 'no_popup',
      reasonCodes: ['invalid_render_timestamp'],
    };
  }

  if (
    input.deliverySurface !== undefined
    && input.deliverySurface !== result.delivery.deliveryChannel
  ) {
    return {
      state: 'no_popup',
      reasonCodes: ['delivery_surface_mismatch'],
    };
  }

  const session = buildPromptEnhancementPopupSessionV1({
    ...input.sessionOverrides,
    viewPayload: result.uiView,
    validationDecisionId: result.validationDecisionId,
    deliverySurface: input.deliverySurface ?? result.delivery.deliveryChannel,
    timestampMs: input.timestampMs,
  });

  // D2 (P7-G1): a blocked_no_send result still returns a session (so the block state is shown), but
  // the body is excluded by the layers below — tag it so a consuming host/observer sees the exclusion.
  const reasonCodes = result.disposition === 'blocked_no_send' ? ['blocked_no_send_body_excluded'] : [];

  return {
    state: 'session_ready',
    reasonCodes,
    session,
  };
}
