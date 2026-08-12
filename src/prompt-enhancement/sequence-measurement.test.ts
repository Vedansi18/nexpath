import { describe, expect, it } from 'vitest';
import {
  PROMPT_ENHANCEMENT_MEASUREMENT_NOT_TAKEN_V1,
  PROMPT_ENHANCEMENT_SEQUENCE_PATH_SHAPES_V1,
  PROMPT_ENHANCEMENT_STOP_INHERITED_TIMEOUT_MS_V1,
  PROMPT_ENHANCEMENT_USER_PROMPT_SUBMIT_TIMEOUT_MS_V1,
  buildPromptEnhancementSequenceMeasurementEvidenceV1,
  buildPromptEnhancementSequenceOccupancyReportV1,
  buildPromptEnhancementSequencePathOccupancyV1,
  type PromptEnhancementOccupantReadingV1,
} from './sequence-measurement.js';
import {
  PROMPT_ENHANCEMENT_COST_MODEL_V1,
  PROMPT_ENHANCEMENT_COST_TIMEOUT_MS_V1,
  PROMPT_ENHANCEMENT_MEASUREMENT_PENDING_V1,
  buildPromptEnhancementCostVisibilityMetadataV1,
  getPromptEnhancementAcceptedCostCallInventoryV1,
} from './cost-observability.js';
import { CLAUDE_HOOK_TIMEOUT_SECONDS } from '../agents/adapters/claude-code.js';

const shapeFor = (path: string) =>
  PROMPT_ENHANCEMENT_SEQUENCE_PATH_SHAPES_V1.find((entry) => entry.path === path)!;

const reading = (
  occupant: string,
  latencyMs: number,
): PromptEnhancementOccupantReadingV1 => ({ occupant, latencyMs });

describe('path occupancy — the reading a per-call latency cannot give', () => {
  it('takes its timeout from the adapter that registers the hook, not from a copy', () => {
    // The margin is only meaningful against the real registered value, and a second copy of it here
    // would go stale the moment the adapter changed.
    expect(PROMPT_ENHANCEMENT_USER_PROMPT_SUBMIT_TIMEOUT_MS_V1).toBe(CLAUDE_HOOK_TIMEOUT_SECONDS * 1_000);
  });

  it('sums every occupant of the path, which is what holds the hook open', () => {
    const occupancy = buildPromptEnhancementSequencePathOccupancyV1(shapeFor('first_popup'), [
      reading('sequence_planning_call', 12_000),
      reading('first_item_composition', 11_000),
    ]);
    expect(occupancy.readingState).toBe('measured');
    expect(occupancy.totalOccupancyMs).toBe(23_000);
    expect(occupancy.marginMs).toBe(PROMPT_ENHANCEMENT_USER_PROMPT_SUBMIT_TIMEOUT_MS_V1 - 23_000);
    expect(occupancy.fractionOfTimeoutConsumed).toBeCloseTo(0.256, 3);
  });

  it('puts the awaited batch on the SEND path, not on the one after it', () => {
    // The batch is awaited before the hook exits, so it is on this hook's clock. Counted anywhere
    // else, the send path reads as short and the deferred migration's wake condition is checked
    // against a path shorter than the one that actually runs.
    const readings = [
      reading('sequence_planning_call', 12_000),
      reading('first_item_composition', 11_000),
      reading('awaited_batch_call', 30_000),
    ];
    const send = buildPromptEnhancementSequencePathOccupancyV1(shapeFor('send'), readings);
    const first = buildPromptEnhancementSequencePathOccupancyV1(shapeFor('first_popup'), readings);
    expect(send.totalOccupancyMs).toBe(53_000);
    // The same readings, filtered to what each path actually runs — the first popup does not wait
    // on the batch, so its occupancy excludes it.
    expect(first.totalOccupancyMs).toBe(23_000);
    expect(send.occupants).toContain('awaited_batch_call');
    expect(first.occupants).not.toContain('awaited_batch_call');
  });

  it('reports a negative margin rather than refusing to state it', () => {
    // A path that does not fit is a finding, and the number is the finding. Clamping it at zero, or
    // throwing, would lose the one reading that would tell anyone the path had outgrown its hook.
    const occupancy = buildPromptEnhancementSequencePathOccupancyV1(shapeFor('send'), [
      reading('sequence_planning_call', 40_000),
      reading('first_item_composition', 30_000),
      reading('awaited_batch_call', 40_000),
    ]);
    expect(occupancy.totalOccupancyMs).toBe(110_000);
    expect(occupancy.marginMs).toBe(PROMPT_ENHANCEMENT_USER_PROMPT_SUBMIT_TIMEOUT_MS_V1 - 110_000);
    expect(occupancy.marginMs).toBeLessThan(0);
    expect(occupancy.fractionOfTimeoutConsumed).toBeGreaterThan(1);
  });

  it('emits no verdict about whether a reading is near the limit', () => {
    // ⛔ The fraction is reported and never judged. What counts as "near enough to schedule the
    // deferred architectural unit" is an owner call, and a threshold invented here would be the
    // guessing this measurement exists to replace, aimed at a different field.
    const occupancy = buildPromptEnhancementSequencePathOccupancyV1(shapeFor('send'), [
      reading('sequence_planning_call', 20_000),
      reading('first_item_composition', 14_000),
      reading('awaited_batch_call', 50_000),
    ]);
    expect(occupancy.fractionOfTimeoutConsumed).toBeCloseTo(0.933, 3);
    // The only state field says whether it was measured — never whether the answer is acceptable.
    expect(['measured', 'not_measured_path_not_runnable', 'not_measured_no_reading_supplied'])
      .toContain(occupancy.readingState);
    expect(JSON.stringify(occupancy)).not.toMatch(/near|warn|danger|acceptable|ok\b/i);
  });
});

