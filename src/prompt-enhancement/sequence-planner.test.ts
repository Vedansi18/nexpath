import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Database } from 'sql.js';
import {
  promptEnhancementSequencePlannerDispositionV1,
  promptEnhancementSequenceSplitterCountV1,
} from './sequence-planner-failure.js';
import { describePromptEnhancementSequencePlanV1 } from './routing-taxonomy.js';
import {
  promptEnhancementSequencePlannerMayRunForProjectV1,
  promptEnhancementSequencePlannerMayRunV1,
  promptEnhancementSequencePolicyForOutcomeV1,
} from './sequence-planner-entry.js';
import {
  PROMPT_ENHANCEMENT_SEQUENCE_POINT_KINDS_V1,
  checkPromptEnhancementSequencePlannerBoundsV1,
  checkPromptEnhancementSequencePlannerGroupingV1,
  checkPromptEnhancementSequencePlannerOutcomeV1,
  type PromptEnhancementSequencePlannerGroupV1,
  type PromptEnhancementSequencePlannerPointV1,
} from './sequence-planner-output.js';
import { openStore, type Store } from '../store/db.js';
import {
  promptEnhancementSequenceProjectKey,
  setPromptEnhancementSequenceEnabled,
  PROMPT_ENHANCEMENT_SEQUENCE_ENABLED_KEY,
} from '../config/PromptEnhancementConfig.js';
import { isPromptEnhancementSequenceOffsetRangeV1 } from './sequence-payload.js';
import {
  PROMPT_ENHANCEMENT_SEQUENCE_PLANNER_SECTIONS_V1,
  buildPromptEnhancementSequencePlannerSystemPromptV1,
} from './sequence-planner-prompt.js';
import {
  PROMPT_ENHANCEMENT_SEQUENCE_PLANNER_MAX_REPAIRS_V1,
  runPromptEnhancementSequencePlannerV1,
  type PromptEnhancementSequencePlannerClientV1,
  type PromptEnhancementSequencePlannerRouteV1,
} from './sequence-planner.js';

const point = (id: string, start: number): PromptEnhancementSequencePlannerPointV1 =>
  ({ pointId: id, startOffset: start, endOffset: start + 5, requiredKind: 'deliverable' });
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

const ORIGINAL = 'fix the failing test and add a rate limiter';

/** A prompt the planner is allowed to plan: the user wrote it, and a popup is coming. */
const ENTRY = { promptOrigin: 'user', guidanceGateShow: true } as const;

/** The gate is not a value a caller supplies, so the call needs a store to resolve it from. */
let store: Store;
let db: Database;
beforeAll(async () => {
  store = await openStore(':memory:');
  db = store.db;
  setPromptEnhancementSequenceEnabled(store, PROMPT_ENHANCEMENT_SEQUENCE_ENABLED_KEY, 'on');
});
const call = (
  overrides: Partial<{ entry: typeof ENTRY; projectRoot: string }> = {},
) => ({ promptContext: ORIGINAL, localOriginalText: ORIGINAL, entry: ENTRY, db, ...overrides });

const validReply = (overrides: Record<string, unknown> = {}): string => JSON.stringify({
  outcome: 'sequence',
  outcomeReason: null,
  points: [point('p1', 0), point('p2', 10), point('p3', 20)],
  groups: [group('g1', ['p1', 'p2']), group('g2', ['p3'])],
  items: [
    {
      // The first prompt is the request itself, so its slice is the whole original.
      itemKind: 'first_task', originalSliceRef: { start: 0, end: ORIGINAL.length },
      sourcePointRanges: [], roleLabel: 'fix', dependencyOrder: 0, complexity: 'not_complex',
      complexityReason: null, decompositionGroupId: 'g1',
    },
    {
      itemKind: 'task', originalSliceRef: { start: 10, end: 30 }, sourcePointRanges: [],
      roleLabel: null, dependencyOrder: 1, complexity: 'not_complex', complexityReason: null,
      decompositionGroupId: 'g2',
    },
  ],
  promptDirectives: [],
  summaryData: { summaryId: 's1', remainingTaskCount: 1 },
  ...overrides,
});

