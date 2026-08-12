import OpenAI from 'openai';
import type { Database } from 'sql.js';
import {
  PROMPT_ENHANCEMENT_COST_MODEL_V1,
  PROMPT_ENHANCEMENT_COST_TIMEOUT_MS_V1,
  PROMPT_ENHANCEMENT_SEQUENCE_PLANNER_OUTPUT_TOKEN_CAP_V1,
} from './cost-observability.js';
import { buildPromptEnhancementSequencePlannerSystemPromptV1 } from './sequence-planner-prompt.js';
import {
  promptEnhancementSequencePlannerMayRunForProjectV1,
  promptEnhancementSequencePolicyForOutcomeV1,
  type PromptEnhancementSequencePlannerEntryRequestV1,
  type PromptEnhancementSequencePlannerRefusalV1,
} from './sequence-planner-entry.js';
import {
  checkPromptEnhancementSequencePlannerBoundsV1,
  checkPromptEnhancementSequencePlannerGroupingV1,
  checkPromptEnhancementSequencePlannerOutcomeV1,
  type PromptEnhancementSequencePlannerCheckCodeV1,
  type PromptEnhancementSequencePlannerGroupV1,
  type PromptEnhancementSequencePlannerOutcomeReasonV1,
  type PromptEnhancementSequencePlannerOutcomeV1,
  type PromptEnhancementSequencePlannerPointV1,
  type PromptEnhancementSequencePlannerSummaryDataV1,
  type PromptEnhancementSequencePointKindV1,
} from './sequence-planner-output.js';
import {
  isPromptEnhancementSequenceOffsetRangeV1,
  validatePromptEnhancementSequenceItemListV1,
  type PromptEnhancementSequenceItemV1,
  type PromptEnhancementSequenceNextPromptPolicyV1,
  type PromptEnhancementSequenceOffsetRangeV1,
  type PromptEnhancementSequencePayloadReasonCodeV1,
  type PromptEnhancementSequenceRoleLabelV1,
} from './sequence-payload.js';
import {
  promptEnhancementAuthorityModeForTextV1,
  promptEnhancementRiskKindsForTextV1,
  type PromptEnhancementAuthorityMode,
  type PromptEnhancementSensitiveActionRiskKind,
} from './safety-sendability.js';

/**
 * The sequence planner call.
 *
 * One model call, three stages inside it — inventory the points, group them, slice the groups — and
 * it runs BEFORE the first body is composed, because whether a sequence is worth offering depends
 * on what the body would otherwise have to carry. Planning after composing would mean composing
 * twice.
 *
 * It plans and does not word: every item comes back with its parts and no text. The wording is a
 * separate call, so a planner that returned prose would either be discarded or mistaken for a
 * slice.
 *
 * Failure is typed and never thrown. A request with no key was never a call at all; a provider
 * error or a reply that does not parse is a real failure, and the caller distinguishes them
 * because "we never asked" and "we asked and it broke" are different things to report.
 */

export interface PromptEnhancementSequencePlannerClientV1 {
  chat: {
    completions: {
      create: (
        body: {
          model: string;
          max_tokens: number;
          messages: readonly { role: 'system' | 'user'; content: string }[];
          response_format?: { type: 'json_object' };
        },
        options?: { timeout?: number; maxRetries?: number },
      ) => Promise<{ choices?: readonly { message?: { content?: string | null } }[] }>;
    };
  };
}

/**
 * An item on its way to being one, before anything has been checked.
 *
 * The fields are loosely typed on purpose: a kind, a role or a verdict arriving as some other
 * string is the ordinary case this call exists to catch, and typing it as the real value up front
 * would only be asserting what has not been established. The draft becomes the real shape by
 * passing the item-list check, which is what earns the narrowing.
 */
