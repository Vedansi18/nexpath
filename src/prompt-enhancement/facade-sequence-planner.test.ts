import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from 'sql.js';
import {
  PROMPT_ENHANCEMENT_CONTRACT_VERSION,
  type PromptEnhancementPrepareRequestV1,
  type PromptEnhancementSourceRefV1,
} from './contracts.js';
import { buildPromptEnhancementCostVisibilityMetadataV1 } from './cost-observability.js';
import { getPromptStartStopSourceSnapshot } from './source-reality.js';
import { preparePromptEnhancement, preparePromptEnhancementWithSequenceV1 } from './facade.js';
import type { PromptEnhancementSequencePlannerClientV1 } from './sequence-planner.js';
import { openStore, type Store } from '../store/db.js';
import {
  PROMPT_ENHANCEMENT_SEQUENCE_ENABLED_KEY,
  setPromptEnhancementSequenceEnabled,
} from '../config/PromptEnhancementConfig.js';

// ─────────────────────────────────────────────────────────────────────────────
// MPS P1b-i (owner unit P1) — the full sequence planner REPLACES the display-only
// `describePromptEnhancementSequencePlanV1` as the source of truth for the compact
// sequence summary's item count + role labels, feeding the already-optional
// `summary` seam of `buildPromptEnhancementHandoffMetadataV1` (no contract change).
//
// It runs ONLY on the `isSequenceCandidate` branch, only on a baseline prepare, and
// only when a db + client seam is threaded in via the db-accepting facade entry
// `preparePromptEnhancementWithSequenceV1`. On ANY planner failure / refusal /
// single-prompt outcome — and on every caller of the contract-typed
// `preparePromptEnhancement` (no deps) — the summary falls back to the describe
// splitter (today's behaviour). These tests prove all three paths.
// ─────────────────────────────────────────────────────────────────────────────

// A multi-intent candidate prompt (mirrors facade-mps-drop.test.ts): it routes to a
// `compact_sequence_summary_candidate` handoff and shows the PE popup.
const CANDIDATE_TEXT = 'Fix the failing payment test and add a rate limiter to the login endpoint.';

/** A stub planner client returning one canned reply, so the path runs with no provider. */
const clientReturning = (content: string | null): PromptEnhancementSequencePlannerClientV1 => ({
  chat: { completions: { create: async () => ({ choices: [{ message: { content } }] }) } },
});
const clientThrowing = (error: unknown): PromptEnhancementSequencePlannerClientV1 => ({
  chat: { completions: { create: async () => { throw error; } } },
});

/**
 * A valid `sequence` plan reply. Offsets index the (redaction is length-preserving,
 * no secrets here so identity) original prompt; `first_task` covers the whole
 * original, `task` a sub-slice. The derived summary is remainingTaskCount 1 +
 * taskRoleLabels ['fix'] (only the closed-vocab role survives; the null is dropped).
 */
const validSequenceReply = (originalLength: number): string => JSON.stringify({
  outcome: 'sequence',
  outcomeReason: null,
  points: [
    { pointId: 'p1', startOffset: 0, endOffset: 5, requiredKind: 'deliverable' },
    { pointId: 'p2', startOffset: 10, endOffset: 15, requiredKind: 'deliverable' },
    { pointId: 'p3', startOffset: 20, endOffset: 25, requiredKind: 'deliverable' },
  ],
  groups: [
    { groupId: 'g1', pointIds: ['p1', 'p2'], canRemainOneBodySection: false },
    { groupId: 'g2', pointIds: ['p3'], canRemainOneBodySection: false },
  ],
  items: [
    {
      itemKind: 'first_task', originalSliceRef: { start: 0, end: originalLength },
      sourcePointRanges: [], roleLabel: 'fix', dependencyOrder: 0, complexity: 'not_complex',
      complexityReason: null, decompositionGroupId: 'g1',
    },
    {
      itemKind: 'task', originalSliceRef: { start: 10, end: 30 }, sourcePointRanges: [],
      roleLabel: null, dependencyOrder: 1, complexity: 'not_complex', complexityReason: null,
      decompositionGroupId: 'g2',
    },
  ],
  promptDirectives: [],
  summaryData: { summaryId: 's1', remainingTaskCount: 1 },
});

