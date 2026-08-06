import { describe, expect, it } from 'vitest';
import {
  PROMPT_ENHANCEMENT_CONTRACT_VERSION,
  type PromptEnhancementPrepareRequestV1,
  type PromptEnhancementPrepareResultV1,
  type PromptEnhancementSourceRefV1,
} from './contracts.js';
import { buildPromptEnhancementCostVisibilityMetadataV1 } from './cost-observability.js';
import { preparePromptEnhancement } from './facade.js';
import { getPromptStartStopSourceSnapshot } from './source-reality.js';
import {
  buildPromptEnhancementPopupSessionV1,
  isPromptEnhancementBlockedNoSendPolicyV1,
} from './popup-session.js';
import { buildPromptEnhancementUiBoundarySessionV1 } from './ui-boundary.js';
import { buildPromptEnhancementPopupRenderModelV1 } from './popup-render-model.js';

// A deterministic result never blocks today (D2 is latent until E4 wires the LLM), so simulate a
// hard block by mutating a real prepared result: blocked_no_send + no_send + a deliberately-unsafe
// body. Every Bhavnesh UI layer must self-scrub it, not rely on the terminal ui-safety scrub alone.
const UNSAFE = 'LEAKED SECRET sk-must-never-render-abcdef and rm -rf /';

function request(): PromptEnhancementPrepareRequestV1 {
  const sourceRef: PromptEnhancementSourceRefV1 = {
    sourceRefId: 'src-a-1', sourceKind: 'source_a_user_prompt', sourceId: 'prompt:1',
    sourceAuthorization: 'source_fact_only', evidenceStatus: 'present', freshness: 'current', confidence: 'high', privacyClass: 'public_safe',
  };
  const promptStartStop = getPromptStartStopSourceSnapshot();
  return {
    schemaVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION, requestId: 'd2-1', projectRoot: '/tmp/d2-project', hostSurface: 'cli_stop_bridge',
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

function blocked(result: PromptEnhancementPrepareResultV1): PromptEnhancementPrepareResultV1 {
  return {
    ...result,
    disposition: 'blocked_no_send',
    uiView: { ...result.uiView, body: { ...result.uiView.body, sendPolicy: 'no_send', text: UNSAFE } },
  };
}

describe('D2 — blocked body self-scrubs at every Bhavnesh UI layer (P7-G1 / PE-DR-5)', () => {
  it('the shared predicate flags no_send / no_popup, not sendable policies', () => {
    expect(isPromptEnhancementBlockedNoSendPolicyV1('no_send')).toBe(true);
    expect(isPromptEnhancementBlockedNoSendPolicyV1('no_popup')).toBe(true);
    expect(isPromptEnhancementBlockedNoSendPolicyV1('send_current')).toBe(false);
    expect(isPromptEnhancementBlockedNoSendPolicyV1('send_original')).toBe(false);
  });

  it('popup-session excludes the blocked body text (but keeps a sendable body)', async () => {
    const result = await preparePromptEnhancement(request());
    const blockedSession = buildPromptEnhancementPopupSessionV1({
      viewPayload: blocked(result).uiView, validationDecisionId: result.validationDecisionId,
      deliverySurface: result.delivery.deliveryChannel, timestampMs: 1,
    });
    expect(blockedSession.currentBodyText).toBe('');
    expect(blockedSession.currentBodyText).not.toContain('LEAKED');

    // Control: a normal sendable body is NOT scrubbed.
    const okSession = buildPromptEnhancementPopupSessionV1({
      viewPayload: result.uiView, validationDecisionId: result.validationDecisionId,
      deliverySurface: result.delivery.deliveryChannel, timestampMs: 1,
    });
    expect(okSession.currentBodyText.length).toBeGreaterThan(0);
  });

  it('ui-boundary returns a body-excluded session tagged for a blocked_no_send result', async () => {
    const result = await preparePromptEnhancement(request());
    const boundary = buildPromptEnhancementUiBoundarySessionV1({ result: blocked(result), timestampMs: 1 });
    expect(boundary.state).toBe('session_ready');
    expect(boundary.reasonCodes).toContain('blocked_no_send_body_excluded');
    expect(boundary.session?.currentBodyText).toBe('');
  });

  it('popup-render-model renders no generated text for a blocked_no_send result', async () => {
    const result = await preparePromptEnhancement(request());
    const rendered = buildPromptEnhancementPopupRenderModelV1({ result: blocked(result), timestampMs: 1 });
    expect(rendered.state).toBe('render_model_ready');
    if (rendered.state === 'render_model_ready') {
      expect(rendered.model.body.text).toBe('');
      expect(rendered.model.body.text).not.toContain('LEAKED');
    }
  });
});
