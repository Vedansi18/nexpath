import { describe, expect, it } from 'vitest';
import {
  packageContinuationAtStopV1,
  type ContinuationStopPackageInputV1,
} from './continuation-stop-package.js';
import type { PromptEnhancementSequenceItemV1 } from './sequence-payload.js';
import type { PromptEnhancementSequenceRuntimeStateV1 } from './sequence-runtime.js';
import type { PromptEnhancementValidationGraphV1 } from './contracts.js';

const LEN = 50;
const REDACTED = 'x'.repeat(LEN); // length-preserving redacted original; item offsets index into it
// The item's own verdict — the packager reports `safetyState.validationStatus` off it (sequence-packager.ts).
const GRAPH = {
  safetyState: { sensitiveActionState: 'none_detected', validationStatus: 'valid' },
} as unknown as PromptEnhancementValidationGraphV1;

// A valid 2-item stored list: item 0 is the whole original (no wording); item 1 is a worded task.
const ITEMS: readonly PromptEnhancementSequenceItemV1[] = [
  {
    itemKind: 'first_task', originalSliceRef: { start: 0, end: LEN }, sourcePointRanges: [{ start: 10, end: 20 }],
    roleLabel: 'fix', dependencyOrder: 0, complexity: 'not_complex', complexityReason: null,
    generatedWording: null, actionRiskKinds: [], authorityMode: 'plan_or_review', requiresConfirmationFloor: false,
    decompositionGroupId: 'g1', itemValidationGraph: null, itemSafetyClauseRef: null,
  },
  {
    itemKind: 'task', originalSliceRef: { start: 10, end: 40 }, sourcePointRanges: [{ start: 10, end: 20 }],
    roleLabel: 'fix', dependencyOrder: 1, complexity: 'not_complex', complexityReason: null,
    generatedWording: 'Add the rate limiter to the login endpoint.', actionRiskKinds: [],
    authorityMode: 'plan_or_review', requiresConfirmationFloor: false, decompositionGroupId: 'g1',
    itemValidationGraph: GRAPH, itemSafetyClauseRef: null,
  },
];

function state(overrides: Partial<PromptEnhancementSequenceRuntimeStateV1> = {}): PromptEnhancementSequenceRuntimeStateV1 {
  return {
    sequenceId: 'seq-1', enhancementId: 'enh-1', projectRoot: '/tmp/p', sessionId: 's1',
    itemCount: 2, currentItemIndex: 0, status: 'awaiting_response', lastActionId: null, ...overrides,
  };
}

function input(overrides: Partial<ContinuationStopPackageInputV1> = {}): ContinuationStopPackageInputV1 {
  return {
    state: state(), actionId: 'act-1', items: ITEMS,
    redactedOriginalPromptText: REDACTED, handoffKind: 'compact_sequence_summary_candidate', ...overrides,
  };
}

describe('packageContinuationAtStopV1 — MPS shell P2 (offer + package)', () => {
  it('ADVANCES a just-sent row (index 0, awaiting_response) to serve item 1 — the offer step, not the raw index', () => {
    // The row stores currentItemIndex 0 (item 0 was sent at intake). The offer must advance to 1;
    // packaging the raw index 0 would be refused (index_is_the_first_item).
    const res = packageContinuationAtStopV1(input({ state: state({ currentItemIndex: 0, status: 'awaiting_response' }) }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.advanced).toBe(true);
    expect(res.offeredState.currentItemIndex).toBe(1);
    expect(res.packaged.itemKind).toBe('task');
    expect(res.packaged.result.currentBody.text).toContain('rate limiter');
  });

  it('RE-OFFERS the same item for an item_pending row (a prior interruption), without advancing', () => {
    const res = packageContinuationAtStopV1(input({ state: state({ currentItemIndex: 1, status: 'item_pending' }) }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.advanced).toBe(false);
    expect(res.offeredState.currentItemIndex).toBe(1);
    expect(res.packaged.itemKind).toBe('task');
  });

  it('completes the sequence when the last item was already served (advance runs off the end)', () => {
    const res = packageContinuationAtStopV1(input({ state: state({ currentItemIndex: 1, status: 'awaiting_response' }) }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('sequence_complete');
  });

  it('no_offer for a terminal status (completed / cancelled)', () => {
    const res = packageContinuationAtStopV1(input({ state: state({ status: 'completed' }) }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('no_offer');
  });

  it('fails closed with no_stored_items when the row carries no worded items', () => {
    expect(packageContinuationAtStopV1(input({ items: [] })))
      .toEqual({ ok: false, reason: 'no_stored_items' });
  });

  it('fails closed with no_redacted_original when the redacted original is absent', () => {
    expect(packageContinuationAtStopV1(input({ redactedOriginalPromptText: null })))
      .toEqual({ ok: false, reason: 'no_redacted_original' });
  });

  it('fails closed with handoff_not_continuable for a null or non-continuable handoff kind', () => {
    expect(packageContinuationAtStopV1(input({ handoffKind: null })))
      .toEqual({ ok: false, reason: 'handoff_not_continuable' });
    expect(packageContinuationAtStopV1(input({ handoffKind: 'some_other_kind' })))
      .toEqual({ ok: false, reason: 'handoff_not_continuable' });
  });
});
