import {
  PROMPT_ENHANCEMENT_CONTRACT_VERSION,
  type PromptEnhancementActionEntryV1,
  type PromptEnhancementActionType,
  type PromptEnhancementFallbackMode,
  type PromptEnhancementHostSurface,
  type PromptEnhancementSchemaVersion,
  type PromptEnhancementSendPolicy,
  type PromptEnhancementUiViewPayloadV1,
} from './contracts.js';

export type PromptEnhancementPopupLifecycleState =
  | 'not_applicable_no_popup'
  | 'initial_loading'
  | 'ready_editable_body'
  | 'action_loading'
  | 'validation_repair'
  | 'fallback_current_or_original'
  | 'blocked_or_no_send_high_risk'
  | 'skipped_or_rejected'
  | 'delivered_to_input';

export type PromptEnhancementCurrentTreatmentMode =
  | 'default'
  | 'shorter'
  | 'more_thorough'
  | 'more_project_grounded'
  | 'additional_details_merged'
  | 'fallback_original_or_current';

export type PromptEnhancementAdditionalDetailsState =
  | 'empty'
  | 'dirty_unsubmitted'
  | 'submitted_merging'
  | 'merged_preview_ready'
  | 'merge_failed_keep_current'
  | 'over_budget_deferred';

export type PromptEnhancementSendDeliveryMode =
  | 'insert_for_user_submit'
  | 'send_original_or_current_only'
  | 'delivery_unavailable'
  | 'non_clipboard_user_controlled_delivery_pending_future_host_capability';

export type PromptEnhancementPopupEventType =
  | 'deliver_current_body'
  | 'use_original'
  | 'edit_body'
  | 'skip_or_reject'
  | 'request_shorter'
  | 'request_more_thorough'
  | 'request_more_project_grounded'
  | 'submit_additional_details'
  | 'explicit_feedback'
  | 'close_no_send';

export type PromptEnhancementPopupActionAvailability =
  | 'available'
  | 'disabled_budget'
  | 'disabled_not_applicable'
  | 'loading'
  | 'failed_keep_previous'
  | 'requires_llm_budget';

export type PromptEnhancementPopupArbitrationState =
  | 'pe_review_priority_product_feedback_waits'
  | 'product_feedback_shown_no_pe_exposure'
  | 'old_advisory_shown_no_pe_exposure'
  | 'pe_popup_shown_acknowledged'
  | 'no_popup_not_applicable';

export type PromptEnhancementVisibleSurfaceAckState =
  | 'render_requested'
  | 'pe_body_visible'
  | 'fallback_visible'
  | 'no_tty'
  | 'unsupported_host_or_extension'
  | 'render_failure'
  | 'not_counted_as_shown';

export type PromptEnhancementDeliveryEvidenceState =
  | 'direct_insert_to_existing_chat_input'
  | 'auto_paste_to_existing_chat_attempted'
  | 'clipboard_only_manual_paste_required'
  | 'foreground_attempted_not_acknowledgment'
  | 'delivery_failed_or_unknown'
  | 'submit_unconfirmed_manual_user_action_required';

export type PromptEnhancementPromptOriginPolicyState =
  | 'pe_generated_body_requires_origin_guard'
  | 'ordinary_user_prompt_full_processing'
  | 'generated_origin_guard_mismatch_conservative_processing'
  | 'future_hold_commit_policy_required';

export type PromptEnhancementPreSendSurfaceMode =
  | 'single_editable_body_v1'
  | 'fallback_original_or_current'
  | 'non_old_copy_delivery_pending_future_host_capability'
  | 'no_popup'
  | 'blocked_or_no_send_high_risk'
  | 'future_sequence_surface';

export type PromptEnhancementPreExecutionPromptHoldState =
  | 'not_required_no_popup'
  | 'host_prompt_held_for_pe_review'
  | 'held_original_available_for_send_original'
  | 'enhanced_body_selected_for_delivery'
  | 'send_original_selected'
  | 'skip_continue_original'
  | 'cancel_no_send'
  | 'hold_timeout_original_or_no_popup'
  | 'hold_failed_no_pe_popup'
  | 'host_cannot_hold_non_old_copy_delivery_pending_future_host_capability'
  | 'hold_state_missing_invalid';

export type PromptEnhancementOriginalPromptDispositionState =
  | 'held_pending_user_choice'
  | 'delivered_as_original'
  | 'replaced_by_validated_enhanced_body'
  | 'discarded_by_cancel_no_send'
  | 'continued_without_pe_no_popup'
  | 'unknown_original_disposition_invalid';

export type PromptEnhancementHoldCommitPolicyState =
  | 'read_only_hold_context'
  | 'commit_original_once_on_send_original'
  | 'commit_original_once_on_skip_continue'
  | 'pe_generated_delivery_ack_only'
  | 'commit_enhanced_as_user_submitted_if_host_confirms'
  | 'cancel_no_prompt_commit'
  | 'unsupported_fallback_no_pe_commit'
  | 'hold_commit_pending_validation'
  | 'hold_commit_state_missing_invalid'
  | 'current_stop_bridge_original_already_processed';

export type PromptEnhancementDeliveryOriginGuardState =
  | 'not_delivered'
  | 'pe_generated_next_submit_guard_required'
  | 'guard_written_for_exact_body'
  | 'guard_written_for_body_ref'
  | 'next_submit_processed_as_delivery_echo'
  | 'next_submit_mismatch_cleared'
  | 'origin_guard_missing_invalid';

export type PromptEnhancementPromptSubmitProcessingPolicy =
  | 'normal_user_prompt_full_processing'
  | 'pe_generated_delivery_skip_classification'
  | 'pe_sequence_prompt_skip_classification'
  | 'metadata_only_delivery_ack'
  | 'future_sequence_runtime_owned'
  | 'unknown_origin_conservative';

