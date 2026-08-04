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
import {
  buildPromptEnhancementMpsContinuationPopupV1,
  createPromptEnhancementMpsContinuationCancelIntentV1,
  createPromptEnhancementMpsContinuationSendIntentV1,
  createPromptEnhancementMpsCustomInterruptionIntentV1,
} from './b3-continuation-popup.js';

function request(): PromptEnhancementPrepareRequestV1 {
  const sourceRef: PromptEnhancementSourceRefV1 = {
    sourceRefId: 'b32-source-1', sourceKind: 'source_a_user_prompt', sourceId: 'prompt:b32',
    sourceAuthorization: 'source_fact_only', evidenceStatus: 'present', freshness: 'current',
    confidence: 'high', privacyClass: 'public_safe',
  };
  const boundaries = getPromptStartStopSourceSnapshot();
  return {
    schemaVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION, requestId: 'b32-request', projectRoot: '/tmp/b32-project',
    hostSurface: 'cli_stop_bridge',
    sourcePrompt: { text: 'Review this continuation item and explain the verification.', origin: 'user', capturedAt: 1, promptIndex: 1, generatedOriginPolicy: 'ordinary_source_a' },
    reviewMomentContext: {
      reviewMoment: 'UserPromptSubmit_preparation', currentAgentMode: 'workspace-write', projectId: 'b32-project',
      sessionId: 'b32-session', detectedLanguage: 'en', stageCandidate: 'implementation', promptCount: 1,
      recentPromptMetadataRefs: [], triggerProvenance: {
        currentStage: 'implementation', prevStage: 'task_breakdown', triggerKind: 'stage_transition',
        classifierState: 'fire_recommended', degradedNoActionState: 'none', promptStartBoundary: boundaries.hookBoundary,
        deliveryBoundary: boundaries.deliveryBoundary, promptStartCanReplaceSameTurn: false,
      },
    },
    sourceSignals: {
      sourceAOriginalPromptRef: sourceRef, sourceRefs: [sourceRef], normalizedStageAbsenceSignalRefs: [],
      contentTemplateRecordFactRefs: [], popupQuestionSourceRefs: [], whyHelpSourceRefs: [], profileRoleModeRefs: [],
      rightGoodWorkStyleEnvRuntimeRefs: [], missingMemoryCandidateRefs: [],
      sourceLabels: [{ sourceRefId: sourceRef.sourceRefId, label: 'original_prompt', evidenceStatus: 'present' }],
      promptStartStop: { hookBoundary: boundaries.hookBoundary, deliveryBoundary: boundaries.deliveryBoundary,
        runAutoCanHoldOrReplaceSubmittedPrompt: false, sharedSignalCount: boundaries.sharedSignalCount,
        classifierDegradedNoFireReasons: boundaries.classifierDegradedNoFireReasons },
      store: { schemaVersion: 1, missingPromptEnhancementTables: [], cleanupGaps: [] }, transcriptPathState: 'not_authority',
      streamBOutputs: [], paramEventChannels: [], servedVariantIdentityRefs: [], deliveryGateRefs: [], sourceOnlyHardFactRefs: [],
    },
    userPreferenceContext: { levelState: 'default', scopedFeedbackEvidenceRefs: [] },
    configSnapshot: { sequenceEnabledState: 'not_enabled_v1', validatedEffectiveConfigState: 'valid', arbitraryConfigRowsAreAuthority: false },
    callVisibilityState: buildPromptEnhancementCostVisibilityMetadataV1('baseline_pe_composer', { callVisibilityMode: 'deterministic', plannedCallCount: 0, usedCallCount: 0 }),
    privacyAndStoragePolicy: { sensitivityClass: 'normal', localStorageEligibility: 'ids_and_categories_only', telemetryEligibility: 'allowlisted_counts_only', llmSharingEligibility: 'allowed_minimal', generatedBodyStoragePolicy: 'do_not_store_raw_by_default' },
  };
}

