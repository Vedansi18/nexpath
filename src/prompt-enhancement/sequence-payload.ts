import type { PromptEnhancementValidationGraphV1 } from './contracts.js';
import {
  PROMPT_ENHANCEMENT_AUTHORITY_MODES,
  PROMPT_ENHANCEMENT_SENSITIVE_ACTION_RISK_KINDS,
  type PromptEnhancementAuthorityMode,
  type PromptEnhancementSensitiveActionRiskKind,
} from './safety-sendability.js';
import {
  PROMPT_ENHANCEMENT_SEQUENCE_MAX_ITEM_COUNT_V1,
  PROMPT_ENHANCEMENT_SEQUENCE_MIN_ITEM_COUNT_V1,
} from './sequence-runtime.js';

/**
 * Durable payload for a multi-prompt sequence: the ordered item list plus the four
 * sequence-wide fields that travel with it.
 *
 * The runtime state (`sequence-runtime.ts`) stays ids/counts/status and is unchanged. This
 * is the second thing the store writer is handed — a destructive DELETE+INSERT writer either
 * receives the payload or destroys it, so it is an explicit parameter rather than something
 * read-modify-written behind the caller's back.
 *
 * Item text is never composed here and never re-derived: `originalSliceRef` is an offset pair
 * cut from the local unredacted original, and it is authoritative rather than a cache — a
 * boundary the planner decided is recorded, never recomputed.
 */

export const PROMPT_ENHANCEMENT_SEQUENCE_ITEM_KINDS_V1 = [
  'first_task',
  'task',
  'double_confirmation',
  'cross_confirmation',
  'binary_confirmation',
  'wrap_up',
] as const;
export type PromptEnhancementSequenceItemKindV1 =
  typeof PROMPT_ENHANCEMENT_SEQUENCE_ITEM_KINDS_V1[number];

/** Kinds that carry a slice of the user's original prompt. The other four carry none. */
export const PROMPT_ENHANCEMENT_SEQUENCE_TASK_KINDS_V1 = ['first_task', 'task'] as const;

export const PROMPT_ENHANCEMENT_SEQUENCE_ROLE_LABELS_V1 = [
  'fix',
  'review',
  'refactor',
  'plan',
  'build',
] as const;
export type PromptEnhancementSequenceRoleLabelV1 =
  typeof PROMPT_ENHANCEMENT_SEQUENCE_ROLE_LABELS_V1[number];

export const PROMPT_ENHANCEMENT_SEQUENCE_COMPLEXITIES_V1 = [
  'not_complex',
  'complex',
  'highly_complex',
] as const;
export type PromptEnhancementSequenceComplexityV1 =
  typeof PROMPT_ENHANCEMENT_SEQUENCE_COMPLEXITIES_V1[number];

/**
 * The policy state that makes writing item wording before the user accepts a sequence legal.
 *
 * NOTE the name collision: `PromptEnhancementHandoffMetadataV1` carries a field of the SAME
 * NAME whose value set is only the first three of these. Our value for an in-flight batch is
 * not a member of that set — the two are never assigned across.
 */
export const PROMPT_ENHANCEMENT_SEQUENCE_NEXT_PROMPT_POLICIES_V1 = [
  'not_applicable',
  'not_generated',
  'metadata_refs_only',
  'generated_not_rendered_pending_acceptance',
  'rendered_after_explicit_acceptance',
] as const;
export type PromptEnhancementSequenceNextPromptPolicyV1 =
  typeof PROMPT_ENHANCEMENT_SEQUENCE_NEXT_PROMPT_POLICIES_V1[number];

/**
 * What the user did with the sequence offer, recorded once at first-popup close.
 *
 * There is deliberately no fourth value for a popup that died or returned nothing: the
 * absence of a row is that record. A `failed` value would have to be written by the thing
 * that failed.
 */
export const PROMPT_ENHANCEMENT_SEQUENCE_OFFER_DISPOSITIONS_V1 = [
  'accepted',
  'rejected',
  'not_engaged',
] as const;
export type PromptEnhancementSequenceOfferDispositionV1 =
  typeof PROMPT_ENHANCEMENT_SEQUENCE_OFFER_DISPOSITIONS_V1[number];

