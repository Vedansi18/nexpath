import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PROMPT_ENHANCEMENT_CONTRACT_VERSION,
  type PromptEnhancementPrepareRequestV1,
  type PromptEnhancementSourceRefV1,
} from './contracts.js';
import { buildPromptEnhancementCostVisibilityMetadataV1 } from './cost-observability.js';
import { getPromptStartStopSourceSnapshot } from './source-reality.js';
import {
  buildPromptEnhancementCanonicalConfirmation,
  promptEnhancementGeneratedBodyRequiresConfirmationV1,
  requiresPromptEnhancementExecutionConfirmationForPrompt,
} from './safety-sendability.js';

// ---------------------------------------------------------------------------
// Blocked-popup fix (2026-08-07) — composer/validator confirmation parity.
//
// Live bug (log 2026-08-06 18:13, reproduced ~3/12 LLM runs): the composer inserts the canonical
// go-ahead confirmation only when the ORIGINAL PROMPT requires it, but the validator re-decides
// from the GENERATED body too. An LLM draft that introduces risk+execution wording made the
// validator demand a confirmation the composer never inserted →
// `missing_or_weak_confirmation:canonical_confirmation_absent` (blocking) → blocked_no_send →
// D2 scrub → an empty popup with every send action "(unavailable)".
// These tests force exactly that draft shape through the REAL facade (LLM composer mocked — the
// suite never calls a real API) and assert the composed body now carries the confirmation and
// stays sendable.
// ---------------------------------------------------------------------------

// The real 18:13 prompt: benign by the prompt-based gate (no execution verb / no risk phrasing).
const BENIGN_PROMPT = 'The invoice PDF export throws a null error when a client has no address. Fix it and add a test that reproduces the bug.\n\nmake it look nicer';
// Draft wording of the kind the live LLM produced: risk pattern (production) + execution verbs
// (run / modify / delete) that the original prompt does not contain.
const RISKY_DRAFT = 'Run the invoice export for a client record that has no address, then modify the null-address handling and delete the stale production fixture so the regression test reproduces the failure.';

vi.mock('./llm-composer.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./llm-composer.js')>();
  return {
    ...original,
    composeStructuredComposerOutputV1: vi.fn(async (input: { planning: { sectionPlans: readonly { sectionId: string; sectionKind: string; structuredContentPartRefs: readonly string[] }[] } }) => {
      const plans = input.planning.sectionPlans.filter(
        (plan) => plan.sectionKind !== 'original_request_or_goal' && plan.structuredContentPartRefs.length > 0,
      );
      if (plans.length === 0) return undefined;
      return {
        outputId: 'llm-out-risky-parity-test',
        sectionDrafts: plans.map((plan) => ({
          sectionId: plan.sectionId,
          bodyText: RISKY_DRAFT,
          sourceFactIds: [plan.structuredContentPartRefs[0]!],
        })),
        composerClaims: [`claim:${plans[0]!.structuredContentPartRefs[0]!}`],
        detectedLanguageSelfReport: 'en',
      };
    }),
  };
});
// Belt-and-braces: with a (fake) key in the env the route-rescue path must also never reach a
// real client in this suite.
vi.mock('./llm-route-decision.js', () => ({
  decidePromptEnhancementRouteViaLlmV1: vi.fn(async () => undefined),
}));

