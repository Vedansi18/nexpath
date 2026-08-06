import { describe, expect, it } from 'vitest';
import { buildPromptEnhancementUiBoundarySessionV1 } from './ui-boundary.js';

describe('stage-1-2 host-independent UI boundary', () => {
  it('rejects an invalid prepare result before any session/render state is created', () => {
    const result = buildPromptEnhancementUiBoundarySessionV1({
      result: { disposition: 'show_current_body' },
      timestampMs: 1,
    });

    expect(result.state).toBe('no_popup');
    expect(result.reasonCodes).toContain('invalid_prepare_result');
    expect(result.session).toBeUndefined();
  });

  it('rejects legacy Decision Session payloads at the typed UI boundary', () => {
    const result = buildPromptEnhancementUiBoundarySessionV1({
      result: {
        schemaVersion: 1,
        enhancementId: 'enhancement-1',
        requestId: 'request-1',
        disposition: 'show_current_body',
        L1: 'legacy-option',
      },
      timestampMs: 2,
    });

    expect(result.state).toBe('no_popup');
    expect(result.reasonCodes).toContain('invalid_prepare_result');
    expect(result.session).toBeUndefined();
});
});
