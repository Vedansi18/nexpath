import { describe, expect, it } from 'vitest';
import {
  promptEnhancementSequencePlannerMayRunV1,
  promptEnhancementSequencePolicyForOutcomeV1,
} from './sequence-planner-entry.js';
import {
  checkPromptEnhancementSequencePlannerBoundsV1,
  checkPromptEnhancementSequencePlannerGroupingV1,
  checkPromptEnhancementSequencePlannerOutcomeV1,
  isPromptEnhancementSequencePlannerRangeV1,
  type PromptEnhancementSequencePlannerGroupV1,
  type PromptEnhancementSequencePlannerPointV1,
} from './sequence-planner-output.js';
import {
  PROMPT_ENHANCEMENT_SEQUENCE_PLANNER_SECTIONS_V1,
  buildPromptEnhancementSequencePlannerSystemPromptV1,
} from './sequence-planner-prompt.js';
import {
  runPromptEnhancementSequencePlannerV1,
  type PromptEnhancementSequencePlannerClientV1,
} from './sequence-planner.js';

const point = (id: string, start: number): PromptEnhancementSequencePlannerPointV1 =>
  ({ pointId: id, startOffset: start, endOffset: start + 5, requiredKind: 'work' });
const group = (
  id: string,
  pointIds: string[],
): PromptEnhancementSequencePlannerGroupV1 => ({ groupId: id, pointIds, canRemainOneBodySection: false });

/** A client that returns one canned reply, so the call path can be exercised without a provider. */
const clientReturning = (content: string | null): PromptEnhancementSequencePlannerClientV1 => ({
  chat: { completions: { create: async () => ({ choices: [{ message: { content } }] }) } },
});
const clientThrowing = (error: unknown): PromptEnhancementSequencePlannerClientV1 => ({
  chat: { completions: { create: async () => { throw error; } } },
});

const validReply = (overrides: Record<string, unknown> = {}): string => JSON.stringify({
  outcome: 'sequence',
  outcomeReason: null,
  points: [point('p1', 0), point('p2', 10), point('p3', 20)],
  groups: [group('g1', ['p1', 'p2']), group('g2', ['p3'])],
  items: [
    {
      itemKind: 'first_task', originalSliceRef: { start: 0, end: 40 }, sourcePointRanges: [],
      roleLabel: 'fix', dependencyOrder: 0, complexity: 'not_complex', complexityReason: null,
      actionRiskKind: null, authorityMode: 'plan_or_review', requiresConfirmationFloor: false,
      decompositionGroupId: 'g1',
    },
    {
      itemKind: 'task', originalSliceRef: { start: 10, end: 30 }, sourcePointRanges: [],
      roleLabel: null, dependencyOrder: 1, complexity: 'not_complex', complexityReason: null,
      actionRiskKind: null, authorityMode: 'plan_or_review', requiresConfirmationFloor: false,
      decompositionGroupId: 'g2',
    },
  ],
  promptDirectives: [],
  summaryData: { summaryId: 's1', remainingTaskCount: 1, taskRoleLabels: ['fix'] },
  ...overrides,
});

