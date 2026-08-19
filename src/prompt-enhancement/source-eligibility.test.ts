import { describe, expect, it } from 'vitest';
import { applyPromptEnhancementSourceMixV1 } from './source-mix.js';
import { buildPromptEnhancementGuidanceFactsV1 } from './guidance-facts.js';
import { resolvePromptEnhancementGuidanceOutcomeV1 } from './guidance-outcome.js';
import type {
  PromptEnhancementPrepareRequestV1,
  PromptEnhancementSourceInputSnapshotV1,
} from './contracts.js';
import {
  PROMPT_ENHANCEMENT_NON_TRIGGERING_ELIGIBILITY_V1,
  isPromptEnhancementPopupEligibleFactV1,
  type PromptEnhancementGuidanceFact,
  type PromptEnhancementSourceEligibilityStateV1,
} from './templates/section-plan.js';

/**
 * F4 / L4971 — the eligibility gate, stated by the lock itself:
 *
 *   "Eligibility fixtures fail if blocked, dismissed, skipped, capped, cooldown, weak, or invalid
 *    facts independently show a v1 popup."
 *
 * The gating is NOT re-implemented in PE (prohibition 19) — frequency, dedup, cooldown and
 * session-cap are decided upstream and carried through. These fixtures check the READING of that
 * decision: that a fact arriving with a non-triggering state cannot be the survivor a popup opens
 * on, and that a fact arriving eligible still can.
 */

/** The one Source-A shape that can be a required survivor, so eligibility is the only variable. */
function signalFact(
  state: PromptEnhancementSourceEligibilityStateV1 | undefined,
): PromptEnhancementGuidanceFact {
  return {
    factId: 'signal-1',
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
    ...(state === undefined ? {} : { sourceEligibilityState: state }),
  };
}

describe('F4 / L4971 — eligibility is routing authority', () => {
  const BLOCKING: readonly PromptEnhancementSourceEligibilityStateV1[] = [
    'blocked_by_frequency',
    'blocked_by_dedup',
    'blocked_by_post_advisory_cooldown',
    'blocked_by_session_cap',
    'dismissed_or_user_skipped',
    'too_weak_no_popup',
    'invalid_source',
    'support_only_not_triggering',
  ];

  it.each(BLOCKING)('a %s fact cannot independently open a popup', (state) => {
    const result = applyPromptEnhancementSourceMixV1([signalFact(state)], 'default');
    expect(result.showPopup, `${state} opened a popup on its own`).toBe(false);
    expect(result.requiredSurvivor).toBeNull();
    expect(result.renderedFacts).toEqual([]);
  });

  it.each(['fresh_trigger_eligible', 'active_signal_eligible', 'memory_eligible'] as const)(
    'an %s fact still opens a popup — the gate blocks, it does not silence everything',
    (state) => {
      const result = applyPromptEnhancementSourceMixV1([signalFact(state)], 'default');
      expect(result.showPopup).toBe(true);
      expect(result.requiredSurvivor?.factId).toBe('signal-1');
    },
  );

  it('a blocked fact is CLASSIFIED with a reason, never silently dropped', () => {
    // §42.2's complaint was that PE could not SEE the gating. Replacing an invisible pass with an
    // invisible drop would repeat the defect in the other direction.
    const result = applyPromptEnhancementSourceMixV1([signalFact('blocked_by_dedup')], 'default');
    const row = result.classifiedFacts.find((entry) => entry.fact.factId === 'signal-1');
    expect(row).toBeDefined();
    expect(row?.selectionReasonCode).toBe('ineligible_source_a_not_triggering');
  });

  it('an UNSTAMPED fact keeps its pre-F4 behaviour — absence of a state is not a block', () => {
    // The locked list names states; it does not make "nobody decided" a block. Reading it that way
    // cost 43 fixtures on the first attempt, because every unstamped producer lost survivor status.
    const result = applyPromptEnhancementSourceMixV1([signalFact(undefined)], 'default');
    expect(result.showPopup).toBe(true);
    expect(result.requiredSurvivor?.factId).toBe('signal-1');
  });

  it('the locked eleven are all present, and exactly eight of them block', () => {
    // A drift guard on the lock itself: if a value is renamed or dropped, this fails rather than
    // letting the gate quietly stop covering a case.
    const all: PromptEnhancementSourceEligibilityStateV1[] = [
      'fresh_trigger_eligible', 'active_signal_eligible', 'memory_eligible',
      'support_only_not_triggering', 'blocked_by_frequency', 'blocked_by_dedup',
      'blocked_by_post_advisory_cooldown', 'blocked_by_session_cap',
      'dismissed_or_user_skipped', 'too_weak_no_popup', 'invalid_source',
    ];
    expect(all).toHaveLength(11);
    expect(PROMPT_ENHANCEMENT_NON_TRIGGERING_ELIGIBILITY_V1.size).toBe(8);
    expect(all.filter((state) => !isPromptEnhancementPopupEligibleFactV1(state))).toHaveLength(8);
  });
});

