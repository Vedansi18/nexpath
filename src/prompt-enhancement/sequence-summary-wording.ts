import OpenAI from 'openai';
import {
  PROMPT_ENHANCEMENT_COST_MODEL_V1,
  PROMPT_ENHANCEMENT_COST_TIMEOUT_MS_V1,
  PROMPT_ENHANCEMENT_COST_VALIDATION_RETRY_COUNT_V1,
  PROMPT_ENHANCEMENT_SEQUENCE_SUMMARY_OUTPUT_TOKEN_CAP_V1,
} from './cost-observability.js';
import {
  promptEnhancementSequenceTextHasTokenV1,
  type PromptEnhancementSequenceItemV1,
  type PromptEnhancementSequenceRoleLabelV1,
} from './sequence-payload.js';
import type { PromptEnhancementSequencePlannerClientV1 } from './sequence-planner.js';

/**
 * The one line the first popup shows about a planned sequence.
 *
 * A separate call from the planner and from the batch, and it stays separate because it produces
 * something neither of them does: a sentence for the user rather than a plan or a prompt. The
 * planner emits the DATA — how many items, of which kinds, under which role labels — and this turns
 * that into the sentence.
 *
 * The figure in it is the TOTAL, counting the prompt the user is looking at. That is the whole
 * reason this call takes counts rather than the planner's `remainingTaskCount`, which is items
 * AFTER the first: rendered as the total it reports one prompt fewer than the plan holds, and
 * nothing anywhere fails.
 *
 * It re-runs whenever the plan does. A user who presses the button that shrinks a sequence from
 * seven items to four and is still told it is seven has been given a number to trust that the
 * payload behind it already disagrees with.
 */

/** The counts the sentence is built from, taken off the item list rather than asked for. */
export interface PromptEnhancementSequenceSummaryFactsV1 {
  /** Every item, including the first. This is the figure the user is shown. */
  totalPromptCount: number;
  taskCount: number;
  confirmationCount: number;
  wrapUpCount: number;
  /** The distinct role labels the items carry, from the closed vocabulary. */
  taskRoleLabels: readonly PromptEnhancementSequenceRoleLabelV1[];
}

export interface PromptEnhancementSequenceSummaryInputV1 {
  /** Which plan this sentence describes. A sentence for a superseded plan is a wrong number. */
  planGenerationId: string;
  facts: PromptEnhancementSequenceSummaryFactsV1;
  /**
   * The user's own words, so the check can prove none of them reached the sentence.
   *
   * NEVER sent. The call is given counts and labels and nothing else — there is no wording in its
   * input for it to leak, which is what makes the line public-safe by construction rather than by
   * instruction.
   */
  localOriginalText: string;
  deadlineAtMs?: number;
  nowMs?: () => number;
}

export type PromptEnhancementSequenceSummaryFailureReasonV1 =
  | 'no_key'
  | 'provider_error'
  | 'timeout'
  | 'invalid_output'
  | 'summary_deadline_exceeded'
  | 'summary_omits_total'
  | 'summary_carries_original_text';

export type PromptEnhancementSequenceSummaryResultV1 =
  | { ok: true; planGenerationId: string; publicSafeText: string }
  | { ok: false; reason: PromptEnhancementSequenceSummaryFailureReasonV1 };

type SummaryAttemptV1 =
  | { ok: true; publicSafeText: string }
  | { ok: false; reason: PromptEnhancementSequenceSummaryFailureReasonV1 };

/**
 * The counts, read off the list the planner produced.
 *
 * Derived rather than asked for, like the role labels: the list has already answered this, and a
 * second answer is free to disagree with it.
 */
export function promptEnhancementSequenceSummaryFactsV1(
  items: readonly PromptEnhancementSequenceItemV1[],
): PromptEnhancementSequenceSummaryFactsV1 {
  const labels: PromptEnhancementSequenceRoleLabelV1[] = [];
  let taskCount = 0;
  let confirmationCount = 0;
  let wrapUpCount = 0;
  for (const item of items) {
    if (item.itemKind === 'first_task' || item.itemKind === 'task') taskCount += 1;
    else if (item.itemKind === 'wrap_up') wrapUpCount += 1;
    else confirmationCount += 1;
    if (item.roleLabel !== null && !labels.includes(item.roleLabel)) labels.push(item.roleLabel);
  }
  return {
    totalPromptCount: items.length,
    taskCount,
    confirmationCount,
    wrapUpCount,
    taskRoleLabels: labels,
  };
}

