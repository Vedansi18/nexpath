import { describe, expect, it } from 'vitest';
import type {
  PromptEnhancementCurrentBodyV1,
  PromptEnhancementHandoffMetadataV1,
  PromptEnhancementSafetySummaryV1,
} from './contracts.js';
import {
  buildPromptEnhancementHandoffMetadataV1,
  validatePromptEnhancementHandoffMetadataV1,
} from './handoff-metadata.js';

const safetySummary: PromptEnhancementSafetySummaryV1 = {
  validationStatus: 'valid',
  sendPolicy: 'send_current',
  sensitiveActionState: 'none',
  sourceHonestyState: 'valid',
  privacyState: 'valid',
  authorityEscalationState: 'valid',
  noForegroundSafer: true,
  noAutomaticSend: true,
};

function currentBody(overrides: Partial<PromptEnhancementCurrentBodyV1> = {}): PromptEnhancementCurrentBodyV1 {
  return {
    currentBodyId: 'body-1',
    bodyRevision: 1,
    composerRunId: 'composer-1',
    routeDecisionId: 'route-1',
    promptReviewOrigin: 'user_authored_current_prompt',
    promptReviewProcessingPolicy: 'eligible_for_initial_pe_route',
    sentPromptOrigin: 'pe_baseline_generated_body',
    nexpathGeneratedPromptRef: 'generated:body-1',
    renderedPromptBody: 'Original request:\nBuild the import repair.\n\nPlan:\nFix and verify it.',
    originalPromptSectionId: 'section-original',
    sourceAttribution: [{
      sourceRefId: 'source-a:prompt',
      sourceId: 'prompt:current',
      sourceKind: 'source_a_user_prompt',
      evidenceStatus: 'present',
      publicSafeLabel: 'Original request',
      privateIdPolicy: 'metadata_only_not_body',
    }],
    llmCallPolicy: 'no_call',
    composerMode: 'baseline_deterministic_render',
    languagePolicyApplied: 'preserve_user_language',
    languageValidationStatus: 'valid',
    effectiveLanguageState: 'known',
    languageSource: 'detected_from_prompt',
    languageConfidence: 'high',
    languagePolicy: 'preserve_user_language',
    instructionPrecedenceState: 'generated_sections_qualify_original',
    originalAsSourceStatus: 'local_verbatim_source_context',
    composerClaims: ['deterministic'],
    sourceFactIds: ['source-a:prompt'],
    localOriginalPromptIncluded: true,
    text: 'Original request:\nBuild the import repair.\n\nPlan:\nFix and verify it.',
    originalPromptText: 'Build the import repair.',
    originalPromptPreservation: 'visible_verbatim',
    generatedOriginState: 'pe_generated_body',
    generatedSafeStatus: 'valid',
    userDirtyState: 'clean',
    sections: [{
      sectionId: 'section-original',
      sectionKind: 'original_request',
      title: 'Original request',
      bodyText: 'Build the import repair.',
      templateType: 'implementation',
      familyId: 'feature_implementation',
      primaryIntent: 'fresh_implementation',
      registryNamespace: 'prompt-enhancement-templates',
      sourceTemplateType: 'prompt_enhancement_template',
      sourceKind: 'source_a_user_prompt',
      sourceIds: ['prompt:current'],
      sourceFactIds: ['source-a:prompt'],
      routeCandidateRefs: ['route:feature'],
      evidenceStatus: 'present',
      sourceEvidenceStatus: 'present',
      slotEvidenceStatus: 'present',
      baselineSourceSignalSlot: 'implementation_plan',
      requirementSourceStatus: 'present',
      requiredSurvivor: true,
      mandatoryFloor: true,
      depthState: 'required_survivor',
      axisContributions: ['source_a'],
      canMergeInShorter: false,
      canExpandInMoreThorough: true,
      canGroundInMoreProjectGrounded: true,
      feedbackSensitivity: 'protected',
      fallbackBehavior: 'none',
      handoffFlags: ['metadata_only_no_sequence_runtime'],
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
      spanRefs: [],
      publicExplanationCategory: 'source_coverage',
      whyHelpReasonCodes: ['source-a:prompt'],
      callVisibilityMode: 'deterministic',
      contentTemplateRuntimeSeamUse: 'none',
      handoffCapabilityFlags: ['metadata_only_no_sequence_runtime'],
    }],
    ...overrides,
  };
}

