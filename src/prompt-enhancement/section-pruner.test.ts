import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../store/db.js';
import { upsertProject, setProjectEnvFacts } from '../store/index.js';
import { probeProject } from '../env/env-probe.js';
import { SessionStateManager } from '../classifier/SessionStateManager.js';
import { buildPromptEnhancementRequestForAuto } from '../cli/commands/auto.js';
import { preparePromptEnhancement } from './facade.js';
import {
  prunePromptEnhancementSectionsV1,
  PROMPT_ENHANCEMENT_PRUNE_EXTRA_CAP_V1,
} from './section-pruner.js';
import type { PromptEnhancementGuidanceFact } from './templates/section-plan.js';
import type { PromptEnhancementSectionPlanItemV1 } from './contracts.js';

/**
 * I2 (§15.3) — the deterministic pruner under the LOCKED criteria (a)/(b)/(c).
 *
 * ⚠️ Every case here is built from the criteria, not from the implementation: stage (a) beats a
 * top-ranked section, the floor beats both stages, and the cap counts EXTRAS rather than sections.
 * Those three are what someone re-reading §15.1 would check, so they are what is asserted.
 */

function fact(factId: string, value = 'a real value'): PromptEnhancementGuidanceFact {
  return {
    factId, sourceType: 'hard_fact', sourceIds: [`hard_fact:${factId}`],
    guidanceKind: 'project_grounding', suggestedActionKind: 'ground_in_project_fact',
    targetFamily: 'family_agnostic', targetSectionKind: '', sourceEvidenceState: 'strong',
    priority: 'normal', renderPolicy: 'render_as_section', riskLevel: 'none',
    privacyClass: 'local_private', sanitizationState: 'not_applicable', safetyHooks: [],
    ...(value === '' ? {} : { evidence: { key: factId, value } }),
  } as unknown as PromptEnhancementGuidanceFact;
}

function section(input: {
  kind: string;
  factIds?: readonly string[];
  isRequired?: boolean;
  safety?: readonly string[];
  obligations?: readonly string[];
}): PromptEnhancementSectionPlanItemV1 {
  return {
    sectionId: `sec-${input.kind}`,
    sectionKind: input.kind,
    isRequired: input.isRequired ?? false,
    safetyFlags: input.safety ?? [],
    sensitivityFlags: [],
    slotObligations: input.obligations ?? [],
    structuredContentPartRefs: (input.factIds ?? []).map((id) => `guidance_fact:${id}`),
  } as unknown as PromptEnhancementSectionPlanItemV1;
}

describe('stage (a) — evidence first, and it runs BEFORE any ranking', () => {
  it('a factless section drops even when the model ranked it FIRST', () => {
    // The whole reason (a) precedes (b): relevance cannot rescue a section with nothing to say.
    const result = prunePromptEnhancementSectionsV1({
      sectionPlans: [
        section({ kind: 'original_request_or_goal' }),
        section({ kind: 'risk_safety_or_confirmation' }),           // factless, and ranked first
        section({ kind: 'verification_or_test_plan', factIds: ['f1'] }),
      ],
      facts: [fact('f1')],
      relevanceOrder: ['risk_safety_or_confirmation', 'verification_or_test_plan'],
    });
    expect(result.droppedSectionIds).toContain('sec-risk_safety_or_confirmation');
    expect(result.sectionPlans.map((s) => s.sectionKind)).toContain('verification_or_test_plan');
  });

  it('a section whose only fact carries an EMPTY value is factless', () => {
    // "Factless" is judged on group A's content test — a fact with no renderable value is a fact
    // that says nothing, and a section built only from those has nothing to render either.
    const result = prunePromptEnhancementSectionsV1({
      sectionPlans: [
        section({ kind: 'original_request_or_goal' }),
        section({ kind: 'context_and_constraints', factIds: ['empty'] }),
      ],
      facts: [fact('empty', '')],
    });
    expect(result.droppedSectionIds).toEqual(['sec-context_and_constraints']);
  });
});

