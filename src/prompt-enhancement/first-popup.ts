import {
  validatePromptEnhancementPrepareResultV1,
  type PromptEnhancementDisposition,
  type PromptEnhancementHandoffMetadataV1,
  type PromptEnhancementPinchLabelV1,
  type PromptEnhancementPrepareResultV1,
  type PromptEnhancementWhyHelpV1,
} from './contracts.js';
import { validatePromptEnhancementHandoffMetadataV1 } from './handoff-metadata.js';

export const PROMPT_ENHANCEMENT_MPS_FIRST_POPUP_TITLE_V1 = 'Nexpath · Multi-prompt sequence' as const;
export const PROMPT_ENHANCEMENT_MPS_FIRST_POPUP_HEADING_V1 = 'Use enhanced sequence prompt' as const;

export const PROMPT_ENHANCEMENT_MPS_FIRST_POPUP_LAYOUT_V1 = [
  'enhanced_body',
  'additional_details',
  'cancel_remaining_sequence',
  'sequence_plan',
] as const;

export interface PromptEnhancementMpsAdditionalDetailsV1 {
  text: string;
  revision: number;
}

export interface PromptEnhancementMpsCancelInputV1 {
  state: 'available' | 'disabled';
  disposition: PromptEnhancementDisposition;
}

export interface PromptEnhancementMpsFirstPopupInputV1 {
  result: PromptEnhancementPrepareResultV1;
  handoffMetadata: PromptEnhancementHandoffMetadataV1;
  additionalDetails?: PromptEnhancementMpsAdditionalDetailsV1;
  cancel: PromptEnhancementMpsCancelInputV1;
}

export interface PromptEnhancementMpsFirstPopupIdentityV1 {
  requestId: string;
  projectRoot: string;
  handoffDecisionId: string;
  currentBodyId: string;
  bodyRevision: number;
  itemLineageRefs: readonly string[];
}

export interface PromptEnhancementMpsFirstPopupModelV1 {
  surface: 'prompt_enhancement_mps_first_popup';
  title: typeof PROMPT_ENHANCEMENT_MPS_FIRST_POPUP_TITLE_V1;
  heading: typeof PROMPT_ENHANCEMENT_MPS_FIRST_POPUP_HEADING_V1;
  layout: typeof PROMPT_ENHANCEMENT_MPS_FIRST_POPUP_LAYOUT_V1;
  // Deterministic header copy from the typed uiView (same source as the PE popup), present only
  // when supplied. The UI renders them like PE and never invents them.
  pinchLabel?: PromptEnhancementPinchLabelV1;
  whyHelp?: PromptEnhancementWhyHelpV1;
  identity: PromptEnhancementMpsFirstPopupIdentityV1;
  body: {
    text: string;
    editable: true;
    originalPromptText: string;
    originalPromptPreservation: PromptEnhancementPrepareResultV1['currentBody']['originalPromptPreservation'];
  };
  additionalDetails: {
    visible: boolean;
    text: string;
    revision: number;
  };
  actions: {
    submitCurrentBody: 'typed_current_body_plus_details';
    cancelRemainingSequence: {
      label: 'Cancel (remaining multi-prompt sequence)';
      state: PromptEnhancementMpsCancelInputV1['state'];
      disposition: PromptEnhancementDisposition;
    };
    originalPrompt: 'not_rendered';
  };
  sequencePlan: {
    remainingTaskCount: number;
    taskRoleLabels: readonly string[];
  };
  keyboard: {
    plainEnter: 'emit_one_typed_current_body_plus_details_request';
    escape: 'leave_editor_focus_preserve_draft';
    ctrlOrCmdJ: 'insert_newline';
    ctrlOrCmdUpDown: 'move_by_line';
    leftRight: 'move_by_character';
  };
  authority: {
    localSequenceRuntime: false;
    localQueuePointer: false;
    localAutoSend: false;
    localAdvance: false;
    hostTransport: false;
  };
}

