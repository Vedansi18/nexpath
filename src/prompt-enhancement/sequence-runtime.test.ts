import { describe, expect, it } from 'vitest';
import {
  applyPromptEnhancementSequenceRuntimeActionV1,
  createPromptEnhancementSequenceRuntimeStateV1,
  validatePromptEnhancementSequenceRuntimeStateV1,
  type PromptEnhancementSequenceRuntimeStateV1,
} from './sequence-runtime.js';

function baseState(
  overrides: Partial<PromptEnhancementSequenceRuntimeStateV1> = {},
): PromptEnhancementSequenceRuntimeStateV1 {
  return {
    sequenceId:       'seq-1',
    enhancementId:    'enh-1',
    projectRoot:      '/tmp/proj',
    sessionId:        'sess-1',
    itemCount:        3,
    currentItemIndex: 0,
    status:           'awaiting_response',
    lastActionId:     null,
    ...overrides,
  };
}

describe('sequence-runtime create', () => {
  it('creates at first-send: item 0 in flight, awaiting_response', () => {
    const created = createPromptEnhancementSequenceRuntimeStateV1({
      sequenceId: 'seq-1', enhancementId: 'enh-1', projectRoot: '/tmp/proj', sessionId: 'sess-1', itemCount: 2,
    });
    expect(created).toEqual({
      ok: true,
      state: baseState({ itemCount: 2 }),
    });
  });

  it('rejects item counts outside the locked bounds (1 too small, 31 too large)', () => {
    for (const itemCount of [0, 1, 31]) {
      const created = createPromptEnhancementSequenceRuntimeStateV1({
        sequenceId: 's', enhancementId: 'e', projectRoot: '/p', sessionId: 'x', itemCount,
      });
      expect(created).toEqual({ ok: false, reasonCode: 'invalid_item_count' });
    }
  });

  it('rejects empty identity fields with typed reasons', () => {
    const created = createPromptEnhancementSequenceRuntimeStateV1({
      sequenceId: ' ', enhancementId: 'e', projectRoot: '/p', sessionId: 'x', itemCount: 2,
    });
    expect(created).toEqual({ ok: false, reasonCode: 'sequence_id_required' });
  });
});

describe('sequence-runtime validate', () => {
  it('accepts a well-formed state and rejects unknown status / bad index fail-closed', () => {
    expect(validatePromptEnhancementSequenceRuntimeStateV1(baseState()).ok).toBe(true);
    expect(validatePromptEnhancementSequenceRuntimeStateV1(baseState({ status: 'weird' as never })).reasonCodes)
      .toContain('invalid_status');
    expect(validatePromptEnhancementSequenceRuntimeStateV1(baseState({ currentItemIndex: 3 })).reasonCodes)
      .toContain('invalid_item_index');
    expect(validatePromptEnhancementSequenceRuntimeStateV1(null).ok).toBe(false);
  });
});

describe('sequence-runtime transitions — full explicit walk', () => {
  it('walks a 3-item sequence to completed with explicit actions only', () => {
    // Item 0 was sent from the first popup (create). Stop → offer item 1.
    let state = baseState();
    let result = applyPromptEnhancementSequenceRuntimeActionV1(state, { type: 'advance_to_next_item', actionId: 'a1' });
    expect(result).toMatchObject({ ok: true, transition: 'next_item_offered' });
    state = (result as { ok: true; state: PromptEnhancementSequenceRuntimeStateV1 }).state;
    expect(state).toMatchObject({ currentItemIndex: 1, status: 'item_pending' });

    // User explicitly sends item 1 from the continuation popup.
    result = applyPromptEnhancementSequenceRuntimeActionV1(state, { type: 'send_current_item', actionId: 'a2', itemIndex: 1 });
    expect(result).toMatchObject({ ok: true, transition: 'item_sent' });
    state = (result as { ok: true; state: PromptEnhancementSequenceRuntimeStateV1 }).state;
    expect(state.status).toBe('awaiting_response');

    // Stop → offer item 2; explicit send; final Stop → completed (bookkeeping only).
    state = (applyPromptEnhancementSequenceRuntimeActionV1(state, { type: 'advance_to_next_item', actionId: 'a3' }) as { ok: true; state: PromptEnhancementSequenceRuntimeStateV1 }).state;
    expect(state).toMatchObject({ currentItemIndex: 2, status: 'item_pending' });
    state = (applyPromptEnhancementSequenceRuntimeActionV1(state, { type: 'send_current_item', actionId: 'a4', itemIndex: 2 }) as { ok: true; state: PromptEnhancementSequenceRuntimeStateV1 }).state;
    result = applyPromptEnhancementSequenceRuntimeActionV1(state, { type: 'advance_to_next_item', actionId: 'a5' });
    expect(result).toMatchObject({ ok: true, transition: 'sequence_completed' });
    expect((result as { ok: true; state: PromptEnhancementSequenceRuntimeStateV1 }).state.status).toBe('completed');
  });

  it('custom interruption keeps the pointer — the same item stays pending', () => {
    const pending = baseState({ currentItemIndex: 1, status: 'item_pending' });
    const result = applyPromptEnhancementSequenceRuntimeActionV1(pending, { type: 'keep_current_item', actionId: 'k1' });
    expect(result).toMatchObject({ ok: true, transition: 'item_kept_pending' });
    const next = (result as { ok: true; state: PromptEnhancementSequenceRuntimeStateV1 }).state;
    expect(next.currentItemIndex).toBe(1);
    expect(next.status).toBe('item_pending');
  });

  it('cancel and abandon are terminal from both active statuses', () => {
    for (const status of ['item_pending', 'awaiting_response'] as const) {
      const cancelled = applyPromptEnhancementSequenceRuntimeActionV1(baseState({ status }), { type: 'cancel_sequence', actionId: 'c1' });
      expect(cancelled).toMatchObject({ ok: true, transition: 'sequence_cancelled' });
      const abandoned = applyPromptEnhancementSequenceRuntimeActionV1(baseState({ status }), { type: 'abandon_sequence', actionId: 'x1' });
      expect(abandoned).toMatchObject({ ok: true, transition: 'sequence_abandoned' });
    }
  });
});

