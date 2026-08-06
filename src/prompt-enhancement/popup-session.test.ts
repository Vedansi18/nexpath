import { describe, expect, it } from 'vitest';
import {
  PROMPT_ENHANCEMENT_CONTRACT_VERSION,
  type PromptEnhancementActionEntryV1,
  type PromptEnhancementActionType,
  type PromptEnhancementHandoffMetadataV1,
  type PromptEnhancementUiViewPayloadV1,
} from './contracts.js';
import {
  buildPromptEnhancementPopupSessionV1,
  createPromptEnhancementPopupEventV1,
} from './popup-session.js';
import {
  buildPromptEnhancementFeedbackAdapterStateV1,
  cancelPromptEnhancementFeedbackV1,
  editPromptEnhancementOtherFeedbackV1,
  openPromptEnhancementFeedbackV1,
  resolvePromptEnhancementFeedbackAcknowledgementV1,
  submitPromptEnhancementOtherFeedbackV1,
  submitPromptEnhancementSuggestedFeedbackV1,
} from './feedback-adapter.js';
import {
  buildPromptEnhancementLocalDraftV1,
  reconcilePromptEnhancementLocalDraftV1,
  updatePromptEnhancementAdditionalDetailsDraftV1,
  updatePromptEnhancementCurrentBodyDraftV1,
} from './local-draft.js';

const actionLabels: Record<PromptEnhancementActionType, PromptEnhancementActionEntryV1['label']> = {
  use_current_body: 'Use this prompt',
  use_original: 'Use original',
  shorter: 'Shorter',
  more_thorough: 'More thorough',
  more_project_grounded: 'More project-grounded',
  apply_details: 'Apply details',
  feedback: 'Feedback',
  close: 'Close',
};

function action(actionType: PromptEnhancementActionType, overrides: Partial<PromptEnhancementActionEntryV1> = {}): PromptEnhancementActionEntryV1 {
  return {
    actionId: `body-1:action:${actionType}`,
    actionType,
    label: actionLabels[actionType],
    currentBodyId: 'body-1',
    bodyRevision: 1,
    availability: 'available',
    callVisibilityMode: 'deterministic',
    ...overrides,
  };
}

