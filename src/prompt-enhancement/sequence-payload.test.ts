import { describe, expect, it } from 'vitest';
import {
  emptyPromptEnhancementSequencePayloadV1,
  validatePromptEnhancementSequencePayloadV1,
  type PromptEnhancementSequenceItemKindV1,
  type PromptEnhancementSequenceItemV1,
  type PromptEnhancementSequencePayloadV1,
} from './sequence-payload.js';
import type { PromptEnhancementValidationGraphV1 } from './contracts.js';

const LEN = 100;

// The validator only requires a non-null object here; the graph's own shape is validated by
// the component that writes it.
const GRAPH = {} as unknown as PromptEnhancementValidationGraphV1;

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
    generatedWording:          'Do that part.',
    actionRiskKind:            null,
    authorityMode:             'plan_or_review',
    requiresConfirmationFloor: false,
    decompositionGroupId:      'g1',
    itemValidationGraph:       GRAPH,
    ...overrides,
  };
}

function firstTask(
  overrides: Partial<PromptEnhancementSequenceItemV1> = {},
): PromptEnhancementSequenceItemV1 {
  return task(0, {
    itemKind:            'first_task',
    originalSliceRef:    { start: 0, end: LEN },
    generatedWording:    null,
    itemValidationGraph: null,
    ...overrides,
  });
}

// The four kinds that carry no slice: no authority of their own, and no confirmation floor.
function noSlice(
  kind: PromptEnhancementSequenceItemKindV1,
  index: number,
  overrides: Partial<PromptEnhancementSequenceItemV1> = {},
): PromptEnhancementSequenceItemV1 {
  return task(index, {
    itemKind:                  kind,
    originalSliceRef:          null,
    complexity:                null,
    complexityReason:          kind === 'wrap_up' ? null : 'This item changes a shipped contract.',
    generatedWording:          kind === 'binary_confirmation' ? 'YES/NO' : 'Check it.',
    authorityMode:             null,
    requiresConfirmationFloor: false,
    decompositionGroupId:      null,
    ...overrides,
  });
}

function payload(
  items: readonly PromptEnhancementSequenceItemV1[],
  overrides: Partial<PromptEnhancementSequencePayloadV1> = {},
): PromptEnhancementSequencePayloadV1 {
  return {
    ...emptyPromptEnhancementSequencePayloadV1(LEN),
    // A row carrying items is past acceptance, so the default policy would contradict it.
    suggestedNextPromptPolicy: items.length > 0 ? 'rendered_after_explicit_acceptance' : 'not_generated',
    items,
    ...overrides,
  };
}

/** Validates against the list's own length unless a disagreeing row count is being tested. */
const reason = (p: unknown, itemCount?: number): string | undefined => {
  const items = (p as { items?: unknown[] })?.items;
  const count = itemCount ?? (Array.isArray(items) ? items.length : 0);
  const result = validatePromptEnhancementSequencePayloadV1(p, { itemCount: count });
  return result.ok ? undefined : result.reasonCode;
};

describe('sequence payload — shape', () => {
  it('an unplanned sequence is a valid stored state (pre-planner window)', () => {
    const empty = emptyPromptEnhancementSequencePayloadV1(LEN);
    expect(empty).toMatchObject({
      items: [], promptDirectives: [], suggestedNextPromptPolicy: 'not_generated',
      originalLength: LEN, offerDisposition: 'accepted',
    });
    expect(validatePromptEnhancementSequencePayloadV1(empty, { itemCount: 3 }).ok).toBe(true);
  });

  it('accepts a planned two-item sequence', () => {
    expect(reason(payload([firstTask(), task(1)]))).toBeUndefined();
  });

  it('rejects a non-object, a non-array item list, and a bad original length', () => {
    expect(reason(null)).toBe('payload_not_object');
    expect(reason({ ...emptyPromptEnhancementSequencePayloadV1(10), items: 'nope' })).toBe('items_not_array');
    expect(reason({ ...emptyPromptEnhancementSequencePayloadV1(10), originalLength: -1 }))
      .toBe('original_length_invalid');
  });

  it('rejects an out-of-enum policy or disposition', () => {
    expect(reason(payload([], { suggestedNextPromptPolicy: 'whatever' as never })))
      .toBe('next_prompt_policy_invalid');
    expect(reason(payload([], { offerDisposition: 'cancelled' as never })))
      .toBe('offer_disposition_invalid');
  });
});