describe('the floor is UNTOUCHABLE (prohibition 18)', () => {
  it('the verbatim original, a required section and a safety section all survive — factless or not', () => {
    const result = prunePromptEnhancementSectionsV1({
      sectionPlans: [
        section({ kind: 'original_request_or_goal' }),
        section({ kind: 'acceptance_or_output_expectation', isRequired: true }),
        // ⚠️ A MEANINGFUL flag, not `source_honesty`: that one and `no_authority_escalation` are
        // unconditional on every section, so using them here would assert nothing — which is how the
        // implementation's own floor test went wrong before a real body was measured.
        section({ kind: 'risk_safety_or_confirmation', safety: ['sensitive_action_confirmation'] }),
      ],
      facts: [],
      // Ranked last, or not at all — the floor does not consult the ordering.
      relevanceOrder: ['verification_or_test_plan'],
    });
    expect(result.droppedSectionIds, 'a floor section was pruned').toEqual([]);
    expect(result.sectionPlans).toHaveLength(3);
  });

  it('and the floor does not consume the extras budget', () => {
    // The cap is "floor + N extras", not "N sections". A body with a large floor still gets its
    // full allowance of evidenced extras.
    const extras = ['context_and_constraints', 'verification_or_test_plan', 'reproduction_or_evidence'];
    const result = prunePromptEnhancementSectionsV1({
      sectionPlans: [
        section({ kind: 'original_request_or_goal' }),
        section({ kind: 'risk_safety_or_confirmation', safety: ['risk_or_rollback'] }),
        ...extras.map((kind, i) => section({ kind, factIds: [`f${i}`] })),
      ],
      facts: extras.map((_, i) => fact(`f${i}`)),
    });
    expect(result.droppedSectionIds).toEqual([]);
    expect(result.sectionPlans).toHaveLength(2 + PROMPT_ENHANCEMENT_PRUNE_EXTRA_CAP_V1);
  });
});

describe('stage (b) — the soft cap, ordered by the observation', () => {
  it('keeps the highest-ranked extras and drops the rest', () => {
    const kinds = ['context_and_constraints', 'verification_or_test_plan', 'reproduction_or_evidence',
      'behavior_preservation', 'point_inventory_or_decomposition'];
    const result = prunePromptEnhancementSectionsV1({
      sectionPlans: [section({ kind: 'original_request_or_goal' }),
        ...kinds.map((kind, i) => section({ kind, factIds: [`f${i}`] }))],
      facts: kinds.map((_, i) => fact(`f${i}`)),
      relevanceOrder: ['point_inventory_or_decomposition', 'behavior_preservation', 'reproduction_or_evidence'],
    });
    const kept = result.sectionPlans.map((s) => s.sectionKind);
    expect(kept).toHaveLength(1 + PROMPT_ENHANCEMENT_PRUNE_EXTRA_CAP_V1);
    for (const ranked of ['point_inventory_or_decomposition', 'behavior_preservation', 'reproduction_or_evidence']) {
      expect(kept, `${ranked} was ranked but dropped`).toContain(ranked);
    }
  });

  it('survivors render in the PLANNED order, not the ranked one', () => {
    // Relevance decides what stays. Re-ordering the body under the reader is a different change,
    // and §15.1 bounds this to pruning inside the single editable body.
    const result = prunePromptEnhancementSectionsV1({
      sectionPlans: [
        section({ kind: 'original_request_or_goal' }),
        section({ kind: 'context_and_constraints', factIds: ['a'] }),
        section({ kind: 'verification_or_test_plan', factIds: ['b'] }),
      ],
      facts: [fact('a'), fact('b')],
      relevanceOrder: ['verification_or_test_plan', 'context_and_constraints'],
    });
    expect(result.sectionPlans.map((s) => s.sectionKind))
      .toEqual(['original_request_or_goal', 'context_and_constraints', 'verification_or_test_plan']);
  });

  it('an EMPTY ordering means no signal — planned order decides, nothing is ranked last', () => {
    // ⛔ Treating silence as "rank everything last" would be the registry inventing a judgement the
    // model never made (prohibition 4). It is also the degraded/no-key shape, which must not prune
    // differently from a keyed run that simply returned nothing.
    const kinds = ['context_and_constraints', 'verification_or_test_plan', 'reproduction_or_evidence', 'behavior_preservation'];
    const result = prunePromptEnhancementSectionsV1({
      sectionPlans: [section({ kind: 'original_request_or_goal' }),
        ...kinds.map((kind, i) => section({ kind, factIds: [`f${i}`] }))],
      facts: kinds.map((_, i) => fact(`f${i}`)),
      relevanceOrder: [],
    });
    expect(result.sectionPlans.map((s) => s.sectionKind))
      .toEqual(['original_request_or_goal', ...kinds.slice(0, PROMPT_ENHANCEMENT_PRUNE_EXTRA_CAP_V1)]);
  });
});

