// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountStubPanel } from './stub-panel.js';
import type { AdvisoryPayload } from '../../core/ports/ui.port.js';

function makePayload(overrides: Partial<AdvisoryPayload> = {}): AdvisoryPayload {
  return {
    schemaVersion: 1,
    advisoryId: 'adv-1',
    pinchLabel: 'Hold up.',
    stage: 'implementation',
    options: [
      { id: 'l1-0', level: 'L1', title: 'Write the tests now', body: 'Tests prevent regressions.' },
      { id: 'l2-0', level: 'L2', title: 'At least write one test', body: 'Even one helps.' },
      { id: 'l3-0', level: 'L3', title: 'Add a TODO comment', body: 'Mark it for later.' },
    ],
    meta: { agent: 'replit', frequency: 'optimum' },
    ...overrides,
  };
}

describe('mountStubPanel', () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  it('returns a ShadowRoot', () => {
    const shadow = mountStubPanel(root, makePayload(), () => {});
    expect(shadow).toBeDefined();
    expect(shadow.nodeType).toBe(Node.DOCUMENT_FRAGMENT_NODE);
  });

  it('uses closed shadow DOM — root.shadowRoot is null', () => {
    mountStubPanel(root, makePayload(), () => {});
    // mode:'closed' means the host page cannot access the shadow tree
    expect(root.shadowRoot).toBeNull();
  });

  it('renders the pinch label', () => {
    const shadow = mountStubPanel(root, makePayload(), () => {});
    expect(shadow.textContent).toContain('Hold up.');
  });

  it('renders the stage', () => {
    const shadow = mountStubPanel(root, makePayload(), () => {});
    expect(shadow.textContent).toContain('implementation');
  });

  it('renders all three option titles', () => {
    const shadow = mountStubPanel(root, makePayload(), () => {});
    const text = shadow.textContent ?? '';
    expect(text).toContain('Write the tests now');
    expect(text).toContain('At least write one test');
    expect(text).toContain('Add a TODO comment');
  });

  it('renders the agent in meta', () => {
    const shadow = mountStubPanel(root, makePayload(), () => {});
    expect(shadow.textContent).toContain('replit');
  });

  it('calls onDismiss when close button is clicked', () => {
    const onDismiss = vi.fn();
    const shadow = mountStubPanel(root, makePayload(), onDismiss);
    const closeBtn = shadow.querySelector('.close') as HTMLButtonElement;
    closeBtn?.click();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('calls onDismiss when an option button is clicked', () => {
    const onDismiss = vi.fn();
    const shadow = mountStubPanel(root, makePayload(), onDismiss);
    const optBtns = shadow.querySelectorAll('.opt') as NodeListOf<HTMLButtonElement>;
    optBtns[0]?.click();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('renders empty options list when payload has no options', () => {
    const shadow = mountStubPanel(root, makePayload({ options: [] }), () => {});
    const optBtns = shadow.querySelectorAll('.opt');
    expect(optBtns?.length).toBe(0);
  });

  it('HTML-escapes XSS in pinch label', () => {
    const shadow = mountStubPanel(root, makePayload({ pinchLabel: '<script>alert(1)</script>' }), () => {});
    const html = shadow.innerHTML ?? '';
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
