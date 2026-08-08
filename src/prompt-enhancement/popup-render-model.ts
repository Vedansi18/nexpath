import {
  validatePromptEnhancementPrepareResultV1,
  type PromptEnhancementActionEntryV1,
  type PromptEnhancementPinchLabelV1,
  type PromptEnhancementPrepareResultV1,
  type PromptEnhancementPublicDiagnosticV1,
  type PromptEnhancementPublicTrustCueV1,
  type PromptEnhancementWhyHelpV1,
} from './contracts.js';
import {
  buildPromptEnhancementUiBoundarySessionV1,
  type PromptEnhancementUiBoundaryInputV1,
} from './ui-boundary.js';
import {
  isPromptEnhancementBlockedNoSendPolicyV1,
  type PromptEnhancementPopupActionStateV1,
  type PromptEnhancementPopupSessionV1,
} from './popup-session.js';

export const PROMPT_ENHANCEMENT_POPUP_TITLE_V1 = 'Nexpath · Prompt enhancement' as const;
export const PROMPT_ENHANCEMENT_EDITOR_HEADING_V1 = 'Use enhanced prompt' as const;

export const PROMPT_ENHANCEMENT_POPUP_LAYOUT_V1 = [
  'header',
  'pre_send_public_copy',
  'editor_heading',
  'enhanced_body',
  'additional_details',
  'directional_actions',
  'use_original',
  'keyboard_help',
] as const;

export interface PromptEnhancementPopupRenderModelV1 {
  title: typeof PROMPT_ENHANCEMENT_POPUP_TITLE_V1;
  editorHeading: typeof PROMPT_ENHANCEMENT_EDITOR_HEADING_V1;
  layout: typeof PROMPT_ENHANCEMENT_POPUP_LAYOUT_V1;
  identity: {
    enhancementId: string;
    currentBodyId: string;
    bodyRevision: number;
    acceptedCanonicalBodyRevisionId: string;
    validationDecisionId: string;
  };
  session: PromptEnhancementPopupSessionV1;
  body: {
    text: string;
    displayState: PromptEnhancementPopupSessionV1['preSendBoundaryState']['bodyDisplayState'];
    editabilityState: PromptEnhancementPopupSessionV1['preSendBoundaryState']['editabilityState'];
    editable: boolean;
  };
  controls: {
    currentBody: PromptEnhancementActionEntryV1;
    original: PromptEnhancementActionEntryV1;
    directional: readonly PromptEnhancementPopupActionStateV1[];
    additionalDetails?: PromptEnhancementActionEntryV1;
    feedback?: PromptEnhancementActionEntryV1;
    close: PromptEnhancementActionEntryV1;
  };
  publicCopy: {
    trustCues: readonly PromptEnhancementPublicTrustCueV1[];
    diagnostics: readonly PromptEnhancementPublicDiagnosticV1[];
  };
  /** UI-9 header copy: pinch label (when supplied) and why-help (only when a reason exists). */
  pinchLabel?: PromptEnhancementPinchLabelV1;
  whyHelp?: PromptEnhancementWhyHelpV1;
  rejectedControls: PromptEnhancementPopupSessionV1['preSendBoundaryState']['rejectedControlSet'];
}

export type PromptEnhancementPopupRenderModelResultV1 =
  | { state: 'no_popup'; reasonCodes: readonly string[]; model?: undefined }
  | { state: 'render_model_ready'; reasonCodes: readonly string[]; model: PromptEnhancementPopupRenderModelV1 };

export interface PromptEnhancementPopupRenderModelInputV1 extends PromptEnhancementUiBoundaryInputV1 {
  result: PromptEnhancementPrepareResultV1;
}

/**
 * Build the host-independent stage-1-1 presentation model from the validated PE
 * result. This function only maps typed state to locked presentation fields;
 * it does not create delivery, transport, sequence, or semantic authority.
 */
export function buildPromptEnhancementPopupRenderModelV1(
  input: PromptEnhancementPopupRenderModelInputV1,
): PromptEnhancementPopupRenderModelResultV1 {
  const validation = validatePromptEnhancementPrepareResultV1(input.result);
  if (!validation.ok) {
    return { state: 'no_popup', reasonCodes: ['invalid_prepare_result', ...validation.reasonCodes] };
  }

  const boundary = buildPromptEnhancementUiBoundarySessionV1(input);
  if (boundary.state === 'no_popup') return boundary;

  const result = input.result;
  const session = boundary.session;
  const staleActionReasonCodes = session.reasonCodes.filter((reasonCode) => reasonCode.startsWith('stale_popup_action:'));
  if (staleActionReasonCodes.length > 0) {
    return { state: 'no_popup', reasonCodes: ['invalid_popup_session', ...staleActionReasonCodes] };
  }
  if (
    result.enhancementId !== session.enhancementId
    || result.uiView.body.currentBodyId !== session.currentBodyId
    || result.uiView.body.bodyRevision !== session.bodyRevision
    || result.validationDecisionId !== session.validationDecisionId
  ) {
    return { state: 'no_popup', reasonCodes: ['popup_identity_mismatch'] };
  }

  const actionByType = new Map(result.uiView.actions.map((action) => [action.actionType, action]));
  const currentBody = actionByType.get('use_current_body');
  const original = actionByType.get('use_original');
  const close = actionByType.get('close');
  if (!currentBody || !original || !close) {
    return { state: 'no_popup', reasonCodes: ['missing_required_popup_action'] };
  }

  return {
    state: 'render_model_ready',
    reasonCodes: [],
    model: {
      title: PROMPT_ENHANCEMENT_POPUP_TITLE_V1,
      editorHeading: PROMPT_ENHANCEMENT_EDITOR_HEADING_V1,
      layout: PROMPT_ENHANCEMENT_POPUP_LAYOUT_V1,
      identity: {
        enhancementId: session.enhancementId,
        currentBodyId: session.currentBodyId,
        bodyRevision: session.bodyRevision,
        acceptedCanonicalBodyRevisionId: session.acceptedCanonicalBodyRevisionId,
        validationDecisionId: session.validationDecisionId,
      },
      session,
      body: {
        // D2 (P7-G1): independent self-scrub — even if a caller hands in a session whose text
        // was not scrubbed, a blocked/no-send body renders no generated text at this layer too.
        text: isPromptEnhancementBlockedNoSendPolicyV1(session.sendabilityState) ? '' : session.currentBodyText,
        displayState: session.preSendBoundaryState.bodyDisplayState,
        editabilityState: session.preSendBoundaryState.editabilityState,
        editable: session.preSendBoundaryState.editabilityState === 'editable',
      },
      controls: {
        currentBody,
        original,
        directional: session.directionalActionSet,
        additionalDetails: actionByType.get('apply_details'),
        feedback: actionByType.get('feedback'),
        close,
      },
      publicCopy: {
        trustCues: result.uiView.publicTrustCues,
        diagnostics: result.uiView.diagnostics,
      },
      pinchLabel: result.uiView.pinchLabel,
      whyHelp: result.uiView.whyHelp,
      rejectedControls: session.preSendBoundaryState.rejectedControlSet,
    },
  };
}
