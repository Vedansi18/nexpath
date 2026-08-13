import { describe, expect, it } from 'vitest';
import { producePromptEnhancementSequenceItemBodiesV1 } from './sequence-item-body-producer.js';
import type { PromptEnhancementSequenceComposedItemV1 } from './sequence-batch-composer.js';
import type { PromptEnhancementSequenceItemV1 } from './sequence-payload.js';
import type { PromptEnhancementValidationGraphV1 } from './contracts.js';
import type { PromptEnhancementSequenceOffsetRangeV1 } from './sequence-payload.js';

const GRAPH = {} as unknown as PromptEnhancementValidationGraphV1;

// A planned item as it leaves the planner: structure present, body fields still empty.
function task(
  index: number,
  overrides: Partial<PromptEnhancementSequenceItemV1> = {},
): PromptEnhancementSequenceItemV1 {
  return {
    itemKind:                  'task',
    originalSliceRef:          { start: 10, end: 40 },
    sourcePointRanges:         [{ start: 10, end: 20 }],
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

function firstTask(overrides: Partial<PromptEnhancementSequenceItemV1> = {}): PromptEnhancementSequenceItemV1 {
  return task(0, { itemKind: 'first_task', originalSliceRef: { start: 0, end: 100 }, ...overrides });
}

function composed(
  wording: string,
  safetyClauseRef: PromptEnhancementSequenceOffsetRangeV1 | null = null,
): PromptEnhancementSequenceComposedItemV1 {
  return { wording, validationGraph: GRAPH, safetyClauseRef };
}

describe('producePromptEnhancementSequenceItemBodiesV1', () => {
  it('fills every non-first item from its composed entry and leaves the first item unworded', () => {
    const result = producePromptEnhancementSequenceItemBodiesV1(
      [firstTask(), task(1), task(2)],
      new Map([[1, composed('Do part one.')], [2, composed('Do part two.')]]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items[0].generatedWording).toBeNull();
    expect(result.items[0].itemValidationGraph).toBeNull();
    expect(result.items[1].generatedWording).toBe('Do part one.');
    expect(result.items[1].itemValidationGraph).toBe(GRAPH);
    expect(result.items[2].generatedWording).toBe('Do part two.');
  });

  it('threads the composed safety-clause ref onto the item', () => {
    const ref = { start: 3, end: 9 };
    const result = producePromptEnhancementSequenceItemBodiesV1(
      [firstTask(), task(1)],
      new Map([[1, composed('Rotate then redeploy.', ref)]]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items[1].itemSafetyClauseRef).toEqual(ref);
  });

  it('does not mutate the planned items it was given', () => {
    const planned = [firstTask(), task(1)];
    producePromptEnhancementSequenceItemBodiesV1(planned, new Map([[1, composed('X.')]]));
    expect(planned[1].generatedWording).toBeNull();
  });

  it('fails when a planned non-first item has no composed body — never fabricates one', () => {
    const result = producePromptEnhancementSequenceItemBodiesV1([firstTask(), task(1)], new Map());
    expect(result).toEqual({ ok: false, reason: 'item_missing_composed' });
  });

  it('fails when the batch returns a body for the first item', () => {
    const result = producePromptEnhancementSequenceItemBodiesV1(
      [firstTask(), task(1)],
      new Map([[0, composed('nope')], [1, composed('Y.')]]),
    );
    expect(result).toEqual({ ok: false, reason: 'first_item_must_not_be_worded' });
  });

  it('fails when a composed body is keyed to an order no planned item holds', () => {
    const result = producePromptEnhancementSequenceItemBodiesV1(
      [firstTask(), task(1)],
      new Map([[1, composed('Y.')], [9, composed('stray')]]),
    );
    expect(result).toEqual({ ok: false, reason: 'composed_item_not_in_plan' });
  });
});
