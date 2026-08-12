import {
  PROMPT_ENHANCEMENT_SEQUENCE_MAX_ITEM_COUNT_V1,
  PROMPT_ENHANCEMENT_SEQUENCE_MIN_ITEM_COUNT_V1,
} from './sequence-runtime.js';

/**
 * The planner's structured output, and the checks that can honestly be run over it.
 *
 * Two of the three stages produce working state rather than product: the point inventory and the
 * grouping exist so the slicing has something to be checked against, and both are discarded once
 * the plan is validated. Only one id per item survives, because a continuation payload has to be
 * able to rebuild the grouping the planner actually decided and cannot do that from a served item.
 *
 * The checks below are set arithmetic, reference lookups and counts. Whether a grouping is SENSIBLE
 * is not among them and is not going to be: a deterministic layer belongs where it is realistic and
 * dependable, and never where it would be text matching or a score standing in for judgement.
 */

export type PromptEnhancementSequencePlannerOutcomeV1 =
  | 'sequence'
  | 'single_with_confirmation'
  | 'single_plain';

export type PromptEnhancementSequencePlannerOutcomeReasonV1 =
  | 'too_vague'
  | 'unsafe'
  | 'not_big_enough';

/**
 * What counts as a point, and it is defined rather than left to judgement.
 *
 * The list exists because "what did the user ask for" reads as a list of deliverables, and the
 * inventory's whole purpose is that the other five are findable too — a constraint buried mid
 * prompt has nothing to be checked against unless it was recorded as a point in its own right, and
 * once it is missing no later check can tell whether it was covered or lost.
 */
export const PROMPT_ENHANCEMENT_SEQUENCE_POINT_KINDS_V1 = [
  'deliverable',
  'constraint',
  'non_goal',
  'order_or_dependency',
  'verification_expectation',
  'confirmation_requirement',
] as const;
export type PromptEnhancementSequencePointKindV1 =
  typeof PROMPT_ENHANCEMENT_SEQUENCE_POINT_KINDS_V1[number];

/** A point the planner found in the request, addressed by offsets into the original. */
export interface PromptEnhancementSequencePlannerPointV1 {
  pointId: string;
  startOffset: number;
  endOffset: number;
  requiredKind: PromptEnhancementSequencePointKindV1;
}

/** A grouping decision. The array is emitted so it can be checked, and is then discarded. */
export interface PromptEnhancementSequencePlannerGroupV1 {
  groupId: string;
  pointIds: readonly string[];
  /** A group may stay in the current body instead of becoming a slice of its own. */
  canRemainOneBodySection: boolean;
}

export interface PromptEnhancementSequencePlannerSummaryDataV1 {
  summaryId: string;
  /**
   * Items after the first. NOT the figure the summary shows — the user-facing total is the whole
   * item count, and rendering this one would report a prompt fewer than the plan.
   */
  remainingTaskCount: number;
  taskRoleLabels: readonly string[];
}

export type PromptEnhancementSequencePlannerCheckCodeV1 =
  | 'outcome_invalid'
  | 'outcome_reason_disagrees_with_outcome'
  | 'points_not_array'
  | 'groups_not_array'
  | 'point_not_object'
  | 'group_not_object'
  | 'point_id_duplicated'
  | 'point_required_kind_invalid'
  | 'point_in_no_group'
  | 'point_in_more_than_one_group'
  | 'group_empty'
  | 'group_references_unknown_point'
  | 'item_references_unknown_group'
  | 'grouping_stage_did_nothing'
  | 'item_count_below_min'
  | 'item_count_over_max'
  | 'summary_remaining_count_disagrees_with_items';

export type PromptEnhancementSequencePlannerCheckResultV1 =
  | { ok: true }
  | { ok: false; code: PromptEnhancementSequencePlannerCheckCodeV1 };

const fail = (
  code: PromptEnhancementSequencePlannerCheckCodeV1,
): PromptEnhancementSequencePlannerCheckResultV1 => ({ ok: false, code });

/**
 * The outcome and its reason are one decision recorded in two fields, so they have to agree: a
 * planned sequence has nothing to explain, and a refusal that explains nothing is not a refusal
 * anyone can act on.
 */
export function checkPromptEnhancementSequencePlannerOutcomeV1(
  outcome: unknown,
  outcomeReason: unknown,
): PromptEnhancementSequencePlannerCheckResultV1 {
  const outcomes: readonly string[] = ['sequence', 'single_with_confirmation', 'single_plain'];
  if (typeof outcome !== 'string' || !outcomes.includes(outcome)) return fail('outcome_invalid');
  const reasons: readonly string[] = ['too_vague', 'unsafe', 'not_big_enough'];
  if (outcome === 'sequence') {
    return outcomeReason === null ? { ok: true } : fail('outcome_reason_disagrees_with_outcome');
  }
  return typeof outcomeReason === 'string' && reasons.includes(outcomeReason)
    ? { ok: true }
    : fail('outcome_reason_disagrees_with_outcome');
}