const SYSTEM_PROMPT_V1 = `You write ONE sentence for a user who has just been offered a sequence of
prompts instead of a single one. It appears on the popup, before they have accepted anything.

It says two things and nothing else: HOW MANY prompts the whole task is planned as, and the BROAD
SHAPE of them.

  "This task is planned as 7 prompts: 3 sub-task prompts, 3 confirmation/check prompts, and 1 final
   wrap-up prompt."

THE NUMBER IS THE TOTAL, counting the prompt they are looking at right now. Not how many are left.

DO NOT list the upcoming prompts individually, describe what any of them will say, or hint at their
contents. The user has not accepted anything yet, and this line is not a preview of work — it exists
so the shape of what is coming is not a surprise.

You are given counts and role labels. You are not given the request, and you must not guess at it:
no topic, no file names, no paraphrase of what the user asked for.

Plain and calm. No enthusiasm, no reassurance, no selling.

Reply with a single JSON object: { "publicSafeText": "<the sentence>" } and nothing else.`;

function buildSummaryUserMessageV1(facts: PromptEnhancementSequenceSummaryFactsV1): string {
  return [
    `total prompts: ${facts.totalPromptCount}`,
    `sub-task prompts: ${facts.taskCount}`,
    `confirmation/check prompts: ${facts.confirmationCount}`,
    `final wrap-up prompts: ${facts.wrapUpCount}`,
    `broad roles: ${facts.taskRoleLabels.join(', ') || 'none recorded'}`,
  ].join('\n');
}

/**
 * What can be checked about a sentence, which is less than what is instructed about it.
 *
 * The total has to be in it, because a summary whose number disagrees with the plan is the one
 * failure this line cannot survive — its whole job is to be trusted. And none of the user's own
 * words may appear, which is checkable by containment because the call was never given them.
 *
 * NOT checked: whether it lists the prompts individually, whether the tone is plain, whether it
 * hints at contents. Those are judgements and they are instructed.
 */
function checkSummary(
  input: PromptEnhancementSequenceSummaryInputV1,
  publicSafeText: string,
): SummaryAttemptV1 {
  // The number standing on its own. "17" contains "7", so containment would pass a sentence
  // stating a different number of prompts than the plan holds — the one thing this check is for.
  if (!promptEnhancementSequenceTextHasTokenV1(
    publicSafeText,
    String(input.facts.totalPromptCount),
  )) {
    return { ok: false, reason: 'summary_omits_total' };
  }
  const original = input.localOriginalText.trim();
  if (original.length > 0 && publicSafeText.includes(original)) {
    return { ok: false, reason: 'summary_carries_original_text' };
  }
  return { ok: true, publicSafeText };
}

function summaryErrorReason(error: unknown): 'timeout' | 'provider_error' {
  const name = (error as { name?: unknown } | null)?.name;
  if (typeof name === 'string' && /timeout/i.test(name)) return 'timeout';
  return /timed?\s?out/i.test(String(error)) ? 'timeout' : 'provider_error';
}

function isProviderFailure(reason: PromptEnhancementSequenceSummaryFailureReasonV1): boolean {
  return reason === 'provider_error' || reason === 'timeout' || reason === 'no_key';
}

function hasRoomForAnotherCall(input: PromptEnhancementSequenceSummaryInputV1): boolean {
  if (input.deadlineAtMs === undefined) return true;
  return (input.nowMs ?? Date.now)() + PROMPT_ENHANCEMENT_COST_TIMEOUT_MS_V1 <= input.deadlineAtMs;
}

