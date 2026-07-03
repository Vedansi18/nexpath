import type { PromptCapturedMsg, ResponseStoppedMsg } from '../ipc.js';

/**
 * Replit capture — B3.
 *
 * Recon (docs/capture-recon/replit-recon.md) confirmed Replit's Agent chat runs
 * over a proprietary binary WebSocket (MessagePack) — not fetch, not a readable
 * WebSocket. Capture uses MutationObserver against confirmed DOM selectors
 * instead of the MAIN-world fetch/WebSocket wrapper (main-world-injector.ts
 * still runs on this page but never fires for Replit — its listener is reused
 * here by posting the same message shapes it already knows how to forward).
 */

const USER_MESSAGE_SELECTOR = '[data-cy="user-message"]';
// While the Agent is generating, Replit does NOT toggle a `disabled` attribute on the
// submit button — it replaces it entirely with a different element carrying
// data-cy="ai-prompt-stop" (confirmed via live Elements-panel inspection, 2026-07-02:
// idle state showed data-cy="ai-prompt-submit" disabled="true" — which reflects an
// EMPTY input box, not generation state — while generating showed a wholly different
// button, different SVG icon, data-cy="ai-prompt-stop"). Response-stop is therefore
// detected by the stop button's presence being removed from the DOM, not an attribute
// transition on one persistent node.
const STOP_BUTTON_SELECTOR = '[data-cy="ai-prompt-stop"]';
const CAPTURE_TIER = 'mutation-observer';

function emitPromptCaptured(promptText: string): void {
  const msg: PromptCapturedMsg = { type: 'nexpath:prompt-captured', promptText, agent: 'replit' };
  window.postMessage(msg, window.location.origin);
}

function emitResponseStopped(): void {
  const msg: ResponseStoppedMsg = { type: 'nexpath:response-stopped', agent: 'replit' };
  window.postMessage(msg, window.location.origin);
}

function extractPromptText(el: Element): string {
  const rendered = el.querySelector('.rendered-markdown');
  return (rendered?.textContent ?? '').trim();
}

// ── Prompt-submit: new [data-cy="user-message"] nodes in the chat feed ─────────

const seenMessages = new WeakSet<Element>();

// Replit re-creates the [data-cy="user-message"] element (new DOM node, same text)
// more than once per turn — confirmed live 2026-07-02 across two separate occasions:
// once during the page's own loading→hydrated-list swap (promptCount jumped 1→2 with
// no new prompt sent, right as the tab title finished changing), and again — a second,
// unrelated re-render — when the "Working" status label first appears after submit
// (same symptom, different trigger, observed on a fresh page load this time, so it
// isn't only a page-load artifact). A fixed time window (the first fix attempt) can't
// reliably bound this: the gap between these re-renders depends on Replit's own
// variable load/response latency, not a fixed duration. The WeakSet above dedups by
// element identity and can't help here since each re-render is a genuinely different
// element. Instead: collapse only *consecutive* identical captures, with no time bound
// — any number of redundant re-renders of the same still-most-recent message collapse
// to one emission, but the guard resets the instant a genuinely different message is
// captured, so an intentional identical resend after another prompt still counts. The
// one accepted tradeoff: sending the exact same text twice in a row with nothing in
// between is indistinguishable from a re-render artifact and would also collapse —
// unavoidable from DOM observation alone, and a narrower miss than a time window.
let lastEmittedText: string | null = null;

export function observeUserMessages(root: Element): MutationObserver {
  // Prime: register any messages already in the DOM at setup time as "seen" WITHOUT
  // emitting captures for them. Mirrors src/ext-vscode/chat-history-watcher.ts's
  // "primedTargets" pattern, which fixed the identical bug class for Cursor/Windsurf —
  // without priming, every page load/reload replays the entire prompt history through
  // the pipeline, inflating promptCount and producing advisory storms that bypass the
  // warmup/cooldown gates. Only genuinely new prompts may reach the pipeline — this is
  // also the implicit guarantee Claude Code's push-based hook gives for free, since it
  // can never fire for an old prompt in the first place.
  for (const el of root.querySelectorAll(USER_MESSAGE_SELECTOR)) {
    seenMessages.add(el);
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of Array.from(mutation.addedNodes)) {
        if (!(node instanceof Element)) continue;
        const matches = node.matches(USER_MESSAGE_SELECTOR)
          ? [node]
          : Array.from(node.querySelectorAll(USER_MESSAGE_SELECTOR));
        for (const el of matches) {
          if (seenMessages.has(el)) continue;
          seenMessages.add(el);
          const text = extractPromptText(el);
          if (!text || text === lastEmittedText) continue;
          lastEmittedText = text;
          emitPromptCaptured(text);
        }
      }
    }
  });
  observer.observe(root, { childList: true, subtree: true });
  return observer;
}

