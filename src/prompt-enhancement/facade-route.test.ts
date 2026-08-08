import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PROMPT_ENHANCEMENT_CONTRACT_VERSION,
  type PromptEnhancementPrepareRequestV1,
  type PromptEnhancementSourceRefV1,
} from './contracts.js';
import { buildPromptEnhancementCostVisibilityMetadataV1 } from './cost-observability.js';
import { getPromptStartStopSourceSnapshot } from './source-reality.js';

// Mock the bounded LLM route decision so an ambiguous prompt that the deterministic
// router skips is re-routed. Mock the composer to undefined so no real composer call
// fires (this test is about routing, not wording).
vi.mock('./llm-route-decision.js', () => ({
  decidePromptEnhancementRouteViaLlmV1: vi.fn(async () => ({
    familyId: 'issue_debug',
    primaryIntent: 'issue_debug.new_bug_report',
    capabilities: ['capability.reproduction_or_evidence_needed'],
    ambiguityState: 'ambiguous_surface_prompt',
  })),
}));
vi.mock('./llm-composer.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  composeStructuredComposerOutputV1: vi.fn(async () => undefined),
}));

const { preparePromptEnhancement } = await import('./facade.js');
const { decidePromptEnhancementRouteViaLlmV1 } = await import('./llm-route-decision.js');

function request(text: string): PromptEnhancementPrepareRequestV1 {
  const sourceRef: PromptEnhancementSourceRefV1 = { sourceRefId: 'src-a-1', sourceKind: 'source_a_user_prompt', sourceId: 'prompt:1', sourceAuthorization: 'source_fact_only', evidenceStatus: 'present', freshness: 'current', confidence: 'high', privacyClass: 'public_safe' };
  const ss = getPromptStartStopSourceSnapshot();
  return { schemaVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION, requestId: 'facade-route-1', projectRoot: '/tmp/p', hostSurface: 'cli_stop_bridge',
    sourcePrompt: { text, origin: 'user', capturedAt: 1, promptIndex: 1, generatedOriginPolicy: 'ordinary_source_a' },
    reviewMomentContext: { reviewMoment: 'UserPromptSubmit_preparation', currentAgentMode: 'workspace-write', projectId: 'p', sessionId: 's', detectedLanguage: 'en', stageCandidate: 'implementation', promptCount: 1, recentPromptMetadataRefs: [],
      triggerProvenance: { currentStage: 'implementation', prevStage: 'task_breakdown', triggerKind: 'stage_transition', classifierState: 'fire_recommended', degradedNoActionState: 'none', promptStartBoundary: ss.hookBoundary, deliveryBoundary: ss.deliveryBoundary, promptStartCanReplaceSameTurn: false } },
    sourceSignals: { sourceAOriginalPromptRef: sourceRef, sourceRefs: [sourceRef], normalizedStageAbsenceSignalRefs: [], contentTemplateRecordFactRefs: [], popupQuestionSourceRefs: [], whyHelpSourceRefs: [], profileRoleModeRefs: [], rightGoodWorkStyleEnvRuntimeRefs: [], missingMemoryCandidateRefs: [], sourceLabels: [{ sourceRefId: 'src-a-1', label: 'original_prompt', evidenceStatus: 'present' }], promptStartStop: { hookBoundary: ss.hookBoundary, deliveryBoundary: ss.deliveryBoundary, runAutoCanHoldOrReplaceSubmittedPrompt: false, sharedSignalCount: ss.sharedSignalCount, classifierDegradedNoFireReasons: ss.classifierDegradedNoFireReasons }, store: { schemaVersion: 1, missingPromptEnhancementTables: [], cleanupGaps: [] }, transcriptPathState: 'not_authority', streamBOutputs: [], paramEventChannels: [], servedVariantIdentityRefs: [], deliveryGateRefs: [], sourceOnlyHardFactRefs: [] },
    userPreferenceContext: { levelState: 'default', scopedFeedbackEvidenceRefs: [] },
    configSnapshot: { sequenceEnabledState: 'not_enabled_v1', validatedEffectiveConfigState: 'valid', arbitraryConfigRowsAreAuthority: false },
    callVisibilityState: buildPromptEnhancementCostVisibilityMetadataV1('baseline_pe_composer', { callVisibilityMode: 'deterministic', plannedCallCount: 0, usedCallCount: 0 }),
    privacyAndStoragePolicy: { sensitivityClass: 'normal', localStorageEligibility: 'ids_and_categories_only', telemetryEligibility: 'allowlisted_counts_only', llmSharingEligibility: 'allowed_minimal', generatedBodyStoragePolicy: 'do_not_store_raw_by_default' } };
}

const priorKey = process.env['OPENAI_API_KEY'];
afterEach(() => {
  if (priorKey === undefined) delete process.env['OPENAI_API_KEY'];
  else process.env['OPENAI_API_KEY'] = priorKey;
  vi.clearAllMocks();
});

// 'fix this' is a weak/ambiguous prompt the deterministic router skips with
// ambiguous_weak_evidence_skip_no_popup.
const AMBIGUOUS = 'fix this';

describe('E6 — facade LLM route wiring', () => {
  it('an ambiguous prompt + key + accepted LLM route -> re-routed to the LLM family/intent + llm_route_decision_call', async () => {
    process.env['OPENAI_API_KEY'] = `sk-${'x'.repeat(40)}`;
    const result = await preparePromptEnhancement(request(AMBIGUOUS));
    expect(decidePromptEnhancementRouteViaLlmV1).toHaveBeenCalledTimes(1);
    expect(result.routeDecision.familyId).toBe('issue_debug');
    expect(result.routeDecision.primaryIntent).toBe('issue_debug.new_bug_report');
    expect(result.routeDecision.ambiguityState).toBe('ambiguous_surface_prompt');
    expect(result.routeDecision.llmRoutePolicy.mode).toBe('llm_route_decision_call');
  });

  it('no key -> LLM route not called -> deterministic skip stands (no_popup)', async () => {
    delete process.env['OPENAI_API_KEY'];
    const result = await preparePromptEnhancement(request(AMBIGUOUS));
    expect(decidePromptEnhancementRouteViaLlmV1).not.toHaveBeenCalled();
    expect(result.disposition).toBe('no_popup_not_applicable');
    expect(result.routeDecision.llmRoutePolicy.mode).toBe('no_call');
  });
});