function metadata(overrides: Partial<PromptEnhancementHandoffMetadataV1> = {}): PromptEnhancementHandoffMetadataV1 {
  return {
    ...buildPromptEnhancementHandoffMetadataV1({
      handoffDecisionId: 'handoff-1',
      requestId: 'request-1',
      projectRoot: '/repo',
      currentBody: currentBody(),
      safetySummary,
      levelDepthState: 'default',
      hostCapabilityState: 'stop_bridge_only',
      sourceScopeRefs: ['project:/repo'],
      handoffKind: 'compact_sequence_summary_candidate',
      summary: {
        summaryId: 'handoff-summary-1',
        publicSafeText: 'One follow-up task is summarized as metadata only.',
        remainingTaskCount: 1,
        taskRoleLabels: ['verification'],
      },
      sourceImpact: {
        contentTemplateSourceRefs: ['content-template:implementation'],
        recordSignalTypes: ['IMPLEMENTATION_PLAN'],
        recordSourceTiers: ['shipped'],
        recordSchemaVersions: ['1'],
        recordQuestionRefs: ['content-template:question:implementation'],
        recordPinchFallbackRefs: ['content-template:pinch:implementation'],
        recordRegisterSnapshotRefs: ['content-template:register:default'],
        recordRoleSnapshotRefs: ['content-template:role:developer'],
        recordMaturityLevelSnapshotRefs: ['content-template:maturity:standard'],
        recordSnapshotRefs: ['record:snapshot:1'],
        recordComposePathRefs: ['compose:deterministic'],
        sourceCascadeOutcomeRefs: ['content-template:cascade:shipped'],
      },
    }),
    ...overrides,
  };
}

