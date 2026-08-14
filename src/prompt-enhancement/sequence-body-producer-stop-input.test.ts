import { describe, expect, it } from 'vitest';
import { assemblePromptEnhancementSequenceBodyProducerInputV1 } from './sequence-body-producer-stop-input.js';
import type { PromptEnhancementPrepareResultV1 } from './contracts.js';
import type { PromptEnhancementSequenceItemV1 } from './sequence-payload.js';

const ITEMS: readonly PromptEnhancementSequenceItemV1[] = [
  {
    itemKind: 'first_task', originalSliceRef: { start: 0, end: 40 }, sourcePointRanges: [],
    roleLabel: 'fix', dependencyOrder: 0, complexity: 'not_complex', complexityReason: null,
    decompositionGroupId: 'g1',
  },
  {
    itemKind: 'task', originalSliceRef: { start: 10, end: 30 }, sourcePointRanges: [],
    roleLabel: null, dependencyOrder: 1, complexity: 'not_complex', complexityReason: null,
    decompositionGroupId: 'g2',
  },
];

/** A minimal result carrying only the fields the assembler reads, cast to the full type. */
function stubResult(
  originalPromptText: string,
  handoffDecisionId: string | null,
  bodyText = 'The enhanced first prompt.',
): PromptEnhancementPrepareResultV1 {
  return {
    uiView: {
      handoffAndSequenceSummary: handoffDecisionId === null ? undefined : { handoffDecisionId },
    },
    currentBody: { originalPromptText, text: bodyText },
    safetySummary: { validationStatus: 'clean' },
    validationGraph: {
      providerRuntimeState: 'deterministic',
      optionalCallAvailabilityState: 'deterministic_only',
    },
  } as unknown as PromptEnhancementPrepareResultV1;
}

describe('assemblePromptEnhancementSequenceBodyProducerInputV1 (MPS P1b-ii 8b-2)', () => {
  it('maps every field from the pending pieces on the happy path', () => {
    const original = 'Fix the payment bug and add a rate limiter to login';
    const res = assemblePromptEnhancementSequenceBodyProducerInputV1({
      result: stubResult(original, 'handoff-1', 'The enhanced first prompt.'),
      plannerItems: ITEMS,
      plannerPromptDirectives: [{ start: 0, end: 3 }],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.input.plannerItems).toEqual(ITEMS);
    expect(res.input.planGenerationId).toBe('handoff-1');
    expect(res.input.localOriginalText).toBe(original); // no secrets → redaction is identity
    expect(res.input.promptDirectives).toEqual(['Fix']); // slice [0,3) of the (redacted) original
    expect(res.input.firstBodyText).toBe('The enhanced first prompt.'); // from currentBody.text
    expect(res.input.providerRuntimeState).toBe('deterministic');
    expect(res.input.optionalCallAvailabilityState).toBe('deterministic_only');
    expect(res.input.sequenceItemIdFor(1)).toBe('handoff-1:item:1'); // packager scheme, not the tests' dash
  });

  it('redacts the original length-preservingly so offsets still resolve', () => {
    // An OpenAI-style key is a known secret pattern; redaction replaces it with a same-length marker.
    const secret = 'sk-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKL';
    const original = `Use ${secret} then deploy`;
    const res = assemblePromptEnhancementSequenceBodyProducerInputV1({
      result: stubResult(original, 'h', `body ${secret}`),
      plannerItems: ITEMS,
      plannerPromptDirectives: [],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Length preserved (offsets safe), and the raw secret is gone from what reaches the provider.
    expect(res.input.localOriginalText).toHaveLength(original.length);
    expect(res.input.localOriginalText).not.toContain(secret);
    expect(res.input.firstBodyText).not.toContain(secret);
  });

  it('resolves an empty directive list to no strings', () => {
    const res = assemblePromptEnhancementSequenceBodyProducerInputV1({
      result: stubResult('abc def', 'h'), plannerItems: ITEMS,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.input.promptDirectives).toEqual([]);
  });

  it('fails closed with no_planner_items when the item list is absent or empty', () => {
    const r1 = assemblePromptEnhancementSequenceBodyProducerInputV1({ result: stubResult('x', 'h') });
    expect(r1).toEqual({ ok: false, reason: 'no_planner_items' });
    const r2 = assemblePromptEnhancementSequenceBodyProducerInputV1({ result: stubResult('x', 'h'), plannerItems: [] });
    expect(r2).toEqual({ ok: false, reason: 'no_planner_items' });
  });

  it('fails closed with no_handoff when the result carries no sequence summary', () => {
    const res = assemblePromptEnhancementSequenceBodyProducerInputV1({
      result: stubResult('x', null), plannerItems: ITEMS,
    });
    expect(res).toEqual({ ok: false, reason: 'no_handoff' });
  });

  it('fails closed with no_original when the offset base is empty', () => {
    const res = assemblePromptEnhancementSequenceBodyProducerInputV1({
      result: stubResult('', 'h'), plannerItems: ITEMS,
    });
    expect(res).toEqual({ ok: false, reason: 'no_original' });
  });
});
