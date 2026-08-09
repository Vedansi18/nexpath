import { describe, expect, it, vi } from 'vitest';
import { buildPromptEnhancementCostObservabilityV1, emitPromptEnhancementCostObservabilityV1 } from './cost-measurement.js';
import { buildPromptEnhancementCostVisibilityMetadataV1 } from './cost-observability.js';
import type { PromptEnhancementCallVisibilityMode } from './contracts.js';
import type { PromptEnhancementPrepareResultV1 } from './contracts.js';

// The helper reads only enhancementId / requestId / callAndVisibilityMetadata from the
// result, so a partial fixture with a REAL visibility packet is a faithful stand-in.
function resultWith(
  mode: PromptEnhancementCallVisibilityMode,
  planned: number,
  used: number,
  failure?: { fallbackReason?: string; providerFailureState?: string },
  // TI-3.3 / TI-3.2 / TI-3 audit: reporting-only fields the emitter reads straight off the result.
  fallbackReport?: {
    deterministicFallbackApplied?: boolean;
    preSubstitutionAuthorityEscalationState?: string;
    compositionFallbackReasonCodes?: readonly string[];
    additionalDetailsTruncated?: boolean;
  },
): PromptEnhancementPrepareResultV1 {
  return {
    enhancementId: 'pe:req-1',
    requestId: 'req-1',
    callAndVisibilityMetadata: buildPromptEnhancementCostVisibilityMetadataV1('baseline_pe_composer', {
      callVisibilityMode: mode,
      plannedCallCount: planned,
      usedCallCount: used,
      ...(failure ?? {}),
    } as Parameters<typeof buildPromptEnhancementCostVisibilityMetadataV1>[1]),
    ...(fallbackReport ?? {}),
  } as unknown as PromptEnhancementPrepareResultV1;
}

describe('buildPromptEnhancementCostObservabilityV1 (E9 / P12-G1+G2)', () => {
  it('measures an llm_wording result off its REAL visibility (mode + used count), sanitized', () => {
    const obs = buildPromptEnhancementCostObservabilityV1(resultWith('llm_wording', 1, 1));
    expect(obs.measurement.status).toBe('used');
    expect(obs.measurement.usedCallCount).toBe(1); // P12-G2: real count, not the hardcoded 0
    expect(obs.measurement.plannedCallCount).toBe(1);
    // The sanitizer excludes every raw field + affirms cost cannot weaken behavior.
    expect(obs.measurement.rawPromptBodyExcluded).toBe(true);
    expect(obs.measurement.costVisibilityCanWeakenBehavior).toBe(false);
  });

  it('a deterministic result measures 0 used calls with a non-weakening status', () => {
    const obs = buildPromptEnhancementCostObservabilityV1(resultWith('deterministic', 0, 0));
    expect(obs.measurement.usedCallCount).toBe(0);
    expect(obs.measurement.status).toBe('planned');
  });

  it('gate-rule-4: the weakening check runs and reports NO cost-based weakening (clean sentinel only)', () => {
    const obs = buildPromptEnhancementCostObservabilityV1(resultWith('llm_wording', 1, 1));
    expect(obs.costWeakeningDetected).toBe(false);
    expect(obs.weakeningReasonCodes).toEqual(['cost_visibility_is_not_runtime_limiter']);
  });

  it('validates the accepted-call inventory and builds runtime flow evidence across surfaces', () => {
    const obs = buildPromptEnhancementCostObservabilityV1(resultWith('fallback_no_llm', 1, 0));
    expect(obs.inventoryOk).toBe(true);
    expect(obs.measurement.status).toBe('fallback');
    // Flow evidence is built from the same result (prompt-start -> popup -> delivery).
    expect(obs.flowEvidence).toBeDefined();
  });
});

