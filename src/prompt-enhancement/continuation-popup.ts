import {
  validatePromptEnhancementPrepareResultV1,
  type PromptEnhancementDisposition,
  type PromptEnhancementFutureSequenceRuntimeEventV1,
  type PromptEnhancementHandoffMetadataV1,
  type PromptEnhancementPinchLabelV1,
  type PromptEnhancementPrepareResultV1,
  type PromptEnhancementWhyHelpV1,
} from './contracts.js';
import { validatePromptEnhancementHandoffMetadataV1 } from './handoff-metadata.js';

export const PROMPT_ENHANCEMENT_MPS_CONTINUATION_POPUP_TITLE_V1 = 'Nexpath · Multi-prompt sequence' as const;
export const PROMPT_ENHANCEMENT_MPS_CONTINUATION_POPUP_HEADING_V1 = 'Use enhanced sequence prompt' as const;
export const PROMPT_ENHANCEMENT_MPS_CUSTOM_INTERRUPTION_LABEL_V1 = 'I need to do something else first' as const;
export const PROMPT_ENHANCEMENT_MPS_CUSTOM_INTERRUPTION_HELPER_V1 =
  'Write directly in the coding agent. This same sequence prompt returns after the response.' as const;

export const PROMPT_ENHANCEMENT_MPS_CONTINUATION_LAYOUT_V1 = [
  'enhanced_body',
  'additional_details',
  'custom_interruption',
  'cancel_remaining_sequence',
] as const;

export interface PromptEnhancementMpsContinuationDetailsV1 {
  text: string;
  revision: number;
}

export interface PromptEnhancementMpsContinuationInputV1 {
  result: PromptEnhancementPrepareResultV1;
  handoffMetadata: PromptEnhancementHandoffMetadataV1;
  event: PromptEnhancementFutureSequenceRuntimeEventV1;
  // MPS-3 (Part B): sequence position for the progress line. `done` = items already dealt with
  // (= currentItemIndex, item 0 sent at intake); `total` = the whole item count. Off the packaged
  // continuation (`sequence-packager.ts` progress); the UI derives its own copy, never recomputes.
  progress: { done: number; total: number };
  additionalDetails?: PromptEnhancementMpsContinuationDetailsV1;
  cancel: {
    state: 'available' | 'disabled';
    disposition: PromptEnhancementDisposition;
  };
}

export interface PromptEnhancementMpsContinuationIdentityV1 {
  // MPS-10 (9.1): no `projectRoot` — an absolute path must never appear in the serialized model. The
  // request id already binds scope (it embeds the per-project session id), so it is the only key needed.
  requestId: string;
  sequenceId: string;
  sequenceItemId: string;
  currentItemRevision: number;
  bodyRevision: number;
  detailsRevision: number;
  continuationDispositionId?: string;
}

export interface PromptEnhancementMpsContinuationPopupModelV1 {
  surface: 'prompt_enhancement_mps_continuation_popup';
  title: typeof PROMPT_ENHANCEMENT_MPS_CONTINUATION_POPUP_TITLE_V1;
  heading: typeof PROMPT_ENHANCEMENT_MPS_CONTINUATION_POPUP_HEADING_V1;
  layout: typeof PROMPT_ENHANCEMENT_MPS_CONTINUATION_LAYOUT_V1;
  // MPS-3 (Part B): sequence position, rendered as a progress line at the top. Data only — the
  // renderer formats the copy ("Sequence N of M"); the model never carries the formatted string.
  progress: { done: number; total: number };
  // Deterministic header copy from the typed uiView (same source as the PE popup), present only
  // when supplied. The UI renders them like PE and never invents them.
  pinchLabel?: PromptEnhancementPinchLabelV1;
  whyHelp?: PromptEnhancementWhyHelpV1;
  identity: PromptEnhancementMpsContinuationIdentityV1;
  body: {
    text: string;
    editable: true;
    originalPromptText: string;
  };
  additionalDetails: {
    visible: boolean;
    text: string;
    revision: number;
  };
  actions: {
    submitCurrentBody: 'typed_current_body_plus_details';
    customInterruption: {
      label: typeof PROMPT_ENHANCEMENT_MPS_CUSTOM_INTERRUPTION_LABEL_V1;
      helper: typeof PROMPT_ENHANCEMENT_MPS_CUSTOM_INTERRUPTION_HELPER_V1;
    };
    cancelRemainingSequence: {
      label: 'Cancel (remaining multi-prompt sequence)';
      state: 'available' | 'disabled';
      disposition: PromptEnhancementDisposition;
    };
    originalPrompt: 'not_rendered';
  };
  keyboard: {
    plainEnter: 'emit_one_typed_current_body_plus_details_request';
    // MPS-2 (6.3): on a continuation, Escape now CANCELS the remaining sequence (terminal) — the delivery
    // mapper turns the shell's decline outcome into `cancel_remaining_sequence`, so the declared contract
    // value must match that runtime, not the old editor-blur claim. What the user is SHOWN about Escape
    // (help copy, and whether a first Escape blurs the editor before cancelling) is a UI decision → Hiren's;
    // it is deliberately not encoded here.
    escape: 'cancel_remaining_sequence';
    ctrlOrCmdJ: 'insert_newline';
    ctrlOrCmdUpDown: 'move_by_line';
    leftRight: 'move_by_character';
  };
  authority: {
    localSequenceRuntime: false;
    localQueuePointer: false;
    localAutoSend: false;
    localAdvance: false;
    stopIsCompletionProof: false;
    customInterruptionIsCancel: false;
    hostTransport: false;
  };
}

