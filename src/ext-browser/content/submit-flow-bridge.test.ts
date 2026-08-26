import { describe, it, expect, vi } from 'vitest';

const { mockGet, mockAddListener, mockSendMessage } = vi.hoisted(() => ({
  mockGet: vi.fn(), mockAddListener: vi.fn(), mockSendMessage: vi.fn(),
}));
vi.mock('webextension-polyfill', () => ({
  default: {
    storage: { local: { get: mockGet }, onChanged: { addListener: mockAddListener } },
    runtime: { sendMessage: mockSendMessage },
  },
}));

import { setupSubmitFlowBridge } from './submit-flow-bridge.js';
import {
  SUBMIT_FLOW_PUSH_TYPE,
  SUBMIT_FLOW_REQUEST_TYPE,
  SUBMIT_FLOW_STATE_TYPE,
} from '../inject/submit-flow-page.js';
import { SUBMIT_FLOW_SITE_KEYS, SUBMIT_FLOW_OVERRIDE_KEY } from '../adapters/submit-flow-config.js';

/** Same isolated fake-window approach as the page-world test — see its comment. */
function makeWin(hostname = 'bolt.new') {
  const listeners: Array<(ev: MessageEvent) => void> = [];
  const posts: Array<Record<string, unknown>> = [];
  const win = {
    location: { origin: `https://${hostname}`, hostname },
    addEventListener(type: string, cb: (ev: MessageEvent) => void): void {
      if (type === 'message') listeners.push(cb);
    },
    postMessage(msg: unknown): void { posts.push(msg as Record<string, unknown>); },
  } as unknown as Window;
  const deliver = (data: unknown, source: unknown = win): void => {
    for (const cb of [...listeners]) cb({ data, source } as MessageEvent);
  };
  const pushes = (): Array<Record<string, unknown>> =>
    posts.filter((m) => m['type'] === SUBMIT_FLOW_PUSH_TYPE);
  return { win, posts, deliver, pushes };
}

const ON = { enabled: true, source: 'default_on' } as const;

