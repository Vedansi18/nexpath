import { describe, expect, it } from 'vitest';
import {
  PROMPT_ENHANCEMENT_SEQUENCE_BATCH_OUTPUT_TOKEN_CAP_V1,
  PROMPT_ENHANCEMENT_SEQUENCE_BATCH_OUTPUT_TOKEN_HARD_CAP_V1,
  buildPromptEnhancementSequenceBatchItemsV1,
  promptEnhancementSequenceBatchDispositionV1,
  promptEnhancementSequenceBatchIsCurrentV1,
  promptEnhancementSequenceSliceTextV1,
  runPromptEnhancementSequenceBatchV1,
  type PromptEnhancementSequenceBatchInputV1,
  type PromptEnhancementSequenceBatchItemV1,
} from './sequence-batch-composer.js';
import {
  PROMPT_ENHANCEMENT_SEQUENCE_BATCH_SECTIONS_V1,
  PROMPT_ENHANCEMENT_SEQUENCE_CONFIRMATION_CLAUSES_V1,
  buildPromptEnhancementSequenceBatchSystemPromptV1,
} from './sequence-batch-composer-prompt.js';
import { PROMPT_ENHANCEMENT_COST_VALIDATION_RETRY_COUNT_V1 } from './cost-observability.js';
import type { PromptEnhancementSequenceItemV1 } from './sequence-payload.js';
import type { PromptEnhancementSequencePlannerClientV1 } from './sequence-planner.js';
import type { PromptEnhancementSafetySummaryV1 } from './contracts.js';

const ORIGINAL = 'Fix the failing payment test, then add a rate limiter to the login endpoint.';
/** The certainty bar, as the prompt dictates it. */
const BAR = 'Answer only if you are clear and sure at ground level.';
const SLICE_ONE = 'Fix the failing payment test';
const SLICE_TWO = 'add a rate limiter to the login endpoint';

/** A confirmation that carries all three mandatory parts and the format its kind fixes. */
const binaryWording = (question: string): string =>
  `${question}\n\nReply YES or NO only, on its own line with nothing after it, and only if you are`
  + ' clear and sure at ground level. Do not make any assumptions — confirm at ground level by'
  + ' reading the actual source.';

const passFailWording = (question: string): string =>
  `${question}\n\nReply PASS or FAIL only, on its own line with nothing after it, and only if you`
  + ' are clear and sure at ground level. Do not make any assumptions — confirm at ground level by'
  + ' reading the actual source.';

/** How the caller names item N. The composer carries it; it never derives one. */
const itemIdFor = (order: number): string => `seq-1:item-${order}`;

const task = (
  order: number,
  sliceText: string | null,
  overrides: Partial<PromptEnhancementSequenceBatchItemV1> = {},
): PromptEnhancementSequenceBatchItemV1 => ({
  dependencyOrder: order,
  sequenceItemId: itemIdFor(order),
  itemKind: 'task',
  sliceText,
  roleLabel: 'fix',
  complexity: 'not_complex',
  complexityReason: null,
  authorityMode: 'plan_or_review',
  requiresConfirmationFloor: false,
  coveredSliceTexts: [],
  ...overrides,
});

/** The sequence's own posture. Two of its fields are carried onto every item's verdict. */
const BASE_SAFETY = {
  validationStatus: 'valid',
  sendPolicy: 'send_current',
  sensitiveActionState: 'none',
  sourceHonestyState: 'valid',
  privacyState: 'valid',
  authorityEscalationState: 'valid',
  noForegroundSafer: true,
  noAutomaticSend: true,
} as const satisfies PromptEnhancementSafetySummaryV1;

const input = (
  items: readonly PromptEnhancementSequenceBatchItemV1[],
  overrides: Partial<PromptEnhancementSequenceBatchInputV1> = {},
): PromptEnhancementSequenceBatchInputV1 => ({
  planGenerationId: 'plan-1',
  items,
  firstBodyText: 'The first prompt, already written.',
  promptDirectives: [],
  localOriginalText: ORIGINAL,
  baseSafetySummary: BASE_SAFETY,
  providerRuntimeState: 'deterministic',
  optionalCallAvailabilityState: 'deterministic_only',
  ...overrides,
});

const replyWith = (
  entries: readonly { dependencyOrder: number; wording: string; safetyClause?: string }[],
): string => JSON.stringify({ items: entries });

const clientReturning = (...replies: readonly string[]) => {
  const bodies: { messages: string[]; maxTokens: number }[] = [];
  const client: PromptEnhancementSequencePlannerClientV1 = {
    chat: { completions: { create: async (body) => {
      bodies.push({
        messages: body.messages.map((message) => message.content),
        maxTokens: body.max_tokens,
      });
      const reply = replies[bodies.length - 1] ?? replies[replies.length - 1] ?? '';
      return { choices: [{ message: { content: reply } }] };
    } } },
  };
  return { client, bodies };
};

