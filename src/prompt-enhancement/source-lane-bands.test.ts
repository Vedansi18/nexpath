import { describe, expect, it } from 'vitest';
import {
  applyPromptEnhancementSourceMixV1,
  promptEnhancementConfidenceBandForV1,
  promptEnhancementRecencyBandForV1,
  promptEnhancementSourceLaneForV1,
} from './source-mix.js';
import {
  PROMPT_ENHANCEMENT_LOCKED_SOURCE_KIND_EQUIVALENCE_V1,
  type PromptEnhancementGuidanceFact,
  type PromptEnhancementGuidanceSourceType,
} from './templates/section-plan.js';

function fact(overrides: Partial<PromptEnhancementGuidanceFact> = {}): PromptEnhancementGuidanceFact {
  return {
    factId: 'pe-fact-0',
    sourceType: 'absence_signal',
    sourceIds: ['absence:verification_gap@implementation'],
    guidanceKind: 'missing_practice',
    suggestedActionKind: 'add_verification',
    targetFamily: 'family_agnostic',
    targetSectionKind: 'verification_or_test_plan',
    sourceEvidenceState: 'strong',
    priority: 'normal',
    renderPolicy: 'render_as_section',
    riskLevel: 'low',
    safetyHooks: [],
    privacyClass: 'public_safe',
    sanitizationState: 'not_applicable',
    ...overrides,
  };
}

// ── A5 tier-2: the lanes are not collapsible (L4965's own gate) ──────────────

describe('A5 sourceLane — Source A, Source B and Source NEUTRAL are not collapsed', () => {
  it('the three locked lanes are each reachable and distinct', () => {
    const lanes = new Set([
      promptEnhancementSourceLaneForV1(fact({ sourceType: 'absence_signal' })),
      promptEnhancementSourceLaneForV1(fact({ sourceType: 'hard_fact' })),
      promptEnhancementSourceLaneForV1(fact({ sourceType: 'prompt_derived_fact' })),
    ]);
    expect(lanes).toEqual(new Set([
      'source_a_missing_practice',
      'source_b_grounding',
      'source_neutral_original',
    ]));
  });

  it('the NEUTRAL lane is not grounding — this is the collapse A5 exists to undo', () => {
    // Before A5 the only lane notion was source_a | source_b, so a fact known
    // ONLY from the user's own prompt carried the same lane label as an
    // independently corroborated project fact.
    expect(promptEnhancementSourceLaneForV1(fact({ sourceType: 'prompt_derived_fact' })))
      .not.toBe(promptEnhancementSourceLaneForV1(fact({ sourceType: 'hard_fact' })));
  });

  it('a fact whose knowledge is current-prompt-only is neutral even under another source type', () => {
    expect(promptEnhancementSourceLaneForV1(fact({
      sourceType: 'right_good_pattern',
      sourceOriginScope: 'current_prompt',
    }))).toBe('source_neutral_original');
  });

  it('the lane ON THE FACT is the authority — the mixer reads it, never re-derives it', () => {
    // The done-when: no local stand-in for lane semantics the lock puts on the
    // fact. If the mixer re-derived, an explicit lane would be ignored and the
    // field would be decoration.
    const relabelled = fact({
      factId: 'explicit-lane',
      sourceType: 'hard_fact',            // would derive as source_b_grounding
      sourceLane: 'source_a_missing_practice',
      priority: 'required_survivor',
    });
    const mix = applyPromptEnhancementSourceMixV1([relabelled], 'default');
    expect(mix.requiredSurvivor?.factId).toBe('explicit-lane');
    expect(mix.requiredSurvivor?.sourceLane).toBe('source_a_missing_practice');
  });

  it('but prompt-only knowledge can never be RELABELLED out of the neutral lane', () => {
    // The lane boundary mirrors the claim clamp: a producer must not be able to
    // promote the user's own words into missing-practice or grounding.
    const smuggled = fact({
      sourceType: 'prompt_derived_fact',
      sourceLane: 'source_a_missing_practice',
    });
    const mix = applyPromptEnhancementSourceMixV1([smuggled], 'default');
    const entry = mix.classifiedFacts.find((candidate) => candidate.fact.sourceType === 'prompt_derived_fact');
    expect(entry?.fact.sourceLane).toBe('source_neutral_original');
  });

  it('the lane lands ON THE FACT through the mixer, not only as a local', () => {
    const mix = applyPromptEnhancementSourceMixV1([fact(), fact({ factId: 'pe-fact-1', sourceType: 'hard_fact' })], 'default');
    for (const entry of mix.classifiedFacts) expect(entry.fact.sourceLane).toBeDefined();
    expect(mix.requiredSurvivor?.sourceLane).toBe('source_a_missing_practice');
  });
});

// ── A5 tier-3: stale/historical cannot be hidden (L4977's own gate) ──────────

