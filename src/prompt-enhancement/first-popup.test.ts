import { describe, expect, it } from 'vitest';
import {
  PROMPT_ENHANCEMENT_CONTRACT_VERSION,
  type PromptEnhancementPrepareRequestV1,
  type PromptEnhancementSourceRefV1,
} from './contracts.js';
import { buildPromptEnhancementHandoffMetadataV1 } from './handoff-metadata.js';
import { preparePromptEnhancement } from './facade.js';
import {
  buildPromptEnhancementMpsFirstPopupV1,
  createPromptEnhancementMpsCancelIntentV1,
  createPromptEnhancementMpsCurrentBodyIntentV1,
} from './first-popup.js';
import { buildPromptEnhancementCostVisibilityMetadataV1 } from './cost-observability.js';
import { getPromptStartStopSourceSnapshot } from './source-reality.js';

function request(): PromptEnhancementPrepareRequestV1 {
  const sourceRef: PromptEnhancementSourceRefV1 = {
    sourceRefId: 'b31-source-1',
    sourceKind: 'source_a_user_prompt',
    sourceId: 'prompt:b31',
    sourceAuthorization: 'source_fact_only',
    evidenceStatus: 'present',
    freshness: 'current',
    confidence: 'high',
    privacyClass: 'public_safe',
  };
  const boundaries = getPromptStartStopSourceSnapshot();
  return {
    schemaVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
    requestId: 'b31-request',
    projectRoot: '/tmp/b31-project',
    hostSurface: 'cli_stop_bridge',
    sourcePrompt: {
      text: 'Review the payment flow and explain the verification steps.',
      origin: 'user',
      capturedAt: 1,
      promptIndex: 1,
      generatedOriginPolicy: 'ordinary_source_a',
    },
    reviewMomentContext: {
      reviewMoment: 'UserPromptSubmit_preparation',
      currentAgentMode: 'workspace-write',
      projectId: 'b31-project',
      sessionId: 'b31-session',
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
        promptStartBoundary: boundaries.hookBoundary,
        deliveryBoundary: boundaries.deliveryBoundary,
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
        hookBoundary: boundaries.hookBoundary,
        deliveryBoundary: boundaries.deliveryBoundary,
        runAutoCanHoldOrReplaceSubmittedPrompt: false,
        sharedSignalCount: boundaries.sharedSignalCount,
        classifierDegradedNoFireReasons: boundaries.classifierDegradedNoFireReasons,
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
  };
}

async function validFirstPopup() {
  const result = await preparePromptEnhancement(request());
  const handoff = buildPromptEnhancementHandoffMetadataV1({
    handoffDecisionId: `${result.enhancementId}:mps-handoff`,
    requestId: result.requestId,
    projectRoot: result.projectRoot,
    currentBody: result.currentBody,
    safetySummary: result.safetySummary,
    handoffKind: 'first_prompt_handoff_candidate',
    summary: {
      summaryId: `${result.enhancementId}:mps-summary`,
      publicSafeText: 'One remaining verification task is available as metadata.',
      remainingTaskCount: 1,
      taskRoleLabels: ['verification'],
    },
  });
  return buildPromptEnhancementMpsFirstPopupV1({
    result,
    handoffMetadata: handoff,
    additionalDetails: { text: 'Use the existing payment fixture.', revision: 1 },
    cancel: { state: 'available', disposition: 'blocked_no_send' },
  });
}

describe('stage-3-1 first MPS popup', () => {
  it('renders only the validated first body, details, cancel, and compact plan in locked order', async () => {
    const built = await validFirstPopup();
    expect(built.state).toBe('ready');
    if (built.state !== 'ready') return;
    expect(built.model.title).toBe('Nexpath · Multi-prompt sequence');
    expect(built.model.heading).toBe('Use enhanced sequence prompt');
    expect(built.model.layout).toEqual(['enhanced_body', 'additional_details', 'cancel_remaining_sequence', 'sequence_plan']);
    expect(built.model.actions.originalPrompt).toBe('not_rendered');
    expect(built.model.sequencePlan).toEqual({ remainingTaskCount: 1, taskRoleLabels: ['verification'], taskSummaryLines: [] });
    expect(built.model.authority).toEqual({
      localSequenceRuntime: false, localQueuePointer: false, localAutoSend: false, localAdvance: false, hostTransport: false,
    });
  });

  // MPS-10 (9.1): the first-popup surface's serialized model must render NONE of the forbidden values —
  // no absolute path, no sequence config key, no literal `Decision Session`, no legacy sentinel. Same
  // substring-over-the-whole-model rule the shipping fixture runners enforce (acceptance-fixtures.ts:121).
  it('renders no forbidden value and never leaks the project path (MPS-10 forbidden-value list)', async () => {
    const built = await validFirstPopup();
    if (built.state !== 'ready') throw new Error('fixture did not render');
    const rendered = JSON.stringify(built.model);
    const forbidden = [
      '/home/', 'prompt_enhancement.sequence.enabled', 'Decision Session',
      'private-provider-error-must-not-render', 'legacy-role-must-not-render',
      'legacy-frequency-must-not-render', 'legacy-history-must-not-render',
      'legacy-selected-prompt-must-not-render', 'legacy-host-state-must-not-render',
      'legacy-label-must-not-render',
    ];
    expect(forbidden.filter((value) => rendered.includes(value))).toEqual([]);
    // The surface never carries the absolute project path — so no /home/-class path can leak, whatever the root.
    expect(rendered).not.toContain('/tmp/b31-project');
  });

  it('emits one typed current-body-plus-details intent without merging or sending locally', async () => {
    const built = await validFirstPopup();
    if (built.state !== 'ready') throw new Error('fixture did not render');
    const intent = createPromptEnhancementMpsCurrentBodyIntentV1(built.model, {
      editedBodyText: `${built.model.body.text}\nAdded acceptance note`,
      additionalDetailsText: built.model.additionalDetails.text,
      additionalDetailsRevision: 2,
    });
    expect(intent).toEqual({
      state: 'intent_ready',
      reasonCodes: [],
      intent: expect.objectContaining({
        type: 'send_current_body',
        editedBodyText: expect.stringContaining('Added acceptance note'),
        additionalDetailsText: 'Use the existing payment fixture.',
        additionalDetailsRevision: 2,
      }),
    });
    if (intent.state === 'intent_ready') expect(intent.intent.type).toBe('send_current_body');
  });

  it('emits only blocked_no_send for an explicit cancel and suppresses disabled cancel', async () => {
    const built = await validFirstPopup();
    if (built.state !== 'ready') throw new Error('fixture did not render');
    const cancel = createPromptEnhancementMpsCancelIntentV1(built.model);
    expect(cancel.state).toBe('intent_ready');
    if (cancel.state === 'intent_ready') {
      expect(cancel.intent).toMatchObject({ type: 'cancel_remaining_sequence', disposition: 'blocked_no_send' });
    }
    const disabled = await buildPromptEnhancementMpsFirstPopupV1({
      result: await preparePromptEnhancement(request()),
      handoffMetadata: (await (async () => {
        const result = await preparePromptEnhancement(request());
        return buildPromptEnhancementHandoffMetadataV1({
          handoffDecisionId: `${result.enhancementId}:mps-handoff-disabled`, requestId: result.requestId,
          projectRoot: result.projectRoot, currentBody: result.currentBody, safetySummary: result.safetySummary,
          handoffKind: 'first_prompt_handoff_candidate',
          summary: { summaryId: 'b31-disabled-summary', publicSafeText: 'Metadata only.', remainingTaskCount: 1, taskRoleLabels: ['verification'] },
        });
      })()),
      cancel: { state: 'disabled', disposition: 'blocked_no_send' },
    });
    expect(disabled.state).toBe('ready');
    if (disabled.state === 'ready') {
      expect(createPromptEnhancementMpsCancelIntentV1(disabled.model)).toEqual({
        state: 'intent_unavailable', reasonCodes: ['mps_cancel_disabled'],
      });
    }
  });

  it('fails closed on stale handoff identity and never falls back to future prompt text', async () => {
    const result = await preparePromptEnhancement(request());
    const handoff = buildPromptEnhancementHandoffMetadataV1({
      handoffDecisionId: 'b31-stale-handoff', requestId: result.requestId, projectRoot: result.projectRoot,
      currentBody: { ...result.currentBody, bodyRevision: result.currentBody.bodyRevision + 1 },
      safetySummary: result.safetySummary, handoffKind: 'first_prompt_handoff_candidate',
      summary: { summaryId: 'b31-stale-summary', publicSafeText: 'Metadata only.', remainingTaskCount: 9, taskRoleLabels: ['future'] },
    });
    const built = buildPromptEnhancementMpsFirstPopupV1({
      result, handoffMetadata: handoff, cancel: { state: 'available', disposition: 'blocked_no_send' },
    });
    expect(built.state).toBe('no_popup');
    if (built.state === 'no_popup') expect(built.reasonCodes).toContain('invalid_mps_handoff');
  });
});
