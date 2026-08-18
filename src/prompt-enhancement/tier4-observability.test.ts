import { describe, expect, it } from 'vitest';
import {
  applyPromptEnhancementSourceMixV1,
  estimatePromptEnhancementPayloadWeightV1,
} from './source-mix.js';
import {
  isPromptEnhancementRenderableRuntimePathV1,
  type PromptEnhancementGuidanceFact,
  type PromptEnhancementSelectionStateV1,
  type PromptEnhancementSourceRuntimePathV1,
} from './templates/section-plan.js';

/**
 * A6 — tier-4 observability fields (dev-plan §7.7), and the bill's two owed fixtures:
 * the RUNTIME-SEAM gate and FACT-ID STABILITY.
 *
 * The done-when: "the contract's fields all exist on the fact with locked names-or-proven-renames;
 * nothing lives only as a mixer local."
 */

function fact(overrides: Partial<PromptEnhancementGuidanceFact> = {}): PromptEnhancementGuidanceFact {
  return {
    factId: 'f-1',
    sourceType: 'absence_signal',
    sourceIds: ['absence:verification_gap@implementation'],
    guidanceKind: 'missing_practice',
    suggestedActionKind: 'add_verification',
    targetFamily: 'family_agnostic',
    targetSectionKind: 'verification_or_test_plan',
    sourceEvidenceState: 'strong',
    priority: 'required_survivor',
    renderPolicy: 'render_as_section',
    riskLevel: 'low',
    safetyHooks: [],
    privacyClass: 'public_safe',
    sanitizationState: 'not_applicable',
    ...overrides,
  };
}

describe('A6 — nothing lives only as a mixer local', () => {
  it('the mixer decision is PROMOTED onto every classified fact', () => {
    const result = applyPromptEnhancementSourceMixV1(
      [fact(), fact({ factId: 'f-2', priority: 'normal' })],
      'default',
    );
    expect(result.classifiedFacts.length).toBeGreaterThan(0);
    for (const entry of result.classifiedFacts) {
      // The done-when in one assertion: reading the FACT is enough — no consumer needs the envelope.
      expect(entry.fact.selectionState, `${entry.fact.factId} has no selectionState`).toBeDefined();
      expect(entry.fact.selectionReasonCodes, `${entry.fact.factId} has no reason codes`).toBeDefined();
      expect(entry.fact.selectionReasonCodes?.length).toBeGreaterThan(0);
      expect(entry.fact.sourceMixFactId).toBeDefined();
      expect(typeof entry.fact.payloadWeight).toBe('number');
    }
  });

  it('the promoted state MATCHES the mixer role — a copy that drifts is worse than none', () => {
    const result = applyPromptEnhancementSourceMixV1(
      [fact(), fact({ factId: 'f-2', priority: 'normal' })],
      'default',
    );
    for (const entry of result.classifiedFacts) {
      expect(entry.fact.selectionState).toBe(entry.selectionRole as PromptEnhancementSelectionStateV1);
      expect(entry.fact.selectionReasonCodes).toEqual([entry.selectionReasonCode]);
    }
  });
});

// ── The bill's runtime-seam fixture ─────────────────────────────────────────

describe('A6 / L4970 — an unknown or hidden runtime path must not DRIVE rendered guidance', () => {
  const ALL_PATHS: readonly PromptEnhancementSourceRuntimePathV1[] = [
    'local_static', 'local_store', 'local_probe', 'local_read_model',
    'runtime_llm_param_extract', 'runtime_llm_grounding', 'runtime_autogen', 'unknown',
  ];

  it('the locked eight are all typed, and exactly one of them is non-renderable', () => {
    expect(ALL_PATHS).toHaveLength(8);
    expect(ALL_PATHS.filter((path) => !isPromptEnhancementRenderableRuntimePathV1(path))).toEqual(['unknown']);
  });

  it('an UNKNOWN path is refused as a driver of rendered guidance', () => {
    expect(isPromptEnhancementRenderableRuntimePathV1('unknown')).toBe(false);
  });

  it('every DECLARED path is allowed — the gate blocks the hidden case, not the seams', () => {
    // The lock's concern is a path nobody can account for. A declared runtime seam is exactly what
    // PE-EM-1 visibility exists to report, so blocking those would defeat the field's purpose.
    for (const path of ALL_PATHS.filter((candidate) => candidate !== 'unknown')) {
      expect(isPromptEnhancementRenderableRuntimePathV1(path), `${path} was refused`).toBe(true);
    }
  });

  it('an absent path is not silently treated as unknown', () => {
    // Absence means "nobody stamped it", which is a different fact from "the path is hidden".
    // Conflating them would let a producer that simply has not been wired look like a leak.
    expect(isPromptEnhancementRenderableRuntimePathV1(undefined)).toBe(true);
  });
});

// ── The bill's fact-id stability fixture ────────────────────────────────────

describe('A6 / L4964 — sourceMixFactId is stable per popup-session and never rendered', () => {
  it('the same input yields the same id — a re-run does not renumber facts', () => {
    const input = [fact(), fact({ factId: 'f-2', priority: 'normal' })];
    const first = applyPromptEnhancementSourceMixV1(input, 'default');
    const second = applyPromptEnhancementSourceMixV1(input, 'default');
    const idsOf = (result: typeof first) => result.classifiedFacts.map((entry) => entry.fact.sourceMixFactId);
    expect(idsOf(first)).toEqual(idsOf(second));
  });

  it('DIFFERENT facts get different ids — stability is not sameness', () => {
    const result = applyPromptEnhancementSourceMixV1(
      [fact(), fact({ factId: 'f-2', priority: 'normal' })],
      'default',
    );
    const ids = result.classifiedFacts.map((entry) => entry.fact.sourceMixFactId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('the id never reaches rendered text — it carries no prompt content to render', () => {
    // L4964 says "never rendered". The structural guarantee is that the id is built from ids only,
    // so even a mistaken render would leak no user content — and nothing in the render path reads it.
    const result = applyPromptEnhancementSourceMixV1([fact({ evidence: { key: 'secret_key', value: 'secret-value' } })], 'default');
    const id = result.classifiedFacts[0]?.fact.sourceMixFactId ?? '';
    expect(id).not.toContain('secret-value');
    expect(id).toContain('f-1');
  });
});

// ── payloadWeight (L4979) ───────────────────────────────────────────────────

describe('A6 / L4979 — payloadWeight is a relative cap/visibility estimate', () => {
  it('a fact carrying more evidence weighs more', () => {
    const light = estimatePromptEnhancementPayloadWeightV1(fact({ evidence: { key: 'k', value: 'v' } }));
    const heavy = estimatePromptEnhancementPayloadWeightV1(
      fact({ evidence: { key: 'test_runner', value: 'vitest with a long configuration description attached' } }),
    );
    expect(heavy).toBeGreaterThan(light);
  });

  it('a fact with no evidence still has a weight — its source ids cost something', () => {
    expect(estimatePromptEnhancementPayloadWeightV1(fact())).toBeGreaterThan(0);
  });
});