export type PromptEnhancementSequenceSummaryState =
  | 'not_sequence'
  | 'compact_first_popup_summary_available'
  | 'sequence_runtime_deferred_to_future_sequence'
  | 'sequence_state_missing_summary_suppressed';

export type PromptEnhancementFirstPopupSequenceDispositionState =
  | 'not_sequence'
  | 'current_body_rejected_only'
  | 'use_original_no_start'
  | 'dismissed_no_feedback_no_start'
  | 'closed_or_failed_no_start'
  | 'disposition_pending_future_host_capability'
  | 'unknown_sequence_disposition_invalid';

export type PromptEnhancementProductFeedbackCoDueState =
  | 'not_due'
  | 'pe_review_priority_product_rating_waits'
  | 'due_separate_product_rating_waits'
  | 'due_separate_defer_pe_requires_future_host_capability'
  | 'stacked_surfaces_not_approved'
  | 'product_rating_preempted_pe_review_invalid';

export type PromptEnhancementPeExposureCountPolicy =
  | 'do_not_count'
  | 'count_after_visible_ack_only'
  | 'count_non_old_copy_fallback_only_if_future_host_capability_approved'
  | 'count_blocked_visible_state_only'
  | 'count_policy_missing_invalid';

export type PromptEnhancementExtensionCapabilityState =
  | 'core_only'
  | 'extension_pe_supported'
  | 'extension_ds_only_no_pe'
  | 'extension_fallback_non_old_copy_unavailable'
  | 'extension_payload_mismatch';

export interface PromptEnhancementPopupActionStateV1 {
  action: PromptEnhancementActionEntryV1;
  uiAvailabilityState: PromptEnhancementPopupActionAvailability;
  currentBodyActionInputPolicy:
    | 'accepted_canonical_body_only'
    | 'current_visible_edited_body_plus_details'
    | 'not_applicable';
  keepsPreviousValidBodyAvailable: boolean;
  staleResultCanOverwriteCurrentBody: false;
}

export interface PromptEnhancementPopupFeedbackEntryV1 {
  state: 'available' | 'disabled_not_applicable';
  actionId?: string;
  suggestedReasonChoices: readonly ['not_relevant_enough', 'too_much_or_too_long'];
  customFeedbackPath: 'custom_typed_local_bounded_when_allowed';
  productRatingSeparated: true;
  canMutateCurrentBody: false;
  canMutateSafetyOrAuthorityFloors: false;
}

export interface PromptEnhancementPopupSessionInputV1 {
  viewPayload: PromptEnhancementUiViewPayloadV1;
  validationDecisionId: string;
  preSendBoundaryDecisionId?: string;
  lifecycleState?: PromptEnhancementPopupLifecycleState;
  additionalDetailsState?: PromptEnhancementAdditionalDetailsState;
  deliverySurface?: PromptEnhancementHostSurface;
  popupArbitrationState?: PromptEnhancementPopupArbitrationState;
  visibleSurfaceAckState?: PromptEnhancementVisibleSurfaceAckState;
  deliveryEvidenceState?: PromptEnhancementDeliveryEvidenceState;
  promptOriginPolicyState?: PromptEnhancementPromptOriginPolicyState;
  productFeedbackCoDueState?: PromptEnhancementProductFeedbackCoDueState;
  firstPopupSequenceDispositionState?: PromptEnhancementFirstPopupSequenceDispositionState;
  deliveryOriginGuardState?: PromptEnhancementDeliveryOriginGuardState;
  promptSubmitProcessingPolicy?: PromptEnhancementPromptSubmitProcessingPolicy;
  extensionCapabilityState?: PromptEnhancementExtensionCapabilityState;
  timestampMs: number;
}

