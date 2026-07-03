// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { observeUserMessages, observeSubmitButton, observeWorkedForLabel, bootstrap, __resetResponseStopDedupForTests } from './replit.js';

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

function makeStopButton(): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.setAttribute('data-cy', 'ai-prompt-stop');
  return btn;
}

function makeWorkedForLabel(text = 'Worked for 13 seconds'): HTMLSpanElement {
  const span = document.createElement('span');
  span.textContent = text;
  return span;
}

describe('content/agents/replit.ts', () => {
  let postMessageSpy: ReturnType<typeof vi.spyOn>;
  let observers: MutationObserver[];

  beforeEach(async () => {
    document.body.innerHTML = '';
    // The module's own auto-run bootstrap() (import-time side effect, never
    // disconnected) keeps a long-lived observer alive on document.body for the whole
    // file. Clearing innerHTML above is itself a mutation it reacts to — drain that
    // notification against the outgoing spy before installing a fresh one, so it can
    // never land inside a later test's assertion window.
    await flush();
    postMessageSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    observers = [];
    // The response-stop dedup (shared across observeSubmitButton and
    // observeWorkedForLabel) is time-based, not identity/text-based like the file's
    // other module-scope dedups — different tests can genuinely run within the same
    // real-world dedup window and spuriously suppress each other without this reset.
    __resetResponseStopDedupForTests();
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

    it('collapses a duplicate re-render no matter how long the gap is (no fixed time window)', async () => {
      // Confirmed live 2026-07-02: a second, separate re-render duplicate was also
      // observed when the "Working" status label first appeared after submit — a
      // different trigger than the page-load swap above, with an unpredictable gap
      // (depends on Replit's own response latency). A fixed time window can't bound
      // this reliably, so the real fix has none — collapse holds regardless of delay.
      vi.useFakeTimers();
      try {
        observers.push(observeUserMessages(document.body));
        document.body.appendChild(makeUserMessage('run the tests'));
        await vi.advanceTimersByTimeAsync(0);
        expect(postMessageSpy).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(60_000);

        document.body.appendChild(makeUserMessage('run the tests'));
        await vi.advanceTimersByTimeAsync(0);

        expect(postMessageSpy).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('still emits an identical text again once a genuinely different message has been captured in between', async () => {
      observers.push(observeUserMessages(document.body));

      document.body.appendChild(makeUserMessage('deploy the app'));
      await flush();
      expect(postMessageSpy).toHaveBeenCalledTimes(1);

      document.body.appendChild(makeUserMessage('something else entirely'));
      await flush();
      expect(postMessageSpy).toHaveBeenCalledTimes(2);

      // The dedup guard only tracks the single most-recently emitted text, so a later,
      // deliberate resend of the original text is not mistaken for a re-render echo.
      document.body.appendChild(makeUserMessage('deploy the app'));
      await flush();

      expect(postMessageSpy).toHaveBeenCalledTimes(3);
    });
  });

  describe('observeSubmitButton', () => {
    // Confirmed live 2026-07-02 (Elements-panel inspection): Replit does NOT toggle a
    // `disabled` attribute on the submit button to signal generation state — that
    // attribute reflects whether the input box is empty. While generating, Replit
    // swaps in a wholly different element, data-cy="ai-prompt-stop". Response-stop is
    // therefore detected by that stop button's presence being removed from the DOM.
    it('emits nexpath:response-stopped when the stop button is removed after being present', async () => {
      const stopBtn = makeStopButton();
      document.body.appendChild(stopBtn);
      observers.push(observeSubmitButton(document.body));

      stopBtn.remove();
      await flush();

      expect(postMessageSpy).toHaveBeenCalledWith(
        { type: 'nexpath:response-stopped', agent: 'replit' },
        window.location.origin,
      );
    });

    it('does not emit when the stop button appears (generation starting)', async () => {
      observers.push(observeSubmitButton(document.body));

      document.body.appendChild(makeStopButton());
      await flush();

      expect(postMessageSpy).not.toHaveBeenCalled();
    });

    it('does not emit on removal without a prior stop-button observation (observer attached after generation already ended)', async () => {
      observers.push(observeSubmitButton(document.body));

      // Some unrelated DOM churn must not spuriously fire.
      document.body.appendChild(document.createElement('span'));
      await flush();

      expect(postMessageSpy).not.toHaveBeenCalled();
    });

    it('handles a full generate cycle: stop button appears then disappears', async () => {
      observers.push(observeSubmitButton(document.body));

      const stopBtn = makeStopButton();
      document.body.appendChild(stopBtn);
      await flush();
      expect(postMessageSpy).not.toHaveBeenCalled();

      stopBtn.remove();
      await flush();

      expect(postMessageSpy).toHaveBeenCalledWith(
        { type: 'nexpath:response-stopped', agent: 'replit' },
        window.location.origin,
      );
    });

    it('also detects an attribute-based toggle, not just element add/remove (hardened 2026-07-03)', async () => {
      // Confirmed live 2026-07-02 that Replit swaps the whole element for short
      // responses, but response-stop silently stopped firing on longer, multi-action
      // responses in live testing 2026-07-03 — plausibly because some response types
      // toggle the stop button's matching attribute on a persistent element instead of
      // swapping it. The observer now watches attribute mutations too, so this must
      // fire even when the element is never added/removed, only its matching attribute
      // is toggled off.
      const stopBtn = makeStopButton();
      document.body.appendChild(stopBtn);
      observers.push(observeSubmitButton(document.body));

      stopBtn.removeAttribute('data-cy'); // no longer matches STOP_BUTTON_SELECTOR — element stays in the DOM
      await flush();

      expect(postMessageSpy).toHaveBeenCalledWith(
        { type: 'nexpath:response-stopped', agent: 'replit' },
        window.location.origin,
      );
    });

    it('the poll independently detects response-stop even when MutationObserver never fires (safety-net proof, 2026-07-03)', async () => {
      // Response-stop still failed to fire on longer, multi-action responses across two
      // separate MutationObserver-config attempts (childList, then childList+attributes)
      // — meaning the real DOM mechanism isn't understood with certainty and a third
      // specific mutation-type guess risks the same result. Stubs MutationObserver to a
      // total no-op (never invokes its callback for any mutation) to prove the polling
      // fallback alone — independent of any mutation-type assumption — still detects the
      // transition once the poll interval elapses.
      vi.useFakeTimers();
      const RealMutationObserver = globalThis.MutationObserver;
      try {
        class NoOpObserver {
          observe(): void { /* never calls back, on purpose */ }
          disconnect(): void { /* no-op */ }
        }
        vi.stubGlobal('MutationObserver', NoOpObserver as unknown as typeof MutationObserver);

        const stopBtn = makeStopButton();
        document.body.appendChild(stopBtn);
        const observer = observeSubmitButton(document.body);
        observers.push(observer);

        stopBtn.remove(); // the stubbed MutationObserver never reacts to this
        await vi.advanceTimersByTimeAsync(1500); // let the poll interval elapse

        expect(postMessageSpy).toHaveBeenCalledWith(
          { type: 'nexpath:response-stopped', agent: 'replit' },
          window.location.origin,
        );
      } finally {
        vi.stubGlobal('MutationObserver', RealMutationObserver);
        vi.useRealTimers();
      }
    });

    it('disconnect() stops the poll too, not just the MutationObserver', async () => {
      vi.useFakeTimers();
      try {
        const stopBtn = makeStopButton();
        document.body.appendChild(stopBtn);
        const observer = observeSubmitButton(document.body);

        observer.disconnect();
        stopBtn.remove();
        await vi.advanceTimersByTimeAsync(3000); // well past one poll interval

        expect(postMessageSpy).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('observeWorkedForLabel — independent second response-stop signal (2026-07-03)', () => {
    // Three separate stop-button-based strategies all failed to reliably fire live —
    // this uses a completely different signal (Replit's own "Worked for X
    // seconds/minutes" completion label), confirmed by direct visual evidence across
    // every live test screenshot this session.
    it('emits nexpath:response-stopped when a "Worked for X seconds" label appears', async () => {
      observers.push(observeWorkedForLabel(document.body));

      document.body.appendChild(makeWorkedForLabel('Worked for 13 seconds'));
      await flush();

      expect(postMessageSpy).toHaveBeenCalledWith(
        { type: 'nexpath:response-stopped', agent: 'replit' },
        window.location.origin,
      );
    });

    it('matches "Worked for X minutes" too, not just seconds', async () => {
      observers.push(observeWorkedForLabel(document.body));

      document.body.appendChild(makeWorkedForLabel('Worked for 9 minutes'));
      await flush();

      expect(postMessageSpy).toHaveBeenCalledWith(
        { type: 'nexpath:response-stopped', agent: 'replit' },
        window.location.origin,
      );
    });

    it('detects the label nested inside a larger inserted subtree', async () => {
      observers.push(observeWorkedForLabel(document.body));

      const wrapper = document.createElement('div');
      wrapper.appendChild(makeWorkedForLabel('Worked for 32 seconds'));
      document.body.appendChild(wrapper);
      await flush();

      expect(postMessageSpy).toHaveBeenCalledWith(
        { type: 'nexpath:response-stopped', agent: 'replit' },
        window.location.origin,
      );
    });

    it('ignores unrelated text that does not match the pattern', async () => {
      observers.push(observeWorkedForLabel(document.body));

      document.body.appendChild(makeWorkedForLabel('Working on it...'));
      await flush();

      expect(postMessageSpy).not.toHaveBeenCalled();
    });

    it('ignores a large container that merely happens to contain the phrase deep inside unrelated content', async () => {
      observers.push(observeWorkedForLabel(document.body));

      const container = document.createElement('div');
      container.textContent = 'A'.repeat(100) + ' Worked for 5 seconds ' + 'B'.repeat(100);
      document.body.appendChild(container);
      await flush();

      expect(postMessageSpy).not.toHaveBeenCalled();
    });
  });

  describe('response-stop dedup across independent detectors (2026-07-03)', () => {
    it('collapses near-simultaneous signals from both observeSubmitButton and observeWorkedForLabel into one emission', async () => {
      const stopBtn = makeStopButton();
      document.body.appendChild(stopBtn);
      observers.push(observeSubmitButton(document.body));
      observers.push(observeWorkedForLabel(document.body));

      stopBtn.remove();
      document.body.appendChild(makeWorkedForLabel('Worked for 13 seconds'));
      await flush();

      const matchingCalls = postMessageSpy.mock.calls.filter(
        (call) => (call[0] as { type?: string }).type === 'nexpath:response-stopped',
      );
      expect(matchingCalls).toHaveLength(1);
    });
  });

  describe('bootstrap', () => {
    beforeEach(() => {
      // The module auto-runs bootstrap() once at import time (top-level side effect),
      // which sets this flag — reset it so each test starts as if freshly injected.
      window.__nexpathReplitBootstrapped = undefined;
    });

    it('logs the capture tier (console.log, not .debug — Verbose is hidden by default in DevTools) and wires up all three observers', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      bootstrap();

      expect(logSpy).toHaveBeenCalledWith('[nexpath] capture: mutation-observer');

      document.body.appendChild(makeUserMessage('post-bootstrap message'));
      await flush();
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({ promptText: 'post-bootstrap message' }),
        window.location.origin,
      );

      document.body.appendChild(makeWorkedForLabel('Worked for 7 seconds'));
      await flush();
      expect(postMessageSpy).toHaveBeenCalledWith(
        { type: 'nexpath:response-stopped', agent: 'replit' },
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
