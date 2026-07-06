// @vitest-environment jsdom

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import type { AdvisoryPayload } from '../../core/ports/ui.port.js';

const mountStubPanelMock = vi.fn().mockReturnValue({} as ShadowRoot);
const injectPromptTextMock = vi.fn().mockResolvedValue(undefined);
const injectPromptTextBoltMock = vi.fn().mockResolvedValue(undefined);
const injectPromptTextLovableMock = vi.fn().mockResolvedValue(undefined);
const clipboardFallbackMock = vi.fn().mockResolvedValue(undefined);
// jsdom's hostname is localhost (agent 'unknown') — default to 'replit' so the
// pre-B4 tests keep exercising the replit injector; dispatch tests override it.
const resolveAgentMock = vi.fn().mockReturnValue('replit');

vi.mock('../ui/stub-panel.js', () => ({
  mountStubPanel: mountStubPanelMock,
}));

vi.mock('./agents/replit-inject.js', () => ({
  injectPromptText: injectPromptTextMock,
}));

vi.mock('./agents/lovable-inject.js', () => ({
  injectPromptText: injectPromptTextLovableMock,
}));
vi.mock('./agents/bolt-inject.js', () => ({
  injectPromptText: injectPromptTextBoltMock,
}));

vi.mock('./agents/inject-kit.js', () => ({
  clipboardFallback: clipboardFallbackMock,
}));

vi.mock('./agents/agent-hosts.js', () => ({
  resolveAgentFromHostname: resolveAgentMock,
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

  it('removes the panel root when a dismiss event is emitted', () => {
    dispatchShowAdvisory(makePayload());
    expect(document.getElementById('nexpath-panel-root')).not.toBeNull();

    const onEvent = mountStubPanelMock.mock.calls[0]![2] as (e: { type: string }) => void;
    onEvent({ type: 'dismiss' });

    expect(document.getElementById('nexpath-panel-root')).toBeNull();
  });

  it('injects the selected option text and removes the panel when a select event is emitted', () => {
    dispatchShowAdvisory(makePayload());
    injectPromptTextMock.mockClear();

    const onEvent = mountStubPanelMock.mock.calls[0]![2] as (e: { type: string; optionIndex?: number; text?: string }) => void;
    onEvent({ type: 'select', optionIndex: 0, text: 'Write the tests now' });

    expect(injectPromptTextMock).toHaveBeenCalledWith('Write the tests now');
    expect(document.getElementById('nexpath-panel-root')).toBeNull();
  });

  describe('per-agent inject-back dispatch (B4)', () => {
    afterEach(() => {
      resolveAgentMock.mockReturnValue('replit');
    });

    function emitSelect(text: string): void {
      dispatchShowAdvisory(makePayload());
      const onEvent = mountStubPanelMock.mock.calls.at(-1)![2] as (e: { type: string; optionIndex?: number; text?: string }) => void;
      onEvent({ type: 'select', optionIndex: 0, text });
    }

    it('routes to the bolt injector on bolt hosts', () => {
      resolveAgentMock.mockReturnValue('bolt');
      injectPromptTextBoltMock.mockClear();

      emitSelect('add tests to the app');

      expect(injectPromptTextBoltMock).toHaveBeenCalledWith('add tests to the app');
      expect(injectPromptTextMock).not.toHaveBeenCalledWith('add tests to the app');
    });

    it('routes to the lovable injector on lovable hosts (B5)', () => {
      resolveAgentMock.mockReturnValue('lovable');
      injectPromptTextLovableMock.mockClear();

      emitSelect('make the cards responsive');

      expect(injectPromptTextLovableMock).toHaveBeenCalledWith('make the cards responsive');
      expect(injectPromptTextMock).not.toHaveBeenCalledWith('make the cards responsive');
      expect(injectPromptTextBoltMock).not.toHaveBeenCalledWith('make the cards responsive');
    });

    it('degrades to the clipboard fallback on hosts with no injector (unknown agents)', () => {
      resolveAgentMock.mockReturnValue('unknown');
      clipboardFallbackMock.mockClear();

      emitSelect('review the edge cases');

      expect(clipboardFallbackMock).toHaveBeenCalledWith('review the edge cases');
      expect(injectPromptTextMock).not.toHaveBeenCalledWith('review the edge cases');
      expect(injectPromptTextBoltMock).not.toHaveBeenCalledWith('review the edge cases');
      expect(injectPromptTextLovableMock).not.toHaveBeenCalledWith('review the edge cases');
    });
  });

  describe('nexpath:panel-event reporting (SW round-trip)', () => {
    // Confirmed real bug 2026-07-02: without this, main-world-injector.ts's onMessage
    // listener (which the SW's showAdvisory() awaits directly) never learns what the
    // user did, so every advisory resolved as a synthetic dismiss on the SW side.
    it('dispatches a select PanelEvent with the chosen option\'s id when an option is picked', () => {
      const payload = makePayload({
        options: [
          { id: 'adv-1-L1', title: 'Do the thing', body: 'Full body text', level: 'L1' },
        ],
      });
      dispatchShowAdvisory(payload);

      const received = vi.fn();
      window.addEventListener('nexpath:panel-event', (ev) => received((ev as CustomEvent).detail));

      const onEvent = mountStubPanelMock.mock.calls[0]![2] as (e: { type: string; optionIndex?: number; text?: string }) => void;
      onEvent({ type: 'select', optionIndex: 0, text: 'Do the thing' });

      expect(received).toHaveBeenCalledWith({
        type: 'select',
        advisoryId: 'adv-1',
        selectedOptionId: 'adv-1-L1',
      });
    });

    it('dispatches a dismiss PanelEvent with the advisoryId when the panel is dismissed', () => {
      const payload = makePayload({ advisoryId: 'adv-2' });
      dispatchShowAdvisory(payload);

      const received = vi.fn();
      window.addEventListener('nexpath:panel-event', (ev) => received((ev as CustomEvent).detail));

      const onEvent = mountStubPanelMock.mock.calls[0]![2] as (e: { type: string }) => void;
      onEvent({ type: 'dismiss' });

      expect(received).toHaveBeenCalledWith({ type: 'dismiss', advisoryId: 'adv-2' });
    });
  });

  describe('idempotent-injection guard', () => {
    it('does not re-register its listener on a second import into the same page', async () => {
      // Simulates a stale content-script re-injection: the window flag from the earlier
      // beforeAll import is still set (persists on the real jsdom window), so re-importing
      // the module (as if the extension re-injected it into an already-open tab) must be
      // a no-op this time.
      expect(window.__nexpathInjectBootstrapped).toBe(true);

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.resetModules();
      await import('./inject.js');

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('skipped, already bootstrapped'));

      // A duplicate listener would double-mount the panel for the same event.
      mountStubPanelMock.mockClear();
      dispatchShowAdvisory(makePayload());
      expect(mountStubPanelMock).toHaveBeenCalledTimes(1);

      logSpy.mockRestore();
    });
  });
});
