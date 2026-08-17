import { describe, expect, it } from 'vitest';
import {
  PROMPT_ENHANCEMENT_CONTRACT_VERSION,
  validatePromptEnhancementPrepareResultV1,
  type PromptEnhancementActionRequestV1,
  type PromptEnhancementPrepareRequestV1,
  type PromptEnhancementSourceRefV1,
} from './contracts.js';
import { buildPromptEnhancementCostVisibilityMetadataV1 } from './cost-observability.js';
import { applyPromptEnhancementAction, preparePromptEnhancement } from './facade.js';
import { getPromptStartStopSourceSnapshot } from './source-reality.js';

function request(overrides: Partial<PromptEnhancementPrepareRequestV1> = {}): PromptEnhancementPrepareRequestV1 {
  const sourceRef: PromptEnhancementSourceRefV1 = {
    sourceRefId: 'src-a-1',
    sourceKind: 'source_a_user_prompt',
    sourceId: 'prompt:1',
    sourceAuthorization: 'source_fact_only',
    evidenceStatus: 'present',
    freshness: 'current',
    confidence: 'high',
    privacyClass: 'public_safe',
  };
  const promptStartStop = getPromptStartStopSourceSnapshot();
  return {
    schemaVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
    requestId: 'facade-test-1',
    projectRoot: '/tmp/project',
    hostSurface: 'cli_stop_bridge',
    sourcePrompt: {
      text: 'Fix the failing payment test, the test failure blocks ci, and explain the verification.',
      origin: 'user',
      capturedAt: 1,
      promptIndex: 1,
      generatedOriginPolicy: 'ordinary_source_a',
    },
    reviewMomentContext: {
      reviewMoment: 'UserPromptSubmit_preparation',
      currentAgentMode: 'workspace-write',
      projectId: 'project-1',
      sessionId: 'session-1',
      detectedLanguage: 'en',
      stageCandidate: 'implementation',
      promptCount: 1,
      recentPromptMetadataRefs: [],
      triggerProvenance: {
        currentStage: 'implementation',
        prevStage: 'task_breakdown',
        triggerKind: 'stage_transition',
        classifierState: 'fire_recommended',
        degradedNoActionState: 'none',
        promptStartBoundary: promptStartStop.hookBoundary,
        deliveryBoundary: promptStartStop.deliveryBoundary,
        promptStartCanReplaceSameTurn: false,
      },
    },
    sourceSignals: {
      sourceAOriginalPromptRef: sourceRef,
      sourceRefs: [sourceRef],
      normalizedStageAbsenceSignalRefs: [],
      contentTemplateRecordFactRefs: [],
      popupQuestionSourceRefs: [],
      whyHelpSourceRefs: [],
      profileRoleModeRefs: [],
      rightGoodWorkStyleEnvRuntimeRefs: [],
      missingMemoryCandidateRefs: [],
      sourceLabels: [{ sourceRefId: sourceRef.sourceRefId, label: 'original_prompt', evidenceStatus: 'present' }],
      promptStartStop: {
        hookBoundary: promptStartStop.hookBoundary,
        deliveryBoundary: promptStartStop.deliveryBoundary,
        runAutoCanHoldOrReplaceSubmittedPrompt: false,
        sharedSignalCount: promptStartStop.sharedSignalCount,
        classifierDegradedNoFireReasons: promptStartStop.classifierDegradedNoFireReasons,
      },
      store: { schemaVersion: 1, missingPromptEnhancementTables: [], cleanupGaps: [] },
      transcriptPathState: 'not_authority',
      streamBOutputs: [],
      paramEventChannels: [],
      servedVariantIdentityRefs: [],
      deliveryGateRefs: [],
      sourceOnlyHardFactRefs: [],
    },
    userPreferenceContext: { levelState: 'default', scopedFeedbackEvidenceRefs: [] },
    configSnapshot: { sequenceEnabledState: 'not_enabled_v1', validatedEffectiveConfigState: 'valid', arbitraryConfigRowsAreAuthority: false },
    callVisibilityState: buildPromptEnhancementCostVisibilityMetadataV1('baseline_pe_composer', {
      callVisibilityMode: 'deterministic',
      plannedCallCount: 0,
      usedCallCount: 0,
    }),
    privacyAndStoragePolicy: {
      sensitivityClass: 'normal',
      localStorageEligibility: 'ids_and_categories_only',
      telemetryEligibility: 'allowlisted_counts_only',
      llmSharingEligibility: 'allowed_minimal',
      generatedBodyStoragePolicy: 'do_not_store_raw_by_default',
    },
    ...overrides,
  };
}

