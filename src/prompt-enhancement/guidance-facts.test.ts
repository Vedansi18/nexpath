import { describe, expect, it } from 'vitest';
import type {
  PromptEnhancementPrepareRequestV1,
  PromptEnhancementSourceInputSnapshotV1,
  PromptEnhancementTriggerProvenanceV1,
} from './contracts.js';
import { buildPromptEnhancementGuidanceFactsV1 } from './guidance-facts.js';

// The builder reads request.sourceSignals + the review-moment trigger, so a focused
// fixture carrying just those (cast to the full request type) keeps these tests on the
// unit under test rather than the whole prepare-request contract. The trigger defaults
// to 'none' so ref-driven cases stay isolated from the current-trigger fact.
function requestWithSignals(
  overrides: Partial<PromptEnhancementSourceInputSnapshotV1>,
  trigger: PromptEnhancementTriggerProvenanceV1 = { triggerKind: 'none', currentStage: 'implementation' },
): PromptEnhancementPrepareRequestV1 {
  const sourceSignals = {
    normalizedStageAbsenceSignalRefs: [],
    contentTemplateRecordFactRefs: [],
    missingMemoryCandidateRefs: [],
    rightGoodWorkStyleEnvRuntimeRefs: [],
    sourceOnlyHardFactRefs: [],
    ...overrides,
  } as unknown as PromptEnhancementSourceInputSnapshotV1;
  return { sourceSignals, reviewMomentContext: { triggerProvenance: trigger } } as unknown as PromptEnhancementPrepareRequestV1;
}

