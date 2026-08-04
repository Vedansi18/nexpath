import {
  validatePromptEnhancementPrepareResultV1,
  type PromptEnhancementHandoffMetadataV1,
  type PromptEnhancementPrepareResultV1,
} from './contracts.js';
import { validatePromptEnhancementHandoffMetadataV1 } from './handoff-metadata.js';
import type {
  PromptEnhancementMpsContinuationIdentityV1,
  PromptEnhancementMpsContinuationIntentV1,
} from './b3-continuation-popup.js';

export type PromptEnhancementMpsTypedResultStateV1 =
  | 'send_current_pending'
  | 'send_current_acknowledged'
  | 'custom_interruption_acknowledged'
  | 'cancel_acknowledged'
  | 'unsupported'
  | 'stale'
  | 'invalid'
  | 'cross_project'
  | 'duplicate'
  | 'failure'
  | 'terminal';

export interface PromptEnhancementMpsTypedResultV1 {
  requestId: string;
  projectRoot: string;
  sequenceId: string;
  sequenceItemId: string;
  currentItemRevision: number;
  bodyRevision: number;
  detailsRevision: number;
  state: PromptEnhancementMpsTypedResultStateV1;
  publicSafeText?: string;
  feedbackEligibility?: 'eligible' | 'ineligible' | 'not_provided';
}

export interface PromptEnhancementMpsResultPresentationInputV1 {
  result: PromptEnhancementPrepareResultV1;
  handoffMetadata: PromptEnhancementHandoffMetadataV1;
  intent: PromptEnhancementMpsContinuationIntentV1;
  typedResult: PromptEnhancementMpsTypedResultV1;
}

export interface PromptEnhancementMpsResultIdentityV1 extends PromptEnhancementMpsContinuationIdentityV1 {}

export interface PromptEnhancementMpsResultPresentationModelV1 {
  surface: 'prompt_enhancement_mps_result';
  identity: PromptEnhancementMpsResultIdentityV1;
  state: PromptEnhancementMpsTypedResultStateV1;
  statusCopy: string;
  reviewedBody?: {
    text: string;
    additionalDetailsText: string;
    bodyRevision: number;
    detailsRevision: number;
  };
  popupClosed: boolean;
  feedback: 'not_rendered' | 'render_typed_eligible_feedback_state';
  authority: {
    deliveryProof: false;
    completionProof: false;
    pointerAdvance: false;
    retry: false;
    recovery: false;
    feedbackDecision: false;
    hostTransport: false;
  };
}

export type PromptEnhancementMpsResultPresentationResultV1 =
  | { state: 'no_presentation'; reasonCodes: readonly string[]; model?: undefined }
  | { state: 'presented'; reasonCodes: readonly []; model: PromptEnhancementMpsResultPresentationModelV1 };

const STATUS_COPY: Record<PromptEnhancementMpsTypedResultStateV1, string> = {
  send_current_pending: 'Your reviewed sequence prompt is pending typed host handling.',
  send_current_acknowledged: 'Your reviewed sequence prompt was acknowledged by the typed result.',
  custom_interruption_acknowledged: 'The sequence prompt was paused for your direct coding-agent work.',
  cancel_acknowledged: 'The remaining sequence cancellation was acknowledged by the typed result.',
  unsupported: 'This sequence result is not supported here.',
  stale: 'This sequence result is stale and was not applied.',
  invalid: 'This sequence result is invalid and was not applied.',
  cross_project: 'This sequence result belongs to another project and was not applied.',
  duplicate: 'This sequence result is a duplicate and was not applied again.',
  failure: 'The sequence result failed safely without a replacement action.',
  terminal: 'This sequence is already terminal and was not reopened.',
};

/**
 * Presents one correlated typed MPS result. It never turns a result into
 * delivery, completion, retry, feedback, or runtime state on its own.
 */
