// Supply for the two starved sections — and the guard that keeps supply from becoming filler.
//
// Measured before this: "what done looks like" and "how to verify" were the highest-volume sections
// in shipped bodies and NEITHER had ever received a fact. Eighty sections across the corpus, all
// written from plausibility. A section written that way looks grounded without being grounded,
// which is worse than one that says less.
//
// So the bar these tests hold is not "a fact reached the section". It is that the sentence says
// something the composer could not have written from the current prompt alone — the developer's own
// words, from history the composer cannot see — and that when the developer never said, NOTHING is
// produced at all.
import { describe, it, expect } from 'vitest';
import { routePromptEnhancement } from './routing-taxonomy.js';
import { planPromptEnhancementSections, type PromptEnhancementGuidanceFact } from './templates/section-plan.js';
import { composePromptEnhancementBody } from './compose-enhancement.js';
import { buildPromptEnhancementGuidanceFactsV1 } from './guidance-facts.js';
import { applyPromptEnhancementSourceMixV1 } from './source-mix.js';
import {
  promptHistoryAcceptanceExpectationsV1,
  promptHistoryVerificationAsksV1,
  promptHistoryExpectationEvidenceValueV1,
} from './prompt-history-expectation-signals.js';
import { PROMPT_ENHANCEMENT_CONTRACT_VERSION, type PromptEnhancementPrepareRequestV1, type PromptEnhancementSourceRefV1 } from './contracts.js';
import { getPromptStartStopSourceSnapshot } from './source-reality.js';

const STATED_ACCEPTANCE = 'the cart total updates without a page reload';
const STATED_VERIFICATION = 'the discount code still applies at checkout';

const HISTORY_THAT_STATES = [
  'building a checkout page for my store',
  `it is done when ${STATED_ACCEPTANCE}`,
  `make sure ${STATED_VERIFICATION}`,
  'now add the payment step',
];
const HISTORY_THAT_STATES_NOTHING = ['fix the header', 'make it blue', 'why is this slow'];

const sourceA: PromptEnhancementSourceRefV1 = {
  sourceRefId: 'src-a-1',
  sourceKind: 'source_a_user_prompt',
  sourceId: 'prompt:expectation-1',
  freshness: 'current',
  confidence: 'high',
  privacyClass: 'local_private',
};

/** The refs + grounding evidence the hook builds from recent prompts, as the pipeline builds them. */
function historySignals(recentPrompts: readonly string[]) {
  const refs: string[] = [];
  const groundingTierByRef: Record<string, string> = {};
  const groundingPolarityByRef: Record<string, string> = {};
  const groundingEvidenceByRef: Record<string, { key: string; value: string; runtimePath: string; anchorScope: string }> = {};
  for (const [index, expectation] of promptHistoryAcceptanceExpectationsV1(recentPrompts).entries()) {
    const ref = `history_acceptance:${index}`;
    refs.push(ref);
    groundingTierByRef[ref] = 'uncorroborated';
    groundingPolarityByRef[ref] = 'present';
    groundingEvidenceByRef[ref] = {
      key: 'what you said done means',
      value: promptHistoryExpectationEvidenceValueV1(expectation),
      runtimePath: 'local_store',
      anchorScope: 'current_prompt_scope',
    };
  }
  for (const [index, expectation] of promptHistoryVerificationAsksV1(recentPrompts).entries()) {
    const ref = `history_verification:${index}`;
    refs.push(ref);
    groundingTierByRef[ref] = 'uncorroborated';
    groundingPolarityByRef[ref] = 'present';
    groundingEvidenceByRef[ref] = {
      key: 'the check you asked for',
      value: promptHistoryExpectationEvidenceValueV1(expectation),
      runtimePath: 'local_store',
      anchorScope: 'current_prompt_scope',
    };
  }
  return { refs, groundingTierByRef, groundingPolarityByRef, groundingEvidenceByRef };
}

