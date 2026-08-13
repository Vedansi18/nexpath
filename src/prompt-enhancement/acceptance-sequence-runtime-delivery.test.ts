/**
 * Acceptance executor — batch 8: the delivery-mapper fixtures.
 *
 * Backing test named for the fixture (`test:${fixtureId}`), driving the continuation delivery mapper.
 * Does NOT mark the register fixture as passing — the owner oracle judges readiness. Mirrors
 * sequence-continuation-delivery.test.ts, the proven shape for driving the mapper.
 */
import { describe, expect, it } from 'vitest';
import { deliverSequenceContinuationOutcomeV1 } from './sequence-continuation-delivery.js';
import type { PromptEnhancementSequenceRuntimeStateV1 } from './sequence-runtime.js';
import { promptEnhancementMpsOfferDispositionFromPopupV1 } from '../cli/commands/stop.js';

type PopupResult = Parameters<typeof promptEnhancementMpsOfferDispositionFromPopupV1>[0];

function state(
  overrides: Partial<PromptEnhancementSequenceRuntimeStateV1> = {},
): PromptEnhancementSequenceRuntimeStateV1 {
  return {
    sequenceId: 'seq-1', enhancementId: 'enh-1', projectRoot: '/tmp/p', sessionId: 's1',
    itemCount: 3, currentItemIndex: 0, status: 'awaiting_response', lastActionId: null,
    ...overrides,
  };
}

describe('acceptance executor (batch 8) — delivery-mapper fixtures', () => {
  it('test:acceptance-sequence-cancel-mid-sequence-scoped', () => {
    const offered = state({ status: 'item_pending', currentItemIndex: 1 });

    // terminal_cancelled_outcome + suppression_scoped_to_this_sequence_only: the Cancel outcome is a
    // status transition on THIS sequence row (seq-1), never a project-wide delete.
    const cancelled = deliverSequenceContinuationOutcomeV1(offered, { state: 'cancelled' }, 'act-cancel');
    expect(cancelled.kind).toBe('cancel');
    if (cancelled.kind === 'cancel') {
      expect(cancelled.nextState.status).toBe('cancelled');
      expect(cancelled.nextState.sequenceId).toBe('seq-1');
      // no_other_project_row_touched: the mapper returns only this sequence's next state.
      expect(cancelled.nextState.projectRoot).toBe(offered.projectRoot);
    }

    // Escape/decline ends it the same way — every exit is the same terminal cancel, still scoped.
    const declined = deliverSequenceContinuationOutcomeV1(offered, { state: 'declined' }, 'act-esc');
    expect(declined.kind).toBe('cancel');
    if (declined.kind === 'cancel') {
      expect(declined.nextState.status).toBe('cancelled');
      expect(declined.nextState.sequenceId).toBe('seq-1');
    }
  });

  it('test:acceptance-sequence-use-original-does-not-activate', () => {
    // use_original_is_not_activation + no_sequence_activated: choosing the original records a DECLINE
    // (rejected), never an activation — its disposition is a decline stub, not a live sequence.
    expect(promptEnhancementMpsOfferDispositionFromPopupV1({ state: 'selected_original' } as PopupResult)).toBe('rejected');
    // Accepting takes the send path — it is NOT recorded here as a decline, and closing is not-engaged.
    expect(promptEnhancementMpsOfferDispositionFromPopupV1({ state: 'selected_current' } as PopupResult)).toBeUndefined();
    expect(promptEnhancementMpsOfferDispositionFromPopupV1({ state: 'closed_no_send' } as PopupResult)).toBe('not_engaged');
  });
});