describe('PE executable facade', () => {
  it('orchestrates an eligible request into one validated current-body result', async () => {
    const result = await preparePromptEnhancement(request());
    const validation = validatePromptEnhancementPrepareResultV1(result);

    expect(validation.ok).toBe(true);
    expect(result.disposition).toBe('show_current_body');
    expect(result.currentBody.text).toBe(result.currentBody.renderedPromptBody);
    expect(result.currentBody.originalPromptText).toContain('failing payment test');
    expect(result.validationDecisionId).toBe(`${result.currentBody.currentBodyId}:validation:${result.currentBody.bodyRevision}:final_body`);
    expect(result.generatedOrigin.bodyId).toBe(result.currentBody.currentBodyId);
    expect(result.delivery.rawTransportIsSemanticAuthority).toBe(false);
  });

  it('E2: the guidance pipeline feeds a source_signal_guidance section for a stage-transition trigger', async () => {
    const result = await preparePromptEnhancement(request());
    expect(result.disposition).toBe('show_current_body');
    expect(result.routingAndFeedbackDecision.selectedSectionPivotIds.some((id) => id.includes('source_signal_guidance'))).toBe(true);
  });

  it('unknown observation entries are guarded out at the boundary before the registry decides', async () => {
    const base = request();
    const result = await preparePromptEnhancement(request({
      reviewMomentContext: {
        ...base.reviewMomentContext,
        triggerProvenance: {
          ...base.reviewMomentContext.triggerProvenance,
          classifierPrimaryIntent: 'issue_debug.failing_test',
          classifierIntentConfidence: 0.9,
          // The junk entries must never reach the registry: an unknown
          // capability id has no scope row and would fail the decision.
          classifierCapabilityCandidates: ['capability.confirmation_needed', 'capability.not_a_real_one'],
          classifierDebugEvidencePresent: ['logs', 'not_a_form'],
        },
      },
    }));
    expect(result.disposition).toBe('show_current_body');
  });

  it('the intent proposal survives the facade hop and decides the route', async () => {
    // The middle link of the threading chain. Its two ends are pinned elsewhere —
    // the boundary populates provenance, and the router prefers a proposal it is
    // handed — but nothing asserted that the facade carries one to the other. If
    // that hop broke, every prompt would fall to the keyword cascade silently:
    // routes still get produced, just the wrong ones, with the suite green.
    const base = request();
    const withProposal = await preparePromptEnhancement(request({
      requestId: 'facade-threading-keyed',
      reviewMomentContext: {
        ...base.reviewMomentContext,
        triggerProvenance: {
          ...base.reviewMomentContext.triggerProvenance,
          classifierPrimaryIntent: 'review.security_review',
          classifierIntentConfidence: 0.9,
          classifierCapabilityCandidates: [],
          classifierDebugEvidencePresent: [],
        },
      },
    }));
    // A review subtype the cascade cannot reach from this prompt text — so seeing
    // it here proves the proposal travelled, not that a keyword matched.
    expect(withProposal.routeDecision.primaryIntent).toBe('review.security_review');
    expect(withProposal.routeDecision.familyId).toBe('review_verification');

    const withoutProposal = await preparePromptEnhancement(request({ requestId: 'facade-threading-keyless' }));
    expect(withoutProposal.routeDecision.primaryIntent).not.toBe('review.security_review');
  });

  it('E2 / DR2-G1: no Source-A survivor (no trigger, no signals) returns skip_no_popup, not a filler body', async () => {
    const promptStartStop = getPromptStartStopSourceSnapshot();
    const result = await preparePromptEnhancement(
      request({
        reviewMomentContext: {
          reviewMoment: 'UserPromptSubmit_preparation',
          currentAgentMode: 'workspace-write',
          projectId: 'project-1',
          sessionId: 'session-1',
          detectedLanguage: 'en',
          stageCandidate: 'implementation',
          promptCount: 1,
          recentPromptMetadataRefs: [],
          triggerProvenance: {
            currentStage: 'implementation',
            triggerKind: 'none',
            classifierState: 'fire_recommended',
            degradedNoActionState: 'none',
            promptStartBoundary: promptStartStop.hookBoundary,
            deliveryBoundary: promptStartStop.deliveryBoundary,
            promptStartCanReplaceSameTurn: false,
          },
        },
      }),
    );
    expect(result.disposition).toBe('no_popup_not_applicable');
    expect(result.sourceGuidanceCoverage).toBe('not_applicable');
    expect(result.routingAndFeedbackDecision.state).toBe('suppress');
  });

  it('TI-3.2 follow-up (Phase 2): a no-sections / no-popup run captures no_popup_or_no_sections_original_only', async () => {
    // A generated-origin echo routes with route.noPopup === true, which yields ZERO section plans, so
    // composePromptEnhancementBody takes the original-only branch and emits
    // `no_popup_or_no_sections_original_only` — a fallback_or_no_popup diagnostic that diagnosticsFor
    // genericizes away. Phase 2 widened the capture filter to the whole category, so this
    // previously-excluded compose-layer reason now reaches the log-bound field.
    const result = await preparePromptEnhancement(request({
      sourcePrompt: {
        ...request().sourcePrompt,
        origin: 'pe_generated_echo',
        generatedOriginPolicy: 'exclude_from_ordinary_learning',
      },
    }));
    expect(result.disposition).toBe('no_popup_not_applicable');
    expect(result.compositionFallbackReasonCodes).toContain('no_popup_or_no_sections_original_only');
  });

  it('UI-9: recomputes the header why-help when an edit introduces a sensitive action (not stale)', async () => {
    const base = await preparePromptEnhancement(request({ requestId: 'facade-whyhelp-1' }));
    expect(base.disposition).toBe('show_current_body');
    // The base prompt carries no sensitive action, so its header why-help is not the sensitive-action one.
    expect(base.uiView.whyHelp?.reasonKind).not.toBe('sensitive_action');

    const useCurrent = base.availableActions.find((action) => action.actionType === 'use_current_body');
    expect(useCurrent).toBeDefined();
    const actionRequest: PromptEnhancementActionRequestV1 = {
      ...request({ requestId: 'facade-whyhelp-1' }),
      action: useCurrent!,
      currentBodyBinding: {
        currentBodyId: base.currentBody.currentBodyId,
        bodyRevision: base.currentBody.bodyRevision,
        validationDecisionId: base.validationDecisionId,
        editedBodyText: 'Delete the production database now.',
        actionSubmittedAtMs: 2,
        realUserInitiated: true,
        sectionSpanEditEvents: [],
      },
    };
    const edited = await applyPromptEnhancementAction(actionRequest);
    // The edited body now touches a sensitive action, so the recomputed why-help names it
    // rather than carrying the stale base value forward.
    expect(edited.uiView.whyHelp?.reasonKind).toBe('sensitive_action');
    expect(validatePromptEnhancementPrepareResultV1(edited).ok).toBe(true);
  });

  it('returns a typed no-popup result for generated-origin echoes', async () => {
    const result = await preparePromptEnhancement(request({
      sourcePrompt: {
        ...request().sourcePrompt,
        origin: 'pe_generated_echo',
        generatedOriginPolicy: 'exclude_from_ordinary_learning',
      },
    }));
    expect(result.disposition).toBe('no_popup_not_applicable');
    expect(result.uiView.body.sendPolicy).toBe('no_popup');
    expect(validatePromptEnhancementPrepareResultV1(result).ok).toBe(true);
  });
});