describe('criterion (c) — slots follow their section, safety metadata does not', () => {
  it('a dropped section leaves its no-invention state and send policy on the body', () => {
    const result = prunePromptEnhancementSectionsV1({
      sectionPlans: [
        section({ kind: 'original_request_or_goal' }),
        section({
          kind: 'reproduction_or_evidence',
          obligations: ['reproduction_or_evidence_request', 'no_invention_state', 'send_policy_metadata'],
        }),
      ],
      facts: [],
    });
    expect(result.droppedSectionIds).toEqual(['sec-reproduction_or_evidence']);
    expect(result.inheritedSlotObligations).toContain('no_invention_state');
    expect(result.inheritedSlotObligations).toContain('send_policy_metadata');
    // The VISIBLE slot went with the section — that is the half of (c) that prunes.
    expect(
      result.inheritedSlotObligations,
      'a visible slot survived its section — (c) keeps the checks, not the content',
    ).not.toContain('reproduction_or_evidence_request');
  });
});

describe('criterion 5 — every drop is reason-coded, never a silent loss', () => {
  it('facts from a dropped section carry the locked selection state and a reason code', () => {
    const result = prunePromptEnhancementSectionsV1({
      sectionPlans: [
        section({ kind: 'original_request_or_goal' }),
        ...['context_and_constraints', 'verification_or_test_plan', 'reproduction_or_evidence', 'behavior_preservation']
          .map((kind, i) => section({ kind, factIds: [`f${i}`] })),
      ],
      facts: [fact('f0'), fact('f1'), fact('f2'), fact('f3')],
      relevanceOrder: ['context_and_constraints', 'verification_or_test_plan', 'reproduction_or_evidence'],
    });
    const dropped = result.facts.find((f) => f.factId === 'f3');
    expect(dropped?.selectionState).toBe('suppressed_by_relevance');
    expect(dropped?.selectionReasonCodes).toContain('section_pruned_by_relevance');
    // A surviving fact is untouched: the record marks what went, not everything.
    expect(result.facts.find((f) => f.factId === 'f0')?.selectionState).toBeUndefined();
  });
});

describe('§47.3 worked example — the canonical scenario, as the plan wrote it', () => {
  it('"why is my app so slow": floor + profiling and verification; rollback drops at (a), acceptance at (b)', () => {
    const result = prunePromptEnhancementSectionsV1({
      sectionPlans: [
        section({ kind: 'original_request_or_goal' }),
        section({ kind: 'context_and_constraints', isRequired: true }),            // the required guidance
        section({ kind: 'reproduction_or_evidence', factIds: ['profiling'] }),     // evidenced + relevant
        section({ kind: 'verification_or_test_plan', factIds: ['verify'] }),       // evidenced + relevant
        section({ kind: 'risk_safety_or_confirmation' }),                          // rollback: FACTLESS
        section({ kind: 'acceptance_or_output_expectation', factIds: ['accept'] }),// evidenced, low relevance
      ],
      facts: [fact('profiling'), fact('verify'), fact('accept')],
      relevanceOrder: ['reproduction_or_evidence', 'verification_or_test_plan', 'acceptance_or_output_expectation'],
    });

    const kept = result.sectionPlans.map((s) => s.sectionKind);
    expect(kept).toContain('original_request_or_goal');
    expect(kept).toContain('context_and_constraints');
    expect(kept).toContain('reproduction_or_evidence');
    expect(kept).toContain('verification_or_test_plan');
    // ⚠️ The rollback section is factless AND carries no safety flag in this scenario, so it drops
    // at stage (a). A rollback section that DID carry safety metadata would be floor and would stay
    // — which is why the plan's example says "[+ safety if risky]" rather than always.
    expect(result.droppedSectionIds).toContain('sec-risk_safety_or_confirmation');
    expect(kept.length - 2, 'more than the capped extras survived').toBeLessThanOrEqual(
      PROMPT_ENHANCEMENT_PRUNE_EXTRA_CAP_V1,
    );
  });
});