function handoffSummary(kind: PromptEnhancementHandoffMetadataV1['handoffKind']): PromptEnhancementHandoffMetadataV1 {
  return {
    handoffMetadataVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
    handoffDecisionId: 'handoff-1',
    currentBodyId: 'body-1',
    bodyRevision: 1,
    handoffKind: kind,
    sequenceActivationPolicy: 'blocked_pending_sequence_runtime_and_cost_gates',
    futurePromptTextPolicy: 'not_generated_not_stored_not_rendered',
    suggestedNextPromptPolicy: 'metadata_refs_only',
    suggestedNextPromptRefs: [],
    currentBodyValidityState: 'valid_for_current_body_revision',
    itemLineageRefs: ['handoff-slice:body-1:1'],
    sourceLineageRefs: ['source-1'],
    scope: {
      requestId: 'req-popup-1',
      projectRoot: '/repo',
      projectScopeState: 'current_project_only',
      sourceScopeRefs: ['project:/repo'],
      crossProjectApplicationPolicy: 'reject',
      staleResponsePolicy: 'ignore_no_overwrite',
    },
    applicabilityState: 'metadata_only_candidate',
    riskConfirmationState: 'none',
    fallbackMode: 'none',
    receiverValidationRequirements: ['handoff', 'launch_check'],
    activationState: 'no_activation_v1',
    userHandoffConsentState: 'not_applicable',
    compactFirstPopupSequenceSummary: {
      summaryId: 'handoff-1:summary',
      currentBodyId: 'body-1',
      bodyRevision: 1,
      publicSafeText: 'One follow-up task candidate is summarized as metadata only.',
      remainingTaskCount: 1,
      taskRoleLabels: ['verification'],
      sourceRefs: ['source-1'],
      containsFuturePromptText: false,
      rawPromptTextExcluded: true,
      rawGeneratedBodyExcluded: true,
      bodyBoundMetadataOnly: true,
    },
    pointInventory: [{
      pointRefId: 'handoff-point:1',
      sourcePointRef: 'source-1',
      order: 1,
      explicitness: 'explicit_user_request',
      dependencyPointRefs: [],
      riskConfirmationRequired: false,
      sourceSupportState: 'present',
      currentBodyCoverageState: 'covered_in_current_body',
      privacyClass: 'local_private_ref_only',
      reasonCodes: ['source_ref_metadata_only'],
    }],
    decompositionGroups: [{
      decompositionGroupId: 'handoff-group:body-1:1',
      pointRefs: ['handoff-point:1'],
      bodySectionRefs: ['section-original'],
      groupingReason: 'single_current_body_group',
      splitRequirementState: 'candidate_metadata_only',
      sourceRefs: ['source-1'],
      riskConfirmationRefs: [],
      publicSafeSummaryVisible: true,
      invalidLineageBehavior: 'suppress_handoff',
    }],
    taskSlices: [{
      taskSliceId: 'handoff-slice:body-1:1',
      sourcePointRefs: ['handoff-point:1'],
      decompositionGroupId: 'handoff-group:body-1:1',
      bodySectionRefs: ['section-original'],
      dependencySliceRefs: [],
      sequenceRole: 'future_candidate_metadata_only',
      futurePromptCandidateState: 'candidate_metadata_only',
      editInvalidationState: 'valid_until_body_revision_changes',
      handoffEligibilityState: 'eligible_metadata_only',
      reasonCodes: ['future_prompt_text_not_generated'],
    }],
    applicability: {
      applicabilityDecisionId: 'handoff-1:applicability',
      taskSliceRefs: ['handoff-slice:body-1:1'],
      decompositionGroupRefs: ['handoff-group:body-1:1'],
      sourcePointRefs: ['handoff-point:1'],
      state: 'metadata_only_candidate',
      intentFamily: 'debug_maintenance',
      intentCategory: 'debug_and_verify',
      levelDepthState: 'default',
      riskSafetyState: 'valid',
      dependencyOrderState: 'no_dependencies',
      currentBodyCoverageState: 'current_body_plus_metadata',
      promptSizeApiAvailabilityState: 'not_measured_v1_metadata_only',
      hostCapabilityState: 'stop_bridge_only',
      explicitUserRuntimeState: 'not_started_v1',
      granularityActionabilityState: 'metadata_only_candidate',
      splitMergeDisposition: 'metadata_only_split_candidate',
      granularityFailureDisposition: 'current_or_original_fallback_no_runtime',
      sourcePriorityRefs: [],
      sourcePriorityState: 'no_priority_claim_v1',
      targetScopeRefs: ['project:/repo'],
      targetSurfaceState: 'source_backed',
      workspaceBindingState: 'current_workspace_only',
      scopeBindingDisposition: 'bound_to_current_project',
      expectedDeliverableState: 'metadata_only_candidate',
      deliverableContractRefs: [],
      outputFormatPolicy: 'metadata_only_no_runtime',
      completionEvidenceRequirementState: 'not_runtime_proof_v1',
      acceptanceCriteriaRefs: [],
      successConditionState: 'not_runtime_evaluated_v1',
      definitionOfDoneState: 'not_runtime_evaluated_v1',
      acceptanceVerificationPolicy: 'user_owned_not_runtime_v1',
      acceptanceFailureDisposition: 'current_or_original_fallback_no_runtime',
      atomicGroupId: 'none',
      atomicGroupRefs: [],
      coDeliveryRequirementState: 'none',
      partialCompletionPolicy: 'no_runtime_partial_completion_v1',
      rollbackCouplingState: 'not_runtime_v1',
      atomicGroupFailureDisposition: 'current_or_original_fallback_no_runtime',
      sourceConflictState: 'none',
      conflictingSourcePointRefs: [],
      conflictResolutionPolicy: 'current_body_or_no_runtime',
      unresolvedConflictDisposition: 'current_or_original_fallback_no_runtime',
      conflictVisibilityPolicy: 'public_safe_reason_codes_only',
      userNoSequenceConstraintState: 'none',
      onePromptOnlyConstraintState: 'none',
      sequenceSuppressionSourceState: 'none',
      noSplitOverrideDisposition: 'not_allowed_v1',
      partialItemConsentState: 'deferred_out_of_v1',
      clarificationApplicabilityState: 'not_required',
      userInputRequirementState: 'not_required',
      missingInformationRefs: [],
      clarificationQuestionKindState: 'none',
      answerDependencyState: 'none',
      agentPermissionModeSnapshot: 'unknown',
      itemExecutionCapabilityRequirementState: 'not_evaluated_v1_metadata_only',
      toolAccessRequirementRefs: [],
      capabilityMismatchDisposition: 'current_or_original_fallback_no_runtime',
      manualExecutionRequiredState: 'not_evaluated_v1_metadata_only',
      conditionalInstructionState: 'represented_in_current_body',
      itemOrderingMode: 'no_runtime_order',
      independentItemState: 'not_parallelized_v1',
      unorderedGroupId: 'none',
      serializationDisposition: 'metadata_only_no_runtime_order',
      userOrderPreferenceState: 'not_specified',
      parallelExecutionPolicy: 'not_supported_v1',
      confidence: 'medium',
      receiverCanActivateRuntime: false,
      reasonCodes: ['metadata_only_no_runtime_activation'],
    },
    confirmationTargets: [],
    sourceImpact: {
      sourceImpactMetadataId: 'handoff-1:source-impact',
      contentTemplateSourceRefs: [],
      contentTemplateVariantIdentityRefs: [],
      servedVariantEventRefs: [],
      recordSignalTypes: [],
      recordSourceTiers: [],
      recordSchemaVersions: [],
      recordQuestionRefs: [],
      recordPinchFallbackRefs: [],
      recordRegisterSnapshotRefs: [],
      recordRoleSnapshotRefs: [],
      recordMaturityLevelSnapshotRefs: [],
      recordSnapshotRefs: [],
      recordComposePathRefs: [],
      recordSafeguardStateRefs: [],
      sourceCascadeOutcomeRefs: [],
      whyDescDeliveryDisposition: 'not_source_truth_not_future_prompt_text',
      feedbackPreemptionDisposition: 'not_pe_exposure_or_handoff_acceptance',
      transportEvidenceDisposition: 'delivery_attempt_only_not_semantic_authority',
      stageClassifierDegradedDisposition: 'cannot_create_handoff_candidate',
      generatedOriginPolicyState: 'typed_origin_lineage_required',
    },
    runtimeGuards: {
      createsRuntimeQueue: false,
      permitsContinuation: false,
      activeRuntimeState: 'not_created_v1',
      autoSendPolicy: 'prohibited',
      futurePromptBodiesRuntimePolicy: 'not_generated_not_stored_not_rendered',
      pointerAdvancementPolicy: 'prohibited',
      completionProofPolicy: 'not_claimed',
      responseWatcherPolicy: 'not_created_v1',
      durableResumePolicy: 'not_created_v1',
    },
    privacyStoragePolicy: {
      rawPromptBodiesExcluded: true,
      rawGeneratedBodiesExcluded: true,
      rawSourceExcerptsExcluded: true,
      rawFeedbackExcluded: true,
      futurePromptBodiesStored: false,
      oldDecisionSessionStoresAreAuthority: false,
      productFeedbackIsPeHandoffSignal: false,
      telemetryPolicy: 'ids_counts_status_only',
    },
    ownerBoundary: {
      semanticOwner: 'content_semantics',
      uiConsumer: 'ui_app',
      hostOwner: 'host_transport',
      runtimeOwnerState: 'future_pe_ar11_only_after_gates',
    },
    reasonCodes: ['v1_handoff_metadata_only', 'v1_no_active_sequence_runtime'],
  };
}