function requestWithHistory(recentPrompts: readonly string[]): PromptEnhancementPrepareRequestV1 {
  const signals = historySignals(recentPrompts);
  const promptStartStop = getPromptStartStopSourceSnapshot();
  return {
    schemaVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
    requestId: 'expectation-1',
    projectRoot: '/tmp/project',
    hostSurface: 'cli_stop_bridge',
    sourcePrompt: { text: 'now add the payment step', origin: 'user', capturedAt: 1, promptIndex: 5, generatedOriginPolicy: 'ordinary_source_a' },
    reviewMomentContext: {
      reviewMoment: 'UserPromptSubmit_preparation', currentAgentMode: 'workspace-write', projectId: 'p1', sessionId: 's1',
      detectedLanguage: 'en', stageCandidate: 'implementation', promptCount: 5, recentPromptMetadataRefs: [],
      triggerProvenance: {
        currentStage: 'implementation', prevStage: 'task_breakdown', triggerKind: 'stage_transition',
        classifierState: 'fire_recommended', degradedNoActionState: 'none',
        promptStartBoundary: promptStartStop.hookBoundary, deliveryBoundary: promptStartStop.deliveryBoundary,
        promptStartCanReplaceSameTurn: false,
      },
    },
    sourceSignals: {
      sourceAOriginalPromptRef: sourceA, sourceRefs: [sourceA], normalizedStageAbsenceSignalRefs: [],
      contentTemplateRecordFactRefs: [], popupQuestionSourceRefs: [], whyHelpSourceRefs: [], profileRoleModeRefs: [],
      rightGoodWorkStyleEnvRuntimeRefs: signals.refs, missingMemoryCandidateRefs: [],
      sourceOnlyHardFactRefs: [], recentPromptEvidenceRefs: [], memoryFeedbackRefs: [], sourceFactRefs: [],
      sourceLabels: [{ sourceRefId: sourceA.sourceRefId, label: 'original_prompt', evidenceStatus: 'present' }],
      promptStartStop: {
        hookBoundary: promptStartStop.hookBoundary, deliveryBoundary: promptStartStop.deliveryBoundary,
        runAutoCanHoldOrReplaceSubmittedPrompt: false, sharedSignalCount: promptStartStop.sharedSignalCount,
        classifierDegradedNoFireReasons: promptStartStop.classifierDegradedNoFireReasons,
      },
      groundingTierByRef: signals.groundingTierByRef,
      groundingPolarityByRef: signals.groundingPolarityByRef,
      groundingEvidenceByRef: signals.groundingEvidenceByRef,
    },
    userPreferenceContext: { levelState: 'level_3', scopedFeedbackEvidenceRefs: [] },
  } as unknown as PromptEnhancementPrepareRequestV1;
}

function factsFor(recentPrompts: readonly string[]): readonly PromptEnhancementGuidanceFact[] {
  return buildPromptEnhancementGuidanceFactsV1(requestWithHistory(recentPrompts));
}

describe('the detectors return the developer own words, or nothing', () => {
  it('what they said DONE looks like is extracted verbatim', () => {
    const found = promptHistoryAcceptanceExpectationsV1(HISTORY_THAT_STATES);
    expect(found).toHaveLength(1);
    expect(found[0]!.statedText).toBe(STATED_ACCEPTANCE);
  });

  it('what they said would be CHECKED is extracted verbatim, and separately', () => {
    const found = promptHistoryVerificationAsksV1(HISTORY_THAT_STATES);
    expect(found).toHaveLength(1);
    expect(found[0]!.statedText).toBe(STATED_VERIFICATION);
  });

  it('a history that states neither returns nothing — for both detectors', () => {
    expect(promptHistoryAcceptanceExpectationsV1(HISTORY_THAT_STATES_NOTHING)).toEqual([]);
    expect(promptHistoryVerificationAsksV1(HISTORY_THAT_STATES_NOTHING)).toEqual([]);
  });

  it('the rendered value quotes them and attributes it to their own history', () => {
    // Their words, quoted, and nothing else: the renderer supplies the framing, so narration here
    // would be narrated twice — measured as filler on a real body before this was corrected.
    const value = promptHistoryExpectationEvidenceValueV1({ statedText: STATED_ACCEPTANCE, promptsAgo: 0 });
    expect(value).toBe(`"${STATED_ACCEPTANCE}"`);
  });
});

describe('the producers — routed by action kind, never by a section override', () => {
  const facts = factsFor(HISTORY_THAT_STATES);

  it('an acceptance fact is produced and routed by its ACTION', () => {
    const fact = facts.find((candidate) => candidate.suggestedActionKind === 'add_acceptance_criteria');
    expect(fact).toBeDefined();
    expect(fact!.targetSectionKind).toBe('');
    expect(fact!.evidence?.value).toContain(STATED_ACCEPTANCE);
  });

  it('a verification fact is produced and routed by its ACTION', () => {
    const fact = facts.find((candidate) => candidate.suggestedActionKind === 'add_verification');
    expect(fact).toBeDefined();
    expect(fact!.targetSectionKind).toBe('');
    expect(fact!.evidence?.value).toContain(STATED_VERIFICATION);
  });

  it('both are support-only and possibility-clamped — they enrich a popup, never summon one', () => {
    for (const actionKind of ['add_acceptance_criteria', 'add_verification']) {
      const fact = facts.find((candidate) => candidate.suggestedActionKind === actionKind)!;
      expect(fact.sourceEligibilityState).toBe('support_only_not_triggering');
      expect(fact.claimVerbPolicy).toBe('must_phrase_as_possibility');
      expect(fact.sourceOriginScope).toBe('recent_prompt_history');
    }
  });
});

