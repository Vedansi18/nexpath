import type {
  PromptEnhancementDisposition,
  PromptEnhancementFallbackMode,
  PromptEnhancementValidationStatus,
} from './contracts.js';
import type { PromptEnhancementGuidanceFact } from './templates/section-plan.js';
import type { PromptEnhancementSourceMixResult } from './source-mix.js';
import type { PromptEnhancementLadderResolutionV1 } from './taxonomy-ids.js';

/**
 * DR2-G1 guidance gate (E2 / phase 2.3).
 *
 * The locked "≥1 real guidance section OR `skip_no_popup`, no filler" gate, applied
 * at the builder->planner boundary over the {@link applyPromptEnhancementSourceMixV1}
 * result:
 *
 *  - A shown popup MUST have one *useful* Source A survivor. If the mixer already
 *    skipped (no Source A, Source-B-only, invalid), the gate skips with that reason.
 *  - Beyond the mixer's "no Source A at all" skip, the gate also skips when the
 *    survivor's evidence is only weak/stale/low-risk — never a generic canned body.
 *  - A source-critical / high-risk survivor always shows, in a confirmation-first
 *    shape, even on weak evidence (safety must survive fatigue and weak evidence).
 *
 * Skip maps to the `no_popup_not_applicable` disposition + `no_popup` fallback.
 * Deterministic — no LLM.
 */
export type PromptEnhancementBodyShape = 'standard' | 'confirmation_first' | 'planning_first';

export interface PromptEnhancementGuidanceGateDecision {
  show: boolean;
  disposition: Extract<PromptEnhancementDisposition, 'show_current_body' | 'no_popup_not_applicable'>;
  fallbackMode: Extract<PromptEnhancementFallbackMode, 'none' | 'no_popup'>;
  validationStatus: Extract<PromptEnhancementValidationStatus, 'valid' | 'no_popup'>;
  bodyShape: PromptEnhancementBodyShape;
  gateReasonCode: string;
}

const WEAK_EVIDENCE_STATES: ReadonlySet<PromptEnhancementGuidanceFact['sourceEvidenceState']> = new Set([
  'weak_low_risk',
  'stale_or_unknown',
  'missing',
]);

/** High-risk / safety facts survive fatigue and weak evidence; they force a confirmation-first show. */
function isSourceCritical(fact: PromptEnhancementGuidanceFact): boolean {
  return (
    fact.riskLevel === 'high' ||
    fact.riskLevel === 'sensitive_authority_risky' ||
    fact.guidanceKind === 'safety_or_confirmation'
  );
}

const SKIP: Omit<PromptEnhancementGuidanceGateDecision, 'gateReasonCode' | 'bodyShape'> = {
  show: false,
  disposition: 'no_popup_not_applicable',
  fallbackMode: 'no_popup',
  validationStatus: 'no_popup',
};

function skip(gateReasonCode: string): PromptEnhancementGuidanceGateDecision {
  return { ...SKIP, bodyShape: 'standard', gateReasonCode };
}

function show(bodyShape: PromptEnhancementBodyShape, gateReasonCode: string): PromptEnhancementGuidanceGateDecision {
  return { show: true, disposition: 'show_current_body', fallbackMode: 'none', validationStatus: 'valid', bodyShape, gateReasonCode };
}

export function applyPromptEnhancementGuidanceGateV1(
  mix: PromptEnhancementSourceMixResult,
  /**
   * The routing layer's evidence-ladder outcome, flowed into THIS gate so the
   * under-evidenced case rides the existing skip machinery — never a second
   * gate or a parallel skip path. The locked dispositions for it (the skip
   * default and the narrow high-risk exception) are the fallback-direction
   * step and are wired here by that step; absent on the routeless replay path.
   */
  routeLadderResolution?: PromptEnhancementLadderResolutionV1,
): PromptEnhancementGuidanceGateDecision {
  void routeLadderResolution;
  // The mixer already decided to skip (DR2-G1: no Source A survivor / Source-B-only /
  // invalid). Carry the reason; never fabricate a filler popup.
  if (!mix.showPopup || mix.requiredSurvivor === null) {
    switch (mix.profile) {
      case 'source_b_only_no_popup':
        return skip('skip_source_b_only_no_filler');
      case 'source_invalid_fallback':
        return skip('skip_source_invalid_fallback');
      default:
        return skip('skip_no_source_a_survivor');
    }
  }

  const survivor = mix.requiredSurvivor;

  // Source-critical survivors always show, confirmation-first, regardless of evidence strength.
  if (isSourceCritical(survivor) || mix.profile === 'source_a_heavy_high_risk') {
    return show('confirmation_first', 'show_high_risk_confirmation_first');
  }

  // A non-critical survivor on only weak/stale/low-risk evidence is not useful enough
  // to interrupt with — skip rather than render a thin canned body.
  if (WEAK_EVIDENCE_STATES.has(survivor.sourceEvidenceState)) {
    return skip('skip_weak_low_risk_evidence');
  }

  return show('standard', 'show_source_a_survivor');
}