function viewPayload(overrides: Partial<PromptEnhancementUiViewPayloadV1> = {}): PromptEnhancementUiViewPayloadV1 {
  return {
    viewPayloadVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
    enhancementId: 'phase7-enhancement',
    body: {
      text: 'My original request (verbatim):\nFix the CSV import regression.\n\nEnhanced plan:\nReproduce the failing case, patch the parser, and run the regression suite.',
      currentBodyId: 'body-1',
      bodyRevision: 1,
      generatedOriginState: 'pe_generated_body',
      dirtyState: 'clean',
      originalPromptPreservation: 'visible_verbatim',
      levelState: 'default',
      actionLoadingState: 'idle',
      sendPolicy: 'send_current',
      fallbackMode: 'none',
    },
    sectionsForFeedback: [
      {
        sectionId: 'section-original',
        sectionKind: 'original_request',
        label: 'Original request',
        templateType: 'debug_repair',
        familyId: 'debug_maintenance',
        primaryIntent: 'debug_and_verify',
        sourceKinds: ['source_a_user_prompt'],
        sourceIds: ['prompt:current'],
        baselineSourceSignalSlot: 'debugging_observation_gap',
        sourceEvidenceStatus: 'present',
        slotEvidenceStatus: 'present',
        requirementSourceStatus: 'present',
        validationStatus: 'valid',
        safetyFlags: [],
        sensitivityFlags: [],
        publicSafeExplanationCategory: 'source_coverage',
        fallbackMode: 'none',
        callVisibilityMode: 'deterministic',
        spanRefs: [],
        preciseFeedbackAllowed: false,
      },
    ],
    publicTrustCues: [
      {
        cueId: 'cue-original',
        label: 'original_prompt',
        publicSafeText: 'Original prompt is preserved.',
        sourceRefIds: ['prompt:current'],
        rawPrivateDataExcluded: true,
      },
      {
        cueId: 'cue-privacy',
        label: 'privacy_local',
        publicSafeText: 'Private source details stay local.',
        sourceRefIds: [],
        rawPrivateDataExcluded: true,
      },
    ],
    actions: [
      action('use_current_body'),
      action('use_original'),
      action('shorter'),
      action('more_thorough'),
      action('more_project_grounded'),
      action('apply_details'),
      action('feedback'),
      action('close'),
    ],
    actionInputContract: {
      actionInputVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
      enhancementId: 'phase7-enhancement',
      currentBodyId: 'body-1',
      bodyRevision: 1,
      actionId: 'body-1:action:use_current_body',
      hostSurface: 'cli_stop_bridge',
      deliveryChannel: 'cli_stop_bridge',
      rendererState: 'shown',
      exposureAcknowledgementState: 'shown',
      timestampMs: 1,
      realUserInitiated: true,
      editedBodyTextPolicy: 'required_when_body_may_be_dirty',
      sectionSpanEditEventsPolicy: 'only_when_span_map_exact',
      additionalDetailsPolicy: 'bounded_recomposition_input_only',
    },
    diagnostics: [
      {
        diagnosticId: 'diag-ready',
        category: 'generated',
        publicSafeText: 'Enhanced prompt is ready.',
        rawPromptExcluded: true,
        rawGeneratedBodyExcluded: true,
        rawSourceExcerptExcluded: true,
        rawFeedbackExcluded: true,
        privateIdsExcluded: true,
        researchLabelsExcluded: true,
        rawReasonValuesExcluded: true,
      },
    ],
    hidesVisibleSectionControls: true,
    exposesPromptVariants: false,
    exposesForegroundSafer: false,
    textOnlyDeliveryIsAuthority: false,
    ...overrides,
  };
}

