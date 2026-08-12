import OpenAI from 'openai';
import {
  PROMPT_ENHANCEMENT_COST_MODEL_V1,
  PROMPT_ENHANCEMENT_COST_TIMEOUT_MS_V1,
  PROMPT_ENHANCEMENT_COST_VALIDATION_RETRY_COUNT_V1,
  PROMPT_ENHANCEMENT_SEQUENCE_BATCH_OUTPUT_TOKEN_CAP_V1,
  PROMPT_ENHANCEMENT_SEQUENCE_BATCH_OUTPUT_TOKEN_HARD_CAP_V1,
} from './cost-observability.js';

/** The two caps are the shipping ones; re-exported so a reader of this module reaches the same. */
export {
  PROMPT_ENHANCEMENT_SEQUENCE_BATCH_OUTPUT_TOKEN_CAP_V1,
  PROMPT_ENHANCEMENT_SEQUENCE_BATCH_OUTPUT_TOKEN_HARD_CAP_V1,
} from './cost-observability.js';
import { buildPromptEnhancementSequenceBatchSystemPromptV1 } from './sequence-batch-composer-prompt.js';
import {
  promptEnhancementGeneratedEscalatesAuthorityV1,
} from './safety-sendability.js';
import {
  isPromptEnhancementSequenceOffsetRangeV1,
  type PromptEnhancementSequenceItemKindV1,
  type PromptEnhancementSequenceItemV1,
  type PromptEnhancementSequenceOffsetRangeV1,
} from './sequence-payload.js';
import type { PromptEnhancementSequencePlannerClientV1 } from './sequence-planner.js';

/**
 * The up-front batch composer.
 *
 * ONE call over the WHOLE remaining list, not one call per item and not a loop. That is the whole
 * point of composing up front rather than at each Stop: a prompt written without knowing what
 * follows it cannot avoid repeating it, and the seventh prompt is written by something that has
 * already seen the second.
 *
 * It runs in the background while the first popup is open, so the popup never waits on it. Item 1
 * is not part of the batch — it is composed by the ordinary composer before this runs, and arrives
 * here as CONTEXT: what has already been said, so nothing repeats or contradicts it. It is never
 * source material. A later item cut out of the first body inherits the shaping of a body that was
 * written to carry the whole request in one prompt, which is the opposite of a prompt that stands
 * on its own.
 *
 * Nothing here reads or writes storage. The plan is in memory and the wording joins it there; the
 * first write happens when the user sends.
 */

/** What one item needs before it can be worded, resolved from the plan and the local original. */
export interface PromptEnhancementSequenceBatchItemV1 {
  dependencyOrder: number;
  itemKind: PromptEnhancementSequenceItemKindV1;
  /**
   * The user's own words for this item, resolved from its offsets against the LOCAL original.
   *
   * Resolved, never re-derived: the boundary is the planner's decision and recomputing one from the
   * text is a different boundary that happens to look like it. Null on the kinds that carry none.
   */
  sliceText: string | null;
  roleLabel: string | null;
  complexity: string | null;
  /** Why this item is complex, or why THIS confirmation applies — the composer writes from it. */
  complexityReason: string | null;
  authorityMode: string | null;
  requiresConfirmationFloor: boolean;
  /**
   * For the closing recap only: the slices of every task it covers, in order.
   *
   * Read off the earlier task entries rather than stored a second time — the recap's own slice ref
   * is null by design, and storing the same spans twice creates two places they can disagree.
   */
  coveredSliceTexts: readonly string[];
}