// ── Response-stop: the stop button disappearing from the DOM ───────────────────

const POLL_INTERVAL_MS = 1500;

export function observeSubmitButton(root: Node): MutationObserver {
  // Read current state at observer setup so an already-mid-generation attach (e.g.
  // observer starts while a response is already streaming) doesn't spuriously fire on
  // its first observed transition.
  let wasGenerating = document.querySelector(STOP_BUTTON_SELECTOR) !== null;

  const checkAndEmit = (): void => {
    const isGenerating = document.querySelector(STOP_BUTTON_SELECTOR) !== null;
    if (wasGenerating && !isGenerating) {
      // Visible in the page console regardless of whether the SW message that follows
      // succeeds — closes an observability gap confirmed live 2026-07-03: response-stop
      // silently stopped firing on longer, multi-action responses with no trace of
      // whether the content script ever detected the transition at all, or detected it
      // but the message to the SW got lost.
      console.log('[nexpath] response-stop detected (stop button no longer present)');
      emitResponseStopped();
    }
    wasGenerating = isGenerating;
  };

  const observer = new MutationObserver(checkAndEmit);
  // childList (element swapped — confirmed live 2026-07-02 for short responses) +
  // attributes (in case some response types toggle visibility on a persistent element
  // instead — hardened 2026-07-03, first attempted fix). Kept as the primary,
  // lowest-latency path; the poll below is the actual safety net.
  observer.observe(root, { childList: true, subtree: true, attributes: true });

  // Polling safety net, independent of MutationObserver's mutation-type coverage.
  // Confirmed live 2026-07-03: response-stop still failed to fire on longer,
  // multi-action responses across two separate MutationObserver-config attempts
  // (childList, then childList+attributes) — meaning the actual DOM mechanism Replit
  // uses for these response types isn't understood with certainty yet, and guessing a
  // third specific mutation-type config risks the same result. This checks ground
  // truth directly on a fixed interval regardless of *how* the DOM changed, so it
  // cannot have the same class of blind spot a mutation-type filter can — the
  // trade-off is up to POLL_INTERVAL_MS of added detection latency, which only affects
  // when we notice completion, not whether it's noticed at all. Both mechanisms share
  // `wasGenerating`, so whichever detects the transition first wins; the other is a
  // silent no-op. disconnect() is wrapped so callers (bootstrap, tests) that already
  // call the standard MutationObserver.disconnect() correctly stop the poll too,
  // without needing to know it exists.
  const pollIntervalId = setInterval(checkAndEmit, POLL_INTERVAL_MS);
  const originalDisconnect = observer.disconnect.bind(observer);
  observer.disconnect = (): void => {
    clearInterval(pollIntervalId);
    originalDisconnect();
  };

  return observer;
}

// ── Bootstrap ────────────────────────────────────────────────────────────────
//
// Inject-back (injectPromptText) deliberately lives in ./replit-inject.ts, NOT here —
// see that file's header comment for why: this file auto-runs bootstrap() below at
// import time, and content/inject.ts also needs inject-back, but importing anything
// from THIS file into inject.ts would duplicate that auto-run into inject.js's own
// bundle (esbuild inlines a module's full top-level code, side effects included, into
// every entry point that imports from it) — silently doubling every capture.

// Idempotent-injection guard: MV3 does not remove an old content script's running
// instance from an already-open tab just because the extension was reloaded — reload
// the extension without also hard-refreshing every open target tab, and you can end up
// with 2+ independent copies of this script alive in the same page simultaneously, each
// with its own MutationObserver, each independently capturing and sending every event.
// A marker on `window` (shared across re-injections into the same page, unlike this
// module's own scope, which esbuild gives a fresh copy of on every injection) makes
// bootstrap a no-op for any instance after the first, regardless of how many times this
// script gets injected into the same live page.
declare global {
  interface Window {
    __nexpathReplitBootstrapped?: boolean;
  }
}

export function bootstrap(): void {
  if (window.__nexpathReplitBootstrapped) {
    console.log('[nexpath] capture: mutation-observer — skipped, already bootstrapped in this page (stale re-injection guard)');
    return;
  }
  window.__nexpathReplitBootstrapped = true;

  // console.log (not .debug) — Chrome's DevTools console hides "Verbose" level
  // (which .debug is categorized as) unless the user explicitly enables it in the
  // level filter. This line is meant to be visible by default, per devplan §8.1.
  console.log(`[nexpath] capture: ${CAPTURE_TIER}`);
  observeUserMessages(document.body);
  observeSubmitButton(document.body);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