export interface PromptEnhancementPopupSessionV1 {
  popupModelVersion: PromptEnhancementSchemaVersion;
  enhancementId: string;
  popupTriggerMoment: 'pre_execution_prompt_submit';
  surfaceKind: 'enhancement_popup_single_body';
  popupLifecycleState: PromptEnhancementPopupLifecycleState;
  currentBodyId: string;
  currentBodyText: string;
  bodyRevision: number;
  acceptedCanonicalBodyRevisionId: string;
  originalPromptPreservationState: 'full_original_in_body' | 'missing_invalid';
  currentTreatmentMode: PromptEnhancementCurrentTreatmentMode;
  preSendBoundaryState: {
    preSendBoundaryDecisionId: string;
    surfaceMode: PromptEnhancementPreSendSurfaceMode;
    bodyDisplayState:
      | 'exact_current_body_visible'
      | 'full_original_visible'
      | 'body_missing_invalid'
      | 'fallback_body_visible'
      | 'previous_body_visible';
    editabilityState:
      | 'editable'
      | 'locked_action_loading'
      | 'locked_validation_repair'
      | 'locked_delivery_in_progress'
      | 'read_only_fallback';
    essentialControlSet: readonly [
      'use_current_body',
      'use_original',
      'shorter',
      'more_thorough',
      'more_project_grounded',
      'apply_details',
      'feedback',
      'close',
    ];
    deferredControlSet: readonly [
      'visible_section_controls',
      'diff',
      'variants',
      'source_browser',
      'full_modification_instructions',
      'advanced_history',
      'queue_controls',
      'settings_controls',
    ];
    rejectedControlSet: readonly [
      'decision_session_option_list',
      'show_simpler_options',
      'foreground_safer',
      'auto_submit',
      'product_rating_as_pe_feedback',
      'raw_internal_source_diagnostics',
    ];
    staleResultPolicy: 'stale_results_cannot_overwrite_current_body';
    previousBodyAvailability: 'previous_valid_body_available_during_action_or_fallback';
  };
  directionalActionSet: readonly PromptEnhancementPopupActionStateV1[];
  visibleSectionControlState: 'none_v1_internal_metadata_only';
  additionalDetailsState: PromptEnhancementAdditionalDetailsState;
  additionalDetailsActionId?: string;
  feedbackEntry: PromptEnhancementPopupFeedbackEntryV1;
  closeActionId: string;
  loadingFallbackControls: {
    useOriginalAvailable: boolean;
    closeNoSendAvailable: boolean;
    useCurrentAvailableWhenPreviousBodyValid: boolean;
  };
  popupArbitrationState: PromptEnhancementPopupArbitrationState;
  productFeedbackCoDueState: PromptEnhancementProductFeedbackCoDueState;
  visibleSurfaceAckState: PromptEnhancementVisibleSurfaceAckState;
  peExposureCountPolicy: PromptEnhancementPeExposureCountPolicy;
  deliveryEvidenceState: PromptEnhancementDeliveryEvidenceState;
  promptOriginPolicyState: PromptEnhancementPromptOriginPolicyState;
  preExecutionPromptHoldState: PromptEnhancementPreExecutionPromptHoldState;
  originalPromptDispositionState: PromptEnhancementOriginalPromptDispositionState;
  holdCommitPolicyState: PromptEnhancementHoldCommitPolicyState;
  deliveryOriginGuardState: PromptEnhancementDeliveryOriginGuardState;
  promptSubmitProcessingPolicy: PromptEnhancementPromptSubmitProcessingPolicy;
  extensionCapabilityState: PromptEnhancementExtensionCapabilityState;
  sameTurnUserPromptSubmitReplacementClaimed: false;
  productFeedbackBoundaryState: 'separate_product_health_rating_not_pe_feedback';
  sendDeliveryMode: PromptEnhancementSendDeliveryMode;
  requiresUserFinalSubmit: true;
  validationDecisionId: string;
  sendabilityState: PromptEnhancementUiViewPayloadV1['body']['sendPolicy'];
  fallbackMode: PromptEnhancementFallbackMode;
  sourceLabelVisibilityState: 'hidden_internal' | 'public_safe_light_label' | 'future_expanded';
  privacyTrustCueState: 'public_safe_light_label' | 'hidden_internal';
  handoffSummaryState: 'none' | 'compact_first_popup_summary' | 'future_or_future_sequence_owned';
  sequenceSummaryState: PromptEnhancementSequenceSummaryState;
  firstPopupSequenceDispositionState: PromptEnhancementFirstPopupSequenceDispositionState;
  latencyBudgetState: PromptEnhancementActionEntryV1['callVisibilityMode'];
  reasonCodes: readonly string[];
  invariants: {
    oneEditableBodyOnly: true;
    oldDecisionSessionOptionListRejected: true;
    visibleSectionControlsRejected: true;
    foregroundSaferRejected: true;
    autoSendRejected: true;
    textOnlyDeliveryAuthorityRejected: true;
    clipboardManualCopyFallbackRejected: true;
    sameTurnUserPromptSubmitReplacementRejected: true;
    activeSequenceRuntimeRejected: true;
    productFeedbackAsPeFeedbackRejected: true;
    uiConsumesTypedStateOnly: true;
  };
}

export interface PromptEnhancementPopupEventInputV1 {
  session: PromptEnhancementPopupSessionV1;
  eventType: PromptEnhancementPopupEventType;
  actionId: string;
  currentBodyId: string;
  bodyRevision: number;
  editedBodyText?: string;
  additionalDetailsText?: string;
  feedbackCategory?: string;
  timestampMs: number;
  realUserInitiated: true;
}

export interface PromptEnhancementPopupEventV1 {
  eventVersion: PromptEnhancementSchemaVersion;
  eventType: PromptEnhancementPopupEventType;
  enhancementId: string;
  actionId: string;
  feedbackCategory?: string;
  currentBodyId: string;
  bodyRevision: number;
  sendPolicy: PromptEnhancementSendPolicy;
  editedBodyPolicy: 'full_body_required' | 'not_applicable';
  additionalDetailsPolicy: 'bounded_recomposition_input_only' | 'not_applicable';
  feedbackPolicy: 'typed_scoped_feedback_only' | 'not_applicable';
  firstPopupSequenceDispositionState: PromptEnhancementFirstPopupSequenceDispositionState;
  productFeedbackBoundaryState: PromptEnhancementPopupSessionV1['productFeedbackBoundaryState'];
  promptSubmitProcessingPolicy: PromptEnhancementPromptSubmitProcessingPolicy;
  closeDisposition: 'no_send' | 'not_applicable';
  reasonCodes: readonly string[];
  staleOrMismatched: boolean;
  realUserInitiated: true;
  timestampMs: number;
}

const REQUIRED_ACTIONS: readonly PromptEnhancementActionType[] = [
  'use_current_body',
  'use_original',
  'shorter',
  'more_thorough',
  'more_project_grounded',
  'apply_details',
  'feedback',
  'close',
];

// Body-recomposing actions: they keep the previous valid body available for
// Go back. `apply_details` belongs here because applying details recomposes the
// body — but it is NOT a visible directional row (see DIRECTIONAL_ROW_ACTIONS).
const DIRECTIONAL_ACTIONS = new Set<PromptEnhancementActionType>([
  'shorter',
  'more_thorough',
  'more_project_grounded',
  'apply_details',
]);

