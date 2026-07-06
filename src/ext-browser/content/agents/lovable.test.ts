// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  observeUserMessages,
  observeComposerSubmit,
  observeStopButton,
  observeFetchPrompts,
  bootstrap,
  __resetResponseStopDedupForTests,
  __resetPromptCaptureStateForTests,
} from './lovable.js';

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Mirrors Lovable's real prompt box (recon 2026-07-06): a TipTap/ProseMirror
// contenteditable with aria-label "Chat input" (one <p> per line) sharing a
// container with the aria-label="Send message" button.
function makeComposer(text: string): { composer: HTMLElement; button: HTMLElement } {
  const container = document.createElement('div');
  const composer = document.createElement('div');
  composer.className = 'tiptap ProseMirror';
  composer.setAttribute('contenteditable', 'true');
  composer.setAttribute('role', 'textbox');
  composer.setAttribute('aria-label', 'Chat input');
  for (const lineText of text === '' ? [''] : text.split('\n')) {
    const p = document.createElement('p');
    p.textContent = lineText;
    composer.appendChild(p);
  }
  const button = document.createElement('button');
  button.setAttribute('aria-label', 'Send message');
  container.append(composer, button);
  document.body.appendChild(container);
  return { composer, button };
}

// Mirrors the confirmed user-message DOM: div[data-message-id="main:agent#…#usr:…"]
// containing a timestamp node AND an inner div.prose with the actual prompt text
// (the timestamp lives OUTSIDE .prose — extraction must not pick it up).
function makeUserMessage(text: string, seq = 1): HTMLElement {
  const wrap = document.createElement('div');
  wrap.setAttribute('data-message-id', `main:agent#${String(seq).padStart(14, '0')}#usr:HASH${seq}`);
  const time = document.createElement('div');
  time.textContent = 'Today at 5:08 PM';
  const bubble = document.createElement('div');
  bubble.setAttribute('data-current-user', 'true');
  const prose = document.createElement('div');
  prose.className = 'prose prose-pulse';
  prose.setAttribute('data-selectable', 'true');
  const p = document.createElement('p');
  p.textContent = text;
  prose.appendChild(p);
  bubble.appendChild(prose);
  wrap.append(time, bubble);
  return wrap;
}

function makeStopButton(): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.setAttribute('aria-label', 'Stop generating');
  return btn;
}

function pressEnter(target: Element, init: KeyboardEventInit = {}): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, ...init }));
}

function dispatchFetchPrompt(promptText: string, agent = 'lovable', origin = window.location.origin): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'nexpath:fetch-prompt', promptText, agent },
      origin,
      source: window,
    }),
  );
}