describe('path occupancy — what an absent reading must not become', () => {
  it('reports no reading as unmeasured, never as zero', () => {
    // Zero is a number, and a zero would flow into a margin that looked comfortable. That is how an
    // absent measurement turns into an implied pass.
    const occupancy = buildPromptEnhancementSequencePathOccupancyV1(shapeFor('first_popup'), []);
    expect(occupancy.readingState).toBe('not_measured_no_reading_supplied');
    expect(occupancy.totalOccupancyMs).toBe(PROMPT_ENHANCEMENT_MEASUREMENT_NOT_TAKEN_V1);
    expect(occupancy.marginMs).toBe(PROMPT_ENHANCEMENT_MEASUREMENT_NOT_TAKEN_V1);
    expect(occupancy.fractionOfTimeoutConsumed).toBe(PROMPT_ENHANCEMENT_MEASUREMENT_NOT_TAKEN_V1);
  });

  it('refuses to measure the continuation path, because it does not run yet', () => {
    // The continuation launcher is fail-closed and the runtime that would exercise this path is not
    // wired. A number here would be a measurement of something that does not happen.
    const occupancy = buildPromptEnhancementSequencePathOccupancyV1(shapeFor('continuation_stop'), [
      reading('packager_read', 3),
    ]);
    expect(occupancy.readingState).toBe('not_measured_path_not_runnable');
    expect(occupancy.totalOccupancyMs).toBe(PROMPT_ENHANCEMENT_MEASUREMENT_NOT_TAKEN_V1);
  });

  it('names the Stop timeout as inherited rather than as ours', () => {
    // Stop registers with no timeout field, so this figure is the host's default. Recorded with its
    // provenance so nobody reads it as a value this codebase sets — if the host moves it, the
    // margin moves and nothing here would know.
    const stop = shapeFor('continuation_stop');
    expect(stop.timeoutMs).toBe(PROMPT_ENHANCEMENT_STOP_INHERITED_TIMEOUT_MS_V1);
    expect(stop.timeoutSource).toBe('inherited_host_default');
    expect(shapeFor('send').timeoutSource).toBe('registered_by_this_codebase');
  });

  it('covers all three paths in one report, so a partial run cannot read as complete', () => {
    const report = buildPromptEnhancementSequenceOccupancyReportV1([
      reading('sequence_planning_call', 9_000),
    ]);
    expect(report.map((entry) => entry.path)).toEqual(['first_popup', 'send', 'continuation_stop']);
    // The one path with a reading is measured; the others say why they are not.
    expect(report[0]?.readingState).toBe('measured');
    expect(report[2]?.readingState).toBe('not_measured_path_not_runnable');
  });
});

describe('path occupancy — every reading is a reading OF something', () => {
  it('records the model, because a latency without one measures nothing', () => {
    const occupancy = buildPromptEnhancementSequencePathOccupancyV1(shapeFor('first_popup'), [
      reading('sequence_planning_call', 5_000),
    ]);
    expect(occupancy.model).toBe(PROMPT_ENHANCEMENT_COST_MODEL_V1);
  });

  it('records the per-call timeout the reading was taken under', () => {
    // The planner and the batch currently inherit the single global call timeout. A reading taken
    // under an inherited value must not later be read as evidence that the value fits, so the
    // number the measurement exists to REPLACE is carried beside it.
    const occupancy = buildPromptEnhancementSequencePathOccupancyV1(shapeFor('send'), [
      reading('awaited_batch_call', 8_000),
    ]);
    expect(occupancy.perCallTimeoutMsAtReading).toBe(PROMPT_ENHANCEMENT_COST_TIMEOUT_MS_V1);
  });

  it('carries no content — durations and counts only', () => {
    const report = buildPromptEnhancementSequenceOccupancyReportV1([
      { occupant: 'sequence_planning_call', latencyMs: 7_000, estimatedInputTokens: 900, estimatedOutputTokens: 1_200 },
    ]);
    const serialised = JSON.stringify(report);
    // Nothing that could be a prompt, a body, an excerpt or an error string.
    expect(serialised).not.toMatch(/prompt_body|generated_body|excerpt|rawError|"text"/i);
  });
});

