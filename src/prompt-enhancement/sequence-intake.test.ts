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
import { intakePromptEnhancementSequenceOnFirstSendV1 } from './sequence-intake.js';
import { openStore } from '../store/db.js';
import { upsertPendingPromptSequence, getActivePendingPromptSequence } from '../store/pending-sequences.js';

const MULTI_INTENT = 'Fix the failing payment test and add a rate limiter to the login endpoint.';
const SINGLE_INTENT = 'Fix the failing payment test.';
const PROJECT = '/tmp/seq-intake';

function request(text: string): PromptEnhancementPrepareRequestV1 {
  const sourceRef: PromptEnhancementSourceRefV1 = {
    sourceRefId: 'src-a-1', sourceKind: 'source_a_user_prompt', sourceId: 'prompt:1',
    sourceAuthorization: 'source_fact_only', evidenceStatus: 'present', freshness: 'current', confidence: 'high', privacyClass: 'public_safe',
  };
  const p = getPromptStartStopSourceSnapshot();
  return {
    schemaVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION, requestId: 'seq-intake-1', projectRoot: PROJECT, hostSurface: 'cli_stop_bridge',
    sourcePrompt: { text, origin: 'user', capturedAt: 1, promptIndex: 1, generatedOriginPolicy: 'ordinary_source_a' },
    reviewMomentContext: { reviewMoment: 'UserPromptSubmit_preparation', currentAgentMode: 'workspace-write', projectId: 'p1', sessionId: 's1', detectedLanguage: 'en', stageCandidate: 'implementation', promptCount: 1, recentPromptMetadataRefs: [], triggerProvenance: { currentStage: 'implementation', prevStage: 'task_breakdown', triggerKind: 'stage_transition', classifierState: 'fire_recommended', degradedNoActionState: 'none', promptStartBoundary: p.hookBoundary, deliveryBoundary: p.deliveryBoundary, promptStartCanReplaceSameTurn: false } },
    sourceSignals: { sourceAOriginalPromptRef: sourceRef, sourceRefs: [sourceRef], normalizedStageAbsenceSignalRefs: [], contentTemplateRecordFactRefs: [], popupQuestionSourceRefs: [], whyHelpSourceRefs: [], profileRoleModeRefs: [], rightGoodWorkStyleEnvRuntimeRefs: [], missingMemoryCandidateRefs: [], sourceLabels: [{ sourceRefId: sourceRef.sourceRefId, label: 'original_prompt', evidenceStatus: 'present' }], promptStartStop: { hookBoundary: p.hookBoundary, deliveryBoundary: p.deliveryBoundary, runAutoCanHoldOrReplaceSubmittedPrompt: false, sharedSignalCount: p.sharedSignalCount, classifierDegradedNoFireReasons: p.classifierDegradedNoFireReasons }, store: { schemaVersion: 1, missingPromptEnhancementTables: [], cleanupGaps: [] }, transcriptPathState: 'not_authority', streamBOutputs: [], paramEventChannels: [], servedVariantIdentityRefs: [], deliveryGateRefs: [], sourceOnlyHardFactRefs: [] },
    userPreferenceContext: { levelState: 'default', scopedFeedbackEvidenceRefs: [] },
    configSnapshot: { sequenceEnabledState: 'not_enabled_v1', validatedEffectiveConfigState: 'valid', arbitraryConfigRowsAreAuthority: false },
    callVisibilityState: buildPromptEnhancementCostVisibilityMetadataV1('baseline_pe_composer', { callVisibilityMode: 'deterministic', plannedCallCount: 0, usedCallCount: 0 }),
    privacyAndStoragePolicy: { sensitivityClass: 'normal', localStorageEligibility: 'ids_and_categories_only', telemetryEligibility: 'allowlisted_counts_only', llmSharingEligibility: 'allowed_minimal', generatedBodyStoragePolicy: 'do_not_store_raw_by_default' },
  };
}

async function preparedMultiIntent(): Promise<PromptEnhancementPrepareResultV1> {
  return preparePromptEnhancement(request(MULTI_INTENT));
}