interface PlannedItemDraftV1 {
  itemKind: string;
  originalSliceRef: PromptEnhancementSequenceOffsetRangeV1 | null;
  sourcePointRanges: readonly PromptEnhancementSequenceOffsetRangeV1[];
  roleLabel: string | null;
  dependencyOrder: number;
  complexity: string | null;
  complexityReason: string | null;
  /** Never written here. Carried so a reply that words an item is refused, not silently stripped. */
  generatedWording: string | null;
  /**
   * The three safety fields are DERIVED from the item's own slice, never asked of the model. The
   * ruling that created them was chosen on "no new classifier"; asking would be exactly that, and
   * would be a second opinion on a question the shipping machinery already answers.
   */
  actionRiskKinds: readonly PromptEnhancementSensitiveActionRiskKind[];
  authorityMode: PromptEnhancementAuthorityMode | null;
  requiresConfirmationFloor: boolean;
  decompositionGroupId: string | null;
  /** The verdict is produced when the wording is, and there is none yet. */
  itemValidationGraph: null;
}

/**
 * What the planner returns.
 *
 * The point inventory and the grouping are NOT here. Both are working state: they exist so the
 * slicing has something to be checked against, they are checked on the way through, and they die
 * with the call. What survives of the grouping is one id per item — enough to rebuild the grouping
 * the planner actually decided, which a served item alone cannot do.
 */
export interface PromptEnhancementSequencePlannerOutputV1 {
  outcome: PromptEnhancementSequencePlannerOutcomeV1;
  outcomeReason: PromptEnhancementSequencePlannerOutcomeReasonV1 | null;
  items: readonly PromptEnhancementSequenceItemV1[];
  /** Whole-prompt instructions, as offsets — one copy per sequence, applied to every item. */
  promptDirectives: readonly PromptEnhancementSequenceOffsetRangeV1[];
  originalLength: number;
  /**
   * Whether text exists ahead of the user accepting anything. Only a planned sequence has any, so
   * only a sequence moves off the default — declaring otherwise on a list with no items would claim
   * a state the row is not in.
   */
  suggestedNextPromptPolicy: PromptEnhancementSequenceNextPromptPolicyV1;
  /** Counts and role labels. The line itself is worded elsewhere. */
  summaryData: PromptEnhancementSequencePlannerSummaryDataV1;
}

export type PromptEnhancementSequencePlannerFailureReasonV1 =
  | 'no_key'
  | 'provider_error'
  | 'timeout'
  | 'invalid_output'
  | PromptEnhancementSequencePlannerRefusalV1
  | PromptEnhancementSequencePlannerCheckCodeV1
  | PromptEnhancementSequencePayloadReasonCodeV1;

export type PromptEnhancementSequencePlannerResultV1 =
  | { ok: true; output: PromptEnhancementSequencePlannerOutputV1 }
  | { ok: false; reason: PromptEnhancementSequencePlannerFailureReasonV1 };

export interface PromptEnhancementSequencePlannerInputV1 {
  /**
   * What the planner is allowed to SEE. Bounded and redaction-safe by the time it arrives; this is
   * the only value that reaches the provider.
   */
  promptContext: string;
  /**
   * The LOCAL original the returned positions address, and the text slices are cut from.
   *
   * NEVER sent. It exists here because the returned offsets are meaningless without the string
   * they index, and because the safety fields are read off the slice rather than off the reply —
   * which is also why a redaction marker can never travel into wording shown under a promise that
   * the user's own words appear exactly.
   */
  localOriginalText: string;
  /**
   * Whether this prompt may be planned at all. Required rather than optional: every condition on it
   * is a refusal, and an entry check that can be omitted is one that will be.
   *
   * The config gate is not on it. That value has one legitimate source and the planner reads it
   * from there itself.
   */
  entry: PromptEnhancementSequencePlannerEntryRequestV1;
  /** Where the config gate is resolved from. */
  db: Database;
  /** Scopes that resolution: a project's own setting overrules the global one. */
  projectRoot?: string;
}

/**
 * Classify a thrown provider error. The SDK raises a named timeout error on the per-call option;
 * match the name first so an injected non-SDK client behaves the same way.
 */
