import type { PromptEnhancementStructuredComposerOutputV1 } from './compose-enhancement.js';
import { promptEnhancementAuthorityModeForTextV1 } from './safety-sendability.js';

/**
 * Authority-consistency gate for the composer, mirroring the E5 language gate.
 *
 * A generated body must stay in the same mode as the request that produced it: if the user asked to
 * plan, review, check, prepare or assess, the wording must not turn into instructions to carry the work
 * out. The safety validator already rejects a body that crosses that line — but rejection means the
 * user gets their own prompt back with nothing added, so it is far better to catch the drift while the
 * composer can still be asked to rewrite.
 *
 * The model self-reports the mode of the wording it just produced, exactly as it self-reports the
 * detected language. Inconsistent means: the original request is plan/review-shaped and the output
 * reports `execute_requested`.
 *
 * IMPORTANT — this never relaxes anything. It can only cause a retry, and the deterministic
 * `validatePromptEnhancementSafety` gate remains the sole authority on whether a body is sendable. A
 * self-report claiming `plan_or_review` does not exempt a body from that check; the model is trusted to
 * flag its own drift, never to clear itself.
 */
export type PromptEnhancementComposerAuthoritySelfReportV1 =
  | 'plan_or_review'
  | 'execute_requested'
  | 'observe_or_literal';

export function isPromptEnhancementAuthoritySelfReportV1(
  value: unknown,
): value is PromptEnhancementComposerAuthoritySelfReportV1 {
  return value === 'plan_or_review' || value === 'execute_requested' || value === 'observe_or_literal';
}

/**
 * Was the original request plan/review-shaped, according to EITHER source?
 *
 * The word-list read of the original prompt used to decide this alone — and it is the same fragile
 * mechanism that misfires on the generated body, only applied one layer up. When it misread the
 * request, this gate skipped itself entirely and the drift was caught downstream by the deterministic
 * body rule. That rule has since been narrowed to a floor, so the miss would now go uncaught.
 *
 * Accepting the model's own reading as an alternative source closes that: either can establish
 * plan/review intent. This only ever makes the gate RUN more often, which can only cost a retry — it
 * cannot clear a verdict, and it cannot stop the deterministic gate from running.
 */
export function promptEnhancementRequestIsPlanShapedV1(
  originalPromptText: string,
  output: PromptEnhancementStructuredComposerOutputV1,
): boolean {
  return promptEnhancementAuthorityModeForTextV1(originalPromptText) === 'plan_or_review'
    || output.requestModeSelfReport === 'plan_or_review';
}

export function isPromptEnhancementAuthorityConsistentV1(
  originalPromptText: string,
  output: PromptEnhancementStructuredComposerOutputV1,
): boolean {
  // No self-report (older/injected clients) is not treated as drift — the deterministic gate still
  // runs, so a missing field must not cost the caller its retry budget.
  if (output.authorityModeSelfReport === undefined) return true;
  if (!promptEnhancementRequestIsPlanShapedV1(originalPromptText, output)) return true;
  return output.authorityModeSelfReport !== 'execute_requested';
}