describe('sequence-runtime rejections — typed, no throws', () => {
  it('terminal states are immutable for EVERY action (no resume/restart)', () => {
    for (const status of ['completed', 'cancelled', 'abandoned'] as const) {
      const terminal = baseState({ status });
      for (const action of [
        { type: 'send_current_item', actionId: 'n1', itemIndex: 0 },
        { type: 'advance_to_next_item', actionId: 'n2' },
        { type: 'keep_current_item', actionId: 'n3' },
        { type: 'cancel_sequence', actionId: 'n4' },
        { type: 'abandon_sequence', actionId: 'n5' },
      ] as const) {
        expect(applyPromptEnhancementSequenceRuntimeActionV1(terminal, action))
          .toEqual({ ok: false, reasonCode: 'terminal_state_immutable' });
      }
    }
  });

  it('duplicate action ids are rejected (idempotent replay guard)', () => {
    const state = baseState({ status: 'item_pending', currentItemIndex: 1, lastActionId: 'a2' });
    expect(applyPromptEnhancementSequenceRuntimeActionV1(state, { type: 'send_current_item', actionId: 'a2', itemIndex: 1 }))
      .toEqual({ ok: false, reasonCode: 'duplicate_action_id' });
  });

  it('empty action id is rejected', () => {
    expect(applyPromptEnhancementSequenceRuntimeActionV1(baseState(), { type: 'advance_to_next_item', actionId: '  ' }))
      .toEqual({ ok: false, reasonCode: 'action_id_required' });
  });

  it('send requires item_pending and a matching item index', () => {
    // Wrong status: item is already in flight.
    expect(applyPromptEnhancementSequenceRuntimeActionV1(baseState(), { type: 'send_current_item', actionId: 's1', itemIndex: 0 }))
      .toEqual({ ok: false, reasonCode: 'invalid_status_for_action' });
    // Wrong index: a stale popup can never send a different item.
    const pending = baseState({ status: 'item_pending', currentItemIndex: 1 });
    expect(applyPromptEnhancementSequenceRuntimeActionV1(pending, { type: 'send_current_item', actionId: 's2', itemIndex: 2 }))
      .toEqual({ ok: false, reasonCode: 'item_index_mismatch' });
  });

  it('advance requires awaiting_response; keep requires item_pending', () => {
    const pending = baseState({ status: 'item_pending' });
    expect(applyPromptEnhancementSequenceRuntimeActionV1(pending, { type: 'advance_to_next_item', actionId: 'v1' }))
      .toEqual({ ok: false, reasonCode: 'invalid_status_for_action' });
    expect(applyPromptEnhancementSequenceRuntimeActionV1(baseState(), { type: 'keep_current_item', actionId: 'v2' }))
      .toEqual({ ok: false, reasonCode: 'invalid_status_for_action' });
  });

  it('a corrupt state is rejected before any action logic runs', () => {
    const corrupt = baseState({ itemCount: 1 });
    expect(applyPromptEnhancementSequenceRuntimeActionV1(corrupt, { type: 'advance_to_next_item', actionId: 'z1' }))
      .toEqual({ ok: false, reasonCode: 'invalid_item_count' });
  });
});
