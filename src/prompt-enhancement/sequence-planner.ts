import OpenAI from 'openai';
import {
  PROMPT_ENHANCEMENT_COST_MODEL_V1,
  PROMPT_ENHANCEMENT_COST_TIMEOUT_MS_V1,
  PROMPT_ENHANCEMENT_SEQUENCE_PLANNER_OUTPUT_TOKEN_CAP_V1,
} from './cost-observability.js';
import { buildPromptEnhancementSequencePlannerSystemPromptV1 } from './sequence-planner-prompt.js';
import {
  checkPromptEnhancementSequencePlannerGroupingV1,
  checkPromptEnhancementSequencePlannerOutcomeV1,
  type PromptEnhancementSequencePlannerCheckCodeV1,
  type PromptEnhancementSequencePlannerGroupV1,
  type PromptEnhancementSequencePlannerOutcomeReasonV1,
  type PromptEnhancementSequencePlannerOutcomeV1,
  type PromptEnhancementSequencePlannerPointV1,
  type PromptEnhancementSequencePlannerSummaryDataV1,
} from './sequence-planner-output.js';
import type { PromptEnhancementSequenceOffsetRangeV1 } from './sequence-payload.js';
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

/** An item as the planner emits it: parts and positions, no wording. */
export interface PromptEnhancementSequencePlannerItemV1 {
  itemKind: string;
  originalSliceRef: PromptEnhancementSequenceOffsetRangeV1 | null;
  sourcePointRanges: readonly PromptEnhancementSequenceOffsetRangeV1[];
  roleLabel: string | null;
  dependencyOrder: number;
  complexity: string | null;
  complexityReason: string | null;
  /**
   * The three safety fields are DERIVED from the item's own slice, never asked of the model. The
   * ruling that created them was chosen on "no new classifier"; asking would be exactly that, and
   * would be a second opinion on a question the shipping machinery already answers.
   */
  actionRiskKinds: readonly PromptEnhancementSensitiveActionRiskKind[];
  authorityMode: PromptEnhancementAuthorityMode | null;
  requiresConfirmationFloor: boolean;
  decompositionGroupId: string | null;
}

export interface PromptEnhancementSequencePlannerOutputV1 {
  outcome: PromptEnhancementSequencePlannerOutcomeV1;
  outcomeReason: PromptEnhancementSequencePlannerOutcomeReasonV1 | null;
  /** Working state: checked, then discarded. */
  points: readonly PromptEnhancementSequencePlannerPointV1[];
  groups: readonly PromptEnhancementSequencePlannerGroupV1[];
  items: readonly PromptEnhancementSequencePlannerItemV1[];
  /** Whole-prompt instructions, as offsets — one copy per sequence, applied to every item. */
  promptDirectives: readonly PromptEnhancementSequenceOffsetRangeV1[];
  originalLength: number;
  /** Counts and role labels. The line itself is worded elsewhere. */
  summaryData: PromptEnhancementSequencePlannerSummaryDataV1;
}

export type PromptEnhancementSequencePlannerFailureReasonV1 =
  | 'no_key'
  | 'provider_error'
  | 'timeout'
  | 'invalid_output'
  | PromptEnhancementSequencePlannerCheckCodeV1;

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

function asRange(value: unknown): PromptEnhancementSequenceOffsetRangeV1 | null | 'invalid' {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') return 'invalid';
  const range = value as Record<string, unknown>;
  if (typeof range['start'] !== 'number' || typeof range['end'] !== 'number') return 'invalid';
  return { start: range['start'], end: range['end'] };
}

/** Shape-parse a reply. Meaning is checked by the callers of the check helpers, not here. */
function parsePlannerReply(raw: string): PromptEnhancementSequencePlannerOutputV1 | null {
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
  if (!Array.isArray(reply['points']) || !Array.isArray(reply['groups']) || !Array.isArray(reply['items'])) {
    return null;
  }

  const items: PromptEnhancementSequencePlannerItemV1[] = [];
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
      // Placeholders: whatever the reply says about safety is discarded and re-derived below.
      actionRiskKinds: [],
      authorityMode: null,
      requiresConfirmationFloor: false,
      decompositionGroupId: typeof item['decompositionGroupId'] === 'string'
        ? item['decompositionGroupId']
        : null,
    });
  }

  const summary = reply['summaryData'];
  if (typeof summary !== 'object' || summary === null) return null;
  const summaryData = summary as Record<string, unknown>;
  if (typeof summaryData['summaryId'] !== 'string'
    || typeof summaryData['remainingTaskCount'] !== 'number'
    || !Array.isArray(summaryData['taskRoleLabels'])) {
    return null;
  }

  return {
    outcome: reply['outcome'] as PromptEnhancementSequencePlannerOutcomeV1,
    outcomeReason: (reply['outcomeReason'] ?? null) as PromptEnhancementSequencePlannerOutcomeReasonV1 | null,
    points: reply['points'] as readonly PromptEnhancementSequencePlannerPointV1[],
    groups: reply['groups'] as readonly PromptEnhancementSequencePlannerGroupV1[],
    items,
    promptDirectives,
    originalLength: 0,
    summaryData: {
      summaryId: summaryData['summaryId'],
      remainingTaskCount: summaryData['remainingTaskCount'],
      taskRoleLabels: (summaryData['taskRoleLabels'] as unknown[]).filter(
        (label): label is string => typeof label === 'string',
      ),
    },
  };
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

/** Cut the slice this item points at, or null when it points at none. */
function sliceTextFor(
  ref: PromptEnhancementSequenceOffsetRangeV1 | null,
  localOriginalText: string,
): string | null {
  if (ref === null) return null;
  if (!Number.isSafeInteger(ref.start) || !Number.isSafeInteger(ref.end)) return null;
  if (ref.start < 0 || ref.start >= ref.end || ref.end > localOriginalText.length) return null;
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

  // The working state is checked here and travels no further: whoever consumes the plan gets items,
  // not the inventory they were derived from.
  const grouping = checkPromptEnhancementSequencePlannerGroupingV1(parsed.points, parsed.groups);
  if (!grouping.ok) return { ok: false, reason: grouping.code };

  // Safety is read off the slices, after the shape is known to hold. An offset that does not
  // address the original yields no slice, and therefore no authority and no floor — the same
  // fail-closed answer as an item that carries no slice at all.
  const items = parsed.items.map((item) => ({
    ...item,
    ...deriveItemSafetyFields(sliceTextFor(item.originalSliceRef, input.localOriginalText)),
  }));

  return {
    ok: true,
    output: { ...parsed, items, originalLength: input.localOriginalText.length },
  };
}