describe('setupSubmitFlowBridge — the content-script side', () => {
  it('resolves at load and pushes the answer into the page', async () => {
    const { win, pushes } = makeWin();
    const resolve = vi.fn().mockResolvedValue(ON);
    const bridge = setupSubmitFlowBridge({ win, site: 'bolt', resolve, onStorageChanged: () => {} });
    await bridge.refresh();

    expect(resolve).toHaveBeenCalledWith('bolt');
    expect(pushes().length).toBeGreaterThanOrEqual(1);
    expect(pushes()[0]).toMatchObject({ type: SUBMIT_FLOW_PUSH_TYPE, enabled: true, source: 'default_on' });
  });

  it('stamps a monotonically increasing seq so the page can drop stale pushes', async () => {
    const { win, pushes } = makeWin();
    const resolve = vi.fn().mockResolvedValue(ON);
    const bridge = setupSubmitFlowBridge({ win, site: 'bolt', resolve, onStorageChanged: () => {} });
    await bridge.refresh();
    await bridge.refresh();
    const seqs = pushes().map((p) => p['seq'] as number);
    expect(seqs.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]!).toBeGreaterThan(seqs[i - 1]!);
  });

  describe('the load-order race (either side may win)', () => {
    it('answers the page\'s on-load request with the value already resolved', async () => {
      const { win, deliver, pushes } = makeWin();
      const resolve = vi.fn().mockResolvedValue(ON);
      const bridge = setupSubmitFlowBridge({ win, site: 'bolt', resolve, onStorageChanged: () => {} });
      await bridge.refresh();
      const before = pushes().length;

      deliver({ type: SUBMIT_FLOW_REQUEST_TYPE });

      expect(pushes().length).toBe(before + 1);
      // Answered from the cached resolution — no extra storage round-trip.
      expect(resolve).toHaveBeenCalledTimes(2); // setup's own refresh + the explicit one
    });

    it('resolves on demand when the page asks before the first resolution finished', async () => {
      const { win, deliver } = makeWin();
      let release: (v: unknown) => void = () => {};
      const gate = new Promise((r) => { release = r; });
      const resolve = vi.fn().mockReturnValue(gate.then(() => ON));
      setupSubmitFlowBridge({ win, site: 'bolt', resolve, onStorageChanged: () => {} });

      deliver({ type: SUBMIT_FLOW_REQUEST_TYPE }); // page loaded first — nothing cached yet
      release(null);
      await Promise.resolve(); await Promise.resolve();

      expect(resolve.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('RC15 — the value tracks storage, it is not a boot snapshot', () => {
    it('re-resolves and re-pushes when a watched key changes', async () => {
      const { win, pushes } = makeWin();
      let onChange: ((c: Record<string, unknown>, a: string) => void) | null = null;
      const resolve = vi.fn().mockResolvedValue(ON);
      const bridge = setupSubmitFlowBridge({
        win, site: 'bolt', resolve,
        onStorageChanged: (cb) => { onChange = cb; },
      });
      await bridge.refresh();
      const before = pushes().length;

      resolve.mockResolvedValue({ enabled: false, source: 'site_off' });
      onChange!({ [SUBMIT_FLOW_SITE_KEYS.bolt]: { newValue: 'false' } }, 'local');
      await Promise.resolve(); await Promise.resolve();

      expect(pushes().length).toBe(before + 1);
      expect(pushes().at(-1)).toMatchObject({ enabled: false, source: 'site_off' });
    });

    it('reacts to the hidden override key too', async () => {
      const { win, pushes } = makeWin();
      let onChange: ((c: Record<string, unknown>, a: string) => void) | null = null;
      const resolve = vi.fn().mockResolvedValue(ON);
      setupSubmitFlowBridge({ win, site: 'bolt', resolve, onStorageChanged: (cb) => { onChange = cb; } });
      await Promise.resolve(); await Promise.resolve();
      const before = pushes().length;

      onChange!({ [SUBMIT_FLOW_OVERRIDE_KEY]: { newValue: '0' } }, 'local');
      await Promise.resolve(); await Promise.resolve();
      expect(pushes().length).toBe(before + 1);
    });

    it('ignores unrelated keys and non-local areas', async () => {
      const { win, pushes } = makeWin();
      let onChange: ((c: Record<string, unknown>, a: string) => void) | null = null;
      const resolve = vi.fn().mockResolvedValue(ON);
      const bridge = setupSubmitFlowBridge({ win, site: 'bolt', resolve, onStorageChanged: (cb) => { onChange = cb; } });
      await bridge.refresh();
      const before = pushes().length;

      onChange!({ openai_api_key: { newValue: 'sk-x' } }, 'local');
      onChange!({ [SUBMIT_FLOW_SITE_KEYS.bolt]: { newValue: 'false' } }, 'sync');
      await Promise.resolve(); await Promise.resolve();

      expect(pushes().length).toBe(before);
    });
  });

  describe('the A9 read-back', () => {
    it('forwards the page\'s own belief to the service worker', async () => {
      const { win, deliver } = makeWin();
      const sendToSw = vi.fn();
      const bridge = setupSubmitFlowBridge({
        win, site: 'bolt', resolve: vi.fn().mockResolvedValue(ON),
        onStorageChanged: () => {}, sendToSw,
      });
      await bridge.refresh();

      deliver({ type: SUBMIT_FLOW_STATE_TYPE, armed: true, source: 'default_on', seq: 3 });

      expect(sendToSw).toHaveBeenCalledWith({
        type: SUBMIT_FLOW_STATE_TYPE, site: 'bolt', armed: true, source: 'default_on', seq: 3,
      });
    });

    it('forwards a DISARMED read-back too — the case worth seeing in the ring', async () => {
      const { win, deliver } = makeWin();
      const sendToSw = vi.fn();
      setupSubmitFlowBridge({
        win, site: 'replit', resolve: vi.fn().mockResolvedValue(ON),
        onStorageChanged: () => {}, sendToSw,
      });
      deliver({ type: SUBMIT_FLOW_STATE_TYPE, armed: false, source: 'site_off', seq: 1 });
      expect(sendToSw).toHaveBeenCalledWith(expect.objectContaining({ armed: false, site: 'replit' }));
    });

    it('ignores a read-back from another window', async () => {
      const { win, deliver } = makeWin();
      const sendToSw = vi.fn();
      setupSubmitFlowBridge({
        win, site: 'bolt', resolve: vi.fn().mockResolvedValue(ON),
        onStorageChanged: () => {}, sendToSw,
      });
      deliver({ type: SUBMIT_FLOW_STATE_TYPE, armed: true, source: 'x', seq: 1 }, { other: 'win' });
      expect(sendToSw).not.toHaveBeenCalled();
    });
  });

  it('uses the page hostname when no site is injected', async () => {
    const { win } = makeWin('lovable.dev');
    const resolve = vi.fn().mockResolvedValue(ON);
    const bridge = setupSubmitFlowBridge({ win, resolve, onStorageChanged: () => {} });
    await bridge.refresh();
    expect(resolve).toHaveBeenCalledWith('lovable');
  });

  it('a rejected resolution never throws out of setup (fail-open)', async () => {
    const { win, pushes } = makeWin();
    const resolve = vi.fn().mockRejectedValue(new Error('boom'));
    expect(() => setupSubmitFlowBridge({ win, site: 'bolt', resolve, onStorageChanged: () => {} })).not.toThrow();
    await Promise.resolve(); await Promise.resolve();
    // Nothing pushed ⇒ the page stays DISARMED, which is the safe state.
    expect(pushes()).toHaveLength(0);
  });
});