// Visible directional rows only. Excludes `apply_details`: UI-8 removed the
// Apply button — Enter on the Additional details row applies, there is no
// standalone "Apply details" row.
const DIRECTIONAL_ROW_ACTIONS = new Set<PromptEnhancementActionType>([
  'shorter',
  'more_thorough',
  'more_project_grounded',
]);

/**
 * D2 (P7-G1 / decision-rule-5): a `no_send` (blocked) or `no_popup` body must never carry the offending
 * generated text through the typed UI chain. Every UI layer self-scrubs on this predicate — the
 * body is excluded (empty), not relied on the terminal `ui-safety` scrub alone (defense-in-depth).
 */
export function isPromptEnhancementBlockedNoSendPolicyV1(
  sendPolicy: PromptEnhancementUiViewPayloadV1['body']['sendPolicy'],
): boolean {
  return sendPolicy === 'no_send' || sendPolicy === 'no_popup';
}

export function buildPromptEnhancementPopupSessionV1(
  input: PromptEnhancementPopupSessionInputV1,
): PromptEnhancementPopupSessionV1 {
  const { viewPayload } = input;
  const actionByType = new Map(viewPayload.actions.map((action) => [action.actionType, action]));
  const reasonCodes = popupReasonCodes(viewPayload, actionByType);
  const fallbackMode = viewPayload.body.fallbackMode;
  const lifecycleState = input.lifecycleState ?? lifecycleStateFor(viewPayload.body.sendPolicy, fallbackMode, viewPayload.body.actionLoadingState);
  const additionalDetailsAction = actionByType.get('apply_details');
  const feedbackAction = actionByType.get('feedback');
  const closeAction = actionByType.get('close');

  return {
    popupModelVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
    enhancementId: viewPayload.enhancementId,
    popupTriggerMoment: 'pre_execution_prompt_submit',
    surfaceKind: 'enhancement_popup_single_body',
    popupLifecycleState: lifecycleState,
    currentBodyId: viewPayload.body.currentBodyId,
    // D2 (P7-G1): self-scrub — a blocked/no-send body carries no generated text through this layer.
    currentBodyText: isPromptEnhancementBlockedNoSendPolicyV1(viewPayload.body.sendPolicy) ? '' : viewPayload.body.text,
    bodyRevision: viewPayload.body.bodyRevision,
    acceptedCanonicalBodyRevisionId: `${viewPayload.body.currentBodyId}:revision:${viewPayload.body.bodyRevision}`,
    originalPromptPreservationState: viewPayload.body.originalPromptPreservation === 'visible_verbatim'
      ? 'full_original_in_body'
      : 'missing_invalid',
    currentTreatmentMode: treatmentModeFor(viewPayload.body.levelState, fallbackMode, input.additionalDetailsState),
    preSendBoundaryState: {
      preSendBoundaryDecisionId: input.preSendBoundaryDecisionId ?? `${viewPayload.enhancementId}:pre-send-boundary:v1`,
      surfaceMode: preSendSurfaceModeFor(lifecycleState, fallbackMode, viewPayload.handoffAndSequenceSummary),
      bodyDisplayState: bodyDisplayStateFor(viewPayload, fallbackMode),
      editabilityState: editabilityStateFor(lifecycleState, viewPayload.body.actionLoadingState, fallbackMode),
      essentialControlSet: [
        'use_current_body',
        'use_original',
        'shorter',
        'more_thorough',
        'more_project_grounded',
        'apply_details',
        'feedback',
        'close',
      ],
      deferredControlSet: [
        'visible_section_controls',
        'diff',
        'variants',
        'source_browser',
        'full_modification_instructions',
        'advanced_history',
        'queue_controls',
        'settings_controls',
      ],
      rejectedControlSet: [
        'decision_session_option_list',
        'show_simpler_options',
        'foreground_safer',
        'auto_submit',
        'product_rating_as_pe_feedback',
        'raw_internal_source_diagnostics',
      ],
      staleResultPolicy: 'stale_results_cannot_overwrite_current_body',
      previousBodyAvailability: 'previous_valid_body_available_during_action_or_fallback',
    },
    directionalActionSet: viewPayload.actions
      .filter((action) => DIRECTIONAL_ROW_ACTIONS.has(action.actionType))
      .map((action) => popupActionState(action)),
    visibleSectionControlState: 'none_v1_internal_metadata_only',
    additionalDetailsState: input.additionalDetailsState ?? 'empty',
    additionalDetailsActionId: additionalDetailsAction?.actionId,
    feedbackEntry: {
      state: feedbackAction?.availability === 'available' ? 'available' : 'disabled_not_applicable',
      actionId: feedbackAction?.actionId,
      suggestedReasonChoices: ['not_relevant_enough', 'too_much_or_too_long'],
      customFeedbackPath: 'custom_typed_local_bounded_when_allowed',
      productRatingSeparated: true,
      canMutateCurrentBody: false,
      canMutateSafetyOrAuthorityFloors: false,
    },
    closeActionId: closeAction?.actionId ?? `${viewPayload.body.currentBodyId}:action:close`,
    loadingFallbackControls: {
      useOriginalAvailable: actionByType.get('use_original')?.availability === 'available',
      closeNoSendAvailable: closeAction?.availability === 'available',
      useCurrentAvailableWhenPreviousBodyValid: fallbackMode === 'previous_sendable_body' || viewPayload.body.sendPolicy === 'send_current',
    },
    popupArbitrationState: input.popupArbitrationState ?? defaultPopupArbitrationState(lifecycleState),
    productFeedbackCoDueState: input.productFeedbackCoDueState ?? defaultProductFeedbackCoDueState(lifecycleState),
    visibleSurfaceAckState: input.visibleSurfaceAckState ?? defaultVisibleSurfaceAckState(lifecycleState, viewPayload.actionInputContract.rendererState),
    peExposureCountPolicy: exposureCountPolicyFor(input.visibleSurfaceAckState ?? defaultVisibleSurfaceAckState(lifecycleState, viewPayload.actionInputContract.rendererState)),
    deliveryEvidenceState: input.deliveryEvidenceState ?? defaultDeliveryEvidenceState(input.deliverySurface, fallbackMode),
    promptOriginPolicyState: input.promptOriginPolicyState ?? 'pe_generated_body_requires_origin_guard',
    preExecutionPromptHoldState: preExecutionHoldStateFor(lifecycleState, input.deliverySurface),
    originalPromptDispositionState: originalPromptDispositionStateFor(viewPayload.body.sendPolicy, lifecycleState),
    holdCommitPolicyState: holdCommitPolicyStateFor(input.deliverySurface),
    deliveryOriginGuardState: input.deliveryOriginGuardState ?? defaultDeliveryOriginGuardState(viewPayload.body.sendPolicy, viewPayload.body.generatedOriginState),
    promptSubmitProcessingPolicy: input.promptSubmitProcessingPolicy ?? defaultPromptSubmitProcessingPolicy(viewPayload.body.generatedOriginState),
    extensionCapabilityState: input.extensionCapabilityState ?? defaultExtensionCapabilityState(input.deliverySurface),
    sameTurnUserPromptSubmitReplacementClaimed: false,
    productFeedbackBoundaryState: 'separate_product_health_rating_not_pe_feedback',
    sendDeliveryMode: deliveryModeFor(viewPayload.body.sendPolicy, fallbackMode, input.deliverySurface),
    requiresUserFinalSubmit: true,
    validationDecisionId: input.validationDecisionId,
    sendabilityState: viewPayload.body.sendPolicy,
    fallbackMode,
    sourceLabelVisibilityState: viewPayload.publicTrustCues.length > 0 ? 'public_safe_light_label' : 'hidden_internal',
    privacyTrustCueState: viewPayload.publicTrustCues.some((cue) => cue.rawPrivateDataExcluded)
      ? 'public_safe_light_label'
      : 'hidden_internal',
    handoffSummaryState: viewPayload.handoffAndSequenceSummary ? 'compact_first_popup_summary' : 'none',
    sequenceSummaryState: sequenceSummaryStateFor(viewPayload.handoffAndSequenceSummary),
    firstPopupSequenceDispositionState: input.firstPopupSequenceDispositionState
      ?? firstPopupSequenceDispositionStateFor(viewPayload.handoffAndSequenceSummary, lifecycleState),
    latencyBudgetState: viewPayload.actions.some((action) => action.callVisibilityMode === 'llm_wording')
      ? 'llm_wording'
      : viewPayload.actions.some((action) => action.callVisibilityMode === 'provider_unavailable')
        ? 'provider_unavailable'
        : viewPayload.actions.some((action) => action.callVisibilityMode === 'fallback_no_llm')
          ? 'fallback_no_llm'
          : 'deterministic',
    reasonCodes,
    invariants: {
      oneEditableBodyOnly: true,
      oldDecisionSessionOptionListRejected: true,
      visibleSectionControlsRejected: true,
      foregroundSaferRejected: true,
      autoSendRejected: true,
      textOnlyDeliveryAuthorityRejected: true,
      clipboardManualCopyFallbackRejected: true,
      sameTurnUserPromptSubmitReplacementRejected: true,
      activeSequenceRuntimeRejected: true,
      productFeedbackAsPeFeedbackRejected: true,
      uiConsumesTypedStateOnly: true,
    },
  };
}

