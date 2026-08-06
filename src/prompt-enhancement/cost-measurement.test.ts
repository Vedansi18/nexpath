import { describe, expect, it, vi } from 'vitest';
import { buildPromptEnhancementCostObservabilityV1, emitPromptEnhancementCostObservabilityV1 } from './cost-measurement.js';
import { buildPromptEnhancementCostVisibilityMetadataV1 } from './cost-observability.js';
import type { PromptEnhancementCallVisibilityMode } from './contracts.js';
import type { PromptEnhancementPrepareResultV1 } from './contracts.js';

// The helper reads only enhancementId / requestId / callAndVisibilityMetadata from the
// result, so a partial fixture with a REAL visibility packet is a faithful stand-in.
function resultWith(mode: PromptEnhancementCallVisibilityMode, planned: number, used: number): PromptEnhancementPrepareResultV1 {
  return {
    enhancementId: 'pe:req-1',
    requestId: 'req-1',
    callAndVisibilityMetadata: buildPromptEnhancementCostVisibilityMetadataV1('baseline_pe_composer', {
      callVisibilityMode: mode,
      plannedCallCount: planned,
      usedCallCount: used,
    }),
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

  it('labels the prepare surface distinctly', () => {
    const sink = { debug: vi.fn(), warn: vi.fn() };
    emitPromptEnhancementCostObservabilityV1(resultWith('deterministic', 0, 0), 'prepare', sink);
    expect(sink.debug).toHaveBeenCalledWith('prompt_enhancement_cost_measurement', expect.objectContaining({
      surface: 'prepare', usedCallCount: 0,
    }));
  });
});
