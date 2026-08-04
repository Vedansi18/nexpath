import { describe, expect, it } from 'vitest';
import {
  PROMPT_ENHANCEMENT_CONTRACT_VERSION,
  type PromptEnhancementCurrentBodyV1,
  type PromptEnhancementFutureSequenceRuntimeOperationV1,
  type PromptEnhancementHandoffMetadataV1,
  type PromptEnhancementSafetySummaryV1,
} from './contracts.js';
import {
  assertPromptEnhancementFutureSequenceRuntimeBlockedV1,
  evaluatePromptEnhancementFutureSequenceRuntimeGateV1,
  PROMPT_ENHANCEMENT_FUTURE_SEQUENCE_RUNTIME_REQUIRED_GATES_V1,
} from './future-sequence-runtime-gate.js';
import { buildPromptEnhancementHandoffMetadataV1 } from './handoff-metadata.js';

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

function currentBody(): PromptEnhancementCurrentBodyV1 {
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
      handoffKind: 'compact_sequence_summary_candidate',
      sourceScopeRefs: ['project:/repo'],
      summary: {
        summaryId: 'summary-1',
        publicSafeText: 'One follow-up task is summarized as metadata only.',
        remainingTaskCount: 1,
        taskRoleLabels: ['verification'],
      },
    }),
    ...overrides,
  };
}

function evaluate(operation: PromptEnhancementFutureSequenceRuntimeOperationV1, input = {}) {
  return evaluatePromptEnhancementFutureSequenceRuntimeGateV1({
    schemaVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
    operation,
    requestId: 'request-1',
    projectRoot: '/repo',
    handoffMetadata: metadata(),
    configSnapshot: {
      sequenceEnabled: 'on',
      arbitraryConfigRowsAreAuthority: false,
    },
    rawContentPresence: {},
    ...input,
  });
}