describe('sequence batch — one call over the whole remaining list', () => {
  it('writes every item after the first, in a single call', async () => {
    const items = [task(1, SLICE_TWO), task(2, null, { itemKind: 'binary_confirmation', complexity: null, complexityReason: 'the limiter may never fire', authorityMode: null })];
    const { client, bodies } = clientReturning(replyWith([
      { dependencyOrder: 1, wording: `${SLICE_TWO}\n\nAdd it at the edge, and keep the change small.` },
      { dependencyOrder: 2, wording: binaryWording('Does the limiter reject the 61st request in a minute?') },
    ]));

    const result = await runPromptEnhancementSequenceBatchV1(input(items), client);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.wording.size).toBe(2);
    // One call for the whole list. A loop would satisfy "written up front" and lose the reason for
    // it: each item would again be written without knowing what follows.
    expect(bodies).toHaveLength(1);
  });

  it('gives the composer the first body as context and says it is not source material', async () => {
    const { client, bodies } = clientReturning(replyWith([
      { dependencyOrder: 1, wording: `${SLICE_TWO}\n\nAdd it at the edge.` },
    ]));
    await runPromptEnhancementSequenceBatchV1(
      input([task(1, SLICE_TWO)], { firstBodyText: 'ALREADY-SENT-BODY' }),
      client,
    );
    const sent = bodies[0]?.messages.join('\n') ?? '';
    expect(sent).toContain('ALREADY-SENT-BODY');
    expect(sent).toContain('Context only — do not cut later prompts out of it');
    // The slice each item is written FROM, rather than the first body it is written after.
    expect(sent).toContain(`slice, verbatim: ${SLICE_TWO}`);
  });

  it('refuses wording for the first item, which is not the batch\'s to write', async () => {
    const { client } = clientReturning(replyWith([
      { dependencyOrder: 0, wording: 'A second first body.' },
      { dependencyOrder: 1, wording: `${SLICE_TWO}\n\nAdd it at the edge.` },
    ]));
    expect(await runPromptEnhancementSequenceBatchV1(input([task(1, SLICE_TWO)]), client))
      .toEqual({ ok: false, reason: 'first_item_must_not_be_worded' });
  });

  it('refuses an item the plan does not contain, and a plan item with no wording', async () => {
    const missing = clientReturning(replyWith([]));
    expect(await runPromptEnhancementSequenceBatchV1(input([task(1, SLICE_TWO)]), missing.client))
      .toEqual({ ok: false, reason: 'item_missing_wording' });

    const extra = clientReturning(replyWith([
      { dependencyOrder: 1, wording: `${SLICE_TWO}\n\nAdd it.` },
      { dependencyOrder: 9, wording: 'A prompt for work nobody planned.' },
    ]));
    expect(await runPromptEnhancementSequenceBatchV1(input([task(1, SLICE_TWO)]), extra.client))
      .toEqual({ ok: false, reason: 'item_not_in_plan' });
  });
});

