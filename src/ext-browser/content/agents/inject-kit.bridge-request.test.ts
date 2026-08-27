// @vitest-environment jsdom
/**
 * The WIRE CONTRACT between the inject kit and the page-world bridge.
 *
 * This exists because of a hole found by deleting the two flag lines from
 * `requestMainWorldInject`'s postMessage and re-running the suite: all 1,232
 * tests still passed. The two halves were each well covered and nothing checked
 * the wire between them — the bridge's own tests put the flags into the request
 * themselves, and the kit's tests stub the bridge and never look at the payload.
 * A refactor could therefore have dropped the flags, left CI green, and silently
 * restored the very behaviour they were added to fix.
 *
 * So these tests assert only one thing: what actually goes over postMessage.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { injectViaSimulatedPaste } from './inject-kit.js';

let stopCapture: (() => void) | null = null;

beforeEach(() => {
  document.body.innerHTML = '';
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
});

afterEach(() => {
  stopCapture?.();
  stopCapture = null;
});

function makeComposer(): HTMLElement {
  const input = document.createElement('div');
  input.className = 'tiptap ProseMirror';
  document.body.appendChild(input);
  Object.defineProperty(input, 'getClientRects', { value: () => [{}] });
  return input;
}

/**
 * Record every `nexpath:inject-request` that reaches the page, and answer it as
 * a live bridge would so the delivery completes instead of waiting out its
 * timeout.
 */
function captureBridgeRequests(): Array<Record<string, unknown>> {
  const requests: Array<Record<string, unknown>> = [];
  const onMsg = (ev: MessageEvent): void => {
    const m = ev.data as { type?: string; requestId?: string } | null;
    if (m?.type !== 'nexpath:inject-request') return;
    requests.push(m as Record<string, unknown>);
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'nexpath:inject-result', requestId: m.requestId, landed: true },
      source: window as unknown as MessageEventSource,
    }));
  };
  window.addEventListener('message', onMsg);
  stopCapture = () => window.removeEventListener('message', onMsg);
  return requests;
}

describe('inject-kit → page-world bridge: what actually goes over the wire', () => {
  it('⭐ carries BOTH opt-in flags when the caller sets them (Bolt)', async () => {
    makeComposer();
    const requests = captureBridgeRequests();

    await injectViaSimulatedPaste('.tiptap.ProseMirror', 'ENHANCED BODY', undefined, {
      useRenderedLandingText: true,
      useDirectInsertFirst: true,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      type: 'nexpath:inject-request',
      selector: '.tiptap.ProseMirror',
      text: 'ENHANCED BODY',
      useRenderedLandingText: true,
      useDirectInsertFirst: true,
    });
  });

  it('carries the read flag alone when only that is set (Replit — its order flag is deliberately off)', async () => {
    makeComposer();
    const requests = captureBridgeRequests();

    await injectViaSimulatedPaste('.tiptap.ProseMirror', 'ENHANCED BODY', undefined, {
      useRenderedLandingText: true,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      useRenderedLandingText: true,
      useDirectInsertFirst: false,
    });
  });

  it('carries neither flag when the caller sets no options (Lovable)', async () => {
    makeComposer();
    const requests = captureBridgeRequests();

    await injectViaSimulatedPaste('.tiptap.ProseMirror', 'ENHANCED BODY');

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      useRenderedLandingText: false,
      useDirectInsertFirst: false,
    });
  });
});
