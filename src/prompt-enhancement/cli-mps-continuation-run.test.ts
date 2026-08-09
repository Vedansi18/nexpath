import { describe, expect, it, vi } from 'vitest';
import {
  PROMPT_ENHANCEMENT_CONTRACT_VERSION,
  type PromptEnhancementFutureSequenceRuntimeEventV1,
  type PromptEnhancementHandoffMetadataV1,
  type PromptEnhancementPrepareRequestV1,
  type PromptEnhancementPrepareResultV1,
  type PromptEnhancementSourceRefV1,
} from './contracts.js';
import { buildPromptEnhancementHandoffMetadataV1 } from './handoff-metadata.js';
import { preparePromptEnhancement } from './facade.js';
import { buildPromptEnhancementCostVisibilityMetadataV1 } from './cost-observability.js';
import { getPromptStartStopSourceSnapshot } from './source-reality.js';
import { runPromptEnhancementCliMpsContinuationPopupV1 } from './cli-mps-continuation-run.js';
import type { PromptEnhancementCliMpsInteractionV1 } from './cli-mps-run.js';

const KEY = { enter: '\r', escape: '', up: '[A', down: '[B' } as const;

function request(): PromptEnhancementPrepareRequestV1 {
  const sourceRef: PromptEnhancementSourceRefV1 = {
    sourceRefId: 'cont-src-1', sourceKind: 'source_a_user_prompt', sourceId: 'prompt:cont',
    sourceAuthorization: 'source_fact_only', evidenceStatus: 'present', freshness: 'current', confidence: 'high', privacyClass: 'public_safe',
  };
  const p = getPromptStartStopSourceSnapshot();
  return {
    schemaVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION, requestId: 'cont-request', projectRoot: '/tmp/cont-project', hostSurface: 'cli_stop_bridge',
    sourcePrompt: { text: 'Review this continuation item and explain the verification.', origin: 'user', capturedAt: 1, promptIndex: 1, generatedOriginPolicy: 'ordinary_source_a' },
    reviewMomentContext: { reviewMoment: 'UserPromptSubmit_preparation', currentAgentMode: 'workspace-write', projectId: 'cp', sessionId: 'cs', detectedLanguage: 'en', stageCandidate: 'implementation', promptCount: 1, recentPromptMetadataRefs: [], triggerProvenance: { currentStage: 'implementation', prevStage: 'task_breakdown', triggerKind: 'stage_transition', classifierState: 'fire_recommended', degradedNoActionState: 'none', promptStartBoundary: p.hookBoundary, deliveryBoundary: p.deliveryBoundary, promptStartCanReplaceSameTurn: false } },
    sourceSignals: { sourceAOriginalPromptRef: sourceRef, sourceRefs: [sourceRef], normalizedStageAbsenceSignalRefs: [], contentTemplateRecordFactRefs: [], popupQuestionSourceRefs: [], whyHelpSourceRefs: [], profileRoleModeRefs: [], rightGoodWorkStyleEnvRuntimeRefs: [], missingMemoryCandidateRefs: [], sourceLabels: [{ sourceRefId: sourceRef.sourceRefId, label: 'original_prompt', evidenceStatus: 'present' }], promptStartStop: { hookBoundary: p.hookBoundary, deliveryBoundary: p.deliveryBoundary, runAutoCanHoldOrReplaceSubmittedPrompt: false, sharedSignalCount: p.sharedSignalCount, classifierDegradedNoFireReasons: p.classifierDegradedNoFireReasons }, store: { schemaVersion: 1, missingPromptEnhancementTables: [], cleanupGaps: [] }, transcriptPathState: 'not_authority', streamBOutputs: [], paramEventChannels: [], servedVariantIdentityRefs: [], deliveryGateRefs: [], sourceOnlyHardFactRefs: [] },
    userPreferenceContext: { levelState: 'default', scopedFeedbackEvidenceRefs: [] },
    configSnapshot: { sequenceEnabledState: 'not_enabled_v1', validatedEffectiveConfigState: 'valid', arbitraryConfigRowsAreAuthority: false },
    callVisibilityState: buildPromptEnhancementCostVisibilityMetadataV1('baseline_pe_composer', { callVisibilityMode: 'deterministic', plannedCallCount: 0, usedCallCount: 0 }),
    privacyAndStoragePolicy: { sensitivityClass: 'normal', localStorageEligibility: 'ids_and_categories_only', telemetryEligibility: 'allowlisted_counts_only', llmSharingEligibility: 'allowed_minimal', generatedBodyStoragePolicy: 'do_not_store_raw_by_default' },
  };
}