export function createPromptEnhancementPopupEventV1(
  input: PromptEnhancementPopupEventInputV1,
): PromptEnhancementPopupEventV1 {
  const staleOrMismatched = input.currentBodyId !== input.session.currentBodyId
    || input.bodyRevision !== input.session.bodyRevision;
  const reasonCodes = popupEventReasonCodes(input, staleOrMismatched);
  return {
    eventVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
    eventType: input.eventType,
    enhancementId: input.session.enhancementId,
    feedbackCategory: input.eventType === 'explicit_feedback' ? input.feedbackCategory : undefined,
    actionId: input.actionId,
    currentBodyId: input.currentBodyId,
    bodyRevision: input.bodyRevision,
    sendPolicy: sendPolicyForEvent(input.eventType, input.session),
    editedBodyPolicy: input.eventType === 'deliver_current_body' || input.eventType === 'edit_body'
      ? 'full_body_required'
      : 'not_applicable',
    additionalDetailsPolicy: input.eventType === 'submit_additional_details'
      ? 'bounded_recomposition_input_only'
      : 'not_applicable',
    feedbackPolicy: input.eventType === 'explicit_feedback' || input.eventType === 'skip_or_reject'
      ? 'typed_scoped_feedback_only'
      : 'not_applicable',
    firstPopupSequenceDispositionState: firstPopupSequenceDispositionForEvent(input),
    productFeedbackBoundaryState: input.session.productFeedbackBoundaryState,
    promptSubmitProcessingPolicy: input.session.promptSubmitProcessingPolicy,
    closeDisposition: input.eventType === 'close_no_send' ? 'no_send' : 'not_applicable',
    reasonCodes,
    staleOrMismatched,
    realUserInitiated: true,
    timestampMs: input.timestampMs,
  };
}

