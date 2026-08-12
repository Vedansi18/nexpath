import { describePromptEnhancementSequencePlanV1 } from './routing-taxonomy.js';
import type { PromptEnhancementSequencePlannerFailureReasonV1 } from './sequence-planner.js';

/**
 * What happens when the planner does not produce a plan.
 *
 * Three different things, and the difference is what the user is owed. A refusal by entry condition
 * is silent by contract — the config gate's own key may not appear in anything rendered, so an off
 * gate has to look exactly like a prompt that did not need a sequence. A provider that could not be
 * reached is something the user should be told about, because nothing was produced and they are
 * waiting. A plan that came back and did not hold together is neither: the ordinary single-prompt
 * path still works, so the sequence is simply not offered.
 *
 * Collapsing any two of these gets a user either an unexplained silence where there was a real
 * fault, or an error popup for a feature they have switched off.
 */

/**
 * What a failed sequence call leaves the user with. One vocabulary for every call in the feature,
 * because the answer is about the user and not about which call it was.
 */
export type PromptEnhancementSequenceFailureDispositionV1 =
  /** Nothing rendered, nothing explained. The refusal itself must not be surfaced. */
  | 'silent_no_sequence'
  /** A public-safe error popup, and no generated content of any kind. */
  | 'error_popup_no_generated_content'
  /** No sequence; the prompt goes on as an ordinary single-prompt enhancement. */
  | 'no_sequence_single_prompt';

/**
 * One dispatch over every reason the planner can fail with, with no default arm: a reason added
 * later stops compiling here rather than falling into whichever branch happens to be last, and
 * "whichever is last" is how a silent refusal becomes an error popup.
 */
export function promptEnhancementSequencePlannerDispositionV1(
  reason: PromptEnhancementSequencePlannerFailureReasonV1,
): PromptEnhancementSequenceFailureDispositionV1 {
  switch (reason) {
    // Entry conditions. Every one of them is silent, and the config gate is why: its key and value
    // are forbidden render values, so explaining the silence is not available even in principle.
    case 'sequence_disabled_by_config':
    case 'prompt_not_user_authored':
    case 'prompt_origin_unknown':
    case 'body_is_sequence_owned':
    case 'body_is_feature_generated':
    case 'no_absence_signal_section':
      return 'silent_no_sequence';

    // The call could not be made or did not come back. Not the retry path, and not a plan problem.
    case 'no_key':
    case 'provider_error':
    case 'timeout':
      return 'error_popup_no_generated_content';

    // A context whose positions do not address the original. Nothing was wrong with the provider
    // and nothing is wrong with the prompt — the caller handed the planner a text it cannot index,
    // and an error popup would blame the user for it.
    case 'context_does_not_index_original':
    // Nor did anything fail when there was no time to start: the user asked for a prompt and gets
    // one, without a sequence and without being told about a deadline that is ours, not theirs.
    case 'planner_deadline_exceeded':
      return 'no_sequence_single_prompt';

    // Everything else is a plan that arrived and did not hold up, including after its repairs were
    // spent. The single-prompt path is unaffected, so the sequence is not offered and that is all.
    default:
      return 'no_sequence_single_prompt';
  }
}

/**
 * What the splitter may still produce when there is no planner at all.
 *
 * A COUNT, and nothing else. The type carries no field wording could be put in, because the
 * boundary is not a rule someone has to remember: deterministic per-item wording is forbidden
 * outright, and the way that gets breached is a fallback that already has a text field to fill.
 *
 * The count is a shape hint about the text and is wrong in both directions — see what the helper it
 * calls says about itself. It exists so a fail-closed path still yields something typed, not
 * because the number is trustworthy.
 */
export interface PromptEnhancementSequenceSplitterCountV1 {
  pointCount: number;
  /** Always true. Present so a reader of the value knows what produced it without tracing back. */
  isProvisionalSubstituteCount: true;
}

/** Calls the shipping helper rather than re-splitting: one splitter, one set of failure modes. */
export function promptEnhancementSequenceSplitterCountV1(
  promptText: string,
): PromptEnhancementSequenceSplitterCountV1 {
  return {
    pointCount: describePromptEnhancementSequencePlanV1(promptText).pointCount,
    isProvisionalSubstituteCount: true,
  };
}