describe('THE NEGATIVE THAT MATTERS MOST — nothing said, nothing produced', () => {
  it('a history stating neither expectation produces NO fact of either kind', () => {
    // Not an empty fact, not a hedged one, not a placeholder: none. A section with no fact keeps
    // saying exactly what it says today, which is the honest answer.
    const facts = factsFor(HISTORY_THAT_STATES_NOTHING);
    expect(facts.some((fact) => fact.suggestedActionKind === 'add_acceptance_criteria')).toBe(false);
    expect(facts.some((fact) => fact.suggestedActionKind === 'add_verification')).toBe(false);
  });

  it('a ref with no resolved value produces nothing either — absence, not a shell', () => {
    const request = requestWithHistory(HISTORY_THAT_STATES) as unknown as {
      sourceSignals: { rightGoodWorkStyleEnvRuntimeRefs: string[]; groundingEvidenceByRef: Record<string, unknown> };
    };
    request.sourceSignals.groundingEvidenceByRef = {};
    const facts = buildPromptEnhancementGuidanceFactsV1(request as unknown as PromptEnhancementPrepareRequestV1);
    expect(facts.some((fact) => fact.suggestedActionKind === 'add_acceptance_criteria')).toBe(false);
    expect(facts.some((fact) => fact.suggestedActionKind === 'add_verification')).toBe(false);
  });
});

describe('the lane — these facts enrich a popup, they never summon one', () => {
  const historyFacts = () => factsFor(HISTORY_THAT_STATES).filter((fact) =>
    fact.suggestedActionKind === 'add_acceptance_criteria' || fact.suggestedActionKind === 'add_verification');

  it('the producer keeps them in the prompt-derived, support-only lane', () => {
    // THIS is the assertion that can fail: both fields are the producer's own choice, and a
    // promotion of either — to a triggering eligibility or out of the prompt-derived type — is
    // caught here. (Measured: mutating either one kills this test.)
    const facts = historyFacts();
    expect(facts.length).toBeGreaterThan(0);
    for (const fact of facts) {
      expect(fact.sourceType).toBe('prompt_derived_fact');
      expect(fact.sourceEligibilityState).toBe('support_only_not_triggering');
    }
  });

  it('and no popup opens on them alone', () => {
    // Recorded honestly: this holds STRUCTURALLY — the mixer's Source-A pool cannot be entered by
    // a fact of this shape at all, so no field this producer sets can change it (measured: source
    // type, eligibility, priority and evidence state promoted together still yield no survivor).
    // It is asserted because it is the property that matters, not because this test is what
    // enforces it — the assertion above is.
    const mix = applyPromptEnhancementSourceMixV1(historyFacts(), 'level_3');
    expect(mix.requiredSurvivor).toBeNull();
    expect(mix.showPopup).toBe(false);
  });
});

describe('the four other starved kinds stay starved — a choice, not an unfinished job', () => {
  it('no fact is produced for them', () => {
    const facts = factsFor(HISTORY_THAT_STATES);
    for (const actionKind of ['clarify_requirement', 'preserve_behavior', 'handoff_sequence', 'ask_for_source']) {
      expect(facts.some((fact) => fact.suggestedActionKind === actionKind), actionKind).toBe(false);
    }
  });
});