describe('sequence planner — entry conditions', () => {
  it('runs on a user-authored prompt with the gate on', () => {
    expect(promptEnhancementSequencePlannerMayRunV1({ promptOrigin: 'user', sequenceEnabled: 'on' }))
      .toEqual({ mayRun: true });
  });

  it('refuses when the gate is off, whatever the origin', () => {
    // Silent by contract: the key is a forbidden render value, so an off gate looks exactly like a
    // prompt that did not need a sequence.
    expect(promptEnhancementSequencePlannerMayRunV1({ promptOrigin: 'user', sequenceEnabled: 'off' }))
      .toEqual({ mayRun: false, refusal: 'sequence_disabled_by_config' });
  });

  it('refuses an unknown origin rather than defaulting to allow', () => {
    expect(promptEnhancementSequencePlannerMayRunV1({ promptOrigin: 'unknown', sequenceEnabled: 'on' }))
      .toEqual({ mayRun: false, refusal: 'prompt_origin_unknown' });
    expect(promptEnhancementSequencePlannerMayRunV1({ promptOrigin: 'pe_generated_echo', sequenceEnabled: 'on' }))
      .toEqual({ mayRun: false, refusal: 'prompt_not_user_authored' });
  });

  it('refuses a body the sequence itself produced — this is the loop, not a skipped call', () => {
    expect(promptEnhancementSequencePlannerMayRunV1({
      promptOrigin: 'user', sequenceEnabled: 'on', sentPromptOrigin: 'sequence_handoff_owned_body',
    })).toEqual({ mayRun: false, refusal: 'body_is_sequence_owned' });
  });

  it('refuses every other body this feature generated', () => {
    for (const origin of [
      'pe_baseline_generated_body', 'pe_action_generated_body',
      'pe_deterministic_fallback_body', 'previous_sendable_body',
    ] as const) {
      expect(promptEnhancementSequencePlannerMayRunV1({
        promptOrigin: 'user', sequenceEnabled: 'on', sentPromptOrigin: origin,
      })).toEqual({ mayRun: false, refusal: 'body_is_feature_generated' });
    }
    // A body the user wrote themselves is not a refusal.
    expect(promptEnhancementSequencePlannerMayRunV1({
      promptOrigin: 'user', sequenceEnabled: 'on', sentPromptOrigin: 'user_authored_original_only',
    })).toEqual({ mayRun: true });
  });

  it('only a planned sequence moves off the default policy', () => {
    expect(promptEnhancementSequencePolicyForOutcomeV1('sequence'))
      .toBe('generated_not_rendered_pending_acceptance');
    expect(promptEnhancementSequencePolicyForOutcomeV1('single_plain')).toBe('not_generated');
    expect(promptEnhancementSequencePolicyForOutcomeV1('single_with_confirmation')).toBe('not_generated');
  });
});

describe('sequence planner — the outcome and its reason', () => {
  it('a planned sequence explains nothing; a refusal must', () => {
    expect(checkPromptEnhancementSequencePlannerOutcomeV1('sequence', null).ok).toBe(true);
    expect(checkPromptEnhancementSequencePlannerOutcomeV1('sequence', 'too_vague'))
      .toEqual({ ok: false, code: 'outcome_reason_disagrees_with_outcome' });
    expect(checkPromptEnhancementSequencePlannerOutcomeV1('single_plain', null))
      .toEqual({ ok: false, code: 'outcome_reason_disagrees_with_outcome' });
  });

  it('accepts each recorded reason on a non-sequence outcome', () => {
    for (const reason of ['too_vague', 'unsafe', 'not_big_enough']) {
      expect(checkPromptEnhancementSequencePlannerOutcomeV1('single_with_confirmation', reason).ok)
        .toBe(true);
    }
  });

  it('rejects an outcome outside the three', () => {
    expect(checkPromptEnhancementSequencePlannerOutcomeV1('maybe_sequence', null))
      .toEqual({ ok: false, code: 'outcome_invalid' });
  });
});