async function fixture(): Promise<{
  result: PromptEnhancementPrepareResultV1;
  handoffMetadata: PromptEnhancementHandoffMetadataV1;
  event: PromptEnhancementFutureSequenceRuntimeEventV1;
}> {
  const result = await preparePromptEnhancement(request());
  const handoffMetadata = buildPromptEnhancementHandoffMetadataV1({
    handoffDecisionId: `${result.enhancementId}:mps-handoff`, requestId: result.requestId, projectRoot: result.projectRoot,
    currentBody: result.currentBody, safetySummary: result.safetySummary, handoffKind: 'first_prompt_handoff_candidate',
    summary: { summaryId: `${result.enhancementId}:summary`, publicSafeText: 'Metadata only.', remainingTaskCount: 1, taskRoleLabels: ['verification'] },
  });
  const event: PromptEnhancementFutureSequenceRuntimeEventV1 = {
    requestId: result.requestId, projectScope: result.projectRoot, sequenceId: 'sequence-1', sequenceItemId: 'item-2',
    currentItemRevision: 2, bodyRevision: result.currentBody.bodyRevision, continuationDispositionId: 'cont-1',
    contractVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION, stateFreshness: 'current', stopEventState: 'stop_fired_non_proof',
    terminalTransitionState: 'none', explicitUserActionState: 'present_future_only', idempotencyKey: 'cont-idem', createdAtMs: 2,
  };
  return { result, handoffMetadata, event };
}

/** Scripted interaction: feed keys in order, capture frames. */
function scripted(keys: readonly string[]): PromptEnhancementCliMpsInteractionV1 & { frames: string[] } {
  const queue = [...keys];
  const frames: string[] = [];
  return {
    frames,
    size: () => ({ columns: 96, rows: 30 }),
    async next(frame: string) {
      frames.push(frame);
      const key = queue.shift();
      if (key === undefined) throw new Error('missing scripted key');
      return key;
    },
    close() { /* noop */ },
  };
}