export function buildPromptEnhancementMpsResultPresentationV1(
  input: PromptEnhancementMpsResultPresentationInputV1,
): PromptEnhancementMpsResultPresentationResultV1 {
  const resultValidation = validatePromptEnhancementPrepareResultV1(input.result);
  if (!resultValidation.ok) {
    return { state: 'no_presentation', reasonCodes: ['invalid_prepare_result', ...resultValidation.reasonCodes] };
  }
  const handoffValidation = validatePromptEnhancementHandoffMetadataV1(
    input.handoffMetadata,
    input.result.currentBody,
    input.result.safetySummary,
    { requestId: input.result.requestId, projectRoot: input.result.projectRoot },
  );
  if (!handoffValidation.ok) {
    return { state: 'no_presentation', reasonCodes: ['invalid_mps_handoff', ...handoffValidation.reasonCodes] };
  }
  const typed = input.typedResult;
  const identity = input.intent.identity;
  if (
    typed.requestId !== identity.requestId
    || typed.projectRoot !== identity.projectRoot
    || typed.sequenceId !== identity.sequenceId
    || typed.sequenceItemId !== identity.sequenceItemId
    || typed.currentItemRevision !== identity.currentItemRevision
    || typed.bodyRevision !== identity.bodyRevision
    || typed.detailsRevision !== identity.detailsRevision
  ) {
    return { state: 'no_presentation', reasonCodes: ['mps_result_identity_mismatch'] };
  }
  if (input.result.requestId !== identity.requestId || input.result.projectRoot !== identity.projectRoot) {
    return { state: 'no_presentation', reasonCodes: ['mps_result_scope_mismatch'] };
  }
  if (!Number.isSafeInteger(typed.currentItemRevision) || typed.currentItemRevision < 0) {
    return { state: 'no_presentation', reasonCodes: ['invalid_result_item_revision'] };
  }
  if (!Number.isSafeInteger(typed.detailsRevision) || typed.detailsRevision < 0) {
    return { state: 'no_presentation', reasonCodes: ['invalid_result_details_revision'] };
  }
  const safeNoOpState = typed.state === 'unsupported' || typed.state === 'stale' || typed.state === 'invalid' || typed.state === 'cross_project' || typed.state === 'duplicate' || typed.state === 'failure' || typed.state === 'terminal';
  if (!safeNoOpState && input.intent.type === 'cancel_remaining_sequence' && typed.state !== 'cancel_acknowledged') {
    return { state: 'no_presentation', reasonCodes: ['cancel_intent_result_type_mismatch'] };
  }
  if (!safeNoOpState && input.intent.type === 'custom_interruption' && typed.state !== 'custom_interruption_acknowledged') {
    return { state: 'no_presentation', reasonCodes: ['interruption_intent_result_type_mismatch'] };
  }
  if (
    input.intent.type === 'send_current_body'
    && typed.state !== 'send_current_pending'
    && typed.state !== 'send_current_acknowledged'
  ) {
    return { state: 'no_presentation', reasonCodes: ['send_intent_result_type_mismatch'] };
  }
  const isSendResult = typed.state === 'send_current_pending' || typed.state === 'send_current_acknowledged';
  const isCustomInterruption = typed.state === 'custom_interruption_acknowledged';
  const feedback = typed.state === 'cancel_acknowledged' && typed.feedbackEligibility === 'eligible'
    ? 'render_typed_eligible_feedback_state'
    : 'not_rendered';
  const model: PromptEnhancementMpsResultPresentationModelV1 = {
    surface: 'prompt_enhancement_mps_result',
    identity,
    state: typed.state,
    statusCopy: STATUS_COPY[typed.state],
    ...(isSendResult && input.intent.type === 'send_current_body'
      ? {
        reviewedBody: {
          text: input.intent.editedBodyText,
          additionalDetailsText: input.intent.additionalDetailsText,
          bodyRevision: identity.bodyRevision,
          detailsRevision: identity.detailsRevision,
        },
      }
      : {}),
    popupClosed: isCustomInterruption,
    feedback,
    authority: {
      deliveryProof: false,
      completionProof: false,
      pointerAdvance: false,
      retry: false,
      recovery: false,
      feedbackDecision: false,
      hostTransport: false,
    },
  };
  return { state: 'presented', reasonCodes: [], model };
}
