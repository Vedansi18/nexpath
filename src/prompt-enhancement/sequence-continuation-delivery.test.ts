import { describe, expect, it } from 'vitest';
import {
  prepareSequenceContinuationOfferV1,
  deliverSequenceContinuationOutcomeV1,
} from './sequence-continuation-delivery.js';
import type { PromptEnhancementSequenceRuntimeStateV1 } from './sequence-runtime.js';

function state(
  overrides: Partial<PromptEnhancementSequenceRuntimeStateV1> = {},
): PromptEnhancementSequenceRuntimeStateV1 {
  return {
    sequenceId: 'seq-1', enhancementId: 'enh-1', projectRoot: '/tmp/p', sessionId: 's1',
    itemCount: 3, currentItemIndex: 0, status: 'awaiting_response', lastActionId: null,
    ...overrides,
  };
}

describe('continuation offer step', () => {
  it('awaiting_response advances to OFFER the next item (never sends)', () => {
    const offer = prepareSequenceContinuationOfferV1(state(), 'offer-1');
    expect(offer.state).toBe('offer');
    if (offer.state !== 'offer') return;
    expect(offer.advanced).toBe(true);
    expect(offer.itemIndex).toBe(1);
    expect(offer.offeredState).toMatchObject({ currentItemIndex: 1, status: 'item_pending', lastActionId: 'offer-1' });
  });

  it('item_pending re-offers the SAME item without a state change (post-interruption)', () => {
    const pending = state({ status: 'item_pending', currentItemIndex: 1, lastActionId: 'prev' });
    const offer = prepareSequenceContinuationOfferV1(pending, 'offer-2');
    expect(offer).toEqual({ state: 'offer', itemIndex: 1, offeredState: pending, advanced: false });
  });

  it('advancing past the last item completes the sequence (no offer, terminal)', () => {
    const last = state({ status: 'awaiting_response', currentItemIndex: 2, itemCount: 3 });
    const offer = prepareSequenceContinuationOfferV1(last, 'offer-3');
    expect(offer.state).toBe('sequence_complete');
    if (offer.state !== 'sequence_complete') return;
    expect(offer.terminalState.status).toBe('completed');
  });

  it('a terminal / non-offerable status yields no offer', () => {
    expect(prepareSequenceContinuationOfferV1(state({ status: 'completed' }), 'o').state).toBe('no_offer');
    expect(prepareSequenceContinuationOfferV1(state({ status: 'cancelled' }), 'o').state).toBe('no_offer');
  });
});

describe('continuation outcome delivery', () => {
  const offered = state({ status: 'item_pending', currentItemIndex: 1 });

  it('send → inject the body + mark the item in flight', () => {
    const out = deliverSequenceContinuationOutcomeV1(offered, { state: 'send', bodyText: 'the item body' }, 'act-1');
    expect(out.kind).toBe('inject');
    if (out.kind !== 'inject') return;
    expect(out.bodyText).toBe('the item body');
    expect(out.nextState).toMatchObject({ status: 'awaiting_response', currentItemIndex: 1, lastActionId: 'act-1' });
  });

  it('interruption → keep the SAME item pending (pointer unchanged)', () => {
    const out = deliverSequenceContinuationOutcomeV1(offered, { state: 'interruption' }, 'act-2');
    expect(out.kind).toBe('keep');
    if (out.kind !== 'keep') return;
    expect(out.nextState).toMatchObject({ status: 'item_pending', currentItemIndex: 1 });
  });

  it('declined → keep the offered state unchanged (returns next Stop, like interruption)', () => {
    const out = deliverSequenceContinuationOutcomeV1(offered, { state: 'declined' }, 'act-3');
    expect(out).toEqual({ kind: 'keep', nextState: offered });
  });

  it('cancelled → terminal cancel', () => {
    const out = deliverSequenceContinuationOutcomeV1(offered, { state: 'cancelled' }, 'act-4');
    expect(out.kind).toBe('cancel');
    if (out.kind !== 'cancel') return;
    expect(out.nextState.status).toBe('cancelled');
  });

  it('a rejected transition surfaces as reject, not a throw (e.g. send on a non-pending state)', () => {
    const wrongStatus = state({ status: 'awaiting_response', currentItemIndex: 1 });
    const out = deliverSequenceContinuationOutcomeV1(wrongStatus, { state: 'send', bodyText: 'x' }, 'act-5');
    expect(out).toEqual({ kind: 'reject', reasonCode: 'invalid_status_for_action' });
  });
});

describe('continuation full walk (offer → deliver, offer → deliver, …)', () => {
  it('drives a 3-item sequence: offer→send, offer→interruption, re-offer→send, offer→complete', () => {
    let s = state({ itemCount: 3, currentItemIndex: 0, status: 'awaiting_response' });

    // Stop 1: offer item 1, user sends it.
    let offer = prepareSequenceContinuationOfferV1(s, 'o1');
    expect(offer.state).toBe('offer');
    if (offer.state !== 'offer') return;
    let deliver = deliverSequenceContinuationOutcomeV1(offer.offeredState, { state: 'send', bodyText: 'item 1' }, 'd1');
    expect(deliver.kind).toBe('inject');
    if (deliver.kind !== 'inject') return;
    s = deliver.nextState; // awaiting_response(1)

    // Stop 2: offer item 2, user interrupts — item 2 stays pending.
    offer = prepareSequenceContinuationOfferV1(s, 'o2');
    expect(offer.state).toBe('offer');
    if (offer.state !== 'offer') return;
    expect(offer.itemIndex).toBe(2);
    deliver = deliverSequenceContinuationOutcomeV1(offer.offeredState, { state: 'interruption' }, 'd2');
    expect(deliver.kind).toBe('keep');
    if (deliver.kind !== 'keep') return;
    s = deliver.nextState; // item_pending(2)

    // Stop 3: re-offer the SAME item 2 (no advance), user sends it.
    offer = prepareSequenceContinuationOfferV1(s, 'o3');
    expect(offer.state).toBe('offer');
    if (offer.state !== 'offer') return;
    expect(offer.itemIndex).toBe(2);
    expect(offer.advanced).toBe(false);
    deliver = deliverSequenceContinuationOutcomeV1(offer.offeredState, { state: 'send', bodyText: 'item 2' }, 'd3');
    expect(deliver.kind).toBe('inject');
    if (deliver.kind !== 'inject') return;
    s = deliver.nextState; // awaiting_response(2)

    // Stop 4: advancing past the last item completes the sequence.
    offer = prepareSequenceContinuationOfferV1(s, 'o4');
    expect(offer.state).toBe('sequence_complete');
  });
});
