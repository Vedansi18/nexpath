import { describe, expect, it } from 'vitest';
import { applyPromptEnhancementSourceMixV1 } from './source-mix.js';
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
