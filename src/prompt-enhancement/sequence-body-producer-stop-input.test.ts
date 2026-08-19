import { describe, expect, it, vi } from 'vitest';
import {
  assemblePromptEnhancementSequenceBodyProducerInputV1,
  startSequenceWordingBatchV1,
} from './sequence-body-producer-stop-input.js';
import type { PromptEnhancementPrepareResultV1 } from './contracts.js';
import type { PromptEnhancementSequenceItemV1 } from './sequence-payload.js';
import type { PromptEnhancementSequenceBodyProducerResultV1 } from './sequence-body-producer-runtime.js';

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

const OK_RESULT: PromptEnhancementSequenceBodyProducerResultV1 = { ok: true, items: ITEMS };

describe('startSequenceWordingBatchV1 — the popup-lifetime batch handle (§4.13)', () => {
  const assembled = () => assemblePromptEnhancementSequenceBodyProducerInputV1({
    result: stubResult('Fix bug and add limiter', 'h'), plannerItems: ITEMS,
  });

  it('starts the batch EAGERLY (before any await) so it runs while the popup is open', () => {
    const runBatch = vi.fn().mockResolvedValue(OK_RESULT);
    const handle = startSequenceWordingBatchV1(assembled(), runBatch);
    // The call has already happened — not deferred to awaitResult (which is only reached on send).
    expect(runBatch).toHaveBeenCalledTimes(1);
    expect(handle.started).toBe(true);
  });

  it('awaitResult (the send path) resolves the produced items', async () => {
    const handle = startSequenceWordingBatchV1(assembled(), vi.fn().mockResolvedValue(OK_RESULT));
    await expect(handle.awaitResult()).resolves.toEqual(OK_RESULT);
  });

  it('does not start and resolves null when there was nothing to assemble', async () => {
    const runBatch = vi.fn();
    const handle = startSequenceWordingBatchV1({ ok: false, reason: 'no_planner_items' }, runBatch);
    expect(runBatch).not.toHaveBeenCalled();
    expect(handle.started).toBe(false);
    await expect(handle.awaitResult()).resolves.toBeNull();
  });

  it('a batch failure resolves to null (never throws) so a send is not lost, and calls onError', async () => {
    const onError = vi.fn();
    const handle = startSequenceWordingBatchV1(assembled(), () => Promise.reject(new Error('provider down')), onError);
    await expect(handle.awaitResult()).resolves.toBeNull();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('a DISCARDED failing batch (awaitResult never called) does not reject unhandled', async () => {
    // The .catch is attached at creation, so a close/Escape that never awaits cannot crash the hook.
    startSequenceWordingBatchV1(assembled(), () => Promise.reject(new Error('provider down')));
    // Let the microtask queue drain; an unhandled rejection here would fail the test run.
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(true).toBe(true);
  });
});
