import { describe, expect, it } from 'vitest';
import {
  PROMPT_ENHANCEMENT_CONTRACT_VERSION,
  type PromptEnhancementActionEntryV1,
  type PromptEnhancementPrepareRequestV1,
  type PromptEnhancementSourceRefV1,
} from './contracts.js';
import {
  applyPromptEnhancementAction,
  preparePromptEnhancement,
} from './facade.js';
import { buildPromptEnhancementCostVisibilityMetadataV1 } from './cost-observability.js';
import {
  buildPromptEnhancementActionRequestV1,
} from './action-adapter.js';
import {
  buildPromptEnhancementAdjustmentStateV1,
  failPromptEnhancementAdjustmentV1,
  finalizePromptEnhancementAdjustmentSessionV1,
  goBackPromptEnhancementAdjustmentV1,
  resolvePromptEnhancementAdjustmentV1,
  selectPromptEnhancementAdjustmentV1,
  updatePromptEnhancementAdjustmentMainSnapshotV1,
  type PromptEnhancementAdjustmentPresentationSnapshotV1,
} from './adjustment-state.js';
import { buildPromptEnhancementLocalDraftV1 } from './local-draft.js';
import { buildPromptEnhancementPopupSessionV1 } from './popup-session.js';
import { getPromptStartStopSourceSnapshot } from './source-reality.js';