function popupActionState(action: PromptEnhancementActionEntryV1): PromptEnhancementPopupActionStateV1 {
  return {
    action,
    uiAvailabilityState: popupActionAvailabilityFor(action),
    currentBodyActionInputPolicy: action.actionType === 'apply_details'
      ? 'current_visible_edited_body_plus_details'
      : action.actionType === 'shorter' || action.actionType === 'more_thorough' || action.actionType === 'more_project_grounded'
        ? 'accepted_canonical_body_only'
        : 'not_applicable',
    keepsPreviousValidBodyAvailable: DIRECTIONAL_ACTIONS.has(action.actionType),
    staleResultCanOverwriteCurrentBody: false,
  };
}

function popupActionAvailabilityFor(action: PromptEnhancementActionEntryV1): PromptEnhancementPopupActionAvailability {
  if (action.availability === 'available' && action.callVisibilityMode === 'llm_wording') return 'requires_llm_budget';
  if (action.availability === 'available') return 'available';
  if (action.availability === 'disabled_loading') return 'loading';
  if (action.availability === 'disabled_provider_unavailable') return 'failed_keep_previous';
  if (action.availability === 'disabled_fallback') return 'failed_keep_previous';
  if (action.availability === 'disabled_safety') return 'failed_keep_previous';
  return 'disabled_not_applicable';
}

function preSendSurfaceModeFor(
  lifecycleState: PromptEnhancementPopupLifecycleState,
  fallbackMode: PromptEnhancementFallbackMode,
  handoffSummary: PromptEnhancementUiViewPayloadV1['handoffAndSequenceSummary'],
): PromptEnhancementPreSendSurfaceMode {
  if (lifecycleState === 'not_applicable_no_popup') return 'no_popup';
  if (lifecycleState === 'blocked_or_no_send_high_risk') return 'blocked_or_no_send_high_risk';
  if (fallbackMode === 'approved_non_old_copy_delivery_fallback') return 'non_old_copy_delivery_pending_future_host_capability';
  if (fallbackMode !== 'none' && fallbackMode !== 'previous_sendable_body') return 'fallback_original_or_current';
  if (handoffSummary) return 'future_sequence_surface';
  return 'single_editable_body_v1';
}

function bodyDisplayStateFor(
  viewPayload: PromptEnhancementUiViewPayloadV1,
  fallbackMode: PromptEnhancementFallbackMode,
): PromptEnhancementPopupSessionV1['preSendBoundaryState']['bodyDisplayState'] {
  if (viewPayload.body.text.trim().length === 0) return 'body_missing_invalid';
  if (fallbackMode === 'previous_sendable_body') return 'previous_body_visible';
  if (fallbackMode !== 'none') return 'fallback_body_visible';
  if (viewPayload.body.originalPromptPreservation === 'visible_verbatim') return 'full_original_visible';
  return 'exact_current_body_visible';
}

function editabilityStateFor(
  lifecycleState: PromptEnhancementPopupLifecycleState,
  actionLoadingState: PromptEnhancementUiViewPayloadV1['body']['actionLoadingState'],
  fallbackMode: PromptEnhancementFallbackMode,
): PromptEnhancementPopupSessionV1['preSendBoundaryState']['editabilityState'] {
  if (lifecycleState === 'validation_repair') return 'locked_validation_repair';
  if (lifecycleState === 'delivered_to_input') return 'locked_delivery_in_progress';
  if (actionLoadingState === 'loading_action' || lifecycleState === 'action_loading') return 'locked_action_loading';
  if (fallbackMode !== 'none' && fallbackMode !== 'previous_sendable_body') return 'read_only_fallback';
  return 'editable';
}

function popupEventReasonCodes(
  input: PromptEnhancementPopupEventInputV1,
  staleOrMismatched: boolean,
): readonly string[] {
  const reasons: string[] = [];
  if (staleOrMismatched) reasons.push('stale_or_mismatched_popup_event');
  if (
    input.eventType === 'deliver_current_body'
    && input.session.additionalDetailsState === 'dirty_unsubmitted'
  ) {
    reasons.push('dirty_additional_details_requires_apply_or_clear_before_send');
  }
  if (
    input.eventType === 'deliver_current_body'
    && typeof input.editedBodyText === 'string'
    && input.editedBodyText.trim().length === 0
  ) {
    reasons.push('missing_edited_body_text');
  }
  if (
    input.eventType === 'submit_additional_details'
    && typeof input.additionalDetailsText === 'string'
    && input.additionalDetailsText.trim().length === 0
  ) {
    reasons.push('missing_additional_details_text');
  }
  if (
    (input.eventType === 'explicit_feedback' || input.eventType === 'skip_or_reject')
    && typeof input.feedbackCategory === 'string'
    && !['not_relevant_enough', 'too_much_or_too_long', 'custom_typed'].includes(input.feedbackCategory)
  ) {
    reasons.push('unknown_feedback_category_non_learning');
  }
  return [...new Set(reasons)];
}

function firstPopupSequenceDispositionForEvent(
  input: PromptEnhancementPopupEventInputV1,
): PromptEnhancementFirstPopupSequenceDispositionState {
  const staleOrMismatched = input.currentBodyId !== input.session.currentBodyId
    || input.bodyRevision !== input.session.bodyRevision;
  if (input.session.sequenceSummaryState === 'not_sequence') return 'not_sequence';
  if (staleOrMismatched) return 'unknown_sequence_disposition_invalid';
  if (input.eventType === 'skip_or_reject') return 'current_body_rejected_only';
  if (input.eventType === 'use_original') return 'use_original_no_start';
  if (input.eventType === 'close_no_send') return 'dismissed_no_feedback_no_start';
  return input.session.firstPopupSequenceDispositionState;
}