describe('sequence payload — the row it belongs to', () => {
  it('requires the list length to equal the row item count', () => {
    // Two consumers read one quantity: too small and the machine completes while entries
    // remain, too large and it offers past the end of the list.
    expect(reason(payload([firstTask(), task(1)]), 5)).toBe('item_count_disagrees_with_row');
    expect(reason(payload([firstTask(), task(1)]), 2)).toBeUndefined();
  });

  it('rejects a servable list below the minimum', () => {
    expect(reason(payload([firstTask()]))).toBe('item_count_below_min');
  });

  it('rejects a zero bound once items exist', () => {
    // An offset rule that compares against an unchecked bound runs and proves nothing.
    expect(reason(payload([firstTask({ originalSliceRef: { start: 0, end: 0 } }), task(1)], { originalLength: 0 })))
      .toBe('original_length_zero_with_items');
  });

  it('rejects a policy that disagrees with the stored list', () => {
    expect(reason(payload([firstTask(), task(1)], { suggestedNextPromptPolicy: 'not_generated' })))
      .toBe('next_prompt_policy_disagrees_with_items');
  });
});

describe('sequence payload — the terminal stub', () => {
  it('exempts a non-accepted row from the item bounds', () => {
    // Without the exemption the scrub deletes the record in the same breath it is written.
    for (const disposition of ['rejected', 'not_engaged'] as const) {
      const stub: PromptEnhancementSequencePayloadV1 = {
        items: [], promptDirectives: [], suggestedNextPromptPolicy: 'not_generated',
        originalLength: 0, offerDisposition: disposition,
      };
      expect(validatePromptEnhancementSequencePayloadV1(stub, { itemCount: 0 }).ok).toBe(true);
    }
  });

  it('refuses a stub that carries items', () => {
    expect(reason(payload([firstTask(), task(1)], { offerDisposition: 'rejected' })))
      .toBe('stub_row_must_carry_no_items');
  });
});

describe('sequence payload — position and count arithmetic', () => {
  it('requires exactly one first_task, at index 0', () => {
    expect(reason(payload([task(0), task(1)]))).toBe('first_task_not_exactly_one_at_index_0');
    expect(reason(payload([firstTask(), firstTask({ dependencyOrder: 1 })])))
      .toBe('first_task_not_exactly_one_at_index_0');
  });

  it('requires dependencyOrder to equal the index', () => {
    expect(reason(payload([firstTask(), task(1, { dependencyOrder: 5 })])))
      .toBe('dependency_order_not_index');
  });

  it('allows a wrap_up only as the last entry, and never twice', () => {
    expect(reason(payload([firstTask(), noSlice('wrap_up', 1), task(2)])))
      .toBe('wrap_up_not_last_or_duplicated');
  });

  it('ties the wrap_up to the size of the list in both directions', () => {
    const tasks = (n: number) => Array.from({ length: n }, (_, i) => task(i + 1));
    expect(reason(payload([firstTask(), ...tasks(2)]))).toBeUndefined();
    expect(reason(payload([firstTask(), ...tasks(3)]))).toBe('wrap_up_presence_does_not_match_count');
    expect(reason(payload([firstTask(), ...tasks(4), noSlice('wrap_up', 5)]))).toBeUndefined();
    expect(reason(payload([firstTask(), noSlice('wrap_up', 1)])))
      .toBe('wrap_up_presence_does_not_match_count');
  });
});

describe('sequence payload — confirmations must match the verdict', () => {
  it('accepts the three mappings the table yields', () => {
    expect(reason(payload([firstTask(), task(1)]))).toBeUndefined();
    expect(reason(payload([
      firstTask(), task(1, { complexity: 'complex', complexityReason: 'Could be silently wrong.' }),
      noSlice('binary_confirmation', 2),
    ]))).toBeUndefined();
    expect(reason(payload([
      firstTask(), task(1, { complexity: 'highly_complex', complexityReason: 'Touches the core.' }),
      noSlice('cross_confirmation', 2), noSlice('binary_confirmation', 3), noSlice('wrap_up', 4),
    ]))).toBeUndefined();
  });

  it('rejects confirmations a not_complex verdict did not earn', () => {
    // If the emitted confirmations need not match the verdict, the verdict is decorative.
    expect(reason(payload([firstTask(), task(1), noSlice('binary_confirmation', 2)])))
      .toBe('confirmations_do_not_match_complexity');
  });

  it('rejects a complex verdict with no confirmation, and the wrong one', () => {
    expect(reason(payload([
      firstTask(), task(1, { complexity: 'complex', complexityReason: 'why' }),
    ]))).toBe('confirmations_do_not_match_complexity');
    expect(reason(payload([
      firstTask(), task(1, { complexity: 'complex', complexityReason: 'why' }),
      noSlice('double_confirmation', 2),
    ]))).toBe('confirmations_do_not_match_complexity');
  });

  it('rejects the two-confirmation pair in the wrong order', () => {
    // Checking the set without the order passes a list that asks for the decision before the
    // check that informs it.
    expect(reason(payload([
      firstTask(), task(1, { complexity: 'highly_complex', complexityReason: 'why' }),
      noSlice('binary_confirmation', 2), noSlice('double_confirmation', 3), noSlice('wrap_up', 4),
    ]))).toBe('confirmations_do_not_match_complexity');
  });
});