describe('buildPromptEnhancementGuidanceFactsV1 (E2 / 2.1)', () => {
  it('returns no facts when no source signals are present', () => {
    expect(buildPromptEnhancementGuidanceFactsV1(requestWithSignals({}))).toEqual([]);
  });

  it('builds a Source-A stage_transition fact from a current stage-transition trigger', () => {
    const facts = buildPromptEnhancementGuidanceFactsV1(
      requestWithSignals({}, { triggerKind: 'stage_transition', currentStage: 'implementation', prevStage: 'task_breakdown' }),
    );
    expect(facts).toHaveLength(1);
    expect(facts[0].sourceType).toBe('stage_transition');
    expect(facts[0].guidanceKind).toBe('stage_transition_discipline');
    expect(facts[0].priority).toBe('high');
    expect(facts[0].sourceIds).toEqual(['stage:task_breakdown-to-implementation']);
  });

  it('builds a Source-A absence fact from a current absence trigger', () => {
    const facts = buildPromptEnhancementGuidanceFactsV1(
      requestWithSignals({}, { triggerKind: 'absence', currentStage: 'implementation', selectedQualifyingAbsence: 'acceptance_criteria' }),
    );
    expect(facts).toHaveLength(1);
    expect(facts[0].sourceType).toBe('absence_signal');
    expect(facts[0].priority).toBe('required_survivor');
    expect(facts[0].sourceIds).toEqual(['absence:acceptance_criteria']);
  });

  it('adds no current-trigger fact for a manual/none trigger', () => {
    expect(buildPromptEnhancementGuidanceFactsV1(requestWithSignals({}, { triggerKind: 'manual', currentStage: 'implementation' }))).toEqual([]);
    expect(buildPromptEnhancementGuidanceFactsV1(requestWithSignals({}, { triggerKind: 'none', currentStage: 'implementation' }))).toEqual([]);
  });

  it('normalizes a shown stage/absence signal into a required-survivor source-signal fact', () => {
    const facts = buildPromptEnhancementGuidanceFactsV1(
      requestWithSignals({ normalizedStageAbsenceSignalRefs: ['absence:acceptance_criteria'] }),
    );
    expect(facts).toHaveLength(1);
    const [fact] = facts;
    expect(fact.sourceType).toBe('absence_signal');
    expect(fact.priority).toBe('required_survivor');
    expect(fact.renderPolicy).toBe('render_as_section');
    expect(fact.targetSectionKind).toBe('source_signal_guidance');
    expect(fact.sourceIds).toEqual(['absence:acceptance_criteria']);
    expect(fact.requiredBecause).toBe('source_signal_guidance_shown_in_popup');
    expect(fact.publicCopySafe).toBe(true);
  });

  it('normalizes a content-template record as source evidence only (inline supporting clause, no direct copy)', () => {
    const [fact] = buildPromptEnhancementGuidanceFactsV1(
      requestWithSignals({ contentTemplateRecordFactRefs: ['ctpl:verification'] }),
    );
    expect(fact.sourceType).toBe('content_template_record');
    expect(fact.priority).toBe('normal');
    expect(fact.renderPolicy).toBe('render_as_inline_clause');
    expect(fact.mergePolicy).toBe('merge_as_supporting_clause');
    expect(fact.privacyClass).toBe('local_private');
  });

  it('normalizes a hard fact as normal project grounding (Source B)', () => {
    const [fact] = buildPromptEnhancementGuidanceFactsV1(
      requestWithSignals({ sourceOnlyHardFactRefs: ['hard_fact:react'] }),
    );
    expect(fact.sourceType).toBe('hard_fact');
    expect(fact.guidanceKind).toBe('project_grounding');
    expect(fact.suggestedActionKind).toBe('ground_in_project_fact');
    expect(fact.priority).toBe('normal');
    expect(fact.privacyClass).toBe('local_private');
  });

  it('classifies profile signals: work-style vs right/good, both weak metadata-only tie-breakers', () => {
    const facts = buildPromptEnhancementGuidanceFactsV1(
      requestWithSignals({
        rightGoodWorkStyleEnvRuntimeRefs: ['work_style:testing:high', 'right_good:writes_tests'],
      }),
    );
    const workStyle = facts.find((f) => f.sourceType === 'work_style_fact');
    const rightGood = facts.find((f) => f.sourceType === 'right_good_pattern');
    expect(workStyle).toBeDefined();
    expect(rightGood).toBeDefined();
    for (const fact of facts) {
      expect(fact.priority).toBe('low');
      expect(fact.renderPolicy).toBe('metadata_only');
      expect(fact.registerRoleSource).toBe('profile_register');
    }
    expect(rightGood?.suggestedActionKind).toBe('preserve_behavior');
    expect(workStyle?.suggestedActionKind).toBe('no_action_render_context_only');
  });

  it('routes a mistake signal into Source A missing-practice, not the positive Source-B lane', () => {
    const [fact] = buildPromptEnhancementGuidanceFactsV1(
      requestWithSignals({ rightGoodWorkStyleEnvRuntimeRefs: ['mistake:skips_verification'] }),
    );
    expect(fact.sourceType).toBe('absence_signal');
    expect(fact.guidanceKind).toBe('missing_practice');
    expect(fact.renderPolicy).toBe('render_as_section');
    expect(fact.sourceIds).toEqual(['mistake:skips_verification']);
  });

  it('dedupes facts that share source type + source id', () => {
    const facts = buildPromptEnhancementGuidanceFactsV1(
      requestWithSignals({ sourceOnlyHardFactRefs: ['hard_fact:react', 'hard_fact:react'] }),
    );
    expect(facts).toHaveLength(1);
  });

  it('ranks required survivors before normal before low', () => {
    const facts = buildPromptEnhancementGuidanceFactsV1(
      requestWithSignals({
        rightGoodWorkStyleEnvRuntimeRefs: ['work_style:testing:high'],
        sourceOnlyHardFactRefs: ['hard_fact:react'],
        normalizedStageAbsenceSignalRefs: ['absence:acceptance_criteria'],
      }),
    );
    expect(facts.map((f) => f.priority)).toEqual(['required_survivor', 'normal', 'low']);
  });

  it('assigns a unique factId to every fact', () => {
    const facts = buildPromptEnhancementGuidanceFactsV1(
      requestWithSignals({
        normalizedStageAbsenceSignalRefs: ['absence:a', 'absence:b'],
        sourceOnlyHardFactRefs: ['hard_fact:react'],
      }),
    );
    const ids = facts.map((f) => f.factId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ── Tier-1 evidence fields: claim policy from corroboration tier, role from polarity ──

describe('tier-1 evidence fields (claim-policy trio + polarity trio)', () => {
  const REF = 'hard_fact:has_test_runner';

  function hardFactWith(tier?: string, polarity?: string) {
    return buildPromptEnhancementGuidanceFactsV1(
      requestWithSignals({
        sourceOnlyHardFactRefs: [REF],
        ...(tier ? { groundingTierByRef: { [REF]: tier } } : {}),
        ...(polarity ? { groundingPolarityByRef: { [REF]: polarity } } : {}),
      } as never),
    )[0];
  }

  // The claim-policy TRIO: the same fact at three corroboration tiers yields three
  // different claim policies — computed by the registry, never by a model.
  it('promoted_practice_P tier → may_state_as_user_practice', () => {
    const fact = hardFactWith('promoted_practice_P', 'present');
    expect(fact.claimVerbPolicy).toBe('may_state_as_user_practice');
    expect(fact.sourceOriginScope).toBe('local_probe');
  });

  it('capability tier → may_state_as_project_capability', () => {
    expect(hardFactWith('capability', 'present').claimVerbPolicy).toBe('may_state_as_project_capability');
  });

  it('uncorroborated tier → must_phrase_as_possibility', () => {
    expect(hardFactWith('uncorroborated', 'present').claimVerbPolicy).toBe('must_phrase_as_possibility');
  });

  it('absent tier map defaults to the weakest claim (possibility), never a confident one', () => {
    expect(hardFactWith(undefined, undefined).claimVerbPolicy).toBe('must_phrase_as_possibility');
    expect(hardFactWith(undefined, undefined).factRole).toBe('project_grounding_support');
  });

  // The polarity TRIO: TRUE grounds, FALSE is safety material, NULL stays unknown.
  // (The typed VALUE itself crosses with the caller-side resolution payload — the
  // value-arrives-typed rider of this trio completes there.)
  it('polarity present → project_grounding_support (the grounding lane)', () => {
    expect(hardFactWith('capability', 'present').factRole).toBe('project_grounding_support');
  });

  it('polarity false_capability → safety_confirmation_support, label-only, safety-hooked, never grounding prose', () => {
    const fact = hardFactWith('uncorroborated', 'false_capability');
    expect(fact.factRole).toBe('safety_confirmation_support');
    expect(fact.claimVerbPolicy).toBe('source_label_only');
    expect(fact.renderPolicy).toBe('metadata_only');
    expect(fact.safetyHooks).toContain('pe_ar9_negative_capability');
  });

  it('polarity unknown → stale_or_unknown evidence, possibility wording — never a confident negative', () => {
    const fact = hardFactWith('uncorroborated', 'unknown');
    expect(fact.sourceEvidenceState).toBe('stale_or_unknown');
    expect(fact.claimVerbPolicy).toBe('must_phrase_as_possibility');
    expect(fact.factRole).toBe('project_grounding_support');
  });

  // RIGHT&GOOD claim strength follows the boundary tier; work-style stays style metadata.
  it('a behaviour-corroborated RIGHT&GOOD ref may state practice; an uncorroborated one may not', () => {
    const corroborated = buildPromptEnhancementGuidanceFactsV1(
      requestWithSignals({
        rightGoodWorkStyleEnvRuntimeRefs: ['right_good:test_creation'],
        groundingTierByRef: { 'right_good:test_creation': 'promoted_practice_P' },
      } as never),
    )[0];
    expect(corroborated.claimVerbPolicy).toBe('may_state_as_user_practice');
    expect(corroborated.factRole).toBe('positive_practice_preservation');

    const claimed = buildPromptEnhancementGuidanceFactsV1(
      requestWithSignals({ rightGoodWorkStyleEnvRuntimeRefs: ['right_good:test_creation'] } as never),
    )[0];
    expect(claimed.claimVerbPolicy).toBe('must_phrase_as_possibility');
  });

  it('work-style refs are neutral style support, source-label-only wording', () => {
    const fact = buildPromptEnhancementGuidanceFactsV1(
      requestWithSignals({ rightGoodWorkStyleEnvRuntimeRefs: ['work_style:iteration:small_steps'] } as never),
    )[0];
    expect(fact.factRole).toBe('neutral_style_support');
    expect(fact.claimVerbPolicy).toBe('source_label_only');
    expect(fact.sourceOriginScope).toBe('longitudinal_param_events');
  });
});