export interface PromptEnhancementSequenceBatchInputV1 {
  /**
   * Which plan this batch is for.
   *
   * A re-plan while the batch is running is the ordinary case, not a race: the batch starts when
   * the first popup appears and the buttons that re-plan are on that same popup. What is in flight
   * then is wording for a list that no longer exists, and applying it produces a prompt for work the
   * plan no longer contains — which satisfies every stored invariant while describing the wrong
   * task, so nothing downstream would catch it.
   */
  planGenerationId: string;
  /** Items 2…N, in order. Item 0 is not among them. */
  items: readonly PromptEnhancementSequenceBatchItemV1[];
  /** Item 1's finished body. Context only: what has already been said. */
  firstBodyText: string;
  /** The user's whole-prompt instructions, resolved. They reach every item, in two different ways. */
  promptDirectives: readonly string[];
  /** The request as the user typed it, for the authority check to compare wording against. */
  localOriginalText: string;
  /** When the work this call is part of must be finished, as epoch milliseconds. */
  deadlineAtMs?: number;
  /** How the deadline is read. Present so the check is testable without waiting. */
  nowMs?: () => number;
}

export type PromptEnhancementSequenceBatchFailureReasonV1 =
  | 'no_key'
  | 'provider_error'
  | 'timeout'
  | 'invalid_output'
  | 'batch_deadline_exceeded'
  | 'item_missing_wording'
  | 'item_not_in_plan'
  | 'first_item_must_not_be_worded'
  | 'slice_missing_from_wording'
  | 'covered_slice_missing_from_recap'
  | 'confirmation_carries_original_text'
  | 'confirmation_format_wrong_for_kind'
  | 'confirmation_missing_ground_level_clause'
  | 'confirmation_reproduces_directive_text'
  | 'wording_exceeds_item_authority';

export type PromptEnhancementSequenceBatchResultV1 =
  | { ok: true; planGenerationId: string; wording: ReadonlyMap<number, string> }
  | { ok: false; reason: PromptEnhancementSequenceBatchFailureReasonV1 };

type BatchAttemptV1 =
  | { ok: true; wording: ReadonlyMap<number, string> }
  | { ok: false; reason: PromptEnhancementSequenceBatchFailureReasonV1; dependencyOrder?: number };

const CONFIRMATION_KINDS: readonly PromptEnhancementSequenceItemKindV1[] = [
  'double_confirmation',
  'cross_confirmation',
  'binary_confirmation',
];

/** The format is a total function of the kind: the composer never picks it and never mixes two. */
const FORMAT_TOKENS_V1: Readonly<Record<string, readonly [string, string]>> = {
  double_confirmation: ['PASS', 'FAIL'],
  cross_confirmation: ['PASS', 'FAIL'],
  binary_confirmation: ['YES', 'NO'],
};

/**
 * The clause a confirmation is malformed without.
 *
 * Checking for it is not the text matching this feature bars elsewhere. That prohibition is about
 * deriving a JUDGEMENT from words — whether work is risky, whether a request is complex. This
 * checks that a clause we dictated verbatim is present in output we asked for, which is the same
 * kind of check as "is this value one of the six kinds".
 */
const GROUND_LEVEL_CLAUSE_V1 = 'ground level';

function isConfirmation(kind: PromptEnhancementSequenceItemKindV1): boolean {
  return CONFIRMATION_KINDS.includes(kind);
}

/**
 * Every rule about the batch's output that can be decided by looking rather than judging.
 *
 * What is NOT here, and deliberately: whether a later item is light enough, whether a question is
 * phrased negatively, whether it asks two things at once, whether the tone is firm rather than
 * rude. Those are judgements, they are instructed in the prompt, and a deterministic approximation
 * of them would be worse than none.
 */
