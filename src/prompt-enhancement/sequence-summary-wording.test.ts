import { describe, expect, it } from 'vitest';
import {
  promptEnhancementSequenceSummaryFactsV1,
  promptEnhancementSequenceSummaryIsCurrentV1,
  runPromptEnhancementSequenceSummaryWordingV1,
  type PromptEnhancementSequenceSummaryInputV1,
} from './sequence-summary-wording.js';
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
});

describe('sequence summary wording — a failed line costs the wording and nothing else', () => {
  const failing = async (replyText: string) =>
    runPromptEnhancementSequenceSummaryWordingV1(input(), clientReturning(reply(replyText)).client);

  it('keeps the counts and names the failure, rather than losing the sequence', async () => {
    // The counts never depended on the call, so they stay; what is lost is the worded half, and it
    // is stated rather than hidden so the failure can be seen while it waits to be fixed.
    const result = await failing('This task is planned as several prompts.');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('summary_omits_total');
    expect(result.publicSafeText).toContain('planned as 7 prompts');
    expect(result.publicSafeText).toContain('3 sub-task');
    expect(result.publicSafeText).toContain('summary generation failed: summary_omits_total');
    // Still attributable to its plan, because the counts in it are just as wrong for a later one.
    expect(promptEnhancementSequenceSummaryIsCurrentV1(result, 'plan-1')).toBe(true);
    expect(promptEnhancementSequenceSummaryIsCurrentV1(result, 'plan-2')).toBe(false);
  });

  it('makes exactly ONE call and never a second', async () => {
    // This call does not retry. Spending more calls on a sentence when the plan and the prompts are
    // already in hand is not where the budget belongs.
    const { client, bodies } = clientReturning(reply('This task is planned as several prompts.'));
    await runPromptEnhancementSequenceSummaryWordingV1(input(), client);
    expect(bodies).toHaveLength(1);
  });

  it('catches a wrong number that merely contains the right digit', async () => {
    // "17" contains "7", so containment would pass a sentence stating a different number.
    const result = await failing('This task is planned as 17 prompts.');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('summary_omits_total');
  });

  it('catches a sentence carrying the user own words', async () => {
    const result = await failing(`This task is planned as 7 prompts. ${ORIGINAL}`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('summary_carries_original_text');
  });

  it('does the same for a provider failure and for no room before the deadline', async () => {
    let calls = 0;
    const throwing: PromptEnhancementSequencePlannerClientV1 = {
      chat: { completions: { create: async () => {
        calls += 1;
        throw Object.assign(new Error('t'), { name: 'APIConnectionTimeoutError' });
      } } },
    };
    const thrown = await runPromptEnhancementSequenceSummaryWordingV1(input(), throwing);
    expect(thrown.ok).toBe(false);
    if (thrown.ok) return;
    expect(thrown.reason).toBe('timeout');
    expect(thrown.publicSafeText).toContain('planned as 7 prompts');
    expect(calls).toBe(1);

    const now = 1_000_000;
    const late = await runPromptEnhancementSequenceSummaryWordingV1(
      input({ deadlineAtMs: now + 1, nowMs: () => now }),
      clientReturning(reply(GOOD)).client,
    );
    expect(late.ok).toBe(false);
    if (late.ok) return;
    expect(late.reason).toBe('summary_deadline_exceeded');
    expect(late.publicSafeText).toContain('planned as 7 prompts');
  });

  it('belongs to the plan it was written for, and not to the one that replaced it', async () => {
    const { client } = clientReturning(reply(GOOD));
    const result = await runPromptEnhancementSequenceSummaryWordingV1(
      input({ planGenerationId: 'plan-before-shorter' }),
      client,
    );
    expect(result.ok).toBe(true);
    expect(promptEnhancementSequenceSummaryIsCurrentV1(result, 'plan-before-shorter')).toBe(true);
    expect(promptEnhancementSequenceSummaryIsCurrentV1(result, 'plan-after-shorter')).toBe(false);
  });
});
