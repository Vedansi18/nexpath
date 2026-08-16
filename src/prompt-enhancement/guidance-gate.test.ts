import { describe, expect, it } from 'vitest';
import { applyPromptEnhancementSourceMixV1 } from './source-mix.js';
import { applyPromptEnhancementGuidanceGateV1 } from './guidance-gate.js';
import type {
  PromptEnhancementGuidanceFact,
  PromptEnhancementGuidanceSourceType,
} from './templates/section-plan.js';

function fact(
  overrides: Partial<PromptEnhancementGuidanceFact> & { factId: string; sourceType: PromptEnhancementGuidanceSourceType },
): PromptEnhancementGuidanceFact {
  return {
    sourceIds: [`${overrides.factId}-src`],
    guidanceKind: 'missing_practice',
    suggestedActionKind: 'no_action_render_context_only',
    targetFamily: 'family_agnostic',
    targetSectionKind: '',
    sourceEvidenceState: 'strong',
    priority: 'required_survivor',
    renderPolicy: 'render_as_section',
    riskLevel: 'low',
    safetyHooks: [],
    privacyClass: 'public_safe',
    sanitizationState: 'not_applicable',
    publicCopySafe: true,
    ...overrides,
  };
}

const gateFor = (facts: PromptEnhancementGuidanceFact[]) =>
  applyPromptEnhancementGuidanceGateV1(applyPromptEnhancementSourceMixV1(facts));

describe('applyPromptEnhancementGuidanceGateV1 (E2 / 2.3 — DR2-G1)', () => {
  it('shows when there is a useful Source A survivor', () => {
    const decision = gateFor([fact({ factId: 'a1', sourceType: 'absence_signal' })]);
    expect(decision.show).toBe(true);
    expect(decision.disposition).toBe('show_current_body');
    expect(decision.fallbackMode).toBe('none');
    expect(decision.bodyShape).toBe('standard');
    expect(decision.gateReasonCode).toBe('show_source_a_survivor');
  });

  it('DR2-G1: Source-B-only evidence skips (no filler)', () => {
    const decision = gateFor([fact({ factId: 'h1', sourceType: 'hard_fact', priority: 'normal' })]);
    expect(decision.show).toBe(false);
    expect(decision.disposition).toBe('no_popup_not_applicable');
    expect(decision.fallbackMode).toBe('no_popup');
    expect(decision.validationStatus).toBe('no_popup');
    expect(decision.gateReasonCode).toBe('skip_source_b_only_no_filler');
  });

  it('DR2-G1: no evidence at all skips', () => {
    const decision = gateFor([]);
    expect(decision.show).toBe(false);
    expect(decision.gateReasonCode).toBe('skip_no_source_a_survivor');
  });

  it('DR2-G1: a weak/low-risk non-critical survivor skips rather than render a thin body', () => {
    const decision = gateFor([
      fact({ factId: 'a1', sourceType: 'absence_signal', priority: 'normal', riskLevel: 'low', sourceEvidenceState: 'weak_low_risk' }),
    ]);
    expect(decision.show).toBe(false);
    expect(decision.gateReasonCode).toBe('skip_weak_low_risk_evidence');
  });

  it('a stale survivor also skips', () => {
    const decision = gateFor([
      fact({ factId: 'a1', sourceType: 'absence_signal', priority: 'normal', sourceEvidenceState: 'stale_or_unknown' }),
    ]);
    expect(decision.show).toBe(false);
    expect(decision.gateReasonCode).toBe('skip_weak_low_risk_evidence');
  });

  it('a high-risk survivor shows confirmation-first EVEN on weak evidence (safety survives)', () => {
    const decision = gateFor([
      fact({
        factId: 'a1',
        sourceType: 'absence_signal',
        priority: 'required_survivor',
        riskLevel: 'sensitive_authority_risky',
        guidanceKind: 'safety_or_confirmation',
        sourceEvidenceState: 'weak_source_critical',
      }),
    ]);
    expect(decision.show).toBe(true);
    expect(decision.bodyShape).toBe('confirmation_first');
    expect(decision.gateReasonCode).toBe('show_high_risk_confirmation_first');
  });

  it('invalid Source A with none valid remaining -> skip_source_invalid_fallback', () => {
    const bad = fact({ factId: 'bad', sourceType: 'absence_signal', sourceIds: [] });
    const decision = gateFor([bad]);
    expect(decision.show).toBe(false);
    expect(decision.gateReasonCode).toBe('skip_source_invalid_fallback');
  });
});

