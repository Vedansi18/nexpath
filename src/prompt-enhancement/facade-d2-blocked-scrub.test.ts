import { describe, expect, it, vi } from 'vitest';
import {
  PROMPT_ENHANCEMENT_CONTRACT_VERSION,
  type PromptEnhancementPrepareRequestV1,
  type PromptEnhancementSourceRefV1,
} from './contracts.js';
import { buildPromptEnhancementCostVisibilityMetadataV1 } from './cost-observability.js';
import { getPromptStartStopSourceSnapshot } from './source-reality.js';

// D2 4a: force a hard block at the engine (a deterministic body never blocks today) by overriding
// only the send-policy fields of the REAL safety result — so the facade produces blocked_no_send and
// its OWN self-scrub (not the UI layers) is exercised.
vi.mock('./safety-sendability.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./safety-sendability.js')>();
  return {
    ...actual,
    validatePromptEnhancementSafety: (input: Parameters<typeof actual.validatePromptEnhancementSafety>[0]) => ({
      ...actual.validatePromptEnhancementSafety(input),
      sendPolicy: 'no_send' as const,
      generatedSafeStatus: 'invalid_non_sendable' as const,
    }),
  };
});

const { preparePromptEnhancement } = await import('./facade.js');

const ORIGINAL = 'Fix the failing payment test and explain the verification.';

function request(): PromptEnhancementPrepareRequestV1 {
  const sourceRef: PromptEnhancementSourceRefV1 = {
    sourceRefId: 'src-a-1', sourceKind: 'source_a_user_prompt', sourceId: 'prompt:1',
    sourceAuthorization: 'source_fact_only', evidenceStatus: 'present', freshness: 'current', confidence: 'high', privacyClass: 'public_safe',
  };
  const promptStartStop = getPromptStartStopSourceSnapshot();
  return {
    schemaVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION, requestId: 'd2-facade-1', projectRoot: '/tmp/d2-facade', hostSurface: 'cli_stop_bridge',
    sourcePrompt: { text: ORIGINAL, origin: 'user', capturedAt: 1, promptIndex: 1, generatedOriginPolicy: 'ordinary_source_a' },
    reviewMomentContext: {
      reviewMoment: 'UserPromptSubmit_preparation', currentAgentMode: 'workspace-write', projectId: 'project-1', sessionId: 'session-1',
      detectedLanguage: 'en', stageCandidate: 'implementation', promptCount: 1, recentPromptMetadataRefs: [],
      triggerProvenance: {
        currentStage: 'implementation', prevStage: 'task_breakdown', triggerKind: 'stage_transition', classifierState: 'fire_recommended',
        degradedNoActionState: 'none', promptStartBoundary: promptStartStop.hookBoundary, deliveryBoundary: promptStartStop.deliveryBoundary, promptStartCanReplaceSameTurn: false,
      },
    },
    sourceSignals: {
      sourceAOriginalPromptRef: sourceRef, sourceRefs: [sourceRef], normalizedStageAbsenceSignalRefs: [], contentTemplateRecordFactRefs: [],
      popupQuestionSourceRefs: [], whyHelpSourceRefs: [], profileRoleModeRefs: [], rightGoodWorkStyleEnvRuntimeRefs: [], missingMemoryCandidateRefs: [],
      sourceLabels: [{ sourceRefId: sourceRef.sourceRefId, label: 'original_prompt', evidenceStatus: 'present' }],
      promptStartStop: { hookBoundary: promptStartStop.hookBoundary, deliveryBoundary: promptStartStop.deliveryBoundary, runAutoCanHoldOrReplaceSubmittedPrompt: false, sharedSignalCount: promptStartStop.sharedSignalCount, classifierDegradedNoFireReasons: promptStartStop.classifierDegradedNoFireReasons },
      store: { schemaVersion: 1, missingPromptEnhancementTables: [], cleanupGaps: [] }, transcriptPathState: 'not_authority', streamBOutputs: [], paramEventChannels: [],
      servedVariantIdentityRefs: [], deliveryGateRefs: [], sourceOnlyHardFactRefs: [],
    },
    userPreferenceContext: { levelState: 'default', scopedFeedbackEvidenceRefs: [] },
    configSnapshot: { sequenceEnabledState: 'not_enabled_v1', validatedEffectiveConfigState: 'valid', arbitraryConfigRowsAreAuthority: false },
    callVisibilityState: buildPromptEnhancementCostVisibilityMetadataV1('baseline_pe_composer', { callVisibilityMode: 'deterministic', plannedCallCount: 0, usedCallCount: 0 }),
    privacyAndStoragePolicy: { sensitivityClass: 'normal', localStorageEligibility: 'ids_and_categories_only', telemetryEligibility: 'allowlisted_counts_only', llmSharingEligibility: 'allowed_minimal', generatedBodyStoragePolicy: 'do_not_store_raw_by_default' },
  };
}

describe('D2 4a — facade self-scrubs a blocked body at source (P6-G1)', () => {
  it('blocked_no_send → currentBody.text and uiView.body.text fall back to the original prompt (no generated body)', async () => {
    const result = await preparePromptEnhancement(request());
    expect(result.disposition).toBe('blocked_no_send');

    // The engine payload itself is safe: a host reading these DIRECTLY gets the original prompt,
    // not the (blocked) generated body — proven by exact equality with the original (the generated
    // body would be strictly longer: original + enhanced sections).
    expect(result.currentBody.text).toBe(ORIGINAL);
    expect(result.uiView.body.text).toBe(ORIGINAL);
    expect(result.currentBody.renderedPromptBody).toBe(ORIGINAL);
    expect(result.uiView.body.text).not.toContain('Enhanced plan');
  });
});