function checkBatchOutput(
  input: PromptEnhancementSequenceBatchInputV1,
  wording: ReadonlyMap<number, string>,
): BatchAttemptV1 {
  const planned = new Map(input.items.map((item) => [item.dependencyOrder, item]));

  for (const order of wording.keys()) {
    // Item 0 is already written and is not the batch's to write. Wording for it is a second first
    // body, composed after the popup already had one.
    if (order === 0) return { ok: false, reason: 'first_item_must_not_be_worded', dependencyOrder: 0 };
    if (!planned.has(order)) return { ok: false, reason: 'item_not_in_plan', dependencyOrder: order };
  }

  for (const item of input.items) {
    const text = wording.get(item.dependencyOrder);
    if (text === undefined || text.trim().length === 0) {
      return { ok: false, reason: 'item_missing_wording', dependencyOrder: item.dependencyOrder };
    }

    // A task carries its own slice exactly as the user typed it. Exact containment, not a
    // similarity score: the rule is that the characters are there, unchanged.
    if (item.sliceText !== null && !isConfirmation(item.itemKind)) {
      if (!text.includes(item.sliceText)) {
        return { ok: false, reason: 'slice_missing_from_wording', dependencyOrder: item.dependencyOrder };
      }
    }

    if (item.itemKind === 'wrap_up') {
      for (const covered of item.coveredSliceTexts) {
        if (!text.includes(covered)) {
          return {
            ok: false,
            reason: 'covered_slice_missing_from_recap',
            dependencyOrder: item.dependencyOrder,
          };
        }
      }
    }

    if (isConfirmation(item.itemKind)) {
      // A confirmation carries no original wording at all. Strictly — so any task's slice appearing
      // in one is the failure, not only its own, which it does not have.
      for (const other of input.items) {
        if (other.sliceText !== null && other.sliceText.length > 0 && text.includes(other.sliceText)) {
          return {
            ok: false,
            reason: 'confirmation_carries_original_text',
            dependencyOrder: item.dependencyOrder,
          };
        }
      }
      // On a confirmation a directive constrains what may be asked; it is never reproduced as text.
      for (const directive of input.promptDirectives) {
        if (directive.length > 0 && text.includes(directive)) {
          return {
            ok: false,
            reason: 'confirmation_reproduces_directive_text',
            dependencyOrder: item.dependencyOrder,
          };
        }
      }
      const tokens = FORMAT_TOKENS_V1[item.itemKind];
      const otherTokens = tokens?.[0] === 'YES' ? ['PASS', 'FAIL'] : ['YES', 'NO'];
      if (tokens === undefined
        || !tokens.every((token) => text.includes(token))
        // Mixing two formats in one item leaves the agent choosing which to answer in.
        || otherTokens.some((token) => text.includes(token))) {
        return {
          ok: false,
          reason: 'confirmation_format_wrong_for_kind',
          dependencyOrder: item.dependencyOrder,
        };
      }
      if (!text.toLowerCase().includes(GROUND_LEVEL_CLAUSE_V1)) {
        return {
          ok: false,
          reason: 'confirmation_missing_ground_level_clause',
          dependencyOrder: item.dependencyOrder,
        };
      }
    }

    // The per-item authority check, from the machinery that already ships rather than a second copy
    // of it. The single-prompt validator never sees this wording: a sequence item is a generated
    // body, and without this check a plan-or-review slice could be worded as an instruction to
    // carry the work out with nothing in the system noticing.
    if (item.sliceText !== null
      && promptEnhancementGeneratedEscalatesAuthorityV1(item.sliceText, text)) {
      return { ok: false, reason: 'wording_exceeds_item_authority', dependencyOrder: item.dependencyOrder };
    }
  }

  return { ok: true, wording };
}

/** Resolve an item's slice from the local original. Resolving only — never recomputing a boundary. */
export function promptEnhancementSequenceSliceTextV1(
  ref: PromptEnhancementSequenceOffsetRangeV1 | null,
  localOriginalText: string,
): string | null {
  if (!isPromptEnhancementSequenceOffsetRangeV1(ref, localOriginalText.length)) return null;
  return localOriginalText.slice(ref.start, ref.end);
}

/**
 * The batch's input, built from a plan and the local original.
 *
 * The recap's covered slices are read off the earlier task entries here, which is why the recap
 * needs no slice field of its own.
 */
