import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PROMPT_ENHANCEMENT_CONTRACT_VERSION,
  type PromptEnhancementPrepareRequestV1,
  type PromptEnhancementSourceRefV1,
} from './contracts.js';
import { buildPromptEnhancementCostVisibilityMetadataV1 } from './cost-observability.js';
import { getPromptStartStopSourceSnapshot } from './source-reality.js';

// The composer gate is unit-tested separately; here force it true so the facade's
// LLM wiring is exercised regardless of the fixture prompt's ambiguity.
vi.mock('./composer-gate.js', () => ({ isPromptEnhancementNlpHeavyCaseV1: () => true }));

// A "smart" mock composer: it reads the planning the facade passes and returns a
// VALID structured output (real section id + an allowed source fact id) so the
// downstream validator accepts it — proving the LLM wording path, not the fallback.
vi.mock('./llm-composer.js', () => ({
  composeStructuredComposerOutputV1: vi.fn(async (input: { planning: { sectionPlans: readonly { sectionId: string; sectionKind: string; structuredContentPartRefs: readonly string[] }[] } }) => {
    const section = input.planning.sectionPlans.find(
      (plan) => plan.sectionKind !== 'original_request_or_goal' && plan.structuredContentPartRefs.length > 0,
    );
    if (!section) return undefined;
    const factId = section.structuredContentPartRefs[0];
    return {
      outputId: 'test-llm-output',
      sectionDrafts: [{ sectionId: section.sectionId, bodyText: 'Tailored LLM wording for this section.', sourceFactIds: [factId] }],
      composerClaims: [`claim:${factId}`],
    };
  }),
}));

const { preparePromptEnhancement, applyPromptEnhancementAction } = await import('./facade.js');
const { composeStructuredComposerOutputV1 } = await import('./llm-composer.js');

function request(): PromptEnhancementPrepareRequestV1 {
  const sourceRef: PromptEnhancementSourceRefV1 = {
    sourceRefId: 'src-a-1', sourceKind: 'source_a_user_prompt', sourceId: 'prompt:1',
    sourceAuthorization: 'source_fact_only', evidenceStatus: 'present', freshness: 'current', confidence: 'high', privacyClass: 'public_safe',
  };
  const promptStartStop = getPromptStartStopSourceSnapshot();
  return {
    schemaVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION, requestId: 'facade-llm-1', projectRoot: '/tmp/project', hostSurface: 'cli_stop_bridge',
    sourcePrompt: { text: 'Fix the failing payment test and explain the verification.', origin: 'user', capturedAt: 1, promptIndex: 1, generatedOriginPolicy: 'ordinary_source_a' },
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

const priorKey = process.env['OPENAI_API_KEY'];
afterEach(() => {
  if (priorKey === undefined) delete process.env['OPENAI_API_KEY'];
  else process.env['OPENAI_API_KEY'] = priorKey;
  vi.clearAllMocks();
});

describe('E4 — facade LLM composer wiring', () => {
  it('LLM path: valid key + NLP-heavy + accepted structured output -> llm_wording + non-deterministic modelVersion', async () => {
    process.env['OPENAI_API_KEY'] = `sk-${'x'.repeat(40)}`;
    const result = await preparePromptEnhancement(request());
    expect(result.disposition).toBe('show_current_body');
    expect(composeStructuredComposerOutputV1).toHaveBeenCalledTimes(1);
    expect(result.callAndVisibilityMetadata.callVisibilityMode).toBe('llm_wording');
    expect(result.modelVersion).toBe('llm-wording-v1');
    expect(result.currentBody.text).toContain('Tailored LLM wording');
  });

  it('fallback: no API key -> composer not called -> deterministic modelVersion (identical to today)', async () => {
    delete process.env['OPENAI_API_KEY'];
    const result = await preparePromptEnhancement(request());
    expect(result.disposition).toBe('show_current_body');
    expect(composeStructuredComposerOutputV1).not.toHaveBeenCalled();
    expect(result.callAndVisibilityMetadata.callVisibilityMode).not.toBe('llm_wording');
    expect(result.modelVersion).toBe('deterministic-v1');
  });

  it('E8: a directional action (shorter) LLM-recomposes, passing the action to the composer', async () => {
    process.env['OPENAI_API_KEY'] = `sk-${'x'.repeat(40)}`;
    const base = await preparePromptEnhancement(request());
    const shorter = base.availableActions.find((entry) => entry.actionType === 'shorter');
    expect(shorter).toBeDefined();
    vi.clearAllMocks(); // ignore the composer call from the base prepare

    const actionRequest = {
      ...request(),
      action: shorter!,
      currentBodyBinding: {
        currentBodyId: base.currentBody.currentBodyId,
        bodyRevision: base.currentBody.bodyRevision,
        validationDecisionId: base.validationDecisionId,
        editedBodyText: base.currentBody.text,
        actionSubmittedAtMs: 2,
        realUserInitiated: true,
        sectionSpanEditEvents: [],
      },
    } as unknown as Parameters<typeof applyPromptEnhancementAction>[0];

    const result = await applyPromptEnhancementAction(actionRequest);
    expect(composeStructuredComposerOutputV1).toHaveBeenCalledWith(expect.objectContaining({ action: 'shorter' }));
    expect(result.callAndVisibilityMetadata.callVisibilityMode).toBe('llm_wording');
  });

  it('safety still runs on the composed body regardless of the LLM path (validation summary present)', async () => {
    process.env['OPENAI_API_KEY'] = `sk-${'x'.repeat(40)}`;
    const result = await preparePromptEnhancement(request());
    expect(result.validationSummary).toBeDefined();
    expect(result.delivery.rawTransportIsSemanticAuthority).toBe(false);
  });
});
