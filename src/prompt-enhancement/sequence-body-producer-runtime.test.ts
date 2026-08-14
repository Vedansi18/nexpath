import { describe, expect, it } from 'vitest';
import { runPromptEnhancementSequenceBodyProducerV1 } from './sequence-body-producer-runtime.js';
import type { PromptEnhancementSequenceItemV1 } from './sequence-payload.js';
import type { PromptEnhancementSequencePlannerClientV1 } from './sequence-planner.js';
import type { PromptEnhancementSafetySummaryV1 } from './contracts.js';

const ORIGINAL = 'Fix the failing payment test, then add a rate limiter to the login endpoint.';
const SLICE_TWO = 'add a rate limiter to the login endpoint';
const SLICE_TWO_START = ORIGINAL.indexOf(SLICE_TWO);

const GRAPH = {} as unknown as PromptEnhancementSequenceItemV1['itemValidationGraph'];

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

function task(index: number, overrides: Partial<PromptEnhancementSequenceItemV1> = {}): PromptEnhancementSequenceItemV1 {
  return {
    itemKind:                  'task',
    originalSliceRef:          { start: SLICE_TWO_START, end: SLICE_TWO_START + SLICE_TWO.length },
    sourcePointRanges:         [],
    roleLabel:                 'fix',
    dependencyOrder:           index,
    complexity:                'not_complex',
    complexityReason:          null,
    generatedWording:          null,
    actionRiskKinds:           [],
    authorityMode:             'plan_or_review',
    requiresConfirmationFloor: false,
    decompositionGroupId:      'g1',
    itemValidationGraph:       null,
    itemSafetyClauseRef:       null,
    ...overrides,
  };
}

function firstTask(): PromptEnhancementSequenceItemV1 {
  return task(0, { itemKind: 'first_task', originalSliceRef: { start: 0, end: ORIGINAL.length } });
}

function input(plannerItems: readonly PromptEnhancementSequenceItemV1[]) {
  return {
    plannerItems,
    planGenerationId: 'plan-1',
    firstBodyText: 'The first prompt, already written.',
    promptDirectives: [],
    localOriginalText: ORIGINAL,
    baseSafetySummary: BASE_SAFETY,
    providerRuntimeState: 'deterministic' as const,
    optionalCallAvailabilityState: 'deterministic_only' as const,
    sequenceItemIdFor: (order: number) => `seq-1:item-${order}`,
  };
}

const clientReturning = (reply: string): PromptEnhancementSequencePlannerClientV1 => ({
  chat: { completions: { create: async () => ({ choices: [{ message: { content: reply } }] }) } },
} as unknown as PromptEnhancementSequencePlannerClientV1);

describe('runPromptEnhancementSequenceBodyProducerV1', () => {
  it('runs the batch and fills every non-first item body, leaving item 0 unworded', async () => {
    const client = clientReturning(JSON.stringify({
      items: [{ dependencyOrder: 1, wording: `${SLICE_TWO}\n\nAdd it at the edge, and keep the change small.` }],
    }));
    const result = await runPromptEnhancementSequenceBodyProducerV1(input([firstTask(), task(1)]), client);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items[0].generatedWording).toBeNull();
    expect(result.items[1].generatedWording).toContain(SLICE_TWO);
    expect(result.items[1].itemValidationGraph).not.toBeNull();
  });

  it('reports a batch failure with its stage and the composer reason', async () => {
    const client = clientReturning(JSON.stringify({ items: [] }));
    const result = await runPromptEnhancementSequenceBodyProducerV1(input([firstTask(), task(1)]), client);
    expect(result).toEqual({ ok: false, stage: 'batch', reason: 'item_missing_wording' });
  });
});