function request(text: string): PromptEnhancementPrepareRequestV1 {
  const sourceRef: PromptEnhancementSourceRefV1 = {
    sourceRefId: 'src-a-1', sourceKind: 'source_a_user_prompt', sourceId: 'prompt:1',
    sourceAuthorization: 'source_fact_only', evidenceStatus: 'present', freshness: 'current', confidence: 'high', privacyClass: 'public_safe',
  };
  const p = getPromptStartStopSourceSnapshot();
  return {
    schemaVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION, requestId: 'parity-1', projectRoot: '/tmp/parity', hostSurface: 'cli_stop_bridge',
    sourcePrompt: { text, origin: 'user', capturedAt: 1, promptIndex: 1, generatedOriginPolicy: 'ordinary_source_a' },
    reviewMomentContext: { reviewMoment: 'UserPromptSubmit_preparation', currentAgentMode: 'workspace-write', projectId: 'p1', sessionId: 's1', detectedLanguage: 'en', stageCandidate: 'implementation', promptCount: 1, recentPromptMetadataRefs: [], triggerProvenance: { currentStage: 'implementation', prevStage: 'task_breakdown', triggerKind: 'stage_transition', classifierState: 'fire_recommended', degradedNoActionState: 'none', promptStartBoundary: p.hookBoundary, deliveryBoundary: p.deliveryBoundary, promptStartCanReplaceSameTurn: false } },
    sourceSignals: { sourceAOriginalPromptRef: sourceRef, sourceRefs: [sourceRef], normalizedStageAbsenceSignalRefs: [], contentTemplateRecordFactRefs: [], popupQuestionSourceRefs: [], whyHelpSourceRefs: [], profileRoleModeRefs: [], rightGoodWorkStyleEnvRuntimeRefs: [], missingMemoryCandidateRefs: [], sourceLabels: [{ sourceRefId: sourceRef.sourceRefId, label: 'original_prompt', evidenceStatus: 'present' }], promptStartStop: { hookBoundary: p.hookBoundary, deliveryBoundary: p.deliveryBoundary, runAutoCanHoldOrReplaceSubmittedPrompt: false, sharedSignalCount: p.sharedSignalCount, classifierDegradedNoFireReasons: p.classifierDegradedNoFireReasons }, store: { schemaVersion: 1, missingPromptEnhancementTables: [], cleanupGaps: [] }, transcriptPathState: 'not_authority', streamBOutputs: [], paramEventChannels: [], servedVariantIdentityRefs: [], deliveryGateRefs: [], sourceOnlyHardFactRefs: [] },
    userPreferenceContext: { levelState: 'default', scopedFeedbackEvidenceRefs: [] },
    configSnapshot: { sequenceEnabledState: 'not_enabled_v1', validatedEffectiveConfigState: 'valid', arbitraryConfigRowsAreAuthority: false },
    callVisibilityState: buildPromptEnhancementCostVisibilityMetadataV1('baseline_pe_composer', { callVisibilityMode: 'deterministic', plannedCallCount: 0, usedCallCount: 0 }),
    privacyAndStoragePolicy: { sensitivityClass: 'normal', localStorageEligibility: 'ids_and_categories_only', telemetryEligibility: 'allowlisted_counts_only', llmSharingEligibility: 'allowed_minimal', generatedBodyStoragePolicy: 'do_not_store_raw_by_default' },
  };
}

describe('composer/validator confirmation parity (blocked-popup fix 2026-08-07)', () => {
  const savedKey = process.env['OPENAI_API_KEY'];
  beforeEach(() => {
    // Format-valid fake key so the facade takes the LLM-wording path; the client is mocked
    // above — no real API call can happen in this suite.
    process.env['OPENAI_API_KEY'] = `sk-${'a'.repeat(24)}`;
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env['OPENAI_API_KEY'];
    else process.env['OPENAI_API_KEY'] = savedKey;
  });

  it('premise: the prompt-based gate does NOT require confirmation for the live-bug prompt', () => {
    expect(requiresPromptEnhancementExecutionConfirmationForPrompt(BENIGN_PROMPT)).toBe(false);
  });

  it('an LLM draft that introduces risk+execution wording composes SENDABLE with the canonical confirmation appended (was blocked_no_send)', async () => {
    const { preparePromptEnhancement } = await import('./facade.js');
    const result = await preparePromptEnhancement(request(BENIGN_PROMPT));
    // The exact live failure chain must be structurally impossible now.
    expect(result.disposition).toBe('show_current_body');
    expect(result.uiView.body.sendPolicy).toBe('send_current');
    expect(result.validationGraph.failures.filter((failure) => failure.blocking)).toEqual([]);
    // The LLM wording really was used (the guard fixed the body, not a deterministic fallback)…
    expect(result.currentBody.text).toContain('delete the stale production fixture');
    // …and the canonical go-ahead confirmation the validator demands is present, at the END of
    // the body (nothing sensitive can follow it, so hidden/overridden cannot trip either).
    const confirmation = buildPromptEnhancementCanonicalConfirmation(BENIGN_PROMPT);
    expect(result.currentBody.text).toContain(confirmation);
    expect(result.currentBody.text.trimEnd().endsWith(confirmation)).toBe(true);
  });

  it('the exported parity predicate mirrors the validator: true for generated risk+execution wording, false for benign guidance', () => {
    const currentBody = { sections: [], originalPromptText: BENIGN_PROMPT } as const;
    expect(promptEnhancementGeneratedBodyRequiresConfirmationV1(
      currentBody,
      `${BENIGN_PROMPT}\n\nImplementation Guidance:\n- ${RISKY_DRAFT}`,
    )).toBe(true);
    expect(promptEnhancementGeneratedBodyRequiresConfirmationV1(
      currentBody,
      `${BENIGN_PROMPT}\n\nImplementation Guidance:\n- Cover the null-address handling with a focused regression test and state how to verify the export output.`,
    )).toBe(false);
  });
});