function candidateRequest(): PromptEnhancementPrepareRequestV1 {
  const sourceRef: PromptEnhancementSourceRefV1 = {
    sourceRefId: 'src-a-1', sourceKind: 'source_a_user_prompt', sourceId: 'prompt:1',
    sourceAuthorization: 'source_fact_only', evidenceStatus: 'present', freshness: 'current', confidence: 'high', privacyClass: 'public_safe',
  };
  const p = getPromptStartStopSourceSnapshot();
  return {
    schemaVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION, requestId: 'seq-planner-1', projectRoot: '/tmp/seq-planner', hostSurface: 'cli_stop_bridge',
    sourcePrompt: { text: CANDIDATE_TEXT, origin: 'user', capturedAt: 1, promptIndex: 1, generatedOriginPolicy: 'ordinary_source_a' },
    reviewMomentContext: { reviewMoment: 'UserPromptSubmit_preparation', currentAgentMode: 'workspace-write', projectId: 'p1', sessionId: 's1', detectedLanguage: 'en', stageCandidate: 'implementation', promptCount: 1, recentPromptMetadataRefs: [], triggerProvenance: { currentStage: 'implementation', prevStage: 'task_breakdown', triggerKind: 'stage_transition', classifierState: 'fire_recommended', degradedNoActionState: 'none', promptStartBoundary: p.hookBoundary, deliveryBoundary: p.deliveryBoundary, promptStartCanReplaceSameTurn: false } },
    sourceSignals: { sourceAOriginalPromptRef: sourceRef, sourceRefs: [sourceRef], normalizedStageAbsenceSignalRefs: [], contentTemplateRecordFactRefs: [], popupQuestionSourceRefs: [], whyHelpSourceRefs: [], profileRoleModeRefs: [], rightGoodWorkStyleEnvRuntimeRefs: [], missingMemoryCandidateRefs: [], sourceLabels: [{ sourceRefId: sourceRef.sourceRefId, label: 'original_prompt', evidenceStatus: 'present' }], promptStartStop: { hookBoundary: p.hookBoundary, deliveryBoundary: p.deliveryBoundary, runAutoCanHoldOrReplaceSubmittedPrompt: false, sharedSignalCount: p.sharedSignalCount, classifierDegradedNoFireReasons: p.classifierDegradedNoFireReasons }, store: { schemaVersion: 1, missingPromptEnhancementTables: [], cleanupGaps: [] }, transcriptPathState: 'not_authority', streamBOutputs: [], paramEventChannels: [], servedVariantIdentityRefs: [], deliveryGateRefs: [], sourceOnlyHardFactRefs: [] },
    userPreferenceContext: { levelState: 'default', scopedFeedbackEvidenceRefs: [] },
    configSnapshot: { sequenceEnabledState: 'not_enabled_v1', validatedEffectiveConfigState: 'valid', arbitraryConfigRowsAreAuthority: false },
    callVisibilityState: buildPromptEnhancementCostVisibilityMetadataV1('baseline_pe_composer', { callVisibilityMode: 'deterministic', plannedCallCount: 0, usedCallCount: 0 }),
    privacyAndStoragePolicy: { sensitivityClass: 'normal', localStorageEligibility: 'ids_and_categories_only', telemetryEligibility: 'allowlisted_counts_only', llmSharingEligibility: 'allowed_minimal', generatedBodyStoragePolicy: 'do_not_store_raw_by_default' },
  };
}