export function buildPromptEnhancementSequenceBatchItemsV1(
  items: readonly PromptEnhancementSequenceItemV1[],
  localOriginalText: string,
): readonly PromptEnhancementSequenceBatchItemV1[] {
  const taskSlices: string[] = [];
  const batch: PromptEnhancementSequenceBatchItemV1[] = [];
  for (const item of items) {
    const sliceText = promptEnhancementSequenceSliceTextV1(item.originalSliceRef, localOriginalText);
    if (sliceText !== null) taskSlices.push(sliceText);
    // Item 0 is the first body. It is context for the batch and is not written by it.
    if (item.dependencyOrder === 0) continue;
    batch.push({
      dependencyOrder: item.dependencyOrder,
      itemKind: item.itemKind,
      sliceText,
      roleLabel: item.roleLabel,
      complexity: item.complexity,
      complexityReason: item.complexityReason,
      authorityMode: item.authorityMode,
      requiresConfirmationFloor: item.requiresConfirmationFloor,
      // Every task slice up to this point, which for a recap at the end is all of them.
      coveredSliceTexts: item.itemKind === 'wrap_up' ? [...taskSlices] : [],
    });
  }
  return batch;
}

/** The list as the composer is given it: parts and no prose about them. */
function buildBatchUserMessageV1(input: PromptEnhancementSequenceBatchInputV1): string {
  const lines: string[] = [
    'THE FIRST PROMPT, ALREADY WRITTEN. Context only — do not cut later prompts out of it:',
    input.firstBodyText,
    '',
  ];
  if (input.promptDirectives.length > 0) {
    lines.push("THE USER'S WHOLE-PROMPT INSTRUCTIONS. They apply to every item below:");
    for (const directive of input.promptDirectives) lines.push(`  - ${directive}`);
    lines.push('');
  }
  lines.push('THE ITEMS TO WRITE:');
  for (const item of input.items) {
    lines.push(`  [${item.dependencyOrder}] kind: ${item.itemKind}`);
    if (item.roleLabel !== null) lines.push(`      role: ${item.roleLabel}`);
    if (item.complexity !== null) lines.push(`      complexity: ${item.complexity}`);
    if (item.complexityReason !== null) lines.push(`      why: ${item.complexityReason}`);
    if (item.authorityMode !== null) lines.push(`      authority: ${item.authorityMode}`);
    if (item.requiresConfirmationFloor) {
      lines.push('      this item needs a confirmation floor inside its own prompt');
    }
    if (item.sliceText !== null) lines.push(`      slice, verbatim: ${item.sliceText}`);
    for (const covered of item.coveredSliceTexts) {
      lines.push(`      covers, verbatim: ${covered}`);
    }
  }
  return lines.join('\n');
}

function parseBatchReply(raw: string): ReadonlyMap<number, string> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const items = (parsed as Record<string, unknown>)['items'];
  if (!Array.isArray(items)) return null;
  const wording = new Map<number, string>();
  for (const entry of items) {
    if (typeof entry !== 'object' || entry === null) return null;
    const item = entry as Record<string, unknown>;
    if (typeof item['dependencyOrder'] !== 'number' || typeof item['wording'] !== 'string') return null;
    wording.set(item['dependencyOrder'], item['wording']);
  }
  return wording;
}

function batchErrorReason(error: unknown): 'timeout' | 'provider_error' {
  const name = (error as { name?: unknown } | null)?.name;
  if (typeof name === 'string' && /timeout/i.test(name)) return 'timeout';
  return /timed?\s?out/i.test(String(error)) ? 'timeout' : 'provider_error';
}

function isProviderFailure(reason: PromptEnhancementSequenceBatchFailureReasonV1): boolean {
  return reason === 'provider_error' || reason === 'timeout' || reason === 'no_key';
}

function hasRoomForAnotherCall(input: PromptEnhancementSequenceBatchInputV1): boolean {
  if (input.deadlineAtMs === undefined) return true;
  return (input.nowMs ?? Date.now)() + PROMPT_ENHANCEMENT_COST_TIMEOUT_MS_V1 <= input.deadlineAtMs;
}

/** What a rejected batch is told, so the next attempt corrects one item rather than starting over. */
export function buildPromptEnhancementSequenceBatchRepairInstructionV1(
  reason: string,
  dependencyOrder: number | undefined,
): string {
  const where = dependencyOrder === undefined
    ? 'The reply as a whole was rejected.'
    : `Item ${dependencyOrder} was rejected.`;
  return [
    'YOUR PREVIOUS REPLY WAS NOT ACCEPTED.',
    '',
    `${where} The check that rejected it: ${reason}.`,
    '',
    'Return every item again with that one corrected, and the others exactly as you wrote them.',
  ].join('\n');
}

