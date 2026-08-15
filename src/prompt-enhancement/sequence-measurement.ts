import {
  PROMPT_ENHANCEMENT_COST_MODEL_V1,
  PROMPT_ENHANCEMENT_COST_TIMEOUT_MS_V1,
  buildPromptEnhancementCostRuntimeFlowEvidenceV1,
  buildPromptEnhancementCostVisibilityMetadataV1,
  type PromptEnhancementCostMeasurementInputV1,
  type PromptEnhancementCostRuntimeFlowEvidencePacketV1,
} from './cost-observability.js';
import type {
  PromptEnhancementCostCallIdV1,
  PromptEnhancementProviderFailureStateV1,
  PromptEnhancementRuntimeBlockReason,
} from './contracts.js';
import { CLAUDE_HOOK_TIMEOUT_SECONDS } from '../agents/adapters/claude-code.js';

/**
 * Per-PATH hook occupancy, which is the reading this milestone owes and nothing computes.
 *
 * The distinction is the whole point. A per-call latency — "the planner took N seconds" — cannot
 * answer the question the deferred Stop-hook migration is waiting on, because that migration wakes
 * when UserPromptSubmit processing NEARS the registered hook timeout, and what occupies the hook is
 * every call on the path, not the slowest one.
 *
 * ⛔ NO VERDICT IS EMITTED. This reports the total, the timeout it is measured against, the margin,
 * and the fraction consumed. It does NOT say whether that is "near" — the fraction at which a
 * deferred architectural unit gets scheduled is an owner call, and inventing a threshold here would
 * be the guessing the measurement exists to replace, pointed at a different field.
 *
 * ⛔ AND NO CONTENT, EVER. Durations, counts and token estimates only. The evidence packet this
 * feeds excludes prompt bodies, generated bodies, source excerpts, feedback text and error strings
 * as six literal exclusions, and an occupancy reading is subject to the same rule: how long and how
 * many, never what was written.
 */

/** The registered UserPromptSubmit hook timeout, in milliseconds, from the adapter that registers it. */
export const PROMPT_ENHANCEMENT_USER_PROMPT_SUBMIT_TIMEOUT_MS_V1 = CLAUDE_HOOK_TIMEOUT_SECONDS * 1_000;

/**
 * The Stop hook's inherited default, on the order of ten minutes.
 *
 * ⚠️ Stop registers with NO `timeout` field, so this is the host's default rather than a value this
 * codebase sets — recorded as an assumption with its own name so a reader cannot mistake it for a
 * constant we control. If the host changes its default, this reading moves and nothing here would
 * know.
 */
export const PROMPT_ENHANCEMENT_STOP_INHERITED_TIMEOUT_MS_V1 = 600_000;

/** A reading that has not been taken. The sentinel is the shape the cost inventory already uses. */
export const PROMPT_ENHANCEMENT_MEASUREMENT_NOT_TAKEN_V1 = 'blocked_pending_source_value' as const;

export type PromptEnhancementMeasurementPendingV1 = typeof PROMPT_ENHANCEMENT_MEASUREMENT_NOT_TAKEN_V1;

export type PromptEnhancementSequenceMeasuredPathV1 =
  | 'first_popup'
  | 'send'
  | 'continuation_stop';

/**
 * What occupies each path, and which timeout it is measured against.
 *
 * 🔴 The send path is the one that moved after the migration was deferred: the batch is AWAITED on
 * the hook's exit, so it is part of that hook's occupancy. The original wake condition was written
 * against a shorter path than the one now specified, which is why reporting per path rather than per
 * call is what makes the reading answer the question at all.
 */
export interface PromptEnhancementSequencePathShapeV1 {
  path: PromptEnhancementSequenceMeasuredPathV1;
  /** The work that holds the hook open, in the order it runs. */
  occupants: readonly string[];
  /** The timeout this path's occupancy is measured against. */
  timeoutMs: number;
  /** How that timeout is set, because one of the three is not ours. */
  timeoutSource: 'registered_by_this_codebase' | 'inherited_host_default';
  /** Whether the path exists to be measured yet. */
  runnableToday: boolean;
}

