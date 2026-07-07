// @vitest-environment jsdom

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import type { AdvisoryPayload } from '../../core/ports/ui.port.js';
import type { PanelEvent as UiPanelEvent } from '../ui/ui-contract.js';

// Real panel (B5b): mountNexpathPanel mounts ONCE and returns a controller the
// engine drives (show/setBusy/hide/destroy). Capture the onEvent callback so tests
// can simulate each of the 5 contract events.
const showMock = vi.fn();
const setBusyMock = vi.fn();
const hideMock = vi.fn();
const destroyMock = vi.fn();
const mountNexpathPanelMock = vi.fn((_root: HTMLElement, opts: { onEvent: (e: UiPanelEvent) => void }) => {
  capturedOnEvent = opts.onEvent;
  return { show: showMock, setBusy: setBusyMock, hide: hideMock, destroy: destroyMock };
});
let capturedOnEvent: ((e: UiPanelEvent) => void) | null = null;

const injectPromptTextMock = vi.fn().mockResolvedValue(undefined);
const injectPromptTextBoltMock = vi.fn().mockResolvedValue(undefined);
const injectPromptTextLovableMock = vi.fn().mockResolvedValue(undefined);
const clipboardFallbackMock = vi.fn().mockResolvedValue(undefined);
// jsdom hostname is localhost (agent 'unknown') — default to 'replit' so select
// tests exercise the replit injector; dispatch tests override it.
const resolveAgentMock = vi.fn().mockReturnValue('replit');
const clipboardWriteTextMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../ui/panel.js', () => ({
  mountNexpathPanel: mountNexpathPanelMock,
}));
vi.mock('./agents/replit-inject.js', () => ({ injectPromptText: injectPromptTextMock }));
vi.mock('./agents/lovable-inject.js', () => ({ injectPromptText: injectPromptTextLovableMock }));
vi.mock('./agents/bolt-inject.js', () => ({ injectPromptText: injectPromptTextBoltMock }));
vi.mock('./agents/inject-kit.js', () => ({ clipboardFallback: clipboardFallbackMock }));
vi.mock('./agents/agent-hosts.js', () => ({ resolveAgentFromHostname: resolveAgentMock }));

function makeOption(level: 'L1' | 'L2' | 'L3', id: string, title: string) {
  return { id, level, title, body: `${title} — full body text` };
}

function makePayload(overrides: Partial<AdvisoryPayload> = {}): AdvisoryPayload {
  const l1 = makeOption('L1', 'adv-1-L1', 'Run the tests now');
  const l1b = makeOption('L1', 'adv-1-L1-b', 'Run a focused review');
  const l2 = makeOption('L2', 'adv-1-L2', 'Quick check');
  return {
    schemaVersion: 1,
    advisoryId: 'adv-1',
    pinchLabel: 'Hold up.',
    stage: 'implementation',
    question: 'Before shipping — has it been reviewed and tested?',
    whyHelp: 'Here is why this matters right now.\nTwo minutes here saves a rollback later.',
    // Per-level lists carry an EXTRA L1 option (adv-1-L1-b) that the flat `options`
    // view omits — exercises findOptionTitle's fall-through into `levels`.
    levels: { L1: [l1, l1b], L2: [l2], L3: [] },
    // Flat view = first-of-each-level (shipped-panel shape). Unchanged ids so the
    // existing event tests keep resolving through the flat path.
    options: [l1, l2],
    meta: { agent: 'replit', frequency: 'optimum' },
    ...overrides,
  };
}

function lastFooterIntent(): { intent?: string } | null {
  const call = footerIntentSpy.mock.calls.at(-1);
  return call ? (call[0] as CustomEvent).detail : null;
}
let footerIntentSpy: ReturnType<typeof vi.fn>;

function dispatchShowAdvisory(payload: AdvisoryPayload): void {
  window.dispatchEvent(new CustomEvent('nexpath:sw-message', {
    detail: { type: 'nexpath:show-advisory', payload },
  }));
}

function lastTerminalEvent(): { type: string; advisoryId?: string; selectedOptionId?: string } | null {
  const call = terminalSpy.mock.calls.at(-1);
  return call ? (call[0] as CustomEvent).detail : null;
}
let terminalSpy: ReturnType<typeof vi.fn>;

function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

