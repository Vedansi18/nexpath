import type { PromptEnhancementPrepareRequestV1 } from './contracts.js';
import {
  isNegativeFeedbackCategory,
  type PromptEnhancementFeedbackCategory,
} from '../store/prompt-enhancement.js';
import type { PromptEnhancementPopupEventV1 } from './popup-session.js';
import type { PromptEnhancementFeedbackSinkPolicyV1 } from './feedback-sink.js';
import {
  resolvePromptEnhancementGuidanceOutcomeV1,
  type PromptEnhancementGuidanceOutcomeV1,
} from './guidance-outcome.js';

/**
 * Derive the feedback->memory eligibility policy for a popup feedback event
 * (E3 / phase 3.2a). Resolved from source + content-owner's locked decisions:
 *
 *  - transform-rule-6: consume STABLE typed categories, no hidden LLM classifier -> the map is
 *    deterministic off the typed feedbackCategory.
 *  - transform-rule-7: feedback uses stable scoped categories; action clicks are per-popup
 *    signals, not durable preferences -> only per-signal keep/reject categories
 *    (isNegativeFeedbackCategory + accept_send) are `eligible_scoped`.
 *  - transform-rule-7: memory "cannot learn away safety/confirmation/source/authority floors"
 *    -> a safety-critical survivor sets safetyImpactState so the bridge does not learn.
 *
 * The stable signal key + risk come from re-running the E2 pipeline on the persisted
 * request (Path A) — the prepare result does not surface them. The feedback targets
 * the primary Source-A survivor (v1 feedback is body-level, no section selection).
 */
/** Request-driven wrapper: re-run the E2 pipeline (Path A), then derive the policy. */
export function derivePromptEnhancementFeedbackPolicyV1(
  event: PromptEnhancementPopupEventV1,
  request: PromptEnhancementPrepareRequestV1,
  projectRoot: string,
): PromptEnhancementFeedbackSinkPolicyV1 {
  return derivePromptEnhancementFeedbackPolicyFromOutcomeV1(
    event,
    resolvePromptEnhancementGuidanceOutcomeV1(request),
    projectRoot,
  );
}

/** Pure policy derivation from an already-resolved guidance outcome. */
export function derivePromptEnhancementFeedbackPolicyFromOutcomeV1(
  event: PromptEnhancementPopupEventV1,
  outcome: PromptEnhancementGuidanceOutcomeV1,
  projectRoot: string,
): PromptEnhancementFeedbackSinkPolicyV1 {
  const category = event.feedbackCategory as PromptEnhancementFeedbackCategory | undefined;

  const signalKey = outcome.primarySignalKey;
  const isScopedSignalJudgment =
    category !== undefined && (isNegativeFeedbackCategory(category) || category === 'accept_send');
  const eligible = signalKey !== null && isScopedSignalJudgment;

  // A safety-critical survivor must not be learned away by feedback.
  const safetyFloorTouched =
    outcome.primaryRiskLevel === 'high' || outcome.primaryRiskLevel === 'sensitive_authority_risky';

  return {
    projectRoot,
    // Memory keys on the stable signal key, not the ephemeral body id.
    feedbackScopeKey: signalKey ?? event.currentBodyId,
    learningEligibility: eligible ? 'eligible_scoped' : 'not_eligible',
    safetyImpactState: safetyFloorTouched ? 'safety_floor_touched' : 'none',
    memoryEvidence: eligible && !safetyFloorTouched,
  };
}