export type PromptEnhancementMpsContinuationBuildResultV1 =
  | { state: 'no_popup'; reasonCodes: readonly string[]; model?: undefined }
  | { state: 'ready'; reasonCodes: readonly []; model: PromptEnhancementMpsContinuationPopupModelV1 };

export interface PromptEnhancementMpsContinuationSendIntentV1 {
  type: 'send_current_body';
  identity: PromptEnhancementMpsContinuationIdentityV1;
  editedBodyText: string;
  additionalDetailsText: string;
  additionalDetailsRevision: number;
}

export interface PromptEnhancementMpsCustomInterruptionIntentV1 {
  type: 'custom_interruption';
  identity: PromptEnhancementMpsContinuationIdentityV1;
}

export interface PromptEnhancementMpsContinuationCancelIntentV1 {
  type: 'cancel_remaining_sequence';
  identity: PromptEnhancementMpsContinuationIdentityV1;
  disposition: 'blocked_no_send';
}

export type PromptEnhancementMpsContinuationIntentV1 =
  | PromptEnhancementMpsContinuationSendIntentV1
  | PromptEnhancementMpsCustomInterruptionIntentV1
  | PromptEnhancementMpsContinuationCancelIntentV1;

export type PromptEnhancementMpsContinuationIntentResultV1 =
  | { state: 'intent_unavailable'; reasonCodes: readonly string[]; intent?: undefined }
  | { state: 'intent_ready'; reasonCodes: readonly []; intent: PromptEnhancementMpsContinuationIntentV1 };

/**
 * Projects one correlated active-item continuation result. Stop is accepted
 * only as a typed decision opportunity; it never authorizes completion or
 * runtime transition in this UI consumer.
 */