async function validContinuation() {
  const result = await preparePromptEnhancement(request());
  const handoff = buildPromptEnhancementHandoffMetadataV1({
    handoffDecisionId: `${result.enhancementId}:mps-handoff`, requestId: result.requestId, projectRoot: result.projectRoot,
    currentBody: result.currentBody, safetySummary: result.safetySummary, handoffKind: 'first_prompt_handoff_candidate',
    summary: { summaryId: `${result.enhancementId}:summary`, publicSafeText: 'Metadata only.', remainingTaskCount: 1, taskRoleLabels: ['verification'] },
  });
  const event: PromptEnhancementFutureSequenceRuntimeEventV1 = {
    requestId: result.requestId, projectScope: result.projectRoot, sequenceId: 'sequence-1', sequenceItemId: 'item-2',
    currentItemRevision: 2, bodyRevision: result.currentBody.bodyRevision, continuationDispositionId: 'cont-1',
    contractVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION, stateFreshness: 'current', stopEventState: 'stop_fired_non_proof',
    terminalTransitionState: 'none', explicitUserActionState: 'present_future_only', idempotencyKey: 'b32-idem', createdAtMs: 2,
  };
  return buildPromptEnhancementMpsContinuationPopupV1({
    result, handoffMetadata: handoff, event, additionalDetails: { text: 'Keep the same fixture.', revision: 1 },
    cancel: { state: 'available', disposition: 'blocked_no_send' },
  });
}

describe('B3.2 later MPS continuation popup', () => {
  it('renders the locked continuation layout without the first-popup plan summary', async () => {
    const built = await validContinuation();
    expect(built.state).toBe('ready');
    if (built.state !== 'ready') return;
    expect(built.model.layout).toEqual(['enhanced_body', 'additional_details', 'custom_interruption', 'cancel_remaining_sequence']);
    expect(built.model.actions.customInterruption.helper).toContain('same sequence prompt returns');
    expect(built.model.actions.originalPrompt).toBe('not_rendered');
    expect(built.model.authority).toEqual({ localSequenceRuntime: false, localQueuePointer: false, localAutoSend: false, localAdvance: false, stopIsCompletionProof: false, customInterruptionIsCancel: false, hostTransport: false });
  });

  it('emits one bound send intent, a separate interruption intent, and typed cancel only', async () => {
    const built = await validContinuation();
    if (built.state !== 'ready') throw new Error('fixture did not render');
    const send = createPromptEnhancementMpsContinuationSendIntentV1(built.model, { editedBodyText: `${built.model.body.text}\nEdited`, additionalDetailsRevision: 2 });
    expect(send.state).toBe('intent_ready');
    if (send.state === 'intent_ready') expect(send.intent).toMatchObject({ type: 'send_current_body', additionalDetailsRevision: 2, identity: { sequenceId: 'sequence-1', sequenceItemId: 'item-2' } });
    expect(createPromptEnhancementMpsCustomInterruptionIntentV1(built.model)).toMatchObject({ state: 'intent_ready', intent: { type: 'custom_interruption' } });
    expect(createPromptEnhancementMpsContinuationCancelIntentV1(built.model)).toMatchObject({ state: 'intent_ready', intent: { type: 'cancel_remaining_sequence', disposition: 'blocked_no_send' } });
  });

  it('rejects stale, terminal, and completion-proof Stop inputs', async () => {
    const result = await preparePromptEnhancement(request());
    const handoff = buildPromptEnhancementHandoffMetadataV1({ handoffDecisionId: 'b32-handoff', requestId: result.requestId, projectRoot: result.projectRoot, currentBody: result.currentBody, safetySummary: result.safetySummary, handoffKind: 'first_prompt_handoff_candidate', summary: { summaryId: 'b32-summary', publicSafeText: 'Metadata only.', remainingTaskCount: 1, taskRoleLabels: ['verification'] } });
    const base: PromptEnhancementFutureSequenceRuntimeEventV1 = { requestId: result.requestId, projectScope: result.projectRoot, sequenceId: 's', sequenceItemId: 'i', currentItemRevision: 1, bodyRevision: result.currentBody.bodyRevision, contractVersion: 1, stateFreshness: 'current', stopEventState: 'stop_fired_non_proof', terminalTransitionState: 'none', idempotencyKey: 'k', createdAtMs: 1 };
    const make = (event: PromptEnhancementFutureSequenceRuntimeEventV1) => buildPromptEnhancementMpsContinuationPopupV1({ result, handoffMetadata: handoff, event, cancel: { state: 'available', disposition: 'blocked_no_send' } });
    expect(make({ ...base, stateFreshness: 'stale' }).state).toBe('no_popup');
    expect(make({ ...base, terminalTransitionState: 'completed_terminal' }).state).toBe('no_popup');
    expect(make({ ...base, stopEventState: 'not_applicable' }).state).toBe('no_popup');
  });
});