export const PROMPT_ENHANCEMENT_SEQUENCE_PATH_SHAPES_V1: readonly PromptEnhancementSequencePathShapeV1[] = [
  {
    path: 'first_popup',
    // Both run before the popup shows, so both hold the hook.
    occupants: ['sequence_planning_call', 'first_item_composition'],
    timeoutMs: PROMPT_ENHANCEMENT_USER_PROMPT_SUBMIT_TIMEOUT_MS_V1,
    timeoutSource: 'registered_by_this_codebase',
    runnableToday: true,
  },
  {
    path: 'send',
    // The batch is awaited on the exit path, so it is on this path's clock and not the next one's.
    occupants: ['sequence_planning_call', 'first_item_composition', 'awaited_batch_call'],
    timeoutMs: PROMPT_ENHANCEMENT_USER_PROMPT_SUBMIT_TIMEOUT_MS_V1,
    timeoutSource: 'registered_by_this_codebase',
    runnableToday: true,
  },
  {
    path: 'continuation_stop',
    // A read, not a call. Included so the set of paths is complete and the one that cannot be
    // measured yet is visibly unmeasured rather than absent.
    occupants: ['packager_read'],
    timeoutMs: PROMPT_ENHANCEMENT_STOP_INHERITED_TIMEOUT_MS_V1,
    timeoutSource: 'inherited_host_default',
    // ⛔ The continuation launcher is fail-closed and the runtime that would exercise this path is
    // not wired. Measuring it would mean measuring something that does not run.
    runnableToday: false,
  },
];

/** One measured occupant, as durations and counts. Never what it produced. */
export interface PromptEnhancementOccupantReadingV1 {
  occupant: string;
  latencyMs: number;
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
  /**
   * How many calls this occupant STARTED, which is where the cost is.
   *
   * 🔴 Not how many produced something usable. A repair loop that runs its bound and yields nothing
   * has started four paid calls and delivered none, and a reading that carried only the duration
   * would report that as one slow call — a different problem with a different remedy.
   *
   * Defaults to one started and one delivered, which is the ordinary single-call case.
   */
  startedCallCount?: number;
  /** How many of those produced a usable result. Zero is the discarded-work case, and it is real. */
  deliveredCallCount?: number;
  /**
   * WHAT happened, because the aggregate counts two different fields and a status alone sets neither.
   *
   * 🔴 The defect this closes: a discarded call was recorded with `status: 'fallback'` while the
   * packet's own `fallbackCount` stayed at zero — the aggregate counts by `fallbackReason`, not by
   * status, so setting one of the two left the record and the summary beside it disagreeing about
   * the same call. Reported across runs, the sequence path would look like it never falls back.
   *
   * Defaults to delivered, which is the ordinary case.
   */
  outcome?: PromptEnhancementOccupantOutcomeV1;
}

/**
 * What became of an occupant's calls.
 *
 * ⛔ Not a free-text note. Each value maps to BOTH fields the shipping aggregate reads, so a
 * reading cannot describe an outcome the counters then fail to count.
 */
export type PromptEnhancementOccupantOutcomeV1 =
  | 'delivered'
  | 'discarded_after_repairs'
  | 'provider_timeout'
  | 'provider_unavailable';

/**
 * One outcome, expressed in every field the aggregate consults.
 *
 * The three are set together on purpose. `fallbackCount` counts by `fallbackReason`, `timeoutCount`
 * counts by `providerFailureState` OR `status`, and `providerUnavailableCount` by the availability
 * state derived from `providerFailureState` — so an outcome stated in one field and defaulted in the
 * others is an outcome the packet half-reports.
 */
const OUTCOME_FIELDS_V1: Readonly<Record<PromptEnhancementOccupantOutcomeV1, {
  status: PromptEnhancementCostMeasurementInputV1['status'];
  fallbackReason: PromptEnhancementRuntimeBlockReason;
  providerFailureState: PromptEnhancementProviderFailureStateV1;
}>> = {
  delivered: { status: 'used', fallbackReason: 'not_applicable', providerFailureState: 'none' },
  // The repair budget spent and nothing usable produced. The calls were made and paid for, which is
  // why this is a fallback with a reason rather than a quiet zero.
  discarded_after_repairs: { status: 'fallback', fallbackReason: 'validation_failed', providerFailureState: 'none' },
  provider_timeout: { status: 'timeout', fallbackReason: 'timeout', providerFailureState: 'timeout' },
  provider_unavailable: { status: 'provider_unavailable', fallbackReason: 'provider_unavailable', providerFailureState: 'provider_api_unavailable' },
};

