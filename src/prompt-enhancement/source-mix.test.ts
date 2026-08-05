import { describe, expect, it } from 'vitest';
import { applyPromptEnhancementSourceMixV1 } from './source-mix.js';
import type {
  PromptEnhancementGuidanceFact,
  PromptEnhancementGuidanceSourceType,
} from './templates/section-plan.js';

// Minimal well-formed fact factory. Defaults are a valid Source-B-ish grounding fact;
// override sourceType/priority/risk per case.
function fact(
  overrides: Partial<PromptEnhancementGuidanceFact> & { factId: string; sourceType: PromptEnhancementGuidanceSourceType },
): PromptEnhancementGuidanceFact {
  return {
    sourceIds: [`${overrides.factId}-src`],
    guidanceKind: 'project_grounding',
    suggestedActionKind: 'no_action_render_context_only',
    targetFamily: 'family_agnostic',
    targetSectionKind: '',
    sourceEvidenceState: 'partial',
    priority: 'normal',
    renderPolicy: 'render_as_section',
    riskLevel: 'none',
    safetyHooks: [],
    privacyClass: 'public_safe',
    sanitizationState: 'not_applicable',
    publicCopySafe: true,
    ...overrides,
  };
}

const absence = (id: string, extra: Partial<PromptEnhancementGuidanceFact> = {}) =>
  fact({ factId: id, sourceType: 'absence_signal', priority: 'required_survivor', guidanceKind: 'missing_practice', ...extra });
const hardFact = (id: string, extra: Partial<PromptEnhancementGuidanceFact> = {}) =>
  fact({ factId: id, sourceType: 'hard_fact', ...extra });

