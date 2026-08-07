import { describe, it, expect } from 'vitest';
import { parsePromptEnhancementExtensionPayloadV1 } from './pe-payload.js';

function rawResult(overrides: Record<string, unknown> = {}): string {
  const base = {
    enhancementId: 'enh-1',
    validationDecisionId: 'vd-1',
    uiView: {
      body: {
        text: 'the enhanced prompt body',
        currentBodyId: 'body-1',
        bodyRevision: 3,
        sendPolicy: 'send_current',
        fallbackMode: 'none',
        actionLoadingState: 'idle',
      },
      actions: [
        { actionType: 'shorter', actionId: 'a-shorter', label: 'Shorter', availability: 'available' },
        { actionType: 'more_thorough', actionId: 'a-thorough', label: 'More thorough', availability: 'disabled_loading' },
        { actionType: 'more_project_grounded', actionId: 'a-grounded', label: 'More project-grounded', availability: 'available' },
        { actionType: 'apply_details', actionId: 'a-details', label: 'Apply details', availability: 'available' },
        { actionType: 'close', actionId: 'a-close', label: 'Close', availability: 'available' },
        { actionType: 'use_current_body', actionId: 'a-use', label: 'Use this prompt', availability: 'available' },
      ],
    },
    ...overrides,
  };
  return JSON.stringify(base);
}