describe('sequence batch — the user\'s own words', () => {
  it('requires a task item to carry its slice exactly', async () => {
    // Not a similarity score: the rule is that the characters the user typed are there, unchanged.
    const { client } = clientReturning(replyWith([
      { dependencyOrder: 1, wording: 'Add rate limiting to the login endpoint, please.' },
    ]));
    expect(await runPromptEnhancementSequenceBatchV1(input([task(1, SLICE_TWO)]), client))
      .toEqual({ ok: false, reason: 'slice_missing_from_wording' });
  });

  it('requires the closing recap to carry every slice it covers', async () => {
    const recap = task(3, null, { itemKind: 'wrap_up', complexity: null, authorityMode: null, coveredSliceTexts: [SLICE_ONE, SLICE_TWO] });
    const { client } = clientReturning(replyWith([
      { dependencyOrder: 1, wording: `${SLICE_TWO}\n\nAdd it at the edge.` },
      { dependencyOrder: 3, wording: `${SLICE_ONE}\n\nAnd if there were confirmation prompts, what was your response?` },
    ]));
    // The second slice is missing, which is exactly what a summary of the two would produce.
    expect(await runPromptEnhancementSequenceBatchV1(input([task(1, SLICE_TWO), recap]), client))
      .toEqual({ ok: false, reason: 'covered_slice_missing_from_recap' });
  });

  it('reads the recap\'s covered slices off the earlier tasks rather than a second field', () => {
    const stored = (
      order: number,
      kind: PromptEnhancementSequenceItemV1['itemKind'],
      ref: { start: number; end: number } | null,
    ): PromptEnhancementSequenceItemV1 => ({
      itemKind: kind,
      originalSliceRef: ref,
      sourcePointRanges: [],
      roleLabel: null,
      dependencyOrder: order,
      complexity: kind === 'task' || kind === 'first_task' ? 'not_complex' : null,
      complexityReason: null,
      generatedWording: null,
      actionRiskKinds: [],
      authorityMode: kind === 'task' || kind === 'first_task' ? 'plan_or_review' : null,
      requiresConfirmationFloor: false,
      decompositionGroupId: 'g1',
      itemValidationGraph: null,
      itemSafetyClauseRef: null,
    });
    const built = buildPromptEnhancementSequenceBatchItemsV1([
      stored(0, 'first_task', { start: 0, end: ORIGINAL.length }),
      stored(1, 'task', { start: 0, end: SLICE_ONE.length }),
      stored(2, 'wrap_up', null),
    ], ORIGINAL, itemIdFor);

    // Item 0 is context, not an item to write.
    expect(built.map((item) => item.dependencyOrder)).toEqual([1, 2]);
    expect(built[0]?.sliceText).toBe(SLICE_ONE);
    // The first item's slice IS the whole original, so the task slice sits inside it. Asking the
    // recap for both would put the same words in front of the user twice, in the one item whose
    // purpose is that they read it — and dropping the contained span loses no character.
    expect(built[1]?.coveredSliceTexts).toEqual([ORIGINAL]);
  });

  it('carries the caller\'s id for each item, and never mints one', () => {
    // This is the only handle a per-item verdict has back to its item, and every other site in the
    // system — the continuation event, the popup identity, the delivery record, the packager —
    // receives that id from the runtime. A format invented here would name the same item in a way
    // nothing else produces or looks up.
    const stored = (order: number, kind: PromptEnhancementSequenceItemV1['itemKind']): PromptEnhancementSequenceItemV1 => ({
      itemKind: kind, originalSliceRef: null, sourcePointRanges: [], roleLabel: null,
      dependencyOrder: order, complexity: kind === 'wrap_up' ? null : 'not_complex',
      complexityReason: null, generatedWording: null, actionRiskKinds: [],
      authorityMode: kind === 'wrap_up' ? null : 'plan_or_review', requiresConfirmationFloor: false,
      decompositionGroupId: 'g1', itemValidationGraph: null, itemSafetyClauseRef: null,
    });
    // Deliberately a shape no derivation here would produce, so a re-derived id cannot pass.
    const opaque = (order: number): string => `9f3c-${order * 7 + 11}-opaque`;
    const built = buildPromptEnhancementSequenceBatchItemsV1(
      [stored(0, 'first_task'), stored(1, 'task'), stored(2, 'task')],
      ORIGINAL,
      opaque,
    );
    expect(built.map((entry) => entry.sequenceItemId)).toEqual([opaque(1), opaque(2)]);
    // And each item got its own, not the one beside it.
    expect(built[0]?.sequenceItemId).not.toBe(built[1]?.sequenceItemId);
  });

  it('keeps two slices that cover different spans', () => {
    // De-duplication drops what is contained, never what is merely adjacent.
    const stored = (order: number, ref: { start: number; end: number } | null, kind: PromptEnhancementSequenceItemV1['itemKind']): PromptEnhancementSequenceItemV1 => ({
      itemKind: kind, originalSliceRef: ref, sourcePointRanges: [], roleLabel: null,
      dependencyOrder: order, complexity: kind === 'wrap_up' ? null : 'not_complex',
      complexityReason: null, generatedWording: null, actionRiskKinds: [],
      authorityMode: kind === 'wrap_up' ? null : 'plan_or_review', requiresConfirmationFloor: false,
      decompositionGroupId: 'g1', itemValidationGraph: null, itemSafetyClauseRef: null,
    });
    const built = buildPromptEnhancementSequenceBatchItemsV1([
      stored(0, { start: 0, end: SLICE_ONE.length }, 'first_task'),
      stored(1, { start: ORIGINAL.indexOf(SLICE_TWO), end: ORIGINAL.indexOf(SLICE_TWO) + SLICE_TWO.length }, 'task'),
      stored(2, null, 'wrap_up'),
    ], ORIGINAL, itemIdFor);
    expect(built.at(-1)?.coveredSliceTexts).toEqual([SLICE_ONE, SLICE_TWO]);
  });

  it('resolves a slice and refuses to invent one from a bad range', () => {
    expect(promptEnhancementSequenceSliceTextV1({ start: 0, end: SLICE_ONE.length }, ORIGINAL))
      .toBe(SLICE_ONE);
    expect(promptEnhancementSequenceSliceTextV1({ start: 0, end: ORIGINAL.length + 1 }, ORIGINAL))
      .toBeNull();
    expect(promptEnhancementSequenceSliceTextV1(null, ORIGINAL)).toBeNull();
  });
});

