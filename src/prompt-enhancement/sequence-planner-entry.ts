import type { Database } from 'sql.js';
import {
  resolvePromptEnhancementSequenceConfig,
  type PromptEnhancementSequenceEnabled,
} from '../config/PromptEnhancementConfig.js';
import type { PromptEnhancementSentPromptOrigin } from './contracts.js';
import type { PromptEnhancementSequenceNextPromptPolicyV1 } from './sequence-payload.js';

/**
 * Entry conditions for the sequence planner.
 *
 * The planner is the call that decides whether a request becomes a multi-prompt sequence. It runs
 * on prompts the USER wrote, and on nothing else — a body this feature generated re-entering the
 * planner would plan a sequence out of its own writing while one is already active, which is a loop
 * rather than a quality problem.
 *
 * Every condition here is a refusal, and every refusal is silent by contract. The config gate in
 * particular is a forbidden render value in the acceptance and config fixture matrices, so an off
 * gate produces no sequence and no explanation of why — it looks exactly like a prompt that did not
 * need one.
 */

export type PromptEnhancementSequencePlannerRefusalV1 =
  | 'prompt_not_user_authored'
  | 'prompt_origin_unknown'
  | 'body_is_sequence_owned'
  | 'body_is_feature_generated'
  | 'sequence_disabled_by_config'
  | 'no_absence_signal_section';

export type PromptEnhancementSequencePlannerEntryV1 =
  | { mayRun: true }
  | { mayRun: false; refusal: PromptEnhancementSequencePlannerRefusalV1 };

/**
 * What a caller supplies. The config gate is NOT on it: the gate is resolved by the planner from
 * the store, so a caller cannot hand it a value it read some other way.
 */
export type PromptEnhancementSequencePlannerEntryRequestV1 =
  Omit<PromptEnhancementSequencePlannerEntryInputV1, 'sequenceEnabled'>;

export interface PromptEnhancementSequencePlannerEntryInputV1 {
  /** The request's own origin for this prompt. */
  promptOrigin: 'user' | 'pe_generated_echo' | 'unknown';
  /**
   * What produced the body being submitted. Only present once a body exists; when the planner runs
   * ahead of composition there is nothing to check and this is left unset.
   */
  sentPromptOrigin?: PromptEnhancementSentPromptOrigin;
  /**
   * The effective value of the sequence config key for this project.
   *
   * It comes from the config resolver and from nowhere else, which is why it is not a field the
   * caller fills in: the resolver applies project-over-global precedence and turns an invalid value
   * into `off` rather than into the default, and both failures it prevents are silent ones — a
   * project's `off` overruled by a global `on`, and a typo enabling a gate whose name may never be
   * rendered, so nothing can say it happened.
   */
  sequenceEnabled: PromptEnhancementSequenceEnabled;
  /**
   * Whether the guidance gate decided a popup will be shown at all.
   *
   * This is the gate's OWN answer, passed in. The planner must not work out its own version of it:
   * a second predicate would drift from the shipping one, which is the same failure the safety
   * fields avoid by being read off the machinery that already ships rather than asked for.
   *
   * It is an entry condition rather than an after-the-fact check because a sequence planned onto a
   * popup that never appears is a whole planner call thrown away — the most expensive item in this
   * feature's cost table, spent on nothing.
   */
  guidanceGateShow: boolean;
}

/** Bodies this feature produced. A sequence-owned one is called out separately because it is the
 *  case that closes the loop rather than merely skipping a call. */
const FEATURE_GENERATED_BODIES: readonly PromptEnhancementSentPromptOrigin[] = [
  'pe_baseline_generated_body',
  'pe_action_generated_body',
  'pe_deterministic_fallback_body',
  'previous_sendable_body',
];

/**
 * The entry decision for a real project, with the config gate read the only way it may be read.
 *
 * The resolver is called here rather than by whoever calls the planner, because a caller holding a
 * database and needing a yes/no will write the one-line query — and the one-line query is the
 * version that loses project-over-global precedence and treats an invalid value as absent.
 */
export function promptEnhancementSequencePlannerMayRunForProjectV1(
  db: Database,
  projectRoot: string | undefined,
  request: PromptEnhancementSequencePlannerEntryRequestV1,
): PromptEnhancementSequencePlannerEntryV1 {
  const config = resolvePromptEnhancementSequenceConfig(db, projectRoot);
  return promptEnhancementSequencePlannerMayRunV1({
    ...request,
    sequenceEnabled: config.sequenceEnabled,
  });
}

/**
 * May the planner run on this prompt?
 *
 * Fail-closed in every direction: an origin that is not positively known to be the user's is a
 * refusal, not a default-allow.
 */
export function promptEnhancementSequencePlannerMayRunV1(
  input: PromptEnhancementSequencePlannerEntryInputV1,
): PromptEnhancementSequencePlannerEntryV1 {
  if (input.sequenceEnabled !== 'on') return { mayRun: false, refusal: 'sequence_disabled_by_config' };
  if (input.promptOrigin === 'unknown') return { mayRun: false, refusal: 'prompt_origin_unknown' };
  if (input.promptOrigin !== 'user') return { mayRun: false, refusal: 'prompt_not_user_authored' };

  // A continuation body carries the sequence's own wording. Planning from it would decompose text
  // this feature wrote, mid-sequence.
  if (input.sentPromptOrigin === 'sequence_handoff_owned_body') {
    return { mayRun: false, refusal: 'body_is_sequence_owned' };
  }
  if (input.sentPromptOrigin !== undefined && FEATURE_GENERATED_BODIES.includes(input.sentPromptOrigin)) {
    return { mayRun: false, refusal: 'body_is_feature_generated' };
  }
  // No popup, no sequence. The sequence is offered on the first popup and nowhere else, so a gate
  // that has already decided against showing one leaves nothing for a plan to be offered on.
  if (!input.guidanceGateShow) return { mayRun: false, refusal: 'no_absence_signal_section' };
  return { mayRun: true };
}

/**
 * The policy value a row carries for a given planner outcome.
 *
 * Only a planned sequence has wording written before the user accepts it, so only a sequence moves
 * off the default. Getting this wrong in the other direction would declare text generated ahead of
 * acceptance on a row that has none.
 */
export function promptEnhancementSequencePolicyForOutcomeV1(
  outcome: 'sequence' | 'single_with_confirmation' | 'single_plain',
): PromptEnhancementSequenceNextPromptPolicyV1 {
  return outcome === 'sequence' ? 'generated_not_rendered_pending_acceptance' : 'not_generated';
}