describe('A5 recencyBand — stale and historical facts cannot be hidden', () => {
  it.each([
    ['current_prompt' as const, 'current_prompt'],
    ['recent_prompt_history' as const, 'current_session'],
    ['local_probe' as const, 'recent_project'],
    ['stored_memory' as const, 'historical'],
    ['longitudinal_param_events' as const, 'historical'],
  ])('origin %s bands as %s', (origin, expected) => {
    expect(promptEnhancementRecencyBandForV1(fact({ sourceOriginScope: origin }))).toBe(expected);
  });

  it('a months-old memory does NOT look like current-prompt evidence', () => {
    // The whole point of L4977: without the band these two render identically.
    const memory = fact({ sourceType: 'persistent_missing_signal_memory' });
    const current = fact({ sourceType: 'absence_signal' });
    expect(promptEnhancementRecencyBandForV1(memory)).toBe('historical');
    expect(promptEnhancementRecencyBandForV1(current)).toBe('current_prompt');
    expect(promptEnhancementRecencyBandForV1(memory)).not.toBe(promptEnhancementRecencyBandForV1(current));
  });

  it.each([
    ['stale memory', 'persistent_missing_signal_memory' as const],
    ['old RIGHT/GOOD', 'right_good_pattern' as const],
  ])('%s never SUPPRESSES current-prompt evidence (L4977 gate), in either arrival order', (_label, staleType) => {
    // The lock names this exact failure as the recency fixture: stale memory or
    // old RIGHT/GOOD suppressing current prompt evidence without reason-coded
    // conflict handling. Both orders, because survivor choice is order-dependent
    // on ties — so a one-order fixture would prove only half of it.
    const stale = fact({ factId: 'stale', sourceType: staleType, sourceEvidenceState: 'strong' });
    const current = fact({ factId: 'current', sourceType: 'absence_signal', sourceEvidenceState: 'strong' });
    for (const facts of [[stale, current], [current, stale]]) {
      const mix = applyPromptEnhancementSourceMixV1(facts, 'default');
      const rendered = mix.renderedFacts.map((entry) => entry.factId);
      expect(rendered, `current-prompt evidence suppressed by ${staleType}`).toContain('current');
    }
  });

  it('the band lands on the fact through the mixer, so nothing selected is unbanded', () => {
    const mix = applyPromptEnhancementSourceMixV1([fact({ sourceType: 'persistent_missing_signal_memory' })], 'default');
    for (const entry of mix.classifiedFacts) expect(entry.fact.recencyBand).toBeDefined();
  });
});

// ── A5 tier-3: low/unknown never outranks strong current Source A (L4976) ────

describe('A5 confidenceBand — low/unknown never outranks strong current Source A', () => {
  it.each([
    ['strong' as const, 'high'],
    ['partial' as const, 'medium'],
    ['weak_low_risk' as const, 'low'],
    ['weak_source_critical' as const, 'low'],
    ['conflicting' as const, 'low'],
    ['stale_or_unknown' as const, 'unknown'],
    ['missing' as const, 'unknown'],
  ])('evidence %s bands as %s', (evidence, expected) => {
    expect(promptEnhancementConfidenceBandForV1(fact({ sourceEvidenceState: evidence }))).toBe(expected);
  });

  it('a strong current Source A fact is the required survivor over a low-band grounding fact', () => {
    const mix = applyPromptEnhancementSourceMixV1([
      fact({ factId: 'weak-b', sourceType: 'hard_fact', sourceEvidenceState: 'weak_low_risk' }),
      fact({ factId: 'strong-a', sourceType: 'absence_signal', sourceEvidenceState: 'strong' }),
    ], 'default');
    expect(mix.requiredSurvivor?.factId).toBe('strong-a');
    expect(mix.requiredSurvivor?.confidenceBand).toBe('high');
  });
});

// ── A2's deferred obligation, now due: sourceType ≡ sourceKind ───────────────

describe('A5 sourceKind equivalence — the per-field fixture A2 owed to this phase', () => {
  const LOCKED_SOURCE_KINDS = [
    'persistent_missing_signal_memory', 'current_absence_signal', 'stage_transition_signal',
    'content_template_record', 'content_template_fact', 'current_advisory_signal',
    'env_fact', 'promoted_env_practice', 'right_good_pattern', 'work_style_trait',
    'prompt_derived_fact', 'original_prompt_point',
  ] as const;

  const SHIPPED_SOURCE_TYPES: readonly PromptEnhancementGuidanceSourceType[] = [
    'stage_transition', 'absence_signal', 'content_template_record',
    'content_template_runtime_fact', 'persistent_missing_signal_memory', 'hard_fact',
    'right_good_pattern', 'work_style_fact', 'prompt_derived_fact',
  ];

  it('every one of the twelve locked values is accounted for — none silently omitted', () => {
    expect(Object.keys(PROMPT_ENHANCEMENT_LOCKED_SOURCE_KIND_EQUIVALENCE_V1).sort())
      .toEqual([...LOCKED_SOURCE_KINDS].sort());
  });

  it('every shipped sourceType is claimed by exactly one locked value', () => {
    const claimed = Object.values(PROMPT_ENHANCEMENT_LOCKED_SOURCE_KIND_EQUIVALENCE_V1)
      .filter((value) => value !== 'not_produced');
    expect(new Set(claimed).size).toBe(claimed.length);
    expect([...claimed].sort()).toEqual([...SHIPPED_SOURCE_TYPES].sort());
  });

  it('the three unproduced locked values are exactly the recorded ones', () => {
    const unproduced = Object.entries(PROMPT_ENHANCEMENT_LOCKED_SOURCE_KIND_EQUIVALENCE_V1)
      .filter(([, value]) => value === 'not_produced')
      .map(([key]) => key)
      .sort();
    expect(unproduced).toEqual(['current_advisory_signal', 'original_prompt_point', 'promoted_env_practice']);
  });
});
