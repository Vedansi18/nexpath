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

  it('attaches a shadow root to the provided element', () => {
    mountStubPanel(root, makePayload(), () => {});
    expect(root.shadowRoot).not.toBeNull();
  });

  it('renders the pinch label', () => {
    mountStubPanel(root, makePayload(), () => {});
    expect(root.shadowRoot?.textContent).toContain('Hold up.');
  });

  it('renders the stage', () => {
    mountStubPanel(root, makePayload(), () => {});
    expect(root.shadowRoot?.textContent).toContain('implementation');
  });

  it('renders all three option titles', () => {
    mountStubPanel(root, makePayload(), () => {});
    const text = root.shadowRoot?.textContent ?? '';
    expect(text).toContain('Write the tests now');
    expect(text).toContain('At least write one test');
    expect(text).toContain('Add a TODO comment');
  });

  it('renders the agent in meta', () => {
    mountStubPanel(root, makePayload(), () => {});
    expect(root.shadowRoot?.textContent).toContain('replit');
  });

  it('calls onDismiss when close button is clicked', () => {
    const onDismiss = vi.fn();
    mountStubPanel(root, makePayload(), onDismiss);
    const closeBtn = root.shadowRoot?.querySelector('.close') as HTMLButtonElement;
    closeBtn?.click();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('calls onDismiss when an option button is clicked', () => {
    const onDismiss = vi.fn();
    mountStubPanel(root, makePayload(), onDismiss);
    const optBtns = root.shadowRoot?.querySelectorAll('.opt') as NodeListOf<HTMLButtonElement>;
    optBtns[0]?.click();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('renders empty options list when payload has no options', () => {
    mountStubPanel(root, makePayload({ options: [] }), () => {});
    const optBtns = root.shadowRoot?.querySelectorAll('.opt');
    expect(optBtns?.length).toBe(0);
  });

  it('HTML-escapes XSS in pinch label', () => {
    mountStubPanel(root, makePayload({ pinchLabel: '<script>alert(1)</script>' }), () => {});
    const html = root.shadowRoot?.innerHTML ?? '';
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