function plannerErrorReason(error: unknown): 'timeout' | 'provider_error' {
  const name = (error as { name?: unknown } | null)?.name;
  if (typeof name === 'string' && /timeout/i.test(name)) return 'timeout';
  return /timed?\s?out/i.test(String(error)) ? 'timeout' : 'provider_error';
}

function asRangeList(value: unknown): readonly PromptEnhancementSequenceOffsetRangeV1[] | null {
  if (!Array.isArray(value)) return null;
  const ranges: PromptEnhancementSequenceOffsetRangeV1[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) return null;
    const range = entry as Record<string, unknown>;
    if (typeof range['start'] !== 'number' || typeof range['end'] !== 'number') return null;
    ranges.push({ start: range['start'], end: range['end'] });
  }
  return ranges;
}

/**
 * The point inventory, shape-only.
 *
 * Checked entry by entry rather than cast, for the same reason the items are: `json_object` mode
 * guarantees the reply is JSON, never that it holds the shape asked for, and a `null` where an
 * entry was dropped is an ordinary way for a partial generation to come back. Cast instead, it
 * reaches a check that reads a field off it and throws — past every typed refusal a caller is
 * written against.
 */
function asPointList(value: unknown): readonly PromptEnhancementSequencePlannerPointV1[] | null {
  if (!Array.isArray(value)) return null;
  const points: PromptEnhancementSequencePlannerPointV1[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) return null;
    const point = entry as Record<string, unknown>;
    if (typeof point['pointId'] !== 'string'
      || typeof point['startOffset'] !== 'number'
      || typeof point['endOffset'] !== 'number'
      // Shape only: that the kind is one of the six is meaning, and is checked with the rest of it.
      || typeof point['requiredKind'] !== 'string') {
      return null;
    }
    points.push({
      pointId: point['pointId'],
      startOffset: point['startOffset'],
      endOffset: point['endOffset'],
      requiredKind: point['requiredKind'] as PromptEnhancementSequencePointKindV1,
    });
  }
  return points;
}

/** The grouping, shape-only. Same reasoning as the inventory above. */
function asGroupList(value: unknown): readonly PromptEnhancementSequencePlannerGroupV1[] | null {
  if (!Array.isArray(value)) return null;
  const groups: PromptEnhancementSequencePlannerGroupV1[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) return null;
    const group = entry as Record<string, unknown>;
    if (typeof group['groupId'] !== 'string'
      || !Array.isArray(group['pointIds'])
      || (group['pointIds'] as unknown[]).some((id) => typeof id !== 'string')
      // Required rather than defaulted: a group that stays in the body is a decision, and reading
      // its absence as "becomes an item" would take that decision on the planner's behalf.
      || typeof group['canRemainOneBodySection'] !== 'boolean') {
      return null;
    }
    groups.push({
      groupId: group['groupId'],
      pointIds: group['pointIds'] as readonly string[],
      canRemainOneBodySection: group['canRemainOneBodySection'],
    });
  }
  return groups;
}

function asRange(value: unknown): PromptEnhancementSequenceOffsetRangeV1 | null | 'invalid' {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') return 'invalid';
  const range = value as Record<string, unknown>;
  if (typeof range['start'] !== 'number' || typeof range['end'] !== 'number') return 'invalid';
  return { start: range['start'], end: range['end'] };
}

/**
 * A reply as it arrives: shape-parsed only.
 *
 * Held separately from the output because the working state is on it and is not on the output, and
 * because its items are drafts — everything about their meaning is still unchecked at this point.
 */
interface ParsedPlannerReplyV1 {
  outcome: PromptEnhancementSequencePlannerOutcomeV1;
  outcomeReason: PromptEnhancementSequencePlannerOutcomeReasonV1 | null;
  points: readonly PromptEnhancementSequencePlannerPointV1[];
  groups: readonly PromptEnhancementSequencePlannerGroupV1[];
  items: readonly PlannedItemDraftV1[];
  promptDirectives: readonly PromptEnhancementSequenceOffsetRangeV1[];
  summaryId: string;
  remainingTaskCount: number;
}

