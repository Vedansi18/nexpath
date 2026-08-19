import { describe, expect, it } from 'vitest';
import type {
  PromptEnhancementPrepareRequestV1,
  PromptEnhancementSourceInputSnapshotV1,
  PromptEnhancementTriggerProvenanceV1,
} from './contracts.js';
import { buildPromptEnhancementGuidanceFactsV1, evidenceForGuidanceFact } from './guidance-facts.js';

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

  function hardFactWith(tier?: string, polarity?: string, resolvedValue?: string) {
    return buildPromptEnhancementGuidanceFactsV1(
      requestWithSignals({
        sourceOnlyHardFactRefs: [REF],
        ...(tier ? { groundingTierByRef: { [REF]: tier } } : {}),
        ...(polarity ? { groundingPolarityByRef: { [REF]: polarity } } : {}),
        ...(resolvedValue !== undefined
          ? { groundingEvidenceByRef: { [REF]: { key: 'has_test_runner', value: resolvedValue, runtimePath: 'local_store' } } }
          : {}),
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

  // The polarity TRIO: TRUE grounds, FALSE is safety material, NULL stays unknown —
  // and in EACH case the resolved VALUE crosses typed beside the fact. The value
  // rider was written against the caller-side payload once it existed; it is
  // asserted here per polarity because polarity must not gate content: a negative
  // capability is safety material precisely BECAUSE its value is known, and an
  // unknown probe must cross as a typed unknown rather than as nothing at all.
  it('polarity present → project_grounding_support (the grounding lane), value typed', () => {
    const fact = hardFactWith('capability', 'present', 'true');
    expect(fact.factRole).toBe('project_grounding_support');
    expect(fact.evidence).toEqual({ key: 'has_test_runner', value: 'true' });
  });

  it('polarity false_capability → safety_confirmation_support, label-only, safety-hooked, never grounding prose, value typed', () => {
    const fact = hardFactWith('uncorroborated', 'false_capability', 'false');
    expect(fact.factRole).toBe('safety_confirmation_support');
    expect(fact.claimVerbPolicy).toBe('source_label_only');
    expect(fact.renderPolicy).toBe('metadata_only');
    expect(fact.safetyHooks).toContain('safety_negative_capability');
    // Safety material keeps its content: the absent capability is known, and the
    // downstream safety wording needs to know WHICH one and what it read.
    expect(fact.evidence).toEqual({ key: 'has_test_runner', value: 'false' });
  });

  it('polarity unknown → stale_or_unknown evidence, possibility wording — never a confident negative, value typed', () => {
    const fact = hardFactWith('uncorroborated', 'unknown', 'null');
    expect(fact.sourceEvidenceState).toBe('stale_or_unknown');
    expect(fact.claimVerbPolicy).toBe('must_phrase_as_possibility');
    expect(fact.factRole).toBe('project_grounding_support');
    // An unknown probe crosses as a TYPED unknown, not as an absent payload —
    // "we looked and could not tell" is different from "we never looked".
    expect(fact.evidence).toEqual({ key: 'has_test_runner', value: 'null' });
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

// ── Dual-id pairing: a live detector + a false capability route safety TOGETHER ──

describe('negative capability paired with its live detector', () => {
  it('an absence fact for a corroborating signal gains the false env ref as a second source id, plus the safety hook', () => {
    const facts = buildPromptEnhancementGuidanceFactsV1(
      requestWithSignals({
        normalizedStageAbsenceSignalRefs: ['absence:test_creation@implementation'],
        sourceOnlyHardFactRefs: ['hard_fact:has_test_runner'],
        groundingTierByRef: { 'hard_fact:has_test_runner': 'uncorroborated' },
        groundingPolarityByRef: { 'hard_fact:has_test_runner': 'false_capability' },
      } as never),
    );
    const absenceFact = facts.find((f) => f.sourceType === 'absence_signal')!;
    expect(absenceFact.sourceIds).toContain('absence:test_creation@implementation');
    expect(absenceFact.sourceIds).toContain('hard_fact:has_test_runner');
    expect(absenceFact.safetyHooks).toContain('safety_negative_capability');
    // The false-capability fact itself stays label-only metadata — it does not
    // become a Source A candidate on its own.
    const falseCap = facts.find((f) => f.sourceType === 'hard_fact')!;
    expect(falseCap.factRole).toBe('safety_confirmation_support');
    expect(falseCap.renderPolicy).toBe('metadata_only');
  });

  it('without a live detector for its signal, the false capability pairs with nothing', () => {
    const facts = buildPromptEnhancementGuidanceFactsV1(
      requestWithSignals({
        normalizedStageAbsenceSignalRefs: ['absence:acceptance_criteria@implementation'],
        sourceOnlyHardFactRefs: ['hard_fact:has_test_runner'],
        groundingPolarityByRef: { 'hard_fact:has_test_runner': 'false_capability' },
      } as never),
    );
    const absenceFact = facts.find((f) => f.sourceType === 'absence_signal')!;
    expect(absenceFact.sourceIds).not.toContain('hard_fact:has_test_runner');
    expect(absenceFact.safetyHooks).not.toContain('safety_negative_capability');
  });
});

// ── Caller-resolved evidence crosses WITH the fact, gates travelling on it ────

describe('caller-side eager resolution (the generic key/value payload)', () => {
  it('env facts carry their resolved value and the runtime-path stamp', () => {
    const fact = buildPromptEnhancementGuidanceFactsV1(
      requestWithSignals({
        sourceOnlyHardFactRefs: ['hard_fact:package_manager'],
        groundingTierByRef: { 'hard_fact:package_manager': 'capability' },
        groundingPolarityByRef: { 'hard_fact:package_manager': 'present' },
        groundingEvidenceByRef: { 'hard_fact:package_manager': { key: 'package_manager', value: 'pnpm', runtimePath: 'local_store' } },
      } as never),
    )[0];
    expect(fact.evidence).toEqual({ key: 'package_manager', value: 'pnpm' });
    expect(fact.sourceRuntimePath).toBe('local_store');
  });

  it('RIGHT&GOOD and work-style facts carry typed values — the work-style value is no longer inside the ref', () => {
    const facts = buildPromptEnhancementGuidanceFactsV1(
      requestWithSignals({
        rightGoodWorkStyleEnvRuntimeRefs: ['right_good:test_creation', 'work_style:iteration'],
        groundingEvidenceByRef: {
          'right_good:test_creation': { key: 'test_creation', value: 'right_good:behaviour_verified', runtimePath: 'local_read_model' },
          'work_style:iteration': { key: 'iteration', value: 'small_steps', runtimePath: 'local_read_model' },
        },
      } as never),
    );
    const rightGood = facts.find((f) => f.sourceType === 'right_good_pattern')!;
    const workStyle = facts.find((f) => f.sourceType === 'work_style_fact')!;
    expect(rightGood.evidence?.value).toBe('right_good:behaviour_verified');
    expect(workStyle.evidence).toEqual({ key: 'iteration', value: 'small_steps' });
    expect(workStyle.sourceIds).toEqual(['work_style:iteration']);
  });

  it('facts without a resolved entry cross without evidence — never with invented content', () => {
    const fact = buildPromptEnhancementGuidanceFactsV1(
      requestWithSignals({ sourceOnlyHardFactRefs: ['hard_fact:has_test_runner'] } as never),
    )[0];
    expect(fact.evidence).toBeUndefined();
  });

  it('the content gates travel with the fact: unrenderable and reference-only classes never cross with content', () => {
    const resolved = { key: 'k', value: 'v' };
    expect(evidenceForGuidanceFact('do_not_render', 'not_applicable', resolved)).toBeUndefined();
    expect(evidenceForGuidanceFact('sensitive_ref_only', 'not_applicable', resolved)).toBeUndefined();
    expect(evidenceForGuidanceFact('local_private', 'unsafe_to_render', resolved)).toBeUndefined();
    expect(evidenceForGuidanceFact('local_private', 'sensitive_ref_only', resolved)).toBeUndefined();
    expect(evidenceForGuidanceFact('local_private', 'not_applicable', resolved)).toEqual(resolved);
  });

  it('mistake-state refs carry their resolved value too — no branch crosses id-only', () => {
    const facts = buildPromptEnhancementGuidanceFactsV1(
      requestWithSignals({
        rightGoodWorkStyleEnvRuntimeRefs: ['mistake:test_creation'],
        groundingEvidenceByRef: {
          'mistake:test_creation': { key: 'test_creation', value: 'mistake:claimed', runtimePath: 'local_read_model' },
        },
      } as never),
    );
    const mistakeFact = facts.find((f) => f.sourceType === 'absence_signal')!;
    expect(mistakeFact.evidence).toEqual({ key: 'test_creation', value: 'mistake:claimed' });
    expect(mistakeFact.sourceRuntimePath).toBe('local_read_model');
  });
});

// ── Sensitive Source A: the signal is selectable, the literal never crosses ───

describe('sensitive source separation (secret-class signals)', () => {
  it('a secret_in_prompt ref gets the locked treatment: confirmation-routed, safety role, label-only wording, hooked', () => {
    const fact = buildPromptEnhancementGuidanceFactsV1(
      requestWithSignals({ normalizedStageAbsenceSignalRefs: ['absence:secret_in_prompt@implementation'] } as never),
    )[0];
    expect(fact.privacyClass).toBe('requires_confirmation');
    expect(fact.factRole).toBe('safety_confirmation_support');
    expect(fact.claimVerbPolicy).toBe('source_label_only');
    expect(fact.riskLevel).toBe('sensitive_authority_risky');
    expect(fact.safetyHooks).toContain('safety_sensitive_source');
    expect(fact.guidanceKind).toBe('safety_or_confirmation');
  });

  it('confirmation-routed and suppressed classes never cross with content; crossing values are defensively redacted', () => {
    const resolved = { key: 'k', value: 'v' };
    expect(evidenceForGuidanceFact('requires_confirmation', 'not_applicable', resolved)).toBeUndefined();
    expect(evidenceForGuidanceFact('sensitive_suppress', 'not_applicable', resolved)).toBeUndefined();
    const secretValue = { key: 'k', value: 'token sk-abc123def456ghi789jkl012mno345' };
    const crossed = evidenceForGuidanceFact('local_private', 'not_applicable', secretValue);
    expect(crossed?.value).toContain('[REDACTED');
    expect(crossed?.value).not.toContain('sk-abc123def456ghi789jkl012mno345');
  });

  it('an ordinary absence ref keeps the required-survivor treatment', () => {
    const fact = buildPromptEnhancementGuidanceFactsV1(
      requestWithSignals({ normalizedStageAbsenceSignalRefs: ['absence:test_creation@implementation'] } as never),
    )[0];
    expect(fact.privacyClass).toBe('public_safe');
    expect(fact.factRole).toBe('required_source_signal_survivor');
  });
});

// ── The sensitive signal gets its treatment however it arrives ────────────────

describe('secret_in_prompt separates SIGNAL from LITERAL on every path', () => {
  const SAFETY_HOOK = 'safety_sensitive_source';

  it('as the FIRED TRIGGER — the path that actually opens the popup', () => {
    const fact = buildPromptEnhancementGuidanceFactsV1(
      requestWithSignals({}, {
        triggerKind: 'absence',
        currentStage: 'implementation',
        selectedQualifyingAbsence: 'secret_in_prompt',
      } as never),
    )[0];
    // The locked triple: routed through confirmation, safety material, label-only.
    expect(fact.privacyClass).toBe('requires_confirmation');
    expect(fact.factRole).toBe('safety_confirmation_support');
    expect(fact.claimVerbPolicy).toBe('source_label_only');
    // And it must read as source-critical downstream, not as ordinary low-risk guidance.
    expect(fact.riskLevel).toBe('sensitive_authority_risky');
    expect(fact.guidanceKind).toBe('safety_or_confirmation');
    expect(fact.safetyHooks).toContain(SAFETY_HOOK);
  });

  it('as a normalized signal ref — same treatment, same fields', () => {
    const fact = buildPromptEnhancementGuidanceFactsV1(
      requestWithSignals({ normalizedStageAbsenceSignalRefs: ['absence:secret_in_prompt'] } as never),
    )[0];
    expect(fact.privacyClass).toBe('requires_confirmation');
    expect(fact.factRole).toBe('safety_confirmation_support');
    expect(fact.claimVerbPolicy).toBe('source_label_only');
    expect(fact.riskLevel).toBe('sensitive_authority_risky');
    expect(fact.safetyHooks).toContain(SAFETY_HOOK);
  });

  it('as a RECURRING MISTAKE ref — reachable even when a different absence fired the popup', () => {
    // An active absence marks its key `mistake`, and this signal is an absence, so
    // `mistake:secret_in_prompt` crosses independently of what fired the popup —
    // with no protected sibling fact to carry the safety routing for it.
    const fact = buildPromptEnhancementGuidanceFactsV1(
      requestWithSignals({
        rightGoodWorkStyleEnvRuntimeRefs: ['mistake:secret_in_prompt'],
        groundingEvidenceByRef: {
          'mistake:secret_in_prompt': { key: 'secret_in_prompt', value: 'mistake:claimed', runtimePath: 'local_read_model' },
        },
      } as never),
    )[0];
    expect(fact.privacyClass).toBe('requires_confirmation');
    expect(fact.factRole).toBe('safety_confirmation_support');
    expect(fact.claimVerbPolicy).toBe('source_label_only');
    expect(fact.riskLevel).toBe('sensitive_authority_risky');
    expect(fact.guidanceKind).toBe('safety_or_confirmation');
    expect(fact.safetyHooks).toContain(SAFETY_HOOK);
    // Confirmation-routed privacy withholds the content: the SIGNAL crosses, the
    // resolved detail does not.
    expect(fact.evidence).toBeUndefined();
  });

  it('an ordinary recurring mistake keeps its ordinary treatment, content and all', () => {
    const fact = buildPromptEnhancementGuidanceFactsV1(
      requestWithSignals({
        rightGoodWorkStyleEnvRuntimeRefs: ['mistake:test_creation'],
        groundingEvidenceByRef: {
          'mistake:test_creation': { key: 'test_creation', value: 'mistake:claimed', runtimePath: 'local_read_model' },
        },
      } as never),
    )[0];
    expect(fact.privacyClass).toBe('local_private');
    expect(fact.factRole).toBe('supporting_missing_practice');
    expect(fact.riskLevel).toBe('low');
    expect(fact.safetyHooks).not.toContain(SAFETY_HOOK);
    expect(fact.evidence).toEqual({ key: 'test_creation', value: 'mistake:claimed' });
  });

  it('an ordinary absence signal is untouched by the sensitive path, on both routes', () => {
    const triggered = buildPromptEnhancementGuidanceFactsV1(
      requestWithSignals({}, {
        triggerKind: 'absence',
        currentStage: 'implementation',
        selectedQualifyingAbsence: 'debugging_observation_gap',
      } as never),
    )[0];
    const referenced = buildPromptEnhancementGuidanceFactsV1(
      requestWithSignals({ normalizedStageAbsenceSignalRefs: ['absence:debugging_observation_gap'] } as never),
    )[0];
    for (const fact of [triggered, referenced]) {
      expect(fact.privacyClass).toBe('public_safe');
      expect(fact.factRole).toBe('required_source_signal_survivor');
      expect(fact.claimVerbPolicy).toBe('must_phrase_as_source_signal');
      expect(fact.safetyHooks).not.toContain(SAFETY_HOOK);
    }
  });
});

describe('F3: the fatigue key reaches facts through the real producer', () => {
  // The unit tests cover the builder; this covers the WIRING — the producer has
  // seven fact-construction sites and the key is stamped at its single exit, so
  // a fact built anywhere in it must come out keyed.
  const scoped = (
    overrides: Partial<PromptEnhancementSourceInputSnapshotV1>,
    trigger: PromptEnhancementTriggerProvenanceV1 = { triggerKind: 'none', currentStage: 'implementation' },
  ): PromptEnhancementPrepareRequestV1 => {
    const base = requestWithSignals(overrides, trigger) as unknown as {
      reviewMomentContext: { triggerProvenance: PromptEnhancementTriggerProvenanceV1; projectId?: string };
    };
    base.reviewMomentContext.projectId = 'project-alpha';
    return base as unknown as PromptEnhancementPrepareRequestV1;
  };

  it('an ordinary absence fact comes out of the producer with a project-scoped key', () => {
    const facts = buildPromptEnhancementGuidanceFactsV1(scoped({
      normalizedStageAbsenceSignalRefs: ['absence:verification_gap@implementation'],
    }));
    expect(facts.length).toBeGreaterThan(0);
    const keyed = facts.filter((entry) => entry.fatigueKey !== undefined);
    expect(keyed.length).toBeGreaterThan(0);
    for (const entry of keyed) {
      expect(entry.fatigueKey).toMatch(/^pef1:/);
      expect(entry.fatigueKey).not.toContain('project-alpha');
    }
  });

  it('the SENSITIVE absence fact is never keyed — safety is never faded', () => {
    // A4 makes secret_in_prompt a sensitive, safety-routed fact; F3 must leave it
    // unkeyable so no repeat-count can ever suppress it.
    const facts = buildPromptEnhancementGuidanceFactsV1(scoped({
      normalizedStageAbsenceSignalRefs: ['absence:secret_in_prompt@implementation'],
    }));
    const sensitive = facts.filter((entry) => entry.sourceIds.some((id) => id.includes('secret_in_prompt')));
    expect(sensitive.length).toBeGreaterThan(0);
    for (const entry of sensitive) expect(entry.fatigueKey).toBeUndefined();
  });

  it('without a project id the producer emits no keys at all, never a global one', () => {
    const facts = buildPromptEnhancementGuidanceFactsV1(requestWithSignals({
      normalizedStageAbsenceSignalRefs: ['absence:verification_gap@implementation'],
    }));
    for (const entry of facts) expect(entry.fatigueKey).toBeUndefined();
  });
});