describe('Phase 10 multi-prompt handoff metadata', () => {
  it('builds compact first-popup metadata without creating sequence runtime state', () => {
    const result = metadata();

    expect(result.compactFirstPopupSequenceSummary).toMatchObject({
      currentBodyId: 'body-1',
      bodyRevision: 1,
      containsFuturePromptText: false,
      bodyBoundMetadataOnly: true,
    });
    expect(result.runtimeGuards).toMatchObject({
      createsRuntimeQueue: false,
      permitsContinuation: false,
      autoSendPolicy: 'prohibited',
      pointerAdvancementPolicy: 'prohibited',
    });
    expect(result.suggestedNextPromptRefs).toEqual([]);
  });

  it('carries source-backed point inventory, decomposition, task slices, and applicability refs', () => {
    const result = metadata();

    expect(result.pointInventory.map((point) => point.sourcePointRef)).toContain('source-a:prompt');
    expect(result.decompositionGroups[0]).toMatchObject({
      groupingReason: 'single_current_body_group',
      splitRequirementState: 'candidate_metadata_only',
    });
    expect(result.taskSlices[0]).toMatchObject({
      sequenceRole: 'future_candidate_metadata_only',
      futurePromptCandidateState: 'candidate_metadata_only',
      handoffEligibilityState: 'eligible_metadata_only',
    });
    expect(result.applicability).toMatchObject({
      state: 'metadata_only_candidate',
      decompositionGroupRefs: ['handoff-group:body-1:1'],
      intentFamily: 'feature_implementation',
      intentCategory: 'fresh_implementation',
      levelDepthState: 'default',
      explicitUserRuntimeState: 'not_started_v1',
      targetScopeRefs: ['project:/repo'],
      itemOrderingMode: 'no_runtime_order',
      outputFormatPolicy: 'metadata_only_no_runtime',
      completionEvidenceRequirementState: 'not_runtime_proof_v1',
      acceptanceVerificationPolicy: 'user_owned_not_runtime_v1',
      partialItemConsentState: 'deferred_out_of_v1',
      parallelExecutionPolicy: 'not_supported_v1',
      receiverCanActivateRuntime: false,
    });
  });

  it('carries PE-AR-11.2 addendum applicability states without runtime authority', () => {
    const result = metadata();

    expect(result.applicability).toMatchObject({
      sourcePriorityState: 'no_priority_claim_v1',
      workspaceBindingState: 'current_workspace_only',
      scopeBindingDisposition: 'bound_to_current_project',
      outputFormatPolicy: 'metadata_only_no_runtime',
      completionEvidenceRequirementState: 'not_runtime_proof_v1',
      successConditionState: 'not_runtime_evaluated_v1',
      definitionOfDoneState: 'not_runtime_evaluated_v1',
      acceptanceVerificationPolicy: 'user_owned_not_runtime_v1',
      acceptanceFailureDisposition: 'current_or_original_fallback_no_runtime',
      atomicGroupId: 'none',
      partialCompletionPolicy: 'no_runtime_partial_completion_v1',
      rollbackCouplingState: 'not_runtime_v1',
      conflictResolutionPolicy: 'current_body_or_no_runtime',
      conflictVisibilityPolicy: 'public_safe_reason_codes_only',
      onePromptOnlyConstraintState: 'none',
      sequenceSuppressionSourceState: 'none',
      noSplitOverrideDisposition: 'not_allowed_v1',
      partialItemConsentState: 'deferred_out_of_v1',
      userInputRequirementState: 'not_required',
      answerDependencyState: 'none',
      agentPermissionModeSnapshot: 'unknown',
      capabilityMismatchDisposition: 'current_or_original_fallback_no_runtime',
      manualExecutionRequiredState: 'not_evaluated_v1_metadata_only',
      independentItemState: 'not_parallelized_v1',
      unorderedGroupId: 'none',
      serializationDisposition: 'metadata_only_no_runtime_order',
      userOrderPreferenceState: 'not_specified',
      parallelExecutionPolicy: 'not_supported_v1',
      receiverCanActivateRuntime: false,
    });
    expect(result.applicability.deliverableContractRefs).toEqual([]);
    expect(result.applicability.toolAccessRequirementRefs).toEqual([]);
  });

  it('binds handoff metadata to request and project scope for stale or cross-project rejection', () => {
    const result = metadata();

    expect(result.scope).toEqual({
      requestId: 'request-1',
      projectRoot: '/repo',
      projectScopeState: 'current_project_only',
      sourceScopeRefs: ['project:/repo'],
      crossProjectApplicationPolicy: 'reject',
      staleResponsePolicy: 'ignore_no_overwrite',
    });
  });

  it('keeps content-template source impact as provenance only', () => {
    const result = metadata();

    expect(result.sourceImpact).toMatchObject({
      contentTemplateSourceRefs: ['content-template:implementation'],
      recordSignalTypes: ['IMPLEMENTATION_PLAN'],
      recordQuestionRefs: ['content-template:question:implementation'],
      recordPinchFallbackRefs: ['content-template:pinch:implementation'],
      recordRegisterSnapshotRefs: ['content-template:register:default'],
      recordRoleSnapshotRefs: ['content-template:role:developer'],
      recordMaturityLevelSnapshotRefs: ['content-template:maturity:standard'],
      sourceCascadeOutcomeRefs: ['content-template:cascade:shipped'],
      whyDescDeliveryDisposition: 'not_source_truth_not_future_prompt_text',
      feedbackPreemptionDisposition: 'not_pe_exposure_or_handoff_acceptance',
      transportEvidenceDisposition: 'delivery_attempt_only_not_semantic_authority',
      stageClassifierDegradedDisposition: 'cannot_create_handoff_candidate',
    });
  });

  it('passes independent handoff validation for v1-safe metadata', () => {
    expect(validatePromptEnhancementHandoffMetadataV1(metadata(), currentBody(), safetySummary, {
      requestId: 'request-1',
      projectRoot: '/repo',
    })).toEqual({
      ok: true,
      reasonCodes: [],
    });
  });

  it('rejects metadata for a different request or project scope', () => {
    const result = validatePromptEnhancementHandoffMetadataV1(metadata(), currentBody(), safetySummary, {
      requestId: 'request-2',
      projectRoot: '/other-repo',
    });

    expect(result.ok).toBe(false);
    expect(result.reasonCodes).toContain('handoff_scope_unsafe');
  });

  it('rejects applicability metadata that drops PE-AR-11.2 target and ordering state', () => {
    const result = validatePromptEnhancementHandoffMetadataV1({
      ...metadata(),
      applicability: {
        ...metadata().applicability,
        targetScopeRefs: [],
        itemOrderingMode: 'source_backed_metadata_order_only',
      },
    }, currentBody(), safetySummary, { requestId: 'request-1', projectRoot: '/repo' });

    expect(result.ok).toBe(false);
    expect(result.reasonCodes).toContain('applicability_state_mismatch');
  });

  it('rejects applicability metadata that drops PE-AR-11.2 addendum states', () => {
    const result = validatePromptEnhancementHandoffMetadataV1({
      ...metadata(),
      applicability: {
        ...metadata().applicability,
        outputFormatPolicy: undefined as unknown as 'metadata_only_no_runtime',
        partialItemConsentState: 'accepted_runtime_item' as unknown as 'deferred_out_of_v1',
        parallelExecutionPolicy: 'parallel_runtime' as unknown as 'not_supported_v1',
      },
    }, currentBody(), safetySummary, { requestId: 'request-1', projectRoot: '/repo' });

    expect(result.ok).toBe(false);
    expect(result.reasonCodes).toContain('applicability_state_mismatch');
  });

  it('rejects incomplete content-template source-impact provenance', () => {
    const result = validatePromptEnhancementHandoffMetadataV1({
      ...metadata(),
      sourceImpact: {
        ...metadata().sourceImpact,
        recordQuestionRefs: undefined as unknown as readonly string[],
      },
    }, currentBody(), safetySummary, { requestId: 'request-1', projectRoot: '/repo' });

    expect(result.ok).toBe(false);
    expect(result.reasonCodes).toContain('source_impact_incomplete');
  });

  it('rejects runtime queue creation', () => {
    const result = validatePromptEnhancementHandoffMetadataV1({
      ...metadata(),
      runtimeGuards: {
        ...metadata().runtimeGuards,
        createsRuntimeQueue: true,
      },
    } as PromptEnhancementHandoffMetadataV1, currentBody(), safetySummary);

    expect(result.ok).toBe(false);
    expect(result.reasonCodes).toContain('runtime_guards_unsafe');
  });

  it('rejects continuation or auto-send fields even when they are injected outside the typed contract', () => {
    const unsafe = {
      ...metadata(),
      continuationState: 'continue_next',
      autoSend: true,
    } as unknown as PromptEnhancementHandoffMetadataV1;

    const result = validatePromptEnhancementHandoffMetadataV1(unsafe, currentBody(), safetySummary);

    expect(result.ok).toBe(false);
    expect(result.reasonCodes).toContain('runtime_or_future_prompt_body_field_present');
  });

  it('rejects future prompt body refs and hidden future prompt text', () => {
    const unsafe = {
      ...metadata(),
      suggestedNextPromptRefs: ['future-prompt:1'],
      futurePromptBodies: ['Write the next implementation prompt.'],
    } as unknown as PromptEnhancementHandoffMetadataV1;

    const result = validatePromptEnhancementHandoffMetadataV1(unsafe, currentBody(), safetySummary);

    expect(result.ok).toBe(false);
    expect(result.reasonCodes).toEqual(expect.arrayContaining([
      'future_prompt_refs_present',
      'runtime_or_future_prompt_body_field_present',
    ]));
  });

  it('rejects compact summaries that claim future prompt text', () => {
    const result = validatePromptEnhancementHandoffMetadataV1({
      ...metadata(),
      compactFirstPopupSequenceSummary: {
        ...metadata().compactFirstPopupSequenceSummary!,
        containsFuturePromptText: true,
      },
    } as PromptEnhancementHandoffMetadataV1, currentBody(), safetySummary);

    expect(result.ok).toBe(false);
    expect(result.reasonCodes).toContain('unsafe_compact_summary');
  });

  it('rejects metadata without launch-boundary receiver revalidation', () => {
    const result = validatePromptEnhancementHandoffMetadataV1({
      ...metadata(),
      receiverValidationRequirements: ['handoff'],
    }, currentBody(), safetySummary);

    expect(result.ok).toBe(false);
    expect(result.reasonCodes).toContain('missing_receiver_validation_launch_check');
  });

  it('rejects stale body revisions and accepted runtime consent', () => {
    const result = validatePromptEnhancementHandoffMetadataV1({
      ...metadata(),
      bodyRevision: 2,
      userHandoffConsentState: 'explicitly_accepted_approved_runtime',
    }, currentBody(), safetySummary);

    expect(result.ok).toBe(false);
    expect(result.reasonCodes).toEqual(expect.arrayContaining([
      'body_revision_mismatch',
      'runtime_consent_not_v1_safe',
    ]));
  });
});
