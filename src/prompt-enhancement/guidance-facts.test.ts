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