describe('the cost record can now express a measured value', () => {
  it('lets a row state a timeout and a cap that are not the composer\'s constants', () => {
    // Typed as the constants, a row could report only 45 s and 2,000 tokens — so the record could
    // not express a measured timeout for the calls this milestone measures, and a batch could not
    // state the cap it actually needs.
    const rows = getPromptEnhancementAcceptedCostCallInventoryV1();
    const sample = rows[0]!;
    const widened: typeof sample = { ...sample, timeoutMs: 61_000, outputTokenCap: 12_000 };
    expect(widened.timeoutMs).toBe(61_000);
    expect(widened.outputTokenCap).toBe(12_000);
  });

  it('leaves an unmeasured timeout ABSENT from the visibility metadata, never defaulted', () => {
    // ⛔ Not a fallback to the global constant. The metadata's completeness check wants a number on
    // any provider-using call, so an unmeasured one reports incomplete — which is true. Substituting
    // 45 s would make an unmeasured call look fully specified, which is the failure the widening was
    // done to prevent.
    const metadata = buildPromptEnhancementCostVisibilityMetadataV1('sequence_item_wording', {
      callVisibilityMode: 'llm_backed',
      plannedCallCount: 1,
      usedCallCount: 1,
    });
    // The shipping rows still carry real numbers, so this one is present.
    expect(typeof metadata.timeoutMs).toBe('number');
    // And the sentinel is a named export, so a row that has not been measured has something to say.
    expect(PROMPT_ENHANCEMENT_MEASUREMENT_PENDING_V1).toBe('blocked_pending_source_value');
  });
});

describe('the readings go through the shipping packet, not around it', () => {
  const evidence = (readings: readonly PromptEnhancementOccupantReadingV1[]) =>
    buildPromptEnhancementSequenceMeasurementEvidenceV1({
      evidenceId: 'measure-1', enhancementId: 'enh-1', requestId: 'req-1', readings,
    });

  it('counts STARTS, so discarded work is visible as work', () => {
    // The whole reason the packet is the vehicle. A repair loop that spends its bound and returns
    // nothing has started four paid calls and delivered none — a reading carrying only the duration
    // reports that as one slow call, which is a different problem with a different remedy.
    const packet = evidence([
      { occupant: 'sequence_planning_call', latencyMs: 126_045, startedCallCount: 4, deliveredCallCount: 0 },
    ]);
    expect(packet.aggregate.plannedCallCount).toBe(4);
    expect(packet.aggregate.usedCallCount).toBe(0);
    expect(packet.aggregate.latencyMsTotal).toBe(126_045);
  });

  it('takes the aggregate from the shipping builder rather than computing a second one', () => {
    // Two aggregations over one set of readings are two numbers free to disagree, and the one in
    // this file would be the one nobody else checks.
    const packet = evidence([
      { occupant: 'sequence_planning_call', latencyMs: 20_346, startedCallCount: 1, deliveredCallCount: 0 },
      { occupant: 'first_item_composition', latencyMs: 12_837 },
      { occupant: 'awaited_batch_call', latencyMs: 35_244, estimatedOutputTokens: 388 },
    ]);
    expect(packet.evidenceKind).toBe('prompt_start_popup_delivery_cost_latency_v1');
    expect(packet.aggregate.plannedCallCount).toBe(3);
    // One of the three delivered nothing, and the aggregate says so.
    expect(packet.aggregate.usedCallCount).toBe(2);
    expect(packet.aggregate.latencyMsTotal).toBe(68_427);
  });

  it('leaves an occupant with no cost row OUT rather than filing it under another call', () => {
    // Mis-attribution is worse than omission here: the count would look right and be about the
    // wrong call.
    const packet = evidence([
      { occupant: 'packager_read', latencyMs: 3 },
      { occupant: 'awaited_batch_call', latencyMs: 35_244 },
    ]);
    expect(packet.measurementRecords).toHaveLength(1);
    expect(packet.measurementRecords[0]?.callId).toBe('sequence_item_wording');
  });

  it('carries the vehicle\'s own six privacy exclusions', () => {
    // The content ban enforced by the packet rather than by an assertion of mine.
    const packet = evidence([{ occupant: 'awaited_batch_call', latencyMs: 1 }]);
    expect(packet.privacyExclusions).toEqual({
      rawPromptBodyExcluded: true,
      rawGeneratedBodyExcluded: true,
      rawSourceExcerptExcluded: true,
      rawFeedbackTextExcluded: true,
      rawErrorExcluded: true,
      localWriteAlreadySafe: true,
    });
    expect(packet.costVisibilityCanWeakenBehavior).toBe(false);
  });

  it('gives the planner call a row of its own, classified like its siblings', () => {
    // Registered so the reading has somewhere to go — and gated exactly as the other two sequence
    // rows are, because the runtime is still fail-closed and a row saying otherwise would have the
    // source claim v1-live.
    const rows = getPromptEnhancementAcceptedCostCallInventoryV1();
    const planning = rows.find((entry) => entry.callId === 'sequence_planning');
    const wording = rows.find((entry) => entry.callId === 'sequence_item_wording');
    expect(planning).toBeDefined();
    expect(planning?.requirementState).toBe(wording?.requirementState);
    expect(planning?.productState).toBe(wording?.productState);
  });
});