describe('parsePromptEnhancementExtensionPayloadV1', () => {
  it('parses a well-formed result into the extension payload envelope', () => {
    const out = parsePromptEnhancementExtensionPayloadV1(rawResult());
    expect(out).toEqual({
      transportVersion: 1,
      enhancementId: 'enh-1',
      validationDecisionId: 'vd-1',
      currentBodyId: 'body-1',
      bodyRevision: 3,
      currentBodyText: 'the enhanced prompt body',
      sendPolicy: 'send_current',
      renderState: 'ready',
      additionalDetailsAvailable: true,
      directionalActions: [
        { actionType: 'shorter', actionId: 'a-shorter', label: 'Shorter', available: true },
        { actionType: 'more_thorough', actionId: 'a-thorough', label: 'More thorough', available: false },
        { actionType: 'more_project_grounded', actionId: 'a-grounded', label: 'More project-grounded', available: true },
      ],
      closeActionId: 'a-close',
    });
  });

  it('returns null for invalid JSON', () => {
    expect(parsePromptEnhancementExtensionPayloadV1('{not json')).toBeNull();
  });

  for (const field of ['enhancementId', 'validationDecisionId']) {
    it(`returns null when ${field} is missing`, () => {
      const raw = JSON.parse(rawResult());
      delete raw[field];
      expect(parsePromptEnhancementExtensionPayloadV1(JSON.stringify(raw))).toBeNull();
    });
  }

  it('returns null when uiView is missing', () => {
    const raw = JSON.parse(rawResult());
    delete raw.uiView;
    expect(parsePromptEnhancementExtensionPayloadV1(JSON.stringify(raw))).toBeNull();
  });

  it('returns null when body is missing', () => {
    const raw = JSON.parse(rawResult());
    delete raw.uiView.body;
    expect(parsePromptEnhancementExtensionPayloadV1(JSON.stringify(raw))).toBeNull();
  });

  it('returns null when sendPolicy is not one of the known values', () => {
    expect(
      parsePromptEnhancementExtensionPayloadV1(
        rawResult({ uiView: { body: { text: 'x', currentBodyId: 'b', bodyRevision: 1, sendPolicy: 'bogus_policy' }, actions: [] } }),
      ),
    ).toBeNull();
  });

  it('returns null when currentBodyId is missing', () => {
    expect(
      parsePromptEnhancementExtensionPayloadV1(
        rawResult({ uiView: { body: { text: 'x', bodyRevision: 1, sendPolicy: 'send_current' }, actions: [] } }),
      ),
    ).toBeNull();
  });

  it('returns null when bodyRevision is not a number', () => {
    expect(
      parsePromptEnhancementExtensionPayloadV1(
        rawResult({ uiView: { body: { text: 'x', currentBodyId: 'b', bodyRevision: '3', sendPolicy: 'send_current' }, actions: [] } }),
      ),
    ).toBeNull();
  });

  it('self-scrubs currentBodyText to empty string when sendPolicy is no_send', () => {
    const out = parsePromptEnhancementExtensionPayloadV1(
      rawResult({ uiView: { body: { text: 'SENSITIVE BODY', currentBodyId: 'b', bodyRevision: 1, sendPolicy: 'no_send' }, actions: [] } }),
    );
    expect(out?.currentBodyText).toBe('');
    expect(out?.renderState).toBe('blocked');
  });

  it('self-scrubs currentBodyText to empty string when sendPolicy is no_popup', () => {
    const out = parsePromptEnhancementExtensionPayloadV1(
      rawResult({ uiView: { body: { text: 'SENSITIVE BODY', currentBodyId: 'b', bodyRevision: 1, sendPolicy: 'no_popup' }, actions: [] } }),
    );
    expect(out?.currentBodyText).toBe('');
    expect(out?.renderState).toBe('no_popup');
  });

  it('renderState is loading when actionLoadingState is loading_action', () => {
    const out = parsePromptEnhancementExtensionPayloadV1(
      rawResult({
        uiView: {
          body: { text: 'x', currentBodyId: 'b', bodyRevision: 1, sendPolicy: 'send_current', actionLoadingState: 'loading_action', fallbackMode: 'none' },
          actions: [],
        },
      }),
    );
    expect(out?.renderState).toBe('loading');
  });

  it('renderState is fallback when fallbackMode is neither none nor previous_sendable_body', () => {
    const out = parsePromptEnhancementExtensionPayloadV1(
      rawResult({
        uiView: {
          body: { text: 'x', currentBodyId: 'b', bodyRevision: 1, sendPolicy: 'send_current', fallbackMode: 'deterministic_body', actionLoadingState: 'idle' },
          actions: [],
        },
      }),
    );
    expect(out?.renderState).toBe('fallback');
  });

  it('renderState is ready for previous_sendable_body fallback (treated as normal, not fallback-flagged)', () => {
    const out = parsePromptEnhancementExtensionPayloadV1(
      rawResult({
        uiView: {
          body: { text: 'x', currentBodyId: 'b', bodyRevision: 1, sendPolicy: 'send_current', fallbackMode: 'previous_sendable_body', actionLoadingState: 'idle' },
          actions: [],
        },
      }),
    );
    expect(out?.renderState).toBe('ready');
  });

  it('tolerates a non-array actions field (empty directional set, no crash)', () => {
    const out = parsePromptEnhancementExtensionPayloadV1(
      rawResult({ uiView: { body: { text: 'x', currentBodyId: 'b', bodyRevision: 1, sendPolicy: 'send_current' }, actions: 'not-an-array' } }),
    );
    expect(out?.directionalActions).toEqual([]);
    expect(out?.closeActionId).toBeNull();
    expect(out?.additionalDetailsAvailable).toBe(false);
  });

  it('skips malformed action entries instead of crashing', () => {
    const out = parsePromptEnhancementExtensionPayloadV1(
      rawResult({
        uiView: {
          body: { text: 'x', currentBodyId: 'b', bodyRevision: 1, sendPolicy: 'send_current' },
          actions: [null, 42, { actionType: 'shorter' /* missing actionId/label */ }, { actionType: 'shorter', actionId: 'ok', label: 'Shorter', availability: 'available' }],
        },
      }),
    );
    expect(out?.directionalActions).toEqual([
      { actionType: 'shorter', actionId: 'ok', label: 'Shorter', available: true },
    ]);
  });

  it('ignores unknown action types (not use_current_body/use_original/feedback/etc. in the directional set)', () => {
    const out = parsePromptEnhancementExtensionPayloadV1(
      rawResult({
        uiView: {
          body: { text: 'x', currentBodyId: 'b', bodyRevision: 1, sendPolicy: 'send_current' },
          actions: [{ actionType: 'use_original', actionId: 'a', label: 'Use original', availability: 'available' }],
        },
      }),
    );
    expect(out?.directionalActions).toEqual([]);
  });

  it('closeActionId is null when no close action is present', () => {
    const out = parsePromptEnhancementExtensionPayloadV1(
      rawResult({ uiView: { body: { text: 'x', currentBodyId: 'b', bodyRevision: 1, sendPolicy: 'send_current' }, actions: [] } }),
    );
    expect(out?.closeActionId).toBeNull();
  });
});