describe('sequence planner — entry conditions', () => {
  it('runs on a user-authored prompt with the gate on', () => {
    expect(promptEnhancementSequencePlannerMayRunV1({ promptOrigin: 'user', sequenceEnabled: 'on', guidanceGateShow: true }))
      .toEqual({ mayRun: true });
  });

  it('refuses when the gate is off, whatever the origin', () => {
    // Silent by contract: the key is a forbidden render value, so an off gate looks exactly like a
    // prompt that did not need a sequence.
    expect(promptEnhancementSequencePlannerMayRunV1({ promptOrigin: 'user', sequenceEnabled: 'off', guidanceGateShow: true }))
      .toEqual({ mayRun: false, refusal: 'sequence_disabled_by_config' });
  });

  it('refuses an unknown origin rather than defaulting to allow', () => {
    expect(promptEnhancementSequencePlannerMayRunV1({ promptOrigin: 'unknown', sequenceEnabled: 'on', guidanceGateShow: true }))
      .toEqual({ mayRun: false, refusal: 'prompt_origin_unknown' });
    expect(promptEnhancementSequencePlannerMayRunV1({ promptOrigin: 'pe_generated_echo', sequenceEnabled: 'on', guidanceGateShow: true }))
      .toEqual({ mayRun: false, refusal: 'prompt_not_user_authored' });
  });

  it('refuses a body the sequence itself produced — this is the loop, not a skipped call', () => {
    expect(promptEnhancementSequencePlannerMayRunV1({
      promptOrigin: 'user', sequenceEnabled: 'on', guidanceGateShow: true, sentPromptOrigin: 'sequence_handoff_owned_body',
    })).toEqual({ mayRun: false, refusal: 'body_is_sequence_owned' });
  });

  it('refuses every other body this feature generated', () => {
    for (const origin of [
      'pe_baseline_generated_body', 'pe_action_generated_body',
      'pe_deterministic_fallback_body', 'previous_sendable_body',
    ] as const) {
      expect(promptEnhancementSequencePlannerMayRunV1({
        promptOrigin: 'user', sequenceEnabled: 'on', guidanceGateShow: true, sentPromptOrigin: origin,
      })).toEqual({ mayRun: false, refusal: 'body_is_feature_generated' });
    }
    // A body the user wrote themselves is not a refusal.
    expect(promptEnhancementSequencePlannerMayRunV1({
      promptOrigin: 'user', sequenceEnabled: 'on', guidanceGateShow: true, sentPromptOrigin: 'user_authored_original_only',
    })).toEqual({ mayRun: true });
  });

  it('reads the gate through the resolver, so a project overrules the global value', () => {
    // The one-line query a caller would write instead loses exactly this, and loses it silently.
    setPromptEnhancementSequenceEnabled(store, promptEnhancementSequenceProjectKey('/off-here'), 'off');
    expect(promptEnhancementSequencePlannerMayRunForProjectV1(db, '/off-here', ENTRY))
      .toEqual({ mayRun: false, refusal: 'sequence_disabled_by_config' });
    // Another project is unaffected by its neighbour's setting.
    expect(promptEnhancementSequencePlannerMayRunForProjectV1(db, '/elsewhere', ENTRY))
      .toEqual({ mayRun: true });
  });

  it('treats a config value outside the two as OFF, not as absent', () => {
    // Absent falls to the global value; a typo must not turn a gate on that may never be named in
    // anything rendered, because nothing would then be able to say it had been.
    db.run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)',
      [promptEnhancementSequenceProjectKey('/typo'), 'ON!']);
    expect(promptEnhancementSequencePlannerMayRunForProjectV1(db, '/typo', ENTRY))
      .toEqual({ mayRun: false, refusal: 'sequence_disabled_by_config' });
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

  it('catches an item naming a group that does not exist', () => {
    // The array dies with the call, so the id each item keeps is the only trace of the grouping
    // left. An id naming nothing cannot be caught later — there is nothing to compare it against.
    expect(checkPromptEnhancementSequencePlannerGroupingV1(
      [point('p1', 0), point('p2', 10), point('p3', 20)],
      [group('g1', ['p1', 'p2']), group('g2', ['p3'])],
      ['g1', 'g99'],
    )).toEqual({ ok: false, code: 'item_references_unknown_group' });
  });

  it('accepts a group that became no item — that group stayed in the body', () => {
    // Requiring every group to be referenced would forbid the mechanism by which a request with
    // many small bullets becomes two prompts rather than ten.
    expect(checkPromptEnhancementSequencePlannerGroupingV1(
      [point('p1', 0), point('p2', 10), point('p3', 20)],
      [group('g1', ['p1', 'p2']), group('g2', ['p3'])],
      ['g1', null],
    ).ok).toBe(true);
  });

  it('catches a point whose kind is outside the six', () => {
    // The kinds are defined rather than judged, so a seventh value means the inventory did not use
    // the definition — and the five that are not deliverables are the ones it exists to find.
    expect(checkPromptEnhancementSequencePlannerGroupingV1(
      [{ pointId: 'p1', startOffset: 0, endOffset: 5, requiredKind: 'work' as never },
        point('p2', 10), point('p3', 20)],
      [group('g1', ['p1', 'p2']), group('g2', ['p3'])],
    )).toEqual({ ok: false, code: 'point_required_kind_invalid' });
  });

  it('returns a typed failure on an entry that is not an object, rather than throwing', () => {
    // A dropped entry arriving as null is an ordinary way for a partial generation to come back,
    // and reading a field off it would throw past every typed refusal a caller is written against.
    expect(checkPromptEnhancementSequencePlannerGroupingV1([null as never], []))
      .toEqual({ ok: false, code: 'point_not_object' });
    expect(checkPromptEnhancementSequencePlannerGroupingV1([point('p1', 0)], [null as never]))
      .toEqual({ ok: false, code: 'group_not_object' });
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
      itemCount: 5, summaryRemainingTaskCount: 4,
    }).ok).toBe(true);
  });

  it('rejects a one-item list — that is no sequence, not a short one', () => {
    expect(checkPromptEnhancementSequencePlannerBoundsV1({
      itemCount: 1, summaryRemainingTaskCount: 0,
    })).toEqual({ ok: false, code: 'item_count_below_min' });
  });

  it('rejects a list past the maximum', () => {
    expect(checkPromptEnhancementSequencePlannerBoundsV1({
      itemCount: 31, summaryRemainingTaskCount: 30,
    })).toEqual({ ok: false, code: 'item_count_over_max' });
  });

  it('catches a summary count that disagrees with the list it describes', () => {
    // The summary's own figure is items after the first; stored disagreeing is how a popup reports
    // a different number of prompts than the plan holds.
    expect(checkPromptEnhancementSequencePlannerBoundsV1({
      itemCount: 5, summaryRemainingTaskCount: 5,
    })).toEqual({ ok: false, code: 'summary_remaining_count_disagrees_with_items' });
  });
});

describe('sequence planner — offsets', () => {
  it('accepts a range inside the original and rejects inverted, empty and out-of-range', () => {
    expect(isPromptEnhancementSequenceOffsetRangeV1({ start: 0, end: 10 }, 50)).toBe(true);
    expect(isPromptEnhancementSequenceOffsetRangeV1({ start: 10, end: 10 }, 50)).toBe(false);
    expect(isPromptEnhancementSequenceOffsetRangeV1({ start: 20, end: 5 }, 50)).toBe(false);
    expect(isPromptEnhancementSequenceOffsetRangeV1({ start: 0, end: 51 }, 50)).toBe(false);
  });
});