// ── The locked dispositions for an under-evidenced route ──

describe('under-evidenced route: skip_no_popup default + the exactly-as-narrow exception', () => {
  const UNDER = { state: 'under_evidenced', rungsWalked: [1, 2, 3, 4, 5, 6] } as const;
  const RESOLVED = { state: 'resolved', resolvedByRung: 1 } as const;
  const gateUnder = (facts: PromptEnhancementGuidanceFact[]) =>
    applyPromptEnhancementGuidanceGateV1(applyPromptEnhancementSourceMixV1(facts), UNDER);

  it('no survivor at all: skip with the under-evidenced reason code', () => {
    const decision = gateUnder([]);
    expect(decision.show).toBe(false);
    expect(decision.gateReasonCode).toBe('skip_under_evidenced_no_popup');
  });

  it('a NORMAL strong survivor does not rescue an under-evidenced route — the default is skip, not a guess', () => {
    const decision = gateUnder([fact({ factId: 'a1', sourceType: 'absence_signal' })]);
    expect(decision.show).toBe(false);
    expect(decision.gateReasonCode).toBe('skip_under_evidenced_no_popup');
  });

  it('the exception: a source-critical survivor with STRONG evidence shows confirmation-first', () => {
    const decision = gateUnder([
      fact({ factId: 'r1', sourceType: 'absence_signal', riskLevel: 'high', sourceEvidenceState: 'strong' }),
    ]);
    expect(decision.show).toBe(true);
    expect(decision.bodyShape).toBe('confirmation_first');
    expect(decision.gateReasonCode).toBe('show_under_evidenced_high_risk_exception');
  });

  it('the exception: the safety_confirmation_support fact role with weak_source_critical evidence qualifies (typed fields, no keywords)', () => {
    const decision = gateUnder([
      fact({
        factId: 'r2',
        sourceType: 'absence_signal',
        factRole: 'safety_confirmation_support',
        sourceEvidenceState: 'weak_source_critical',
      }),
    ]);
    expect(decision.show).toBe(true);
    expect(decision.bodyShape).toBe('confirmation_first');
    expect(decision.gateReasonCode).toBe('show_under_evidenced_high_risk_exception');
  });

  it('exactly as narrow as the lock: a source-critical survivor on weak_low_risk evidence still skips', () => {
    const decision = gateUnder([
      fact({ factId: 'r3', sourceType: 'absence_signal', riskLevel: 'high', sourceEvidenceState: 'weak_low_risk' }),
    ]);
    expect(decision.show).toBe(false);
    expect(decision.gateReasonCode).toBe('skip_under_evidenced_no_popup');
  });

  it('a RESOLVED route keeps every pre-existing behaviour', () => {
    const strong = applyPromptEnhancementGuidanceGateV1(
      applyPromptEnhancementSourceMixV1([fact({ factId: 'a1', sourceType: 'absence_signal' })]),
      RESOLVED,
    );
    expect(strong.show).toBe(true);
    expect(strong.gateReasonCode).toBe('show_source_a_survivor');
  });

  it('the routeless replay path (no state passed) keeps every pre-existing behaviour', () => {
    const decision = applyPromptEnhancementGuidanceGateV1(
      applyPromptEnhancementSourceMixV1([fact({ factId: 'a1', sourceType: 'absence_signal' })]),
    );
    expect(decision.show).toBe(true);
    expect(decision.gateReasonCode).toBe('show_source_a_survivor');
  });
});