describe('applyPromptEnhancementSourceMixV1 (E2 / 2.2)', () => {
  it('DR2-G1: no Source A -> skip popup, no Source B filler', () => {
    const result = applyPromptEnhancementSourceMixV1([hardFact('h1'), hardFact('h2')]);
    expect(result.showPopup).toBe(false);
    expect(result.profile).toBe('source_b_only_no_popup');
    expect(result.requiredSurvivor).toBeNull();
    expect(result.renderedFacts).toEqual([]);
    expect(result.classifiedFacts.every((c) => c.selectionRole === 'suppressed_by_payload_cap')).toBe(true);
  });

  it('DR2-G1: nothing at all -> no_useful_source_a_skip', () => {
    const result = applyPromptEnhancementSourceMixV1([]);
    expect(result.showPopup).toBe(false);
    expect(result.profile).toBe('no_useful_source_a_skip');
  });

  it('one Source A, no Source B -> source_a_only, shown', () => {
    const result = applyPromptEnhancementSourceMixV1([absence('a1')]);
    expect(result.showPopup).toBe(true);
    expect(result.profile).toBe('source_a_only');
    expect(result.requiredSurvivor?.factId).toBe('a1');
    expect(result.renderedFacts.map((f) => f.factId)).toEqual(['a1']);
  });

  it('one Source A + one Source B -> source_a_with_light_grounding', () => {
    const result = applyPromptEnhancementSourceMixV1([absence('a1'), hardFact('h1')]);
    expect(result.profile).toBe('source_a_with_light_grounding');
    expect(result.renderedFacts.map((f) => f.factId)).toEqual(['a1', 'h1']);
  });

  it('multiple Source A with no Source B -> source_a_only (no-B is the hallmark, not supporting-A count)', () => {
    const result = applyPromptEnhancementSourceMixV1([absence('a1'), absence('a2')]);
    expect(result.profile).toBe('source_a_only');
    // a1 anchors, a2 is supporting within the default cap — both rendered, still no Source B.
    expect(result.renderedFacts.map((f) => f.factId)).toEqual(['a1', 'a2']);
  });

  it('strong Source A + multiple Source B -> balanced_dual_source', () => {
    const result = applyPromptEnhancementSourceMixV1([absence('a1'), hardFact('h1'), hardFact('h2')]);
    expect(result.profile).toBe('balanced_dual_source');
    expect(result.renderedFacts.map((f) => f.factId)).toEqual(['a1', 'h1', 'h2']);
  });

  it('exactly one required Source A survivor; extra Source A is supporting under default cap', () => {
    const result = applyPromptEnhancementSourceMixV1([absence('a1'), absence('a2')]);
    const required = result.classifiedFacts.filter((c) => c.selectionRole === 'selected_required');
    expect(required).toHaveLength(1);
    expect(required[0].fact.factId).toBe('a1');
    expect(result.classifiedFacts.find((c) => c.fact.factId === 'a2')?.selectionRole).toBe('selected_supporting');
  });

  it('caps Source B at 2 by default; overflow is suppressed_by_payload_cap (visible reason)', () => {
    const result = applyPromptEnhancementSourceMixV1([absence('a1'), hardFact('h1'), hardFact('h2'), hardFact('h3')]);
    expect(result.renderedFacts).toHaveLength(3); // a1 + h1 + h2
    const h3 = result.classifiedFacts.find((c) => c.fact.factId === 'h3');
    expect(h3?.selectionRole).toBe('suppressed_by_payload_cap');
    expect(result.profile).toBe('over_token_or_source_cap_compressed');
  });

  it('More project-grounded raises Source B cap to 3', () => {
    const result = applyPromptEnhancementSourceMixV1(
      [absence('a1'), hardFact('h1'), hardFact('h2'), hardFact('h3')],
      'more_project_grounded',
    );
    expect(result.renderedFacts).toHaveLength(4);
  });

  it('total cap of 5 holds even when level caps would allow more', () => {
    const facts = [
      absence('a1'),
      absence('a2'),
      hardFact('h1'),
      hardFact('h2'),
      hardFact('h3'),
    ];
    const result = applyPromptEnhancementSourceMixV1(facts, 'more_thorough');
    expect(result.renderedFacts.length).toBeLessThanOrEqual(5);
  });

  it('high-risk Source A -> source_a_heavy_high_risk', () => {
    const result = applyPromptEnhancementSourceMixV1([
      absence('a1', { riskLevel: 'sensitive_authority_risky', guidanceKind: 'safety_or_confirmation' }),
      hardFact('h1'),
    ]);
    expect(result.profile).toBe('source_a_heavy_high_risk');
  });

  it('source-critical supporting Source A over cap stays visible (label_only), never invisible', () => {
    // a1 anchors; a2 (non-critical) fills the default supporting-A cap of 1; a3 is a
    // source-critical Source A over the cap -> must stay visible as label_only.
    const result = applyPromptEnhancementSourceMixV1([
      absence('a1'),
      absence('a2'),
      absence('a3', { riskLevel: 'high' }),
    ]);
    expect(result.classifiedFacts.find((c) => c.fact.factId === 'a2')?.selectionRole).toBe('selected_supporting');
    const a3 = result.classifiedFacts.find((c) => c.fact.factId === 'a3');
    expect(a3?.selectionRole).toBe('selected_source_label_only');
  });

  it('invalid Source A (no source ids) with none valid remaining -> source_invalid_fallback', () => {
    const bad = fact({ factId: 'bad', sourceType: 'absence_signal', priority: 'required_survivor', sourceIds: [] });
    const result = applyPromptEnhancementSourceMixV1([bad, hardFact('h1')]);
    expect(result.showPopup).toBe(false);
    expect(result.profile).toBe('source_invalid_fallback');
  });

  it('invalid Source A dropped but a valid Source A remains -> recovers to a shown profile', () => {
    const bad = fact({ factId: 'bad', sourceType: 'absence_signal', priority: 'required_survivor', sourceIds: [] });
    const result = applyPromptEnhancementSourceMixV1([bad, absence('a1')]);
    expect(result.showPopup).toBe(true);
    expect(result.requiredSurvivor?.factId).toBe('a1');
  });
});