function popupReasonCodes(
  viewPayload: PromptEnhancementUiViewPayloadV1,
  actionByType: ReadonlyMap<PromptEnhancementActionType, PromptEnhancementActionEntryV1>,
): readonly string[] {
  const reasons: string[] = [];
  if (viewPayload.viewPayloadVersion !== PROMPT_ENHANCEMENT_CONTRACT_VERSION) reasons.push('unsupported_popup_contract_version');
  if (viewPayload.body.text.trim().length === 0) reasons.push('missing_editable_current_body_text');
  if (viewPayload.body.originalPromptPreservation !== 'visible_verbatim') reasons.push('missing_full_original_in_body');
  if (viewPayload.hidesVisibleSectionControls !== true) reasons.push('visible_section_controls_not_allowed_v1');
  if (viewPayload.exposesPromptVariants !== false) reasons.push('prompt_variants_not_allowed_v1');
  if (viewPayload.exposesForegroundSafer !== false) reasons.push('foreground_safer_not_allowed_v1');
  if (viewPayload.textOnlyDeliveryIsAuthority !== false) reasons.push('text_only_delivery_not_authority');
  for (const actionType of REQUIRED_ACTIONS) {
    if (!actionByType.has(actionType)) reasons.push(`missing_popup_action:${actionType}`);
  }
  for (const action of viewPayload.actions) {
    if (action.currentBodyId !== viewPayload.body.currentBodyId || action.bodyRevision !== viewPayload.body.bodyRevision) {
      reasons.push(`stale_popup_action:${action.actionType}`);
    }
    if ((action.label as string) === 'Safer') reasons.push('foreground_safer_not_allowed_v1');
  }
  return [...new Set(reasons)];
}

function lifecycleStateFor(
  sendPolicy: PromptEnhancementSendPolicy,
  fallbackMode: PromptEnhancementFallbackMode,
  actionLoadingState: PromptEnhancementUiViewPayloadV1['body']['actionLoadingState'],
): PromptEnhancementPopupLifecycleState {
  if (actionLoadingState === 'loading_action') return 'action_loading';
  if (fallbackMode !== 'none' && fallbackMode !== 'previous_sendable_body') return 'fallback_current_or_original';
  if (sendPolicy === 'no_popup') return 'not_applicable_no_popup';
  if (sendPolicy === 'no_send') return 'blocked_or_no_send_high_risk';
  return 'ready_editable_body';
}

function defaultPopupArbitrationState(
  lifecycleState: PromptEnhancementPopupLifecycleState,
): PromptEnhancementPopupArbitrationState {
  if (lifecycleState === 'not_applicable_no_popup') return 'no_popup_not_applicable';
  if (lifecycleState === 'ready_editable_body' || lifecycleState === 'action_loading' || lifecycleState === 'delivered_to_input') {
    return 'pe_popup_shown_acknowledged';
  }
  return 'pe_review_priority_product_feedback_waits';
}

function defaultProductFeedbackCoDueState(
  lifecycleState: PromptEnhancementPopupLifecycleState,
): PromptEnhancementProductFeedbackCoDueState {
  if (lifecycleState === 'not_applicable_no_popup') return 'not_due';
  return 'pe_review_priority_product_rating_waits';
}

function defaultVisibleSurfaceAckState(
  lifecycleState: PromptEnhancementPopupLifecycleState,
  rendererState: PromptEnhancementUiViewPayloadV1['actionInputContract']['rendererState'],
): PromptEnhancementVisibleSurfaceAckState {
  if (rendererState === 'shown' && lifecycleState !== 'not_applicable_no_popup') return 'pe_body_visible';
  if (rendererState === 'timeout' || rendererState === 'crash') return 'render_failure';
  if (rendererState === 'no_renderer') return 'unsupported_host_or_extension';
  return 'not_counted_as_shown';
}

function exposureCountPolicyFor(
  visibleSurfaceAckState: PromptEnhancementVisibleSurfaceAckState,
): PromptEnhancementPeExposureCountPolicy {
  if (visibleSurfaceAckState === 'pe_body_visible') return 'count_after_visible_ack_only';
  if (visibleSurfaceAckState === 'fallback_visible') return 'count_non_old_copy_fallback_only_if_future_host_capability_approved';
  if (visibleSurfaceAckState === 'render_requested') return 'do_not_count';
  if (visibleSurfaceAckState === 'not_counted_as_shown') return 'do_not_count';
  return 'do_not_count';
}

function defaultDeliveryEvidenceState(
  deliverySurface: PromptEnhancementHostSurface | undefined,
  fallbackMode: PromptEnhancementFallbackMode,
): PromptEnhancementDeliveryEvidenceState {
  if (fallbackMode === 'delivery_unavailable' || fallbackMode === 'direct_insert_unavailable') return 'delivery_failed_or_unknown';
  if (deliverySurface === 'future_host_hold_proven') return 'direct_insert_to_existing_chat_input';
  if (deliverySurface === 'extension_bridge') return 'auto_paste_to_existing_chat_attempted';
  if (deliverySurface === 'manual_fallback') return 'clipboard_only_manual_paste_required';
  return 'submit_unconfirmed_manual_user_action_required';
}

function preExecutionHoldStateFor(
  lifecycleState: PromptEnhancementPopupLifecycleState,
  deliverySurface?: PromptEnhancementHostSurface,
): PromptEnhancementPreExecutionPromptHoldState {
  if (lifecycleState === 'not_applicable_no_popup') return 'not_required_no_popup';
  if (deliverySurface === 'future_host_hold_proven') return 'host_prompt_held_for_pe_review';
  return 'host_cannot_hold_non_old_copy_delivery_pending_future_host_capability';
}