async function attemptSummary(
  openai: PromptEnhancementSequencePlannerClientV1,
  input: PromptEnhancementSequenceSummaryInputV1,
  repairInstruction: string | undefined,
): Promise<SummaryAttemptV1> {
  let raw: string | null | undefined;
  try {
    const response = await openai.chat.completions.create(
      {
        model: PROMPT_ENHANCEMENT_COST_MODEL_V1,
        // One sentence. The cap is small because the output is, and a cap that would fit a
        // paragraph is an invitation to write one.
        max_tokens: PROMPT_ENHANCEMENT_SEQUENCE_SUMMARY_OUTPUT_TOKEN_CAP_V1,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT_V1 },
          { role: 'user', content: buildSummaryUserMessageV1(input.facts) },
          ...(repairInstruction === undefined
            ? []
            : [{ role: 'user' as const, content: repairInstruction }]),
        ],
        response_format: { type: 'json_object' },
      },
      { timeout: PROMPT_ENHANCEMENT_COST_TIMEOUT_MS_V1, maxRetries: 0 },
    );
    raw = response.choices?.[0]?.message?.content;
  } catch (error) {
    return { ok: false, reason: summaryErrorReason(error) };
  }

  if (typeof raw !== 'string' || raw.trim().length === 0) return { ok: false, reason: 'invalid_output' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'invalid_output' };
  }
  if (typeof parsed !== 'object' || parsed === null) return { ok: false, reason: 'invalid_output' };
  const text = (parsed as Record<string, unknown>)['publicSafeText'];
  if (typeof text !== 'string' || text.trim().length === 0) return { ok: false, reason: 'invalid_output' };
  return checkSummary(input, text);
}

/**
 * Write the sentence.
 *
 * Same shape as the other two calls: one attempt, then bounded repair of a sentence that came back
 * wrong, no repair of a provider failure, and no call started that cannot finish before the
 * deadline the caller set.
 */
export async function runPromptEnhancementSequenceSummaryWordingV1(
  input: PromptEnhancementSequenceSummaryInputV1,
  client?: PromptEnhancementSequencePlannerClientV1,
): Promise<PromptEnhancementSequenceSummaryResultV1> {
  let openai: PromptEnhancementSequencePlannerClientV1;
  try {
    openai = client ?? (new OpenAI() as unknown as PromptEnhancementSequencePlannerClientV1);
  } catch {
    return { ok: false, reason: 'no_key' };
  }

  if (!hasRoomForAnotherCall(input)) return { ok: false, reason: 'summary_deadline_exceeded' };

  let repairInstruction: string | undefined;
  for (let repair = 0; ; repair += 1) {
    const attempt = await attemptSummary(openai, input, repairInstruction);
    if (attempt.ok) {
      return {
        ok: true,
        planGenerationId: input.planGenerationId,
        publicSafeText: attempt.publicSafeText,
      };
    }
    if (isProviderFailure(attempt.reason)) return { ok: false, reason: attempt.reason };
    if (repair >= PROMPT_ENHANCEMENT_COST_VALIDATION_RETRY_COUNT_V1 || !hasRoomForAnotherCall(input)) {
      return { ok: false, reason: attempt.reason };
    }
    repairInstruction = [
      'YOUR PREVIOUS SENTENCE WAS NOT ACCEPTED.',
      '',
      `The check that rejected it: ${attempt.reason}.`,
      '',
      `Write it again. The total is ${input.facts.totalPromptCount} and it must appear in the sentence.`,
    ].join('\n');
  }
}

/**
 * May this sentence be shown beside the plan in hand?
 *
 * Only when it was written for that plan. A re-plan changes both things the sentence states, so one
 * written for the plan before it is a wrong count on the single line whose job is to be trusted —
 * and it would disagree with the payload sitting behind it.
 */
export function promptEnhancementSequenceSummaryIsCurrentV1(
  result: PromptEnhancementSequenceSummaryResultV1,
  currentPlanGenerationId: string,
): boolean {
  return result.ok && result.planGenerationId === currentPlanGenerationId;
}

export { PROMPT_ENHANCEMENT_SEQUENCE_SUMMARY_OUTPUT_TOKEN_CAP_V1 } from './cost-observability.js';