async function attemptBatch(
  openai: PromptEnhancementSequencePlannerClientV1,
  input: PromptEnhancementSequenceBatchInputV1,
  repairInstruction: string | undefined,
  maxTokens: number,
): Promise<BatchAttemptV1> {
  let raw: string | null | undefined;
  try {
    const response = await openai.chat.completions.create(
      {
        model: PROMPT_ENHANCEMENT_COST_MODEL_V1,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: buildPromptEnhancementSequenceBatchSystemPromptV1() },
          { role: 'user', content: buildBatchUserMessageV1(input) },
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
    return { ok: false, reason: batchErrorReason(error) };
  }

  if (typeof raw !== 'string' || raw.trim().length === 0) return { ok: false, reason: 'invalid_output' };
  const wording = parseBatchReply(raw);
  // A batch cut off mid-JSON is invalid rather than degraded: an item whose wording ran out of
  // tokens is a broken sequence, not a shorter one.
  if (wording === null) return { ok: false, reason: 'invalid_output' };
  return checkBatchOutput(input, wording);
}

/**
 * Run the batch.
 *
 * One call for the whole remaining list, then up to three repairs of a reply that came back wrong.
 * A provider failure is not repaired — nothing arrived to correct. Repair happens before the user
 * has accepted anything; once a sequence is active an item is never regenerated at all.
 */
export async function runPromptEnhancementSequenceBatchV1(
  input: PromptEnhancementSequenceBatchInputV1,
  client?: PromptEnhancementSequencePlannerClientV1,
  maxTokens = PROMPT_ENHANCEMENT_SEQUENCE_BATCH_OUTPUT_TOKEN_CAP_V1,
): Promise<PromptEnhancementSequenceBatchResultV1> {
  let openai: PromptEnhancementSequencePlannerClientV1;
  try {
    openai = client ?? (new OpenAI() as unknown as PromptEnhancementSequencePlannerClientV1);
  } catch {
    return { ok: false, reason: 'no_key' };
  }

  if (!hasRoomForAnotherCall(input)) return { ok: false, reason: 'batch_deadline_exceeded' };

  let repairInstruction: string | undefined;
  for (let repair = 0; ; repair += 1) {
    const attempt = await attemptBatch(
      openai,
      input,
      repairInstruction,
      // A repair asks at the hard cap: one reason a batch comes back unusable is that it did not
      // fit, and every remaining prompt in one reply is the largest thing this feature produces.
      repair === 0 ? maxTokens : PROMPT_ENHANCEMENT_SEQUENCE_BATCH_OUTPUT_TOKEN_HARD_CAP_V1,
    );
    if (attempt.ok) return { ok: true, planGenerationId: input.planGenerationId, wording: attempt.wording };
    if (isProviderFailure(attempt.reason)) return { ok: false, reason: attempt.reason };
    if (repair >= PROMPT_ENHANCEMENT_COST_VALIDATION_RETRY_COUNT_V1 || !hasRoomForAnotherCall(input)) {
      return { ok: false, reason: attempt.reason };
    }
    repairInstruction = buildPromptEnhancementSequenceBatchRepairInstructionV1(
      attempt.reason,
      attempt.dependencyOrder,
    );
  }
}

/**
 * May this batch result be applied to the plan in hand?
 *
 * Only when it was composed for that plan. A re-plan while the batch runs is the ordinary case, and
 * the result then in flight is wording for a list that no longer exists — applied, it produces a
 * prompt for work the plan no longer contains, which passes every stored invariant while describing
 * the wrong task.
 */
export function promptEnhancementSequenceBatchIsCurrentV1(
  result: PromptEnhancementSequenceBatchResultV1,
  currentPlanGenerationId: string,
): boolean {
  return result.ok && result.planGenerationId === currentPlanGenerationId;
}