describe('sequence batch — confirmations', () => {
  const confirmation = (
    order: number,
    kind: 'double_confirmation' | 'cross_confirmation' | 'binary_confirmation',
  ): PromptEnhancementSequenceBatchItemV1 =>
    task(order, null, { itemKind: kind, complexity: null, complexityReason: 'why this one', authorityMode: null, roleLabel: null });

  const withConfirmation = (wording: string, kind: 'double_confirmation' | 'cross_confirmation' | 'binary_confirmation' = 'binary_confirmation') =>
    runPromptEnhancementSequenceBatchV1(
      input([task(1, SLICE_TWO), confirmation(2, kind)]),
      clientReturning(replyWith([
        { dependencyOrder: 1, wording: `${SLICE_TWO}\n\nAdd it at the edge.` },
        { dependencyOrder: 2, wording },
      ])).client,
    );

  it('accepts one carrying all three mandatory parts in its kind\'s format', async () => {
    expect((await withConfirmation(binaryWording('Does the limiter reject the 61st request?'))).ok)
      .toBe(true);
  });

  it('leaves the certainty bar and the anti-assumption clause to the composer itself', async () => {
    // Both are requirements on MEANING, not fixed strings — a certainty bar can be worded many
    // ways. A check here that looks for the sentence we dictated rejects a correct paraphrase, and
    // the item is then repaired until the bound runs out and the whole sequence is lost. So the
    // prompt asks the composer to check its own work, and this function does not second-guess it.
    const paraphrased = 'Does the limiter reject the 61st request? Reply YES or NO only. Give the'
      + ' answer on its own line, with nothing after it. Answer only if you are certain at the'
      + ' ground level. Do not assume — go and read the actual source before you confirm.';
    expect((await withConfirmation(paraphrased)).ok).toBe(true);

    // And the same for one genuinely missing the clause. Letting it through is the cost of not
    // rejecting the paraphrase above, and it is the trade the plan makes deliberately.
    const noClause = 'Does the limiter reject the 61st request? Reply YES or NO only. Give the'
      + ' answer on its own line, with nothing after it. Answer only if you are clear and sure at'
      + ' ground level.';
    expect((await withConfirmation(noClause)).ok).toBe(true);
  });

  it('asks the composer, in the prompt, to check the three parts before replying', async () => {
    // The check moved rather than disappeared. If the instruction is not in the prompt, nothing
    // anywhere is asking the question and the parts are simply unenforced.
    const { client, bodies } = clientReturning(replyWith([
      { dependencyOrder: 1, wording: binaryWording('Does it reject?') },
    ]));
    await runPromptEnhancementSequenceBatchV1(
      input([{ ...task(1, null), itemKind: 'binary_confirmation' }]), client,
    );
    const systemPrompt = bodies[0]?.messages[0] ?? '';
    expect(systemPrompt).toContain('CHECK YOUR OWN WORK BEFORE YOU RETURN IT');
    expect(systemPrompt).toContain('all three mandatory parts');
  });

  it('gives the two meaning-level clauses no anchor to be checked against', () => {
    // A guard on the shape, because the removed check is easy to re-add: two anchors sitting beside
    // a clause constant read as something meant to be looked for. Both sentences are still dictated
    // — the prompt reproduces them — and only the answer-alone demand, which is a fixed instruction
    // rather than a shade of meaning, carries one.
    const clauses: Record<string, Record<string, unknown>> = PROMPT_ENHANCEMENT_SEQUENCE_CONFIRMATION_CLAUSES_V1;
    expect(clauses['certaintyBar']?.['anchor']).toBeUndefined();
    expect(clauses['antiAssumption']?.['anchor']).toBeUndefined();
    expect(clauses['answerAlone']?.['anchor']).toBe('on its own line');

    const systemPrompt = buildPromptEnhancementSequenceBatchSystemPromptV1();
    expect(systemPrompt).toContain(PROMPT_ENHANCEMENT_SEQUENCE_CONFIRMATION_CLAUSES_V1.certaintyBar.sentence);
    expect(systemPrompt).toContain(PROMPT_ENHANCEMENT_SEQUENCE_CONFIRMATION_CLAUSES_V1.antiAssumption.sentence);
  });

  it('accepts the clauses however they are spelt or wrapped', async () => {
    // "ground-level" and "ground level" are one phrase spelt two ways, and a clause that wrapped
    // across a line has a newline where the sentence had a space. Neither is a different clause,
    // and rejecting either costs the whole sequence.
    const hyphenated = 'Does the limiter reject the 61st request?\n\nReply YES or NO only. Give the'
      + ' answer on its own\nline, with nothing after it. Answer'
      + ' only if you are clear and sure at\nground-level. Do not make any assumptions; confirm at'
      + ' ground-level by reading the actual source.';
    expect((await withConfirmation(hyphenated)).ok).toBe(true);
  });

  it('refuses a confirmation that never demands the answer stand alone', async () => {
    // The DEMAND, in the question — never the reply's shape, which Nexpath does not read. Without
    // it the agent writes "Yes, because…" and three paragraphs of reasoning, and the answer the
    // user has to find at a glance is buried in the middle of them.
    const noDemand = 'Does the limiter reject the 61st request?\n\nReply YES or NO only. Answer only'
      + ' if you are clear and sure at ground level. Do not make any assumptions; confirm at ground'
      + ' level by reading the actual source.';
    expect(await withConfirmation(noDemand))
      .toEqual({ ok: false, reason: 'confirmation_missing_answer_alone_demand' });
  });

  it('refuses the wrong format for the kind, and two formats in one item', async () => {
    expect(await withConfirmation(passFailWording('Does the limiter reject the 61st request?')))
      .toEqual({ ok: false, reason: 'confirmation_format_wrong_for_kind' });
    expect(await withConfirmation(binaryWording('Was it checked?'), 'double_confirmation'))
      .toEqual({ ok: false, reason: 'confirmation_format_wrong_for_kind' });
    // Mixing leaves the agent choosing which token to answer in.
    const mixed = `${binaryWording('Does it reject?')}\n(Or reply PASS or FAIL.)`;
    expect(await withConfirmation(mixed))
      .toEqual({ ok: false, reason: 'confirmation_format_wrong_for_kind' });
  });

  it('accepts the anti-assumption clause in capitals, which contains the other format token', async () => {
    // "DO NOT" contains NO. Under plain containment this correctly formed PASS/FAIL confirmation
    // was rejected for carrying the clause it is malformed without — and the cost was not one item
    // but three repairs and then no sequence at all.
    const shouted = 'Did the migration copy every row?\n\nReply PASS or FAIL only, on its own line.'
      + ` ${BAR} DO NOT make any assumptions; confirm at ground level by reading the actual source.`;
    expect((await withConfirmation(shouted, 'double_confirmation')).ok).toBe(true);
  });

  it('lets a confirmation name its subject when the slice is a single word', async () => {
    // "Fix the login bug, then deploy" gives a slice of "deploy", and a question about that work
    // cannot avoid the word. Under plain containment this was rejected, repaired three times, and
    // the sequence lost — for the only sentence the rule leaves available.
    const conf = 'Did the deploy finish without a rollback?\n\nReply YES or NO only, on its own'
      + ` line. ${BAR} Do not make any assumptions; confirm at ground level by reading the actual source.`;
    const result = await runPromptEnhancementSequenceBatchV1(
      input([
        task(1, 'deploy', { authorityMode: 'execute_requested' }),
        task(2, null, { itemKind: 'binary_confirmation', complexity: null, complexityReason: 'why', authorityMode: null }),
      ], { localOriginalText: 'Fix the login bug, then deploy' }),
      clientReturning(replyWith([
        { dependencyOrder: 1, wording: 'deploy — push the built artefact to production.' },
        { dependencyOrder: 2, wording: conf },
      ])).client,
    );
    expect(result.ok).toBe(true);
  });

  it('refuses one carrying the user\'s original wording', async () => {
    // Strictly none — and any task's slice, not only its own, which it does not have.
    expect(await withConfirmation(binaryWording(`Did you ${SLICE_TWO}?`)))
      .toEqual({ ok: false, reason: 'confirmation_carries_original_text' });
  });
});