/**
 * Which cost row each occupant's calls belong to.
 *
 * ⛔ An occupant with no row is not silently attributed to another one. Mis-attribution would put a
 * planner's wasted starts under the wording call's name, which is worse than leaving them out —
 * the count would look right and be about the wrong thing.
 */
const OCCUPANT_CALL_IDS_V1: Readonly<Record<string, PromptEnhancementCostCallIdV1>> = {
  sequence_planning_call: 'sequence_planning',
  first_item_composition: 'baseline_pe_composer',
  awaited_batch_call: 'sequence_item_wording',
};

export interface PromptEnhancementSequencePathOccupancyV1 {
  path: PromptEnhancementSequenceMeasuredPathV1;
  occupants: readonly string[];
  timeoutMs: number;
  timeoutSource: PromptEnhancementSequencePathShapeV1['timeoutSource'];
  /** The sum across every occupant of this path. */
  totalOccupancyMs: number | PromptEnhancementMeasurementPendingV1;
  /** Timeout minus occupancy. Negative means the path does not fit, which is a finding, not an error. */
  marginMs: number | PromptEnhancementMeasurementPendingV1;
  /** Occupancy as a fraction of the timeout, to three decimals. ⛔ Reported, never judged. */
  fractionOfTimeoutConsumed: number | PromptEnhancementMeasurementPendingV1;
  /**
   * ⛔ NOT a verdict on whether the reading is "near" the limit. The reading is either taken or it
   * is not, and what to do about a large fraction is the owner's call.
   */
  readingState: 'measured' | 'not_measured_path_not_runnable' | 'not_measured_no_reading_supplied';
  /** Every latency figure is a figure FOR one model, and the record says which. */
  model: typeof PROMPT_ENHANCEMENT_COST_MODEL_V1;
  /**
   * The per-call timeout each occupant ran under.
   *
   * 🔴 Carried because the planner and the batch currently inherit the single global call timeout,
   * and a reading taken under an inherited value must not be read as evidence that the value fits.
   * It is the number the measurement is meant to REPLACE, so recording it beside the reading is
   * what stops the two being confused later.
   */
  perCallTimeoutMsAtReading: number;
}