let store: Store;
let db: Database;
beforeAll(async () => {
  store = await openStore(':memory:');
  db = store.db;
  // The config kill-switch the planner resolves from the store itself. ON so the planner runs.
  setPromptEnhancementSequenceEnabled(store, PROMPT_ENHANCEMENT_SEQUENCE_ENABLED_KEY, 'on');
});

describe('PE facade — sequence planner replaces the describe splitter (MPS P1b-i)', () => {
  it('candidate + a valid planner sequence → the compact summary count/roles come from the PLANNER', async () => {
    const req = candidateRequest();
    const { result, plannerItems } = await preparePromptEnhancementWithSequenceV1(req, {
      db,
      client: clientReturning(validSequenceReply(CANDIDATE_TEXT.length)),
    });

    // MPS P1b-ii (8a): the sequence entry now also returns the planner's full item list — the input
    // the background wording batch (P2) consumes. Present when the planner produced a sequence.
    expect(plannerItems).toBeDefined();
    expect(plannerItems?.length).toBeGreaterThanOrEqual(2);
    expect(plannerItems?.[0].itemKind).toBe('first_task');

    // The candidate branch still shows the popup and emits the compact sequence summary.
    expect(result.disposition).toBe('show_current_body');
    const summary = result.uiView.handoffAndSequenceSummary?.compactFirstPopupSequenceSummary;
    expect(summary).toBeDefined();
    // Source of truth is the PLANNER: remainingTaskCount 1 and the closed-vocab role ['fix'],
    // which the punctuation splitter (family labels) cannot produce.
    expect(summary?.remainingTaskCount).toBe(1);
    expect(summary?.taskRoleLabels).toEqual(['fix']);

    // Proof it is NOT the describe path: the default (no-deps) prepare yields a different summary.
    const describeResult = await preparePromptEnhancement(req);
    const describeSummary = describeResult.uiView.handoffAndSequenceSummary?.compactFirstPopupSequenceSummary;
    expect(describeSummary).toBeDefined();
    expect(describeSummary?.taskRoleLabels).not.toEqual(['fix']);
  });

  it('candidate + planner returns a single-prompt outcome → FALLS BACK to the describe summary', async () => {
    const req = candidateRequest();
    const singleReply = JSON.stringify({
      outcome: 'single_plain', outcomeReason: 'not_big_enough',
      points: [], groups: [], items: [], promptDirectives: [],
      summaryData: { summaryId: 's1', remainingTaskCount: 0 },
    });
    const { result: planned } = await preparePromptEnhancementWithSequenceV1(req, { db, client: clientReturning(singleReply) });
    const fallback = await preparePromptEnhancement(req);

    // Byte-identical summary to the describe path — the planner outcome supplied nothing.
    expect(planned.uiView.handoffAndSequenceSummary?.compactFirstPopupSequenceSummary)
      .toEqual(fallback.uiView.handoffAndSequenceSummary?.compactFirstPopupSequenceSummary);
  });

  it('candidate + planner provider failure → FALLS BACK to the describe summary', async () => {
    const req = candidateRequest();
    const { result: planned } = await preparePromptEnhancementWithSequenceV1(req, { db, client: clientThrowing(new Error('provider down')) });
    const fallback = await preparePromptEnhancement(req);

    expect(planned.uiView.handoffAndSequenceSummary?.compactFirstPopupSequenceSummary)
      .toEqual(fallback.uiView.handoffAndSequenceSummary?.compactFirstPopupSequenceSummary);
  });

  it('candidate + no db/client (the contract-typed default facade) → the describe summary, unchanged', async () => {
    const req = candidateRequest();
    const result = await preparePromptEnhancement(req);
    const summary = result.uiView.handoffAndSequenceSummary?.compactFirstPopupSequenceSummary;
    // The describe fallback still produces a real summary (today's behaviour) — never ['fix'].
    expect(summary).toBeDefined();
    expect(summary?.taskRoleLabels).not.toEqual(['fix']);
  });
});
