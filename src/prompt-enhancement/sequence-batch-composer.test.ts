import { describe, expect, it } from 'vitest';
import {
  PROMPT_ENHANCEMENT_SEQUENCE_BATCH_OUTPUT_TOKEN_CAP_V1,
  PROMPT_ENHANCEMENT_SEQUENCE_BATCH_OUTPUT_TOKEN_HARD_CAP_V1,
  buildPromptEnhancementSequenceBatchItemsV1,
  promptEnhancementSequenceBatchIsCurrentV1,
  promptEnhancementSequenceSliceTextV1,
  runPromptEnhancementSequenceBatchV1,
  type PromptEnhancementSequenceBatchInputV1,
  type PromptEnhancementSequenceBatchItemV1,
} from './sequence-batch-composer.js';
import {
  PROMPT_ENHANCEMENT_SEQUENCE_BATCH_SECTIONS_V1,
  buildPromptEnhancementSequenceBatchSystemPromptV1,
} from './sequence-batch-composer-prompt.js';
import { PROMPT_ENHANCEMENT_COST_VALIDATION_RETRY_COUNT_V1 } from './cost-observability.js';
import type { PromptEnhancementSequenceItemV1 } from './sequence-payload.js';
import type { PromptEnhancementSequencePlannerClientV1 } from './sequence-planner.js';

const ORIGINAL = 'Fix the failing payment test, then add a rate limiter to the login endpoint.';
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

const task = (
  order: number,
  sliceText: string | null,
  overrides: Partial<PromptEnhancementSequenceBatchItemV1> = {},
): PromptEnhancementSequenceBatchItemV1 => ({
  dependencyOrder: order,
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

const input = (
  items: readonly PromptEnhancementSequenceBatchItemV1[],
  overrides: Partial<PromptEnhancementSequenceBatchInputV1> = {},
): PromptEnhancementSequenceBatchInputV1 => ({
  planGenerationId: 'plan-1',
  items,
  firstBodyText: 'The first prompt, already written.',
  promptDirectives: [],
  localOriginalText: ORIGINAL,
  ...overrides,
});

const replyWith = (entries: readonly { dependencyOrder: number; wording: string }[]): string =>
  JSON.stringify({ items: entries });

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
    });
    const built = buildPromptEnhancementSequenceBatchItemsV1([
      stored(0, 'first_task', { start: 0, end: ORIGINAL.length }),
      stored(1, 'task', { start: 0, end: SLICE_ONE.length }),
      stored(2, 'wrap_up', null),
    ], ORIGINAL);

    // Item 0 is context, not an item to write.
    expect(built.map((item) => item.dependencyOrder)).toEqual([1, 2]);
    expect(built[0]?.sliceText).toBe(SLICE_ONE);
    // The recap covers the whole original and the task slice — every task span before it.
    expect(built[1]?.coveredSliceTexts).toEqual([ORIGINAL, SLICE_ONE]);
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

  it('refuses one missing the ground-level clause', async () => {
    // Without it an agent answers from its own previous turn, and the confirmation confirms nothing.
    expect(await withConfirmation('Does the limiter reject the 61st request?\n\nReply YES or NO only.'))
      .toEqual({ ok: false, reason: 'confirmation_missing_ground_level_clause' });
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

  it('refuses one carrying the user\'s original wording', async () => {
    // Strictly none — and any task's slice, not only its own, which it does not have.
    expect(await withConfirmation(binaryWording(`Did you ${SLICE_TWO}?`)))
      .toEqual({ ok: false, reason: 'confirmation_carries_original_text' });
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
    // Both classes, always, and why one is worse than neither.
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