describe('emitPromptEnhancementCostObservabilityV1 (E9 — surface emission)', () => {
  it('emits the sanitized measurement (surface-labelled) and does NOT warn when nothing weakens', () => {
    const sink = { debug: vi.fn(), warn: vi.fn() };
    const obs = emitPromptEnhancementCostObservabilityV1(resultWith('llm_wording', 1, 1), 'popup_action', sink);
    expect(sink.debug).toHaveBeenCalledTimes(1);
    expect(sink.debug).toHaveBeenCalledWith('prompt_enhancement_cost_measurement', expect.objectContaining({
      surface: 'popup_action', usedCallCount: 1, rawFieldsExcluded: true,
    }));
    expect(sink.warn).not.toHaveBeenCalled(); // gate-rule-4: clean -> no weakening warning
    expect(obs?.costWeakeningDetected).toBe(false);
  });

  it('is best-effort: a throwing sink is swallowed (never breaks the runtime path)', () => {
    const throwingSink = { debug: () => { throw new Error('logger down'); }, warn: vi.fn() };
    expect(() => emitPromptEnhancementCostObservabilityV1(resultWith('llm_wording', 1, 1), 'popup_action', throwingSink))
      .not.toThrow();
    expect(emitPromptEnhancementCostObservabilityV1(resultWith('llm_wording', 1, 1), 'popup_action', throwingSink))
      .toBeUndefined();
  });

  it('TI-2: surfaces fallbackReason + providerFailureState so a provider failure is distinguishable in the log', () => {
    const sink = { debug: vi.fn(), warn: vi.fn() };
    emitPromptEnhancementCostObservabilityV1(
      resultWith('fallback_no_llm', 1, 1, { fallbackReason: 'timeout', providerFailureState: 'timeout' }),
      'prepare',
      sink,
    );
    expect(sink.debug).toHaveBeenCalledWith('prompt_enhancement_cost_measurement', expect.objectContaining({
      callVisibilityMode: 'fallback_no_llm',
      fallbackReason: 'timeout',
      providerFailureState: 'timeout',
    }));
    // A never-eligible deterministic run stays clearly different.
    const sink2 = { debug: vi.fn(), warn: vi.fn() };
    emitPromptEnhancementCostObservabilityV1(resultWith('deterministic', 0, 0), 'prepare', sink2);
    expect(sink2.debug).toHaveBeenCalledWith('prompt_enhancement_cost_measurement', expect.objectContaining({
      callVisibilityMode: 'deterministic',
      providerFailureState: 'none',
    }));
  });

  it('TI-3.3: a blocked-then-silently-replaced body logs distinctly from a clean run', () => {
    // Blocked LLM body → deterministic substitution fired: the emitted safetySummary describes the
    // replacement, so the ONLY trace of the block is these reporting fields.
    const sink = { debug: vi.fn(), warn: vi.fn() };
    emitPromptEnhancementCostObservabilityV1(
      resultWith('llm_wording', 1, 1, undefined, {
        deterministicFallbackApplied: true,
        preSubstitutionAuthorityEscalationState: 'invalid_non_sendable',
      }),
      'prepare',
      sink,
    );
    expect(sink.debug).toHaveBeenCalledWith('prompt_enhancement_cost_measurement', expect.objectContaining({
      callVisibilityMode: 'llm_wording',
      deterministicFallbackApplied: true,
      preSubstitutionAuthorityEscalationState: 'invalid_non_sendable',
    }));
    // A clean llm_wording run (no substitution) stays visibly different: false + undefined verdict.
    const sink2 = { debug: vi.fn(), warn: vi.fn() };
    emitPromptEnhancementCostObservabilityV1(resultWith('llm_wording', 1, 1), 'prepare', sink2);
    expect(sink2.debug).toHaveBeenCalledWith('prompt_enhancement_cost_measurement', expect.objectContaining({
      deterministicFallbackApplied: false,
      preSubstitutionAuthorityEscalationState: undefined,
    }));
  });

  it('TI-3.2: surfaces the compose-layer fallback reason codes the public diagnostics genericize away', () => {
    // The draft-rejection cause names WHICH of six rules refused the body — a debugger-free trace.
    const sink = { debug: vi.fn(), warn: vi.fn() };
    emitPromptEnhancementCostObservabilityV1(
      resultWith('fallback_no_llm', 1, 1, undefined, {
        compositionFallbackReasonCodes: ['deterministic_fallback:invalid_output:unresolved_placeholder'],
      }),
      'prepare',
      sink,
    );
    expect(sink.debug).toHaveBeenCalledWith('prompt_enhancement_cost_measurement', expect.objectContaining({
      compositionFallbackReasonCodes: ['deterministic_fallback:invalid_output:unresolved_placeholder'],
    }));
    // A clean run (no compose-layer fallback) logs an empty list — visibly different.
    const sink2 = { debug: vi.fn(), warn: vi.fn() };
    emitPromptEnhancementCostObservabilityV1(resultWith('llm_wording', 1, 1), 'prepare', sink2);
    expect(sink2.debug).toHaveBeenCalledWith('prompt_enhancement_cost_measurement', expect.objectContaining({
      compositionFallbackReasonCodes: [],
    }));
  });

  it('TI-3 audit follow-up: surfaces additionalDetailsTruncated so an input-cap truncation is visible in the log', () => {
    const sink = { debug: vi.fn(), warn: vi.fn() };
    emitPromptEnhancementCostObservabilityV1(
      resultWith('deterministic', 0, 0, undefined, { additionalDetailsTruncated: true }),
      'popup_action',
      sink,
    );
    expect(sink.debug).toHaveBeenCalledWith('prompt_enhancement_cost_measurement', expect.objectContaining({
      additionalDetailsTruncated: true,
    }));
    // A run with no truncation logs false — visibly distinct.
    const sink2 = { debug: vi.fn(), warn: vi.fn() };
    emitPromptEnhancementCostObservabilityV1(resultWith('deterministic', 0, 0), 'popup_action', sink2);
    expect(sink2.debug).toHaveBeenCalledWith('prompt_enhancement_cost_measurement', expect.objectContaining({
      additionalDetailsTruncated: false,
    }));
  });

  it('labels the prepare surface distinctly', () => {
    const sink = { debug: vi.fn(), warn: vi.fn() };
    emitPromptEnhancementCostObservabilityV1(resultWith('deterministic', 0, 0), 'prepare', sink);
    expect(sink.debug).toHaveBeenCalledWith('prompt_enhancement_cost_measurement', expect.objectContaining({
      surface: 'prepare', usedCallCount: 0,
    }));
  });
});
