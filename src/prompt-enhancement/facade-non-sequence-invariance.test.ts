import { describe, expect, it } from 'vitest';
import {
  PROMPT_ENHANCEMENT_CONTRACT_VERSION,
  validatePromptEnhancementPrepareResultV1,
  type PromptEnhancementPrepareRequestV1,
  type PromptEnhancementPrepareResultV1,
  type PromptEnhancementSourceRefV1,
} from './contracts.js';
import { buildPromptEnhancementCostVisibilityMetadataV1 } from './cost-observability.js';
import { preparePromptEnhancement } from './facade.js';
import { getPromptStartStopSourceSnapshot } from './source-reality.js';

// ─────────────────────────────────────────────────────────────────────────────
// P1b-i non-sequence facade INVARIANCE guard.
//
// A later change (P1b-i, design doc §4/§5) will REORDER the facade so the
// sequence planner runs BEFORE the PE body — but ONLY for `isSequenceCandidate`
// prompts (`facade.ts:418-420`: compoundPromptState === 'multi_intent_one_prompt'
// OR (multi_point_same_intent && userPointCoverageRefs.length >= 3)). For every
// NON-candidate prompt the facade output must stay BYTE-IDENTICAL. This suite is
// the guard that proves it: it snapshots the full deterministic prepare result of
// a corpus of non-sequence prompts. When the reorder lands, this suite must still
// pass unchanged. Every corpus case here keeps the sequence gate OFF
// (`sequenceEnabledState: 'not_enabled_v1'`) — the candidate path is tested
// elsewhere and is intentionally NOT exercised here.
//
// Determinism: the prepare path derives every id from `requestId`
// (`enhancementId = pe:${requestId}`, currentBodyId/origin ids chain off it) and
// takes its only timestamp from `sourcePrompt.capturedAt` (fixed to 1 below) —
// the `?? Date.now()` fallback is never reached. Verified empirically: two
// prepares of the same request stringify-equal, so the WHOLE result is snapshotted
// as the true byte-identical guard (no `stableView` normalization was needed).
//
// SOURCE FINDING (resolved from source, not assumed): the `configSnapshot.
// sequenceEnabledState` "gate" is a TYPE-ONLY field — its sole occurrence in the
// package is the interface declaration (contracts.ts:1598); NOTHING at runtime
// reads it. `isSequenceCandidate` (facade.ts:418-420) depends ONLY on
// `compoundPromptState`, so a genuine multi-intent / multi-point(>=3) prompt is a
// sequence CANDIDATE regardless of the gate value. Therefore "compound prompt with
// the gate off" is NOT a non-candidate and does NOT belong in this suite. The real
// non-candidate boundary is `compoundPromptState`: single_intent, OR
// multi_point_same_intent with < 3 covered points. Every corpus case below is
// asserted to be a non-candidate against the live result (`assertNonSequenceInvariants`).
// ─────────────────────────────────────────────────────────────────────────────

// Mirror of facade.ts:418-420 — a result is a sequence CANDIDATE (the reordered
// path) iff this holds. The whole suite asserts every case is NOT this.
function isSequenceCandidate(result: PromptEnhancementPrepareResultV1): boolean {
  const state = result.routeDecision.compoundPromptState;
  return (
    state === 'multi_intent_one_prompt' ||
    (state === 'multi_point_same_intent' && result.routeDecision.userPointCoverageRefs.length >= 3)
  );
}

// The sequence-continuation handoff kinds the non-sequence path must NEVER emit.
// (`facade.ts:428` only builds `compact_sequence_summary_candidate`, and behind
// `isSequenceCandidate`; `first_prompt_handoff_candidate` is the other continuable
// candidate kind — see the `handoffKind` union in contracts.ts.)
const SEQUENCE_CONTINUATION_HANDOFF_KINDS = [
  'compact_sequence_summary_candidate',
  'first_prompt_handoff_candidate',
] as const;

