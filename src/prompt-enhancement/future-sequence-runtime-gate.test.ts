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
  it('transform-rule-11.1 blocks sequence identity and state creation in current v1', () => {
    const result = evaluate('create_sequence_state');

    // Default (no evidence) is still fully blocked (fail-closed). D3 (2026-08-08): the always-on
    // `current_v1_runtime_implementation_no_go` backstop is removed (the runtime now exists), so the
    // missing codes are the evidence-derived gates only — all still present with no evidence supplied.
    expect(assertPromptEnhancementFutureSequenceRuntimeBlockedV1(result)).toBe(true);
    expect(result.reasonCodes).toContain('future_sequence_1_sequence_identity_state_no_go');
    expect(result.missingGateCodes).toEqual(
      PROMPT_ENHANCEMENT_FUTURE_SEQUENCE_RUNTIME_REQUIRED_GATES_V1.filter((c) => c !== 'current_v1_runtime_implementation_no_go'),
    );
    expect(result.missingGateCodes).not.toContain('current_v1_runtime_implementation_no_go');
    expect(result.sequenceIdentityState).toBe('not_created_v1');
    expect(result.terminalReopenState).toBe('rejected_v1');
  });

  it('transform-rule-11.2 rejects accepted handoff start/order even with v1-safe metadata', () => {
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
      'future_sequence_2_handoff_start_order_no_go',
      'handoff_metadata_is_metadata_only_no_runtime',
      'runtime_event_created_at_missing',
      'runtime_event_idempotency_key_missing',
    ]));
  });

  it.each([
    ['continue_current_item', 'future_sequence_3_continuation_no_go'],
    ['custom_prompt_path', 'future_sequence_3_custom_prompt_path_no_go'],
    ['cancel_active_sequence', 'future_sequence_3_cancel_no_go'],
    ['abandon_active_sequence', 'future_sequence_3_abandon_no_go'],
    ['resume_active_sequence', 'future_sequence_3_resume_no_go'],
  ] as const)('transform-rule-11.3 blocks %s without mutation or follow-up', (operation, reasonCode) => {
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

  it('transform-rule-11.4 treats Stop and response-finished signals as non-proof', () => {
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
      'future_sequence_4_stop_completion_non_proof',
      'stop_or_response_finished_is_non_proof',
      'runtime_event_duplicate_noop',
      'legacy_ds_hook_ui_transport_authority_rejected',
    ]));
  });

  it('D3 (2026-08-08): runtime acceptance is now ALLOWED when every evidence flag is present (evidence-gated)', () => {
    // Previously this could never pass (the always-on backstop). D3 removes that backstop — the
    // runtime implementation exists (P1–P4) — so with ALL evidence present the gate activates.
    // Production stays fail-closed because the Stop-hook launcher supplies NO evidence (see the
    // production-fail-closed test below).
    const result = evaluate('runtime_acceptance', {
      evidence: {
        lifecyclePolicyApproved: true,
        engineReceiverContractApproved: true,
        futureSequenceRuntimeSourceAvailable: true,
        costNumericAcceptanceApproved: true,
        crossLayerOwnerSnapshotApproved: true,
        signedOwnerByDeliverableRegisterApproved: true,
        pendingNamedOwnerRegisterRowsClosed: true,
        hostHoldCommitContractProven: true,
        providerApiAvailabilityProven: true,
        privacyStoragePolicyApproved: true,
        focusedRuntimeFixturesPassed: true,
      },
    });

    expect(result.allowed).toBe(true);
    expect(result.status).toBe('allowed_future_sequence_runtime_v1');
    expect(result.runtimeAcceptanceState).toBe('go_v1');
    expect(result.missingGateCodes).toEqual([]);
    expect(result.reasonCodes).toContain('future_sequence_runtime_allowed_v1');
  });

  it('production fail-closed: with NO evidence supplied (the Stop-hook launcher path) the gate stays blocked', () => {
    // The production launcher (stop.ts) calls the gate WITHOUT an evidence field → all evidence
    // gates are missing → blocked. This is what keeps the continuation runtime off in production.
    const result = evaluate('continue_current_item');
    expect(result.allowed).toBe(false);
    expect(result.status).toBe('blocked_future_sequence_runtime_v1');
    expect(result.missingGateCodes.length).toBeGreaterThan(0);
  });

  it('keeps decision-rule-6 owner registers and provider/API availability as required runtime gates', () => {
    const result = evaluate('runtime_acceptance', {
      evidence: {
        lifecyclePolicyApproved: true,
        engineReceiverContractApproved: true,
        futureSequenceRuntimeSourceAvailable: true,
        costNumericAcceptanceApproved: true,
        crossLayerOwnerSnapshotApproved: true,
        hostHoldCommitContractProven: true,
        privacyStoragePolicyApproved: true,
        focusedRuntimeFixturesPassed: true,
      },
    });

    // Partial evidence → still blocked; the MISSING evidence gates are reported. (The always-on
    // `current_v1_runtime_implementation_no_go` backstop is removed by D3, so it is no longer here.)
    expect(result.allowed).toBe(false);
    expect(result.missingGateCodes).toEqual(expect.arrayContaining([
      'signed_owner_by_deliverable_register_pending',
      'pending_named_owner_register_rows_pending',
      'provider_api_availability_pending',
    ]));
    expect(result.missingGateCodes).not.toContain('current_v1_runtime_implementation_no_go');
  });

  // MPS-11 sub-phase 1b: the Stop-hook continuation launcher passes a real event + empty evidence but
  // NO handoff (the persisted sequence row stores ids/counts/status only — a typed handoff is a
  // create-path concern, not that seam). Mirror that exact call shape and assert the gate reports the
  // honest missing-handoff diagnostic while staying fully fail-closed.
  it('MPS-11 1b: a real continuation event with no handoff and empty evidence stays blocked, missing-handoff reported', () => {
    const result = evaluatePromptEnhancementFutureSequenceRuntimeGateV1({
      schemaVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
      operation: 'continue_current_item',
      requestId: 'enh-1b',
      projectRoot: '/repo',
      // The launcher builds this from the live row + payload (honest v1 values keep it blocked).
      event: {
        contractVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
        projectScope: '/repo',
        requestId: 'enh-1b',
        sequenceId: 'seq-1b',
        sequenceItemId: 'seq-1b#2',
        currentItemIndex: 2,
        createdAtMs: 1,
        idempotencyKey: 'seq-1b:2',
        explicitUserActionState: 'absent',
        continuationActionState: 'continue_current_item',
        terminalTransitionState: 'none',
        hostCapabilityState: 'stop_bridge_only',
        stopEventState: 'stop_fired_non_proof',
        stateFreshness: 'current',
      },
      evidence: {},
    });

    // No handoff passed → the honest diagnostic, not a fabricated inert one.
    expect(result.reasonCodes).toContain('missing_typed_handoff_metadata');
    expect(result.handoffRuntimeAuthorityState).toBe('missing_typed_handoff_no_runtime');
    // Empty evidence → every runtime-evidence flag still missing; gate fully fail-closed.
    expect(result.allowed).toBe(false);
    expect(assertPromptEnhancementFutureSequenceRuntimeBlockedV1(result)).toBe(true);
    expect(result.missingGateCodes).toEqual(
      PROMPT_ENHANCEMENT_FUTURE_SEQUENCE_RUNTIME_REQUIRED_GATES_V1.filter((c) => c !== 'current_v1_runtime_implementation_no_go'),
    );
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
      'future_sequence_3_continuation_no_go',
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
      'future_sequence_3_cancel_no_go',
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
      'future_sequence_5_runtime_acceptance_no_go',
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
