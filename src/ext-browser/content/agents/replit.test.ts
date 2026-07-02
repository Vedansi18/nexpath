// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { observeUserMessages, observeSubmitButton, bootstrap } from './replit.js';

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeUserMessage(text: string): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-cy', 'user-message');
  const rendered = document.createElement('div');
  rendered.className = 'rendered-markdown';
  rendered.innerHTML = `<p>${text}</p>`;
  el.appendChild(rendered);
  return el;
}

function makeSubmitButton(disabled: boolean): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.setAttribute('data-cy', 'ai-prompt-submit');
  if (disabled) btn.setAttribute('disabled', '');
  return btn;
}

describe('content/agents/replit.ts', () => {
  let postMessageSpy: ReturnType<typeof vi.spyOn>;
  let observers: MutationObserver[];

  beforeEach(() => {
    document.body.innerHTML = '';
    postMessageSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    observers = [];
  });

  afterEach(() => {
    observers.forEach((o) => o.disconnect());
    postMessageSpy.mockRestore();
  });

  describe('observeUserMessages', () => {
    it('emits nexpath:prompt-captured with the rendered-markdown text when a user-message node is added', async () => {
      observers.push(observeUserMessages(document.body));
      document.body.appendChild(makeUserMessage('build a to do list app'));
      await flush();

      expect(postMessageSpy).toHaveBeenCalledWith(
        { type: 'nexpath:prompt-captured', promptText: 'build a to do list app', agent: 'replit' },
        window.location.origin,
      );
    });

    it('detects a user-message node nested inside a larger inserted subtree', async () => {
      observers.push(observeUserMessages(document.body));
      const wrapper = document.createElement('div');
      wrapper.appendChild(makeUserMessage('nested message'));
      document.body.appendChild(wrapper);
      await flush();

      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({ promptText: 'nested message' }),
        window.location.origin,
      );
    });

    it('does not emit for messages already present before the observer starts (prevents page-load/history replay)', async () => {
      // Simulates Replit's chat history already rendered in the DOM before the content
      // script attaches — this must never be replayed through the pipeline, matching
      // the src/ext-vscode chat-history-watcher.ts "primedTargets" guarantee.
      document.body.appendChild(makeUserMessage('old message from history'));
      observers.push(observeUserMessages(document.body));
      await flush();

      expect(postMessageSpy).not.toHaveBeenCalled();
    });

    it('still emits for genuinely new messages added after priming pre-existing history', async () => {
      document.body.appendChild(makeUserMessage('old message from history'));
      observers.push(observeUserMessages(document.body));
      await flush();
      postMessageSpy.mockClear();

      document.body.appendChild(makeUserMessage('brand new message'));
      await flush();

      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({ promptText: 'brand new message' }),
        window.location.origin,
      );
    });

    it('does not emit twice for the same node (dedup via WeakSet)', async () => {
      observers.push(observeUserMessages(document.body));
      const el = makeUserMessage('once only');
      document.body.appendChild(el);
      await flush();
      postMessageSpy.mockClear();

      // Re-triggering a mutation elsewhere must not re-emit for the already-seen node.
      document.body.appendChild(document.createElement('div'));
      await flush();

      expect(postMessageSpy).not.toHaveBeenCalled();
    });

    it('ignores an inserted node with no .rendered-markdown text', async () => {
      observers.push(observeUserMessages(document.body));
      const el = document.createElement('div');
      el.setAttribute('data-cy', 'user-message');
      document.body.appendChild(el);
      await flush();

      expect(postMessageSpy).not.toHaveBeenCalled();
    });

    it('ignores nodes unrelated to user-message', async () => {
      observers.push(observeUserMessages(document.body));
      document.body.appendChild(document.createElement('span'));
      await flush();

      expect(postMessageSpy).not.toHaveBeenCalled();
    });

    it('collapses a duplicate capture when the same text arrives via a brand-new DOM node shortly after (Replit loading-shell → hydrated-list swap)', async () => {
      // Confirmed live 2026-07-02: Replit re-creates the message element (new node
      // identity, same text) when its own page finishes loading, right after the
      // original was already captured — the WeakSet above can't catch this since
      // it's genuinely a different element. Simulate that: two separate elements,
      // identical text, inserted moments apart.
      observers.push(observeUserMessages(document.body));
      document.body.appendChild(makeUserMessage('how add a comment to this function'));
      await flush();
      expect(postMessageSpy).toHaveBeenCalledTimes(1);

      document.body.appendChild(makeUserMessage('how add a comment to this function'));
      await flush();

      expect(postMessageSpy).toHaveBeenCalledTimes(1);
    });

    it('still emits for the same text again once the dedup window has passed (not suppressed forever)', async () => {
      vi.useFakeTimers();
      try {
        observers.push(observeUserMessages(document.body));
        document.body.appendChild(makeUserMessage('run the tests'));
        await vi.advanceTimersByTimeAsync(0);
        expect(postMessageSpy).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(5000);

        document.body.appendChild(makeUserMessage('run the tests'));
        await vi.advanceTimersByTimeAsync(0);

        expect(postMessageSpy).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('observeSubmitButton', () => {
    it('emits nexpath:response-stopped when the button transitions disabled -> enabled', async () => {
      const btn = makeSubmitButton(true);
      document.body.appendChild(btn);
      observers.push(observeSubmitButton(document.body));

      btn.removeAttribute('disabled');
      await flush();

      expect(postMessageSpy).toHaveBeenCalledWith(
        { type: 'nexpath:response-stopped', agent: 'replit' },
        window.location.origin,
      );
    });

    it('does not emit when the button transitions enabled -> disabled', async () => {
      const btn = makeSubmitButton(false);
      document.body.appendChild(btn);
      observers.push(observeSubmitButton(document.body));

      btn.setAttribute('disabled', '');
      await flush();

      expect(postMessageSpy).not.toHaveBeenCalled();
    });

    it('does not emit on the first disabled -> enabled-looking state without a prior disabled observation', async () => {
      const btn = makeSubmitButton(false);
      document.body.appendChild(btn);
      observers.push(observeSubmitButton(document.body));

      // Attribute mutation on something unrelated must not spuriously fire.
      btn.setAttribute('data-x', '1');
      await flush();

      expect(postMessageSpy).not.toHaveBeenCalled();
    });
  });

  describe('bootstrap', () => {
    beforeEach(() => {
      // The module auto-runs bootstrap() once at import time (top-level side effect),
      // which sets this flag — reset it so each test starts as if freshly injected.
      window.__nexpathReplitBootstrapped = undefined;
    });

    it('logs the capture tier (console.log, not .debug — Verbose is hidden by default in DevTools) and wires up both observers', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      bootstrap();

      expect(logSpy).toHaveBeenCalledWith('[nexpath] capture: mutation-observer');

      document.body.appendChild(makeUserMessage('post-bootstrap message'));
      await flush();
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({ promptText: 'post-bootstrap message' }),
        window.location.origin,
      );

      logSpy.mockRestore();
    });

    it('is idempotent — a second bootstrap() call in the same page does not re-register observers (stale re-injection guard)', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      bootstrap(); // first call — real setup
      bootstrap(); // simulates a stale duplicate content-script re-injection

      expect(logSpy).toHaveBeenCalledWith('[nexpath] capture: mutation-observer');
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('skipped, already bootstrapped'),
      );

      postMessageSpy.mockClear();
      document.body.appendChild(makeUserMessage('should only be captured once'));
      await flush();

      // If the second bootstrap() had wired up a duplicate observer, this message would
      // have been posted twice (once per observer instance).
      const matchingCalls = postMessageSpy.mock.calls.filter(
        (call) => (call[0] as { promptText?: string }).promptText === 'should only be captured once',
      );
      expect(matchingCalls).toHaveLength(1);

      logSpy.mockRestore();
    });
  });
});