describe('sequence intake on the explicit first send (fail-closed typed no-ops)', () => {
  it('records the sequence for a real multi-intent result: ids/counts only, never text', async () => {
    const result = await preparedMultiIntent();
    const intake = intakePromptEnhancementSequenceOnFirstSendV1({ result, projectRoot: PROJECT, sessionId: 's1' });
    expect(intake.state).toBe('sequence_recorded');
    if (intake.state !== 'sequence_recorded') return;
    // Live example: 2 points → first sent + 1 remaining.
    expect(intake.runtime).toMatchObject({
      enhancementId: result.enhancementId,
      projectRoot: PROJECT,
      sessionId: 's1',
      itemCount: 2,
      currentItemIndex: 0,
      status: 'awaiting_response',
    });
    expect(intake.runtime.sequenceId).toBe(result.uiView.handoffAndSequenceSummary!.handoffDecisionId);
    // The recorded state carries NO prompt text field at all.
    expect(Object.values(intake.runtime).some((value) => typeof value === 'string' && value.includes('payment'))).toBe(false);
  });

  it('single-intent result → handoff_missing (typed no-op, ordinary flow)', async () => {
    const result = await preparePromptEnhancement(request(SINGLE_INTENT));
    expect(intakePromptEnhancementSequenceOnFirstSendV1({ result, projectRoot: PROJECT, sessionId: 's1' }))
      .toEqual({ state: 'no_sequence', reasonCode: 'handoff_missing' });
  });

  it('foreign project → scope_mismatch (cross-project policy is reject)', async () => {
    const result = await preparedMultiIntent();
    expect(intakePromptEnhancementSequenceOnFirstSendV1({ result, projectRoot: '/tmp/other-project', sessionId: 's1' }))
      .toEqual({ state: 'no_sequence', reasonCode: 'scope_mismatch' });
  });

  it('tampered handoff (safety policy flipped) → handoff_invalid (re-validated at intake)', async () => {
    const result = await preparedMultiIntent();
    const tampered: PromptEnhancementPrepareResultV1 = {
      ...result,
      uiView: {
        ...result.uiView,
        handoffAndSequenceSummary: {
          ...result.uiView.handoffAndSequenceSummary!,
          sequenceActivationPolicy: 'activated' as never,
        },
      },
    };
    expect(intakePromptEnhancementSequenceOnFirstSendV1({ result: tampered, projectRoot: PROJECT, sessionId: 's1' }))
      .toEqual({ state: 'no_sequence', reasonCode: 'handoff_invalid' });
  });

  it('zero remaining items → no_remaining_items (nothing to continue)', async () => {
    const result = await preparedMultiIntent();
    const summary = result.uiView.handoffAndSequenceSummary!.compactFirstPopupSequenceSummary!;
    const drained: PromptEnhancementPrepareResultV1 = {
      ...result,
      uiView: {
        ...result.uiView,
        handoffAndSequenceSummary: {
          ...result.uiView.handoffAndSequenceSummary!,
          compactFirstPopupSequenceSummary: { ...summary, remainingTaskCount: 0 },
        },
      },
    };
    expect(intakePromptEnhancementSequenceOnFirstSendV1({ result: drained, projectRoot: PROJECT, sessionId: 's1' }))
      .toEqual({ state: 'no_sequence', reasonCode: 'no_remaining_items' });
  });

  it('caps the item count at 30 — a very long sequence still records, clamped, never dropped (owner request 2026-08-08)', async () => {
    const result = await preparedMultiIntent();
    const summary = result.uiView.handoffAndSequenceSummary!.compactFirstPopupSequenceSummary!;
    const huge: PromptEnhancementPrepareResultV1 = {
      ...result,
      uiView: {
        ...result.uiView,
        handoffAndSequenceSummary: {
          ...result.uiView.handoffAndSequenceSummary!,
          // 199 remaining → 200 total before the cap.
          compactFirstPopupSequenceSummary: { ...summary, remainingTaskCount: 199 },
        },
      },
    };
    const intake = intakePromptEnhancementSequenceOnFirstSendV1({ result: huge, projectRoot: PROJECT, sessionId: 's1' });
    expect(intake.state).toBe('sequence_recorded');
    if (intake.state !== 'sequence_recorded') return;
    expect(intake.runtime.itemCount).toBe(30);
  });

  it('end-to-end with the store: intake → upsert → active row readable, foreign session scrubs', async () => {
    const result = await preparedMultiIntent();
    const intake = intakePromptEnhancementSequenceOnFirstSendV1({ result, projectRoot: PROJECT, sessionId: 's1' });
    expect(intake.state).toBe('sequence_recorded');
    if (intake.state !== 'sequence_recorded') return;
    const store = await openStore(':memory:');
    expect(upsertPendingPromptSequence(store, intake.runtime, intake.payload)).toBe(true);
    expect(getActivePendingPromptSequence(store, PROJECT, 's1')).toMatchObject({
      sequenceId: intake.runtime.sequenceId,
      itemCount: 2,
      status: 'awaiting_response',
      // The payload round-trips: no planner yet, so an empty list at the default policy, with
      // the length the future offsets will index into already known.
      payload: {
        items: [],
        promptDirectives: [],
        suggestedNextPromptPolicy: 'not_generated',
        originalLength: result.currentBody.originalPromptText.length,
        offerDisposition: 'accepted',
      },
    });
  });
});