export type PromptEnhancementMpsFirstPopupBuildResultV1 =
  | { state: 'no_popup'; reasonCodes: readonly string[]; model?: undefined }
  | { state: 'ready'; reasonCodes: readonly []; model: PromptEnhancementMpsFirstPopupModelV1 };

export interface PromptEnhancementMpsCurrentBodyIntentV1 {
  type: 'send_current_body';
  identity: PromptEnhancementMpsFirstPopupIdentityV1;
  editedBodyText: string;
  additionalDetailsText: string;
  additionalDetailsRevision: number;
}

export interface PromptEnhancementMpsCancelIntentV1 {
  type: 'cancel_remaining_sequence';
  identity: PromptEnhancementMpsFirstPopupIdentityV1;
  disposition: 'blocked_no_send';
}

export type PromptEnhancementMpsFirstPopupIntentV1 =
  | PromptEnhancementMpsCurrentBodyIntentV1
  | PromptEnhancementMpsCancelIntentV1;

export type PromptEnhancementMpsIntentResultV1 =
  | { state: 'intent_unavailable'; reasonCodes: readonly string[]; intent?: undefined }
  | { state: 'intent_ready'; reasonCodes: readonly []; intent: PromptEnhancementMpsFirstPopupIntentV1 };

/**
 * Projects one validated content-owner first-item handoff into the locked stage-3-1 UI
 * shape. It deliberately has no queue, pointer, transport, or send side
 * effect; those remain runtime/host-owned boundaries.
 */
export function buildPromptEnhancementMpsFirstPopupV1(
  input: PromptEnhancementMpsFirstPopupInputV1,
): PromptEnhancementMpsFirstPopupBuildResultV1 {
  const resultValidation = validatePromptEnhancementPrepareResultV1(input.result);
  if (!resultValidation.ok) {
    return { state: 'no_popup', reasonCodes: ['invalid_prepare_result', ...resultValidation.reasonCodes] };
  }
  const handoffValidation = validatePromptEnhancementHandoffMetadataV1(
    input.handoffMetadata,
    input.result.currentBody,
    input.result.safetySummary,
    { requestId: input.result.requestId, projectRoot: input.result.projectRoot },
  );
  if (!handoffValidation.ok) {
    return { state: 'no_popup', reasonCodes: ['invalid_mps_handoff', ...handoffValidation.reasonCodes] };
  }
  const summary = input.handoffMetadata.compactFirstPopupSequenceSummary;
  if (
    input.result.disposition !== 'show_current_body'
    || !(input.handoffMetadata.handoffKind === 'first_prompt_handoff_candidate' || input.handoffMetadata.handoffKind === 'compact_sequence_summary_candidate')
    || !summary
  ) {
    return { state: 'no_popup', reasonCodes: ['first_mps_popup_not_applicable'] };
  }
  if (
    input.handoffMetadata.currentBodyId !== input.result.currentBody.currentBodyId
    || input.handoffMetadata.bodyRevision !== input.result.currentBody.bodyRevision
    || summary.currentBodyId !== input.result.currentBody.currentBodyId
    || summary.bodyRevision !== input.result.currentBody.bodyRevision
  ) {
    return { state: 'no_popup', reasonCodes: ['mps_handoff_body_revision_mismatch'] };
  }
  if (
    input.cancel.disposition !== 'blocked_no_send'
    || (input.cancel.state === 'available' && input.result.safetySummary.noAutomaticSend !== true)
  ) {
    return { state: 'no_popup', reasonCodes: ['invalid_mps_cancel_disposition'] };
  }
  if (
    input.result.currentBody.originalPromptPreservation === 'fallback_original_only'
    || input.result.currentBody.originalPromptText.length === 0
  ) {
    return { state: 'no_popup', reasonCodes: ['original_context_not_preserved'] };
  }
  const additionalDetails = input.additionalDetails ?? { text: '', revision: 0 };
  if (!Number.isSafeInteger(additionalDetails.revision) || additionalDetails.revision < 0) {
    return { state: 'no_popup', reasonCodes: ['invalid_additional_details_revision'] };
  }
  const identity: PromptEnhancementMpsFirstPopupIdentityV1 = {
    requestId: input.result.requestId,
    projectRoot: input.result.projectRoot,
    handoffDecisionId: input.handoffMetadata.handoffDecisionId,
    currentBodyId: input.result.currentBody.currentBodyId,
    bodyRevision: input.result.currentBody.bodyRevision,
    itemLineageRefs: input.handoffMetadata.itemLineageRefs,
  };
  return {
    state: 'ready',
    reasonCodes: [],
    model: {
      surface: 'prompt_enhancement_mps_first_popup',
      title: PROMPT_ENHANCEMENT_MPS_FIRST_POPUP_TITLE_V1,
      heading: PROMPT_ENHANCEMENT_MPS_FIRST_POPUP_HEADING_V1,
      layout: PROMPT_ENHANCEMENT_MPS_FIRST_POPUP_LAYOUT_V1,
      ...(input.result.uiView.pinchLabel ? { pinchLabel: input.result.uiView.pinchLabel } : {}),
      ...(input.result.uiView.whyHelp ? { whyHelp: input.result.uiView.whyHelp } : {}),
      identity,
      body: {
        text: input.result.currentBody.text,
        editable: true,
        originalPromptText: input.result.currentBody.originalPromptText,
        originalPromptPreservation: input.result.currentBody.originalPromptPreservation,
      },
      additionalDetails: {
        visible: input.additionalDetails !== undefined,
        text: additionalDetails.text,
        revision: additionalDetails.revision,
      },
      actions: {
        submitCurrentBody: 'typed_current_body_plus_details',
        cancelRemainingSequence: {
          label: 'Cancel (remaining multi-prompt sequence)',
          state: input.cancel.state,
          disposition: input.cancel.disposition,
        },
        originalPrompt: 'not_rendered',
      },
      sequencePlan: {
        remainingTaskCount: summary.remainingTaskCount,
        taskRoleLabels: [...summary.taskRoleLabels],
      },
      keyboard: {
        plainEnter: 'emit_one_typed_current_body_plus_details_request',
        escape: 'leave_editor_focus_preserve_draft',
        ctrlOrCmdJ: 'insert_newline',
        ctrlOrCmdUpDown: 'move_by_line',
        leftRight: 'move_by_character',
      },
      authority: {
        localSequenceRuntime: false,
        localQueuePointer: false,
        localAutoSend: false,
        localAdvance: false,
        hostTransport: false,
      },
    },
  };
}