describe('the cap — new supply must not push welcome content out', () => {
  it('the pruner keeps its floor sections when the new facts arrive', async () => {
    // Supply and the cap pull against each other, and the cap was lowered deliberately. New facts
    // may enrich sections; they may not cost the body a section that was there to be useful.
    const { prunePromptEnhancementSectionsV1 } = await import('./section-pruner.js');
    const route = routePromptEnhancement({
      routeDecisionId: 'cap-route',
      promptText: 'now add the payment step',
      currentStage: 'implementation',
      prevStage: 'task_breakdown',
      triggerKind: 'absence',
      firedKey: 'absence:verification_gap@implementation',
      effectiveFiredSource: 'classifier_fire_recommendation',
      selectedQualifyingAbsence: 'verification_gap',
      absenceGateReason: 'selected_qualifying_absence',
      classifierState: 'fire_recommended',
      degradedNoActionState: 'none',
      generatedOriginState: 'ordinary_user_prompt',
    } as never);
    const withFacts = planPromptEnhancementSections({ routeResult: route, sourceRefs: [sourceA], guidanceFacts: factsFor(HISTORY_THAT_STATES) });
    const without = planPromptEnhancementSections({ routeResult: route, sourceRefs: [sourceA], guidanceFacts: [] });
    const prunedWith = prunePromptEnhancementSectionsV1({ sectionPlans: withFacts.sectionPlans, facts: withFacts.renderedFacts, relevanceOrder: [], routeResult: route } as never);
    const prunedWithout = prunePromptEnhancementSectionsV1({ sectionPlans: without.sectionPlans, facts: without.renderedFacts, relevanceOrder: [], routeResult: route } as never);
    // Every section the body had WITHOUT the new supply is still there WITH it.
    const keptWithout = prunedWithout.sectionPlans.map((plan) => plan.sectionKind);
    const keptWith = prunedWith.sectionPlans.map((plan) => plan.sectionKind);
    for (const kind of keptWithout) expect(keptWith, kind).toContain(kind);
    expect(prunedWith.floorSectionCount).toBe(prunedWithout.floorSectionCount);
  });

  it('the body does not grow a section count because of the new facts', () => {
    const route = routePromptEnhancement({
      routeDecisionId: 'cap-route-2',
      promptText: 'now add the payment step',
      currentStage: 'implementation',
      prevStage: 'task_breakdown',
      triggerKind: 'absence',
      firedKey: 'absence:verification_gap@implementation',
      effectiveFiredSource: 'classifier_fire_recommendation',
      selectedQualifyingAbsence: 'verification_gap',
      absenceGateReason: 'selected_qualifying_absence',
      classifierState: 'fire_recommended',
      degradedNoActionState: 'none',
      generatedOriginState: 'ordinary_user_prompt',
    } as never);
    const compose = (facts: readonly PromptEnhancementGuidanceFact[]) => composePromptEnhancementBody({
      enhancementId: 'cap-enh',
      originalPromptText: 'now add the payment step',
      sectionPlanningResult: planPromptEnhancementSections({ routeResult: route, sourceRefs: [sourceA], guidanceFacts: facts }),
    }).currentBody;
    const withFacts = compose(factsFor(HISTORY_THAT_STATES));
    const without = compose([]);
    // The facts speak INSIDE sections that already existed; they do not add new headings.
    expect(withFacts.sections.length).toBe(without.sections.length);
  });
});

describe('the wiring fixture — the fact reaches a COMPOSED BODY', () => {
  function composedWith(recentPrompts: readonly string[]) {
    const facts = factsFor(recentPrompts);
    const route = routePromptEnhancement({
      routeDecisionId: 'expectation-route',
      promptText: 'now add the payment step',
      currentStage: 'implementation',
      prevStage: 'task_breakdown',
      triggerKind: 'absence',
      firedKey: 'absence:verification_gap@implementation',
      effectiveFiredSource: 'classifier_fire_recommendation',
      selectedQualifyingAbsence: 'verification_gap',
      absenceGateReason: 'selected_qualifying_absence',
      classifierState: 'fire_recommended',
      degradedNoActionState: 'none',
      generatedOriginState: 'ordinary_user_prompt',
    } as never);
    const planning = planPromptEnhancementSections({ routeResult: route, sourceRefs: [sourceA], guidanceFacts: facts });
    return composePromptEnhancementBody({
      enhancementId: 'expectation-enh',
      originalPromptText: 'now add the payment step',
      sectionPlanningResult: planning,
    }).currentBody;
  }

  it('the acceptance section says what the developer actually wrote', () => {
    const body = composedWith(HISTORY_THAT_STATES);
    expect(body.text).toContain(STATED_ACCEPTANCE);
  });

  it('the verification section says what the developer actually wrote', () => {
    const body = composedWith(HISTORY_THAT_STATES);
    expect(body.text).toContain(STATED_VERIFICATION);
  });

  it('and a history that stated nothing composes exactly as today — no filler appears', () => {
    const body = composedWith(HISTORY_THAT_STATES_NOTHING);
    expect(body.text).not.toContain('you said');
    expect(body.text.length).toBeGreaterThan(0);
  });
});