/**
 * Every point lands in exactly one group, every group is non-empty and references points that
 * exist, every item names a group that exists, and the grouping stage actually did something.
 *
 * That last one is the check that earns the group array. One slice per bullet — the failure the
 * grouping stage exists to prevent — shows up as exactly this equality, and without the array a
 * four-item sequence from a four-bullet request is indistinguishable from a correctly grouped one.
 */
export function checkPromptEnhancementSequencePlannerGroupingV1(
  points: readonly PromptEnhancementSequencePlannerPointV1[],
  groups: readonly PromptEnhancementSequencePlannerGroupV1[],
  itemGroupIds: readonly (string | null)[] = [],
): PromptEnhancementSequencePlannerCheckResultV1 {
  if (!Array.isArray(points)) return fail('points_not_array');
  if (!Array.isArray(groups)) return fail('groups_not_array');

  const pointIds = new Set<string>();
  for (const point of points) {
    // An entry that is not an object at all. Reading a field off it would throw, and this function
    // is reached from a reply, where a dropped entry arriving as `null` is ordinary.
    if (typeof point !== 'object' || point === null) return fail('point_not_object');
    if (pointIds.has(point.pointId)) return fail('point_id_duplicated');
    if (!(PROMPT_ENHANCEMENT_SEQUENCE_POINT_KINDS_V1 as readonly string[])
      .includes(point.requiredKind)) {
      return fail('point_required_kind_invalid');
    }
    pointIds.add(point.pointId);
  }

  const placement = new Map<string, number>();
  for (const group of groups) {
    if (typeof group !== 'object' || group === null) return fail('group_not_object');
    if (!Array.isArray(group.pointIds) || group.pointIds.length === 0) return fail('group_empty');
    for (const pointId of group.pointIds) {
      if (!pointIds.has(pointId)) return fail('group_references_unknown_point');
      const seen = placement.get(pointId) ?? 0;
      if (seen > 0) return fail('point_in_more_than_one_group');
      placement.set(pointId, seen + 1);
    }
  }
  for (const pointId of pointIds) {
    if (!placement.has(pointId)) return fail('point_in_no_group');
  }

  // Each item keeps one group id, and it is the only trace of the grouping that survives the call:
  // the array itself is working state. So an id naming no emitted group cannot be caught later —
  // by then there is nothing left to compare it against, and a payload that was meant to be able
  // to rebuild the grouping the planner decided rebuilds nothing.
  //
  // Only this direction. A group that becomes no item is the ordinary case of a group that stayed
  // in the current body, which is how a request with many small bullets becomes two prompts rather
  // than ten — requiring every group to be referenced would forbid it.
  const groupIds = new Set(groups.map((group) => group.groupId));
  for (const groupId of itemGroupIds) {
    if (groupId !== null && !groupIds.has(groupId)) return fail('item_references_unknown_group');
  }

  // One group per point means the grouping stage ran and changed nothing.
  if (points.length > 0 && groups.length === points.length) return fail('grouping_stage_did_nothing');
  return { ok: true };
}

/**
 * The bounds a planned list has to satisfy before anything downstream sees it.
 *
 * The recap's reservation needs no term of its own: it is emitted as one of the items, so capping
 * "the others" one lower is the same statement as capping the whole list at the maximum. A separate
 * check for it read as a second enforcement and could never fire — the count it tested had already
 * failed the line above. What the recap actually costs is enforced where it is decidable: it exists
 * if and only if there is enough behind it to recap, which is a rule about the list, not a bound.
 */
export function checkPromptEnhancementSequencePlannerBoundsV1(input: {
  itemCount: number;
  summaryRemainingTaskCount: number;
}): PromptEnhancementSequencePlannerCheckResultV1 {
  if (input.itemCount < PROMPT_ENHANCEMENT_SEQUENCE_MIN_ITEM_COUNT_V1) return fail('item_count_below_min');
  if (input.itemCount > PROMPT_ENHANCEMENT_SEQUENCE_MAX_ITEM_COUNT_V1) return fail('item_count_over_max');
  // The summary's own count is items after the first. Stored disagreeing with the list is how a
  // popup ends up reporting a different number of prompts than the plan holds.
  if (input.summaryRemainingTaskCount !== input.itemCount - 1) {
    return fail('summary_remaining_count_disagrees_with_items');
  }
  return { ok: true };
}