describe('sequence planner — the prompt', () => {
  it('carries the five mandatory sections, the bounds and the self-check, each its own section', () => {
    expect(PROMPT_ENHANCEMENT_SEQUENCE_PLANNER_SECTIONS_V1).toHaveLength(7);
    const prompt = buildPromptEnhancementSequencePlannerSystemPromptV1();
    for (const heading of [
      'SECTION 0 — THE STANDING PREFERENCE',
      'SECTION 1 — THE ORDER OF THINKING',
      'SECTION 2 — COMPLEXITY',
      'SECTION 3 — SLICING CONSTRAINTS',
      'SECTION 4 — CONFIRMATION APPLICABILITY',
      'SECTION 5 — BOUNDS',
      'SECTION 6 — CHECK YOUR OWN PLAN',
    ]) {
      expect(prompt).toContain(heading);
    }
  });

  it('states the caps and the overflow order, which the plan is rejected whole for breaking', () => {
    const prompt = buildPromptEnhancementSequencePlannerSystemPromptV1();
    expect(prompt).toContain('AT LEAST 2 and AT MOST 30');
    // A one-item list is not a short sequence.
    expect(prompt).toContain('it means no\nsequence');
    expect(prompt).toContain('IF AND ONLY IF there are more than 3 other prompts');
    // Merge, then shed back into the body, then no sequence — and never the mandatory work.
    expect(prompt).toContain('MERGE until it fits');
    expect(prompt).toContain('FALLS BACK INTO THE CURRENT BODY');
    expect(prompt).toContain('NEVER shed work the user marked as');
    // The priority words are the user's own, not a list to match against.
    expect(prompt).toContain('not whether they used any particular word for it');
  });

  it('carries the two rules a plan can break while every field is filled in', () => {
    const prompt = buildPromptEnhancementSequencePlannerSystemPromptV1();
    // An item exists on a decision about that item — not on a count, and not on habit.
    expect(prompt).toContain('AN ITEM EXISTS ONLY ON A DECISION ABOUT THAT ITEM');
    expect(prompt).toContain('Attaching a verification item to every task as a matter of course');
    // And the applicability decision is taken per item, never once for the sequence.
    expect(prompt).toContain('THE DECISION IS TAKEN PER ITEM');
    expect(prompt).toContain('"This sequence needs confirmation" is never a valid conclusion');
  });

  it('defines what a point is, naming every kind the code will accept', () => {
    // The five that are not deliverables are the reason the inventory stage exists: asked what the
    // user asked for, a constraint reads as colour on a deliverable rather than a point of its own.
    const prompt = buildPromptEnhancementSequencePlannerSystemPromptV1();
    expect(prompt).toContain('WHAT COUNTS AS A POINT is defined, not left to judgement');
    for (const kind of PROMPT_ENHANCEMENT_SEQUENCE_POINT_KINDS_V1) expect(prompt).toContain(kind);
    // And the field that records it is tied back to that list rather than left to invention.
    expect(prompt).toContain('requiredKind is one of the six kinds in SECTION 1');
  });

  it('says a point may only be held back when a sequence is actually planned', () => {
    // Otherwise the point is parked in an item that never exists, and it satisfied a landing place
    // on the way out.
    expect(buildPromptEnhancementSequencePlannerSystemPromptV1())
      .toContain('ONLY AVAILABLE WHEN YOU ARE ACTUALLY PLANNING A SEQUENCE');
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

  it('carries both properties the user can state, not only the couplings that are intrinsic', () => {
    // Two rules turn on something the user said rather than on the shape of the work, and each one
    // ships example phrasings that are illustrations of the property, never the test for it.
    const prompt = buildPromptEnhancementSequencePlannerSystemPromptV1();
    // Rule 1 — work that is not coupled on its own becomes coupled the moment they say so.
    expect(prompt).toContain('it stays together when the USER said it must');
    expect(prompt).toContain('The property is whether they said this work');
    expect(prompt).toContain('Work that is not coupled on its own becomes coupled the moment they say so');
    // Rule 4 — the same shape, about splitting the prompt rather than separating the work.
    expect(prompt).toContain('whether they said not to split it');
    // Both disarm their own examples.
    expect(prompt.match(/NOT what to match against/g)).toHaveLength(2);
  });

  it('carries the no-split instruction, as a property and on both surfaces', () => {
    // The rule exists because the user typed the constraint and it was ignored anyway, so a
    // reading that recognises only the phrasings it lists is that same failure under its own name.
    const prompt = buildPromptEnhancementSequencePlannerSystemPromptV1();
    expect(prompt).toContain('NO-SPLIT INSTRUCTION');
    expect(prompt).toContain('if the user said this must stay one prompt, there is no sequence');
    expect(prompt).toContain('NOT what to match against');
    // Wherever they wrote it: the request itself, or the details they added afterwards.
    expect(prompt).toContain('in the request itself, or in any additional');
    // And with no sequence there are no future items to park the work in.
    expect(prompt).toContain('the work does not become future items instead');
  });

  it('gives all five slicing locks the failure each one prevents', () => {
    const prompt = buildPromptEnhancementSequencePlannerSystemPromptV1();
    for (const failure of [
      'Splitting these ships half a change',              // 1 — atomic coupling
      'it becomes two instructions that will both be followed', // 2 — conditional
      'the user gets code back for two of three tasks',   // 3 — whole-prompt directives
      'the user typed the constraint and it was ignored', // 4 — no-split
      'the agent is handed "go do this" for something nobody was able to specify', // 5 — not eligible
    ]) {
      expect(prompt).toContain(failure);
    }
  });

  it('tells the model it does not word the prompts', () => {
    expect(buildPromptEnhancementSequencePlannerSystemPromptV1()).toContain('You do NOT write the prompts');
  });

  it('does not ask for the fields that are read off what it returns', () => {
    // Asking for these is asking for a second answer to a question the plan has already answered,
    // and a second answer is free to disagree with the first.
    expect(buildPromptEnhancementSequencePlannerSystemPromptV1()).toContain(
      'DO NOT return actionRiskKind, authorityMode, requiresConfirmationFloor, taskRoleLabels or any',
    );
  });
});

describe('sequence planner — the call', () => {

  it('returns the plan when the reply holds together', async () => {
    const result = await runPromptEnhancementSequencePlannerV1(call(), clientReturning(validReply()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.outcome).toBe('sequence');
    expect(result.output.items).toHaveLength(2);
    // The bound comes from the local original, not from the model.
    expect(result.output.originalLength).toBe(ORIGINAL.length);
    // Text exists ahead of acceptance, and the row has to say so.
    expect(result.output.suggestedNextPromptPolicy).toBe('generated_not_rendered_pending_acceptance');
    // The working state was checked and did not survive the call.
    expect(result.output).not.toHaveProperty('points');
    expect(result.output).not.toHaveProperty('groups');
  });

  it('refuses before spending anything when the prompt may not be planned', async () => {
    // Every entry condition is a refusal, and the config gate is silent by contract — so the point
    // is not only the reason returned but that no call was made to produce it.
    let calls = 0;
    const counting: PromptEnhancementSequencePlannerClientV1 = {
      chat: { completions: { create: async () => {
        calls += 1;
        return { choices: [{ message: { content: validReply() } }] };
      } } },
    };
    // The gate is refused through the store, since that is the only place its value comes from.
    setPromptEnhancementSequenceEnabled(store, promptEnhancementSequenceProjectKey('/gate-off'), 'off');
    expect(await runPromptEnhancementSequencePlannerV1(call({ projectRoot: '/gate-off' }), counting))
      .toEqual({ ok: false, reason: 'sequence_disabled_by_config' });

    const refusals = [
      [{ ...ENTRY, promptOrigin: 'unknown' as const }, 'prompt_origin_unknown'],
      [{ ...ENTRY, guidanceGateShow: false }, 'no_absence_signal_section'],
      [{ ...ENTRY, sentPromptOrigin: 'sequence_handoff_owned_body' as const }, 'body_is_sequence_owned'],
    ] as const;
    for (const [entry, reason] of refusals) {
      expect(await runPromptEnhancementSequencePlannerV1(call({ entry }), counting))
        .toEqual({ ok: false, reason });
    }
    expect(calls).toBe(0);
  });

  it('a single-prompt outcome is an answer, not a short sequence', async () => {
    // Nothing that governs a list applies: no items, no summary, and nothing generated ahead of
    // acceptance to declare. The summary is null rather than zeroed, because the first-popup
    // summary belongs to a sequence — zeroed, a renderer told to render what it is given would
    // announce a plan of no prompts on a prompt deliberately kept as one.
    for (const outcome of ['single_plain', 'single_with_confirmation'] as const) {
      const single = validReply({ outcome, outcomeReason: 'not_big_enough' });
      const result = await runPromptEnhancementSequencePlannerV1(call(), clientReturning(single));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.output.items).toEqual([]);
      expect(result.output.suggestedNextPromptPolicy).toBe('not_generated');
      expect(result.output.summaryData).toBeNull();
    }
    // And a planned sequence still carries it.
    const planned = await runPromptEnhancementSequencePlannerV1(call(), clientReturning(validReply()));
    expect(planned.ok && planned.output.summaryData?.remainingTaskCount).toBe(1);
  });

  it('refuses a context the returned positions would not index, before spending a call', async () => {
    let calls = 0;
    const counting: PromptEnhancementSequencePlannerClientV1 = {
      chat: { completions: { create: async () => {
        calls += 1;
        return { choices: [{ message: { content: validReply() } }] };
      } } },
    };
    // An assembled context — excerpts and refs rather than the original redacted in place. Every
    // offset it produces lands in range and addresses different words.
    expect(await runPromptEnhancementSequencePlannerV1(
      { ...call(), promptContext: 'points: fix a test; add a limiter' },
      counting,
    )).toEqual({ ok: false, reason: 'context_does_not_index_original' });
    expect(calls).toBe(0);
  });

  it('slices the LOCAL original, so a redaction marker never reaches an item', async () => {
    // The context is the original with the credential redacted in place, padded to the same width,
    // which is what lets one text's positions address the other. The slice is still cut locally:
    // read off the context, this item would carry "[redact....]" and read as no risk at all.
    const original = 'Rotate the leaked API key sk-live-9f2b now.';
    const context = 'Rotate the leaked API key [redact....] now.';
    expect(context.length).toBe(original.length);

    const reply = JSON.stringify({
      outcome: 'sequence', outcomeReason: null,
      points: [point('p1', 0), point('p2', 10), point('p3', 20)],
      groups: [group('g1', ['p1', 'p2']), group('g2', ['p3'])],
      items: [
        { itemKind: 'first_task', originalSliceRef: { start: 0, end: original.length },
          sourcePointRanges: [], roleLabel: null, dependencyOrder: 0, complexity: 'not_complex',
          complexityReason: null, decompositionGroupId: 'g1' },
        { itemKind: 'task', originalSliceRef: { start: 0, end: original.length },
          sourcePointRanges: [], roleLabel: null, dependencyOrder: 1, complexity: 'not_complex',
          complexityReason: null, decompositionGroupId: 'g2' },
      ],
      promptDirectives: [],
      summaryData: { summaryId: 's1', remainingTaskCount: 1 },
    });

    const result = await runPromptEnhancementSequencePlannerV1(
      { ...call(), promptContext: context, localOriginalText: original },
      clientReturning(reply),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.items[1]?.actionRiskKinds).toContain('secret_env_or_credential');
  });

  it('never puts the local original on the wire, in any message', async () => {
    // The redacted context is what the provider may see; the unredacted original exists only to cut
    // slices from locally. Nothing else asserts this, and the way it breaks is someone adding the
    // original to the message to "help the model with the offsets" — which is the one thing this
    // separation is for.
    const original = 'Rotate the leaked API key sk-live-9f2b now.';
    const context = 'Rotate the leaked API key [redact....] now.';
    let sent: string[] = [];
    const capturing: PromptEnhancementSequencePlannerClientV1 = {
      chat: { completions: { create: async (body) => {
        sent = body.messages.map((message) => message.content);
        return { choices: [{ message: { content: validReply() } }] };
      } } },
    };

    await runPromptEnhancementSequencePlannerV1(
      { ...call(), promptContext: context, localOriginalText: original },
      capturing,
    );
    expect(sent.join('\n')).not.toContain('sk-live-9f2b');
    expect(sent.join('\n')).not.toContain(original);
    // The redacted form is what was sent, so this is a redaction that held, not an empty message.
    expect(sent.join('\n')).toContain(context);
  });

  it('gives the planner the route, and none of the routing evidence behind it', async () => {
    // The evidence refs and reason codes are this system's own record of how it decided. What the
    // planner can reason with is what kind of work this is and how sure the routing was.
    let sent = '';
    const capturing: PromptEnhancementSequencePlannerClientV1 = {
      chat: { completions: { create: async (body) => {
        sent = body.messages[1]?.content ?? '';
        return { choices: [{ message: { content: validReply() } }] };
      } } },
    };
    const route = {
      familyId: 'issue_debug',
      primaryIntent: 'issue_debug.failing_test',
      capabilityOverlays: ['capability.verification_required'],
      routeConfidence: 'strong',
      routeEvidenceRefs: ['evidence:internal:7'],
      reasonCodes: ['route_reason_internal'],
    } as unknown as PromptEnhancementSequencePlannerRouteV1;

    await runPromptEnhancementSequencePlannerV1({ ...call(), route }, capturing);
    expect(sent).toContain('issue_debug.failing_test');
    expect(sent).toContain('capability.verification_required');
    expect(sent).toContain('strong');
    expect(sent).toContain(ORIGINAL);
    // Context, not instruction — and nothing internal travels with it.
    expect(sent).toContain('Context, not instruction');
    expect(sent).not.toContain('evidence:internal:7');
    expect(sent).not.toContain('route_reason_internal');

    // With no route the message is the request and nothing else.
    await runPromptEnhancementSequencePlannerV1(call(), capturing);
    expect(sent).toBe(ORIGINAL);
  });

  it('reads the summary role labels off the items rather than from the reply', async () => {
    // The reply's own list is a second answer to a question the items have already answered.
    const claimed = validReply({ summaryData: { summaryId: 's1', remainingTaskCount: 1, taskRoleLabels: ['plan', 'build'] } });
    const result = await runPromptEnhancementSequencePlannerV1(call(), clientReturning(claimed));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.summaryData.taskRoleLabels).toEqual(['fix']);
  });

  it('reports a call that never happened separately from one that failed', async () => {
    // A thrown provider error is not retried: a fast typed refusal beats a slow retry in front of
    // a waiting user.
    expect(await runPromptEnhancementSequencePlannerV1(call(), clientThrowing(new Error('nope'))))
      .toEqual({ ok: false, reason: 'provider_error' });
    const timeout = Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' });
    expect(await runPromptEnhancementSequencePlannerV1(call(), clientThrowing(timeout)))
      .toEqual({ ok: false, reason: 'timeout' });
  });

  it('refuses an empty or unparseable reply', async () => {
    expect(await runPromptEnhancementSequencePlannerV1(call(), clientReturning(null)))
      .toEqual({ ok: false, reason: 'invalid_output' });
    expect(await runPromptEnhancementSequencePlannerV1(call(), clientReturning('not json')))
      .toEqual({ ok: false, reason: 'invalid_output' });
    expect(await runPromptEnhancementSequencePlannerV1(call(), clientReturning('{"outcome":"sequence"}')))
      .toEqual({ ok: false, reason: 'invalid_output' });
  });

  it('refuses a malformed inventory or grouping instead of throwing on it', async () => {
    // json_object mode guarantees the reply is JSON. It guarantees nothing about the shape, and
    // this call promises its failures are typed.
    const malformed = [
      validReply({ points: [null, point('p2', 10), point('p3', 20)] }),
      validReply({ points: [{ pointId: 'p1', startOffset: 0 }, point('p2', 10), point('p3', 20)] }),
      validReply({ groups: [null, group('g2', ['p3'])] }),
      // A group that stays in the body is a decision; its absence is not a default.
      validReply({ groups: [{ groupId: 'g1', pointIds: ['p1', 'p2'] }, group('g2', ['p3'])] }),
    ];
    for (const reply of malformed) {
      await expect(runPromptEnhancementSequencePlannerV1(call(), clientReturning(reply)))
        .resolves.toEqual({ ok: false, reason: 'invalid_output' });
    }
  });

  it('refuses a reply that returns slice TEXT instead of positions', async () => {
    // Returning text is how a redaction marker would travel into wording shown under a promise
    // that the user's own words appear exactly.
    const withText = validReply({
      items: [{
        itemKind: 'first_task', originalSliceRef: 'fix the failing test', sourcePointRanges: [],
        roleLabel: null, dependencyOrder: 0, complexity: 'not_complex', complexityReason: null,
        decompositionGroupId: 'g1',
      }],
    });
    expect(await runPromptEnhancementSequencePlannerV1(call(), clientReturning(withText)))
      .toEqual({ ok: false, reason: 'invalid_output' });
  });

  it('surfaces the check that failed rather than a generic rejection', async () => {
    const ungrouped = validReply({
      points: [point('p1', 0), point('p2', 10)],
      groups: [group('g1', ['p1']), group('g2', ['p2'])],
    });
    expect(await runPromptEnhancementSequencePlannerV1(call(), clientReturning(ungrouped)))
      .toEqual({ ok: false, reason: 'grouping_stage_did_nothing' });

    const explained = validReply({ outcomeReason: 'not_big_enough' });
    expect(await runPromptEnhancementSequencePlannerV1(call(), clientReturning(explained)))
      .toEqual({ ok: false, reason: 'outcome_reason_disagrees_with_outcome' });
  });
});

describe('sequence planner — the list is checked against the rules it will be stored under', () => {
  const taskItem = (overrides: Record<string, unknown> = {}) => ({
    itemKind: 'task', originalSliceRef: { start: 10, end: 30 }, sourcePointRanges: [],
    roleLabel: null, dependencyOrder: 1, complexity: 'not_complex', complexityReason: null,
    decompositionGroupId: 'g2', ...overrides,
  });
  const firstTask = {
    itemKind: 'first_task', originalSliceRef: { start: 0, end: ORIGINAL.length },
    sourcePointRanges: [], roleLabel: 'fix', dependencyOrder: 0, complexity: 'not_complex',
    complexityReason: null, decompositionGroupId: 'g1',
  };
  const withItems = (...items: unknown[]) => validReply({
    items, summaryData: { summaryId: 's1', remainingTaskCount: items.length - 1 },
  });
  const run = (reply: string) => runPromptEnhancementSequencePlannerV1(call(), clientReturning(reply));

  it('rejects a role label the model invented', async () => {
    // The vocabulary is closed because these labels travel into a payload that declares it carries
    // none of the user's own wording, and a model asked for a "role" will readily return theirs.
    expect(await run(withItems(firstTask, taskItem({ roleLabel: 'make checkout faster' }))))
      .toEqual({ ok: false, reason: 'role_label_invalid' });
  });

  it('rejects a kind, a verdict and a position outside what the store accepts', async () => {
    expect(await run(withItems(firstTask, taskItem({ itemKind: 'sanity_check' }))))
      .toEqual({ ok: false, reason: 'item_kind_invalid' });
    expect(await run(withItems(firstTask, taskItem({ complexity: 'quite_complex' }))))
      .toEqual({ ok: false, reason: 'complexity_presence_invalid' });
    // A displaced entry serves the wrong item for the rest of the sequence.
    expect(await run(withItems(firstTask, taskItem({ dependencyOrder: 4 }))))
      .toEqual({ ok: false, reason: 'dependency_order_not_index' });
  });

  it('rejects an offset that does not address the original, rather than slicing something else', async () => {
    expect(await run(withItems(firstTask, taskItem({ originalSliceRef: { start: 0, end: ORIGINAL.length + 500 } }))))
      .toEqual({ ok: false, reason: 'offset_range_out_of_bounds' });
    // The first prompt is the request itself, not a slice of it.
    expect(await run(withItems({ ...firstTask, originalSliceRef: { start: 0, end: 4 } }, taskItem())))
      .toEqual({ ok: false, reason: 'first_task_slice_not_whole_original' });
    // And the whole-prompt directives index the same original.
    expect(await run(validReply({ promptDirectives: [{ start: 0, end: ORIGINAL.length + 1 }] })))
      .toEqual({ ok: false, reason: 'prompt_directives_invalid' });
  });

  it('rejects confirmations that are not what the verdict earns, in the order it earns them', async () => {
    const binary = (reason: string) => ({
      itemKind: 'binary_confirmation', originalSliceRef: null, sourcePointRanges: [],
      roleLabel: null, dependencyOrder: 2, complexity: null, complexityReason: reason,
      decompositionGroupId: null,
    });
    const double = { ...binary('the migration claims rows were copied'), itemKind: 'double_confirmation' };

    // A verdict of not_complex earns none.
    expect(await run(withItems(firstTask, taskItem(), binary('why'))))
      .toEqual({ ok: false, reason: 'confirmations_do_not_match_complexity' });
    // Complex earns exactly one binary.
    expect((await run(withItems(
      firstTask, taskItem({ complexity: 'complex', complexityReason: 'the limiter may never fire' }), binary('confirm the limiter fires'),
    ))).ok).toBe(true);
    // Highly complex earns the check first and the decision after it — reversed, the user is asked
    // to decide before the check that informs the decision has run. Five items, because a task
    // earning two confirmations puts enough behind the end of the list to earn a closing recap.
    const wrapUp = {
      itemKind: 'wrap_up', originalSliceRef: null, sourcePointRanges: [], roleLabel: null,
      dependencyOrder: 4, complexity: null, complexityReason: null, decompositionGroupId: null,
    };
    const highly = taskItem({
      complexity: 'highly_complex', complexityReason: 'the migration cannot be seen from here',
    });
    expect(await run(withItems(
      firstTask, highly, binary('shall I proceed'), { ...double, dependencyOrder: 3 }, wrapUp,
    ))).toEqual({ ok: false, reason: 'confirmations_do_not_match_complexity' });
    // In the locked order it holds.
    expect((await run(withItems(
      firstTask, highly, { ...double, dependencyOrder: 2 },
      { ...binary('shall I proceed'), dependencyOrder: 3 }, wrapUp,
    ))).ok).toBe(true);
  });

  it('rejects a closing recap that is not earned, and one that is not last', async () => {
    const wrapUp = (order: number) => ({
      itemKind: 'wrap_up', originalSliceRef: null, sourcePointRanges: [], roleLabel: null,
      dependencyOrder: order, complexity: null, complexityReason: null, decompositionGroupId: null,
    });
    // A recap exists if and only if there is enough behind it to recap.
    expect(await run(withItems(firstTask, taskItem(), wrapUp(2))))
      .toEqual({ ok: false, reason: 'wrap_up_presence_does_not_match_count' });
    expect(await run(withItems(
      firstTask, wrapUp(1), taskItem({ dependencyOrder: 2 }),
      taskItem({ dependencyOrder: 3 }), taskItem({ dependencyOrder: 4 }),
    ))).toEqual({ ok: false, reason: 'wrap_up_not_last_or_duplicated' });
  });

  it('rejects a list outside the bounds, and a summary that disagrees with it', async () => {
    expect(await run(withItems(firstTask))).toEqual({ ok: false, reason: 'item_count_below_min' });
    const many = [firstTask, ...Array.from({ length: 30 }, (_, i) => taskItem({ dependencyOrder: i + 1 }))];
    expect(await run(withItems(...many))).toEqual({ ok: false, reason: 'item_count_over_max' });
    // Rendered as the total, a summary short by one reports a prompt fewer than the plan holds.
    expect(await run(validReply({ summaryData: { summaryId: 's1', remainingTaskCount: 2 } })))
      .toEqual({ ok: false, reason: 'summary_remaining_count_disagrees_with_items' });
  });

  it('refuses a reply that words an item, rather than stripping the wording out', async () => {
    // Dropping it would let a plan that broke the rule look exactly like one that kept it.
    expect(await run(withItems(firstTask, taskItem({ generatedWording: 'Now add the rate limiter.' }))))
      .toEqual({ ok: false, reason: 'generated_wording_presence_invalid' });
  });
});

describe('sequence planner — the safety fields are derived, not asked for', () => {
  const ROTATION = 'Rotate the leaked API key and redeploy production so the new key is live.';
  const reply = (item: Record<string, unknown>, firstComplexity = 'not_complex'): string => JSON.stringify({
    outcome: 'sequence', outcomeReason: null,
    points: [point('p1', 0), point('p2', 10), point('p3', 20)],
    groups: [group('g1', ['p1', 'p2']), group('g2', ['p3'])],
    items: [
      { itemKind: 'first_task', originalSliceRef: { start: 0, end: ROTATION.length },
        sourcePointRanges: [], roleLabel: null, dependencyOrder: 0, complexity: firstComplexity,
        complexityReason: firstComplexity === 'not_complex' ? null : 'the rotation is not visible from here',
        decompositionGroupId: 'g1' },
      item,
    ],
    promptDirectives: [],
    summaryData: { summaryId: 's1', remainingTaskCount: 1 },
  });
  const run = (item: Record<string, unknown>, firstComplexity?: string) => runPromptEnhancementSequencePlannerV1(
    { ...call(), promptContext: ROTATION, localOriginalText: ROTATION },
    clientReturning(reply(item, firstComplexity)),
  );

  it('records EVERY risk family the slice reads as, not one of them', async () => {
    // This item cannot be split — rotating the key without redeploying leaves the old one live —
    // so it genuinely carries both, and the sentence the user sees names both.
    const result = await run({
      itemKind: 'task', originalSliceRef: { start: 0, end: ROTATION.length }, sourcePointRanges: [],
      roleLabel: null, dependencyOrder: 1, complexity: 'not_complex', complexityReason: null,
      decompositionGroupId: 'g2',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.items[1]?.actionRiskKinds)
      .toEqual(['secret_env_or_credential', 'production_release_or_external_effect']);
    expect(result.output.items[1]?.requiresConfirmationFloor).toBe(true);
    expect(result.output.items[1]?.authorityMode).toBe('execute_requested');
  });

  it('ignores safety fields the reply tries to supply', async () => {
    // Whatever arrives is discarded. Believing it would be a second classifier disagreeing with
    // the one the user is actually shown.
    const result = await run({
      itemKind: 'task', originalSliceRef: { start: 0, end: ROTATION.length }, sourcePointRanges: [],
      roleLabel: null, dependencyOrder: 1, complexity: 'not_complex', complexityReason: null,
      decompositionGroupId: 'g2',
      actionRiskKinds: ['cost_or_resource'], authorityMode: 'observe_or_literal',
      requiresConfirmationFloor: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.items[1]?.actionRiskKinds).not.toContain('cost_or_resource');
    expect(result.output.items[1]?.authorityMode).toBe('execute_requested');
    expect(result.output.items[1]?.requiresConfirmationFloor).toBe(true);
  });

  it('gives a kind that carries no slice no authority and no floor', async () => {
    // The confirmation the first task's verdict earns, so the list is the one that verdict yields.
    const result = await run({
      itemKind: 'binary_confirmation', originalSliceRef: null, sourcePointRanges: [],
      roleLabel: null, dependencyOrder: 1, complexity: null,
      complexityReason: 'the rotation changes a live credential', decompositionGroupId: null,
    }, 'complex');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.items[1]).toMatchObject({
      actionRiskKinds: [], authorityMode: null, requiresConfirmationFloor: false,
    });
  });

  it('will not accept a plan whose offsets do not address the original', async () => {
    // The derivation is fail-closed on such a ref — no slice, so no authority and no floor — and
    // the list check is what makes that state unreachable rather than merely safe: a task item
    // whose positions point outside the prompt has no verbatim text to serve, and serving it later
    // is what the offsets exist to prevent.
    expect(await run({
      itemKind: 'task', originalSliceRef: { start: 0, end: ROTATION.length + 500 },
      sourcePointRanges: [], roleLabel: null, dependencyOrder: 1, complexity: 'not_complex',
      complexityReason: null, decompositionGroupId: 'g2',
    })).toEqual({ ok: false, reason: 'offset_range_out_of_bounds' });
  });
});

describe('sequence planner — repair, and its bound', () => {
  /** A client that answers with each reply in turn, so a repair loop can be watched. */
  const clientSequence = (replies: readonly string[]) => {
    const sent: string[][] = [];
    const client: PromptEnhancementSequencePlannerClientV1 = {
      chat: { completions: { create: async (body) => {
        sent.push(body.messages.map((message) => message.content));
        const reply = replies[sent.length - 1] ?? replies[replies.length - 1] ?? '';
        return { choices: [{ message: { content: reply } }] };
      } } },
    };
    return { client, sent };
  };

  const badRole = validReply({
    items: [
      { itemKind: 'first_task', originalSliceRef: { start: 0, end: ORIGINAL.length },
        sourcePointRanges: [], roleLabel: 'fix', dependencyOrder: 0, complexity: 'not_complex',
        complexityReason: null, decompositionGroupId: 'g1' },
      { itemKind: 'task', originalSliceRef: { start: 10, end: 30 }, sourcePointRanges: [],
        roleLabel: 'make checkout faster', dependencyOrder: 1, complexity: 'not_complex',
        complexityReason: null, decompositionGroupId: 'g2' },
    ],
  });

  it('sends a rejected plan back once, naming the item and what failed', async () => {
    const { client, sent } = clientSequence([badRole, validReply()]);
    const result = await runPromptEnhancementSequencePlannerV1(call(), client);
    expect(result.ok).toBe(true);
    expect(sent).toHaveLength(2);
    // The first attempt carries no repair; the second carries the rejection and the item.
    expect(sent[0]).toHaveLength(2);
    expect(sent[1]).toHaveLength(3);
    expect(sent[1]?.[2]).toContain('role_label_invalid');
    expect(sent[1]?.[2]).toContain('Item 1 was rejected');
    // The request itself is unchanged across the repair: what failed is a correction to the plan.
    expect(sent[1]?.[1]).toBe(sent[0]?.[1]);
  });

  it('stops after three repairs and leaves the single-prompt path alone', async () => {
    const { client, sent } = clientSequence([badRole]);
    expect(await runPromptEnhancementSequencePlannerV1(call(), client))
      .toEqual({ ok: false, reason: 'role_label_invalid' });
    // One attempt plus its three repairs. After that it is not a retry problem.
    expect(sent).toHaveLength(PROMPT_ENHANCEMENT_SEQUENCE_PLANNER_MAX_REPAIRS_V1 + 1);
    expect(promptEnhancementSequencePlannerDispositionV1('role_label_invalid'))
      .toBe('no_sequence_single_prompt');
  });

  it('never repairs a provider failure — nothing came back to correct', async () => {
    let calls = 0;
    const throwing: PromptEnhancementSequencePlannerClientV1 = {
      chat: { completions: { create: async () => {
        calls += 1;
        throw Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' });
      } } },
    };
    expect(await runPromptEnhancementSequencePlannerV1(call(), throwing))
      .toEqual({ ok: false, reason: 'timeout' });
    expect(calls).toBe(1);
  });

  it('repairs a reply that did not parse, which has no item to name', async () => {
    const { client, sent } = clientSequence(['not json', validReply()]);
    expect((await runPromptEnhancementSequencePlannerV1(call(), client)).ok).toBe(true);
    expect(sent[1]?.[2]).toContain('The plan as a whole was rejected');
    expect(sent[1]?.[2]).toContain('invalid_output');
  });

  it('tells the planner to check its own plan before returning it', () => {
    // The error is one no check outside the model can find: whether an item assumes a state an
    // earlier item produced is a question about meaning.
    const prompt = buildPromptEnhancementSequencePlannerSystemPromptV1();
    expect(prompt).toContain('SECTION 6 — CHECK YOUR OWN PLAN BEFORE YOU RETURN IT');
    expect(prompt).toContain('an item that assumes a state no earlier item produced');
    // Not "no back-references" — that would forbid the normal case.
    expect(prompt).toContain('Back-references are not the problem');
  });
});

describe('sequence planner — what happens when there is no plan', () => {
  it('keeps the three dispositions apart', () => {
    // An off gate must look exactly like a prompt that did not need a sequence.
    for (const silent of [
      'sequence_disabled_by_config', 'prompt_not_user_authored', 'prompt_origin_unknown',
      'body_is_sequence_owned', 'body_is_feature_generated', 'no_absence_signal_section',
    ] as const) {
      expect(promptEnhancementSequencePlannerDispositionV1(silent)).toBe('silent_no_sequence');
    }
    // A call that could not be made is something the waiting user is owed.
    for (const failed of ['no_key', 'provider_error', 'timeout'] as const) {
      expect(promptEnhancementSequencePlannerDispositionV1(failed))
        .toBe('error_popup_no_generated_content');
    }
    // A plan that did not hold up costs the sequence and nothing else.
    for (const invalid of [
      'invalid_output', 'item_count_over_max', 'confirmations_do_not_match_complexity',
      'context_does_not_index_original',
    ] as const) {
      expect(promptEnhancementSequencePlannerDispositionV1(invalid)).toBe('no_sequence_single_prompt');
    }
  });

  it('lets the splitter produce a count and gives it nowhere to put wording', () => {
    const fallback = promptEnhancementSequenceSplitterCountV1(
      'fix the login bug, check the session timeout, check the cookie flags',
    );
    expect(fallback.pointCount).toBeGreaterThan(0);
    expect(fallback.isProvisionalSubstituteCount).toBe(true);
    // The boundary is structural: there is no text field to fill, so nothing here can produce
    // per-item wording because someone decided it would be helpful.
    expect(Object.keys(fallback).sort()).toEqual(['isProvisionalSubstituteCount', 'pointCount']);
  });

  it('takes its count from the shipping splitter rather than splitting again', () => {
    const text = 'fix the login bug, check the session timeout, check the cookie flags';
    expect(promptEnhancementSequenceSplitterCountV1(text).pointCount)
      .toBe(describePromptEnhancementSequencePlanV1(text).pointCount);
  });
});

describe('the provisional splitter labels say what they are wrong about', () => {
  const source = readFileSync(new URL('./routing-taxonomy.ts', import.meta.url), 'utf8');
  /** The doc comment immediately above a function — the label itself, not the file around it. */
  const labelAbove = (declaration: string): string => {
    const at = source.indexOf(declaration);
    expect(at).toBeGreaterThan(-1);
    const opened = source.lastIndexOf('/**', at);
    return source.slice(opened, source.indexOf('*/', opened));
  };

  it('names itself a substitute, gives the concrete failure, and forbids the tempting fix', () => {
    // The canonical case: one investigation with three things to look at, counted as three.
    expect(source.match(/PROVISIONAL SUBSTITUTE/g)).toHaveLength(2);
    expect(source.match(/DO NOT IMPROVE THE REGEX/g)).toHaveLength(2);
    expect(source.match(/fix the login bug, check the session timeout, check the cookie flags/g))
      .toHaveLength(2);
    // And what a positional ref actually means.
    expect(source).toContain('"the Nth fragment", not "the Nth thing the user asked for"');
  });

  it('describes behaviour only, because this file is public', () => {
    // A label naming internal work tells the next reader about our planning rather than about the
    // code in front of them, and it is the code they have to decide whether to trust.
    for (const label of [
      labelAbove('function userPointCoverageRefsFor'),
      labelAbove('export function describePromptEnhancementSequencePlanV1'),
    ]) {
      for (const internal of ['MPS', 'dev plan', 'milestone', 'Sequence-plan summary fix', '§']) {
        expect(label).not.toContain(internal);
      }
      // And each says plainly that it is a stand-in, in its first line rather than after the
      // mechanics — a caveat that arrives late reads as a footnote to something already believed.
      expect(label.indexOf('PROVISIONAL SUBSTITUTE')).toBeLessThan(10);
    }
  });
});