describe('MPS continuation-popup CLI shell (§3.4)', () => {
  it('Enter on the body row sends the enhanced next-item body', async () => {
    const { result, handoffMetadata, event } = await fixture();
    const io = scripted([KEY.enter]);
    const outcome = await runPromptEnhancementCliMpsContinuationPopupV1({ result, handoffMetadata, event, interaction: io });
    expect(outcome.state).toBe('send');
    if (outcome.state !== 'send') return;
    expect(outcome.bodyText.trim().length).toBeGreaterThan(0);
    // The frame shows the locked §3.4 rows.
    expect(io.frames[0]).toContain('Use enhanced sequence prompt');
    expect(io.frames[0]).toContain('I need to do something else first');
    expect(io.frames[0]).toContain('Cancel (remaining multi-prompt sequence)');
  });

  it('Esc declines (leave without a decision)', async () => {
    const { result, handoffMetadata, event } = await fixture();
    const outcome = await runPromptEnhancementCliMpsContinuationPopupV1({ result, handoffMetadata, event, interaction: scripted([KEY.escape]) });
    expect(outcome.state).toBe('declined');
  });

  it('down×2 → Enter on "something else first" returns interruption (pointer must NOT advance)', async () => {
    const { result, handoffMetadata, event } = await fixture();
    const outcome = await runPromptEnhancementCliMpsContinuationPopupV1({ result, handoffMetadata, event, interaction: scripted([KEY.down, KEY.down, KEY.enter]) });
    expect(outcome.state).toBe('interruption');
  });

  it('down×3 → Enter on Cancel → PEF feedback → cancelled with the typed feedback', async () => {
    const { result, handoffMetadata, event } = await fixture();
    // After Cancel, the feedback popup opens; Enter selects the first suggested reason.
    const io = scripted([KEY.down, KEY.down, KEY.down, KEY.enter, KEY.enter]);
    const outcome = await runPromptEnhancementCliMpsContinuationPopupV1({ result, handoffMetadata, event, interaction: io });
    expect(outcome.state).toBe('cancelled');
    if (outcome.state !== 'cancelled') return;
    expect(outcome.feedback).toBeDefined();
  });

  it('Cancel → Esc in the feedback popup → cancelled WITHOUT feedback', async () => {
    const { result, handoffMetadata, event } = await fixture();
    const io = scripted([KEY.down, KEY.down, KEY.down, KEY.enter, KEY.escape]);
    const outcome = await runPromptEnhancementCliMpsContinuationPopupV1({ result, handoffMetadata, event, interaction: io });
    expect(outcome).toEqual({ state: 'cancelled' });
  });

  it('typing details then Enter APPLIES them into the body (PE parity), then body Enter sends the merged prompt', async () => {
    const { result, handoffMetadata, event } = await fixture();
    // Move to details (down), type text, Enter to apply (focus returns to body), Enter to send.
    const typed = 'scope to payments'.split('');
    const io = scripted([KEY.down, ...typed, KEY.enter, KEY.enter]);
    const outcome = await runPromptEnhancementCliMpsContinuationPopupV1({ result, handoffMetadata, event, interaction: io });
    expect(outcome.state).toBe('send');
    if (outcome.state !== 'send') return;
    expect(outcome.bodyText).toContain('Additional details to incorporate:');
    expect(outcome.bodyText).toContain('scope to payments');
  });

  it('NF apply-details capture (parity): a real Apply fires mps_apply_details once (kind + timestamp, no text); a blank Apply fires nothing', async () => {
    const { result, handoffMetadata, event } = await fixture();
    const sink = vi.fn();
    // down -> details row; type; Enter -> APPLY (fires the sink); Enter -> send.
    await runPromptEnhancementCliMpsContinuationPopupV1({
      result, handoffMetadata, event,
      interaction: scripted([KEY.down, ...'pg'.split(''), KEY.enter, KEY.enter]),
      actionSignalSink: sink,
    });
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0]![0]).toBe('mps_apply_details');
    expect(typeof sink.mock.calls[0]![1]).toBe('number');
    expect(sink.mock.calls[0]).toHaveLength(2);

    // Blank apply (Enter on empty details) records nothing.
    const blankSink = vi.fn();
    await runPromptEnhancementCliMpsContinuationPopupV1({
      result, handoffMetadata, event,
      interaction: scripted([KEY.down, KEY.enter, KEY.escape]),
      actionSignalSink: blankSink,
    });
    expect(blankSink).not.toHaveBeenCalled();
  });

  it('no-scroll: every painted frame fits the reported window height (stacking regression guard)', async () => {
    const { result, handoffMetadata, event } = await fixture();
    // Walk all four rows so every focus state is painted, then send.
    const io = scripted([KEY.down, KEY.down, KEY.down, KEY.up, KEY.up, KEY.up, KEY.enter]);
    await runPromptEnhancementCliMpsContinuationPopupV1({ result, handoffMetadata, event, interaction: io });
    const rows = io.size!().rows;
    for (const frame of io.frames) {
      expect(frame.split('\n').length).toBeLessThanOrEqual(rows);
    }
  });

  it('a build that is not ready returns not_shown (fail-closed) — e.g. a stale event', async () => {
    const { result, handoffMetadata, event } = await fixture();
    const stale: PromptEnhancementFutureSequenceRuntimeEventV1 = { ...event, stateFreshness: 'stale' };
    const outcome = await runPromptEnhancementCliMpsContinuationPopupV1({ result, handoffMetadata, event: stale, interaction: scripted([]) });
    expect(outcome.state).toBe('not_shown');
  });
});