/**
 * A request that exercises EVERY producer in one pass: the fired absence trigger, a normalized
 * signal ref, a content-template record, a memory candidate, a hard fact, and a recurring mistake.
 * Shaped like `guidance-facts.test.ts`'s own fixture — the builder reads only sourceSignals plus
 * the review-moment trigger, so a focused cast keeps this on the unit under test.
 */
function buildRequestExercisingEveryProducer(
  probe?: 'blocked_by_cooldown_probe',
): PromptEnhancementPrepareRequestV1 {
  const sourceSignals = {
    normalizedStageAbsenceSignalRefs: ['absence:verification_gap@implementation'],
    contentTemplateRecordFactRefs: ['ct:verification_guidance'],
    missingMemoryCandidateRefs: ['memory:absence:verification_gap'],
    rightGoodWorkStyleEnvRuntimeRefs: ['mistake:regression_check'],
    sourceOnlyHardFactRefs: ['hard_fact:test_runner'],
    groundingTierByRef: {},
    groundingPolarityByRef: {},
    groundingEvidenceByRef: {},
    triggerSignalEligibilityState: probe === undefined
      ? 'fresh_trigger_eligible'
      : 'blocked_by_post_advisory_cooldown',
  } as unknown as PromptEnhancementSourceInputSnapshotV1;
  return {
    sourceSignals,
    reviewMomentContext: {
      triggerProvenance: {
        triggerKind: 'absence',
        currentStage: 'implementation',
        selectedQualifyingAbsence: 'verification_gap',
      },
    },
  } as unknown as PromptEnhancementPrepareRequestV1;
}

describe('F4 done-when — EVERY fact entering the mix carries its eligibility', () => {
  // The plan's first done-when clause is a COVERAGE claim, so it needs a coverage check rather
  // than a spot assertion: build facts from a request that exercises every producer and assert
  // none arrives unlabelled. The first pass of this phase stamped only the absence producer,
  // which satisfied the gate fixtures while five producers stayed silent.
  it('no producer emits a fact without a state', () => {
    const facts = buildPromptEnhancementGuidanceFactsV1(buildRequestExercisingEveryProducer());
    expect(facts.length).toBeGreaterThan(0);
    const unlabelled = facts.filter((fact) => fact.sourceEligibilityState === undefined);
    expect(
      unlabelled.map((fact) => `${fact.factId}:${fact.sourceType}`),
      'these producers emit facts with no eligibility state',
    ).toEqual([]);
  });

  it('every state used comes from the locked eleven', () => {
    const facts = buildPromptEnhancementGuidanceFactsV1(buildRequestExercisingEveryProducer());
    const locked = new Set<string>([
      'fresh_trigger_eligible', 'active_signal_eligible', 'memory_eligible',
      'support_only_not_triggering', 'blocked_by_frequency', 'blocked_by_dedup',
      'blocked_by_post_advisory_cooldown', 'blocked_by_session_cap',
      'dismissed_or_user_skipped', 'too_weak_no_popup', 'invalid_source',
    ]);
    for (const fact of facts) {
      expect(locked.has(String(fact.sourceEligibilityState)), `${fact.sourceType} used an off-list state`).toBe(true);
    }
  });

  it('the boundary decision REACHES the trigger fact — a cooldown turn yields a cooldown fact', () => {
    // The whole point of a pass-through: what runAuto decided has to arrive on the fact.
    const facts = buildPromptEnhancementGuidanceFactsV1(
      buildRequestExercisingEveryProducer('blocked_by_cooldown_probe'),
    );
    const signal = facts.find((fact) => fact.sourceType === 'absence_signal');
    expect(signal?.sourceEligibilityState).toBe('blocked_by_post_advisory_cooldown');
  });
});

