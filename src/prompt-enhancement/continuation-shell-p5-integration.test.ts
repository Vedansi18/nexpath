import { beforeAll, describe, expect, it } from 'vitest';
import {
  PROMPT_ENHANCEMENT_CONTRACT_VERSION,
  type PromptEnhancementPrepareRequestV1,
  type PromptEnhancementPrepareResultV1,
  type PromptEnhancementSourceRefV1,
  type PromptEnhancementValidationGraphV1,
} from './contracts.js';
import { buildPromptEnhancementCostVisibilityMetadataV1 } from './cost-observability.js';
import { getPromptStartStopSourceSnapshot } from './source-reality.js';
import { preparePromptEnhancement } from './facade.js';
import { packageContinuationAtStopV1 } from './continuation-stop-package.js';
import {
  runPromptEnhancementCliMpsContinuationPopupV1,
  deliverPromptEnhancementCliMpsContinuationResultV1,
} from './cli-mps-continuation-run.js';
import type { PromptEnhancementCliMpsInteractionV1 } from './cli-mps-run.js';
import type { PromptEnhancementSequenceItemV1 } from './sequence-payload.js';
import type { PromptEnhancementSequenceRuntimeStateV1 } from './sequence-runtime.js';
import { openStore, type Store } from '../store/db.js';
import {
  upsertPendingPromptSequence, getActivePendingPromptSequence, updatePendingPromptSequenceState,
} from '../store/pending-sequences.js';

// ─────────────────────────────────────────────────────────────────────────────
// MPS shell P5 — the acceptance-fixture SCENARIOS run against the LIVE assembled shell (package → render
// → deliver → persist), the exact composition stop.ts uses behind the gate. ⛔ This asserts the shell's
// observable behaviour; it does NOT set any acceptance fixture's actualResult or any evidence flag — the
// owner oracle judges readiness (flag 11) at un-gate. Real items carry a real prepare result's
// validationGraph, so the packaged result is builder-valid (the wall a minimal stub hit).
// ─────────────────────────────────────────────────────────────────────────────

const KEY = { enter: '\r', escape: '\x1b', down: '\x1b[B' } as const;

function scripted(keys: readonly string[]): PromptEnhancementCliMpsInteractionV1 & { frames: string[] } {
  const queue = [...keys];
  const frames: string[] = [];
  return {
    frames,
    size: () => ({ columns: 96, rows: 30 }),
    async next(frame: string) { frames.push(frame); const k = queue.shift(); if (k === undefined) throw new Error('missing key'); return k; },
    close() { /* noop */ },
  };
}

function request(): PromptEnhancementPrepareRequestV1 {
  const sourceRef: PromptEnhancementSourceRefV1 = {
    sourceRefId: 'p5-src-1', sourceKind: 'source_a_user_prompt', sourceId: 'prompt:p5',
    sourceAuthorization: 'source_fact_only', evidenceStatus: 'present', freshness: 'current', confidence: 'high', privacyClass: 'public_safe',
  };
  const p = getPromptStartStopSourceSnapshot();
  return {
    schemaVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION, requestId: 'p5-req', projectRoot: '/tmp/p5', hostSurface: 'cli_stop_bridge',
    sourcePrompt: { text: 'Fix the payment test and add a rate limiter to login.', origin: 'user', capturedAt: 1, promptIndex: 1, generatedOriginPolicy: 'ordinary_source_a' },
    reviewMomentContext: { reviewMoment: 'UserPromptSubmit_preparation', currentAgentMode: 'workspace-write', projectId: 'p5', sessionId: 's1', detectedLanguage: 'en', stageCandidate: 'implementation', promptCount: 1, recentPromptMetadataRefs: [], triggerProvenance: { currentStage: 'implementation', prevStage: 'task_breakdown', triggerKind: 'stage_transition', classifierState: 'fire_recommended', degradedNoActionState: 'none', promptStartBoundary: p.hookBoundary, deliveryBoundary: p.deliveryBoundary, promptStartCanReplaceSameTurn: false } },
    sourceSignals: { sourceAOriginalPromptRef: sourceRef, sourceRefs: [sourceRef], normalizedStageAbsenceSignalRefs: [], contentTemplateRecordFactRefs: [], popupQuestionSourceRefs: [], whyHelpSourceRefs: [], profileRoleModeRefs: [], rightGoodWorkStyleEnvRuntimeRefs: [], missingMemoryCandidateRefs: [], sourceLabels: [{ sourceRefId: sourceRef.sourceRefId, label: 'original_prompt', evidenceStatus: 'present' }], promptStartStop: { hookBoundary: p.hookBoundary, deliveryBoundary: p.deliveryBoundary, runAutoCanHoldOrReplaceSubmittedPrompt: false, sharedSignalCount: p.sharedSignalCount, classifierDegradedNoFireReasons: p.classifierDegradedNoFireReasons }, store: { schemaVersion: 1, missingPromptEnhancementTables: [], cleanupGaps: [] }, transcriptPathState: 'not_authority', streamBOutputs: [], paramEventChannels: [], servedVariantIdentityRefs: [], deliveryGateRefs: [], sourceOnlyHardFactRefs: [] },
    userPreferenceContext: { levelState: 'default', scopedFeedbackEvidenceRefs: [] },
    configSnapshot: { sequenceEnabledState: 'not_enabled_v1', validatedEffectiveConfigState: 'valid', arbitraryConfigRowsAreAuthority: false },
    callVisibilityState: buildPromptEnhancementCostVisibilityMetadataV1('baseline_pe_composer', { callVisibilityMode: 'deterministic', plannedCallCount: 0, usedCallCount: 0 }),
    privacyAndStoragePolicy: { sensitivityClass: 'normal', localStorageEligibility: 'ids_and_categories_only', telemetryEligibility: 'allowlisted_counts_only', llmSharingEligibility: 'allowed_minimal', generatedBodyStoragePolicy: 'do_not_store_raw_by_default' },
  };
}

