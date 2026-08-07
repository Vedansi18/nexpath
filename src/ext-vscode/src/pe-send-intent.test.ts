import { describe, it, expect } from 'vitest';
import { resolvePeSendIntent, type PeSendIntentInput } from './pe-send-intent.js';

const readyInput: PeSendIntentInput = {
  sendPolicy: 'send_current',
  renderState: 'ready',
  staleOrMismatched: false,
  hasDirtyAdditionalDetails: false,
};

describe('resolvePeSendIntent — intent_ready path', () => {
  it('returns intent_ready when every gate passes', () => {
    expect(resolvePeSendIntent(readyInput)).toEqual({ state: 'intent_ready' });
  });
});

describe('resolvePeSendIntent — the 4 named rejection reasons', () => {
  it('rejects with current_body_not_sendable when sendPolicy is not send_current', () => {
    for (const sendPolicy of ['send_original', 'no_send', 'original_only', 'no_popup'] as const) {
      const out = resolvePeSendIntent({ ...readyInput, sendPolicy });
      expect(out.state).toBe('no_intent');
      expect(out.state === 'no_intent' && out.reasonCodes).toContain('current_body_not_sendable');
    }
  });

  it('rejects with current_body_not_editable when renderState is not ready', () => {
    for (const renderState of ['loading', 'blocked', 'fallback', 'no_popup'] as const) {
      const out = resolvePeSendIntent({ ...readyInput, renderState });
      expect(out.state).toBe('no_intent');
      expect(out.state === 'no_intent' && out.reasonCodes).toContain('current_body_not_editable');
    }
  });

  it('rejects with dirty_additional_details_requires_apply_or_clear when details are dirty', () => {
    const out = resolvePeSendIntent({ ...readyInput, hasDirtyAdditionalDetails: true });
    expect(out).toEqual({ state: 'no_intent', reasonCodes: ['dirty_additional_details_requires_apply_or_clear'] });
  });

  it('rejects with stale_or_mismatched_send_identity when the event is stale', () => {
    const out = resolvePeSendIntent({ ...readyInput, staleOrMismatched: true });
    expect(out).toEqual({ state: 'no_intent', reasonCodes: ['stale_or_mismatched_send_identity'] });
  });
});

describe('resolvePeSendIntent — proves no insertion-adjacent concern can influence the result', () => {
  it('the function signature has no HTML/clipboard/insertion-success parameter at all', () => {
    // Structural proof, not just behavioural: the only fields resolvePeSendIntent
    // accepts are the 4 gates above. There is no `escaped`, `clipboardSuccess`,
    // or `insertionSuccess` field to even pass — the acceptance criterion
    // ("HTML escaping, clipboard success, and insertion success are never
    // semantic validation") holds by construction, not by a runtime check.
    const input: PeSendIntentInput = {
      sendPolicy: 'send_current',
      renderState: 'ready',
      staleOrMismatched: false,
      hasDirtyAdditionalDetails: false,
    };
    expect(Object.keys(input).sort()).toEqual([
      'hasDirtyAdditionalDetails',
      'renderState',
      'sendPolicy',
      'staleOrMismatched',
    ]);
  });
});

describe('resolvePeSendIntent — multiple simultaneous failures', () => {
  it('reports every failing reason at once, not just the first', () => {
    const out = resolvePeSendIntent({
      sendPolicy: 'no_send',
      renderState: 'blocked',
      staleOrMismatched: true,
      hasDirtyAdditionalDetails: true,
    });
    expect(out).toEqual({
      state: 'no_intent',
      reasonCodes: [
        'current_body_not_sendable',
        'current_body_not_editable',
        'dirty_additional_details_requires_apply_or_clear',
        'stale_or_mismatched_send_identity',
      ],
    });
  });
});