describe('sequence batch — the verdict each item leaves with', () => {
  const FLOOR = 'Tell me the revert path and ask me for go-ahead before you start.';

  const runOne = async (
    overrides: Partial<PromptEnhancementSequenceBatchItemV1>,
    entry: { wording: string; safetyClause?: string },
  ) => runPromptEnhancementSequenceBatchV1(
    input([task(1, SLICE_TWO, overrides)]),
    clientReturning(replyWith([{ dependencyOrder: 1, ...entry }])).client,
  );

  it('produces one, so the packager has something to report', async () => {
    // Without this the field is null on every stored item and the packager refuses every
    // continuation — the sequence is offered, accepted, and then stops after the first prompt.
    const result = await runOne({}, { wording: `Do this: ${SLICE_TWO}` });
    expect(result.ok).toBe(true);
    const item = result.ok ? result.composed.get(1) : undefined;
    expect(item?.validationGraph.phaseStates[0]?.stage).toBe('sequence');
    expect(item?.validationGraph.failures).toEqual([]);
    // The invariants ride along and are not flipped to make a sequence check fit.
    expect(item?.validationGraph.evaluatesAgentResponseQuality).toBe(false);
    expect(item?.validationGraph.canAutoAdvanceSequencePointer).toBe(false);
  });

  it('never emits a verdict whose summary disagrees with its own failures', async () => {
    // The composer no longer states the two fields at all — the type will not take them — so the
    // only value they can hold is the one the check produced. Before this, they were set to `valid`
    // above the call that discovered the escalation.
    const result = await runOne({}, { wording: `Do this: ${SLICE_TWO}` });
    expect(result.ok).toBe(true);
    const graph = result.ok ? result.composed.get(1)?.validationGraph : undefined;
    expect(graph?.failures).toEqual([]);
    expect(graph?.safetyState.validationStatus).toBe('valid');
    expect(graph?.safetyState.authorityEscalationState).toBe('valid');
  });

  it('carries the sequence posture and decides the per-item fields itself', async () => {
    const result = await runOne({}, { wording: `Do this: ${SLICE_TWO}` });
    const state = result.ok ? result.composed.get(1)?.validationGraph.safetyState : undefined;
    // Carried: the sequence's source and privacy posture, which composition does not change.
    expect(state?.sourceHonestyState).toBe('valid');
    expect(state?.privacyState).toBe('valid');
    // Decided here: an item that needed no floor reports none, rather than inheriting one.
    expect(state?.sensitiveActionState).toBe('none');
  });

  it('records the floor\'s position, and it resolves to the sentence the composer wrote', async () => {
    // The whole point of storing it: the floor is written in the composer's own words, so the only
    // way to check later that the user did not delete it is to know where it was.
    const wording = `Rotate the key.\n\n${SLICE_TWO}\n\n${FLOOR}`;
    const result = await runOne({ requiresConfirmationFloor: true }, { wording, safetyClause: FLOOR });
    expect(result.ok).toBe(true);
    const item = result.ok ? result.composed.get(1) : undefined;
    const ref = item?.safetyClauseRef;
    expect(ref).not.toBeNull();
    expect(wording.slice(ref?.start ?? 0, ref?.end ?? 0)).toBe(FLOOR);
    expect(item?.validationGraph.safetyState.sensitiveActionState).toBe('confirmation_required_present');
  });

  it('refuses an item that needed a floor and returned none', async () => {
    expect(await runOne({ requiresConfirmationFloor: true }, { wording: `Do this: ${SLICE_TWO}` }))
      .toEqual({ ok: false, reason: 'safety_clause_missing' });
  });

  it('refuses a clause that is not actually in the wording', async () => {
    // A clause reported but absent gives a position that points at other text, and the edit check
    // would then guard whatever happens to sit there.
    expect(await runOne(
      { requiresConfirmationFloor: true },
      { wording: `Do this: ${SLICE_TWO}`, safetyClause: FLOOR },
    )).toEqual({ ok: false, reason: 'safety_clause_not_found_in_wording' });
  });

  it('refuses a clause on an item that needed no floor', async () => {
    // Marking the wrong item is worse than marking none: the real floor then goes unwatched while
    // an ordinary sentence elsewhere is guarded.
    expect(await runOne({}, { wording: `Do this: ${SLICE_TWO}\n\n${FLOOR}`, safetyClause: FLOOR }))
      .toEqual({ ok: false, reason: 'safety_clause_present_without_floor' });
  });

  it('leaves no floor position on an item that needed none', async () => {
    const result = await runOne({}, { wording: `Do this: ${SLICE_TWO}` });
    expect(result.ok ? result.composed.get(1)?.safetyClauseRef : 'missing').toBeNull();
  });
});

