import {
  PROMPT_ENHANCEMENT_COST_MODEL_V1,
  PROMPT_ENHANCEMENT_COST_TIMEOUT_MS_V1,
} from './cost-observability.js';
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

/** One measured occupant, as durations and token counts. Never what it produced. */
export interface PromptEnhancementOccupantReadingV1 {
  occupant: string;
  latencyMs: number;
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
}

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