describe('sequence planner — the grouping checks', () => {
  it('accepts a grouping that placed every point exactly once', () => {
    expect(checkPromptEnhancementSequencePlannerGroupingV1(
      [point('p1', 0), point('p2', 10), point('p3', 20)],
      [group('g1', ['p1', 'p2']), group('g2', ['p3'])],
    ).ok).toBe(true);
  });

  it('catches a grouping stage that did nothing', () => {
    // One group per point is the failure the stage exists to prevent, and without the array a
    // three-item sequence from a three-clause request looks identical to a grouped one.
    expect(checkPromptEnhancementSequencePlannerGroupingV1(
      [point('p1', 0), point('p2', 10)],
      [group('g1', ['p1']), group('g2', ['p2'])],
    )).toEqual({ ok: false, code: 'grouping_stage_did_nothing' });
  });

  it('catches a point placed nowhere, and one placed twice', () => {
    expect(checkPromptEnhancementSequencePlannerGroupingV1(
      [point('p1', 0), point('p2', 10), point('p3', 20)],
      [group('g1', ['p1', 'p2'])],
    )).toEqual({ ok: false, code: 'point_in_no_group' });
    expect(checkPromptEnhancementSequencePlannerGroupingV1(
      [point('p1', 0), point('p2', 10), point('p3', 20)],
      [group('g1', ['p1', 'p2']), group('g2', ['p2', 'p3'])],
    )).toEqual({ ok: false, code: 'point_in_more_than_one_group' });
  });

  it('catches an empty group and a reference to a point that does not exist', () => {
    expect(checkPromptEnhancementSequencePlannerGroupingV1([point('p1', 0)], [group('g1', [])]))
      .toEqual({ ok: false, code: 'group_empty' });
    expect(checkPromptEnhancementSequencePlannerGroupingV1(
      [point('p1', 0), point('p2', 5), point('p3', 10)],
      [group('g1', ['p1', 'p9'])],
    )).toEqual({ ok: false, code: 'group_references_unknown_point' });
  });

  it('catches a duplicated point id in the inventory itself', () => {
    expect(checkPromptEnhancementSequencePlannerGroupingV1(
      [point('p1', 0), point('p1', 10)],
      [group('g1', ['p1'])],
    )).toEqual({ ok: false, code: 'point_id_duplicated' });
  });
});

describe('sequence planner — the bounds', () => {
  it('accepts a list inside the bounds whose summary count agrees with it', () => {
    expect(checkPromptEnhancementSequencePlannerBoundsV1({
      itemCount: 5, emitsWrapUp: false, summaryRemainingTaskCount: 4,
    }).ok).toBe(true);
  });

  it('rejects a one-item list — that is no sequence, not a short one', () => {
    expect(checkPromptEnhancementSequencePlannerBoundsV1({
      itemCount: 1, emitsWrapUp: false, summaryRemainingTaskCount: 0,
    })).toEqual({ ok: false, code: 'item_count_below_min' });
  });

  it('rejects a list past the maximum', () => {
    expect(checkPromptEnhancementSequencePlannerBoundsV1({
      itemCount: 31, emitsWrapUp: false, summaryRemainingTaskCount: 30,
    })).toEqual({ ok: false, code: 'item_count_over_max' });
  });

  it('catches a summary count that disagrees with the list it describes', () => {
    // The summary's own figure is items after the first; stored disagreeing is how a popup reports
    // a different number of prompts than the plan holds.
    expect(checkPromptEnhancementSequencePlannerBoundsV1({
      itemCount: 5, emitsWrapUp: false, summaryRemainingTaskCount: 5,
    })).toEqual({ ok: false, code: 'summary_remaining_count_disagrees_with_items' });
  });
});

describe('sequence planner — offsets', () => {
  it('accepts a range inside the original and rejects inverted, empty and out-of-range', () => {
    expect(isPromptEnhancementSequencePlannerRangeV1({ start: 0, end: 10 }, 50)).toBe(true);
    expect(isPromptEnhancementSequencePlannerRangeV1({ start: 10, end: 10 }, 50)).toBe(false);
    expect(isPromptEnhancementSequencePlannerRangeV1({ start: 20, end: 5 }, 50)).toBe(false);
    expect(isPromptEnhancementSequencePlannerRangeV1({ start: 0, end: 51 }, 50)).toBe(false);
  });
});