let REAL_GRAPH: PromptEnhancementValidationGraphV1;
let ORIGINAL_LEN: number;
beforeAll(async () => {
  const prep: PromptEnhancementPrepareResultV1 = await preparePromptEnhancement(request());
  REAL_GRAPH = prep.validationGraph; // a full, builder-valid graph reused as the items' verdict
  ORIGINAL_LEN = 50;
});

function items(): readonly PromptEnhancementSequenceItemV1[] {
  return [
    {
      itemKind: 'first_task', originalSliceRef: { start: 0, end: ORIGINAL_LEN }, sourcePointRanges: [{ start: 10, end: 20 }],
      roleLabel: 'fix', dependencyOrder: 0, complexity: 'not_complex', complexityReason: null,
      generatedWording: null, actionRiskKinds: [], authorityMode: 'plan_or_review', requiresConfirmationFloor: false,
      decompositionGroupId: 'g1', itemValidationGraph: null, itemSafetyClauseRef: null,
    },
    {
      itemKind: 'task', originalSliceRef: { start: 10, end: 40 }, sourcePointRanges: [{ start: 10, end: 20 }],
      roleLabel: 'fix', dependencyOrder: 1, complexity: 'not_complex', complexityReason: null,
      generatedWording: 'Add the rate limiter to the login endpoint.', actionRiskKinds: [],
      authorityMode: 'plan_or_review', requiresConfirmationFloor: false, decompositionGroupId: 'g1',
      itemValidationGraph: REAL_GRAPH, itemSafetyClauseRef: null,
    },
  ];
}

function state(over: Partial<PromptEnhancementSequenceRuntimeStateV1> = {}): PromptEnhancementSequenceRuntimeStateV1 {
  return { sequenceId: 'seq-1', enhancementId: 'enh-1', projectRoot: '/tmp/p5', sessionId: 's1', itemCount: 2, currentItemIndex: 0, status: 'awaiting_response', lastActionId: null, ...over };
}

/** Compose the shell exactly as stop.ts does: package (offer+package) → run (scripted) → deliver. */
async function runShell(keys: readonly string[], st = state()) {
  const packaged = packageContinuationAtStopV1({
    state: st, actionId: `${st.sequenceId}:${st.currentItemIndex}`, items: items(),
    redactedOriginalPromptText: 'x'.repeat(ORIGINAL_LEN), handoffKind: 'compact_sequence_summary_candidate',
  });
  if (!packaged.ok) return { packaged, delivery: null, frames: [] as string[] };
  const io = scripted(keys);
  const outcome = await runPromptEnhancementCliMpsContinuationPopupV1({
    result: packaged.packaged.result, handoffMetadata: packaged.packaged.handoffMetadata, event: packaged.packaged.event,
    progress: packaged.packaged.progress, itemKind: packaged.packaged.itemKind, interaction: io,
  });
  const delivery = deliverPromptEnhancementCliMpsContinuationResultV1(packaged.offeredState, outcome, `${st.sequenceId}:${st.currentItemIndex}:deliver`);
  return { packaged, delivery, frames: io.frames };
}

describe('MPS shell P5 — acceptance scenarios against the live assembled shell', () => {
  it('send → inject the advanced item body (the offer advanced 0→1, the send injects item 1)', async () => {
    const { packaged, delivery } = await runShell([KEY.enter]);
    expect(packaged.ok).toBe(true);
    expect(delivery?.kind).toBe('inject');
    if (delivery?.kind !== 'inject') return;
    expect(delivery.bodyText.trim().length).toBeGreaterThan(0);
    expect(delivery.nextState.currentItemIndex).toBe(1); // advanced past the already-sent item 0
  });

  it('custom interruption → keep the same item pending (pointer does NOT advance past the offer)', async () => {
    const { delivery } = await runShell([KEY.down, KEY.down, KEY.enter]);
    expect(delivery?.kind).toBe('keep');
  });

  it('cancel-mid-sequence → terminal cancel scoped to this row', async () => {
    const { delivery } = await runShell([KEY.down, KEY.down, KEY.down, KEY.enter, KEY.enter]);
    expect(delivery?.kind).toBe('cancel');
  });

  it('persist-before-block: the inject nextState round-trips through the store (MPS-9)', async () => {
    const store: Store = await openStore(':memory:');
    const st = state();
    upsertPendingPromptSequence(store, st, { items: items(), promptDirectives: [], suggestedNextPromptPolicy: 'generated_not_rendered_pending_acceptance', originalLength: ORIGINAL_LEN, offerDisposition: 'accepted' }, { redactedOriginalPromptText: 'x'.repeat(ORIGINAL_LEN), handoffKind: 'compact_sequence_summary_candidate' });
    const row = getActivePendingPromptSequence(store, '/tmp/p5', 's1');
    expect(row).not.toBeNull();
    const { delivery } = await runShell([KEY.enter], row!);
    expect(delivery?.kind).toBe('inject');
    if (delivery?.kind !== 'inject') return;
    // Persist the advanced state, as stop.ts does before the block/force-exit, and read it back.
    expect(updatePendingPromptSequenceState(store, row!.id, delivery.nextState)).toBe(true);
    expect(getActivePendingPromptSequence(store, '/tmp/p5', 's1')?.currentItemIndex).toBe(1);
  });
});