export function buildPromptEnhancementMpsContinuationPopupV1(
  input: PromptEnhancementMpsContinuationInputV1,
): PromptEnhancementMpsContinuationBuildResultV1 {
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
  const event = input.event;
  const currentItemRevision = event.currentItemRevision;
  const handoffKindAllowed = input.handoffMetadata.handoffKind === "first_prompt_handoff_candidate"
    || input.handoffMetadata.handoffKind === "compact_sequence_summary_candidate";
  if (input.result.disposition !== "show_current_body" || !handoffKindAllowed) {
    return { state: "no_popup", reasonCodes: ["continuation_handoff_not_applicable"] };
  }
  if (event.contractVersion !== 1) return { state: 'no_popup', reasonCodes: ['unsupported_continuation_contract'] };
  if (event.requestId !== input.result.requestId || event.projectScope !== input.result.projectRoot) {
    return { state: 'no_popup', reasonCodes: ['continuation_scope_mismatch'] };
  }
  if (
    !event.sequenceId
    || !event.sequenceItemId
    || typeof currentItemRevision !== "number"
    || !Number.isSafeInteger(currentItemRevision)
    || currentItemRevision < 0
    || event.bodyRevision !== input.result.currentBody.bodyRevision
  ) {
    return { state: 'no_popup', reasonCodes: ['continuation_identity_incomplete'] };
  }
  if (event.stateFreshness !== 'current') return { state: 'no_popup', reasonCodes: ['continuation_not_current'] };
  if (
    event.continuationActionState !== undefined
    && event.continuationActionState !== "continue_current_item"
  ) {
    return { state: "no_popup", reasonCodes: ["continuation_action_not_current_item"] };
  }
  if (
    event.terminalTransitionState !== undefined
    && event.terminalTransitionState !== 'none'
  ) {
    return { state: 'no_popup', reasonCodes: ['continuation_terminal_state_rejected'] };
  }
  if (
    event.stopEventState !== 'stop_fired_non_proof'
    && event.stopEventState !== 'response_finished_candidate_unproven'
  ) {
    return { state: 'no_popup', reasonCodes: ['stop_decision_context_missing'] };
  }
  if (
    input.cancel.disposition !== 'blocked_no_send'
    || (input.result.safetySummary.noAutomaticSend !== true)
  ) {
    return { state: 'no_popup', reasonCodes: ['invalid_continuation_cancel_disposition'] };
  }
  const details = input.additionalDetails ?? { text: '', revision: 0 };
  if (!Number.isSafeInteger(details.revision) || details.revision < 0) {
    return { state: 'no_popup', reasonCodes: ['invalid_additional_details_revision'] };
  }
  const safeCurrentItemRevision = currentItemRevision as number;
  const identity: PromptEnhancementMpsContinuationIdentityV1 = {
    requestId: input.result.requestId,
    sequenceId: event.sequenceId,
    sequenceItemId: event.sequenceItemId,
    currentItemRevision: safeCurrentItemRevision,
    bodyRevision: input.result.currentBody.bodyRevision,
    detailsRevision: details.revision,
    continuationDispositionId: event.continuationDispositionId,
  };
  return {
    state: 'ready',
    reasonCodes: [],
    model: {
      surface: 'prompt_enhancement_mps_continuation_popup',
      title: PROMPT_ENHANCEMENT_MPS_CONTINUATION_POPUP_TITLE_V1,
      heading: PROMPT_ENHANCEMENT_MPS_CONTINUATION_POPUP_HEADING_V1,
      layout: PROMPT_ENHANCEMENT_MPS_CONTINUATION_LAYOUT_V1,
      progress: { done: input.progress.done, total: input.progress.total },
      ...(input.result.uiView.pinchLabel ? { pinchLabel: input.result.uiView.pinchLabel } : {}),
      ...(input.result.uiView.whyHelp ? { whyHelp: input.result.uiView.whyHelp } : {}),
      identity,
      body: {
        text: input.result.currentBody.text,
        editable: true,
        originalPromptText: input.result.currentBody.originalPromptText,
      },
      additionalDetails: { visible: input.additionalDetails !== undefined, text: details.text, revision: details.revision },
      actions: {
        submitCurrentBody: 'typed_current_body_plus_details',
        customInterruption: {
          label: PROMPT_ENHANCEMENT_MPS_CUSTOM_INTERRUPTION_LABEL_V1,
          helper: PROMPT_ENHANCEMENT_MPS_CUSTOM_INTERRUPTION_HELPER_V1,
        },
        cancelRemainingSequence: {
          label: 'Cancel (remaining multi-prompt sequence)',
          state: input.cancel.state,
          disposition: input.cancel.disposition,
        },
        originalPrompt: 'not_rendered',
      },
      keyboard: {
        plainEnter: 'emit_one_typed_current_body_plus_details_request',
        escape: 'cancel_remaining_sequence',
        ctrlOrCmdJ: 'insert_newline',
        ctrlOrCmdUpDown: 'move_by_line',
        leftRight: 'move_by_character',
      },
      authority: {
        localSequenceRuntime: false,
        localQueuePointer: false,
        localAutoSend: false,
        localAdvance: false,
        stopIsCompletionProof: false,
        customInterruptionIsCancel: false,
        hostTransport: false,
      },
    },
  };
}

export function createPromptEnhancementMpsContinuationSendIntentV1(
  model: PromptEnhancementMpsContinuationPopupModelV1,
  input: { editedBodyText: string; additionalDetailsText?: string; additionalDetailsRevision?: number },
): PromptEnhancementMpsContinuationIntentResultV1 {
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

export function createPromptEnhancementMpsCustomInterruptionIntentV1(
  model: PromptEnhancementMpsContinuationPopupModelV1,
): PromptEnhancementMpsContinuationIntentResultV1 {
  return {
    state: 'intent_ready',
    reasonCodes: [],
    intent: { type: 'custom_interruption', identity: model.identity },
  };
}

export function createPromptEnhancementMpsContinuationCancelIntentV1(
  model: PromptEnhancementMpsContinuationPopupModelV1,
): PromptEnhancementMpsContinuationIntentResultV1 {
  if (model.actions.cancelRemainingSequence.state !== 'available') {
    return { state: 'intent_unavailable', reasonCodes: ['mps_cancel_disabled'] };
  }
  return {
    state: 'intent_ready',
    reasonCodes: [],
    intent: { type: 'cancel_remaining_sequence', identity: model.identity, disposition: 'blocked_no_send' },
  };
}
