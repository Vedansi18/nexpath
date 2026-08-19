/**
 * The body producer: fills each planned item's stored body from the batch it was composed by.
 *
 * The planner writes the item STRUCTURE (kind, slices, order, authority) with no wording; the batch
 * writes the WORDING, its verdict, and where the safety floor sits — keyed by `dependencyOrder`. This
 * merges the two into the completed item list the store persists, and does it by lookup, never by
 * generation: it fills what the batch actually returned and fails when a body it was promised is not
 * there, so an item can never reach the store worded by anything but the composer.
 *
 * ⛔ Never fabricates a body. A planned non-first item with no composed entry is a fault
 * (`item_missing_composed`), not an empty string; the first item carrying a composed body is a fault
 * (`first_item_must_not_be_worded`), not a silently dropped one. Both mirror the batch's own guards,
 * re-checked here at the store-assembly boundary where the invariant is about to become durable.
 *
 * This is a pure transform: no store, no client, no clock. Its only inputs are the planner's items
 * and the batch's `composed` map, and its only output is the completed list or a reason it could not
 * be assembled. The runtime that runs the batch and upserts the result is a later, gated caller.
 */
import type { PromptEnhancementSequenceComposedItemV1 } from './sequence-batch-composer.js';
import type { PromptEnhancementSequenceItemV1 } from './sequence-payload.js';

export type PromptEnhancementSequenceItemBodyProducerReasonV1 =
  /** The batch returned a body for the first item, which is never worded (its body is the first popup). */
  | 'first_item_must_not_be_worded'
  /** The batch returned a body keyed to an order no planned item holds. */
  | 'composed_item_not_in_plan'
  /** A planned non-first item has no body in the batch — nothing to fill it from, and none is invented. */
  | 'item_missing_composed';

export type PromptEnhancementSequenceItemBodyProducerResultV1 =
  | { ok: true; items: readonly PromptEnhancementSequenceItemV1[] }
  | { ok: false; reason: PromptEnhancementSequenceItemBodyProducerReasonV1 };

/**
 * The first item's body is never composed by the batch: it is the prompt the first popup already
 * shows, so its stored `generatedWording` stays null and the batch is never asked to write it.
 */
const PROMPT_ENHANCEMENT_SEQUENCE_FIRST_ITEM_KIND_V1 = 'first_task';

/**
 * Merge the planner's item structure with the batch's composed bodies into the stored item list.
 *
 * `composed` is keyed by `dependencyOrder`, one entry per item the batch was asked to write — every
 * item except the first. The result carries the planner's items unchanged except that each non-first
 * item gains its `generatedWording`, `itemValidationGraph`, and `itemSafetyClauseRef` from its
 * composed entry.
 */
export function producePromptEnhancementSequenceItemBodiesV1(
  plannedItems: readonly PromptEnhancementSequenceItemV1[],
  composed: ReadonlyMap<number, PromptEnhancementSequenceComposedItemV1>,
): PromptEnhancementSequenceItemBodyProducerResultV1 {
  const plannedOrders = new Set(plannedItems.map((item) => item.dependencyOrder));

  // Every composed body must belong to a planned non-first item. A body keyed to an order no item
  // holds, or to the first item, is a mismatch between the plan the batch ran against and this list —
  // the case a later re-plan produces — and is rejected rather than dropped.
  for (const order of composed.keys()) {
    if (!plannedOrders.has(order)) return { ok: false, reason: 'composed_item_not_in_plan' };
  }

  const items: PromptEnhancementSequenceItemV1[] = [];
  for (const item of plannedItems) {
    if (item.itemKind === PROMPT_ENHANCEMENT_SEQUENCE_FIRST_ITEM_KIND_V1) {
      // The first item is never worded by the batch; a composed entry for it means the two disagree
      // about which item is first.
      if (composed.has(item.dependencyOrder)) {
        return { ok: false, reason: 'first_item_must_not_be_worded' };
      }
      items.push(item);
      continue;
    }

    const body = composed.get(item.dependencyOrder);
    if (!body) return { ok: false, reason: 'item_missing_composed' };
    items.push({
      ...item,
      generatedWording: body.wording,
      itemValidationGraph: body.validationGraph,
      itemSafetyClauseRef: body.safetyClauseRef,
    });
  }

  return { ok: true, items };
}