function originalPromptDispositionStateFor(
  sendPolicy: PromptEnhancementSendPolicy,
  lifecycleState: PromptEnhancementPopupLifecycleState,
): PromptEnhancementOriginalPromptDispositionState {
  if (sendPolicy === 'send_original' || sendPolicy === 'original_only') return 'delivered_as_original';
  if (lifecycleState === 'not_applicable_no_popup') return 'continued_without_pe_no_popup';
  if (lifecycleState === 'skipped_or_rejected') return 'discarded_by_cancel_no_send';
  if (sendPolicy === 'send_current') return 'replaced_by_validated_enhanced_body';
  return 'unknown_original_disposition_invalid';
}

function holdCommitPolicyStateFor(
  deliverySurface?: PromptEnhancementHostSurface,
): PromptEnhancementHoldCommitPolicyState {
  if (deliverySurface === 'future_host_hold_proven') return 'hold_commit_pending_validation';
  return 'current_stop_bridge_original_already_processed';
}

function defaultDeliveryOriginGuardState(
  sendPolicy: PromptEnhancementSendPolicy,
  generatedOriginState: PromptEnhancementUiViewPayloadV1['body']['generatedOriginState'],
): PromptEnhancementDeliveryOriginGuardState {
  if (sendPolicy === 'no_send' || sendPolicy === 'no_popup') return 'not_delivered';
  if (generatedOriginState === 'pe_generated_body' || generatedOriginState === 'pe_user_edited_body') {
    return 'pe_generated_next_submit_guard_required';
  }
  return 'not_delivered';
}

function defaultPromptSubmitProcessingPolicy(
  generatedOriginState: PromptEnhancementUiViewPayloadV1['body']['generatedOriginState'],
): PromptEnhancementPromptSubmitProcessingPolicy {
  if (generatedOriginState === 'pe_generated_body' || generatedOriginState === 'pe_user_edited_body') {
    return 'pe_generated_delivery_skip_classification';
  }
  return 'normal_user_prompt_full_processing';
}

function defaultExtensionCapabilityState(
  deliverySurface?: PromptEnhancementHostSurface,
): PromptEnhancementExtensionCapabilityState {
  if (deliverySurface === 'extension_bridge') return 'extension_pe_supported';
  if (deliverySurface === 'manual_fallback') return 'extension_fallback_non_old_copy_unavailable';
  return 'core_only';
}

function sequenceSummaryStateFor(
  handoffSummary: PromptEnhancementUiViewPayloadV1['handoffAndSequenceSummary'],
): PromptEnhancementSequenceSummaryState {
  if (!handoffSummary) return 'not_sequence';
  if (handoffSummary.handoffKind === 'compact_sequence_summary_candidate' || handoffSummary.handoffKind === 'first_prompt_handoff_candidate') {
    return 'compact_first_popup_summary_available';
  }
  if (handoffSummary.handoffKind === 'blocked_or_deferred_sequence') return 'sequence_runtime_deferred_to_future_sequence';
  return 'sequence_state_missing_summary_suppressed';
}

function firstPopupSequenceDispositionStateFor(
  handoffSummary: PromptEnhancementUiViewPayloadV1['handoffAndSequenceSummary'],
  lifecycleState: PromptEnhancementPopupLifecycleState,
): PromptEnhancementFirstPopupSequenceDispositionState {
  if (!handoffSummary) return 'not_sequence';
  if (lifecycleState === 'skipped_or_rejected') return 'current_body_rejected_only';
  if (lifecycleState === 'fallback_current_or_original') return 'use_original_no_start';
  if (lifecycleState === 'not_applicable_no_popup') return 'closed_or_failed_no_start';
  return 'disposition_pending_future_host_capability';
}

function treatmentModeFor(
  levelState: PromptEnhancementUiViewPayloadV1['body']['levelState'],
  fallbackMode: PromptEnhancementFallbackMode,
  additionalDetailsState?: PromptEnhancementAdditionalDetailsState,
): PromptEnhancementCurrentTreatmentMode {
  if (fallbackMode !== 'none') return 'fallback_original_or_current';
  if (additionalDetailsState === 'merged_preview_ready') return 'additional_details_merged';
  if (levelState === 'shorter') return 'shorter';
  if (levelState === 'more_thorough') return 'more_thorough';
  if (levelState === 'more_project_grounded') return 'more_project_grounded';
  return 'default';
}

function deliveryModeFor(
  sendPolicy: PromptEnhancementSendPolicy,
  fallbackMode: PromptEnhancementFallbackMode,
  deliverySurface?: PromptEnhancementHostSurface,
): PromptEnhancementSendDeliveryMode {
  if (sendPolicy === 'no_send' || sendPolicy === 'no_popup') return 'delivery_unavailable';
  if (fallbackMode === 'delivery_unavailable' || fallbackMode === 'direct_insert_unavailable') return 'delivery_unavailable';
  if (fallbackMode === 'approved_non_old_copy_delivery_fallback' || deliverySurface === 'manual_fallback') {
    return 'non_clipboard_user_controlled_delivery_pending_future_host_capability';
  }
  if (sendPolicy === 'send_original' || sendPolicy === 'original_only') return 'send_original_or_current_only';
  return 'insert_for_user_submit';
}

function sendPolicyForEvent(
  eventType: PromptEnhancementPopupEventType,
  session: PromptEnhancementPopupSessionV1,
): PromptEnhancementSendPolicy {
  if (eventType === 'close_no_send' || eventType === 'explicit_feedback' || eventType === 'edit_body' || eventType === 'skip_or_reject') return 'no_send';
  if (eventType === 'use_original') return 'send_original';
  if (eventType === 'deliver_current_body') {
    if (session.additionalDetailsState === 'dirty_unsubmitted') return 'no_send';
    return session.sendabilityState === 'send_current' ? 'send_current' : 'no_send';
  }
  return 'no_send';
}
