// @vitest-environment jsdom

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import type { AdvisoryPayload } from '../../core/ports/ui.port.js';

const mountStubPanelMock = vi.fn().mockReturnValue({} as ShadowRoot);

vi.mock('../ui/stub-panel.js', () => ({
  mountStubPanel: mountStubPanelMock,
}));

function makePayload(overrides: Partial<AdvisoryPayload> = {}): AdvisoryPayload {
  return {
    schemaVersion: 1,
    advisoryId: 'adv-1',
    pinchLabel: 'Hold up.',
    stage: 'implementation',
    options: [],
    meta: { agent: 'replit', frequency: 'optimum' },
    ...overrides,
  };
}

function dispatchShowAdvisory(payload: AdvisoryPayload): void {
  window.dispatchEvent(
    new CustomEvent('nexpath:sw-message', {
      detail: { type: 'nexpath:show-advisory', payload },
    }),
  );
}

describe('inject.ts', () => {
  // The module attaches its 'nexpath:sw-message' listener once, at import time, to the
  // real jsdom `window` (which persists across tests in this file) — so it must be
  // imported exactly once, not re-imported per test (that would stack duplicate listeners).
  beforeAll(async () => {
    await import('./inject.js');
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    mountStubPanelMock.mockClear();
  });

  it('ignores events that are not ShowAdvisoryMsg', () => {
    window.dispatchEvent(new CustomEvent('nexpath:sw-message', { detail: { type: 'something-else' } }));
    expect(mountStubPanelMock).not.toHaveBeenCalled();
  });

  it('mounts the stub panel for a valid schemaVersion', () => {
    const payload = makePayload();
    dispatchShowAdvisory(payload);
    expect(mountStubPanelMock).toHaveBeenCalledOnce();
    const [rootArg, payloadArg] = mountStubPanelMock.mock.calls[0]!;
    expect((rootArg as HTMLElement).id).toBe('nexpath-panel-root');
    expect(payloadArg).toBe(payload);
  });

  it('appends the panel root to document.body', () => {
    dispatchShowAdvisory(makePayload());
    expect(document.getElementById('nexpath-panel-root')).not.toBeNull();
  });

  it('bails on schemaVersion mismatch — no panel mounted, warns instead', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // @ts-expect-error — deliberately wrong schemaVersion to test the guard
    dispatchShowAdvisory(makePayload({ schemaVersion: 2 }));
    expect(mountStubPanelMock).not.toHaveBeenCalled();
    expect(document.getElementById('nexpath-panel-root')).toBeNull();
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0]![0]).toContain('schemaVersion mismatch');
    warnSpy.mockRestore();
  });

  it('removes the previous panel before mounting a new one', () => {
    dispatchShowAdvisory(makePayload({ advisoryId: 'adv-1' }));
    const firstRoot = document.getElementById('nexpath-panel-root');
    expect(firstRoot).not.toBeNull();

    dispatchShowAdvisory(makePayload({ advisoryId: 'adv-2' }));
    // Only one panel root should ever exist in the DOM at a time.
    expect(document.querySelectorAll('#nexpath-panel-root').length).toBe(1);
    expect(mountStubPanelMock).toHaveBeenCalledTimes(2);
  });

  it('removes the panel root when onDismiss is invoked', () => {
    dispatchShowAdvisory(makePayload());
    expect(document.getElementById('nexpath-panel-root')).not.toBeNull();

    const onDismiss = mountStubPanelMock.mock.calls[0]![2] as () => void;
    onDismiss();

    expect(document.getElementById('nexpath-panel-root')).toBeNull();
  });
});