describe('sequence batch — the whole-prompt instructions', () => {
  const directive = 'show findings first, no code';

  it('carries a directive to the composer for every item', async () => {
    const { client, bodies } = clientReturning(replyWith([
      { dependencyOrder: 1, wording: `${SLICE_TWO}\n\n${directive}` },
    ]));
    await runPromptEnhancementSequenceBatchV1(
      input([task(1, SLICE_TWO)], { promptDirectives: [directive] }),
      client,
    );
    expect(bodies[0]?.messages.join('\n')).toContain(directive);
  });

  it('refuses directive text reproduced inside a confirmation', async () => {
    // There it constrains what may be asked; it is carried as wording on task kinds only.
    const confirmation = task(2, null, { itemKind: 'binary_confirmation', complexity: null, complexityReason: 'why', authorityMode: null });
    const { client } = clientReturning(replyWith([
      { dependencyOrder: 1, wording: `${SLICE_TWO}\n\n${directive}` },
      { dependencyOrder: 2, wording: binaryWording(`Did the build resolve? (${directive})`) },
    ]));
    expect(await runPromptEnhancementSequenceBatchV1(
      input([task(1, SLICE_TWO), confirmation], { promptDirectives: [directive] }),
      client,
    )).toEqual({ ok: false, reason: 'confirmation_reproduces_directive_text' });
  });
});

describe('sequence batch — safety', () => {
  it('refuses wording that exceeds the item\'s own authority', async () => {
    // The single-prompt validator never sees this text. A sequence item is a generated body, and
    // without the per-item check a plan-or-review slice could be worded as an instruction to act.
    const slice = 'review the deployment script';
    const { client } = clientReturning(replyWith([
      { dependencyOrder: 1, wording: `${slice}\n\nThen deploy it to production and delete the old release.` },
    ]));
    const result = await runPromptEnhancementSequenceBatchV1(
      input([task(1, slice)], { localOriginalText: slice }),
      client,
    );
    expect(result).toEqual({ ok: false, reason: 'wording_exceeds_item_authority' });
  });
});