/** Shape-parse a reply. Meaning is checked by the callers of the check helpers, not here. */
function parsePlannerReply(raw: string): ParsedPlannerReplyV1 | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const reply = parsed as Record<string, unknown>;

  const promptDirectives = asRangeList(reply['promptDirectives'] ?? []);
  if (promptDirectives === null) return null;
  const points = asPointList(reply['points']);
  const groups = asGroupList(reply['groups']);
  if (points === null || groups === null || !Array.isArray(reply['items'])) return null;

  const items: PlannedItemDraftV1[] = [];
  for (const entry of reply['items'] as unknown[]) {
    if (typeof entry !== 'object' || entry === null) return null;
    const item = entry as Record<string, unknown>;
    const sliceRef = asRange(item['originalSliceRef']);
    if (sliceRef === 'invalid') return null;
    const pointRanges = asRangeList(item['sourcePointRanges'] ?? []);
    if (pointRanges === null) return null;
    if (typeof item['itemKind'] !== 'string' || typeof item['dependencyOrder'] !== 'number') return null;
    items.push({
      itemKind: item['itemKind'],
      originalSliceRef: sliceRef,
      sourcePointRanges: pointRanges,
      roleLabel: typeof item['roleLabel'] === 'string' ? item['roleLabel'] : null,
      dependencyOrder: item['dependencyOrder'],
      complexity: typeof item['complexity'] === 'string' ? item['complexity'] : null,
      complexityReason: typeof item['complexityReason'] === 'string' ? item['complexityReason'] : null,
      // Carried through as it arrived, so wording the planner was told not to write is REFUSED
      // rather than dropped here: dropping it would let a plan that broke the rule look like one
      // that kept it.
      generatedWording: typeof item['generatedWording'] === 'string' ? item['generatedWording'] : null,
      // Placeholders: whatever the reply says about safety is discarded and re-derived below.
      actionRiskKinds: [],
      authorityMode: null,
      requiresConfirmationFloor: false,
      decompositionGroupId: typeof item['decompositionGroupId'] === 'string'
        ? item['decompositionGroupId']
        : null,
      itemValidationGraph: null,
    });
  }

  // No `taskRoleLabels` here. They are the set of the labels the items already carry, so they are
  // read off the list rather than asked for — asked for, they are a second answer to a question the
  // list has already answered, and free to disagree with it.
  const summary = reply['summaryData'];
  if (typeof summary !== 'object' || summary === null) return null;
  const summaryData = summary as Record<string, unknown>;
  if (typeof summaryData['summaryId'] !== 'string'
    || typeof summaryData['remainingTaskCount'] !== 'number') {
    return null;
  }

  return {
    outcome: reply['outcome'] as PromptEnhancementSequencePlannerOutcomeV1,
    outcomeReason: (reply['outcomeReason'] ?? null) as PromptEnhancementSequencePlannerOutcomeReasonV1 | null,
    points,
    groups,
    items,
    promptDirectives,
    summaryId: summaryData['summaryId'],
    remainingTaskCount: summaryData['remainingTaskCount'],
  };
}

/**
 * The role labels the summary reports: the distinct labels the items carry, in the order they first
 * appear.
 *
 * Order is stable rather than incidental so the same plan produces the same summary data twice.
 */
function taskRoleLabelsFor(
  items: readonly PromptEnhancementSequenceItemV1[],
): readonly PromptEnhancementSequenceRoleLabelV1[] {
  const labels: PromptEnhancementSequenceRoleLabelV1[] = [];
  for (const item of items) {
    if (item.roleLabel !== null && !labels.includes(item.roleLabel)) labels.push(item.roleLabel);
  }
  return labels;
}

