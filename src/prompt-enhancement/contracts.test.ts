import { describe, expect, it } from 'vitest';
import {
  PROMPT_ENHANCEMENT_CONTRACT_VERSION,
  PROMPT_ENHANCEMENT_STORE_PORT_CONTRACT_V1,
  findDisallowedRawContractKeys,
  findDisallowedVariantKeys,
  findLegacyDecisionSessionKeys,
  validatePromptEnhancementActionRequestV1,
  validatePromptEnhancementPrepareRequestV1,
  validatePromptEnhancementPrepareResultV1,
  type PromptEnhancementActionRequestV1,
  type PromptEnhancementHandoffMetadataV1,
  type PromptEnhancementPrepareRequestV1,
  type PromptEnhancementPrepareResultV1,
} from './contracts.js';

const sourceRef = {
  sourceRefId: 'src-a-1',
  sourceKind: 'source_a_user_prompt',
  sourceId: 'prompt:1',
  sourceAuthorization: 'implementation_input',
  evidenceStatus: 'present',
  freshness: 'current',
  confidence: 'high',
  privacyClass: 'local_private',
} as const;

const triggerProvenance = {
  currentStage: 'implementation',
  prevStage: 'task_breakdown',
  triggerKind: 'absence',
  firedKey: 'absence:debugging_observation_gap@implementation',
  effectiveFiredSource: 'classifier_fire_recommendation',
  selectedQualifyingAbsence: 'debugging_observation_gap',
  absenceGateReason: 'selected_qualifying_absence',
  classifierState: 'fire_recommended',
  degradedNoActionState: 'none',
  promptStartBoundary: 'UserPromptSubmit -> runAuto',
  deliveryBoundary: 'Stop -> runStop',
  promptStartCanReplaceSameTurn: false,
  sessionId: 'session-1',
  promptIndex: 4,
} as const;

const callVisibility = {
  callOwner: 'content_semantics',
  callVisibilityMode: 'deterministic',
  callTrigger: 'prepare',
  optionalCallAvailabilityState: 'deterministic_only',
  timeoutMs: 0,
  estimatedInputTokens: 0,
  estimatedOutputTokens: 0,
  plannedCallCount: 0,
  usedCallCount: 0,
  providerAvailabilityState: 'not_applicable',
  fallbackReason: 'not_applicable',
  priorCallAccountingRefs: [],
  localLoggingHookState: 'counts_only',
  productValueSignoffRef: 'accepted_with_product_scope_notes',
  productValueDiscussionIsRuntimeLimiter: false,
} as const;

const safetySummary = {
  validationStatus: 'valid',
  sendPolicy: 'send_current',
  sensitiveActionState: 'none',
  sourceHonestyState: 'valid',
  privacyState: 'valid',
  authorityEscalationState: 'valid',
  noForegroundSafer: true,
  noAutomaticSend: true,
} as const;

