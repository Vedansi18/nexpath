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

  it('excludes suppressed-priority facts from selection (e.g. a conflict-suppressed positive fact)', () => {
    const suppressed = fact({ factId: 'rg1', sourceType: 'right_good_pattern', priority: 'suppressed', renderPolicy: 'suppress_with_reason' });
    const result = applyPromptEnhancementSourceMixV1([absence('a1'), suppressed]);
    // rg1 is suppressed -> not a Source B candidate; only a1 renders, so no useful B.
    expect(result.profile).toBe('source_a_only');
    expect(result.classifiedFacts.some((c) => c.fact.factId === 'rg1')).toBe(false);
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

// ── Tier-1 normalization + the two Source-B lane boundaries ───────────────────

describe('tier-1 evidence fields at the mix seam', () => {
  it('every fact entering the mix is classified WITH origin scope, claim policy, and role (legacy facts get defaults)', () => {
    const result = applyPromptEnhancementSourceMixV1([absence('a1'), hardFact('h1')]);
    for (const entry of result.classifiedFacts) {
      expect(entry.fact.sourceOriginScope).toBeDefined();
      expect(entry.fact.claimVerbPolicy).toBeDefined();
      expect(entry.fact.factRole).toBeDefined();
    }
    const survivor = result.classifiedFacts.find((c) => c.selectionRole === 'selected_required')!;
    expect(survivor.fact.sourceOriginScope).toBe('current_prompt');
    expect(survivor.fact.factRole).toBe('required_source_signal_survivor');
    const grounding = result.classifiedFacts.find((c) => c.fact.sourceType === 'hard_fact')!;
    expect(grounding.fact.sourceOriginScope).toBe('local_probe');
    expect(grounding.fact.claimVerbPolicy).toBe('must_phrase_as_possibility');
    expect(grounding.fact.factRole).toBe('project_grounding_support');
  });

  // The prompt-derived HARD-FAIL: a fact known only from prompt text, asked to pose
  // as project knowledge, is clamped to possibility wording — it cannot masquerade.
  it('a prompt-only fact phrased as project knowledge is CLAMPED to possibility wording', () => {
    const smuggled = fact({
      factId: 'p1',
      sourceType: 'prompt_derived_fact',
      sourceOriginScope: 'current_prompt',
      claimVerbPolicy: 'may_state_as_project_capability',
    });
    const result = applyPromptEnhancementSourceMixV1([absence('a1'), smuggled]);
    const entry = result.classifiedFacts.find((c) => c.fact.factId === 'p1')!;
    expect(entry.fact.claimVerbPolicy).toBe('must_phrase_as_possibility');
  });

  it('prompt-only knowledge never satisfies a Source B cap — label-only, and the cap slot stays open', () => {
    const promptFact = fact({ factId: 'p1', sourceType: 'prompt_derived_fact' });
    const probed = hardFact('h1');
    const result = applyPromptEnhancementSourceMixV1([absence('a1'), promptFact, probed]);
    const promptEntry = result.classifiedFacts.find((c) => c.fact.factId === 'p1')!;
    expect(promptEntry.selectionRole).toBe('selected_source_label_only');
    expect(promptEntry.selectionReasonCode).toBe('prompt_derived_not_independent_grounding');
    // The probed fact still takes a grounding slot — the prompt fact consumed none.
    const probedEntry = result.classifiedFacts.find((c) => c.fact.factId === 'h1')!;
    expect(probedEntry.selectionRole).toBe('selected_supporting');
  });

  it('a false capability (safety role) never counts as Source B grounding', () => {
    const falseCap = hardFact('neg1', { factRole: 'safety_confirmation_support', renderPolicy: 'metadata_only' });
    const probed = hardFact('h1');
    const result = applyPromptEnhancementSourceMixV1([absence('a1'), falseCap, probed]);
    const negEntry = result.classifiedFacts.find((c) => c.fact.factId === 'neg1')!;
    expect(negEntry.selectionRole).toBe('selected_source_label_only');
    expect(negEntry.selectionReasonCode).toBe('negative_capability_safety_not_grounding');
    expect(result.renderedFacts.map((f) => f.factId)).not.toContain('neg1');
    const probedEntry = result.classifiedFacts.find((c) => c.fact.factId === 'h1')!;
    expect(probedEntry.selectionRole).toBe('selected_supporting');
  });

  // One fixture per locked origin-scope value: each is representable, survives
  // normalization, and its gate holds where the value carries one.
  it('all ten origin-scope values are representable, with their gates', () => {
    const scopes = [
      'current_prompt',
      'recent_prompt_history',
      'local_probe',
      'longitudinal_param_events',
      'served_variant_identity',
      'transcript_corroboration',
      'stored_memory',
      'content_template_registry',
      'content_template_runtime',
      'original_point_inventory',
    ] as const;
    for (const scope of scopes) {
      const probe = fact({
        factId: `s-${scope}`,
        sourceType: 'hard_fact',
        sourceOriginScope: scope,
        claimVerbPolicy: 'may_state_as_project_capability',
      });
      const result = applyPromptEnhancementSourceMixV1([absence('a1'), probe]);
      const entry = result.classifiedFacts.find((c) => c.fact.factId === `s-${scope}`)!;
      expect(entry.fact.sourceOriginScope).toBe(scope);
      if (scope === 'current_prompt' || scope === 'recent_prompt_history') {
        // Prompt-only gate: clamped wording, never an independent grounding slot.
        expect(entry.fact.claimVerbPolicy).toBe('must_phrase_as_possibility');
        expect(entry.selectionRole).toBe('selected_source_label_only');
      } else if (scope === 'served_variant_identity') {
        // Served rows stay provenance-only — never practice proof.
        expect(entry.fact.claimVerbPolicy).toBe('source_label_only');
      } else {
        expect(entry.fact.claimVerbPolicy).toBe('may_state_as_project_capability');
      }
    }
  });
});

// ── Rename reconciliation: shipped field names kept, equivalence proven ───────
// The contract's business concepts ship under renamed TypeScript fields. Decision:
// KEEP the shipped names (a rename would ripple through every consumer for zero
// behaviour) and pin the semantic equivalence here instead:
//   - `sourceEvidenceState` ≡ the contract's `evidenceState` — value sets identical.
//   - `sourceType` carries the contract's `sourceKind` concept — the full 12-value
//     set completion is later contract-tail work.
//   - `privacyClass` carries the contract's `sensitivityClass` concept — the full
//     5-value locked set lands with the sensitive-literal boundary work.

describe('rename reconciliation (shipped names ≡ contract concepts)', () => {
  it('sourceEvidenceState accepts exactly the evidenceState value set', () => {
    const evidenceStates = [
      'strong', 'partial', 'weak_low_risk', 'weak_source_critical',
      'conflicting', 'missing', 'stale_or_unknown',
    ] as const;
    for (const state of evidenceStates) {
      const probe = fact({ factId: `e-${state}`, sourceType: 'hard_fact', sourceEvidenceState: state });
      expect(probe.sourceEvidenceState).toBe(state);
    }
  });
});

describe('unknown capability facts and grounding caps', () => {
  it('a stale_or_unknown fact never satisfies a grounding cap — label-only, slot stays open', () => {
    const unknownCap = hardFact('u1', { sourceEvidenceState: 'stale_or_unknown' });
    const probed = hardFact('h1');
    const result = applyPromptEnhancementSourceMixV1([absence('a1'), unknownCap, probed]);
    const unknownEntry = result.classifiedFacts.find((c) => c.fact.factId === 'u1')!;
    expect(unknownEntry.selectionRole).toBe('selected_source_label_only');
    expect(unknownEntry.selectionReasonCode).toBe('stale_or_unknown_not_grounding');
    expect(result.renderedFacts.map((f) => f.factId)).not.toContain('u1');
    // The probed fact still takes the grounding slot the unknown one did not consume.
    expect(result.classifiedFacts.find((c) => c.fact.factId === 'h1')!.selectionRole).toBe('selected_supporting');
  });
});

describe('suppression persists once facts carry content', () => {
  it('a conflict-suppressed fact WITH resolved evidence stays suppressed — content does not resurrect it', () => {
    const suppressedWithContent = fact({
      factId: 'sup1',
      sourceType: 'right_good_pattern',
      priority: 'suppressed',
      renderPolicy: 'suppress_with_reason',
      evidence: { key: 'test_creation', value: 'right_good:behaviour_verified' },
    });
    const result = applyPromptEnhancementSourceMixV1([absence('a1'), suppressedWithContent]);
    expect(result.renderedFacts.map((f) => f.factId)).not.toContain('sup1');
    expect(result.classifiedFacts.find((c) => c.fact.factId === 'sup1')).toBeUndefined();
  });
});