/**
 * Read the three safety fields off the item's own slice.
 *
 * Not from the reply, and not by a second classifier: the ruling that created these fields was
 * taken on the basis that they come from machinery that already ships, so asking the model would
 * be the new classifier that ruling avoided — and a second opinion that can disagree with the one
 * the user is actually shown.
 *
 * The risk families are a SET, matching what the classifier produces and what the confirmation
 * sentence already names. An item that cannot be split can genuinely carry several, and a single
 * value would drop the rest without recording that it had.
 *
 * The floor carries the RISKY half only. Whether the work is also irreversible is judged later,
 * from the item's content, by whatever writes its wording — never from a table over these families,
 * which would be a keyword list wearing an enum.
 */
function deriveItemSafetyFields(sliceText: string | null): {
  actionRiskKinds: readonly PromptEnhancementSensitiveActionRiskKind[];
  authorityMode: PromptEnhancementAuthorityMode | null;
  requiresConfirmationFloor: boolean;
} {
  // The kinds that carry no slice carry no authority of their own to exceed, and no floor.
  if (sliceText === null) {
    return { actionRiskKinds: [], authorityMode: null, requiresConfirmationFloor: false };
  }
  const actionRiskKinds = promptEnhancementRiskKindsForTextV1(sliceText);
  return {
    actionRiskKinds,
    authorityMode: promptEnhancementAuthorityModeForTextV1(sliceText),
    requiresConfirmationFloor: actionRiskKinds.length > 0,
  };
}

/**
 * Cut the slice this item points at, or null when it points at none.
 *
 * An offset that does not address the original also yields null. The item-list check rejects such a
 * plan a moment later, so this is the answer for the moment in between — and it is the fail-closed
 * one rather than a slice of whatever happened to be at those positions.
 */
function sliceTextFor(
  ref: PromptEnhancementSequenceOffsetRangeV1 | null,
  localOriginalText: string,
): string | null {
  if (!isPromptEnhancementSequenceOffsetRangeV1(ref, localOriginalText.length)) return null;
  return localOriginalText.slice(ref.start, ref.end);
}

/**
 * Run the planner.
 *
 * One call per candidate prompt. A thrown provider error is NOT retried here — a slow retry in
 * front of a waiting user buys less than a fast, typed refusal, and the repair loop for a reply
 * that arrives but does not hold together is specified separately from this call.
 */
