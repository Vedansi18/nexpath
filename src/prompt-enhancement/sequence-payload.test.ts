import { describe, expect, it } from 'vitest';
import {
  emptyPromptEnhancementSequencePayloadV1,
  validatePromptEnhancementSequencePayloadV1,
  type PromptEnhancementSequenceItemV1,
  type PromptEnhancementSequencePayloadV1,
} from './sequence-payload.js';
import type { PromptEnhancementValidationGraphV1 } from './contracts.js';

const ORIGINAL_LENGTH = 100;

// The validator only requires a non-null object here; the graph's own shape is validated by
// the component that writes it.
const GRAPH = {} as unknown as PromptEnhancementValidationGraphV1;

function item(
  overrides: Partial<PromptEnhancementSequenceItemV1> = {},
): PromptEnhancementSequenceItemV1 {
  return {
    itemKind:                  'task',
    originalSliceRef:          { start: 10, end: 40 },
    sourcePointRanges:         [{ start: 10, end: 20 }],
    roleLabel:                 'fix',
    dependencyOrder:           1,
    complexity:                'not_complex',
    complexityReason:          null,
    generatedWording:          'Do the second part.',
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
  return item({
    itemKind:             'first_task',
    originalSliceRef:     { start: 0, end: ORIGINAL_LENGTH },
    dependencyOrder:      0,
    generatedWording:     null,
    itemValidationGraph:  null,
    ...overrides,
  });
}

function confirmation(
  overrides: Partial<PromptEnhancementSequenceItemV1> = {},
): PromptEnhancementSequenceItemV1 {
  return item({
    itemKind:         'binary_confirmation',
    originalSliceRef: null,
    complexity:       null,
    complexityReason: 'This item changes a shipped contract.',
    generatedWording: 'YES/NO',
    ...overrides,
  });
}

function payload(
  items: readonly PromptEnhancementSequenceItemV1[],
  overrides: Partial<PromptEnhancementSequencePayloadV1> = {},
): PromptEnhancementSequencePayloadV1 {
  return { ...emptyPromptEnhancementSequencePayloadV1(ORIGINAL_LENGTH), items, ...overrides };
}

const reason = (p: unknown): string | undefined => {
  const result = validatePromptEnhancementSequencePayloadV1(p);
  return result.ok ? undefined : result.reasonCode;
};

describe('sequence payload — shape', () => {
  it('an unplanned sequence is a valid stored state', () => {
    // Intake records the row on send; the planner fills the list later. Rejecting the empty
    // list would make the first persist impossible.
    const empty = emptyPromptEnhancementSequencePayloadV1(ORIGINAL_LENGTH);
    expect(empty).toMatchObject({
      items: [], promptDirectives: [], suggestedNextPromptPolicy: 'not_generated',
      originalLength: ORIGINAL_LENGTH, offerDisposition: 'accepted',
    });
    expect(validatePromptEnhancementSequencePayloadV1(empty).ok).toBe(true);
  });

  it('accepts a planned two-item sequence', () => {
    expect(validatePromptEnhancementSequencePayloadV1(payload([firstTask(), item()])).ok).toBe(true);
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

describe('sequence payload — position and count arithmetic', () => {
  it('requires exactly one first_task, at index 0', () => {
    expect(reason(payload([item({ dependencyOrder: 0 }), item()])))
      .toBe('first_task_not_exactly_one_at_index_0');
    expect(reason(payload([firstTask(), firstTask({ dependencyOrder: 1 })])))
      .toBe('first_task_not_exactly_one_at_index_0');
  });

  it('requires dependencyOrder to equal the index', () => {
    // The offered index maps onto this list directly, so a displaced entry serves the wrong
    // item for the rest of the sequence and neither the runtime nor the popup would catch it.
    expect(reason(payload([firstTask(), item({ dependencyOrder: 5 })])))
      .toBe('dependency_order_not_index');
  });

  it('allows a wrap_up only as the last entry, and never twice', () => {
    const wrap = item({ itemKind: 'wrap_up', originalSliceRef: null, complexity: null, complexityReason: null });
    expect(reason(payload([firstTask(), wrap, item({ dependencyOrder: 2 })])))
      .toBe('wrap_up_not_last_or_duplicated');
  });

  it('ties the wrap_up to the size of the list in both directions', () => {
    const rest = (n: number, kind: 'task' | 'wrap_up' = 'task'): PromptEnhancementSequenceItemV1[] =>
      Array.from({ length: n }, (_, i) => (kind === 'wrap_up'
        ? item({ itemKind: 'wrap_up', originalSliceRef: null, complexity: null, complexityReason: null, dependencyOrder: i + 1 })
        : item({ dependencyOrder: i + 1 })));

    // Three other prompts is not more than three → no recap is owed.
    expect(reason(payload([firstTask(), ...rest(2)]))).toBeUndefined();
    // A fourth crosses the line, so a list without a recap is now invalid.
    expect(reason(payload([firstTask(), ...rest(3)]))).toBe('wrap_up_presence_does_not_match_count');

    // …and with the recap present the same list is valid.
    const withWrap = payload([
      firstTask(), ...rest(4),
      item({ itemKind: 'wrap_up', originalSliceRef: null, complexity: null, complexityReason: null, dependencyOrder: 5 }),
    ]);
    expect(validatePromptEnhancementSequencePayloadV1(withWrap).ok).toBe(true);

    // A recap on a short list is equally wrong — the rule is if-and-only-if.
    const shortWithWrap = payload([
      firstTask(),
      item({ itemKind: 'wrap_up', originalSliceRef: null, complexity: null, complexityReason: null }),
    ]);
    expect(reason(shortWithWrap)).toBe('wrap_up_presence_does_not_match_count');
  });
});

describe('sequence payload — offsets', () => {
  it('requires a slice on task kinds and forbids one everywhere else', () => {
    expect(reason(payload([firstTask(), item({ originalSliceRef: null })])))
      .toBe('original_slice_ref_presence_invalid');
    expect(reason(payload([firstTask(), confirmation({ originalSliceRef: { start: 1, end: 2 } })])))
      .toBe('original_slice_ref_presence_invalid');
  });

  it('rejects an inverted, empty or out-of-range range', () => {
    // This is the failure offsets introduced in place of the verbatim-match failure they removed.
    expect(reason(payload([firstTask(), item({ originalSliceRef: { start: 40, end: 10 } })])))
      .toBe('offset_range_out_of_bounds');
    expect(reason(payload([firstTask(), item({ originalSliceRef: { start: 10, end: 10 } })])))
      .toBe('offset_range_out_of_bounds');
    expect(reason(payload([firstTask(), item({ originalSliceRef: { start: 10, end: ORIGINAL_LENGTH + 1 } })])))
      .toBe('offset_range_out_of_bounds');
  });

  it('requires the first item to span the WHOLE original, not a slice of it', () => {
    expect(reason(payload([firstTask({ originalSliceRef: { start: 0, end: 40 } }), item()])))
      .toBe('first_task_slice_not_whole_original');
  });

  it('bounds the point lineage and the whole-prompt directives too', () => {
    expect(reason(payload([firstTask(), item({ sourcePointRanges: [{ start: 0, end: 500 }] })])))
      .toBe('source_point_ranges_invalid');
    expect(reason(payload([], { promptDirectives: [{ start: 0, end: 500 }] })))
      .toBe('prompt_directives_invalid');
  });
});

describe('sequence payload — per-kind field presence', () => {
  it('requires complexity on task kinds and forbids it elsewhere', () => {
    expect(reason(payload([firstTask(), item({ complexity: null })]))).toBe('complexity_presence_invalid');
    expect(reason(payload([firstTask(), confirmation({ complexity: 'complex' })])))
      .toBe('complexity_presence_invalid');
  });

  it('requires a reason when a task is complex, and on every confirmation', () => {
    expect(reason(payload([firstTask(), item({ complexity: 'complex', complexityReason: null })])))
      .toBe('complexity_reason_invalid');
    expect(reason(payload([firstTask(), confirmation({ complexityReason: '  ' })])))
      .toBe('complexity_reason_invalid');
  });

  it('requires wording on every item except the first, which must have none', () => {
    // A stored item with no wording is a body the packager cannot serve; the first item was
    // already sent at intake and is never offered again.
    expect(reason(payload([firstTask(), item({ generatedWording: null })])))
      .toBe('generated_wording_presence_invalid');
    expect(reason(payload([firstTask({ generatedWording: 'anything' }), item()])))
      .toBe('generated_wording_presence_invalid');
  });

  it('requires a validation verdict wherever there is wording', () => {
    expect(reason(payload([firstTask(), item({ itemValidationGraph: null })])))
      .toBe('item_validation_graph_presence_invalid');
    expect(reason(payload([firstTask({ itemValidationGraph: GRAPH }), item()])))
      .toBe('item_validation_graph_presence_invalid');
  });

  it('requires a decomposition group id on task kinds and a closed role label', () => {
    expect(reason(payload([firstTask(), item({ decompositionGroupId: '' })])))
      .toBe('decomposition_group_id_invalid');
    expect(reason(payload([firstTask(), item({ roleLabel: 'ship' as never })]))).toBe('role_label_invalid');
  });

  it('type-checks the safety fields it stores', () => {
    expect(reason(payload([firstTask(), item({ authorityMode: 3 as never })]))).toBe('authority_mode_invalid');
    expect(reason(payload([firstTask(), item({ requiresConfirmationFloor: 'yes' as never })])))
      .toBe('requires_confirmation_floor_invalid');
  });
});
