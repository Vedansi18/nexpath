import { describe, expect, it } from 'vitest';
import {
  PROMPT_ENHANCEMENT_CONTRACT_VERSION,
  type PromptEnhancementFutureSequenceRuntimeEventV1,
  type PromptEnhancementPrepareRequestV1,
  type PromptEnhancementSourceRefV1,
} from './contracts.js';
import { buildPromptEnhancementHandoffMetadataV1 } from './handoff-metadata.js';
import { preparePromptEnhancement } from './facade.js';
import { buildPromptEnhancementCostVisibilityMetadataV1 } from './cost-observability.js';
import { getPromptStartStopSourceSnapshot } from './source-reality.js';
import { buildPromptEnhancementMpsContinuationPopupV1 } from './continuation-popup.js';
import { buildPromptEnhancementMpsResultPresentationV1 } from './result-presentation.js';

function request(): PromptEnhancementPrepareRequestV1 {
  const sourceRef: PromptEnhancementSourceRefV1 = {
    sourceRefId: 'b33-source-1', sourceKind: 'source_a_user_prompt', sourceId: 'prompt:b33',
    sourceAuthorization: 'source_fact_only', evidenceStatus: 'present', freshness: 'current', confidence: 'high', privacyClass: 'public_safe',
  };
  const boundaries = getPromptStartStopSourceSnapshot();
  return {
    schemaVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION, requestId: 'b33-request', projectRoot: '/tmp/b33-project', hostSurface: 'cli_stop_bridge',
    sourcePrompt: { text: 'Review this sequence result and explain verification.', origin: 'user', capturedAt: 1, promptIndex: 1, generatedOriginPolicy: 'ordinary_source_a' },
    reviewMomentContext: {
      reviewMoment: 'UserPromptSubmit_preparation', currentAgentMode: 'workspace-write', projectId: 'b33-project', sessionId: 'b33-session', detectedLanguage: 'en', stageCandidate: 'implementation', promptCount: 1, recentPromptMetadataRefs: [],
      triggerProvenance: { currentStage: 'implementation', prevStage: 'task_breakdown', triggerKind: 'stage_transition', classifierState: 'fire_recommended', degradedNoActionState: 'none', promptStartBoundary: boundaries.hookBoundary, deliveryBoundary: boundaries.deliveryBoundary, promptStartCanReplaceSameTurn: false },
    },
    sourceSignals: {
      sourceAOriginalPromptRef: sourceRef, sourceRefs: [sourceRef], normalizedStageAbsenceSignalRefs: [], contentTemplateRecordFactRefs: [], popupQuestionSourceRefs: [], whyHelpSourceRefs: [], profileRoleModeRefs: [], rightGoodWorkStyleEnvRuntimeRefs: [], missingMemoryCandidateRefs: [], sourceLabels: [{ sourceRefId: sourceRef.sourceRefId, label: 'original_prompt', evidenceStatus: 'present' }],
      promptStartStop: { hookBoundary: boundaries.hookBoundary, deliveryBoundary: boundaries.deliveryBoundary, runAutoCanHoldOrReplaceSubmittedPrompt: false, sharedSignalCount: boundaries.sharedSignalCount, classifierDegradedNoFireReasons: boundaries.classifierDegradedNoFireReasons },
      store: { schemaVersion: 1, missingPromptEnhancementTables: [], cleanupGaps: [] }, transcriptPathState: 'not_authority', streamBOutputs: [], paramEventChannels: [], servedVariantIdentityRefs: [], deliveryGateRefs: [], sourceOnlyHardFactRefs: [],
    },
    userPreferenceContext: { levelState: 'default', scopedFeedbackEvidenceRefs: [] },
    configSnapshot: { sequenceEnabledState: 'not_enabled_v1', validatedEffectiveConfigState: 'valid', arbitraryConfigRowsAreAuthority: false },
    callVisibilityState: buildPromptEnhancementCostVisibilityMetadataV1('baseline_pe_composer', { callVisibilityMode: 'deterministic', plannedCallCount: 0, usedCallCount: 0 }),
    privacyAndStoragePolicy: { sensitivityClass: 'normal', localStorageEligibility: 'ids_and_categories_only', telemetryEligibility: 'allowlisted_counts_only', llmSharingEligibility: 'allowed_minimal', generatedBodyStoragePolicy: 'do_not_store_raw_by_default' },
  };
}