function phase10HandoffMetadata(): PromptEnhancementHandoffMetadataV1 {
  return {
    handoffMetadataVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
    handoffDecisionId: 'handoff-1',
    currentBodyId: 'body-1',
    bodyRevision: 1,
    handoffKind: 'metadata_only',
    sequenceActivationPolicy: 'blocked_pending_sequence_runtime_and_cost_gates',
    futurePromptTextPolicy: 'not_generated_not_stored_not_rendered',
    suggestedNextPromptPolicy: 'not_generated',
    suggestedNextPromptRefs: [],
    currentBodyValidityState: 'valid_for_current_body_revision',
    itemLineageRefs: ['handoff-slice:body-1:1'],
    sourceLineageRefs: ['src-a-1', 'ct:ABSENCE_DEBUGGING_OBSERVATION'],
    scope: {
      requestId: 'pe-req-1',
      projectRoot: '/tmp/project',
      projectScopeState: 'current_project_only',
      sourceScopeRefs: ['project:/tmp/project'],
      crossProjectApplicationPolicy: 'reject',
      staleResponsePolicy: 'ignore_no_overwrite',
    },
    applicabilityState: 'metadata_only_candidate',
    riskConfirmationState: 'none',
    fallbackMode: 'none',
    receiverValidationRequirements: ['handoff', 'launch_check'],
    activationState: 'no_activation_v1',
    userHandoffConsentState: 'not_accepted',
    pointInventory: [{
      pointRefId: 'handoff-point:1',
      sourcePointRef: 'src-a-1',
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
      sourceRefs: ['src-a-1'],
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
      targetScopeRefs: ['project:/tmp/project'],
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
      contentTemplateSourceRefs: ['ct:ABSENCE_DEBUGGING_OBSERVATION'],
      contentTemplateVariantIdentityRefs: [],
      servedVariantEventRefs: [],
      recordSignalTypes: ['ABSENCE_DEBUGGING_OBSERVATION'],
      recordSourceTiers: ['shipped'],
      recordSchemaVersions: ['1'],
      recordQuestionRefs: ['ct:question:debug'],
      recordPinchFallbackRefs: ['ct:pinch:debug'],
      recordRegisterSnapshotRefs: ['ct:register:default'],
      recordRoleSnapshotRefs: ['ct:role:developer'],
      recordMaturityLevelSnapshotRefs: ['ct:maturity:standard'],
      recordSnapshotRefs: ['ct:snapshot:debug'],
      recordComposePathRefs: ['ct:compose:deterministic'],
      recordSafeguardStateRefs: [],
      sourceCascadeOutcomeRefs: ['ct:cascade:shipped'],
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
      runtimeOwnerState: 'future_future_sequence_only_after_gates',
    },
    reasonCodes: ['v1_handoff_metadata_only', 'v1_no_active_sequence_runtime'],
  };
}

const composerArtifactFields = {
  composerRunId: 'composer-run-1',
  routeDecisionId: 'route-decision-1',
  promptReviewOrigin: 'user_authored_current_prompt',
  promptReviewProcessingPolicy: 'eligible_for_initial_pe_route',
  sentPromptOrigin: 'pe_baseline_generated_body',
  nexpathGeneratedPromptRef: 'body-1:generated:1',
  renderedPromptBody: 'Original request:\nFix the failing payment test and explain the verification.\n\nPlan:\nReproduce, fix, and verify the failure.',
  originalPromptSectionId: 'section-original',
  sourceAttribution: [
    {
      sourceRefId: 'src-a-1',
      sourceId: 'prompt:1',
      sourceKind: 'source_a_user_prompt',
      evidenceStatus: 'present',
      publicSafeLabel: 'current original prompt',
      privateIdPolicy: 'metadata_only_not_body',
    },
  ],
  llmCallPolicy: 'no_call',
  composerMode: 'baseline_deterministic_render',
  languagePolicyApplied: 'technical_english_default',
  languageValidationStatus: 'valid',
  effectiveLanguageState: 'unknown_default',
  languageSource: 'technical_english_default',
  languageConfidence: 'unknown',
  languagePolicy: 'technical_english_default',
  instructionPrecedenceState: 'generated_sections_qualify_original',
  originalAsSourceStatus: 'local_verbatim_source_context',
  composerClaims: ['claim:part-original'],
  sourceFactIds: ['part-original'],
  localOriginalPromptIncluded: true,
} as const;

const spanRef = {
  spanRefId: 'span-original-1',
  sectionId: 'section-original',
  startOffset: 0,
  endOffset: 96,
  sourceRefs: ['src-a-1'],
  spanMappingStatus: 'exact',
  textStoragePolicy: 'text_in_body_only',
} as const;

const sectionForFeedback = {
  sectionId: 'section-original',
  sectionKind: 'original_request',
  label: 'Original request',
  templateType: 'debug_repair',
  familyId: 'debug_maintenance',
  primaryIntent: 'debug_and_verify',
  sourceKinds: ['source_a_user_prompt'],
  sourceIds: ['prompt:1'],
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
  spanRefs: [spanRef],
  preciseFeedbackAllowed: true,
} as const;

const templateRef = {
  schemaVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
  templateId: 'pe-template-debug-repair',
  registryNamespace: 'prompt-enhancement-templates',
  templateType: 'debug_repair',
  familyId: 'debug_maintenance',
  displayLabel: 'Debug repair',
  primaryIntent: 'debug_and_verify',
  intentTags: ['debug', 'verify'],
  capabilityIds: ['debug', 'verify'],
  triggerHints: ['debugging_observation_gap'],
  supportedLevels: ['default', 'shorter', 'more_thorough', 'more_project_grounded'],
  defaultLevel: 'default',
  applicabilityAxes: ['stage', 'absence', 'source_a'],
  applicabilityGuards: ['source_a_required'],
  sourcePriorityState: 'source_a_first',
  targetScopePolicy: 'source_a_plus_grounded_support',
  capabilityRequirements: ['test_reproduction', 'verification'],
  requiredSectionKinds: ['original_request', 'grounded_plan'],
  optionalSectionKinds: ['verification_notes'],
  sectionSlots: ['original', 'plan'],
  sectionOrderPolicy: 'fixed_required_before_optional',
  sourceGuidanceFloorPolicy: 'required_when_popup_shown',
  originalPromptPreservationPolicy: 'visible_verbatim_required',
  allowedSourceKinds: ['source_a_user_prompt', 'content_template_fact', 'stage_or_absence_signal'],
  requiredSourceACoverage: 'visible_original_prompt',
  allowedSourceBSupportKinds: ['content_template_fact', 'stage_or_absence_signal'],
  baselineSourceSignalSlot: 'debugging_observation_gap',
  sourceEvidenceStatusRules: ['present', 'not_applicable', 'unknown', 'failed_fallback'],
  contentTemplateInputRefs: ['ct:ABSENCE_DEBUGGING_OBSERVATION'],
  safetyHookIds: ['voice_policy', 'source_honesty'],
  sensitivityPolicy: 'deterministic_flags_required',
  voicePolicyRef: 'user_to_agent_voice',
  confirmationRequirementPolicy: 'preserve_when_required',
  supportedDirectionalActions: ['shorter', 'more_thorough', 'more_project_grounded', 'apply_details'],
  composerPolicy: 'deterministic_only',
  deterministicRendererId: 'deterministic-joined-body-v1',
  llmCallPolicy: 'no_call',
  tokenTimeoutProfileRef: 'cost-default',
  validationRequirementIds: ['original_preserved', 'source_honesty'],
  fallbackReasonCodes: ['provider_unavailable', 'validation_failed', 'not_applicable'],
  publicSafeDiagnosticCodes: ['generated', 'source_coverage', 'validation_failed'],
  fallbackPolicy: 'deterministic_body',
  testFixtureIds: ['pe-contract-valid-one-body'],
  invariantIds: ['one_current_body', 'no_old_ds_options'],
  ownerArea: 'content_semantics',
  launchVisibility: 'private_until_launch_recheck',
  publicSafeSourceNotes: ['Content-template refs are Source B only.'],
  routeFixtureIds: ['route-debug-maintenance'],
  evaluationFixtureIds: ['eval-debug-maintenance'],
} as const;

const sectionPlan = {
  sectionPlanId: 'section-plan-original',
  sectionId: 'section-original',
  sectionKind: 'original_request',
  templateId: 'pe-template-debug-repair',
  familyId: 'debug_maintenance',
  primaryIntent: 'debug_and_verify',
  order: 1,
  sourceRefs: [sourceRef],
  sourceKind: 'source_a_user_prompt',
  sourceIds: ['prompt:1'],
  sourceEvidenceStatus: 'present',
  slotEvidenceStatus: 'present',
  baselineSourceSignalSlot: 'debugging_observation_gap',
  requirementSourceStatus: 'present',
  isRequired: true,
  isEditable: true,
  removalFeedbackPolicy: 'typed_event_required',
  safetyFlags: [],
  sensitivityFlags: [],
  validationStatus: 'valid',
  fallbackMode: 'none',
  callVisibilityMode: 'deterministic',
  deterministicTextBasisPolicy: 'structured_parts',
  textDraftRef: 'draft-original',
  structuredContentPartRefs: ['part-original'],
  supportedActions: ['use_current_body', 'shorter', 'more_thorough', 'more_project_grounded', 'apply_details'],
  contentTemplateRuntimeSeamUse: 'none',
  handoffCapabilityFlags: ['no_runtime_sequence_v1'],
} as const;

function validationPhase(stage: string) {
  return {
    stage,
    status: 'valid',
    fallbackMode: 'none',
    failureCodes: [],
    publicSafeReasonCategory: 'generated',
  } as const;
}

function validRequest(): PromptEnhancementPrepareRequestV1 {
  return {
    schemaVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
    requestId: 'pe-req-1',
    projectRoot: '/tmp/project',
    hostSurface: 'cli_stop_bridge',
    sourcePrompt: {
      text: 'Fix the failing payment test and explain the verification.',
      origin: 'user',
      capturedAt: 1,
      promptIndex: 4,
      generatedOriginPolicy: 'ordinary_source_a',
    },
    reviewMomentContext: {
      reviewMoment: 'UserPromptSubmit_preparation',
      currentAgentMode: 'workspace-write',
      projectId: 'project-1',
      sessionId: 'session-1',
      detectedLanguage: 'typescript',
      stageCandidate: 'implementation',
      promptCount: 4,
      recentPromptMetadataRefs: ['recent-prompt:privacy-approved:1'],
      triggerProvenance,
    },
    sourceSignals: {
      sourceAOriginalPromptRef: sourceRef,
      sourceRefs: [sourceRef],
      normalizedStageAbsenceSignalRefs: ['absence:debugging_observation_gap'],
      contentTemplateRecordFactRefs: ['ct:ABSENCE_DEBUGGING_OBSERVATION'],
      popupQuestionSourceRefs: ['ctq:debugging_observation_gap'],
      whyHelpSourceRefs: ['why:debugging_observation_gap'],
      profileRoleModeRefs: ['profile:workspace-write'],
      rightGoodWorkStyleEnvRuntimeRefs: ['right-good:verification'],
      missingMemoryCandidateRefs: [],
      sourceLabels: [
        {
          sourceRefId: 'src-a-1',
          label: 'original_prompt',
          evidenceStatus: 'present',
        },
      ],
      contentTemplate: {
        recordSignalType: 'ABSENCE_DEBUGGING_OBSERVATION',
        contentSource: 'content-template',
        resolvedRecordIdentity: 'ABSENCE_DEBUGGING_OBSERVATION',
        resolvedSource: 'shipped',
        sourceCascade: ['uploaded', 'autogen', 'shipped', 'default'],
        registerOverridePath: 'base',
        safeguardRequired: false,
        questionServing: 'signal-pinch-fields',
      },
      promptStartStop: {
        hookBoundary: 'UserPromptSubmit -> runAuto',
        deliveryBoundary: 'Stop -> runStop',
        runAutoCanHoldOrReplaceSubmittedPrompt: false,
        sharedSignalCount: 137,
        classifierDegradedNoFireReasons: ['missing_or_invalid_api_key'],
      },
      store: {
        schemaVersion: 1,
        missingPromptEnhancementTables: ['prompt_enhancement_source_use'],
        cleanupGaps: ['future_pe_rows'],
      },
      historicalBootstrap: {
        authorization: 'source_fact_only',
        sourceClass: 'claude_project_jsonl',
        servedRowsAreMemoryAuthority: false,
        transcriptCorroborationIsHistoricalImport: false,
      },
      launchBoundary: {
        authorization: 'non_runtime_gate',
        launchReady: false,
        requiredRecheckAfterImplementation: ['private_planning_leakage'],
      },
      permissionMode: 'workspace-write',
      transcriptPathState: 'not_authority',
      streamBOutputs: ['implementation_checkpoint'],
      paramEventChannels: ['keyword', 'served'],
      servedVariantIdentityRefs: ['variant:1'],
      deliveryGateRefs: ['freq_once_per_session'],
      sourceOnlyHardFactRefs: ['hard_fact:source-only-no-popup-authority'],
    },
    userPreferenceContext: {
      levelState: 'default',
      scopedFeedbackEvidenceRefs: [],
    },
    configSnapshot: {
      sequenceEnabledState: 'not_enabled_v1',
      validatedEffectiveConfigState: 'valid',
      arbitraryConfigRowsAreAuthority: false,
    },
    callVisibilityState: callVisibility,
    privacyAndStoragePolicy: {
      sensitivityClass: 'normal',
      localStorageEligibility: 'ids_and_categories_only',
      telemetryEligibility: 'allowlisted_counts_only',
      llmSharingEligibility: 'allowed_minimal',
      generatedBodyStoragePolicy: 'do_not_store_raw_by_default',
    },
  };
}

function validResult(): PromptEnhancementPrepareResultV1 {
  return {
    schemaVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
    enhancementId: 'pe-enh-1',
    requestId: 'pe-req-1',
    projectRoot: '/tmp/project',
    modelVersion: 'contracts-v1',
    disposition: 'show_current_body',
    validationDecisionId: 'body-1:validation:1:final_body',
    currentBody: {
      currentBodyId: 'body-1',
      bodyRevision: 1,
      ...composerArtifactFields,
      text: 'Original request:\nFix the failing payment test and explain the verification.\n\nPlan:\nReproduce, fix, and verify the failure.',
      originalPromptText: 'Fix the failing payment test and explain the verification.',
      originalPromptPreservation: 'visible_verbatim',
      generatedOriginState: 'pe_generated_body',
      generatedSafeStatus: 'valid',
      userDirtyState: 'clean',
      sections: [
        {
          sectionId: 'section-original',
          sectionKind: 'original_request',
          title: 'Original request',
          bodyText: 'Fix the failing payment test and explain the verification.',
          templateType: 'debug_repair',
          familyId: 'debug_maintenance',
          primaryIntent: 'debug_and_verify',
          registryNamespace: 'prompt-enhancement-templates',
          sourceTemplateType: 'prompt_enhancement_template',
          sourceKind: 'source_a_user_prompt',
          sourceIds: ['prompt:1'],
          sourceFactIds: ['part-original'],
          routeCandidateRefs: ['pe-template-debug-repair'],
          evidenceStatus: 'present',
          sourceEvidenceStatus: 'present',
          slotEvidenceStatus: 'present',
          baselineSourceSignalSlot: 'debugging_observation_gap',
          requirementSourceStatus: 'present',
          requiredSurvivor: true,
          mandatoryFloor: true,
          depthState: 'required_survivor',
          axisContributions: ['practiceDepth', 'sectionDensity'],
          canMergeInShorter: false,
          canExpandInMoreThorough: true,
          canGroundInMoreProjectGrounded: true,
          feedbackSensitivity: 'protected',
          fallbackBehavior: 'none',
          handoffFlags: ['no_runtime_sequence_v1'],
          privacyClass: 'local_private',
          publicCopySafe: true,
          authorityBoundary: 'no_authority_escalation',
          confirmationRequired: false,
          confirmationPresent: false,
          isEditable: true,
          removalFeedbackPolicy: 'typed_event_required',
          validationStatus: 'valid',
          safetyFlags: [],
          sensitivityFlags: [],
          spanRefs: [spanRef],
          publicExplanationCategory: 'source_coverage',
          whyHelpReasonCodes: ['part-original'],
          callVisibilityMode: 'deterministic',
          contentTemplateRuntimeSeamUse: 'none',
          handoffCapabilityFlags: ['no_runtime_sequence_v1'],
        },
      ],
    },
    availableActions: [
      {
        actionId: 'act-use-current',
        actionType: 'use_current_body',
        label: 'Use this prompt',
        currentBodyId: 'body-1',
        bodyRevision: 1,
        availability: 'available',
        callVisibilityMode: 'deterministic',
      },
      {
        actionId: 'act-shorter',
        actionType: 'shorter',
        label: 'Shorter',
        currentBodyId: 'body-1',
        bodyRevision: 1,
        availability: 'available',
        callVisibilityMode: 'deterministic',
      },
    ],
    handoffMetadata: phase10HandoffMetadata(),
    sourceGuidanceCoverage: 'covered',
    routingAndFeedbackDecision: {
      state: 'show',
      confidence: 'high',
      reasonCodes: ['source_a_plus_shared_absence'],
      scopedPromptKindKey: 'debug_and_verify',
      priorFeedbackEvidenceRefs: [],
      resetExpiryState: 'not_applicable',
      selectedFamilyId: 'debug_maintenance',
      selectedTagIds: ['debug'],
      selectedLevelState: 'default',
      selectedSectionPivotIds: ['section-original'],
    },
    routeDecision: {
      routeDecisionId: 'route-decision-1',
      promptReviewOrigin: 'user_authored_current_prompt',
      promptReviewProcessingPolicy: 'eligible_for_initial_pe_route',
      familyId: 'issue_debug',
      primaryIntent: 'issue_debug.failing_test',
      capabilityOverlays: ['capability.reproduction_or_evidence_needed', 'capability.verification_required'],
      selectedTemplateRef: templateRef,
      candidateRouteIds: ['pe-route-issue-debug-failing-test', 'pe-route-feature-fresh-implementation'],
      rejectedRoutes: [
        {
          routeId: 'pe-route-feature-fresh-implementation',
          reasonCode: 'lower_source_match',
          publicSafeReasonCategory: 'source_coverage',
        },
      ],
      ambiguityState: 'clear',
      suppressionState: 'not_suppressed',
      routeInputEvidenceRefs: ['src-a-1', 'ct:ABSENCE_DEBUGGING_OBSERVATION'],
      routeEvidence: ['src-a-1', 'ct:ABSENCE_DEBUGGING_OBSERVATION'],
      registryLinkedFixtureIds: ['route-debug-maintenance'],
      usesPeOnlyClassifier: false,
      usesOldStaticDecisionSessionMap: false,
    },
    bodyPlan: {
      bodyPlanId: 'body-plan-1',
      bodyRevision: 1,
      routeDecisionId: 'route-decision-1',
      orderedSectionPlans: [sectionPlan],
      originalPromptPreservation: 'visible_verbatim',
      groundedSourceGuidancePolicy: 'required_when_popup_shown',
      generatedOriginPolicy: 'attach_generated_origin_metadata',
      futurePromptTextPolicy: 'not_generated_not_stored_not_rendered',
      exposesPrecomputedVariants: false,
    },
      composerBoundary: {
        composerBoundaryVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
        composerPolicy: 'deterministic_only',
        composerRunId: 'composer-run-1',
        routeDecisionId: 'route-decision-1',
        promptReviewOrigin: 'user_authored_current_prompt',
        promptReviewProcessingPolicy: 'eligible_for_initial_pe_route',
        sentPromptOrigin: 'pe_baseline_generated_body',
        nexpathGeneratedPromptRef: 'body-1:generated:1',
        renderedPromptBody: 'Original request:\nFix the failing payment test and explain the verification.\n\nPlan:\nReproduce, fix, and verify the failure.',
        originalPromptSectionId: 'section-original',
        sourceAttribution: [
          {
            sourceRefId: 'src-a-1',
            sourceId: 'prompt:1',
            sourceKind: 'source_a_user_prompt',
            evidenceStatus: 'present',
            publicSafeLabel: 'current original prompt',
            privateIdPolicy: 'metadata_only_not_body',
          },
        ],
        llmCallPolicy: 'no_call',
        rawComposerOutput: 'not_used_deterministic',
      validatedCanonicalPromptArtifact: 'current_body_v1',
      composerMode: 'baseline_deterministic_render',
      budgetState: {
        llmCallPolicy: 'no_call',
        callVisibilityMode: 'deterministic',
        productValueDiscussionIsRuntimeLimiter: false,
      },
      languagePolicyApplied: 'technical_english_default',
      languageValidationStatus: 'valid',
      effectiveLanguageState: 'unknown_default',
      languageSource: 'technical_english_default',
      languageConfidence: 'unknown',
      languagePolicy: 'technical_english_default',
      instructionPrecedenceState: 'generated_sections_qualify_original',
      originalAsSourceStatus: 'local_verbatim_source_context',
      composerClaims: ['claim:part-original'],
      sourceFactIds: ['part-original'],
      localRenderOriginalPrompt: true,
      composerVisiblePromptContext: {
        contextPolicy: 'structured_refs_only_no_raw_original',
        originalPromptVisibleLocallyOnly: true,
        boundedContextRefCount: 2,
        rawPromptTextExcluded: true,
      },
      composerVisiblePromptContextRefs: ['src-a-1', 'part-original'],
      composerInputPrivacyState: 'approved_refs_only',
      localOriginalPromptIncluded: true,
      strictSchemaFailureReasonCodes: [
        'invalid_json',
        'duplicate_key',
        'unknown_field',
        'invalid_enum',
        'bad_reference',
        'output_cap_exceeded',
        'unsafe_metadata_copy',
      ],
      fallbackReasonCodes: ['not_applicable'],
      inputContract: {
        originalPromptRef: sourceRef,
        bodyPlanId: 'body-plan-1',
        sectionPlanIds: ['section-plan-original'],
        boundedSourceSummaryRefs: ['ct:ABSENCE_DEBUGGING_OBSERVATION'],
        privacyApprovedFactsOnly: true,
        callVisibilityState: callVisibility,
        excludesRawStoreRows: true,
        excludesOldDecisionSessionOptionText: true,
        excludesUiInferredBusinessState: true,
      },
      outputContract: {
        structuredSectionsRequired: true,
        joinedCurrentBodyRequired: true,
        preservesSectionIds: true,
        preservesSourceRefs: true,
        preservesSafetyRequirements: true,
        textOnlyOutputAllowed: false,
      },
      deterministicFallback: {
        available: true,
        fallbackMode: 'deterministic_body',
        productValueDiscussionIsRuntimeLimiter: false,
      },
    },
    validationSummary: safetySummary,
    safetySummary,
    validationGraph: {
      graphVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
      graphOwner: 'content_semantics',
      phaseStates: [
        validationPhase('request'),
        validationPhase('pre_plan'),
        validationPhase('section_plan'),
        validationPhase('composer_input'),
        validationPhase('composer_output'),
        validationPhase('final_body'),
        validationPhase('user_edit'),
        validationPhase('action'),
        validationPhase('delivery'),
        validationPhase('storage'),
        validationPhase('source_use'),
        validationPhase('privacy'),
        validationPhase('handoff'),
        validationPhase('sequence'),
        validationPhase('launch_check'),
      ],
      failures: [],
      safetyState: safetySummary,
      providerRuntimeState: 'deterministic',
      optionalCallAvailabilityState: 'deterministic_only',
      rawTransportIsValidationProof: false,
      evaluatesAgentResponseQuality: false,
      canAutoAdvanceSequencePointer: false,
    },
    callAndVisibilityMetadata: callVisibility,
    uiView: {
      viewPayloadVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
      enhancementId: 'pe-enh-1',
      body: {
        text: 'Original request:\nFix the failing payment test and explain the verification.\n\nPlan:\nReproduce, fix, and verify the failure.',
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
      sectionsForFeedback: [sectionForFeedback],
      publicTrustCues: [
        {
          cueId: 'cue-original',
          label: 'original_prompt',
          publicSafeText: 'Original prompt preserved.',
          sourceRefIds: ['src-a-1'],
          rawPrivateDataExcluded: true,
        },
        {
          cueId: 'cue-safety',
          label: 'safety_safeguard',
          publicSafeText: 'Safety validation passed.',
          sourceRefIds: [],
          rawPrivateDataExcluded: true,
        },
      ],
      actions: [
        {
          actionId: 'act-use-current',
          actionType: 'use_current_body',
          label: 'Use this prompt',
          currentBodyId: 'body-1',
          bodyRevision: 1,
          availability: 'available',
          callVisibilityMode: 'deterministic',
        },
      ],
      actionInputContract: {
        actionInputVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
        enhancementId: 'pe-enh-1',
        currentBodyId: 'body-1',
        bodyRevision: 1,
        actionId: 'act-use-current',
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
      handoffAndSequenceSummary: phase10HandoffMetadata(),
      diagnostics: [
        {
          diagnosticId: 'diagnostic-generated',
          category: 'generated',
          publicSafeText: 'Generated prompt is ready.',
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
    },
    generatedOrigin: {
      generatedOriginId: 'origin-1',
      generatedOriginState: 'pe_generated_body',
      enhancementId: 'pe-enh-1',
      bodyId: 'body-1',
      bodyRevision: 1,
      deliveryChannel: 'cli_stop_bridge',
      sourceUseIds: ['source-use-1'],
      echoRecursionGuard: {
        bodyFingerprintRef: 'body-fingerprint-1',
        sourcePromptEchoState: 'not_echo',
        lastInjectedPromptIsAuthority: false,
      },
      learningEligibility: {
        promptHistory: false,
        profile: false,
        stage: false,
        language: false,
        memory: false,
        telemetry: false,
        sourceUseTracking: true,
      },
    },
    delivery: {
      deliveryChannel: 'cli_stop_bridge',
      sendPolicy: 'send_current',
      stopReasonCarriesTextOnly: true,
      rawTransportIsSemanticAuthority: false,
      hostCapabilityState: 'stop_bridge_only',
      extensionPayloadState: 'not_applicable',
      hostCapabilityEvidenceRefs: ['stop-bridge-current'],
      exposureAcknowledgementState: 'shown',
    },
    ownership: {
      owners: ['content_semantics', 'ui_app', 'host_transport'],
      sourceSnapshotVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
      fixtureIds: ['pe-contract-valid-one-body'],
      launchBoundaryRecheckRef: 'launch_boundary_recheck_pending',
      excludesPrivatePlanningLeakage: true,
    },
    diagnostics: [
      {
        diagnosticId: 'diagnostic-contract-fixture',
        category: 'generated',
        publicSafeText: 'Public-safe contract fixture.',
        rawPromptExcluded: true,
        rawGeneratedBodyExcluded: true,
        rawSourceExcerptExcluded: true,
        rawFeedbackExcluded: true,
        privateIdsExcluded: true,
        researchLabelsExcluded: true,
        rawReasonValuesExcluded: true,
      },
    ],
  };
}

describe('Phase 2 contract-first core', () => {
  it('accepts a typed prepare request with source snapshots and no UI-inferred state', () => {
    expect(validatePromptEnhancementPrepareRequestV1(validRequest())).toEqual({
      ok: true,
      reasonCodes: [],
    });
  });

  it('accepts one current editable body with sections, actions, safety, origin, delivery, cost, and owner metadata', () => {
    const result = validResult();

    expect(validatePromptEnhancementPrepareResultV1(result)).toEqual({
      ok: true,
      reasonCodes: [],
    });
    expect(result.currentBody.sections).toHaveLength(1);
    expect(result.availableActions.map((action) => action.label)).toEqual(['Use this prompt', 'Shorter']);
    expect(result.generatedOrigin.learningEligibility).toMatchObject({
      promptHistory: false,
      profile: false,
      stage: false,
      language: false,
      memory: false,
      telemetry: false,
    });
    expect(result.handoffMetadata?.sequenceActivationPolicy).toBe('blocked_pending_sequence_runtime_and_cost_gates');
    expect(result.handoffMetadata?.itemLineageRefs).toEqual(['handoff-slice:body-1:1']);
    expect(result.handoffMetadata?.receiverValidationRequirements).toEqual(['handoff', 'launch_check']);
    expect(result.handoffMetadata?.taskSlices[0]?.futurePromptCandidateState).toBe('candidate_metadata_only');
    expect(result.handoffMetadata?.runtimeGuards.createsRuntimeQueue).toBe(false);
    expect(result.handoffMetadata?.privacyStoragePolicy.futurePromptBodiesStored).toBe(false);
    expect(result.routeDecision.usesPeOnlyClassifier).toBe(false);
    expect(result.bodyPlan.exposesPrecomputedVariants).toBe(false);
    expect(result.composerBoundary.outputContract.textOnlyOutputAllowed).toBe(false);
    expect(result.uiView.sectionsForFeedback).toHaveLength(1);
    expect(result.uiView.textOnlyDeliveryIsAuthority).toBe(false);
    expect(result.validationGraph.phaseStates.map((phase) => phase.stage)).toEqual([
      'request',
      'pre_plan',
      'section_plan',
      'composer_input',
      'composer_output',
      'final_body',
      'user_edit',
      'action',
      'delivery',
      'storage',
      'source_use',
      'privacy',
      'handoff',
      'sequence',
      'launch_check',
    ]);
    expect(result.callAndVisibilityMetadata.productValueDiscussionIsRuntimeLimiter).toBe(false);
    expect(result.callAndVisibilityMetadata.optionalCallAvailabilityState).toBe('deterministic_only');
    expect(result.generatedOrigin.echoRecursionGuard.lastInjectedPromptIsAuthority).toBe(false);
    expect(PROMPT_ENHANCEMENT_STORE_PORT_CONTRACT_V1.statusDebugFunctions).toContain('getPromptEnhancementStoreStatus');
    expect(PROMPT_ENHANCEMENT_STORE_PORT_CONTRACT_V1.fallbackStates).toContain('newer_schema_no_trust');
    expect(PROMPT_ENHANCEMENT_STORE_PORT_CONTRACT_V1.requiresSaveStoreAfterMutations).toBe(true);
    expect(PROMPT_ENHANCEMENT_STORE_PORT_CONTRACT_V1.supportsMemoryAndDiskStores).toBe(true);
    expect(PROMPT_ENHANCEMENT_STORE_PORT_CONTRACT_V1.uiMayIssueDirectSql).toBe(false);
    expect(result.diagnostics[0]?.rawReasonValuesExcluded).toBe(true);
  });

  it('UI-9: accepts absent or well-formed header copy but rejects a malformed pinchLabel / whyHelp', () => {
    // Absent (the common case) stays valid.
    expect(validatePromptEnhancementPrepareResultV1(validResult()).ok).toBe(true);

    // Well-formed pinch + why-help stay valid.
    const withHeader = {
      ...validResult(),
      uiView: {
        ...validResult().uiView,
        pinchLabel: { text: 'Bug hunt.', derivedFrom: 'family' as const },
        whyHelp: { text: 'Shown because this touches a sensitive action.', reasonKind: 'sensitive_action' as const },
      },
    };
    expect(validatePromptEnhancementPrepareResultV1(withHeader).ok).toBe(true);

    // A malformed pinchLabel (non-string text) is rejected at the uiView boundary.
    const badPinch = {
      ...validResult(),
      uiView: { ...validResult().uiView, pinchLabel: { text: 42, derivedFrom: 'family' } as unknown },
    } as PromptEnhancementPrepareResultV1;
    expect(validatePromptEnhancementPrepareResultV1(badPinch).reasonCodes).toContain('missing_ui_view_payload');

    // A malformed whyHelp (reasonKind out of range) is rejected too.
    const badWhy = {
      ...validResult(),
      uiView: { ...validResult().uiView, whyHelp: { text: 'x', reasonKind: 'not_a_reason' } as unknown },
    } as PromptEnhancementPrepareResultV1;
    expect(validatePromptEnhancementPrepareResultV1(badWhy).reasonCodes).toContain('missing_ui_view_payload');
  });

  it('accepts a Phase 5 LLM-backed composer boundary when call policy is visible and matched', () => {
    const base = validResult();
    const result: PromptEnhancementPrepareResultV1 = {
      ...base,
      currentBody: {
        ...base.currentBody,
        llmCallPolicy: 'optional_with_cost_visibility',
        composerMode: 'baseline_llm_structured_wording',
      },
      composerBoundary: {
        ...base.composerBoundary,
        composerPolicy: 'optional_llm_with_visibility',
        llmCallPolicy: 'optional_with_cost_visibility',
        rawComposerOutput: 'llm_output_validated_into_artifact',
        composerMode: 'baseline_llm_structured_wording',
        budgetState: {
          llmCallPolicy: 'optional_with_cost_visibility',
          callVisibilityMode: 'llm_wording',
          productValueDiscussionIsRuntimeLimiter: false,
        },
        inputContract: {
          ...base.composerBoundary.inputContract,
          callVisibilityState: {
            ...callVisibility,
            callVisibilityMode: 'llm_wording',
            optionalCallAvailabilityState: 'allowed',
            provider: 'openai',
            model: 'provider_model_pending',
            inputTokenCap: 8000,
            outputTokenCap: 2000,
            estimatedInputTokens: 480,
            estimatedOutputTokens: 240,
            timeoutMs: 10_000,
            plannedCallCount: 1,
            usedCallCount: 1,
            providerAvailabilityState: 'available',
          },
        },
      },
      validationGraph: {
        ...base.validationGraph,
        providerRuntimeState: 'llm_wording',
        optionalCallAvailabilityState: 'allowed',
      },
      callAndVisibilityMetadata: {
        ...callVisibility,
        callVisibilityMode: 'llm_wording',
        optionalCallAvailabilityState: 'allowed',
        provider: 'openai',
        model: 'provider_model_pending',
        inputTokenCap: 8000,
        outputTokenCap: 2000,
        estimatedInputTokens: 480,
        estimatedOutputTokens: 240,
        timeoutMs: 10_000,
        plannedCallCount: 1,
        usedCallCount: 1,
        providerAvailabilityState: 'available',
      },
    };

    expect(validatePromptEnhancementPrepareResultV1(result)).toEqual({
      ok: true,
      reasonCodes: [],
    });
  });

  it('rejects mismatched graph and call visibility provider states', () => {
    const result: PromptEnhancementPrepareResultV1 = {
      ...validResult(),
      validationGraph: {
        ...validResult().validationGraph,
        providerRuntimeState: 'deterministic',
        optionalCallAvailabilityState: 'deterministic_only',
      },
      callAndVisibilityMetadata: {
        ...validResult().callAndVisibilityMetadata,
        callVisibilityMode: 'llm_wording',
        optionalCallAvailabilityState: 'allowed',
        provider: 'openai',
        model: 'provider_model_pending',
        inputTokenCap: 8000,
        outputTokenCap: 2000,
        estimatedInputTokens: 480,
        estimatedOutputTokens: 240,
        timeoutMs: 10_000,
        plannedCallCount: 1,
        usedCallCount: 1,
        providerAvailabilityState: 'available',
      },
      composerBoundary: {
        ...validResult().composerBoundary,
        inputContract: {
          ...validResult().composerBoundary.inputContract,
          callVisibilityState: {
            ...validResult().composerBoundary.inputContract.callVisibilityState,
            callVisibilityMode: 'llm_wording',
            optionalCallAvailabilityState: 'allowed',
            provider: 'openai',
            model: 'provider_model_pending',
            inputTokenCap: 8000,
            outputTokenCap: 2000,
            estimatedInputTokens: 480,
            estimatedOutputTokens: 240,
            timeoutMs: 10_000,
            plannedCallCount: 1,
            usedCallCount: 1,
            providerAvailabilityState: 'available',
          },
        },
      },
    };

    const validation = validatePromptEnhancementPrepareResultV1(result);

    expect(validation.ok).toBe(false);
    expect(validation.reasonCodes).toContain('mismatched_call_visibility_state');
  });

  it('rejects optional LLM call metadata missing provider model or timeout visibility', () => {
    const base = validResult();
    const result: PromptEnhancementPrepareResultV1 = {
      ...base,
      validationGraph: {
        ...base.validationGraph,
        providerRuntimeState: 'llm_wording',
        optionalCallAvailabilityState: 'allowed',
      },
      callAndVisibilityMetadata: {
        ...base.callAndVisibilityMetadata,
        callVisibilityMode: 'llm_wording',
        optionalCallAvailabilityState: 'allowed',
        plannedCallCount: 1,
        usedCallCount: 1,
        providerAvailabilityState: 'available',
        provider: undefined,
        model: undefined,
        timeoutMs: undefined,
      },
      composerBoundary: {
        ...base.composerBoundary,
        inputContract: {
          ...base.composerBoundary.inputContract,
          callVisibilityState: {
            ...base.composerBoundary.inputContract.callVisibilityState,
            callVisibilityMode: 'llm_wording',
            optionalCallAvailabilityState: 'allowed',
            plannedCallCount: 1,
            usedCallCount: 1,
            providerAvailabilityState: 'available',
            provider: undefined,
            model: undefined,
            timeoutMs: undefined,
          },
        },
      },
    };

    const validation = validatePromptEnhancementPrepareResultV1(result);

    expect(validation.ok).toBe(false);
    expect(validation.reasonCodes).toContain('missing_call_visibility_metadata');
    expect(validation.reasonCodes).toContain('missing_composer_boundary');
  });

  it('rejects optional LLM call metadata missing token visibility rows', () => {
    const base = validResult();
    const providerCallVisibility = {
      ...base.callAndVisibilityMetadata,
      callVisibilityMode: 'llm_wording' as const,
      optionalCallAvailabilityState: 'allowed' as const,
      plannedCallCount: 1,
      usedCallCount: 1,
      providerAvailabilityState: 'available' as const,
      provider: 'openai',
      model: 'provider_model_pending',
      timeoutMs: 10_000,
      inputTokenCap: undefined,
      outputTokenCap: undefined,
      estimatedInputTokens: undefined,
      estimatedOutputTokens: undefined,
    };
    const result: PromptEnhancementPrepareResultV1 = {
      ...base,
      validationGraph: {
        ...base.validationGraph,
        providerRuntimeState: 'llm_wording',
        optionalCallAvailabilityState: 'allowed',
      },
      callAndVisibilityMetadata: providerCallVisibility,
      composerBoundary: {
        ...base.composerBoundary,
        inputContract: {
          ...base.composerBoundary.inputContract,
          callVisibilityState: providerCallVisibility,
        },
      },
    };

    const validation = validatePromptEnhancementPrepareResultV1(result);

    expect(validation.ok).toBe(false);
    expect(validation.reasonCodes).toContain('missing_call_visibility_metadata');
    expect(validation.reasonCodes).toContain('missing_composer_boundary');
  });

  it('rejects call visibility metadata missing an explicit fallback reason', () => {
    const result: PromptEnhancementPrepareResultV1 = {
      ...validResult(),
      callAndVisibilityMetadata: {
        ...validResult().callAndVisibilityMetadata,
        fallbackReason: undefined,
      },
    };

    const validation = validatePromptEnhancementPrepareResultV1(result);

    expect(validation.ok).toBe(false);
    expect(validation.reasonCodes).toContain('missing_call_visibility_metadata');
  });

  it('requires action requests to carry edited body capture and real user action identity', () => {
    const actionRequest: PromptEnhancementActionRequestV1 = {
      ...validRequest(),
      action: validResult().availableActions[0],
      currentBodyBinding: {
        currentBodyId: 'body-1',
        bodyRevision: 1,
        validationDecisionId: 'validation-1',
        editedBodyText: 'Original request:\nFix the failing payment test and explain the verification.',
        actionSubmittedAtMs: 2,
        realUserInitiated: true,
        sectionSpanEditEvents: [
          {
            sectionId: 'section-original',
            spanRefId: 'span-original-1',
            editType: 'changed',
            mappingStatus: 'exact',
          },
        ],
      },
    };

    expect(actionRequest.currentBodyBinding.editedBodyText).toContain('Fix the failing payment test');
    expect(actionRequest.currentBodyBinding.realUserInitiated).toBe(true);
    expect(actionRequest.currentBodyBinding.sectionSpanEditEvents[0]?.mappingStatus).toBe('exact');
    expect(validatePromptEnhancementActionRequestV1(actionRequest)).toEqual({
      ok: true,
      reasonCodes: [],
    });
  });

  it('rejects action requests with missing edited text, stale body binding, or missing user initiation', () => {
    const actionRequest: PromptEnhancementActionRequestV1 = {
      ...validRequest(),
      action: validResult().availableActions[0],
      currentBodyBinding: {
        currentBodyId: 'body-1',
        bodyRevision: 1,
        validationDecisionId: 'validation-1',
        editedBodyText: 'Original request:\nFix the failing payment test and explain the verification.',
        actionSubmittedAtMs: 2,
        realUserInitiated: true,
        sectionSpanEditEvents: [],
      },
    };

    expect(validatePromptEnhancementActionRequestV1({
      ...actionRequest,
      currentBodyBinding: {
        ...actionRequest.currentBodyBinding,
        editedBodyText: '',
      },
    }).reasonCodes).toContain('missing_edited_body_text');

    expect(validatePromptEnhancementActionRequestV1({
      ...actionRequest,
      currentBodyBinding: {
        ...actionRequest.currentBodyBinding,
        bodyRevision: 0,
      },
    }).reasonCodes).toContain('stale_or_mismatched_action_body_binding');

    expect(validatePromptEnhancementActionRequestV1({
      ...actionRequest,
      currentBodyBinding: {
        ...actionRequest.currentBodyBinding,
        realUserInitiated: false,
      },
    }).reasonCodes).toContain('missing_real_user_initiation');
  });

  it('rejects old decision-session option-list payloads as PE API authority', () => {
    const legacyPayload = {
      schemaVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
      requestId: 'legacy',
      projectRoot: '/tmp/project',
      L1: ['option one'],
      L2: ['option two'],
      L3: ['option three'],
      SHOW_SIMPLER: true,
      selectedPrompt: 'Use this old option',
    };

    const validation = validatePromptEnhancementPrepareResultV1(legacyPayload);

    expect(validation.ok).toBe(false);
    expect(validation.reasonCodes).toContain('legacy_decision_session_payload');
    expect(findLegacyDecisionSessionKeys(legacyPayload)).toEqual(['L1', 'L2', 'L3', 'SHOW_SIMPLER', 'selectedPrompt']);
  });

  it('rejects opaque string-only enhancement output', () => {
    const validation = validatePromptEnhancementPrepareResultV1('Please fix the test');

    expect(validation.ok).toBe(false);
    expect(validation.reasonCodes).toContain('result_not_object');
    expect(validation.reasonCodes).toContain('missing_current_body');
  });

  it('rejects one-body results that omit section contract metadata', () => {
    const result = {
      ...validResult(),
      currentBody: {
        ...validResult().currentBody,
        sections: [
          {
            sectionId: 'section-incomplete',
            sectionKind: 'original_request',
            registryNamespace: 'prompt-enhancement-templates',
          },
        ],
      },
    };

    const validation = validatePromptEnhancementPrepareResultV1(result);

    expect(validation.ok).toBe(false);
    expect(validation.reasonCodes).toContain('incomplete_section_contract');
  });

  it('rejects missing generated-origin metadata even when current body text exists', () => {
    const result = { ...validResult() } as Record<string, unknown>;
    delete result['generatedOrigin'];

    const validation = validatePromptEnhancementPrepareResultV1(result);

    expect(validation.ok).toBe(false);
    expect(validation.reasonCodes).toContain('missing_generated_origin');
  });

  it('rejects empty generated bodies at the final render boundary', () => {
    const result = {
      ...validResult(),
      currentBody: {
        ...validResult().currentBody,
        text: '   ',
        renderedPromptBody: '   ',
      },
    };

    const validation = validatePromptEnhancementPrepareResultV1(result);

    expect(validation.ok).toBe(false);
    expect(validation.reasonCodes).toContain('missing_current_body');
  });

  it('rejects current bodies that lose the preserved original prompt text', () => {
    const result = {
      ...validResult(),
      currentBody: {
        ...validResult().currentBody,
        originalPromptText: '   ',
      },
    };

    const validation = validatePromptEnhancementPrepareResultV1(result);

    expect(validation.ok).toBe(false);
    expect(validation.reasonCodes).toContain('missing_current_body');
  });

  it('rejects prepare requests without source snapshots and call/privacy policy', () => {
    const request = {
      schemaVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
      requestId: 'pe-req-bad',
      projectRoot: '/tmp/project',
      sourcePrompt: { text: 'Fix it' },
      reviewMomentContext: {},
    };

    const validation = validatePromptEnhancementPrepareRequestV1(request);

    expect(validation.ok).toBe(false);
    expect(validation.reasonCodes).toContain('missing_source_signals');
    expect(validation.reasonCodes).toContain('missing_call_visibility_state');
    expect(validation.reasonCodes).toContain('missing_privacy_storage_policy');
  });

  it('rejects empty source prompts at request ingress instead of treating blank text as source A', () => {
    const request = {
      ...validRequest(),
      sourcePrompt: {
        ...validRequest().sourcePrompt,
        text: '   ',
      },
    };

    const validation = validatePromptEnhancementPrepareRequestV1(request);

    expect(validation.ok).toBe(false);
    expect(validation.reasonCodes).toContain('empty_source_prompt');
  });

  it('rejects raw source object payloads instead of bounded source refs', () => {
    const result = {
      ...validResult(),
      currentBody: {
        ...validResult().currentBody,
        sections: [
          {
            ...validResult().currentBody.sections[0],
            rawSourceObject: { privatePath: '/tmp/project/.claude/history.jsonl' },
          },
        ],
      },
    };

    const validation = validatePromptEnhancementPrepareResultV1(result);

    expect(validation.ok).toBe(false);
    expect(validation.reasonCodes).toContain('raw_source_object_payload');
    expect(findDisallowedRawContractKeys(result)).toEqual(['rawSourceObject']);
  });

  it('rejects sections missing Phase 5 canonical artifact metadata', () => {
    const result = {
      ...validResult(),
      currentBody: {
        ...validResult().currentBody,
        sections: [
          {
            ...validResult().currentBody.sections[0],
            title: undefined,
            bodyText: undefined,
            sourceFactIds: undefined,
            requiredSurvivor: undefined,
          },
        ],
      },
    };

    const validation = validatePromptEnhancementPrepareResultV1(result);

    expect(validation.ok).toBe(false);
    expect(validation.reasonCodes).toContain('incomplete_section_contract');
  });

  it('rejects multiple prompt variants as old option-list semantics', () => {
    const result = {
      ...validResult(),
      variants: [
        { label: 'L1', text: 'short' },
        { label: 'L2', text: 'long' },
      ],
    };

    const validation = validatePromptEnhancementPrepareResultV1(result);

    expect(validation.ok).toBe(false);
    expect(validation.reasonCodes).toContain('multiple_visible_variants');
    expect(findDisallowedVariantKeys(result)).toEqual(['variants']);
  });

  it('rejects unsafe current-body sendability mismatches', () => {
    const result = {
      ...validResult(),
      validationSummary: {
        ...safetySummary,
        sendPolicy: 'no_send',
      },
      safetySummary: {
        ...safetySummary,
        sendPolicy: 'no_send',
      },
    };

    const validation = validatePromptEnhancementPrepareResultV1(result);

    expect(validation.ok).toBe(false);
    expect(validation.reasonCodes).toContain('unsafe_send_policy_mismatch');
  });

  it('rejects stale safe current-body state when validation says no-send', () => {
    const result = {
      ...validResult(),
      disposition: 'blocked_no_send',
      currentBody: {
        ...validResult().currentBody,
        generatedSafeStatus: 'valid',
      },
      validationSummary: {
        ...validResult().validationSummary,
        validationStatus: 'invalid_non_sendable',
        sendPolicy: 'no_send',
      },
      safetySummary: {
        ...validResult().safetySummary,
        validationStatus: 'invalid_non_sendable',
        sendPolicy: 'no_send',
      },
      validationGraph: {
        ...validResult().validationGraph,
        safetyState: {
          ...validResult().validationGraph.safetyState,
          validationStatus: 'invalid_non_sendable',
          sendPolicy: 'no_send',
        },
      },
    };

    const validation = validatePromptEnhancementPrepareResultV1(result);

    expect(validation.ok).toBe(false);
    expect(validation.reasonCodes).toContain('mismatched_current_body_safety_state');
  });

  it('rejects stale invalid current-body state when validation says send-current', () => {
    const result = {
      ...validResult(),
      currentBody: {
        ...validResult().currentBody,
        generatedSafeStatus: 'invalid_non_sendable',
      },
    };

    const validation = validatePromptEnhancementPrepareResultV1(result);

    expect(validation.ok).toBe(false);
    expect(validation.reasonCodes).toContain('mismatched_current_body_safety_state');
  });

  it('rejects mismatched duplicated validation and safety send-policy summaries', () => {
    const result = {
      ...validResult(),
      validationSummary: {
        ...validResult().validationSummary,
        sendPolicy: 'send_current',
      },
      safetySummary: {
        ...validResult().safetySummary,
        sendPolicy: 'send_original',
      },
    };

    const validation = validatePromptEnhancementPrepareResultV1(result);

    expect(validation.ok).toBe(false);
    expect(validation.reasonCodes).toContain('mismatched_safety_summary');
  });

  it('rejects validation graph safety state that diverges from the public validation summary', () => {
    const result = {
      ...validResult(),
      validationGraph: {
        ...validResult().validationGraph,
        safetyState: {
          ...validResult().validationGraph.safetyState,
          privacyState: 'invalid_non_sendable',
        },
      },
    };

    const validation = validatePromptEnhancementPrepareResultV1(result);

    expect(validation.ok).toBe(false);
    expect(validation.reasonCodes).toContain('mismatched_safety_summary');
  });

  it('rejects validation graphs missing explicit request/pre-plan decomposition', () => {
    const result = {
      ...validResult(),
      validationGraph: {
        ...validResult().validationGraph,
        phaseStates: validResult().validationGraph.phaseStates.filter((phase) => phase.stage !== 'pre_plan'),
      },
    };

    const validation = validatePromptEnhancementPrepareResultV1(result);

    expect(validation.ok).toBe(false);
    expect(validation.reasonCodes).toContain('missing_validation_graph');
  });

  it('rejects validation graphs missing the typed safety state required by Phase 6', () => {
    const result = {
      ...validResult(),
      validationGraph: {
        ...validResult().validationGraph,
        safetyState: undefined,
      },
    };

    const validation = validatePromptEnhancementPrepareResultV1(result);

    expect(validation.ok).toBe(false);
    expect(validation.reasonCodes).toContain('missing_validation_graph');
  });

  it('rejects validation graphs missing provider and optional-call availability states', () => {
    const result = {
      ...validResult(),
      validationGraph: {
        ...validResult().validationGraph,
        providerRuntimeState: undefined,
        optionalCallAvailabilityState: undefined,
      },
    };

    const validation = validatePromptEnhancementPrepareResultV1(result);

    expect(validation.ok).toBe(false);
    expect(validation.reasonCodes).toContain('missing_validation_graph');
  });

  it('rejects validation graph failures that omit stable affected refs and bounded debug policy', () => {
    const result = {
      ...validResult(),
      validationGraph: {
        ...validResult().validationGraph,
        phaseStates: validResult().validationGraph.phaseStates.map((phase) => (
          phase.stage === 'final_body'
            ? { ...phase, status: 'invalid_non_sendable', failureCodes: ['voice_policy:third_person_agent_actor'] }
            : phase
        )),
        failures: [
          {
            failureCode: 'voice_policy:third_person_agent_actor',
            stage: 'final_body',
            severity: 'blocking',
            blocking: true,
            affectedSectionIds: ['section-1'],
            affectedBodySpanRefs: ['span-1'],
            affectedSourceRefIds: ['source-a-current-prompt'],
            publicSafeReasonCategory: 'validation_failed',
          },
        ],
      },
    };

    const validation = validatePromptEnhancementPrepareResultV1(result);

    expect(validation.ok).toBe(false);
    expect(validation.reasonCodes).toContain('missing_validation_graph');
  });

  it('rejects validation graph phase failure codes that do not match graph failures for the same stage', () => {
    const result = {
      ...validResult(),
      validationGraph: {
        ...validResult().validationGraph,
        phaseStates: validResult().validationGraph.phaseStates.map((phase) => (
          phase.stage === 'final_body'
            ? { ...phase, status: 'invalid_non_sendable', failureCodes: ['voice_policy:third_person_agent_actor'] }
            : phase
        )),
        failures: [
          {
            failureCode: 'voice_policy:third_person_agent_actor',
            stage: 'user_edit',
            severity: 'blocking',
            blocking: true,
            affectedSectionIds: ['section-1'],
            affectedBodySpanRefs: ['span-1'],
            affectedSourceRefIds: ['source-a-current-prompt'],
            affectedActionIds: ['body-1:action:use_current_body'],
            publicSafeReasonCategory: 'validation_failed',
            privateDebugDetailPolicy: 'bounded_local_only',
          },
        ],
      },
    };

    const validation = validatePromptEnhancementPrepareResultV1(result);

    expect(validation.ok).toBe(false);
    expect(validation.reasonCodes).toContain('missing_validation_graph');
  });

  it('rejects composer boundaries missing canonical artifact metadata', () => {
    const result = {
      ...validResult(),
      composerBoundary: {
        ...validResult().composerBoundary,
        composerRunId: undefined,
        composerMode: undefined,
        validatedCanonicalPromptArtifact: undefined,
      },
    };

    const validation = validatePromptEnhancementPrepareResultV1(result);

    expect(validation.ok).toBe(false);
    expect(validation.reasonCodes).toContain('missing_composer_boundary');
  });

  it('rejects current bodies missing Phase 5 route/origin/linkage artifact metadata', () => {
    const result = {
      ...validResult(),
      currentBody: {
        ...validResult().currentBody,
        routeDecisionId: undefined,
        promptReviewOrigin: undefined,
        sentPromptOrigin: undefined,
        nexpathGeneratedPromptRef: undefined,
        renderedPromptBody: 'different body text',
        originalPromptSectionId: undefined,
        sourceAttribution: undefined,
        llmCallPolicy: undefined,
      },
    };

    const validation = validatePromptEnhancementPrepareResultV1(result);

    expect(validation.ok).toBe(false);
    expect(validation.reasonCodes).toContain('missing_current_body');
  });

  it('rejects composer boundaries missing language and composer-visible context metadata', () => {
    const result = {
      ...validResult(),
      composerBoundary: {
        ...validResult().composerBoundary,
        effectiveLanguageState: undefined,
        languageSource: undefined,
        composerVisiblePromptContext: undefined,
      },
    };

    const validation = validatePromptEnhancementPrepareResultV1(result);

    expect(validation.ok).toBe(false);
    expect(validation.reasonCodes).toContain('missing_composer_boundary');
  });

  it('rejects generated-origin rows that feed ordinary prompt learning', () => {
    const result = {
      ...validResult(),
      generatedOrigin: {
        ...validResult().generatedOrigin,
        learningEligibility: {
          ...validResult().generatedOrigin.learningEligibility,
          promptHistory: true,
        },
      },
    };

    const validation = validatePromptEnhancementPrepareResultV1(result);

    expect(validation.ok).toBe(false);
    expect(validation.reasonCodes).toContain('unsafe_generated_origin_learning');
  });

  it('rejects text-only transport as PE semantic authority', () => {
    const result = {
      ...validResult(),
      delivery: {
        ...validResult().delivery,
        rawTransportIsSemanticAuthority: true,
      },
    };

    const validation = validatePromptEnhancementPrepareResultV1(result);

    expect(validation.ok).toBe(false);
    expect(validation.reasonCodes).toContain('raw_transport_semantic_authority');
  });

  it('rejects string diagnostics because diagnostics must be public-safe typed records', () => {
    const result = {
      ...validResult(),
      diagnostics: ['transform-rule-10 raw internal reason'],
    };

    const validation = validatePromptEnhancementPrepareResultV1(result);

    expect(validation.ok).toBe(false);
    expect(validation.reasonCodes).toContain('unsafe_public_diagnostics');
  });

  it('rejects typed-looking diagnostics that still carry raw transport or selected prompt text', () => {
    const result = {
      ...validResult(),
      diagnostics: [
        {
          ...validResult().diagnostics[0],
          rawStdout: '{"decision":"block","reason":"Fix the private production prompt"}',
          selectedPrompt: 'Fix the private production prompt',
        },
      ],
    };

    const validation = validatePromptEnhancementPrepareResultV1(result);

    expect(validation.ok).toBe(false);
    expect(validation.reasonCodes).toContain('unsafe_public_diagnostics');
  });

  it('rejects typed-looking diagnostics that include nested raw error objects or causes', () => {
    const result = {
      ...validResult(),
      diagnostics: [
        {
          ...validResult().diagnostics[0],
          cause: {
            errorMessage: 'failed while handling /home/alice/client-x/prod.env',
            stack: 'Error: prompt preview sk-live-example12345',
          },
        },
      ],
    };

    const validation = validatePromptEnhancementPrepareResultV1(result);

    expect(validation.ok).toBe(false);
    expect(validation.reasonCodes).toContain('unsafe_public_diagnostics');
  });

  it('rejects diagnostics that leak through generic or snake-case raw fields', () => {
    const result = {
      ...validResult(),
      diagnostics: [
        {
          ...validResult().diagnostics[0],
          message: 'prompt preview sk-live-example12345',
          raw_stdout: '{"selected_prompt":"Deploy from /home/alice/client-x/prod.env"}',
          nested: {
            selected_prompt: 'Deploy from /home/alice/client-x/prod.env',
          },
        },
      ],
    };

    const validation = validatePromptEnhancementPrepareResultV1(result);

    expect(validation.ok).toBe(false);
    expect(validation.reasonCodes).toContain('unsafe_public_diagnostics');
  });

  it('rejects public diagnostic string values that leak secrets, private paths, or research labels', () => {
    const result = {
      ...validResult(),
      diagnostics: [
        {
          ...validResult().diagnostics[0],
          publicSafeText: 'transform-rule-9 failed while handling /home/alice/client-x/prod.env with sk-live-example12345',
        },
      ],
    };

    const validation = validatePromptEnhancementPrepareResultV1(result);

    expect(validation.ok).toBe(false);
    expect(validation.reasonCodes).toContain('unsafe_public_diagnostics');
  });

  it('rejects public diagnostic reason codes that carry raw reason values or selected prompt text', () => {
    const result = {
      ...validResult(),
      diagnostics: [
        {
          ...validResult().diagnostics[0],
          publicSafeText: 'Enhancement unavailable.',
          reasonCode: 'raw generated body selected prompt leaked',
        },
      ],
    };

    const validation = validatePromptEnhancementPrepareResultV1(result);

    expect(validation.ok).toBe(false);
    expect(validation.reasonCodes).toContain('unsafe_public_diagnostics');
  });

  it('rejects public diagnostics that expose development-phase planning labels', () => {
    const result = {
      ...validResult(),
      diagnostics: [
        {
          ...validResult().diagnostics[0],
          publicSafeText: 'phase12_provider_model_pending',
        },
      ],
    };

    const validation = validatePromptEnhancementPrepareResultV1(result);

    expect(validation.ok).toBe(false);
    expect(validation.reasonCodes).toContain('unsafe_public_diagnostics');
  });

  it('rejects public diagnostics that expose underscore-form research labels', () => {
    const result = {
      ...validResult(),
      diagnostics: [
        {
          ...validResult().diagnostics[0],
          // A research-label-shaped token, decoded from base64 so this test source stays leak-free
          // (S2 discipline). The runtime guard's underscore-form regex must still REJECT it.
          publicSafeText: `blocked_pending_${Buffer.from('cGVfZHIz', 'base64').toString('utf8')}_runtime_gate`,
        },
      ],
    };

    const validation = validatePromptEnhancementPrepareResultV1(result);

    expect(validation.ok).toBe(false);
    expect(validation.reasonCodes).toContain('unsafe_public_diagnostics');
  });

  it('rejects handoff metadata that loses source lineage required for receiver revalidation', () => {
    const result = {
      ...validResult(),
      handoffMetadata: {
        ...validResult().handoffMetadata,
        sourceLineageRefs: [],
      },
    };

    const validation = validatePromptEnhancementPrepareResultV1(result);

    expect(validation.ok).toBe(false);
    expect(validation.reasonCodes).toContain('unsafe_handoff_metadata');
  });

  it('rejects handoff metadata that drops handoff or launch receiver validation requirements', () => {
    const result = {
      ...validResult(),
      handoffMetadata: {
        ...validResult().handoffMetadata,
        receiverValidationRequirements: ['handoff'],
      },
    };

    const validation = validatePromptEnhancementPrepareResultV1(result);

    expect(validation.ok).toBe(false);
    expect(validation.reasonCodes).toContain('unsafe_handoff_metadata');
  });

  it('rejects handoff metadata that turns v1 metadata into accepted runtime activation', () => {
    const result = {
      ...validResult(),
      handoffMetadata: {
        ...validResult().handoffMetadata,
        activationState: 'blocked_pending_gates',
        userHandoffConsentState: 'explicitly_accepted_approved_runtime',
      },
    };

    const validation = validatePromptEnhancementPrepareResultV1(result);

    expect(validation.ok).toBe(false);
    expect(validation.reasonCodes).toContain('unsafe_handoff_metadata');
  });

  it('rejects handoff metadata that loses the current validation confirmation state', () => {
    const result = {
      ...validResult(),
      validationSummary: {
        ...validResult().validationSummary,
        sensitiveActionState: 'confirmation_required_present',
      },
      handoffMetadata: {
        ...validResult().handoffMetadata,
        riskConfirmationState: 'none',
      },
    };

    const validation = validatePromptEnhancementPrepareResultV1(result);

    expect(validation.ok).toBe(false);
    expect(validation.reasonCodes).toContain('unsafe_handoff_metadata');
  });

  it('rejects missing route/body/composer contracts that would allow text-only composer authority', () => {
    const result = {
      ...validResult(),
      composerBoundary: {
        ...validResult().composerBoundary,
        outputContract: {
          ...validResult().composerBoundary.outputContract,
          textOnlyOutputAllowed: true,
        },
      },
    };

    const validation = validatePromptEnhancementPrepareResultV1(result);

    expect(validation.ok).toBe(false);
    expect(validation.reasonCodes).toContain('missing_composer_boundary');
  });
});