describe('prompt-enhancement popup session and UI contract', () => {
  it('builds the Phase 7 one-body enhancement-popup model from typed UI state only', () => {
    const session = buildPromptEnhancementPopupSessionV1({
      viewPayload: viewPayload(),
      validationDecisionId: 'body-1:validation:1:final_body',
      timestampMs: 10,
    });

    expect(session.popupModelVersion).toBe(PROMPT_ENHANCEMENT_CONTRACT_VERSION);
    expect(session.surfaceKind).toBe('enhancement_popup_single_body');
    expect(session.popupTriggerMoment).toBe('pre_execution_prompt_submit');
    expect(session.popupLifecycleState).toBe('ready_editable_body');
    expect(session.currentBodyId).toBe('body-1');
    expect(session.currentBodyText).toContain('My original request (verbatim):');
    expect(session.acceptedCanonicalBodyRevisionId).toBe('body-1:revision:1');
    expect(session.originalPromptPreservationState).toBe('full_original_in_body');
    expect(session.currentTreatmentMode).toBe('default');
    expect(session.preSendBoundaryState).toMatchObject({
      surfaceMode: 'single_editable_body_v1',
      bodyDisplayState: 'full_original_visible',
      editabilityState: 'editable',
      staleResultPolicy: 'stale_results_cannot_overwrite_current_body',
      previousBodyAvailability: 'previous_valid_body_available_during_action_or_fallback',
    });
    expect(session.preSendBoundaryState.essentialControlSet).toEqual([
      'use_current_body',
      'use_original',
      'shorter',
      'more_thorough',
      'more_project_grounded',
      'apply_details',
      'feedback',
      'close',
    ]);
    expect(session.preSendBoundaryState.deferredControlSet).toContain('visible_section_controls');
    expect(session.preSendBoundaryState.rejectedControlSet).toEqual(expect.arrayContaining([
      'decision_session_option_list',
      'show_simpler_options',
      'foreground_safer',
      'auto_submit',
      'product_rating_as_pe_feedback',
    ]));
    expect(session.visibleSectionControlState).toBe('none_v1_internal_metadata_only');
    expect(session.sendDeliveryMode).toBe('insert_for_user_submit');
    expect(session.requiresUserFinalSubmit).toBe(true);
    expect(session.validationDecisionId).toBe('body-1:validation:1:final_body');
    expect(session.popupArbitrationState).toBe('pe_popup_shown_acknowledged');
    expect(session.productFeedbackCoDueState).toBe('pe_review_priority_product_rating_waits');
    expect(session.visibleSurfaceAckState).toBe('pe_body_visible');
    expect(session.peExposureCountPolicy).toBe('count_after_visible_ack_only');
    expect(session.deliveryEvidenceState).toBe('submit_unconfirmed_manual_user_action_required');
    expect(session.promptOriginPolicyState).toBe('pe_generated_body_requires_origin_guard');
    expect(session.preExecutionPromptHoldState).toBe('host_cannot_hold_non_old_copy_delivery_pending_pe_dr3');
    expect(session.originalPromptDispositionState).toBe('replaced_by_validated_enhanced_body');
    expect(session.holdCommitPolicyState).toBe('current_stop_bridge_original_already_processed');
    expect(session.deliveryOriginGuardState).toBe('pe_generated_next_submit_guard_required');
    expect(session.promptSubmitProcessingPolicy).toBe('pe_generated_delivery_skip_classification');
    expect(session.extensionCapabilityState).toBe('core_only');
    expect(session.sameTurnUserPromptSubmitReplacementClaimed).toBe(false);
    expect(session.productFeedbackBoundaryState).toBe('separate_product_health_rating_not_pe_feedback');
    expect(session.sequenceSummaryState).toBe('not_sequence');
    expect(session.firstPopupSequenceDispositionState).toBe('not_sequence');
    expect(session.loadingFallbackControls).toEqual({
      useOriginalAvailable: true,
      closeNoSendAvailable: true,
      useCurrentAvailableWhenPreviousBodyValid: true,
    });
    expect(session.reasonCodes).toEqual([]);
    expect(session.invariants).toEqual({
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
    });
  });

  it('preserves exactly the fixed v1 UI controls without prompt variants or Safer', () => {
    const session = buildPromptEnhancementPopupSessionV1({
      viewPayload: viewPayload(),
      validationDecisionId: 'body-1:validation:1:final_body',
      timestampMs: 10,
    });

    expect(session.directionalActionSet.map((actionEntry) => actionEntry.action.label)).toEqual([
      'Shorter',
      'More thorough',
      'More project-grounded',
    ]);
    // UI-8: no standalone "Apply details" row — Enter on the details row applies; apply stays
    // available via additionalDetailsActionId (asserted below), not as a directional row.
    expect(session.directionalActionSet.map((actionEntry) => actionEntry.action.label)).not.toContain('Apply details');
    expect(session.directionalActionSet.map((actionEntry) => actionEntry.action.label)).not.toContain('Safer');
    expect(session.directionalActionSet.map((actionEntry) => actionEntry.uiAvailabilityState)).toEqual([
      'available',
      'available',
      'available',
    ]);
    expect(session.directionalActionSet.map((actionEntry) => actionEntry.currentBodyActionInputPolicy)).toEqual([
      'accepted_canonical_body_only',
      'accepted_canonical_body_only',
      'accepted_canonical_body_only',
    ]);
    expect(session.directionalActionSet.every((actionEntry) => actionEntry.staleResultCanOverwriteCurrentBody === false)).toBe(true);
    expect(session.additionalDetailsActionId).toBe('body-1:action:apply_details');
    expect(session.feedbackEntry).toEqual({
      state: 'available',
      actionId: 'body-1:action:feedback',
      suggestedReasonChoices: ['not_relevant_enough', 'too_much_or_too_long'],
      customFeedbackPath: 'custom_typed_local_bounded_when_allowed',
      productRatingSeparated: true,
      canMutateCurrentBody: false,
      canMutateSafetyOrAuthorityFloors: false,
    });
    expect(session.closeActionId).toBe('body-1:action:close');
  });

  it('reports invalid UI payload gaps instead of accepting old option-list style state', () => {
    const session = buildPromptEnhancementPopupSessionV1({
      viewPayload: viewPayload({
        exposesPromptVariants: true as false,
        hidesVisibleSectionControls: false as true,
        actions: [
          action('use_current_body'),
          action('use_original'),
          action('shorter', { currentBodyId: 'stale-body' }),
          action('close'),
        ],
      }),
      validationDecisionId: 'body-1:validation:1:final_body',
      timestampMs: 10,
    });

    expect(session.reasonCodes).toEqual(expect.arrayContaining([
      'visible_section_controls_not_allowed_v1',
      'prompt_variants_not_allowed_v1',
      'missing_popup_action:more_thorough',
      'missing_popup_action:more_project_grounded',
      'missing_popup_action:apply_details',
      'missing_popup_action:feedback',
      'stale_popup_action:shorter',
    ]));
  });

  it('models action loading and Additional Details as current-body recomposition with previous body available', () => {
    const session = buildPromptEnhancementPopupSessionV1({
      viewPayload: viewPayload({
        body: {
          ...viewPayload().body,
          actionLoadingState: 'loading_action',
          levelState: 'more_project_grounded',
        },
      }),
      additionalDetailsState: 'dirty_unsubmitted',
      validationDecisionId: 'body-1:validation:1:final_body',
      timestampMs: 10,
    });

    expect(session.popupLifecycleState).toBe('action_loading');
    expect(session.additionalDetailsState).toBe('dirty_unsubmitted');
    expect(session.currentTreatmentMode).toBe('more_project_grounded');
    expect(session.directionalActionSet.every((actionEntry) => actionEntry.action.currentBodyId === 'body-1')).toBe(true);
  });

  it('keeps fallback delivery user-controlled and rejects clipboard/manual-copy as v1 payload meaning', () => {
    const session = buildPromptEnhancementPopupSessionV1({
      viewPayload: viewPayload({
        body: {
          ...viewPayload().body,
          fallbackMode: 'approved_non_old_copy_delivery_fallback',
        },
      }),
      deliverySurface: 'manual_fallback',
      validationDecisionId: 'body-1:validation:1:final_body',
      timestampMs: 10,
    });

    expect(session.popupLifecycleState).toBe('fallback_current_or_original');
    expect(session.currentTreatmentMode).toBe('fallback_original_or_current');
    expect(session.sendDeliveryMode).toBe('non_clipboard_user_controlled_delivery_pending_pe_dr3');
    expect(session.invariants.clipboardManualCopyFallbackRejected).toBe(true);
    expect(JSON.stringify(session)).not.toMatch(/clipboard_for_user_paste|manual_copy_needed|manual-copy|manual copy/i);
  });

  it('turns close, feedback, and Use this prompt into typed user events without auto-send', () => {
    const session = buildPromptEnhancementPopupSessionV1({
      viewPayload: viewPayload(),
      validationDecisionId: 'body-1:validation:1:final_body',
      timestampMs: 10,
    });

    const useCurrent = createPromptEnhancementPopupEventV1({
      session,
      eventType: 'deliver_current_body',
      actionId: 'body-1:action:use_current_body',
      currentBodyId: 'body-1',
      bodyRevision: 1,
      editedBodyText: session.currentBodyText,
      timestampMs: 11,
      realUserInitiated: true,
    });
    const feedback = createPromptEnhancementPopupEventV1({
      session,
      eventType: 'explicit_feedback',
      actionId: 'body-1:action:feedback',
      currentBodyId: 'body-1',
      bodyRevision: 1,
      feedbackCategory: 'not_relevant_enough',
      timestampMs: 12,
      realUserInitiated: true,
    });
    const close = createPromptEnhancementPopupEventV1({
      session,
      eventType: 'close_no_send',
      actionId: 'body-1:action:close',
      currentBodyId: 'body-1',
      bodyRevision: 1,
      timestampMs: 13,
      realUserInitiated: true,
    });

    expect(useCurrent).toMatchObject({
      eventType: 'deliver_current_body',
      sendPolicy: 'send_current',
      editedBodyPolicy: 'full_body_required',
      closeDisposition: 'not_applicable',
      reasonCodes: [],
      staleOrMismatched: false,
    });
    expect(feedback).toMatchObject({
      eventType: 'explicit_feedback',
      sendPolicy: 'no_send',
      feedbackPolicy: 'typed_scoped_feedback_only',
      firstPopupSequenceDispositionState: 'not_sequence',
      productFeedbackBoundaryState: 'separate_product_health_rating_not_pe_feedback',
      reasonCodes: [],
    });
    expect(close).toMatchObject({
      eventType: 'close_no_send',
      sendPolicy: 'no_send',
      closeDisposition: 'no_send',
      firstPopupSequenceDispositionState: 'not_sequence',
      reasonCodes: [],
    });
  });

  it('marks stale UI events without letting them overwrite the current body session', () => {
    const session = buildPromptEnhancementPopupSessionV1({
      viewPayload: viewPayload(),
      validationDecisionId: 'body-1:validation:1:final_body',
      timestampMs: 10,
    });

    const stale = createPromptEnhancementPopupEventV1({
      session,
      eventType: 'request_shorter',
      actionId: 'body-1:action:shorter',
      currentBodyId: 'old-body',
      bodyRevision: 0,
      timestampMs: 11,
      realUserInitiated: true,
    });

    expect(stale.staleOrMismatched).toBe(true);
    expect(stale.sendPolicy).toBe('no_send');
    expect(stale.reasonCodes).toContain('stale_or_mismatched_popup_event');
  });

  it('blocks ordinary send while Additional Details are dirty and unapplied', () => {
    const session = buildPromptEnhancementPopupSessionV1({
      viewPayload: viewPayload(),
      additionalDetailsState: 'dirty_unsubmitted',
      validationDecisionId: 'body-1:validation:1:final_body',
      timestampMs: 10,
    });

    const useCurrent = createPromptEnhancementPopupEventV1({
      session,
      eventType: 'deliver_current_body',
      actionId: 'body-1:action:use_current_body',
      currentBodyId: 'body-1',
      bodyRevision: 1,
      editedBodyText: session.currentBodyText,
      timestampMs: 11,
      realUserInitiated: true,
    });
    const applyDetails = createPromptEnhancementPopupEventV1({
      session,
      eventType: 'submit_additional_details',
      actionId: 'body-1:action:apply_details',
      currentBodyId: 'body-1',
      bodyRevision: 1,
      additionalDetailsText: 'Keep semicolon-delimited CSV fixture coverage.',
      timestampMs: 12,
      realUserInitiated: true,
    });

    expect(useCurrent.sendPolicy).toBe('no_send');
    expect(useCurrent.reasonCodes).toContain('dirty_additional_details_requires_apply_or_clear_before_send');
    expect(applyDetails.additionalDetailsPolicy).toBe('bounded_recomposition_input_only');
    expect(applyDetails.sendPolicy).toBe('no_send');
  });

  it('keeps product-rating and old advisory surfaces from counting as PE exposure', () => {
    const productRatingFirst = buildPromptEnhancementPopupSessionV1({
      viewPayload: viewPayload({
        actionInputContract: {
          ...viewPayload().actionInputContract,
          rendererState: 'not_shown',
        },
      }),
      validationDecisionId: 'body-1:validation:1:final_body',
      popupArbitrationState: 'product_feedback_shown_no_pe_exposure',
      visibleSurfaceAckState: 'not_counted_as_shown',
      timestampMs: 10,
    });
    const oldAdvisoryFirst = buildPromptEnhancementPopupSessionV1({
      viewPayload: viewPayload({
        actionInputContract: {
          ...viewPayload().actionInputContract,
          rendererState: 'not_shown',
        },
      }),
      validationDecisionId: 'body-1:validation:1:final_body',
      popupArbitrationState: 'old_advisory_shown_no_pe_exposure',
      visibleSurfaceAckState: 'not_counted_as_shown',
      timestampMs: 11,
    });

    expect(productRatingFirst.productFeedbackBoundaryState).toBe('separate_product_health_rating_not_pe_feedback');
    expect(productRatingFirst.popupArbitrationState).toBe('product_feedback_shown_no_pe_exposure');
    expect(productRatingFirst.visibleSurfaceAckState).toBe('not_counted_as_shown');
    expect(productRatingFirst.peExposureCountPolicy).toBe('do_not_count');
    expect(oldAdvisoryFirst.popupArbitrationState).toBe('old_advisory_shown_no_pe_exposure');
    expect(oldAdvisoryFirst.visibleSurfaceAckState).toBe('not_counted_as_shown');
    expect(oldAdvisoryFirst.peExposureCountPolicy).toBe('do_not_count');
  });

  it('normalizes Phase 7 directional availability states for loading, provider failure, and LLM budget', () => {
    const session = buildPromptEnhancementPopupSessionV1({
      viewPayload: viewPayload({
        actions: [
          action('use_current_body'),
          action('use_original'),
          action('shorter', { availability: 'disabled_loading' }),
          action('more_thorough', { availability: 'disabled_provider_unavailable' }),
          action('more_project_grounded', { callVisibilityMode: 'llm_wording' }),
          action('apply_details', { availability: 'disabled_not_applicable' }),
          action('feedback'),
          action('close'),
        ],
      }),
      validationDecisionId: 'body-1:validation:1:final_body',
      timestampMs: 10,
    });

    expect(session.directionalActionSet.map((entry) => entry.uiAvailabilityState)).toEqual([
      'loading',
      'failed_keep_previous',
      'requires_llm_budget',
    ]);
  });

  it('keeps current delivery on the Stop-return bridge and rejects same-turn hold claims', () => {
    const session = buildPromptEnhancementPopupSessionV1({
      viewPayload: viewPayload(),
      validationDecisionId: 'body-1:validation:1:final_body',
      timestampMs: 10,
    });

    expect(session.preExecutionPromptHoldState).toBe('host_cannot_hold_non_old_copy_delivery_pending_pe_dr3');
    expect(session.holdCommitPolicyState).toBe('current_stop_bridge_original_already_processed');
    expect(session.sameTurnUserPromptSubmitReplacementClaimed).toBe(false);
    expect(session.deliveryOriginGuardState).toBe('pe_generated_next_submit_guard_required');
    expect(session.promptSubmitProcessingPolicy).toBe('pe_generated_delivery_skip_classification');
    expect(JSON.stringify(session)).not.toMatch(/UserPromptSubmit.*held|same-turn.*replacement|manual_copy_needed|clipboard_for_user_paste/i);
  });

  it('carries compact first-popup sequence state without activating a runtime', () => {
    const session = buildPromptEnhancementPopupSessionV1({
      viewPayload: viewPayload({
        handoffAndSequenceSummary: handoffSummary('compact_sequence_summary_candidate'),
      }),
      validationDecisionId: 'body-1:validation:1:final_body',
      timestampMs: 10,
    });

    expect(session.handoffSummaryState).toBe('compact_first_popup_summary');
    expect(session.sequenceSummaryState).toBe('compact_first_popup_summary_available');
    expect(session.firstPopupSequenceDispositionState).toBe('disposition_pending_pe_dr3');
    expect(session.preSendBoundaryState.surfaceMode).toBe('future_sequence_surface');
    expect(session.invariants.activeSequenceRuntimeRejected).toBe(true);
  });

  it('carries first-popup no-activation disposition on skip/reject events', () => {
    const session = buildPromptEnhancementPopupSessionV1({
      viewPayload: viewPayload({
        handoffAndSequenceSummary: handoffSummary('first_prompt_handoff_candidate'),
      }),
      validationDecisionId: 'body-1:validation:1:final_body',
      timestampMs: 10,
    });

    const skip = createPromptEnhancementPopupEventV1({
      session,
      eventType: 'skip_or_reject',
      actionId: 'body-1:action:feedback',
      currentBodyId: 'body-1',
      bodyRevision: 1,
      feedbackCategory: 'not_relevant_enough',
      timestampMs: 11,
      realUserInitiated: true,
    });
    const useOriginal = createPromptEnhancementPopupEventV1({
      session,
      eventType: 'use_original',
      actionId: 'body-1:action:use_original',
      currentBodyId: 'body-1',
      bodyRevision: 1,
      timestampMs: 12,
      realUserInitiated: true,
    });
    const staleSkip = createPromptEnhancementPopupEventV1({
      session,
      eventType: 'skip_or_reject',
      actionId: 'body-1:action:feedback',
      currentBodyId: 'body-previous',
      bodyRevision: 0,
      feedbackCategory: 'not_relevant_enough',
      timestampMs: 13,
      realUserInitiated: true,
    });

    expect(skip).toMatchObject({
      eventType: 'skip_or_reject',
      sendPolicy: 'no_send',
      feedbackPolicy: 'typed_scoped_feedback_only',
      firstPopupSequenceDispositionState: 'current_body_rejected_only',
      promptSubmitProcessingPolicy: 'pe_generated_delivery_skip_classification',
    });
    expect(useOriginal.firstPopupSequenceDispositionState).toBe('use_original_no_start');
    expect(staleSkip.firstPopupSequenceDispositionState).toBe('unknown_sequence_disposition_invalid');
    expect(staleSkip.staleOrMismatched).toBe(true);
    expect(staleSkip.reasonCodes).toContain('stale_or_mismatched_popup_event');
  });
  it("B1.4 feedback adapter emits one scoped no-send event and isolates acknowledgement", () => {
    const session = buildPromptEnhancementPopupSessionV1({
      viewPayload: viewPayload(),
      validationDecisionId: "body-1:validation:1:final_body",
      timestampMs: 10,
    });
    const opened = openPromptEnhancementFeedbackV1(buildPromptEnhancementFeedbackAdapterStateV1(session));
    expect(opened.status).toBe("open");

    const suggested = submitPromptEnhancementSuggestedFeedbackV1(opened, "not_relevant_enough", 20);
    expect(suggested.state).toBe("event_ready");
    if (suggested.state !== "event_ready") throw new Error("expected feedback event");
    expect(suggested.event).toMatchObject({
      eventType: "explicit_feedback",
      feedbackCategory: "not_relevant_enough",
      sendPolicy: "no_send",
      feedbackPolicy: "typed_scoped_feedback_only",
      currentBodyId: session.currentBodyId,
      bodyRevision: session.bodyRevision,
      productFeedbackBoundaryState: "separate_product_health_rating_not_pe_feedback",
    });

    const duplicate = submitPromptEnhancementSuggestedFeedbackV1(suggested.adapterState, "too_much_or_too_long", 21);
    expect(duplicate.state).toBe("no_event");
    expect(duplicate.reasonCodes).toContain("feedback_not_open");

    const acknowledged = resolvePromptEnhancementFeedbackAcknowledgementV1(
      suggested.adapterState,
      {
        stableEventIdentity: suggested.adapterState.inFlightEventIdentity!,
        status: "accepted",
        publicSafeText: "Feedback received.",
      },
    );
    expect(acknowledged.status).toBe("acknowledged");
    expect(acknowledged.session.currentBodyId).toBe(session.currentBodyId);

    const otherState = editPromptEnhancementOtherFeedbackV1(opened, "Keep the verification section concise.");
    const cancelled = cancelPromptEnhancementFeedbackV1(otherState);
    expect(cancelled.status).toBe("hidden");
    expect(cancelled.draftText).toBeUndefined();

    const other = submitPromptEnhancementOtherFeedbackV1(otherState, 22);
    expect(other.state).toBe("event_ready");
    if (other.state !== "event_ready") throw new Error("expected Other feedback event");
    expect(other.event.feedbackCategory).toBe("custom_typed");
    expect(other.event.sendPolicy).toBe("no_send");
    expect(other.adapterState.draftText).toBeUndefined();

    const stale = submitPromptEnhancementSuggestedFeedbackV1(opened, "not_relevant_enough", 23, "old-body", 0);
    expect(stale.state).toBe("no_event");
    expect(stale.reasonCodes).toContain("stale_or_mismatched_popup_event");
  });

  it('DEP-TEST-01-B1.2-01 preserves a dirty current-body draft on same-identity redraw', () => {
    const session = buildPromptEnhancementPopupSessionV1({
      viewPayload: viewPayload(),
      validationDecisionId: 'body-1:validation:1:final_body',
      timestampMs: 10,
    });
    const built = buildPromptEnhancementLocalDraftV1(session);
    expect(built.state).toBe('draft_ready');
    if (built.state !== 'draft_ready') throw new Error('expected draft');
    const dirty = updatePromptEnhancementCurrentBodyDraftV1(built.draft, 'Edited current body', 7);
    const redraw = reconcilePromptEnhancementLocalDraftV1(dirty, session);
    expect(redraw.state).toBe('updated');
    if (redraw.state !== 'updated') throw new Error('expected redraw');
    expect(redraw.identityChanged).toBe(false);
    expect(redraw.draft.currentBody).toMatchObject({ text: 'Edited current body', cursorOffset: 7, dirty: true });
  });

  it('DEP-TEST-01-B1.2-02 starts a distinct draft for a new canonical revision', () => {
    const session = buildPromptEnhancementPopupSessionV1({
      viewPayload: viewPayload(),
      validationDecisionId: 'body-1:validation:1:final_body',
      timestampMs: 10,
    });
    const built = buildPromptEnhancementLocalDraftV1(session);
    expect(built.state).toBe('draft_ready');
    if (built.state !== 'draft_ready') throw new Error('expected draft');
    const dirty = updatePromptEnhancementCurrentBodyDraftV1(built.draft, 'Edited current body');
    const nextSession = buildPromptEnhancementPopupSessionV1({
      viewPayload: viewPayload({
        enhancementId: 'phase7-enhancement-next',
        body: { ...viewPayload().body, currentBodyId: 'body-2', bodyRevision: 2, text: 'New canonical body' },
      }),
      validationDecisionId: 'body-2:validation:2:final_body',
      timestampMs: 11,
    });
    const reconciled = reconcilePromptEnhancementLocalDraftV1(dirty, nextSession);
    expect(reconciled.state).toBe('updated');
    if (reconciled.state !== 'updated') throw new Error('expected new draft');
    expect(reconciled.identityChanged).toBe(true);
    expect(reconciled.draft.currentBody.text).toBe('New canonical body');
  });

  it('DEP-TEST-01-B1.2-03 ignores stale input and keeps dirty details local', () => {
    const session = buildPromptEnhancementPopupSessionV1({
      viewPayload: viewPayload(),
      validationDecisionId: 'body-1:validation:1:final_body',
      timestampMs: 10,
    });
    const built = buildPromptEnhancementLocalDraftV1(session);
    expect(built.state).toBe('draft_ready');
    if (built.state !== 'draft_ready') throw new Error('expected draft');
    const dirty = updatePromptEnhancementAdditionalDetailsDraftV1(built.draft, 'Keep this local');
    expect(dirty.additionalDetailsState).toBe('dirty_unsubmitted');
    const stale = reconcilePromptEnhancementLocalDraftV1(dirty, session, true);
    expect(stale).toMatchObject({ state: 'ignored_stale', reasonCodes: ['stale_or_mismatched_draft'] });
    expect(stale.draft.additionalDetails.text).toBe('Keep this local');
  });
});