async function fixture() {
  const result = await preparePromptEnhancement(request());
  const handoff = buildPromptEnhancementHandoffMetadataV1({ handoffDecisionId: `${result.enhancementId}:handoff`, requestId: result.requestId, projectRoot: result.projectRoot, currentBody: result.currentBody, safetySummary: result.safetySummary, handoffKind: 'first_prompt_handoff_candidate', summary: { summaryId: `${result.enhancementId}:summary`, publicSafeText: 'Metadata only.', remainingTaskCount: 1, taskRoleLabels: ['verification'] } });
  const event: PromptEnhancementFutureSequenceRuntimeEventV1 = { requestId: result.requestId, projectScope: result.projectRoot, sequenceId: 'sequence-1', sequenceItemId: 'item-2', currentItemRevision: 2, bodyRevision: result.currentBody.bodyRevision, contractVersion: 1, stateFreshness: 'current', stopEventState: 'stop_fired_non_proof', terminalTransitionState: 'none', idempotencyKey: 'b33-idem', createdAtMs: 2 };
  const popup = buildPromptEnhancementMpsContinuationPopupV1({ result, handoffMetadata: handoff, event, additionalDetails: { text: 'Details', revision: 1 }, cancel: { state: 'available', disposition: 'blocked_no_send' } });
  if (popup.state !== 'ready') throw new Error('continuation fixture did not render');
  return { result, handoff, popup: popup.model };
}

describe('stage-3-3 typed MPS result presentation', () => {
  it('preserves the reviewed body/details for typed send pending and does not claim delivery', async () => {
    const fixtureData = await fixture();
    const intent = { type: 'send_current_body' as const, identity: fixtureData.popup.identity, editedBodyText: 'Reviewed body', additionalDetailsText: 'Details', additionalDetailsRevision: 1 };
    const presented = buildPromptEnhancementMpsResultPresentationV1({ result: fixtureData.result, handoffMetadata: fixtureData.handoff, intent, typedResult: { ...fixtureData.popup.identity, state: 'send_current_pending' } });
    expect(presented.state).toBe('presented');
    if (presented.state === 'presented') {
      expect(presented.model.reviewedBody).toEqual({ text: 'Reviewed body', additionalDetailsText: 'Details', bodyRevision: fixtureData.popup.identity.bodyRevision, detailsRevision: 1 });
      expect(presented.model.authority).toEqual({ deliveryProof: false, completionProof: false, pointerAdvance: false, retry: false, recovery: false, feedbackDecision: false, hostTransport: false });
    }
  });

  it('closes only for typed custom interruption and exposes feedback only when typed eligible', async () => {
    const fixtureData = await fixture();
    const interruption = { type: 'custom_interruption' as const, identity: fixtureData.popup.identity };
    const interrupted = buildPromptEnhancementMpsResultPresentationV1({ result: fixtureData.result, handoffMetadata: fixtureData.handoff, intent: interruption, typedResult: { ...fixtureData.popup.identity, state: 'custom_interruption_acknowledged' } });
    expect(interrupted.state).toBe('presented');
    if (interrupted.state === 'presented') expect(interrupted.model).toMatchObject({ popupClosed: true, feedback: 'not_rendered' });
    const cancel = { type: 'cancel_remaining_sequence' as const, identity: fixtureData.popup.identity, disposition: 'blocked_no_send' as const };
    const cancelled = buildPromptEnhancementMpsResultPresentationV1({ result: fixtureData.result, handoffMetadata: fixtureData.handoff, intent: cancel, typedResult: { ...fixtureData.popup.identity, state: 'cancel_acknowledged', feedbackEligibility: 'eligible' } });
    expect(cancelled.state).toBe('presented');
    if (cancelled.state === 'presented') expect(cancelled.model.feedback).toBe('render_typed_eligible_feedback_state');
  });

  it('fails closed on stale, mismatched, and wrong-intent results without a guessed recovery action', async () => {
    const fixtureData = await fixture();
    const intent = { type: 'cancel_remaining_sequence' as const, identity: fixtureData.popup.identity, disposition: 'blocked_no_send' as const };
    const make = (typedResult: Parameters<typeof buildPromptEnhancementMpsResultPresentationV1>[0]['typedResult']) => buildPromptEnhancementMpsResultPresentationV1({ result: fixtureData.result, handoffMetadata: fixtureData.handoff, intent, typedResult });
    expect(make({ ...fixtureData.popup.identity, state: 'stale' })).toMatchObject({ state: 'presented', model: { state: 'stale', authority: { retry: false, recovery: false } } });
    expect(make({ ...fixtureData.popup.identity, sequenceId: 'other-sequence', state: 'cancel_acknowledged' }).state).toBe('no_presentation');
    expect(make({ ...fixtureData.popup.identity, state: 'send_current_pending' }).state).toBe('no_presentation');
  });
});