describe('inject.ts (B5b — real panel integration)', () => {
  // Module attaches its 'nexpath:sw-message' listener once at import; import once.
  beforeAll(async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: clipboardWriteTextMock }, configurable: true,
    });
    await import('./inject.js');
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    showMock.mockClear(); setBusyMock.mockClear(); hideMock.mockClear(); destroyMock.mockClear();
    injectPromptTextMock.mockClear(); injectPromptTextBoltMock.mockClear();
    injectPromptTextLovableMock.mockClear(); clipboardFallbackMock.mockClear();
    clipboardWriteTextMock.mockClear();
    resolveAgentMock.mockReturnValue('replit');
    // Spy on the terminal round-trip (dispatched as 'nexpath:panel-event').
    terminalSpy = vi.fn();
    window.addEventListener('nexpath:panel-event', terminalSpy);
    // Spy on the footer-intent channel (dispatched as 'nexpath:footer-intent').
    footerIntentSpy = vi.fn();
    window.addEventListener('nexpath:footer-intent', footerIntentSpy);
  });

  afterEach(() => {
    window.removeEventListener('nexpath:panel-event', terminalSpy);
    window.removeEventListener('nexpath:footer-intent', footerIntentSpy);
  });

  it('ignores messages that are not ShowAdvisoryMsg', () => {
    window.dispatchEvent(new CustomEvent('nexpath:sw-message', { detail: { type: 'nope' } }));
    expect(showMock).not.toHaveBeenCalled();
  });

  it('mounts the panel ONCE and calls show(payload) for a valid advisory', () => {
    const before = mountNexpathPanelMock.mock.calls.length;
    dispatchShowAdvisory(makePayload());
    expect(showMock).toHaveBeenCalledTimes(1);
    // Mounted at most once total across the whole file (idempotent controller reuse).
    expect(mountNexpathPanelMock.mock.calls.length).toBeLessThanOrEqual(before + 1);
  });

  it('re-shows on a second advisory WITHOUT remounting (mount-once contract)', () => {
    const mounts = mountNexpathPanelMock.mock.calls.length;
    dispatchShowAdvisory(makePayload({ advisoryId: 'adv-2' }));
    dispatchShowAdvisory(makePayload({ advisoryId: 'adv-3' }));
    expect(mountNexpathPanelMock.mock.calls.length).toBe(mounts); // no new mount
    expect(showMock).toHaveBeenCalledTimes(2);
  });

  it('bails on schemaVersion mismatch — no show, warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    dispatchShowAdvisory(makePayload({ schemaVersion: 2 as 1 }));
    expect(showMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('schemaVersion mismatch'));
    warn.mockRestore();
  });

  it('mounts the panel into a CLOSED shadow root (CSS isolation)', () => {
    dispatchShowAdvisory(makePayload());
    const host = document.getElementById('nexpath-panel-host');
    expect(host).not.toBeNull();
    expect(host!.shadowRoot).toBeNull(); // closed → not exposed on the host
  });

  describe('panel events', () => {
    it("select: setBusy(true) → inject the option TITLE (CLI parity) → setBusy(false) → hide → terminal 'select'", async () => {
      dispatchShowAdvisory(makePayload());
      capturedOnEvent!({ type: 'select', optionId: 'adv-1-L1', body: 'the long body (must NOT be injected)' });

      // Terminal event reported immediately with the selected option id.
      expect(lastTerminalEvent()).toEqual({ type: 'select', advisoryId: 'adv-1', selectedOptionId: 'adv-1-L1' });
      expect(setBusyMock).toHaveBeenCalledWith(true);
      // CLI parity: inject the TITLE, not the body.
      expect(injectPromptTextMock).toHaveBeenCalledWith('Run the tests now');

      await flush();
      expect(setBusyMock).toHaveBeenCalledWith(false);
      expect(hideMock).toHaveBeenCalled();
    });

    it("skip: hide → terminal 'skip', no inject", () => {
      dispatchShowAdvisory(makePayload());
      capturedOnEvent!({ type: 'skip' });
      expect(hideMock).toHaveBeenCalled();
      expect(lastTerminalEvent()).toEqual({ type: 'skip', advisoryId: 'adv-1' });
      expect(injectPromptTextMock).not.toHaveBeenCalled();
    });

    it("dismiss: hide → terminal 'dismiss', no inject", () => {
      dispatchShowAdvisory(makePayload());
      capturedOnEvent!({ type: 'dismiss' });
      expect(hideMock).toHaveBeenCalled();
      expect(lastTerminalEvent()).toEqual({ type: 'dismiss', advisoryId: 'adv-1' });
    });

    it('copy: writes the option TITLE to clipboard, panel STAYS open (no hide, no terminal event)', () => {
      dispatchShowAdvisory(makePayload());
      terminalSpy.mockClear();
      capturedOnEvent!({ type: 'copy', optionId: 'adv-1-L2' });
      expect(clipboardWriteTextMock).toHaveBeenCalledWith('Quick check');
      expect(hideMock).not.toHaveBeenCalled();
      expect(terminalSpy).not.toHaveBeenCalled(); // non-terminal — must not resolve showAdvisory
    });

    it('show-simpler: no engine action, panel STAYS open (no hide, no terminal event)', () => {
      dispatchShowAdvisory(makePayload());
      terminalSpy.mockClear();
      capturedOnEvent!({ type: 'show-simpler' });
      expect(hideMock).not.toHaveBeenCalled();
      expect(terminalSpy).not.toHaveBeenCalled();
    });

    it('select resolves an id that exists ONLY in levels (CLI-parity per-level list), not the flat options view', () => {
      dispatchShowAdvisory(makePayload());
      // adv-1-L1-b is the extra L1 option — present in levels.L1, absent from options.
      capturedOnEvent!({ type: 'select', optionId: 'adv-1-L1-b', body: 'x' });
      expect(injectPromptTextMock).toHaveBeenCalledWith('Run a focused review');
    });

    it("disable-project: fires footer-intent 'disable-project', closes panel, terminal 'dismiss'", () => {
      dispatchShowAdvisory(makePayload());
      terminalSpy.mockClear();
      capturedOnEvent!({ type: 'disable-project' });
      expect(lastFooterIntent()).toEqual({ intent: 'disable-project' });
      expect(hideMock).toHaveBeenCalled();
      // Round-trip resolved as a plain dismiss (nothing recorded engine-side).
      expect(lastTerminalEvent()).toEqual({ type: 'dismiss', advisoryId: 'adv-1' });
    });

    it("open-settings: fires footer-intent 'open-settings', panel STAYS open (no hide, no terminal event)", () => {
      dispatchShowAdvisory(makePayload());
      terminalSpy.mockClear();
      capturedOnEvent!({ type: 'open-settings' });
      expect(lastFooterIntent()).toEqual({ intent: 'open-settings' });
      expect(hideMock).not.toHaveBeenCalled();
      expect(terminalSpy).not.toHaveBeenCalled();
    });
  });

  describe('per-agent inject dispatch on select', () => {
    it('routes to the bolt injector on bolt hosts', () => {
      resolveAgentMock.mockReturnValue('bolt');
      dispatchShowAdvisory(makePayload());
      capturedOnEvent!({ type: 'select', optionId: 'adv-1-L1', body: 'x' });
      expect(injectPromptTextBoltMock).toHaveBeenCalledWith('Run the tests now');
      expect(injectPromptTextMock).not.toHaveBeenCalledWith('Run the tests now');
    });

    it('routes to the lovable injector on lovable hosts', () => {
      resolveAgentMock.mockReturnValue('lovable');
      dispatchShowAdvisory(makePayload());
      capturedOnEvent!({ type: 'select', optionId: 'adv-1-L1', body: 'x' });
      expect(injectPromptTextLovableMock).toHaveBeenCalledWith('Run the tests now');
    });

    it('degrades to clipboard fallback on unknown hosts', () => {
      resolveAgentMock.mockReturnValue('unknown');
      dispatchShowAdvisory(makePayload());
      capturedOnEvent!({ type: 'select', optionId: 'adv-1-L1', body: 'x' });
      expect(clipboardFallbackMock).toHaveBeenCalledWith('Run the tests now');
    });
  });

  it('pagehide destroys the panel and clears the host', () => {
    dispatchShowAdvisory(makePayload());
    expect(document.getElementById('nexpath-panel-host')).not.toBeNull();
    window.dispatchEvent(new Event('pagehide'));
    expect(destroyMock).toHaveBeenCalled();
    expect(document.getElementById('nexpath-panel-host')).toBeNull();
  });
});
