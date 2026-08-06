import { describe, expect, it } from 'vitest';
import { derivePromptEnhancementFeedbackPolicyFromOutcomeV1 } from './feedback-policy.js';
import type { PromptEnhancementGuidanceOutcomeV1 } from './guidance-outcome.js';
import type { PromptEnhancementPopupEventV1 } from './popup-session.js';

function event(feedbackCategory: string | undefined, currentBodyId = 'body-1'): PromptEnhancementPopupEventV1 {
  return { feedbackCategory, currentBodyId } as unknown as PromptEnhancementPopupEventV1;
}

const outcome = (
  overrides: Partial<PromptEnhancementGuidanceOutcomeV1>,
): PromptEnhancementGuidanceOutcomeV1 => ({
  show: true,
  primarySignalKey: 'absence:acceptance_criteria',
  primaryRiskLevel: 'low',
  renderedSourceASignals: [],
  ...overrides,
});

describe('derivePromptEnhancementFeedbackPolicyFromOutcomeV1 (E3 / 3.2a)', () => {
  it('a negative scoped feedback on a non-safety survivor is eligible and keys on the signal', () => {
    const policy = derivePromptEnhancementFeedbackPolicyFromOutcomeV1(event('user_deleted_generated_section'), outcome({}), '/repo/a');
    expect(policy.feedbackScopeKey).toBe('absence:acceptance_criteria');
    expect(policy.learningEligibility).toBe('eligible_scoped');
    expect(policy.safetyImpactState).toBe('none');
    expect(policy.memoryEvidence).toBe(true);
  });

  it('accept_send (kept) is eligible positive evidence', () => {
    const policy = derivePromptEnhancementFeedbackPolicyFromOutcomeV1(event('accept_send'), outcome({}), '/repo/a');
    expect(policy.learningEligibility).toBe('eligible_scoped');
    expect(policy.memoryEvidence).toBe(true);
  });

  it('a per-popup action click (not a per-signal judgment) is not eligible', () => {
    const policy = derivePromptEnhancementFeedbackPolicyFromOutcomeV1(event('directional_action'), outcome({}), '/repo/a');
    expect(policy.learningEligibility).toBe('not_eligible');
    expect(policy.memoryEvidence).toBe(false);
  });

  it('a safety-critical survivor is never learned away (safety floor blocks memory)', () => {
    const policy = derivePromptEnhancementFeedbackPolicyFromOutcomeV1(
      event('user_deleted_generated_section'),
      outcome({ primaryRiskLevel: 'sensitive_authority_risky' }),
      '/repo/a',
    );
    expect(policy.learningEligibility).toBe('eligible_scoped');
    expect(policy.safetyImpactState).toBe('safety_floor_touched');
    expect(policy.memoryEvidence).toBe(false);
  });

  it('no Source-A survivor -> not eligible, falls back to the body id as scope', () => {
    const policy = derivePromptEnhancementFeedbackPolicyFromOutcomeV1(
      event('user_deleted_generated_section'),
      outcome({ primarySignalKey: null, primaryRiskLevel: null }),
      '/repo/a',
    );
    expect(policy.feedbackScopeKey).toBe('body-1');
    expect(policy.learningEligibility).toBe('not_eligible');
    expect(policy.memoryEvidence).toBe(false);
  });

  it('missing feedback category -> not eligible', () => {
    const policy = derivePromptEnhancementFeedbackPolicyFromOutcomeV1(event(undefined), outcome({}), '/repo/a');
    expect(policy.learningEligibility).toBe('not_eligible');
  });
});