function request(overrides: Partial<PromptEnhancementPrepareRequestV1> = {}): PromptEnhancementPrepareRequestV1 {
  const sourceRef: PromptEnhancementSourceRefV1 = {
    sourceRefId: 'src-a-1',
    sourceKind: 'source_a_user_prompt',
    sourceId: 'prompt:1',
    sourceAuthorization: 'source_fact_only',
    evidenceStatus: 'present',
    freshness: 'current',
    confidence: 'high',
    privacyClass: 'public_safe',
  };
  const promptStartStop = getPromptStartStopSourceSnapshot();
  return {
    schemaVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
    requestId: 'facade-nonseq-default',
    projectRoot: '/tmp/project',
    hostSurface: 'cli_stop_bridge',
    sourcePrompt: {
      text: 'Fix the failing test in the payment flow and explain what caused it.',
      origin: 'user',
      capturedAt: 1,
      promptIndex: 1,
      generatedOriginPolicy: 'ordinary_source_a',
    },
    reviewMomentContext: {
      reviewMoment: 'UserPromptSubmit_preparation',
      currentAgentMode: 'workspace-write',
      projectId: 'project-1',
      sessionId: 'session-1',
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
      callVisibilityMode: 'deterministic',
      plannedCallCount: 0,
      usedCallCount: 0,
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

// The non-sequence corpus. Every case keeps the sequence gate OFF, so each is a
// NON-candidate and must be byte-identical before/after the P1b-i reorder.
const corpus: { name: string; build: () => PromptEnhancementPrepareRequestV1 }[] = [
  {
    // (a) plain single-intent implementation prompt.
    name: 'a-plain-single-intent-implementation',
    build: () =>
      request({
        requestId: 'facade-nonseq-a-plain-impl',
        sourcePrompt: {
          text: 'Add a retry with exponential backoff to the payment gateway client.',
          origin: 'user',
          capturedAt: 1,
          promptIndex: 1,
          generatedOriginPolicy: 'ordinary_source_a',
        },
      }),
  },
  {
    // (b) single prompt with an explicit question / explanation ask.
    name: 'b-single-intent-with-explanation',
    build: () =>
      request({
        requestId: 'facade-nonseq-b-explain',
        sourcePrompt: {
          text: 'Fix the failing test in the payment flow and explain what caused it.',
          origin: 'user',
          capturedAt: 1,
          promptIndex: 1,
          generatedOriginPolicy: 'ordinary_source_a',
        },
      }),
  },
  {
    // (c) compound-SHAPED but non-candidate prompt: two clauses of the SAME intent
    // that resolve to `multi_point_same_intent` with < 3 covered points ("a plain
    // 'add X and Y' stays on the PE popup", facade.ts:415-416). This is the honest
    // stand-in for the task's "compound-but-non-sequence" case — a TRUE multi-intent
    // prompt is always a candidate (the gate has no runtime effect; see header note),
    // so this is the closest compound shape that stays on the non-sequence PE path.
    name: 'c-compound-shaped-same-intent-non-candidate',
    build: () =>
      request({
        requestId: 'facade-nonseq-c-compound-shaped',
        sourcePrompt: {
          text: 'Add input validation and a unit test for the login form.',
          origin: 'user',
          capturedAt: 1,
          promptIndex: 1,
          generatedOriginPolicy: 'ordinary_source_a',
        },
      }),
  },
  {
    // (d) no-popup / not-applicable case: a generated-origin echo routes to
    // no_popup_not_applicable (also a non-sequence result).
    name: 'd-no-popup-generated-echo',
    build: () =>
      request({
        requestId: 'facade-nonseq-d-nopopup-echo',
        sourcePrompt: {
          text: 'Fix the failing test in the payment flow and explain what caused it.',
          origin: 'pe_generated_echo',
          capturedAt: 1,
          promptIndex: 1,
          generatedOriginPolicy: 'exclude_from_ordinary_learning',
        },
      }),
  },
  {
    // (e) short / trivial prompt.
    name: 'e-short-trivial',
    build: () =>
      request({
        requestId: 'facade-nonseq-e-short',
        sourcePrompt: {
          text: 'Rename the util file.',
          origin: 'user',
          capturedAt: 1,
          promptIndex: 1,
          generatedOriginPolicy: 'ordinary_source_a',
        },
      }),
  },
];

function assertNonSequenceInvariants(result: PromptEnhancementPrepareResultV1): void {
  // The result is always contract-valid.
  expect(validatePromptEnhancementPrepareResultV1(result).ok).toBe(true);

  // Corpus guard: this case MUST be a non-candidate, else it belongs on the
  // reordered candidate path (tested elsewhere) and would break under P1b-i.
  expect(isSequenceCandidate(result)).toBe(false);

  // Load-bearing guard #1: the non-sequence path never emits a CONTINUABLE
  // sequence handoff — neither on the top-level `handoffMetadata` nor on the
  // `uiView.handoffAndSequenceSummary` the facade actually populates. Each is
  // either absent, or (if present) carries a non-continuation handoffKind.
  const handoffKinds = [
    result.handoffMetadata?.handoffKind,
    result.uiView.handoffAndSequenceSummary?.handoffKind,
  ];
  for (const kind of handoffKinds) {
    if (kind !== undefined) {
      expect(SEQUENCE_CONTINUATION_HANDOFF_KINDS).not.toContain(kind);
    }
  }

  // Load-bearing guard #2: the rendered body equals the semantic body text — the
  // transport carries no divergent authority.
  expect(result.currentBody.text).toBe(result.currentBody.renderedPromptBody);
}

describe('PE facade — non-sequence invariance (P1b-i reorder guard)', () => {
  for (const entry of corpus) {
    it(`non-sequence result is stable + invariant: ${entry.name}`, async () => {
      const result = await preparePromptEnhancement(entry.build());

      assertNonSequenceInvariants(result);

      // Full-object byte-identical snapshot: the true guard the design's
      // "byte-identical non-sequence" invariant demands. Deterministic per the
      // header note, so this is stable across runs and re-runs.
      expect(result).toMatchSnapshot();
    });
  }

  it('the sequence gate is off on every corpus request (documentation of intent)', () => {
    // NOTE: gate-off is documented intent only — it does NOT establish non-candidacy
    // (the field has no runtime consumer; see the header SOURCE FINDING). The real
    // non-candidacy guarantee is asserted per-case via `isSequenceCandidate(result)`.
    for (const entry of corpus) {
      expect(entry.build().configSnapshot.sequenceEnabledState).toBe('not_enabled_v1');
    }
  });
});