describe('sequence batch — repair, its bound, and the plan it belongs to', () => {
  it('sends a rejected batch back, naming the item and what failed', async () => {
    const bad = replyWith([{ dependencyOrder: 1, wording: 'no slice here' }]);
    const good = replyWith([{ dependencyOrder: 1, wording: `${SLICE_TWO}\n\nAdd it.` }]);
    const { client, bodies } = clientReturning(bad, good);

    expect((await runPromptEnhancementSequenceBatchV1(input([task(1, SLICE_TWO)]), client)).ok).toBe(true);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]?.messages[2]).toContain('slice_missing_from_wording');
    expect(bodies[1]?.messages[2]).toContain('Item 1 was rejected');
    // A repair asks at the hard cap: one reason a batch is unusable is that it did not fit.
    expect(bodies[0]?.maxTokens).toBe(PROMPT_ENHANCEMENT_SEQUENCE_BATCH_OUTPUT_TOKEN_CAP_V1);
    expect(bodies[1]?.maxTokens).toBe(PROMPT_ENHANCEMENT_SEQUENCE_BATCH_OUTPUT_TOKEN_HARD_CAP_V1);
  });

  it('stops after three repairs, and never repairs a provider failure', async () => {
    const bad = replyWith([{ dependencyOrder: 1, wording: 'no slice here' }]);
    const { client, bodies } = clientReturning(bad);
    expect(await runPromptEnhancementSequenceBatchV1(input([task(1, SLICE_TWO)]), client))
      .toEqual({ ok: false, reason: 'slice_missing_from_wording' });
    expect(bodies).toHaveLength(PROMPT_ENHANCEMENT_COST_VALIDATION_RETRY_COUNT_V1 + 1);

    let calls = 0;
    const throwing: PromptEnhancementSequencePlannerClientV1 = {
      chat: { completions: { create: async () => {
        calls += 1;
        throw Object.assign(new Error('down'), { name: 'APIConnectionError' });
      } } },
    };
    expect(await runPromptEnhancementSequenceBatchV1(input([task(1, SLICE_TWO)]), throwing))
      .toEqual({ ok: false, reason: 'provider_error' });
    expect(calls).toBe(1);
  });

  it('will not start a call it knows cannot finish', async () => {
    let calls = 0;
    const counting: PromptEnhancementSequencePlannerClientV1 = {
      chat: { completions: { create: async () => {
        calls += 1;
        return { choices: [{ message: { content: replyWith([]) } }] };
      } } },
    };
    const now = 1_000_000;
    expect(await runPromptEnhancementSequenceBatchV1(
      input([task(1, SLICE_TWO)], { deadlineAtMs: now + 1, nowMs: () => now }),
      counting,
    )).toEqual({ ok: false, reason: 'batch_deadline_exceeded' });
    expect(calls).toBe(0);
  });

  it('a result belongs to the plan it was composed for, and never to the one that replaced it', async () => {
    // Pressing Shorter a few seconds into the batch is the ordinary case, not a race — the button
    // is on the popup the batch started with.
    const { client } = clientReturning(replyWith([
      { dependencyOrder: 1, wording: `${SLICE_TWO}\n\nAdd it.` },
    ]));
    const result = await runPromptEnhancementSequenceBatchV1(
      input([task(1, SLICE_TWO)], { planGenerationId: 'plan-before-shorter' }),
      client,
    );
    expect(promptEnhancementSequenceBatchIsCurrentV1(result, 'plan-before-shorter')).toBe(true);
    expect(promptEnhancementSequenceBatchIsCurrentV1(result, 'plan-after-shorter')).toBe(false);
    // A failure is never current either — there is nothing to apply.
    expect(promptEnhancementSequenceBatchIsCurrentV1({ ok: false, reason: 'invalid_output' }, 'plan-1'))
      .toBe(false);
  });
});

describe('sequence batch — the prompt', () => {
  const prompt = buildPromptEnhancementSequenceBatchSystemPromptV1();

  it('carries all eight sections', () => {
    expect(PROMPT_ENHANCEMENT_SEQUENCE_BATCH_SECTIONS_V1).toHaveLength(8);
    for (const heading of [
      'SECTION 1 — HOW MUCH EACH PROMPT GETS',
      'SECTION 2 — THE USER\'S OWN WORDS',
      'SECTION 3 — WHAT A CONFIRMATION PROMPT MUST CONTAIN',
      'SECTION 4 — NEVER ASK WHETHER SOMETHING IS READY',
      'SECTION 5 — SAFETY',
      'SECTION 6 — THE USER\'S WHOLE-PROMPT INSTRUCTIONS',
      'SECTION 7 — CONDITIONS GO IN THE PROMPT',
      'SECTION 8 — YOU ARE WRITING THE WHOLE SEQUENCE AT ONCE',
    ]) {
      expect(prompt).toContain(heading);
    }
  });

  it('carries the rules no check can enforce, which is why they must be in the prompt', () => {
    // The weight rule, and the summary ban that goes with it.
    expect(prompt).toContain('section of guidance — or NONE');
    expect(prompt).toContain('NEVER SUMMARISE THE ORIGINAL REQUEST');
    // Both classes for the two kinds that take them, and why one is worse than neither.
    expect(prompt).toContain('CLASS A');
    expect(prompt).toContain('CLASS B');
    expect(prompt).toContain('One without the other is worse than neither');
    // The three enforcement rules that travel with the format.
    expect(prompt).toContain('ALONE, on its own line, with nothing after it');
    expect(prompt).toContain('NEVER phrase the question negatively');
    expect(prompt).toContain('ONE question per item');
    // Tone, stated as a standard rather than a volume.
    expect(prompt).toContain('Firmness comes from the standard being demanded');
    // The readiness discipline and its four steps.
    expect(prompt).toContain('EMIT NOTHING');
    expect(prompt).toContain('DISCOVERED TO BE FALSE');
    // Irreversibility judged from the work, never from a verb list.
    expect(prompt).toContain('Not from a list of dangerous-sounding verbs');
    // The condition is the agent's to evaluate.
    expect(prompt).toContain('so that the\nAGENT evaluates it');
  });

  it('says how a directive lands on a confirmation, with the case that decides it', () => {
    expect(prompt).toContain('CONSTRAIN WHAT MAY BE ASKED, and are never reproduced as text');
    expect(prompt).toContain('hands back code after the\nuser said no code');
  });

  it('makes the recap a report, and keeps its line even with no confirmations', () => {
    expect(prompt).toContain('No summary, no paraphrase, no condensing');
    expect(prompt).toContain('It is a REPORT, never a re-check');
    expect(prompt).toContain('Never ask whether the answer was correct');
    expect(prompt).toContain('Emit this line even when the sequence raised no confirmations');
  });

  it('tells the composer not to renumber, reorder, add or drop an item', () => {
    expect(prompt).toContain('renumber, do not reorder, do not add an item, and do not leave one out');
    expect(prompt).toContain('it is already written and is not yours to write');
  });
});

