import { describe, expect, it, beforeEach } from 'vitest';
import { openStore, type Store } from '../../store/db.js';
import { preparePromptEnhancement } from '../../prompt-enhancement/facade.js';
import { getPromptStartStopSourceSnapshot } from '../../prompt-enhancement/source-reality.js';
import { buildPromptEnhancementCostVisibilityMetadataV1 } from '../../prompt-enhancement/cost-observability.js';
import {
  PROMPT_ENHANCEMENT_CONTRACT_VERSION,
  type PromptEnhancementPrepareRequestV1,
  type PromptEnhancementSourceRefV1,
} from '../../prompt-enhancement/contracts.js';
import {
  resolvePromptEnhancementGeneratedOrigin,
  getPromptEnhancementSourceUseSummary,
} from '../../store/prompt-enhancement.js';
import type { PendingPromptEnhancement } from '../../store/pending-prompt-enhancements.js';
import { recordPromptEnhancementStopBridgeDeliveryV1 } from './auto.js';

const PROJECT = '/tmp/stop-bridge-delivery-project';

function request(): PromptEnhancementPrepareRequestV1 {
  const sourceRef: PromptEnhancementSourceRefV1 = {
    sourceRefId: 'src-a-1', sourceKind: 'source_a_user_prompt', sourceId: 'prompt:1',
    sourceAuthorization: 'source_fact_only', evidenceStatus: 'present', freshness: 'current', confidence: 'high', privacyClass: 'public_safe',
  };
  const promptStartStop = getPromptStartStopSourceSnapshot();
  return {
    schemaVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION, requestId: 'stop-bridge-1', projectRoot: PROJECT, hostSurface: 'cli_stop_bridge',
    sourcePrompt: { text: 'Fix the failing payment test, the test failure blocks ci, and explain the verification.', origin: 'user', capturedAt: 1, promptIndex: 1, generatedOriginPolicy: 'ordinary_source_a' },
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

async function pending(store: Store): Promise<PendingPromptEnhancement> {
  const result = await preparePromptEnhancement(request());
  return { id: 7, projectRoot: PROJECT, sessionId: 'session-1', promptCount: 1, status: 'pending', createdAt: 1, request: request(), result };
}

describe('D1 — Stop-bridge delivery wiring (P9-G1 / resolves P9-G2)', () => {
  let store: Store;
  beforeEach(async () => { store = await openStore(':memory:'); });

  it('records source-use BEFORE transport and writes generated-origin to the store', async () => {
    const record = await pending(store);
    const delivered = recordPromptEnhancementStopBridgeDeliveryV1(store, record);

    // The typed contract produced a block decision + the source-use-before-transport invariant holds.
    expect(delivered.outcome).toBe('stop_bridge_block');
    expect(delivered.invariants.sourceUseRecordedBeforeTransport).toBe(true);
    expect(delivered.invariants.rawTransportIsSemanticAuthority).toBe(false);
    expect(delivered.sourceUseIds.length).toBeGreaterThan(0);
    expect(delivered.generatedOrigin).not.toBeNull();

    // The audit tables are written LIVE (P9-G2): generated-origin + source-use rows exist.
    const body = record.result.currentBody;
    const origin = resolvePromptEnhancementGeneratedOrigin(store, {
      projectRoot: PROJECT, bodyId: body.currentBodyId, bodyRevision: body.bodyRevision,
    });
    expect(origin).not.toBeNull();
    expect(origin!.learningEligible).toBe(false); // generated origin never feeds learning

    const sourceUse = getPromptEnhancementSourceUseSummary(store, PROJECT, body.currentBodyId);
    expect(sourceUse.totalSourceUses).toBeGreaterThan(0);
  });
});