export async function runPromptEnhancementSequencePlannerV1(
  input: PromptEnhancementSequencePlannerInputV1,
  client?: PromptEnhancementSequencePlannerClientV1,
): Promise<PromptEnhancementSequencePlannerResultV1> {
  // Before anything is spent. Every one of these is a refusal, and the config gate in particular is
  // silent by contract — an off gate produces no plan and no explanation of why.
  const entry = promptEnhancementSequencePlannerMayRunForProjectV1(
    input.db,
    input.projectRoot,
    input.entry,
  );
  if (!entry.mayRun) return { ok: false, reason: entry.refusal };

  let openai: PromptEnhancementSequencePlannerClientV1;
  try {
    // With no injected client and no key this throws, which is a call that never happened.
    openai = client ?? (new OpenAI() as unknown as PromptEnhancementSequencePlannerClientV1);
  } catch {
    return { ok: false, reason: 'no_key' };
  }

  let raw: string | null | undefined;
  try {
    const response = await openai.chat.completions.create(
      {
        model: PROMPT_ENHANCEMENT_COST_MODEL_V1,
        // The planner's own budget: the reasons per item are what cost the tokens and they are
        // exactly what must not be dropped to fit.
        max_tokens: PROMPT_ENHANCEMENT_SEQUENCE_PLANNER_OUTPUT_TOKEN_CAP_V1,
        messages: [
          { role: 'system', content: buildPromptEnhancementSequencePlannerSystemPromptV1() },
          { role: 'user', content: input.promptContext },
        ],
        response_format: { type: 'json_object' },
      },
      // maxRetries: 0 — the SDK's own retries would multiply any wait in front of the user.
      { timeout: PROMPT_ENHANCEMENT_COST_TIMEOUT_MS_V1, maxRetries: 0 },
    );
    raw = response.choices?.[0]?.message?.content;
  } catch (error) {
    return { ok: false, reason: plannerErrorReason(error) };
  }

  if (typeof raw !== 'string' || raw.trim().length === 0) return { ok: false, reason: 'invalid_output' };
  const parsed = parsePlannerReply(raw);
  if (!parsed) return { ok: false, reason: 'invalid_output' };

  const outcome = checkPromptEnhancementSequencePlannerOutcomeV1(parsed.outcome, parsed.outcomeReason);
  if (!outcome.ok) return { ok: false, reason: outcome.code };

  const originalLength = input.localOriginalText.length;

  // Two of the three outcomes are decisions NOT to make a sequence, and they are ordinary answers
  // rather than failures. Nothing below applies to them: there is no list to bound, no grouping
  // that has to have done anything, and no summary, since a popup with no sequence shows none.
  if (parsed.outcome !== 'sequence') {
    return {
      ok: true,
      output: {
        outcome: parsed.outcome,
        outcomeReason: parsed.outcomeReason,
        items: [],
        promptDirectives: [],
        originalLength,
        suggestedNextPromptPolicy: promptEnhancementSequencePolicyForOutcomeV1(parsed.outcome),
        summaryData: { summaryId: parsed.summaryId, remainingTaskCount: 0, taskRoleLabels: [] },
      },
    };
  }

  // The working state is checked here and travels no further: it is not on the output, so whoever
  // consumes the plan gets items and not the inventory they were derived from.
  const grouping = checkPromptEnhancementSequencePlannerGroupingV1(
    parsed.points,
    parsed.groups,
    parsed.items.map((item) => item.decompositionGroupId),
  );
  if (!grouping.ok) return { ok: false, reason: grouping.code };

  const bounds = checkPromptEnhancementSequencePlannerBoundsV1({
    itemCount: parsed.items.length,
    summaryRemainingTaskCount: parsed.remainingTaskCount,
  });
  if (!bounds.ok) return { ok: false, reason: bounds.code };

  // Safety is read off the slices before the list is checked, because the list check reads those
  // fields: an item's authority has to be on it by the time the rule that an item with a slice
  // carries one is applied to it.
  const drafts = parsed.items.map((item) => ({
    ...item,
    ...deriveItemSafetyFields(sliceTextFor(item.originalSliceRef, input.localOriginalText)),
  }));

  // Every rule about the list itself — the six kinds, the closed role vocabulary, position, the
  // offsets, the recap, and the confirmations each verdict earns. It is the same check the store
  // applies, at the stage before wording exists, so a plan cannot pass here and fail there.
  const structure = validatePromptEnhancementSequenceItemListV1(drafts, {
    originalLength,
    stage: 'plan',
  });
  if (!structure.ok) return { ok: false, reason: structure.reasonCode };
  if (parsed.promptDirectives.some(
    (range) => !isPromptEnhancementSequenceOffsetRangeV1(range, originalLength),
  )) {
    return { ok: false, reason: 'prompt_directives_invalid' };
  }

  // The check above established every field, which is what the narrowing rests on.
  const items = drafts as unknown as readonly PromptEnhancementSequenceItemV1[];
  return {
    ok: true,
    output: {
      outcome: parsed.outcome,
      outcomeReason: parsed.outcomeReason,
      items,
      promptDirectives: parsed.promptDirectives,
      originalLength,
      suggestedNextPromptPolicy: promptEnhancementSequencePolicyForOutcomeV1(parsed.outcome),
      summaryData: {
        summaryId: parsed.summaryId,
        remainingTaskCount: parsed.remainingTaskCount,
        taskRoleLabels: taskRoleLabelsFor(items),
      },
    },
  };
}
