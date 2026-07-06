// @vitest-environment jsdom

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

const { getURLMock, sendMessageMock, onMessageAddListenerMock, storageGetMock } = vi.hoisted(() => ({
  getURLMock: vi.fn().mockReturnValue('chrome-extension://abc123/inject/main-world.js'),
  sendMessageMock: vi.fn().mockResolvedValue(undefined),
  onMessageAddListenerMock: vi.fn(),
  storageGetMock: vi.fn().mockResolvedValue({}),
}));

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: {
      getURL: getURLMock,
      sendMessage: sendMessageMock,
      onMessage: { addListener: onMessageAddListenerMock },
    },
    storage: { local: { get: storageGetMock } },
  },
}));

let appendChildSpy: ReturnType<typeof vi.spyOn>;
let capturedScript: HTMLScriptElement | undefined;

function setLocation(origin: string, hostname: string, pathname = '/'): void {
  vi.stubGlobal('location', { origin, hostname, pathname });
}

function dispatchWindowMessage(data: unknown, source: unknown = window): void {
  window.dispatchEvent(new MessageEvent('message', { data, source: source as Window }));
}

describe('main-world-injector.ts', () => {
  // Module registers its 'message' listener and injects the script once, at import time —
  // must be imported exactly once for this file, not per-test.
  beforeAll(async () => {
    setLocation('https://replit.com', 'replit.com', '/@vedansi18/Hello-World');

    appendChildSpy = vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      capturedScript = node as HTMLScriptElement;
      return node;
    });

    await import('./main-world-injector.js');
  });

  describe('MAIN-world script injection', () => {
    it('creates a <script type="module"> pointing at the extension-resolved main-world.js URL', () => {
      expect(getURLMock).toHaveBeenCalledWith('inject/main-world.js');
      expect(appendChildSpy).toHaveBeenCalledOnce();
      expect(capturedScript?.tagName).toBe('SCRIPT');
      expect(capturedScript?.type).toBe('module');
      expect(capturedScript?.src).toBe('chrome-extension://abc123/inject/main-world.js');
    });

    it('removes the script element from the DOM after appending (fetch already triggered)', () => {
      expect(capturedScript?.isConnected).toBe(false);
    });
  });

  describe('window.postMessage → chrome.runtime.sendMessage forwarding', () => {
    beforeAll(() => {
      // Give each test in this block a clean slate for the shared mocks.
    });

    it('ignores messages whose source is not window (e.g. an iframe)', () => {
      sendMessageMock.mockClear();
      dispatchWindowMessage({ type: 'nexpath:prompt-captured', promptText: 'hi', agent: 'replit' }, {});
      expect(sendMessageMock).not.toHaveBeenCalled();
    });

    it('ignores messages that are not recognized IPC shapes', () => {
      sendMessageMock.mockClear();
      dispatchWindowMessage({ type: 'not-a-real-message' });
      expect(sendMessageMock).not.toHaveBeenCalled();
    });

    it('forwards a PromptCapturedMsg as nexpath:prompt-submit with the per-PROJECT root (CLI parity)', () => {
      sendMessageMock.mockClear();
      setLocation('https://replit.com', 'replit.com', '/@vedansi18/Hello-World');
      dispatchWindowMessage({ type: 'nexpath:prompt-captured', promptText: 'write code', agent: 'replit' });

      expect(sendMessageMock).toHaveBeenCalledWith({
        type: 'nexpath:prompt-submit',
        promptText: 'write code',
        projectRoot: 'https://replit.com/@vedansi18/Hello-World',
        agent: 'replit',
        tabId: 0,
      });
    });

    it('falls back to hostname-based agent resolution when agent is empty — bolt.new project page', () => {
      sendMessageMock.mockClear();
      setLocation('https://bolt.new', 'bolt.new', '/~/sb1-abc123');
      dispatchWindowMessage({ type: 'nexpath:prompt-captured', promptText: 'hi', agent: '' });

      expect(sendMessageMock).toHaveBeenCalledWith(expect.objectContaining({
        agent: 'bolt',
        projectRoot: 'https://bolt.new/~/sb1-abc123',
      }));
    });

    it('SKIPS capture on the bolt.new landing page AND posts capture-rejected so the kit funnel clears the text', () => {
      // Fake timers: the skip also arms the rejected-capture stash poll — keep its
      // interval on a fake clock so it can never fire mid-file on the real one.
      vi.useFakeTimers();
      sendMessageMock.mockClear();
      const postSpy = vi.spyOn(window, 'postMessage');
      setLocation('https://bolt.new', 'bolt.new', '/');
      dispatchWindowMessage({ type: 'nexpath:prompt-captured', promptText: 'make me an invoice site', agent: 'bolt' });

      expect(sendMessageMock).not.toHaveBeenCalled();
      // Without this feedback the kit's dedup funnel keeps the text recorded and
      // collapses the project page's re-send — the prompt is lost (live 2026-07-06).
      expect(postSpy).toHaveBeenCalledWith(
        { type: 'nexpath:capture-rejected', promptText: 'make me an invoice site' },
        'https://bolt.new',
      );
      postSpy.mockRestore();
      vi.useRealTimers();
    });

    it('falls back to hostname-based agent resolution — stackblitz.com subdomain project page', () => {
      sendMessageMock.mockClear();
      setLocation('https://abc.stackblitz.com', 'abc.stackblitz.com', '/~/xyz');
      dispatchWindowMessage({ type: 'nexpath:prompt-captured', promptText: 'hi', agent: '' });

      expect(sendMessageMock).toHaveBeenCalledWith(expect.objectContaining({ agent: 'bolt' }));
    });

    it('SKIPS capture on lovable.dev — project URL shape unknown until the B5 recon', () => {
      sendMessageMock.mockClear();
      setLocation('https://lovable.dev', 'lovable.dev', '/projects/some-app');
      dispatchWindowMessage({ type: 'nexpath:prompt-captured', promptText: 'hi', agent: '' });

      expect(sendMessageMock).not.toHaveBeenCalled();
    });

    it('SKIPS capture on an unrecognized host — no project-root rule exists for it', () => {
      sendMessageMock.mockClear();
      setLocation('https://example.com', 'example.com', '/whatever');
      dispatchWindowMessage({ type: 'nexpath:prompt-captured', promptText: 'hi', agent: '' });

      expect(sendMessageMock).not.toHaveBeenCalled();
    });

    it('forwards a ResponseStoppedMsg as nexpath:response-stop with the per-PROJECT root', () => {
      sendMessageMock.mockClear();
      setLocation('https://replit.com', 'replit.com', '/@vedansi18/Hello-World');
      dispatchWindowMessage({ type: 'nexpath:response-stopped', agent: 'replit' });

      expect(sendMessageMock).toHaveBeenCalledWith({
        type: 'nexpath:response-stop',
        projectRoot: 'https://replit.com/@vedansi18/Hello-World',
        agent: 'replit',
        tabId: 0,
      });
    });
  });

  describe('rejected-capture stash — delivery after navigating into a project (DOM/transport-independent)', () => {
    // Replit's newer workspace has no data-cy user-message and a binary-WS chat
    // transport, so nothing re-captures a home-typed prompt (confirmed live
    // 2026-07-06 twice) — the injector itself must carry the text across the
    // navigation.
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
      // Restore the file-default location — later describes depend on it.
      setLocation('https://replit.com', 'replit.com', '/@vedansi18/Hello-World');
    });

    it('delivers the stashed prompt with the NEW project root once the URL resolves', () => {
      sendMessageMock.mockClear();
      setLocation('https://replit.com', 'replit.com', '/~'); // home — rejection + stash
      dispatchWindowMessage({ type: 'nexpath:prompt-captured', promptText: 'make a tip calculator', agent: 'replit' });
      expect(sendMessageMock).not.toHaveBeenCalled();

      // Replit soft-navigates into the auto-created repl.
      setLocation('https://replit.com', 'replit.com', '/@bhavnesh1/Tip-Calculator');
      vi.advanceTimersByTime(1_100);

      expect(sendMessageMock).toHaveBeenCalledWith({
        type: 'nexpath:prompt-submit',
        promptText: 'make a tip calculator',
        projectRoot: 'https://replit.com/@bhavnesh1/Tip-Calculator',
        agent: 'replit',
        tabId: 0,
      });
    });

    it('delivers exactly once — the poll stops after flushing', () => {
      sendMessageMock.mockClear();
      setLocation('https://bolt.new', 'bolt.new', '/');
      dispatchWindowMessage({ type: 'nexpath:prompt-captured', promptText: 'weather page', agent: 'bolt' });

      setLocation('https://bolt.new', 'bolt.new', '/~/sb1-abc');
      vi.advanceTimersByTime(1_100);
      expect(sendMessageMock).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(5_000);
      expect(sendMessageMock).toHaveBeenCalledTimes(1);
    });

    it('drops the stash after the TTL if no project is ever entered', () => {
      sendMessageMock.mockClear();
      setLocation('https://bolt.new', 'bolt.new', '/');
      dispatchWindowMessage({ type: 'nexpath:prompt-captured', promptText: 'abandoned prompt', agent: 'bolt' });

      vi.advanceTimersByTime(125_000); // stays on the landing page past the TTL
      setLocation('https://bolt.new', 'bolt.new', '/~/sb1-late');
      vi.advanceTimersByTime(5_000);

      expect(sendMessageMock).not.toHaveBeenCalled();
    });

    it('a newer rejected prompt replaces the stash (latest wins)', () => {
      sendMessageMock.mockClear();
      setLocation('https://bolt.new', 'bolt.new', '/');
      dispatchWindowMessage({ type: 'nexpath:prompt-captured', promptText: 'first idea', agent: 'bolt' });
      dispatchWindowMessage({ type: 'nexpath:prompt-captured', promptText: 'second idea', agent: 'bolt' });

      setLocation('https://bolt.new', 'bolt.new', '/~/sb1-xyz');
      vi.advanceTimersByTime(1_100);

      expect(sendMessageMock).toHaveBeenCalledTimes(1);
      expect(sendMessageMock).toHaveBeenCalledWith(expect.objectContaining({ promptText: 'second idea' }));
    });
  });

  describe('nexpath:debug-request → whitelisted debug-state reply', () => {
    it('answers a debug-request with the persisted last Stage-2 verdict via postMessage', async () => {
      sendMessageMock.mockClear();
      storageGetMock.mockResolvedValueOnce({
        nexpath_last_stage2_result: '{"fire":false,"reason":"testing already demonstrated"}',
      });
      const postSpy = vi.spyOn(window, 'postMessage');

      dispatchWindowMessage({ type: 'nexpath:debug-request' });
      await new Promise((r) => setTimeout(r, 0));

      expect(storageGetMock).toHaveBeenCalledWith(['nexpath_last_stage2_result', 'nexpath_recent_events']);
      expect(postSpy).toHaveBeenCalledWith(
        {
          type: 'nexpath:debug-state',
          lastStage2Result: '{"fire":false,"reason":"testing already demonstrated"}',
          recentEvents: null,
        },
        'https://replit.com',
      );
      expect(sendMessageMock).not.toHaveBeenCalled(); // debug traffic never reaches the SW
      postSpy.mockRestore();
    });

    it('answers with null when no verdict has been persisted yet', async () => {
      storageGetMock.mockResolvedValueOnce({});
      const postSpy = vi.spyOn(window, 'postMessage');

      dispatchWindowMessage({ type: 'nexpath:debug-request' });
      await new Promise((r) => setTimeout(r, 0));

      expect(postSpy).toHaveBeenCalledWith(
        { type: 'nexpath:debug-state', lastStage2Result: null, recentEvents: null },
        'https://replit.com',
      );
      postSpy.mockRestore();
    });
  });

  describe('sendToServiceWorker retry on failure (confirmed real bug 2026-07-03)', () => {
    // Previously any sendMessage failure (e.g. the SW asleep/mid-restart) was swallowed
    // by an empty catch — completely silent, no log, no retry. Confirmed live: prompt
    // capture vanished with zero trace during a long-running page flow. Now retries once
    // after a short delay and always logs on final failure.
    it('retries once after the SW rejects the first send, and succeeds silently if the retry works', async () => {
      vi.useFakeTimers();
      try {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        sendMessageMock.mockClear();
        sendMessageMock.mockRejectedValueOnce(new Error('SW not up yet')).mockResolvedValueOnce(undefined);

        setLocation('https://replit.com', 'replit.com', '/@vedansi18/Hello-World');
        dispatchWindowMessage({ type: 'nexpath:prompt-captured', promptText: 'hi', agent: 'replit' });
        await vi.advanceTimersByTimeAsync(0); // let the first rejection's .catch() run

        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('retrying once'),
          'nexpath:prompt-submit',
          expect.any(String),
        );

        await vi.advanceTimersByTimeAsync(400); // fire the retry's setTimeout
        expect(sendMessageMock).toHaveBeenCalledTimes(2);
        expect(errorSpy).not.toHaveBeenCalled();

        warnSpy.mockRestore();
        errorSpy.mockRestore();
      } finally {
        vi.useRealTimers();
      }
    });

    it('logs the message as DROPPED if the retry also fails', async () => {
      vi.useFakeTimers();
      try {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        sendMessageMock.mockClear();
        sendMessageMock.mockRejectedValue(new Error('still not up'));

        setLocation('https://replit.com', 'replit.com', '/@vedansi18/Hello-World');
        dispatchWindowMessage({ type: 'nexpath:response-stopped', agent: 'replit' });
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(400);
        await vi.advanceTimersByTimeAsync(0); // let the retry's own rejection settle

        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringContaining('DROPPED'),
          'nexpath:response-stop',
          expect.any(String),
        );

        warnSpy.mockRestore();
        errorSpy.mockRestore();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('chrome.runtime.onMessage → nexpath:sw-message re-dispatch', () => {
    it('registers exactly one onMessage listener', () => {
      expect(onMessageAddListenerMock).toHaveBeenCalledOnce();
    });

    it('re-dispatches an incoming SW message as a nexpath:sw-message CustomEvent', () => {
      const listener = onMessageAddListenerMock.mock.calls[0]![0] as (msg: unknown) => unknown;
      const received = vi.fn();
      window.addEventListener('nexpath:sw-message', (ev) => received((ev as CustomEvent).detail));

      const swMsg = { type: 'nexpath:show-advisory', payload: { advisoryId: 'adv-1' } };
      listener(swMsg);

      expect(received).toHaveBeenCalledWith(swMsg);
    });

    it('returns a Promise resolving to undefined (no async reply expected) for non-show-advisory messages', async () => {
      // Always a Promise, never a bare value — a mixed Promise|undefined return doesn't
      // structurally match webextension-polyfill's OnMessageListenerAsync type; see the
      // source's header comment for the full explanation.
      const listener = onMessageAddListenerMock.mock.calls[0]![0] as (msg: unknown) => unknown;
      const result = listener({ type: 'something-else' });
      expect(result).toBeInstanceOf(Promise);
      await expect(result).resolves.toBeUndefined();
    });

    it('returns a Promise for a show-advisory message that resolves with the PanelEvent inject.ts reports back', async () => {
      // Confirmed real bug 2026-07-02: ContentScriptUIAdapter.showAdvisory() (SW side)
      // awaits this listener's return value directly via browser.tabs.sendMessage — with
      // no Promise returned here, it resolved as undefined almost instantly and every
      // advisory was treated as a synthetic dismiss regardless of what the user clicked.
      const listener = onMessageAddListenerMock.mock.calls[0]![0] as (msg: unknown) => unknown;
      const swMsg = { type: 'nexpath:show-advisory', payload: { advisoryId: 'adv-1' } };

      const result = listener(swMsg);
      expect(result).toBeInstanceOf(Promise);

      const panelEvent = { type: 'select', advisoryId: 'adv-1', selectedOptionId: 'adv-1-L1' };
      window.dispatchEvent(new CustomEvent('nexpath:panel-event', { detail: panelEvent }));

      await expect(result).resolves.toEqual(panelEvent);
    });
  });

  describe('idempotent-injection guard', () => {
    it('does not re-inject the script or re-register listeners on a second import into the same page', async () => {
      // Simulates a stale content-script re-injection: the window flag from the earlier
      // beforeAll import is still set (persists on the real jsdom window), so re-importing
      // the module (as if the extension re-injected it into an already-open tab) must be
      // a no-op this time.
      expect(window.__nexpathMainWorldInjectorBootstrapped).toBe(true);

      appendChildSpy.mockClear();
      onMessageAddListenerMock.mockClear();
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      vi.resetModules();
      await import('./main-world-injector.js');

      expect(appendChildSpy).not.toHaveBeenCalled();
      expect(onMessageAddListenerMock).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('skipped, already bootstrapped'));

      logSpy.mockRestore();
    });
  });
});