/** Half-open character range into the original prompt: `0 <= start < end <= originalLength`. */
export interface PromptEnhancementSequenceOffsetRangeV1 {
  start: number;
  end:   number;
}

export interface PromptEnhancementSequenceItemV1 {
  itemKind:          PromptEnhancementSequenceItemKindV1;
  /** Offsets into the original prompt. Non-null on task kinds only. */
  originalSliceRef:  PromptEnhancementSequenceOffsetRangeV1 | null;
  /** Offsets of the source-backed points this item covers — lineage, checkable after the fact. */
  sourcePointRanges: readonly PromptEnhancementSequenceOffsetRangeV1[];
  roleLabel:         PromptEnhancementSequenceRoleLabelV1 | null;
  /** Equal to the item's index in the list. */
  dependencyOrder:   number;
  complexity:        PromptEnhancementSequenceComplexityV1 | null;
  complexityReason:  string | null;
  /** Written once by the batch and never rewritten. Null on `first_task`, which is never re-offered. */
  generatedWording:  string | null;
  actionRiskKind:    PromptEnhancementSensitiveActionRiskKind | null;
  /**
   * Carried from the slice so composition cannot escalate plan into execute. Null on the kinds
   * that carry no slice — a confirmation has no authority of its own to exceed.
   */
  authorityMode:     PromptEnhancementAuthorityMode | null;
  /** False on the kinds that carry no slice, for the same reason. */
  requiresConfirmationFloor: boolean;
  /** One planning-group id per item, so a payload can rebuild the real grouping. */
  decompositionGroupId: string | null;
  /** The per-item validation verdict, including its safety state. Reported, never fabricated. */
  itemValidationGraph:  PromptEnhancementValidationGraphV1 | null;
}

export interface PromptEnhancementSequencePayloadV1 {
  items: readonly PromptEnhancementSequenceItemV1[];
  /** Whole-prompt instructions, as offsets. One copy per sequence, applied to every item. */
  promptDirectives: readonly PromptEnhancementSequenceOffsetRangeV1[];
  suggestedNextPromptPolicy: PromptEnhancementSequenceNextPromptPolicyV1;
  /** Character length of the original prompt the offsets index into. */
  originalLength: number;
  offerDisposition: PromptEnhancementSequenceOfferDispositionV1;
}

export type PromptEnhancementSequencePayloadReasonCodeV1 =
  | 'payload_not_object'
  | 'items_not_array'
  | 'item_count_over_max'
  | 'item_count_below_min'
  | 'item_count_disagrees_with_row'
  | 'stub_row_must_carry_no_items'
  | 'original_length_zero_with_items'
  | 'next_prompt_policy_disagrees_with_items'
  | 'confirmations_do_not_match_complexity'
  | 'original_length_invalid'
  | 'prompt_directives_invalid'
  | 'next_prompt_policy_invalid'
  | 'offer_disposition_invalid'
  | 'item_not_object'
  | 'item_kind_invalid'
  | 'first_task_not_exactly_one_at_index_0'
  | 'wrap_up_not_last_or_duplicated'
  | 'wrap_up_presence_does_not_match_count'
  | 'dependency_order_not_index'
  | 'original_slice_ref_presence_invalid'
  | 'offset_range_out_of_bounds'
  | 'first_task_slice_not_whole_original'
  | 'source_point_ranges_invalid'
  | 'role_label_invalid'
  | 'complexity_presence_invalid'
  | 'complexity_reason_invalid'
  | 'generated_wording_presence_invalid'
  | 'action_risk_kind_invalid'
  | 'authority_mode_invalid'
  | 'requires_confirmation_floor_invalid'
  | 'decomposition_group_id_invalid'
  | 'item_validation_graph_presence_invalid';

export type PromptEnhancementSequencePayloadValidationV1 =
  | { ok: true }
  | { ok: false; reasonCode: PromptEnhancementSequencePayloadReasonCodeV1; itemIndex?: number };

/**
 * The row context a payload is validated against. `itemCount` is a separate column read by the
 * state machine while the list is read by the packager, so the two are one quantity stored
 * twice: too small and the machine completes while entries remain, too large and it offers past
 * the end of the list. It is a required argument so the check cannot be skipped by omission.
 */
export interface PromptEnhancementSequencePayloadContextV1 {
  itemCount: number;
}