export function createPromptEnhancementMpsCurrentBodyIntentV1(
  model: PromptEnhancementMpsFirstPopupModelV1,
  input: { editedBodyText: string; additionalDetailsText?: string; additionalDetailsRevision?: number },
): PromptEnhancementMpsIntentResultV1 {
  const detailsRevision = input.additionalDetailsRevision ?? model.additionalDetails.revision;
  if (!Number.isSafeInteger(detailsRevision) || detailsRevision < 0) {
    return { state: 'intent_unavailable', reasonCodes: ['invalid_additional_details_revision'] };
  }
  return {
    state: 'intent_ready',
    reasonCodes: [],
    intent: {
      type: 'send_current_body',
      identity: model.identity,
      editedBodyText: input.editedBodyText,
      additionalDetailsText: input.additionalDetailsText ?? model.additionalDetails.text,
      additionalDetailsRevision: detailsRevision,
    },
  };
}

export function createPromptEnhancementMpsCancelIntentV1(
  model: PromptEnhancementMpsFirstPopupModelV1,
): PromptEnhancementMpsIntentResultV1 {
  if (model.actions.cancelRemainingSequence.state !== 'available') {
    return { state: 'intent_unavailable', reasonCodes: ['mps_cancel_disabled'] };
  }
  return {
    state: 'intent_ready',
    reasonCodes: [],
    intent: {
      type: 'cancel_remaining_sequence',
      identity: model.identity,
      disposition: 'blocked_no_send',
    },
  };
}