describe('sequence planner — the prompt', () => {
  it('carries all five mandatory sections, each as its own section', () => {
    expect(PROMPT_ENHANCEMENT_SEQUENCE_PLANNER_SECTIONS_V1).toHaveLength(5);
    const prompt = buildPromptEnhancementSequencePlannerSystemPromptV1();
    for (const heading of [
      'SECTION 0 — THE STANDING PREFERENCE',
      'SECTION 1 — THE ORDER OF THINKING',
      'SECTION 2 — COMPLEXITY',
      'SECTION 3 — SLICING CONSTRAINTS',
      'SECTION 4 — CONFIRMATION APPLICABILITY',
    ]) {
      expect(prompt).toContain(heading);
    }
  });

  it('carries the rules that are most easily lost when a prompt is edited down', () => {
    const prompt = buildPromptEnhancementSequencePlannerSystemPromptV1();
    // The four triggers, not just "how complex is this".
    for (const trigger of ['Sensitive', 'Business-logic core', 'Challenging']) {
      expect(prompt).toContain(trigger);
    }
    // Weighed, not counted; and uncertainty does not escalate.
    expect(prompt).toContain('WEIGHED');
    expect(prompt).toContain('UNCERTAINTY DOES NOT ESCALATE');
    // The non-signals.
    expect(prompt).toContain('length, file count, vocabulary');
    // Standing alone, and the readiness hard stop.
    expect(prompt).toContain('EVERY ITEM MUST STAND ON ITS OWN');
    expect(prompt).toContain('A readiness ask is NEVER emitted');
    // Positions, never text.
    expect(prompt).toContain('SLICES ARE POSITIONS, NOT TEXT');
  });

  it('tells the model it does not word the prompts', () => {
    expect(buildPromptEnhancementSequencePlannerSystemPromptV1()).toContain('You do NOT write the prompts');
  });
});

describe('sequence planner — the call', () => {
  const input = { promptContext: 'fix the failing test and add a rate limiter', originalLength: 43 };

  it('returns the plan when the reply holds together', async () => {
    const result = await runPromptEnhancementSequencePlannerV1(input, clientReturning(validReply()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.outcome).toBe('sequence');
    expect(result.output.items).toHaveLength(2);
    // The bound comes from the caller, not from the model — it is the length the offsets address.
    expect(result.output.originalLength).toBe(43);
  });

  it('reports a call that never happened separately from one that failed', async () => {
    // A thrown provider error is not retried: a fast typed refusal beats a slow retry in front of
    // a waiting user.
    expect(await runPromptEnhancementSequencePlannerV1(input, clientThrowing(new Error('nope'))))
      .toEqual({ ok: false, reason: 'provider_error' });
    const timeout = Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' });
    expect(await runPromptEnhancementSequencePlannerV1(input, clientThrowing(timeout)))
      .toEqual({ ok: false, reason: 'timeout' });
  });

  it('refuses an empty or unparseable reply', async () => {
    expect(await runPromptEnhancementSequencePlannerV1(input, clientReturning(null)))
      .toEqual({ ok: false, reason: 'invalid_output' });
    expect(await runPromptEnhancementSequencePlannerV1(input, clientReturning('not json')))
      .toEqual({ ok: false, reason: 'invalid_output' });
    expect(await runPromptEnhancementSequencePlannerV1(input, clientReturning('{"outcome":"sequence"}')))
      .toEqual({ ok: false, reason: 'invalid_output' });
  });

  it('refuses a reply that returns slice TEXT instead of positions', async () => {
    // Returning text is how a redaction marker would travel into wording shown under a promise
    // that the user's own words appear exactly.
    const withText = validReply({
      items: [{
        itemKind: 'first_task', originalSliceRef: 'fix the failing test', sourcePointRanges: [],
        roleLabel: null, dependencyOrder: 0, complexity: 'not_complex', complexityReason: null,
        actionRiskKind: null, authorityMode: 'plan_or_review', requiresConfirmationFloor: false,
        decompositionGroupId: 'g1',
      }],
    });
    expect(await runPromptEnhancementSequencePlannerV1(input, clientReturning(withText)))
      .toEqual({ ok: false, reason: 'invalid_output' });
  });

  it('surfaces the check that failed rather than a generic rejection', async () => {
    const ungrouped = validReply({
      points: [point('p1', 0), point('p2', 10)],
      groups: [group('g1', ['p1']), group('g2', ['p2'])],
    });
    expect(await runPromptEnhancementSequencePlannerV1(input, clientReturning(ungrouped)))
      .toEqual({ ok: false, reason: 'grouping_stage_did_nothing' });

    const explained = validReply({ outcomeReason: 'not_big_enough' });
    expect(await runPromptEnhancementSequencePlannerV1(input, clientReturning(explained)))
      .toEqual({ ok: false, reason: 'outcome_reason_disagrees_with_outcome' });
  });
});