describe('the pruner is WIRED — the done-when, measured on a composed body', () => {
  // ⛔ This exists because unwiring the pruner from the facade left all 2,064 prompt-enhancement
  // tests green. The unit cases above prove the CRITERIA; only this proves the engine uses them.
  //
  // §15.3's done-when: "a composed risky-debug body renders floor + ≤3 extras; a factless section
  // never renders". Measured before the pruner: 7 sections. After: 4.
  it('renders the floor plus at most the capped extras, and no factless section', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'prune-e2e-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', devDependencies: { vitest: '1.0.0' } }));
    const store = await openStore(join(dir, 'store.db'));
    upsertProject(store, {
      projectRoot: dir, name: 'x', projectType: 'app', language: 'ts', description: '', createdAt: Date.now(),
    });
    setProjectEnvFacts(store, dir, probeProject(dir, Date.now()).facts, Date.now());

    const request = buildPromptEnhancementRequestForAuto({
      auto: { promptText: 'add retry to the payment flow and make sure it is covered', projectRoot: dir, currentAgentMode: 'default' },
      store, session: SessionStateManager.load(store, dir), project: null,
      effectiveLanguage: 'en', configuredRole: null, effectiveFlagType: 'stage_transition',
      firedKey: 'stage_transition:idea', previousStage: 'idea', trigger: { kind: 'stage_transition' },
      stageResult: {
        classification: { stage: 'implementation', confidence: 0.9, tier: 3, allScores: {} },
        signalsPresent: [], signalsAbsent: [], fireRecommendation: true, selectedSignalKey: '',
        reason: 'i2-e2e', degraded: false,
        projectFactCandidates: ['test_runner', 'version_control', 'framework'],
        sectionRelevanceOrder: [],
      },
      streamBOutputs: [],
    } as never);

    const result = await preparePromptEnhancement(request) as never as {
      currentBody: { sections: readonly { sectionKind: string }[] };
    };
    const kinds = result.currentBody.sections.map((s) => s.sectionKind);

    expect(kinds, 'the verbatim original is floor and can never be pruned').toContain('original_request_or_goal');
    expect(
      kinds.length,
      `the body rendered ${kinds.length} sections (${kinds.join(', ')}) — the pruner is not engaged, `
      + 'or the floor is swallowing the cap again',
    ).toBeLessThanOrEqual(5);
    // Stage (a) in a composed body: these are planned and carry no content-bearing fact.
    for (const factless of ['approach_or_steps', 'acceptance_or_output_expectation']) {
      expect(kinds, `${factless} rendered with nothing to say`).not.toContain(factless);
    }
  });
});

describe('the MANDATORY section — owner ruling, 2026-08-20', () => {
  // 🔒 "one section is mandatory. and that mandatory section is Source Signal Guidance… so the
  // enhanced prompt can come with only one section as well. this is the new final rule."
  //
  // It is the section the whole absence/stage/mistake signal chain exists to deliver, so it is floor
  // twice over: stage (a) cannot drop it for having no fact, and stage (b)'s cap cannot squeeze it out.
  it('survives stage (a) with NO fact at all', () => {
    const result = prunePromptEnhancementSectionsV1({
      sectionPlans: [
        section({ kind: 'original_request_or_goal' }),
        section({ kind: 'source_signal_guidance' }),        // factless
        section({ kind: 'context_and_constraints' }),       // factless too — this one goes
      ],
      facts: [],
    });
    expect(result.sectionPlans.map((s) => s.sectionKind)).toContain('source_signal_guidance');
    expect(result.droppedSectionIds).toEqual(['sec-context_and_constraints']);
  });

  it('survives stage (b) even when every extra outranks it', () => {
    const kinds = ['context_and_constraints', 'verification_or_test_plan', 'reproduction_or_evidence', 'behavior_preservation'];
    const result = prunePromptEnhancementSectionsV1({
      sectionPlans: [
        section({ kind: 'original_request_or_goal' }),
        ...kinds.map((kind, i) => section({ kind, factIds: [`f${i}`] })),
        section({ kind: 'source_signal_guidance', factIds: ['sig'] }),
      ],
      facts: [...kinds.map((_, i) => fact(`f${i}`)), fact('sig')],
      relevanceOrder: kinds,   // the mandatory section is ranked LAST, by every extra
    });
    expect(
      result.sectionPlans.map((s) => s.sectionKind),
      'the cap squeezed out the one section that must always come',
    ).toContain('source_signal_guidance');
  });

  it('and a body of the original plus the mandatory section alone is valid', () => {
    // The rule's own words: a body can come with only one section. Nothing here enforces a minimum
    // count any more, because a count was never what made a body worth showing.
    const result = prunePromptEnhancementSectionsV1({
      sectionPlans: [
        section({ kind: 'original_request_or_goal' }),
        section({ kind: 'source_signal_guidance' }),
        section({ kind: 'acceptance_or_output_expectation' }),
        section({ kind: 'verification_or_test_plan' }),
      ],
      facts: [],
    });
    expect(result.sectionPlans.map((s) => s.sectionKind))
      .toEqual(['original_request_or_goal', 'source_signal_guidance']);
  });
});
