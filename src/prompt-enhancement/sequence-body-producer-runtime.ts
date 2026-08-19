/**
 * The body producer end to end: one batch call turns a planned sequence into stored item bodies.
 *
 * This is the runtime source the future-sequence gate names — the single background call the owner's plan
 * places "after item 1 is composed": it takes the planner's item structure and the first prompt's
 * finished body, asks the batch composer to write every remaining item in one reply, and merges the
 * result into the completed item list the store persists. Three existing, tested parts wired in
 * order — build the batch items, run the batch, fill the bodies — with the failure of either step
 * reported by the stage it came from rather than flattened into one reason.
 *
 * It calls the provider (through the injected client) and nothing else: no store, no clock beyond the
 * batch's own deadline, no popup. The gated launcher that supplies the runtime context and upserts the
 * result is a separate, later caller — this stays the pure "produce the bodies" step so it can be run
 * and checked on its own.
 */
import {
  buildPromptEnhancementSequenceBatchItemsV1,
  runPromptEnhancementSequenceBatchV1,
  type PromptEnhancementSequenceBatchFailureReasonV1,
} from './sequence-batch-composer.js';
import {
  producePromptEnhancementSequenceItemBodiesV1,
  type PromptEnhancementSequenceItemBodyProducerReasonV1,
} from './sequence-item-body-producer.js';
import type { PromptEnhancementSequenceItemV1 } from './sequence-payload.js';
import type { PromptEnhancementSequencePlannerClientV1 } from './sequence-planner.js';
import type {
  PromptEnhancementCallVisibilityMode,
  PromptEnhancementSafetySummaryV1,
  PromptEnhancementValidationGraphV1,
} from './contracts.js';

export interface PromptEnhancementSequenceBodyProducerInputV1 {
  /** The planner's items, item 0 first. Structure only; the batch writes the bodies. */
  plannerItems: readonly PromptEnhancementSequenceItemV1[];
  /** Which plan this run is for — carried onto the batch and checked when its reply lands. */
  planGenerationId: string;
  /** Item 0's finished body: context for the batch, and never a source it cuts later prompts from. */
  firstBodyText: string;
  /** The user's whole-prompt instructions, resolved to text. */
  promptDirectives: readonly string[];
  /** The request as the user typed it — the text every item's slice is resolved against. */
  localOriginalText: string;
  /** The accepted sequence's safety posture, the starting point for each item's verdict. */
  baseSafetySummary: PromptEnhancementSafetySummaryV1;
  /** How this run reached the provider, recorded on every item's verdict. */
  providerRuntimeState: PromptEnhancementCallVisibilityMode;
  optionalCallAvailabilityState: PromptEnhancementValidationGraphV1['optionalCallAvailabilityState'];
  /** How the caller names item N — the same id it will hand the packager for that item. */
  sequenceItemIdFor: (dependencyOrder: number) => string;
  /** When the work this call is part of must be finished, as epoch milliseconds. */
  deadlineAtMs?: number;
  /** How the deadline is read. Present so the check is testable without waiting. */
  nowMs?: () => number;
}

export type PromptEnhancementSequenceBodyProducerResultV1 =
  | { ok: true; items: readonly PromptEnhancementSequenceItemV1[] }
  /** The batch could not be made or did not hold up — the reason the composer returned. */
  | { ok: false; stage: 'batch'; reason: PromptEnhancementSequenceBatchFailureReasonV1 }
  /** The batch held up but its bodies did not line up with the plan at the store boundary. */
  | { ok: false; stage: 'assemble'; reason: PromptEnhancementSequenceItemBodyProducerReasonV1 };

export async function runPromptEnhancementSequenceBodyProducerV1(
  input: PromptEnhancementSequenceBodyProducerInputV1,
  client?: PromptEnhancementSequencePlannerClientV1,
): Promise<PromptEnhancementSequenceBodyProducerResultV1> {
  const batchItems = buildPromptEnhancementSequenceBatchItemsV1(
    input.plannerItems,
    input.localOriginalText,
    input.sequenceItemIdFor,
  );

  const batch = await runPromptEnhancementSequenceBatchV1(
    {
      planGenerationId: input.planGenerationId,
      items: batchItems,
      firstBodyText: input.firstBodyText,
      promptDirectives: input.promptDirectives,
      localOriginalText: input.localOriginalText,
      baseSafetySummary: input.baseSafetySummary,
      providerRuntimeState: input.providerRuntimeState,
      optionalCallAvailabilityState: input.optionalCallAvailabilityState,
      deadlineAtMs: input.deadlineAtMs,
      nowMs: input.nowMs,
    },
    client,
  );
  if (!batch.ok) return { ok: false, stage: 'batch', reason: batch.reason };

  const produced = producePromptEnhancementSequenceItemBodiesV1(input.plannerItems, batch.composed);
  if (!produced.ok) return { ok: false, stage: 'assemble', reason: produced.reason };

  return { ok: true, items: produced.items };
}
