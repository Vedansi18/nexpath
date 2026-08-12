import { describe, expect, it } from 'vitest';
import {
  promptEnhancementSequenceSummaryFactsV1,
  promptEnhancementSequenceSummaryIsCurrentV1,
  runPromptEnhancementSequenceSummaryWordingV1,
  type PromptEnhancementSequenceSummaryInputV1,
} from './sequence-summary-wording.js';
import { PROMPT_ENHANCEMENT_COST_VALIDATION_RETRY_COUNT_V1 } from './cost-observability.js';
import type { PromptEnhancementSequenceItemV1 } from './sequence-payload.js';
import type { PromptEnhancementSequencePlannerClientV1 } from './sequence-planner.js';

const ORIGINAL = 'Fix the failing payment test, then add a rate limiter to the login endpoint.';

const item = (
  order: number,
  itemKind: PromptEnhancementSequenceItemV1['itemKind'],
  roleLabel: PromptEnhancementSequenceItemV1['roleLabel'] = null,
): PromptEnhancementSequenceItemV1 => ({
  itemKind,
  originalSliceRef: null,
  sourcePointRanges: [],
  roleLabel,
  dependencyOrder: order,
  complexity: null,
  complexityReason: null,
  generatedWording: null,
  actionRiskKinds: [],
  authorityMode: null,
  requiresConfirmationFloor: false,
  decompositionGroupId: null,
  itemValidationGraph: null,
});

const input = (
  overrides: Partial<PromptEnhancementSequenceSummaryInputV1> = {},
): PromptEnhancementSequenceSummaryInputV1 => ({
  planGenerationId: 'plan-1',
  facts: {
    totalPromptCount: 7,
    taskCount: 3,
    confirmationCount: 3,
    wrapUpCount: 1,
    taskRoleLabels: ['fix', 'review'],
  },
  localOriginalText: ORIGINAL,
  ...overrides,
});

const reply = (publicSafeText: string): string => JSON.stringify({ publicSafeText });

const clientReturning = (...replies: readonly string[]) => {
  const bodies: string[][] = [];
  const client: PromptEnhancementSequencePlannerClientV1 = {
    chat: { completions: { create: async (body) => {
      bodies.push(body.messages.map((message) => message.content));
      const next = replies[bodies.length - 1] ?? replies[replies.length - 1] ?? '';
      return { choices: [{ message: { content: next } }] };
    } } },
  };
  return { client, bodies };
};

const GOOD = 'This task is planned as 7 prompts: 3 sub-task prompts, 3 confirmation/check prompts,'
  + ' and 1 final wrap-up prompt.';

describe('sequence summary wording — the counts come off the list', () => {
  it('counts every item, including the first, and collects the distinct roles', () => {
    // The figure the user sees is the TOTAL. The planner's own remaining count is items AFTER the
    // first, and rendered as the total it reports one prompt fewer than the plan holds.
    const facts = promptEnhancementSequenceSummaryFactsV1([
      item(0, 'first_task', 'fix'),
      item(1, 'task', 'review'),
      item(2, 'binary_confirmation'),
      item(3, 'task', 'fix'),
      item(4, 'double_confirmation'),
      item(5, 'binary_confirmation'),
      item(6, 'wrap_up'),
    ]);
    expect(facts).toEqual({
      totalPromptCount: 7,
      taskCount: 3,
      confirmationCount: 3,
      wrapUpCount: 1,
      taskRoleLabels: ['fix', 'review'],
    });
  });
});