describe('content/agents/lovable.ts', () => {
  let postMessageSpy: ReturnType<typeof vi.spyOn>;
  let observers: Array<{ disconnect(): void }>;

  beforeEach(async () => {
    document.body.innerHTML = '';
    // Same rationale as replit.test.ts/bolt.test.ts: the module's import-time
    // auto-bootstrap keeps never-disconnected observers alive on document.body for
    // the whole file — drain the mutation notification from the innerHTML clear
    // against the outgoing spy before installing a fresh one.
    await flush();
    postMessageSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    observers = [];
    __resetResponseStopDedupForTests();
    __resetPromptCaptureStateForTests();
  });

  afterEach(() => {
    observers.forEach((o) => o.disconnect());
    postMessageSpy.mockRestore();
  });

  describe('observeComposerSubmit — TipTap "Chat input" composer', () => {
    it('captures the composer text on Enter, joining <p> lines with newlines', () => {
      observers.push(observeComposerSubmit(document));
      const { composer } = makeComposer('first line\nsecond line');

      pressEnter(composer.querySelector('p')!);

      expect(postMessageSpy).toHaveBeenCalledWith(
        { type: 'nexpath:prompt-captured', promptText: 'first line\nsecond line', agent: 'lovable' },
        window.location.origin,
      );
    });

    it('does not capture on Shift+Enter (newline, not submit)', () => {
      observers.push(observeComposerSubmit(document));
      const { composer } = makeComposer('still typing');

      pressEnter(composer, { shiftKey: true });

      expect(postMessageSpy).not.toHaveBeenCalled();
    });

    it('captures the composer text when the Send message button is clicked', () => {
      observers.push(observeComposerSubmit(document));
      const { button } = makeComposer('clicked to send');

      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({ promptText: 'clicked to send' }),
        window.location.origin,
      );
    });

    it('ignores a TipTap editor WITHOUT the "Chat input" aria-label (not the chat composer)', () => {
      observers.push(observeComposerSubmit(document));
      const container = document.createElement('div');
      const other = document.createElement('div');
      other.className = 'tiptap ProseMirror';
      other.setAttribute('contenteditable', 'true');
      const p = document.createElement('p');
      p.textContent = 'some rich-text field';
      other.appendChild(p);
      const button = document.createElement('button');
      button.setAttribute('aria-label', 'Send message');
      container.append(other, button);
      document.body.appendChild(container);

      pressEnter(p);

      expect(postMessageSpy).not.toHaveBeenCalled();
    });
  });

  describe('observeUserMessages — data-message-id "#usr" bubbles', () => {
    it('captures an inserted user message, extracting text from .prose WITHOUT the timestamp', async () => {
      observers.push(observeUserMessages(document.body));

      document.body.appendChild(makeUserMessage('Build a simple quotes page'));
      await flush();

      expect(postMessageSpy).toHaveBeenCalledWith(
        { type: 'nexpath:prompt-captured', promptText: 'Build a simple quotes page', agent: 'lovable' },
        window.location.origin,
      );
    });

    it('ignores assistant messages (#ast message ids)', async () => {
      observers.push(observeUserMessages(document.body));

      const wrap = document.createElement('div');
      wrap.setAttribute('data-message-id', 'main:agent#00000000000002#ast:ZZZZ');
      const prose = document.createElement('div');
      prose.className = 'prose';
      prose.textContent = 'I built the quotes page for you';
      wrap.appendChild(prose);
      document.body.appendChild(wrap);
      await flush();

      expect(postMessageSpy).not.toHaveBeenCalled();
    });

    it('does not re-capture messages that existed before the observer attached (history priming)', async () => {
      document.body.appendChild(makeUserMessage('old history prompt', 1));
      observers.push(observeUserMessages(document.body));
      await flush();

      document.body.appendChild(makeUserMessage('genuinely new prompt', 2));
      await flush();

      expect(postMessageSpy).toHaveBeenCalledTimes(1);
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({ promptText: 'genuinely new prompt' }),
        window.location.origin,
      );
    });
  });

  describe('observeStopButton — "Stop generating" element swap', () => {
    it('emits response-stopped when the stop button leaves the DOM', async () => {
      const stop = makeStopButton();
      document.body.appendChild(stop);
      observers.push(observeStopButton(document.body));
      await flush();

      stop.remove();
      await flush();

      expect(postMessageSpy).toHaveBeenCalledWith(
        { type: 'nexpath:response-stopped', agent: 'lovable' },
        window.location.origin,
      );
    });

    it('does not emit while the stop button is still present', async () => {
      document.body.appendChild(makeStopButton());
      observers.push(observeStopButton(document.body));
      await flush();

      document.body.appendChild(document.createElement('div'));
      await flush();

      expect(postMessageSpy).not.toHaveBeenCalled();
    });
  });

  describe('observeFetchPrompts — transport channel', () => {
    it('routes a matching fetch-prompt through the funnel with this kit agent id', () => {
      observers.push(observeFetchPrompts(window));

      dispatchFetchPrompt('make the cards responsive');

      expect(postMessageSpy).toHaveBeenCalledWith(
        { type: 'nexpath:prompt-captured', promptText: 'make the cards responsive', agent: 'lovable' },
        window.location.origin,
      );
    });

    it('ignores fetch-prompts addressed to a different agent', () => {
      observers.push(observeFetchPrompts(window));

      dispatchFetchPrompt('someone else', 'bolt');

      expect(postMessageSpy).not.toHaveBeenCalled();
    });

    it('fetch + composer seeing the same prompt emit exactly once (funnel collapse)', () => {
      observers.push(observeFetchPrompts(window));
      observers.push(observeComposerSubmit(document));
      const { composer } = makeComposer('the same prompt');

      pressEnter(composer.querySelector('p')!);
      dispatchFetchPrompt('the same prompt');

      expect(postMessageSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('bootstrap idempotency (stale re-injection guard)', () => {
    it('a second bootstrap() call in the same page is a no-op', () => {
      // The module's import-time auto-run already set the window flag.
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      bootstrap();
      expect(logSpy.mock.calls.some((c) => String(c[0]).includes('already bootstrapped'))).toBe(true);
      logSpy.mockRestore();
    });
  });
});
