import { describe, it, expect } from 'vitest';
import { renderPromptEnhancementHtml } from './pe-html.js';
import type { PromptEnhancementExtensionPayloadV1 } from '../pe-payload.js';

const CSP_SRC = 'vscode-resource:fake-csp';
const FIXED_NONCE = 'test-nonce-deterministic';

const readyPayload: PromptEnhancementExtensionPayloadV1 = {
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
  ],
  closeActionId: 'a-close',
};

describe('renderPromptEnhancementHtml — no-popup / null', () => {
  it('renders the no-popup state when payload is null', () => {
    const html = renderPromptEnhancementHtml(null, { cspSource: CSP_SRC });
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('No prompt enhancement is pending');
  });

  it('never contains DS-specific markup even in the empty state', () => {
    const html = renderPromptEnhancementHtml(null, { cspSource: CSP_SRC });
    expect(html).not.toContain('class="option"');
    expect(html).not.toContain('Suggested alternatives');
  });
});

describe('renderPromptEnhancementHtml — typed non-ready states', () => {
  it('renders loading state from renderState, not body text', () => {
    const html = renderPromptEnhancementHtml({ ...readyPayload, renderState: 'loading' }, { cspSource: CSP_SRC });
    expect(html).toContain('Working on your prompt');
    expect(html).not.toContain('<textarea');
  });

  it('renders blocked state from renderState', () => {
    const html = renderPromptEnhancementHtml({ ...readyPayload, renderState: 'blocked' }, { cspSource: CSP_SRC });
    expect(html).toContain("can't be sent as enhanced");
    expect(html).not.toContain('<textarea');
  });

  it('renders fallback state from renderState', () => {
    const html = renderPromptEnhancementHtml({ ...readyPayload, renderState: 'fallback' }, { cspSource: CSP_SRC });
    expect(html).toContain('fallback version');
    expect(html).not.toContain('<textarea');
  });

  it('renders no_popup state from renderState even with a non-null payload', () => {
    const html = renderPromptEnhancementHtml({ ...readyPayload, renderState: 'no_popup' }, { cspSource: CSP_SRC });
    expect(html).toContain('No prompt enhancement is pending');
  });
});