describe('sequence summary wording — the call', () => {
  it('returns the sentence, and never sends the user\'s words to write it', async () => {
    const { client, bodies } = clientReturning(reply(GOOD));
    const result = await runPromptEnhancementSequenceSummaryWordingV1(input(), client);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.publicSafeText).toBe(GOOD);
    // Counts and labels are the whole input. There is no wording in it to leak, which is what makes
    // the line public-safe by construction rather than by instruction.
    const sent = bodies[0]?.join('\n') ?? '';
    expect(sent).not.toContain(ORIGINAL);
    expect(sent).not.toContain('payment');
    expect(sent).toContain('total prompts: 7');
    expect(sent).toContain('broad roles: fix, review');
  });

  it('tells the model the number is the total and not a remaining count', async () => {
    const { client, bodies } = clientReturning(reply(GOOD));
    await runPromptEnhancementSequenceSummaryWordingV1(input(), client);
    const system = bodies[0]?.[0] ?? '';
    expect(system).toContain('THE NUMBER IS THE TOTAL');
    // Listing the upcoming prompts individually was never approved.
    expect(system).toContain('DO NOT list the upcoming prompts individually');
    expect(system).toContain('you must not guess at it');
  });

  it('refuses a sentence whose number is not the plan\'s', async () => {
    // The one failure this line cannot survive: its whole job is to be trusted.
    const wrong = reply('This task is planned as 6 prompts: 3 sub-task prompts and some checks.');
    const { client } = clientReturning(wrong);
    expect(await runPromptEnhancementSequenceSummaryWordingV1(input(), client))
      .toEqual({ ok: false, reason: 'summary_omits_total' });
  });

  it('refuses a wrong number that merely contains the right digit', async () => {
    // "17" contains "7". Under plain containment the one check on the one line whose job is to be
    // trusted passed a sentence stating a different number of prompts than the plan holds.
    const { client } = clientReturning(reply('This task is planned as 17 prompts.'));
    expect(await runPromptEnhancementSequenceSummaryWordingV1(input(), client))
      .toEqual({ ok: false, reason: 'summary_omits_total' });
  });

  it('refuses a sentence carrying the user\'s own words', async () => {
    const leaked = reply(`This task is planned as 7 prompts. ${ORIGINAL}`);
    const { client } = clientReturning(leaked);
    expect(await runPromptEnhancementSequenceSummaryWordingV1(input(), client))
      .toEqual({ ok: false, reason: 'summary_carries_original_text' });
  });

  it('repairs a rejected sentence, restating the total it must carry', async () => {
    const wrong = reply('This task is planned as several prompts.');
    const { client, bodies } = clientReturning(wrong, reply(GOOD));
    expect((await runPromptEnhancementSequenceSummaryWordingV1(input(), client)).ok).toBe(true);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]?.[2]).toContain('summary_omits_total');
    expect(bodies[1]?.[2]).toContain('The total is 7');
  });

  it('stops after three repairs, and never repairs a provider failure', async () => {
    const wrong = reply('This task is planned as several prompts.');
    const { client, bodies } = clientReturning(wrong);
    expect(await runPromptEnhancementSequenceSummaryWordingV1(input(), client))
      .toEqual({ ok: false, reason: 'summary_omits_total' });
    expect(bodies).toHaveLength(PROMPT_ENHANCEMENT_COST_VALIDATION_RETRY_COUNT_V1 + 1);

    let calls = 0;
    const throwing: PromptEnhancementSequencePlannerClientV1 = {
      chat: { completions: { create: async () => {
        calls += 1;
        throw Object.assign(new Error('t'), { name: 'APIConnectionTimeoutError' });
      } } },
    };
    expect(await runPromptEnhancementSequenceSummaryWordingV1(input(), throwing))
      .toEqual({ ok: false, reason: 'timeout' });
    expect(calls).toBe(1);
  });

  it('will not start a call it knows cannot finish', async () => {
    let calls = 0;
    const counting: PromptEnhancementSequencePlannerClientV1 = {
      chat: { completions: { create: async () => {
        calls += 1;
        return { choices: [{ message: { content: reply(GOOD) } }] };
      } } },
    };
    const now = 1_000_000;
    expect(await runPromptEnhancementSequenceSummaryWordingV1(
      input({ deadlineAtMs: now + 1, nowMs: () => now }),
      counting,
    )).toEqual({ ok: false, reason: 'summary_deadline_exceeded' });
    expect(calls).toBe(0);
  });

  it('belongs to the plan it was written for, and not to the one that replaced it', async () => {
    // A re-plan changes both things the sentence states. Shown against the new plan it is a wrong
    // count on the one line whose job is to prevent surprise.
    const { client } = clientReturning(reply(GOOD));
    const result = await runPromptEnhancementSequenceSummaryWordingV1(
      input({ planGenerationId: 'plan-before-shorter' }),
      client,
    );
    expect(promptEnhancementSequenceSummaryIsCurrentV1(result, 'plan-before-shorter')).toBe(true);
    expect(promptEnhancementSequenceSummaryIsCurrentV1(result, 'plan-after-shorter')).toBe(false);
    expect(promptEnhancementSequenceSummaryIsCurrentV1({ ok: false, reason: 'invalid_output' }, 'plan-1'))
      .toBe(false);
  });
});