describe('F4 done-when — "no popup shows on the strength of a blocked fact", at the SHOW layer', () => {
  // The gate fixtures above prove the MIXER refuses an ineligible survivor. The done-when is about
  // the popup, and `show` is decided one layer up by the guidance gate reading that mix. Asserting
  // only the mixer would leave the sentence the plan actually wrote untested.
  const blockedRequest = (state: string) => {
    const request = buildRequestExercisingEveryProducer();
    return {
      ...request,
      sourceSignals: { ...request.sourceSignals, triggerSignalEligibilityState: state },
      userPreferenceContext: { levelState: 'default', scopedFeedbackEvidenceRefs: [] },
    } as unknown as Parameters<typeof resolvePromptEnhancementGuidanceOutcomeV1>[0];
  };

  it.each([
    'blocked_by_frequency',
    'blocked_by_dedup',
    'blocked_by_post_advisory_cooldown',
    'blocked_by_session_cap',
    'dismissed_or_user_skipped',
    'too_weak_no_popup',
  ])('a %s trigger does not carry a popup through the gate on its own', (state) => {
    const outcome = resolvePromptEnhancementGuidanceOutcomeV1(blockedRequest(state));
    // The trigger signal is blocked, so it must not be the survivor the popup rests on.
    // The REAL key the trigger producer emits — asserting the ref string instead would pass
    // trivially, because that value never appears as a primary signal key.
    expect(outcome.primarySignalKey).not.toBe('absence:verification_gap');
  });

  it('the same request with an eligible trigger DOES anchor on that signal', () => {
    const outcome = resolvePromptEnhancementGuidanceOutcomeV1(blockedRequest('fresh_trigger_eligible'));
    expect(outcome.show).toBe(true);
    expect(outcome.primarySignalKey).toBe('absence:verification_gap');
  });
});

describe('F4 x prohibition 17 — eligibility gates ANCHORING, it never fades safety', () => {
  // §12.6 puts this group under prohibition 17 ("safety never faded or pruned"), and source-mix
  // states the same rule in its own words: high-risk / source-critical facts must never be
  // downgraded to invisible metadata. A first pass of F4 excluded ineligible facts from the Source-A
  // pool outright, so a source-critical fact that upstream had blocked never reached the
  // `selected_source_label_only` carve-out — safety faded by a gate meant only to stop anchoring.
  // L4991 is the arbiter: a blocked fact must not OPEN a popup, and support material "may
  // label/support only AFTER another eligible Source A survivor exists".

  const eligibleAnchor = (): PromptEnhancementGuidanceFact => ({
    ...signalFact('fresh_trigger_eligible'),
    factId: 'anchor-1',
    sourceIds: ['absence:anchor@implementation'],
  });

  const blockedSafetyFact = (): PromptEnhancementGuidanceFact => ({
    ...signalFact('blocked_by_dedup'),
    factId: 'safety-1',
    sourceIds: ['absence:secret_in_prompt@implementation'],
    guidanceKind: 'safety_or_confirmation',
    riskLevel: 'sensitive_authority_risky',
    priority: 'required_survivor',
  });

  it('a BLOCKED safety fact still appears once an eligible survivor anchors the popup', () => {
    const result = applyPromptEnhancementSourceMixV1([eligibleAnchor(), blockedSafetyFact()], 'default');
    expect(result.showPopup).toBe(true);
    expect(result.requiredSurvivor?.factId).toBe('anchor-1');
    const safety = result.classifiedFacts.find((entry) => entry.fact.factId === 'safety-1');
    expect(safety, 'the blocked safety fact vanished from the mix').toBeDefined();
    expect(
      ['selected_supporting', 'selected_source_label_only'],
      'safety was downgraded to invisible metadata',
    ).toContain(safety?.selectionRole);
  });

  it('but it still cannot ANCHOR one on its own', () => {
    const result = applyPromptEnhancementSourceMixV1([blockedSafetyFact()], 'default');
    expect(result.showPopup).toBe(false);
    expect(result.requiredSurvivor).toBeNull();
  });

  it('and when nothing anchors, the refusal is still reason-coded', () => {
    const result = applyPromptEnhancementSourceMixV1([blockedSafetyFact()], 'default');
    const row = result.classifiedFacts.find((entry) => entry.fact.factId === 'safety-1');
    expect(row?.selectionReasonCode).toBe('ineligible_source_a_not_triggering');
  });
});