describe('sequence payload — offsets', () => {
  it('requires a slice on task kinds and forbids one everywhere else', () => {
    expect(reason(payload([firstTask(), task(1, { originalSliceRef: null })])))
      .toBe('original_slice_ref_presence_invalid');
    expect(reason(payload([firstTask(), noSlice('binary_confirmation', 1, { originalSliceRef: { start: 1, end: 2 } })])))
      .toBe('original_slice_ref_presence_invalid');
  });

  it('rejects an inverted, empty or out-of-range range', () => {
    expect(reason(payload([firstTask(), task(1, { originalSliceRef: { start: 40, end: 10 } })])))
      .toBe('offset_range_out_of_bounds');
    expect(reason(payload([firstTask(), task(1, { originalSliceRef: { start: 10, end: 10 } })])))
      .toBe('offset_range_out_of_bounds');
    expect(reason(payload([firstTask(), task(1, { originalSliceRef: { start: 10, end: LEN + 1 } })])))
      .toBe('offset_range_out_of_bounds');
  });

  it('requires the first item to span the WHOLE original, not a slice of it', () => {
    expect(reason(payload([firstTask({ originalSliceRef: { start: 0, end: 40 } }), task(1)])))
      .toBe('first_task_slice_not_whole_original');
  });

  it('bounds the point lineage and the whole-prompt directives too', () => {
    expect(reason(payload([firstTask(), task(1, { sourcePointRanges: [{ start: 0, end: 500 }] })])))
      .toBe('source_point_ranges_invalid');
    expect(reason(payload([], { promptDirectives: [{ start: 0, end: 500 }] })))
      .toBe('prompt_directives_invalid');
  });
});

describe('sequence payload — per-kind field presence', () => {
  it('requires complexity on task kinds and forbids it elsewhere', () => {
    expect(reason(payload([firstTask(), task(1, { complexity: null })])))
      .toBe('complexity_presence_invalid');
    expect(reason(payload([firstTask(), noSlice('binary_confirmation', 1, { complexity: 'complex' })])))
      .toBe('complexity_presence_invalid');
  });

  it('requires a reason when a task is complex, and on every confirmation', () => {
    expect(reason(payload([firstTask(), task(1, { complexity: 'complex', complexityReason: null })])))
      .toBe('complexity_reason_invalid');
    expect(reason(payload([firstTask(), noSlice('binary_confirmation', 1, { complexityReason: '  ' })])))
      .toBe('complexity_reason_invalid');
  });

  it('requires wording on every item except the first, which must have none', () => {
    expect(reason(payload([firstTask(), task(1, { generatedWording: null })])))
      .toBe('generated_wording_presence_invalid');
    expect(reason(payload([firstTask({ generatedWording: 'anything' }), task(1)])))
      .toBe('generated_wording_presence_invalid');
  });

  it('requires a validation verdict wherever there is wording', () => {
    expect(reason(payload([firstTask(), task(1, { itemValidationGraph: null })])))
      .toBe('item_validation_graph_presence_invalid');
    expect(reason(payload([firstTask({ itemValidationGraph: GRAPH }), task(1)])))
      .toBe('item_validation_graph_presence_invalid');
  });

  it('requires a decomposition group id on task kinds and a closed role label', () => {
    expect(reason(payload([firstTask(), task(1, { decompositionGroupId: '' })])))
      .toBe('decomposition_group_id_invalid');
    expect(reason(payload([firstTask(), task(1, { roleLabel: 'ship' as never })]))).toBe('role_label_invalid');
  });
});

describe('sequence payload — the safety fields', () => {
  it('requires an authority mode on kinds that carry a slice, and none on those that do not', () => {
    // Authority is carried FROM the slice, so a confirmation has none of its own to exceed.
    expect(reason(payload([firstTask(), task(1, { authorityMode: null })]))).toBe('authority_mode_invalid');
    expect(reason(payload([firstTask(), noSlice('binary_confirmation', 1, { authorityMode: 'plan_or_review' })])))
      .toBe('authority_mode_invalid');
  });

  it('rejects an authority mode or risk kind outside its closed set', () => {
    expect(reason(payload([firstTask(), task(1, { authorityMode: 'do_whatever' as never })])))
      .toBe('authority_mode_invalid');
    expect(reason(payload([firstTask(), task(1, { actionRiskKind: 'mildly_spicy' as never })])))
      .toBe('action_risk_kind_invalid');
    expect(reason(payload([
      firstTask(), task(1, { actionRiskKind: 'git_history_rewrite', authorityMode: 'execute_requested' }),
    ]))).toBeUndefined();
  });

  it('forbids a confirmation floor on a kind that carries no slice', () => {
    expect(reason(payload([firstTask(), noSlice('binary_confirmation', 1, { requiresConfirmationFloor: true })])))
      .toBe('requires_confirmation_floor_invalid');
    expect(reason(payload([firstTask(), task(1, { requiresConfirmationFloor: 'yes' as never })])))
      .toBe('requires_confirmation_floor_invalid');
  });
});
