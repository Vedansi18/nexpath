// @vitest-environment jsdom

import { describe, it, expect, vi, beforeAll } from 'vitest';

const { getURLMock, sendMessageMock, onMessageAddListenerMock } = vi.hoisted(() => ({
  getURLMock: vi.fn().mockReturnValue('chrome-extension://abc123/inject/main-world.js'),
  sendMessageMock: vi.fn().mockResolvedValue(undefined),
  onMessageAddListenerMock: vi.fn(),
}));

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: {
      getURL: getURLMock,
      sendMessage: sendMessageMock,
      onMessage: { addListener: onMessageAddListenerMock },
    },
  },
}));

let appendChildSpy: ReturnType<typeof vi.spyOn>;
let capturedScript: HTMLScriptElement | undefined;

function setLocation(origin: string, hostname: string): void {
  vi.stubGlobal('location', { origin, hostname });
}

function dispatchWindowMessage(data: unknown, source: unknown = window): void {
  window.dispatchEvent(new MessageEvent('message', { data, source: source as Window }));
}

describe('main-world-injector.ts', () => {
  // Module registers its 'message' listener and injects the script once, at import time —
  // must be imported exactly once for this file, not per-test.
  beforeAll(async () => {
    setLocation('https://replit.com', 'replit.com');

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

    it('forwards a PromptCapturedMsg as nexpath:prompt-submit with resolved projectRoot and given agent', () => {
      sendMessageMock.mockClear();
      setLocation('https://replit.com', 'replit.com');
      dispatchWindowMessage({ type: 'nexpath:prompt-captured', promptText: 'write code', agent: 'replit' });

      expect(sendMessageMock).toHaveBeenCalledWith({
        type: 'nexpath:prompt-submit',
        promptText: 'write code',
        projectRoot: 'https://replit.com',
        agent: 'replit',
        tabId: 0,
      });
    });

    it('falls back to hostname-based agent resolution when agent is empty — bolt.new', () => {
      sendMessageMock.mockClear();
      setLocation('https://bolt.new', 'bolt.new');
      dispatchWindowMessage({ type: 'nexpath:prompt-captured', promptText: 'hi', agent: '' });

      expect(sendMessageMock).toHaveBeenCalledWith(expect.objectContaining({ agent: 'bolt' }));
    });

    it('falls back to hostname-based agent resolution — stackblitz.com subdomain', () => {
      sendMessageMock.mockClear();
      setLocation('https://abc.stackblitz.com', 'abc.stackblitz.com');
      dispatchWindowMessage({ type: 'nexpath:prompt-captured', promptText: 'hi', agent: '' });

      expect(sendMessageMock).toHaveBeenCalledWith(expect.objectContaining({ agent: 'bolt' }));
    });

    it('falls back to hostname-based agent resolution — lovable.dev', () => {
      sendMessageMock.mockClear();
      setLocation('https://lovable.dev', 'lovable.dev');
      dispatchWindowMessage({ type: 'nexpath:prompt-captured', promptText: 'hi', agent: '' });

      expect(sendMessageMock).toHaveBeenCalledWith(expect.objectContaining({ agent: 'lovable' }));
    });

    it('resolves to "unknown" for an unrecognized host', () => {
      sendMessageMock.mockClear();
      setLocation('https://example.com', 'example.com');
      dispatchWindowMessage({ type: 'nexpath:prompt-captured', promptText: 'hi', agent: '' });

      expect(sendMessageMock).toHaveBeenCalledWith(expect.objectContaining({ agent: 'unknown' }));
    });

    it('forwards a ResponseStoppedMsg as nexpath:response-stop', () => {
      sendMessageMock.mockClear();
      setLocation('https://replit.com', 'replit.com');
      dispatchWindowMessage({ type: 'nexpath:response-stopped', agent: 'replit' });

      expect(sendMessageMock).toHaveBeenCalledWith({
        type: 'nexpath:response-stop',
        projectRoot: 'https://replit.com',
        agent: 'replit',
        tabId: 0,
      });
    });
  });

  describe('chrome.runtime.onMessage → nexpath:sw-message re-dispatch', () => {
    it('registers exactly one onMessage listener', () => {
      expect(onMessageAddListenerMock).toHaveBeenCalledOnce();
    });

    it('re-dispatches an incoming SW message as a nexpath:sw-message CustomEvent', () => {
      const listener = onMessageAddListenerMock.mock.calls[0]![0] as (msg: unknown) => void;
      const received = vi.fn();
      window.addEventListener('nexpath:sw-message', (ev) => received((ev as CustomEvent).detail));

      const swMsg = { type: 'nexpath:show-advisory', payload: { advisoryId: 'adv-1' } };
      listener(swMsg);

      expect(received).toHaveBeenCalledWith(swMsg);
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