/**
 * A sequence that has been recorded but not yet planned. Intake writes this on first send;
 * the planner replaces `items` and the sequence-wide fields when it exists.
 */
export function emptyPromptEnhancementSequencePayloadV1(
  originalLength: number,
): PromptEnhancementSequencePayloadV1 {
  return {
    items: [],
    promptDirectives: [],
    suggestedNextPromptPolicy: 'not_generated',
    originalLength: Number.isSafeInteger(originalLength) && originalLength >= 0 ? originalLength : 0,
    offerDisposition: 'accepted',
  };
}

function isSafeIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function rangeWithinBounds(
  value: unknown,
  originalLength: number,
): value is PromptEnhancementSequenceOffsetRangeV1 {
  if (typeof value !== 'object' || value === null) return false;
  const range = value as Record<string, unknown>;
  if (!isSafeIndex(range['start']) || !isSafeIndex(range['end'])) return false;
  // Half-open and non-empty: an inverted or zero-width slice is the failure offsets introduced
  // in place of the verbatim-match failure they removed.
  return range['start'] < range['end'] && range['end'] <= originalLength;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

const fail = (
  reasonCode: PromptEnhancementSequencePayloadReasonCodeV1,
  itemIndex?: number,
): PromptEnhancementSequencePayloadValidationV1 =>
  itemIndex === undefined ? { ok: false, reasonCode } : { ok: false, reasonCode, itemIndex };

/**
 * Structural validation of a stored payload, fail-closed. Every rule here is a single-row
 * check on shape, enum membership, position, count arithmetic, or offset bounds.
 *
 * Deliberately NOT here: anything requiring judgement about the text (whether a reason is
 * generic, whether wording exceeds its authority, whether a confirmation carries its
 * mandatory parts). Those are composition-time and read-time semantic rules owned by the
 * validation phase, and a deterministic approximation of them would be worse than none.
 */
export function validatePromptEnhancementSequencePayloadV1(
  payload: unknown,
  context: PromptEnhancementSequencePayloadContextV1,
): PromptEnhancementSequencePayloadValidationV1 {
  if (typeof payload !== 'object' || payload === null) return fail('payload_not_object');
  const p = payload as Record<string, unknown>;

  if (!Array.isArray(p['items'])) return fail('items_not_array');
  const items = p['items'] as unknown[];
  if (items.length > PROMPT_ENHANCEMENT_SEQUENCE_MAX_ITEM_COUNT_V1) return fail('item_count_over_max');

  if (!isSafeIndex(p['originalLength'])) return fail('original_length_invalid');
  const originalLength = p['originalLength'];

  if (!Array.isArray(p['promptDirectives'])
    || (p['promptDirectives'] as unknown[]).some((r) => !rangeWithinBounds(r, originalLength))) {
    return fail('prompt_directives_invalid');
  }
  if (!PROMPT_ENHANCEMENT_SEQUENCE_NEXT_PROMPT_POLICIES_V1
    .includes(p['suggestedNextPromptPolicy'] as PromptEnhancementSequenceNextPromptPolicyV1)) {
    return fail('next_prompt_policy_invalid');
  }
  if (!PROMPT_ENHANCEMENT_SEQUENCE_OFFER_DISPOSITIONS_V1
    .includes(p['offerDisposition'] as PromptEnhancementSequenceOfferDispositionV1)) {
    return fail('offer_disposition_invalid');
  }

  // A row whose disposition is not `accepted` is a terminal record of an offer that never
  // activated. It is never served, so there is nothing to validate bounds against — and without
  // this exemption the scrub would delete the record in the same breath it was written.
  if (p['offerDisposition'] !== 'accepted') {
    return items.length === 0 ? { ok: true } : fail('stub_row_must_carry_no_items');
  }

  // PRE-PLANNER WINDOW. Intake records the row on send and the planner fills the list; until the
  // planner exists nothing produces items, so an accepted row is written with an empty list. This
  // is a build-order state, not a modelled one — when the planner lands, an accepted row always
  // carries its items and this branch stops being reachable.
  if (items.length === 0) return { ok: true };

  // From here the row claims to be a servable sequence, and every bound applies.
  if (items.length < PROMPT_ENHANCEMENT_SEQUENCE_MIN_ITEM_COUNT_V1) return fail('item_count_below_min');
  if (items.length !== context.itemCount) return fail('item_count_disagrees_with_row');
  // An offset rule that compares against an unchecked bound runs and proves nothing: a bound
  // larger than the real prompt lets out-of-range offsets pass and resolve to text that does not
  // exist.
  if (originalLength === 0) return fail('original_length_zero_with_items');
  // The policy value must describe the state the row is actually in.
  if (p['suggestedNextPromptPolicy'] === 'not_generated') {
    return fail('next_prompt_policy_disagrees_with_items');
  }

  let firstTaskCount = 0;
  let wrapUpCount = 0;

  for (let index = 0; index < items.length; index += 1) {
    const raw = items[index];
    if (typeof raw !== 'object' || raw === null) return fail('item_not_object', index);
    const item = raw as Record<string, unknown>;

    const kind = item['itemKind'] as PromptEnhancementSequenceItemKindV1;
    if (!PROMPT_ENHANCEMENT_SEQUENCE_ITEM_KINDS_V1.includes(kind)) {
      return fail('item_kind_invalid', index);
    }
    const isTaskKind = kind === 'first_task' || kind === 'task';
    const isConfirmation = kind === 'double_confirmation'
      || kind === 'cross_confirmation'
      || kind === 'binary_confirmation';
    if (kind === 'first_task') firstTaskCount += 1;
    if (kind === 'wrap_up') {
      wrapUpCount += 1;
      if (index !== items.length - 1) return fail('wrap_up_not_last_or_duplicated', index);
    }

    // The offered index maps onto this list directly, so a displaced entry serves the wrong
    // item for the rest of the sequence. Neither the runtime nor the popup can catch it.
    if (item['dependencyOrder'] !== index) return fail('dependency_order_not_index', index);

    const sliceRef = item['originalSliceRef'];
    if (isTaskKind) {
      if (!rangeWithinBounds(sliceRef, originalLength)) {
        return sliceRef === null
          ? fail('original_slice_ref_presence_invalid', index)
          : fail('offset_range_out_of_bounds', index);
      }
      // The first item is the whole original prompt, not a slice of it.
      if (kind === 'first_task') {
        const ref = sliceRef as PromptEnhancementSequenceOffsetRangeV1;
        if (ref.start !== 0 || ref.end !== originalLength) {
          return fail('first_task_slice_not_whole_original', index);
        }
      }
    } else if (sliceRef !== null) {
      return fail('original_slice_ref_presence_invalid', index);
    }

    if (!Array.isArray(item['sourcePointRanges'])
      || (item['sourcePointRanges'] as unknown[]).some((r) => !rangeWithinBounds(r, originalLength))) {
      return fail('source_point_ranges_invalid', index);
    }

    const roleLabel = item['roleLabel'];
    if (roleLabel !== null
      && !PROMPT_ENHANCEMENT_SEQUENCE_ROLE_LABELS_V1
        .includes(roleLabel as PromptEnhancementSequenceRoleLabelV1)) {
      return fail('role_label_invalid', index);
    }

    const complexity = item['complexity'];
    if (isTaskKind) {
      if (!PROMPT_ENHANCEMENT_SEQUENCE_COMPLEXITIES_V1
        .includes(complexity as PromptEnhancementSequenceComplexityV1)) {
        return fail('complexity_presence_invalid', index);
      }
    } else if (complexity !== null) {
      return fail('complexity_presence_invalid', index);
    }

    const reason = item['complexityReason'];
    if (kind === 'wrap_up') {
      if (reason !== null) return fail('complexity_reason_invalid', index);
    } else if (isConfirmation) {
      // Every confirmation records why THIS confirmation applies.
      if (!isNonEmptyString(reason)) return fail('complexity_reason_invalid', index);
    } else if (complexity === 'complex' || complexity === 'highly_complex') {
      if (!isNonEmptyString(reason)) return fail('complexity_reason_invalid', index);
    } else if (reason !== null && !isNonEmptyString(reason)) {
      return fail('complexity_reason_invalid', index);
    }

    // A stored item with no wording is a body the packager cannot serve; `first_task` is the
    // one exception because it was sent at intake and is never offered again.
    const wording = item['generatedWording'];
    if (kind === 'first_task') {
      if (wording !== null) return fail('generated_wording_presence_invalid', index);
    } else if (!isNonEmptyString(wording)) {
      return fail('generated_wording_presence_invalid', index);
    }

    const riskKind = item['actionRiskKind'];
    if (riskKind !== null
      && !PROMPT_ENHANCEMENT_SENSITIVE_ACTION_RISK_KINDS
        .includes(riskKind as PromptEnhancementSensitiveActionRiskKind)) {
      return fail('action_risk_kind_invalid', index);
    }

    // Authority is carried FROM the slice, so an item with a slice must have one and an item
    // without a slice must not: a confirmation has no authority of its own to exceed.
    const authorityMode = item['authorityMode'];
    if (isTaskKind) {
      if (!PROMPT_ENHANCEMENT_AUTHORITY_MODES
        .includes(authorityMode as PromptEnhancementAuthorityMode)) {
        return fail('authority_mode_invalid', index);
      }
    } else if (authorityMode !== null) {
      return fail('authority_mode_invalid', index);
    }

    const floor = item['requiresConfirmationFloor'];
    if (typeof floor !== 'boolean') return fail('requires_confirmation_floor_invalid', index);
    if (!isTaskKind && floor) return fail('requires_confirmation_floor_invalid', index);

    const groupId = item['decompositionGroupId'];
    if (isTaskKind) {
      if (!isNonEmptyString(groupId)) return fail('decomposition_group_id_invalid', index);
    } else if (groupId !== null && !isNonEmptyString(groupId)) {
      return fail('decomposition_group_id_invalid', index);
    }

    // Same rule and same reason as the wording: an item with a body and no verdict is a body
    // nobody validated.
    const graph = item['itemValidationGraph'];
    if (kind === 'first_task') {
      if (graph !== null) return fail('item_validation_graph_presence_invalid', index);
    } else if (typeof graph !== 'object' || graph === null) {
      return fail('item_validation_graph_presence_invalid', index);
    }
  }

  if (firstTaskCount !== 1 || (items[0] as Record<string, unknown>)['itemKind'] !== 'first_task') {
    return fail('first_task_not_exactly_one_at_index_0');
  }
  if (wrapUpCount > 1) return fail('wrap_up_not_last_or_duplicated');
  // A recap exists if and only if there is enough behind it to recap.
  if ((items.length - wrapUpCount > 3) !== (wrapUpCount === 1)) {
    return fail('wrap_up_presence_does_not_match_count');
  }

  return confirmationsMatchComplexity(items as readonly Record<string, unknown>[]);
}

const CONFIRMATION_KINDS: readonly PromptEnhancementSequenceItemKindV1[] = [
  'double_confirmation',
  'cross_confirmation',
  'binary_confirmation',
];

/**
 * The confirmations following each task must be exactly what the task's complexity verdict
 * yields, and in the locked order — where a task earns two, the double or cross precedes the
 * binary, so the decision is not asked for before the check that informs it.
 *
 * This is a lookup from the verdict rather than a second judgement, which is why no separate
 * applicability field is stored. The list is that second place, so it is checked against the
 * verdict instead. Without this the verdict is decorative: an item could record `not_complex`
 * and carry three confirmations, and nothing would compare them.
 *
 * It VALIDATES and scrubs; it never repairs. Choosing which confirmation an item should have is
 * inferring applicability, which the runtime may not do.
 */
function confirmationsMatchComplexity(
  items: readonly Record<string, unknown>[],
): PromptEnhancementSequencePayloadValidationV1 {
  for (let index = 0; index < items.length; index += 1) {
    const kind = items[index]['itemKind'];
    if (kind !== 'first_task' && kind !== 'task') continue;

    const run: unknown[] = [];
    for (let j = index + 1; j < items.length; j += 1) {
      const next = items[j]['itemKind'] as PromptEnhancementSequenceItemKindV1;
      if (!CONFIRMATION_KINDS.includes(next)) break;
      run.push(next);
    }

    const complexity = items[index]['complexity'];
    const matches = complexity === 'not_complex'
      ? run.length === 0
      : complexity === 'complex'
        ? run.length === 1 && run[0] === 'binary_confirmation'
        : run.length === 2
          && (run[0] === 'double_confirmation' || run[0] === 'cross_confirmation')
          && run[1] === 'binary_confirmation';
    if (!matches) return fail('confirmations_do_not_match_complexity', index);
  }
  return { ok: true };
}