describe('sequence batch — what a failed batch leaves the user with', () => {
  it('tells a fault apart from a plan that did not hold up', () => {
    // A call that could not be made is something the waiting user should be told about. A reply
    // that arrived and did not hold up costs the sequence and nothing else — the single-prompt
    // path is untouched and they still get their prompt.
    for (const fault of ['no_key', 'provider_error', 'timeout'] as const) {
      expect(promptEnhancementSequenceBatchDispositionV1(fault))
        .toBe('error_popup_no_generated_content');
    }
    for (const invalid of [
      'invalid_output', 'batch_deadline_exceeded', 'item_missing_wording', 'item_not_in_plan',
      'first_item_must_not_be_worded', 'slice_missing_from_wording',
      'covered_slice_missing_from_recap', 'confirmation_carries_original_text',
      'confirmation_format_wrong_for_kind', 'confirmation_missing_answer_alone_demand',
      'safety_clause_missing', 'safety_clause_not_found_in_wording',
      'safety_clause_present_without_floor',
      'confirmation_reproduces_directive_text', 'wording_exceeds_item_authority',
    ] as const) {
      expect(promptEnhancementSequenceBatchDispositionV1(invalid)).toBe('no_sequence_single_prompt');
    }
  });
});

describe('sequence batch — the prompt carries what the checks look for', () => {
  const prompt = buildPromptEnhancementSequenceBatchSystemPromptV1();

  it('dictates all three mandatory sentences, in the words the constant holds', () => {
    // The constants exist so the instruction and the rule cannot drift. Nothing pinned that the
    // prompt actually carries them: drop the interpolation and the composer is left describing two
    // of them from memory, while the suite stays green.
    for (const clause of Object.values(PROMPT_ENHANCEMENT_SEQUENCE_CONFIRMATION_CLAUSES_V1)) {
      expect(prompt).toContain(clause.sentence);
    }
    // The one anchor still read lives inside its own dictated sentence, which is what keeps the
    // instruction and the check from drifting apart.
    const { sentence, anchor } = PROMPT_ENHANCEMENT_SEQUENCE_CONFIRMATION_CLAUSES_V1.answerAlone;
    expect(sentence).toContain(anchor);
    expect(prompt).toContain('Reproduce 2 and 3 in those words');
  });

  it('tells the composer the rules the checks enforce, so it is not caught by them', () => {
    // A check with no matching instruction is one the composer hits by accident: three repairs and
    // the sequence lost, for output that followed the only instruction it had.
    //
    // Ruling C — a confirmation carries none of the user's words. The verbatim section said the
    // opposite by implication, since a confirmation arrives in the same list as the task items.
    expect(prompt).toContain('A CONFIRMATION CARRIES NONE OF THE USER');
    expect(prompt).toContain('asking about the same work');
    // And a confirmation carries no section either. Padding a question is the dilution the whole
    // confirmation layer is built against.
    expect(prompt).toContain('No section of guidance,');
    expect(prompt).toContain('no rewrite, no slice of the user');
    // The verbatim rule still says which items DO carry the user's words.
    expect(prompt).toContain('A task item comes with a slice');
    expect(prompt).toContain('The final recap carries the slices it covers the same way');
  });

  it('holds both classes to the two kinds that take them, and frees the cross', () => {
    // A cross exists to come at the work from another angle. Handed the same two questions as the
    // double it follows, it stops being a different angle and becomes a second double.
    expect(prompt).toContain('A binary_confirmation and a double_confirmation cover BOTH of them');
    expect(prompt).toContain('it decides its own wording');
    expect(prompt).toContain('reference for register and rigour, not as a checklist to reproduce');
    // The freedom is about the angle only.
    expect(prompt).toContain('cross_confirmation without exception');
  });
});