function round3(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

/**
 * Build one path's occupancy from its readings.
 *
 * A path with no readings reports as unmeasured rather than as zero. Zero is a number, and a number
 * would flow into a margin that looked comfortable — the exact way an absent measurement becomes an
 * implied pass.
 */
export function buildPromptEnhancementSequencePathOccupancyV1(
  shape: PromptEnhancementSequencePathShapeV1,
  readings: readonly PromptEnhancementOccupantReadingV1[],
  perCallTimeoutMs: number = PROMPT_ENHANCEMENT_COST_TIMEOUT_MS_V1,
): PromptEnhancementSequencePathOccupancyV1 {
  const base = {
    path: shape.path,
    occupants: shape.occupants,
    timeoutMs: shape.timeoutMs,
    timeoutSource: shape.timeoutSource,
    model: PROMPT_ENHANCEMENT_COST_MODEL_V1,
    perCallTimeoutMsAtReading: perCallTimeoutMs,
  } as const;

  if (!shape.runnableToday) {
    return {
      ...base,
      totalOccupancyMs: PROMPT_ENHANCEMENT_MEASUREMENT_NOT_TAKEN_V1,
      marginMs: PROMPT_ENHANCEMENT_MEASUREMENT_NOT_TAKEN_V1,
      fractionOfTimeoutConsumed: PROMPT_ENHANCEMENT_MEASUREMENT_NOT_TAKEN_V1,
      readingState: 'not_measured_path_not_runnable',
    };
  }

  // Only readings for occupants this path actually has. A reading for something that does not run
  // on this path would inflate its occupancy with time the hook never spent.
  const own = readings.filter((reading) => shape.occupants.includes(reading.occupant));
  if (own.length === 0) {
    return {
      ...base,
      totalOccupancyMs: PROMPT_ENHANCEMENT_MEASUREMENT_NOT_TAKEN_V1,
      marginMs: PROMPT_ENHANCEMENT_MEASUREMENT_NOT_TAKEN_V1,
      fractionOfTimeoutConsumed: PROMPT_ENHANCEMENT_MEASUREMENT_NOT_TAKEN_V1,
      readingState: 'not_measured_no_reading_supplied',
    };
  }

  const totalOccupancyMs = own.reduce((sum, reading) => sum + reading.latencyMs, 0);
  return {
    ...base,
    totalOccupancyMs,
    marginMs: shape.timeoutMs - totalOccupancyMs,
    fractionOfTimeoutConsumed: round3(totalOccupancyMs / shape.timeoutMs),
    readingState: 'measured',
  };
}

/** Every path, in one report, so a partial measurement cannot read as a complete one. */
export function buildPromptEnhancementSequenceOccupancyReportV1(
  readings: readonly PromptEnhancementOccupantReadingV1[],
  perCallTimeoutMs?: number,
): readonly PromptEnhancementSequencePathOccupancyV1[] {
  return PROMPT_ENHANCEMENT_SEQUENCE_PATH_SHAPES_V1.map(
    (shape) => buildPromptEnhancementSequencePathOccupancyV1(shape, readings, perCallTimeoutMs),
  );
}

/**
 * The readings, as the cost-and-latency evidence packet the milestone already ships.
 *
 * ⛔ This does NOT compute the aggregate. `plannedCallCount`, `usedCallCount` and `latencyMsTotal`
 * come from the shipping builder, which is the point: a second aggregation written here would be a
 * measurement mechanism invented beside one that exists, free to disagree with it.
 *
 * 🔴 What the packet gives that the occupancy report cannot: the STARTS. A planner that spends its
 * repair bound and returns no plan reports `plannedCallCount: 4, usedCallCount: 0` here, where the
 * occupancy report can only say how long it took. Those are different findings.
 *
 * An occupant with no cost row is left out rather than attributed to another call — see
 * `OCCUPANT_CALL_IDS_V1`.
 */
export function buildPromptEnhancementSequenceMeasurementEvidenceV1(input: {
  evidenceId: string;
  enhancementId: string;
  requestId: string;
  readings: readonly PromptEnhancementOccupantReadingV1[];
}): PromptEnhancementCostRuntimeFlowEvidencePacketV1 {
  const measurementInputs: PromptEnhancementCostMeasurementInputV1[] = [];
  for (const reading of input.readings) {
    const callId = OCCUPANT_CALL_IDS_V1[reading.occupant];
    if (callId === undefined) continue;
    const started = reading.startedCallCount ?? 1;
    const delivered = reading.deliveredCallCount ?? 1;
    // Stated, or inferred from the counts when it was not. A run that started calls and delivered
    // nothing is discarded work, never a success with a zero in it.
    const outcome = reading.outcome ?? (delivered === 0 ? 'discarded_after_repairs' : 'delivered');
    const fields = OUTCOME_FIELDS_V1[outcome];
    measurementInputs.push({
      callId,
      plannedCallCount: started,
      usedCallCount: delivered,
      latencyMs: reading.latencyMs,
      estimatedInputTokens: reading.estimatedInputTokens,
      estimatedOutputTokens: reading.estimatedOutputTokens,
      ...fields,
    });
  }
  return buildPromptEnhancementCostRuntimeFlowEvidenceV1({
    evidenceId: input.evidenceId,
    enhancementId: input.enhancementId,
    requestId: input.requestId,
    callVisibilityMetadata: buildPromptEnhancementCostVisibilityMetadataV1('sequence_planning', {
      callVisibilityMode: 'llm_wording',
      plannedCallCount: measurementInputs.reduce((n, m) => n + m.plannedCallCount, 0),
      usedCallCount: measurementInputs.reduce((n, m) => n + m.usedCallCount, 0),
    }),
    measurementInputs,
    observedSurfaces: ['prompt_start_prepare', 'enhancement_popup'],
    telemetrySyncState: 'off_buffered_locally',
  });
}
