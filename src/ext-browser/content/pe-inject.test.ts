// @vitest-environment jsdom
/**
 * Content-side PE popup wiring — the module that mounts the panel, bridges
 * commands out, keepalives while open, fail-opens on a dead SW (the 12s
 * terminal watchdog), and guards the inject echo. The module registers its
 * window listeners ONCE (like the real content script) — so it is imported
 * once for the file, and each test starts from a torn-down state via a real
 * `pagehide` (the module's own teardown path). Timers are faked; the panel
 * and the inject dispatch are mocked so this file tests ONLY the wiring
 * contracts (the panel's behaviour lives in ui/pe-panel.test.ts, the dispatch
 * table in inject-dispatch.test.ts).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PePanelEventV1, PePanelViewV1 } from '../ui/pe-contract.js';

const { injectPromptTextMock, showToastMock, controller, mountMock } = vi.hoisted(() => {
  const controller = {
    openFlag: false,
    show: vi.fn(),
    setBusy: vi.fn(),
    hide: vi.fn(),
    destroy: vi.fn(),
    isOpen: vi.fn(),
  };
  return {
    injectPromptTextMock: vi.fn(),
    showToastMock: vi.fn(),
    controller,
    mountMock: vi.fn(),
  };
});
vi.mock('./inject-dispatch.js', () => ({ injectPromptText: injectPromptTextMock }));
vi.mock('./agents/inject-kit.js', () => ({ showToast: showToastMock }));
vi.mock('../ui/pe-panel.js', () => ({ mountNexpathPePanel: mountMock }));

let onEvent: (event: PePanelEventV1) => void;
const liveSpies: Array<[string, EventListener]> = [];

function view(seq = 1): PePanelViewV1 {
  return {
    schemaVersion: 1, viewSeq: seq, title: 't', editorHeading: 'h',
    bodyText: 'b', bodyEditable: true, hasAdditionalDetails: false,
    additionalDetailsText: '', directional: [], refinement: false,
    hasFeedback: false, trustCues: [],
  };
}

function dispatchSwMessage(detail: unknown): void {
  window.dispatchEvent(new CustomEvent('nexpath:sw-message', { detail }));
}

function showPe(seq = 1): void {
  dispatchSwMessage({ type: 'nexpath:show-pe', projectRoot: 'https://bolt.new/~/p', payload: view(seq) });
}

/** Record dispatches of a window CustomEvent; auto-removed after each test. */
function spyEvent(name: string): { calls: unknown[] } {
  const rec = { calls: [] as unknown[] };
  const handler: EventListener = (ev) => { rec.calls.push((ev as CustomEvent<unknown>).detail ?? null); };
  window.addEventListener(name, handler);
  liveSpies.push([name, handler]);
  return rec;
}

beforeAll(async () => {
  (await import('./pe-inject.js')).setupPeListener();
});

beforeEach(() => {
  // The module's own teardown path resets its internal state (controller/host/
  // timers null) so every test starts from "nothing mounted".
  window.dispatchEvent(new Event('pagehide'));
  vi.clearAllMocks();
  vi.useFakeTimers();
  injectPromptTextMock.mockResolvedValue(undefined);
  controller.openFlag = false;
  controller.show.mockImplementation(() => { controller.openFlag = true; });
  controller.hide.mockImplementation(() => { controller.openFlag = false; });
  controller.isOpen.mockImplementation(() => controller.openFlag);
  mountMock.mockImplementation((_el: HTMLElement, opts: { onEvent: typeof onEvent }) => {
    onEvent = opts.onEvent;
    return controller;
  });
});

afterEach(() => {
  for (const [name, handler] of liveSpies.splice(0)) window.removeEventListener(name, handler);
  vi.useRealTimers();
});

describe('show-pe handling', () => {
  it('mounts into a closed-shadow host, shows the view, and acks AFTER the mount', () => {
    const ack = spyEvent('nexpath:pe-view-ack');
    showPe();
    const host = document.getElementById('nexpath-pe-panel-host');
    expect(host).toBeTruthy();
    expect(host!.shadowRoot).toBeNull(); // closed shadow — invisible to the page
    expect(mountMock).toHaveBeenCalledTimes(1);
    expect(controller.show).toHaveBeenCalledWith(expect.objectContaining({ viewSeq: 1 }));
    expect(ack.calls).toHaveLength(1);
    showPe(2); // a re-render reuses the mount
    expect(mountMock).toHaveBeenCalledTimes(1);
    expect(controller.show).toHaveBeenCalledTimes(2);
  });

  it('a schemaVersion mismatch is ignored — no show, no ack', () => {
    const ack = spyEvent('nexpath:pe-view-ack');
    dispatchSwMessage({ type: 'nexpath:show-pe', projectRoot: 'r', payload: { ...view(), schemaVersion: 99 } });
    expect(controller.show).not.toHaveBeenCalled();
    expect(ack.calls).toHaveLength(0);
  });

  it('keepalives every 20s while open and stops after close', () => {
    const beat = spyEvent('nexpath:pe-keepalive-out');
    showPe();
    vi.advanceTimersByTime(60_000);
    expect(beat.calls).toHaveLength(3);
    dispatchSwMessage({ type: 'nexpath:pe-close', projectRoot: 'r' });
    vi.advanceTimersByTime(60_000);
    expect(beat.calls).toHaveLength(3); // no beats after the panel closed
  });
});