describe('renderPromptEnhancementHtml — ready state', () => {
  it('renders exactly one editable textarea for the current body', () => {
    const html = renderPromptEnhancementHtml(readyPayload, { cspSource: CSP_SRC, nonce: FIXED_NONCE });
    const textareaCount = (html.match(/<textarea/g) ?? []).length;
    // one for the body + one for additional-details (payload marks it available)
    expect(textareaCount).toBe(2);
    expect(html).toContain('id="pe-body"');
    expect(html).toContain('the enhanced prompt body');
  });

  it('never renders a DS-style numbered option-button list', () => {
    const html = renderPromptEnhancementHtml(readyPayload, { cspSource: CSP_SRC, nonce: FIXED_NONCE });
    expect(html).not.toContain('class="option"');
    expect(html).not.toContain('Suggested alternatives');
    expect(html).not.toContain('data-option-id');
  });

  it('never renders a "Show simpler options" control', () => {
    const html = renderPromptEnhancementHtml(readyPayload, { cspSource: CSP_SRC, nonce: FIXED_NONCE });
    expect(html.toLowerCase()).not.toContain('show simpler options');
  });

  it('renders directional actions as current-body action buttons, disabled ones included but marked disabled', () => {
    const html = renderPromptEnhancementHtml(readyPayload, { cspSource: CSP_SRC, nonce: FIXED_NONCE });
    expect(html).toContain('data-action-id="a-shorter"');
    expect(html).toContain('data-action-type="shorter"');
    expect(html).toContain('data-action-id="a-thorough"');
    expect(html).toMatch(/data-action-id="a-thorough"[^>]*disabled/);
    expect(html).not.toMatch(/data-action-id="a-shorter"[^>]*disabled/);
  });

  it('renders the additional-details field only when the payload marks it available', () => {
    const withDetails = renderPromptEnhancementHtml(readyPayload, { cspSource: CSP_SRC, nonce: FIXED_NONCE });
    expect(withDetails).toContain('id="pe-details"');

    const withoutDetails = renderPromptEnhancementHtml(
      { ...readyPayload, additionalDetailsAvailable: false },
      { cspSource: CSP_SRC, nonce: FIXED_NONCE },
    );
    expect(withoutDetails).not.toContain('id="pe-details"');
  });

  it('escapes the body text', () => {
    const html = renderPromptEnhancementHtml(
      { ...readyPayload, currentBodyText: '<script>alert(1)</script>' },
      { cspSource: CSP_SRC, nonce: FIXED_NONCE },
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('includes the CSP with the nonce for the script and the cspSource for styles', () => {
    const html = renderPromptEnhancementHtml(readyPayload, { cspSource: CSP_SRC, nonce: FIXED_NONCE });
    expect(html).toContain(`script-src 'nonce-${FIXED_NONCE}'`);
    expect(html).toContain(CSP_SRC);
    expect(html).toContain("default-src 'none'");
  });

  it('renders the close control with the closeActionId, or empty when absent', () => {
    const html = renderPromptEnhancementHtml(readyPayload, { cspSource: CSP_SRC, nonce: FIXED_NONCE });
    expect(html).toContain('data-action-id="a-close"');

    const noClose = renderPromptEnhancementHtml(
      { ...readyPayload, closeActionId: null },
      { cspSource: CSP_SRC, nonce: FIXED_NONCE },
    );
    expect(noClose).toContain('id="pe-close" data-action-id=""');
  });

  it('generates a fresh nonce per call when none is supplied', () => {
    const a = renderPromptEnhancementHtml(readyPayload, { cspSource: CSP_SRC });
    const b = renderPromptEnhancementHtml(readyPayload, { cspSource: CSP_SRC });
    const nonceOf = (html: string) => html.match(/nonce-([A-Za-z0-9]+)'/)?.[1];
    expect(nonceOf(a)).toBeTruthy();
    expect(nonceOf(a)).not.toBe(nonceOf(b));
  });
});

describe('renderPromptEnhancementHtml — embedded script source (mirrors html.test.ts locking its own script text)', () => {
  // The script never runs in this test environment (no DOM/acquireVsCodeApi) —
  // exactly like html.ts's own tests, this locks the LITERAL source text of
  // the message contract P6 will consume. Without these, deleting the script
  // or renaming a message type would pass every other test in this file.
  it('posts the four typed message contracts P6 will route', () => {
    const html = renderPromptEnhancementHtml(readyPayload, { cspSource: CSP_SRC, nonce: FIXED_NONCE });
    expect(html).toContain("type: 'pe_deliver_current_body'");
    expect(html).toContain("type: 'pe_directional_action'");
    expect(html).toContain("type: 'pe_close'");
    expect(html).toContain("type: 'pe_submit_additional_details'");
  });

  it('computes hasDirtyAdditionalDetails live from the details field at click time (P7 gate signal)', () => {
    const html = renderPromptEnhancementHtml(readyPayload, { cspSource: CSP_SRC, nonce: FIXED_NONCE });
    expect(html).toContain('hasDirtyAdditionalDetails: !!(detailsEl && detailsEl.value.trim().length > 0)');
  });

  it('computes hasDirtyBodyEdit live from the body textarea at directional-click time (P9 action-loop signal)', () => {
    const html = renderPromptEnhancementHtml(readyPayload, { cspSource: CSP_SRC, nonce: FIXED_NONCE });
    expect(html).toContain('hasDirtyBodyEdit: bodyEl.value !== bodyEl.defaultValue');
  });

  it('guards against clicking a disabled directional action', () => {
    const html = renderPromptEnhancementHtml(readyPayload, { cspSource: CSP_SRC, nonce: FIXED_NONCE });
    expect(html).toContain('if (btn.disabled) return;');
  });

  it('submits additional details on Enter without Shift, not on plain typing', () => {
    const html = renderPromptEnhancementHtml(readyPayload, { cspSource: CSP_SRC, nonce: FIXED_NONCE });
    expect(html).toContain("ev.key === 'Enter' && !ev.shiftKey");
  });

  it('guards the additional-details keydown handler behind detailsEl existing (no crash when the field is absent)', () => {
    const html = renderPromptEnhancementHtml(
      { ...readyPayload, additionalDetailsAvailable: false },
      { cspSource: CSP_SRC, nonce: FIXED_NONCE },
    );
    expect(html).toContain('if (detailsEl)');
    expect(html).not.toContain('id="pe-details"');
  });

  it('sends the canonical bodyId/bodyRevision from the textarea dataset, not free-floating variables', () => {
    const html = renderPromptEnhancementHtml(readyPayload, { cspSource: CSP_SRC, nonce: FIXED_NONCE });
    expect(html).toContain('bodyId: bodyEl.dataset.bodyId');
    expect(html).toContain('bodyRevision: Number(bodyEl.dataset.bodyRevision)');
  });

  it('does not embed any script at all in non-ready states (no acquireVsCodeApi call)', () => {
    for (const renderState of ['no_popup', 'loading', 'blocked', 'fallback'] as const) {
      const html = renderPromptEnhancementHtml({ ...readyPayload, renderState }, { cspSource: CSP_SRC, nonce: FIXED_NONCE });
      expect(html).not.toContain('acquireVsCodeApi');
    }
  });
});