describe('Phase 11 future sequence runtime gate', () => {
  it('PE-AR-11.1 blocks sequence identity and state creation in current v1', () => {
    const result = evaluate('create_sequence_state');

    expect(assertPromptEnhancementFutureSequenceRuntimeBlockedV1(result)).toBe(true);
    expect(result.reasonCodes).toContain('pe_ar11_1_sequence_identity_state_no_go');
    expect(result.missingGateCodes).toEqual(PROMPT_ENHANCEMENT_FUTURE_SEQUENCE_RUNTIME_REQUIRED_GATES_V1);
    expect(result.sequenceIdentityState).toBe('not_created_v1');
    expect(result.terminalReopenState).toBe('rejected_v1');
  });

  it('PE-AR-11.2 rejects accepted handoff start/order even with v1-safe metadata', () => {
    const result = evaluate('accept_handoff_start_order', {
      event: {
        requestId: 'request-1',
        projectScope: '/repo',
        contractVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
        explicitUserActionState: 'present_future_only',
        hostCapabilityState: 'future_hold_proven',
        stateFreshness: 'current',
      },
    });

    expect(result.allowed).toBe(false);
    expect(result.acceptedStartOrderState).toBe('not_created_v1');
    expect(result.queueState).toBe('not_created_v1');
    expect(result.handoffRuntimeAuthorityState).toBe('metadata_only_no_runtime');
    expect(result.reasonCodes).toEqual(expect.arrayContaining([
      'pe_ar11_2_handoff_start_order_no_go',
      'handoff_metadata_is_metadata_only_no_runtime',
      'runtime_event_created_at_missing',
      'runtime_event_idempotency_key_missing',
    ]));
  });

  it.each([
    ['continue_current_item', 'pe_ar11_3_continuation_no_go'],
    ['custom_prompt_path', 'pe_ar11_3_custom_prompt_path_no_go'],
    ['cancel_active_sequence', 'pe_ar11_3_cancel_no_go'],
    ['abandon_active_sequence', 'pe_ar11_3_abandon_no_go'],
    ['resume_active_sequence', 'pe_ar11_3_resume_no_go'],
  ] as const)('PE-AR-11.3 blocks %s without mutation or follow-up', (operation, reasonCode) => {
    const result = evaluate(operation, {
      event: {
        sequenceId: 'seq-1',
        sequenceItemId: 'item-1',
        requestId: 'request-1',
        projectScope: '/repo',
        contractVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
        explicitUserActionState: 'absent',
        stateFreshness: 'stale',
      },
    });

    expect(result.reasonCodes).toEqual(expect.arrayContaining([
      reasonCode,
      'explicit_user_action_absent',
      'runtime_event_stale_noop',
    ]));
    expect(result.continuationState).toBe('not_created_v1');
    expect(result.cancelAbandonResumeState).toBe('not_created_v1');
    expect(result.autoSendState).toBe('prohibited_v1');
    expect(result.pointerAdvancementState).toBe('prohibited_v1');
  });

  it('PE-AR-11.4 treats Stop and response-finished signals as non-proof', () => {
    const result = evaluate('response_finished_stop_completion', {
      event: {
        requestId: 'request-1',
        projectScope: '/repo',
        contractVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
        explicitUserActionState: 'absent',
        stopEventState: 'stop_fired_non_proof',
        stateFreshness: 'duplicate',
      },
      legacyAuthoritySignals: {
        shownState: 'shown',
        stopReason: 'block',
        telemetryEventLabel: 'stop_advisory_shown',
        lastInjectedPromptRef: 'last-injected',
      },
    });

    expect(result.stopCompletionState).toBe('not_proof_v1');
    expect(result.stopOrResponseEventAuthorityState).toBe('non_proof_no_runtime');
    expect(result.reasonCodes).toEqual(expect.arrayContaining([
      'pe_ar11_4_stop_completion_non_proof',
      'stop_or_response_finished_is_non_proof',
      'runtime_event_duplicate_noop',
      'legacy_ds_hook_ui_transport_authority_rejected',
    ]));
  });

  it('PE-AR-11.5 rejects runtime acceptance even when caller claims all gates passed', () => {
    const result = evaluate('runtime_acceptance', {
      evidence: {
        peDr4LifecyclePolicyApproved: true,
        peAr10ReceiverContractApproved: true,
        peAr11RuntimeSourceAvailable: true,
        peEm1NumericAcceptanceApproved: true,
        peDr6OwnerSnapshotApproved: true,
        signedOwnerByDeliverableRegisterApproved: true,
        pendingNamedOwnerRegisterRowsClosed: true,
        hostHoldCommitContractProven: true,
        providerApiAvailabilityProven: true,
        privacyStoragePolicyApproved: true,
        focusedRuntimeFixturesPassed: true,
      },
    });

    expect(result.allowed).toBe(false);
    expect(result.runtimeAcceptanceState).toBe('no_go_v1');
    expect(result.missingGateCodes).toEqual(['current_v1_runtime_implementation_no_go']);
    expect(result.reasonCodes).toContain('pe_ar11_5_runtime_acceptance_no_go');
  });

  it('keeps PE-DR-6 owner registers and provider/API availability as required runtime gates', () => {
    const result = evaluate('runtime_acceptance', {
      evidence: {
        peDr4LifecyclePolicyApproved: true,
        peAr10ReceiverContractApproved: true,
        peAr11RuntimeSourceAvailable: true,
        peEm1NumericAcceptanceApproved: true,
        peDr6OwnerSnapshotApproved: true,
        hostHoldCommitContractProven: true,
        privacyStoragePolicyApproved: true,
        focusedRuntimeFixturesPassed: true,
      },
    });

    expect(result.allowed).toBe(false);
    expect(result.missingGateCodes).toEqual(expect.arrayContaining([
      'signed_owner_by_deliverable_register_pending',
      'pending_named_owner_register_rows_pending',
      'provider_api_availability_pending',
      'current_v1_runtime_implementation_no_go',
    ]));
  });

  it('rejects handoff metadata that claims accepted runtime consent or queue authority', () => {
    const unsafe = metadata({
      userHandoffConsentState: 'explicitly_accepted_approved_runtime',
      runtimeGuards: {
        ...metadata().runtimeGuards,
        createsRuntimeQueue: true,
      },
    } as PromptEnhancementHandoffMetadataV1);

    const result = evaluate('accept_handoff_start_order', { handoffMetadata: unsafe });

    expect(result.handoffRuntimeAuthorityState).toBe('unsafe_handoff_rejected_no_runtime');
    expect(result.reasonCodes).toContain('unsafe_handoff_metadata_rejected');
    expect(result.queueState).toBe('not_created_v1');
  });

  it('rejects legacy DS, UI label, config row, and transport ids as authority', () => {
    const result = evaluate('create_sequence_state', {
      legacyAuthoritySignals: {
        pendingAdvisoryId: '42',
        skippedSessionId: 'skip-1',
        sessionId: 'ds-session-1',
        promptCount: 3,
        configRowKey: 'ctrl_t.frequency',
        uiLabel: 'Use this prompt',
        transportPayloadRef: 'stdout:block',
      },
      configSnapshot: {
        sequenceEnabled: 'on',
        arbitraryConfigRowsAreAuthority: false,
        oldDecisionSessionConfigPresent: true,
        userFacingItemCountConfigPresent: true,
      },
    });

    expect(result.legacyAuthoritySignalsRejected).toBe(true);
    expect(result.reasonCodes).toEqual(expect.arrayContaining([
      'legacy_ds_hook_ui_transport_authority_rejected',
      'old_ds_config_rejected_as_pe_runtime_authority',
      'user_facing_sequence_item_count_config_rejected',
    ]));
  });

  it('requires non-content createdAt and idempotency fields without treating them as activation authority', () => {
    const result = evaluate('continue_current_item', {
      event: {
        sequenceId: 'seq-1',
        sequenceItemId: 'item-1',
        requestId: 'request-1',
        projectScope: '/repo',
        bodyRevision: 1,
        currentItemRevision: 1,
        contractVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
        explicitUserActionState: 'present_future_only',
        continuationActionState: 'continue_current_item',
        terminalTransitionState: 'none',
        hostCapabilityState: 'future_hold_proven',
        stateFreshness: 'current',
      },
    });

    expect(result.allowed).toBe(false);
    expect(result.reasonCodes).toEqual(expect.arrayContaining([
      'runtime_event_created_at_missing',
      'runtime_event_idempotency_key_missing',
      'pe_ar11_3_continuation_no_go',
    ]));
    expect(result.continuationState).toBe('not_created_v1');
  });

  it('rejects mismatched continuation action state and terminal transition attempts', () => {
    const result = evaluate('cancel_active_sequence', {
      event: {
        sequenceId: 'seq-1',
        sequenceItemId: 'item-1',
        requestId: 'request-1',
        projectScope: '/repo',
        createdAtMs: 1,
        idempotencyKey: 'event-1',
        contractVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
        explicitUserActionState: 'present_future_only',
        continuationActionState: 'continue_current_item',
        terminalTransitionState: 'cancelled_terminal',
        hostCapabilityState: 'future_hold_proven',
        stateFreshness: 'current',
      },
    });

    expect(result.allowed).toBe(false);
    expect(result.reasonCodes).toEqual(expect.arrayContaining([
      'runtime_event_action_state_mismatch',
      'terminal_transition_rejected_v1',
      'pe_ar11_3_cancel_no_go',
    ]));
    expect(result.terminalReopenState).toBe('rejected_v1');
  });

  it('lets sequence.enabled off reduce behavior without creating semantic runtime authority', () => {
    const result = evaluate('runtime_acceptance', {
      configSnapshot: {
        observedConfigKey: 'prompt_enhancement.sequence.enabled',
        sequenceEnabled: 'off',
        arbitraryConfigRowsAreAuthority: false,
      },
    });

    expect(result.configState).toBe('validated_off_no_runtime');
    expect(result.reasonCodes).toContain('sequence_config_off_reduces_behavior_only');
    expect(result.queueState).toBe('not_created_v1');
  });

  it('rejects arbitrary sequence config keys as PE runtime authority', () => {
    const result = evaluate('runtime_acceptance', {
      configSnapshot: {
        observedConfigKey: 'ctrl_t.sequence.enabled',
        sequenceEnabled: 'on',
        arbitraryConfigRowsAreAuthority: false,
      },
    });

    expect(result.configState).toBe('validated_on_no_runtime');
    expect(result.reasonCodes).toEqual(expect.arrayContaining([
      'sequence_config_key_rejected_as_pe_runtime_authority',
      'pe_ar11_5_runtime_acceptance_no_go',
    ]));
    expect(result.allowed).toBe(false);
  });

  it('rejects raw content presence from gate persistence and diagnostics', () => {
    const result = evaluate('response_finished_stop_completion', {
      rawContentPresence: {
        rawPromptBody: true,
        rawEnhancedBody: true,
        rawAssistantResponse: true,
        rawFuturePromptBody: true,
        rawSourceSnippet: true,
        rawFeedback: true,
      },
    });

    expect(result.persistencePolicyState).toBe('ids_counts_status_only_no_raw_content');
    expect(result.futurePromptBodyState).toBe('not_generated_not_stored_not_rendered');
    expect(result.reasonCodes).toContain('raw_prompt_body_or_source_content_rejected');
  });

  it('rejects stale, corrupt, terminal, cross-project, and unsupported-version events as no-op fallback', () => {
    const result = evaluate('resume_active_sequence', {
      event: {
        requestId: 'request-2',
        projectScope: '/other-repo',
        contractVersion: 99,
        explicitUserActionState: 'absent',
        hostCapabilityState: 'unsupported',
        stateFreshness: 'terminal',
      },
    });

    expect(result.reasonCodes).toEqual(expect.arrayContaining([
      'runtime_event_contract_version_unsupported',
      'runtime_event_project_scope_mismatch',
      'runtime_event_request_mismatch',
      'host_hold_commit_not_proven',
      'terminal_reopen_rejected',
    ]));
    expect(result.fallbackMode).toBe('current_or_original_fallback_no_runtime');
  });
});