describe('command bridging', () => {
  it('a non-terminal command sets busy and goes out with its viewSeq', () => {
    const out = spyEvent('nexpath:pe-command-out');
    showPe(4);
    onEvent({ type: 'command', viewSeq: 4, command: { type: 'shorter', bodyText: 'b' } });
    expect(controller.setBusy).toHaveBeenCalledWith(true);
    expect(out.calls[0]).toEqual({ viewSeq: 4, command: { type: 'shorter', bodyText: 'b' } });
  });

  it('feedback_suggested goes out WITHOUT busy (non-terminal, no re-render comes)', () => {
    const out = spyEvent('nexpath:pe-command-out');
    showPe();
    onEvent({ type: 'command', viewSeq: 1, command: { type: 'feedback_suggested', category: 'not_relevant_enough' } });
    expect(controller.setBusy).not.toHaveBeenCalled();
    expect(out.calls).toHaveLength(1);
  });

  it('a move event drags the host and converts the centered transform to px', () => {
    showPe();
    const host = document.getElementById('nexpath-pe-panel-host')!;
    onEvent({ type: 'move', dx: 30, dy: -10 });
    expect(host.style.transform).toBe('none');
    expect(host.style.left.endsWith('px')).toBe(true);
  });
});

describe('terminal watchdog (A3 fail-open — a dead SW must never send text)', () => {
  it('a terminal command arms the watchdog; no SW answer within 12s closes with the nothing-sent toast', () => {
    const notice = spyEvent('nexpath:pe-terminal-out');
    showPe();
    onEvent({ type: 'command', viewSeq: 1, command: { type: 'use_current', bodyText: 'b' } });
    expect(notice.calls[0]).toEqual({ outcome: 'use_current' });
    vi.advanceTimersByTime(11_999);
    expect(controller.hide).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(showToastMock).toHaveBeenCalledWith(expect.stringContaining('nothing was sent'));
    expect(controller.hide).toHaveBeenCalled();
    expect(injectPromptTextMock).not.toHaveBeenCalled(); // fail-open NEVER injects locally
  });

  it('a fresh view from the SW clears the watchdog (the SW answered)', () => {
    showPe();
    onEvent({ type: 'command', viewSeq: 1, command: { type: 'use_original' } });
    showPe(2); // the SW responded with a re-render
    vi.advanceTimersByTime(30_000);
    expect(showToastMock).not.toHaveBeenCalled();
  });
});

describe('pe-inject (the accepted enhanced body arrives)', () => {
  it('dispatches the echo-guard notice BEFORE injecting, closes the panel, injects the exact text', () => {
    const order: string[] = [];
    const guardHandler: EventListener = () => order.push('echo-guard');
    window.addEventListener('nexpath:prompt-injected-notice', guardHandler);
    liveSpies.push(['nexpath:prompt-injected-notice', guardHandler]);
    injectPromptTextMock.mockImplementation(async () => { order.push('inject'); });
    showPe();
    dispatchSwMessage({ type: 'nexpath:pe-inject', projectRoot: 'r', text: 'THE ENHANCED BODY' });
    expect(order).toEqual(['echo-guard', 'inject']);
    expect(injectPromptTextMock).toHaveBeenCalledWith('THE ENHANCED BODY');
    expect(controller.hide).toHaveBeenCalled();
  });

  it('the echo-guard notice carries the injected text (the SW records it as last-seen)', () => {
    const guard = spyEvent('nexpath:prompt-injected-notice');
    showPe();
    dispatchSwMessage({ type: 'nexpath:pe-inject', projectRoot: 'r', text: 'X' });
    expect(guard.calls[0]).toEqual({ text: 'X' });
  });
});

describe('pagehide teardown', () => {
  it('destroys the controller, removes the host, and stops all timers', () => {
    const beat = spyEvent('nexpath:pe-keepalive-out');
    showPe();
    window.dispatchEvent(new Event('pagehide'));
    expect(controller.destroy).toHaveBeenCalled();
    expect(document.getElementById('nexpath-pe-panel-host')).toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(beat.calls).toHaveLength(0);
  });
});