function request(overrides: Partial<PromptEnhancementPrepareRequestV1> = {}): PromptEnhancementPrepareRequestV1 {
  const sourceRef: PromptEnhancementSourceRefV1 = {
    sourceRefId: 'b13a-source-1',
    sourceKind: 'source_a_user_prompt',
    sourceId: 'prompt:b13a',
    sourceAuthorization: 'source_fact_only',
    evidenceStatus: 'present',
    freshness: 'current',
    confidence: 'high',
    privacyClass: 'public_safe',
  };
  const promptStartStop = getPromptStartStopSourceSnapshot();
  return {
    schemaVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
    requestId: 'b13a-test-base',
    projectRoot: '/tmp/b13a-project',
    hostSurface: 'cli_stop_bridge',
    sourcePrompt: {
      text: 'Fix the failing payment test and explain the verification.',
      origin: 'user',
      capturedAt: 1,
      promptIndex: 1,
      generatedOriginPolicy: 'ordinary_source_a',
    },
    reviewMomentContext: {
      reviewMoment: 'UserPromptSubmit_preparation',
      currentAgentMode: 'workspace-write',
      projectId: 'b13a-project',
      sessionId: 'b13a-session',
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
      callVisibilityMode: 'deterministic', plannedCallCount: 0, usedCallCount: 0,
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

function adjustment(
  snapshot: PromptEnhancementAdjustmentPresentationSnapshotV1,
  actionType: 'shorter' | 'more_thorough' | 'more_project_grounded' = 'shorter',
): PromptEnhancementActionEntryV1 {
  return snapshot.session.directionalActionSet.find((entry) => entry.action.actionType === actionType)!.action;
}

async function preparedState() {
  const baseRequest = request();
  const result = await preparePromptEnhancement(baseRequest);
  const session = buildPromptEnhancementPopupSessionV1({
    viewPayload: result.uiView,
    validationDecisionId: result.validationDecisionId,
    timestampMs: 10,
  });
  const builtDraft = buildPromptEnhancementLocalDraftV1(session);
  if (builtDraft.state === 'no_draft') throw new Error('fixture draft failed');
  const snapshot: PromptEnhancementAdjustmentPresentationSnapshotV1 = {
    session,
    draft: builtDraft.draft,
    focusedField: 'enhanced_body',
    selectedActionId: session.directionalActionSet[0]!.action.actionId,
    additionalDetailsRevision: 0,
    mainDraftRevision: 0,
  };
  return { baseRequest, result, session, draft: builtDraft.draft, state: buildPromptEnhancementAdjustmentStateV1(snapshot) };
}

describe('B1.3a locked adjustment comparison and instant Back state', () => {
  it('hides the main surface, creates a distinct request identity, and Back performs no facade request', async () => {
    const fixture = await preparedState();
    const action = adjustment(fixture.state.mainSnapshot);
    const selected = selectPromptEnhancementAdjustmentV1(fixture.state, action);
    expect(selected.state).toBe('request_required');
    if (selected.state !== 'request_required') return;
    expect(selected.adjustmentState.surface).toBe('refinement');
    expect(selected.adjustmentState.inFlight?.request.requestId).not.toBe(fixture.baseRequest.requestId);
    const restored = goBackPromptEnhancementAdjustmentV1(selected.adjustmentState);
    expect(restored.surface).toBe('main');
    expect(restored.mainSnapshot.draft).toEqual(fixture.state.mainSnapshot.draft);
    expect(restored.inFlight).toBeUndefined();
    expect(restored.invalidatedRequestIds).toContain(selected.request.requestId);
  });

  it('ignores a late result after Back and prevents duplicate action selection while refinement is visible', async () => {
    const fixture = await preparedState();
    const action = adjustment(fixture.state.mainSnapshot);
    const selected = selectPromptEnhancementAdjustmentV1(fixture.state, action);
    if (selected.state !== 'request_required') throw new Error('selection did not request');
    const duplicate = selectPromptEnhancementAdjustmentV1(selected.adjustmentState, action);
    expect(duplicate.state).toBe('no_request');
    const restored = goBackPromptEnhancementAdjustmentV1(selected.adjustmentState);
    const late = resolvePromptEnhancementAdjustmentV1(restored, {
      requestId: selected.request.requestId,
      result: {},
      session: fixture.session,
      draft: fixture.draft,
    });
    expect(late.state).toBe('stale_result_ignored');
  });

  it('accepts one typed result, restores its cached refinement, and keeps action caches isolated', async () => {
    const fixture = await preparedState();
    const action = adjustment(fixture.state.mainSnapshot);
    const selected = selectPromptEnhancementAdjustmentV1(fixture.state, action);
    if (selected.state !== 'request_required') throw new Error('selection did not request');
    const actionRequest = buildPromptEnhancementActionRequestV1({
      baseRequest: fixture.baseRequest,
      session: fixture.session,
      action,
      editedBodyText: fixture.draft.currentBody.text,
      timestampMs: 20,
    });
    if (actionRequest.state === 'no_request') throw new Error(actionRequest.reasonCodes.join(','));
    const result = await applyPromptEnhancementAction(actionRequest.request);
    const refinedSession = buildPromptEnhancementPopupSessionV1({
      viewPayload: result.uiView,
      validationDecisionId: result.validationDecisionId,
      timestampMs: 21,
    });
    const refinedDraft = buildPromptEnhancementLocalDraftV1(refinedSession);
    if (refinedDraft.state === 'no_draft') throw new Error('refined draft failed');
    const resolved = resolvePromptEnhancementAdjustmentV1(selected.adjustmentState, {
      requestId: selected.request.requestId,
      result,
      session: refinedSession,
      draft: refinedDraft.draft,
      focusedField: 'enhanced_body',
      selectedActionId: action.actionId,
    });
    expect(resolved.state).toBe('accepted_refinement');
    if (resolved.state !== 'accepted_refinement') return;
    const restoredMain = goBackPromptEnhancementAdjustmentV1(resolved.adjustmentState);
    const restored = selectPromptEnhancementAdjustmentV1(restoredMain, action);
    expect(restored.state).toBe('cached_refinement_restored');
    if (restored.state === 'cached_refinement_restored') {
      expect(restored.cache.refinedBodyRevision).toBe(result.uiView.body.bodyRevision);
      expect(restored.adjustmentState.refinement?.draft).toEqual(refinedDraft.draft);
    }
  });

  it('invalidates every cached adjustment after a main body/details revision change', async () => {
    const fixture = await preparedState();
    const changedDraft = {
      ...fixture.draft,
      currentBody: { ...fixture.draft.currentBody, text: `${fixture.draft.currentBody.text} edited`, dirty: true },
    };
    const changed = updatePromptEnhancementAdjustmentMainSnapshotV1(fixture.state, {
      draft: changedDraft,
      focusedField: 'enhanced_body',
      selectedActionId: fixture.state.mainSnapshot.selectedActionId,
      additionalDetailsRevision: 1,
    });
    expect(changed.mainSnapshot.mainDraftRevision).toBe(1);
    expect(changed.cache).toEqual([]);
    const next = selectPromptEnhancementAdjustmentV1(changed, adjustment(changed.mainSnapshot));
    expect(next.state).toBe('request_required');
  });

  it('keeps action-to-action refinement state isolated and preserves focus/cursor/scroll fields', async () => {
    const fixture = await preparedState();
    const shorter = adjustment(fixture.state.mainSnapshot, 'shorter');
    const thorough = adjustment(fixture.state.mainSnapshot, 'more_thorough');
    const first = selectPromptEnhancementAdjustmentV1(fixture.state, shorter);
    if (first.state !== 'request_required') throw new Error('shorter selection did not request');
    const firstBack = goBackPromptEnhancementAdjustmentV1(first.adjustmentState);
    const second = selectPromptEnhancementAdjustmentV1(firstBack, thorough);
    expect(second.state).toBe('request_required');
    if (second.state !== 'request_required') return;
    expect(second.request.actionId).not.toBe(first.request.actionId);
    expect(second.adjustmentState.refinement?.base).toEqual(first.adjustmentState.refinement?.base);
    const blockedMainUpdate = updatePromptEnhancementAdjustmentMainSnapshotV1(second.adjustmentState, {
      draft: fixture.draft, focusedField: 'additional_details', selectedActionId: thorough.actionId, additionalDetailsRevision: 0,
    });
    expect(blockedMainUpdate.reasonCodes).toContain('main_snapshot_not_editable_while_refinement_visible');
  });

  it('does not replace the active refinement when a mismatched typed result arrives', async () => {
    const fixture = await preparedState();
    const selected = selectPromptEnhancementAdjustmentV1(fixture.state, adjustment(fixture.state.mainSnapshot));
    if (selected.state !== 'request_required') throw new Error('selection did not request');
    const stale = resolvePromptEnhancementAdjustmentV1(selected.adjustmentState, {
      requestId: `:stale`, result: {}, session: fixture.session, draft: fixture.draft,
    });
    expect(stale.state).toBe('stale_result_ignored');
    expect(stale.adjustmentState.inFlight?.request.requestId).toBe(selected.request.requestId);
  });

  it('clears ephemeral caches when a final current/original action is selected', async () => {
    const fixture = await preparedState();
    const terminal = finalizePromptEnhancementAdjustmentSessionV1(fixture.state, 'use_current_body');
    expect(terminal.surface).toBe('terminal');
    expect(terminal.cache).toEqual([]);
    expect(terminal.inFlight).toBeUndefined();
  });

  it("detaches an unavailable refinement and keeps the saved main snapshot", async () => {
    const fixture = await preparedState();
    const selected = selectPromptEnhancementAdjustmentV1(fixture.state, adjustment(fixture.state.mainSnapshot));
    if (selected.state !== "request_required") throw new Error("selection did not request");
    const failed = failPromptEnhancementAdjustmentV1(selected.adjustmentState, "provider_unavailable_keep_previous");
    expect(failed.surface).toBe("refinement");
    expect(failed.refinement?.status).toBe("failed_keep_previous");
    expect(failed.inFlight).toBeUndefined();
    expect(failed.mainSnapshot.draft).toEqual(fixture.state.mainSnapshot.draft);
  });
});
