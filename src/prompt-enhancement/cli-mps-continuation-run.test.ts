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
import { runPromptEnhancementCliMpsContinuationPopupV1, deliverPromptEnhancementCliMpsContinuationOutcomeV1, deliverPromptEnhancementCliMpsContinuationResultV1 } from './cli-mps-continuation-run.js';
import type { PromptEnhancementCliMpsInteractionV1 } from './cli-mps-run.js';
import type { PromptEnhancementSequenceRuntimeStateV1 } from './sequence-runtime.js';

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

// ── MPS-2 (6.1): the shell-outcome → delivery-mapper bridge (reaches deliverSequenceContinuationOutcomeV1) ──

describe('deliverPromptEnhancementCliMpsContinuationOutcomeV1 — 6.1 wiring', () => {
  // An OFFERED state: the item the continuation popup was shown for, still pending.
  const offered = (overrides: Partial<PromptEnhancementSequenceRuntimeStateV1> = {}): PromptEnhancementSequenceRuntimeStateV1 => ({
    sequenceId: 'seq-1', enhancementId: 'enh-1', projectRoot: '/tmp/p', sessionId: 's1',
    itemCount: 3, currentItemIndex: 1, status: 'item_pending', lastActionId: 'offer-1',
    ...overrides,
  });

  it('send → inject; interruption → keep; declined/cancelled → cancel (MPS-2 6.2: every exit event cancels)', () => {
    const s = offered();
    expect(deliverPromptEnhancementCliMpsContinuationOutcomeV1(s, { state: 'send', bodyText: 'the edited body' }, 'a1').kind).toBe('inject');
    expect(deliverPromptEnhancementCliMpsContinuationOutcomeV1(s, { state: 'interruption' }, 'a2').kind).toBe('keep');
    // MPS-2 6.2: Escape/decline now CANCELS the whole sequence, exactly like the Cancel button.
    expect(deliverPromptEnhancementCliMpsContinuationOutcomeV1(s, { state: 'declined' }, 'a3').kind).toBe('cancel');
    expect(deliverPromptEnhancementCliMpsContinuationOutcomeV1(s, { state: 'cancelled' }, 'a4').kind).toBe('cancel');
  });

  it('not_shown → keep the offered item pending (the popup never rendered; nothing delivered)', () => {
    const s = offered();
    expect(deliverPromptEnhancementCliMpsContinuationOutcomeV1(s, { state: 'not_shown', reasonCodes: ['no_tty'] }, 'a5'))
      .toEqual({ kind: 'keep', nextState: s });
  });

  it('the cancel feedback the popup collected is dropped from the mapper input (a separate step)', () => {
    const s = offered();
    // A cancelled outcome carrying feedback still maps to a plain cancel delivery — the mapper never sees the feedback.
    expect(deliverPromptEnhancementCliMpsContinuationOutcomeV1(s, { state: 'cancelled', feedback: { kind: 'suggested', category: 'too_long' } }, 'a6').kind).toBe('cancel');
  });
});

describe('deliverPromptEnhancementCliMpsContinuationResultV1 — 6.4 silent-exit detection', () => {
  const offered = (overrides: Partial<PromptEnhancementSequenceRuntimeStateV1> = {}): PromptEnhancementSequenceRuntimeStateV1 => ({
    sequenceId: 'seq-1', enhancementId: 'enh-1', projectRoot: '/tmp/p', sessionId: 's1',
    itemCount: 3, currentItemIndex: 1, status: 'item_pending', lastActionId: 'offer-1',
    ...overrides,
  });

  it('MISSING result (the four silent events return nothing) → terminal cancel of the sequence', () => {
    const s = offered();
    for (const missing of [undefined, null]) {
      const out = deliverPromptEnhancementCliMpsContinuationResultV1(s, missing, 'a1');
      expect(out.kind).toBe('cancel');
      if (out.kind === 'cancel') expect(out.nextState.status).toBe('cancelled');
    }
  });

  it('INVALID result (unrecognized shape) → terminal cancel — a lost popup is a cancel signal', () => {
    const s = offered();
    // Non-object, empty object, and an object whose discriminant is not a known outcome state.
    for (const invalid of ['garbage', 42, {}, { state: 'bogus' }, { notState: 'send' }, []]) {
      expect(deliverPromptEnhancementCliMpsContinuationResultV1(s, invalid, 'a2').kind).toBe('cancel');
    }
  });

  it('a recognized-but-INCOMPLETE send (no string body) is INVALID → cancel, never injects an undefined body', () => {
    const s = offered();
    // Recognized discriminant but the delivery-critical field is missing/malformed → fail-safe to cancel.
    for (const malformed of [{ state: 'send' }, { state: 'send', bodyText: 42 }, { state: 'send', bodyText: null }]) {
      expect(deliverPromptEnhancementCliMpsContinuationResultV1(s, malformed, 'a3').kind).toBe('cancel');
    }
    // A complete send is still delivered as inject.
    expect(deliverPromptEnhancementCliMpsContinuationResultV1(s, { state: 'send', bodyText: 'ok' }, 'a4').kind).toBe('inject');
  });

  it('a REPORTED outcome is delegated to the 6.1 bridge unchanged (send→inject, interruption→keep, decline/cancel→cancel)', () => {
    const s = offered();
    expect(deliverPromptEnhancementCliMpsContinuationResultV1(s, { state: 'send', bodyText: 'edited' }, 'b1').kind).toBe('inject');
    expect(deliverPromptEnhancementCliMpsContinuationResultV1(s, { state: 'interruption' }, 'b2').kind).toBe('keep');
    expect(deliverPromptEnhancementCliMpsContinuationResultV1(s, { state: 'declined' }, 'b3').kind).toBe('cancel');
    expect(deliverPromptEnhancementCliMpsContinuationResultV1(s, { state: 'cancelled' }, 'b4').kind).toBe('cancel');
  });

  it('not_shown is a REPORTED result (popup never rendered), NOT a silent exit → keep the item pending', () => {
    const s = offered();
    // Distinguishes 6.4 from 6.1: a legitimate no-render keeps the item; only a missing/invalid result cancels.
    expect(deliverPromptEnhancementCliMpsContinuationResultV1(s, { state: 'not_shown', reasonCodes: ['no_tty'] }, 'c1'))
      .toEqual({ kind: 'keep', nextState: s });
  });

  it('never throws on any input — error handling is unchanged (a crash that THROWS is the caller\'s concern)', () => {
    const s = offered();
    expect(() => deliverPromptEnhancementCliMpsContinuationResultV1(s, undefined, 'd1')).not.toThrow();
    expect(() => deliverPromptEnhancementCliMpsContinuationResultV1(s, { state: 'bogus' }, 'd2')).not.toThrow();
  });
});
