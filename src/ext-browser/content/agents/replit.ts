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

// Shared across every response-stop detection mechanism below (stop-button presence,
// and the "Worked for" text marker) — several independent detectors run in parallel by
// design (see each one's own comment for why relying on a single mechanism has
// repeatedly proven insufficient), so a brief cooldown prevents a duplicate
// response_stop_received signal when more than one of them notices the same
// completion within a moment of each other. This is expected, harmless overlap, not a
// bug to eliminate — better to risk an occasional harmless duplicate than to miss the
// signal entirely again.
const RESPONSE_STOP_DEDUP_WINDOW_MS = 3000;
let lastResponseStoppedEmittedAt = 0;

function emitResponseStoppedOnce(): void {
  const now = Date.now();
  if (now - lastResponseStoppedEmittedAt < RESPONSE_STOP_DEDUP_WINDOW_MS) return;
  lastResponseStoppedEmittedAt = now;
  emitResponseStopped();
}

// Test-only reset — this dedup is time-based (real Date.now(), not element identity or
// text content like the other module-scope dedups in this file), so different tests in
// the same run can genuinely fall within RESPONSE_STOP_DEDUP_WINDOW_MS of each other in
// real wall-clock time and spuriously suppress one another without this.
export function __resetResponseStopDedupForTests(): void {
  lastResponseStoppedEmittedAt = 0;
}

function extractPromptText(el: Element): string {
  const rendered = el.querySelector('.rendered-markdown');
  // A present-but-empty .rendered-markdown means a fill-in-progress shell — return ''
  // so the caller parks it for re-check rather than falling through to unrelated text
  // (timestamps, action labels) that happens to live elsewhere inside the element.
  if (rendered) return (rendered.textContent ?? '').trim();
  // No .rendered-markdown child at all: live-typed messages may render through a
  // different path than server-hydrated history (2026-07-03 — the second prompt of a
  // session was never captured even by the reconciliation sweep running for minutes,
  // proving the history-confirmed structure doesn't hold for every message render).
  return (el.textContent ?? '').trim();
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

// Messages whose [data-cy="user-message"] node existed but whose .rendered-markdown
// text was still EMPTY when first examined. Root cause of "first prompt captured, every
// later prompt silently lost" (reported live 2026-07-02 during a Publish flow, then
// reproduced 2026-07-03 on prompt 2 of a fresh session, with the sendMessage-retry
// logging added in between staying completely silent — proving the loss happens here,
// before any messaging): Replit can insert the message shell first and fill the
// markdown child a tick later, and the old code marked the element seen *before*
// checking its text, permanently consuming it with no capture and no log. Empty-text
// elements are parked here instead and re-checked by the reconciliation sweep below
// until their text arrives, they leave the DOM, or they age out.
const pendingEmptyMessages = new Map<Element, number>();
const PENDING_EMPTY_MAX_AGE_MS = 60_000;
const SWEEP_INTERVAL_MS = 1500;

// Test-only reset — pendingEmptyMessages holds strong Element refs across tests in the
// same file, and lastEmittedText's consecutive-collapse would otherwise couple tests
// that happen to reuse a prompt string.
export function __resetPromptCaptureStateForTests(): void {
  pendingEmptyMessages.clear();
  lastEmittedText = null;
}

// Single funnel for every prompt-capture channel (composer submit, mutation observer,
// reconciliation sweep) — the consecutive-identical collapse lives here once, so any
// two channels noticing the same prompt (e.g. composer capture at submit time followed
// by the rendered message echo in the chat feed) can never double-emit.
function emitIfNewText(text: string, viaLog?: string): void {
  if (!text || text === lastEmittedText) return;
  lastEmittedText = text;
  if (viaLog) console.log(viaLog);
  emitPromptCaptured(text);
}

function tryCapture(el: Element, via: 'observer' | 'sweep'): void {
  const text = extractPromptText(el);
  if (!text) {
    if (!pendingEmptyMessages.has(el)) {
      pendingEmptyMessages.set(el, Date.now());
      // Visible by default (same rationale as the response-stop detection logs): this
      // exact state was previously indistinguishable from "nothing happened at all".
      console.log('[nexpath] user-message appeared with empty text — parked for re-check');
    }
    return;
  }
  pendingEmptyMessages.delete(el);
  emitIfNewText(
    text,
    via === 'sweep'
      ? '[nexpath] prompt captured via reconciliation sweep (mutation path missed it)'
      : undefined,
  );
}

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
          tryCapture(el, 'observer');
        }
      }
    }
  });
  observer.observe(root, { childList: true, subtree: true });

  // Reconciliation sweep — the same hypothesis-independent safety-net philosophy that
  // ended the response-stop saga (see observeSubmitButton's poll), applied to prompt
  // capture: on a fixed interval, re-check ground truth directly instead of trusting
  // any single assumption about how/when Replit mutates the DOM. Covers both known
  // loss modes at once: (1) shell-inserted-then-text-filled messages parked above, and
  // (2) any user-message the addedNodes walk never saw at all. Whichever path (observer
  // or sweep) reaches a message first wins; lastEmittedText collapses the overlap.
  const sweep = (): void => {
    const now = Date.now();
    for (const [el, firstSeenAt] of pendingEmptyMessages) {
      if (!el.isConnected || now - firstSeenAt > PENDING_EMPTY_MAX_AGE_MS) {
        pendingEmptyMessages.delete(el);
        continue;
      }
      tryCapture(el, 'sweep');
    }
    for (const el of root.querySelectorAll(USER_MESSAGE_SELECTOR)) {
      if (seenMessages.has(el)) continue;
      seenMessages.add(el);
      tryCapture(el, 'sweep');
    }
  };
  const sweepIntervalId = setInterval(sweep, SWEEP_INTERVAL_MS);
  const originalDisconnect = observer.disconnect.bind(observer);
  observer.disconnect = (): void => {
    clearInterval(sweepIntervalId);
    originalDisconnect();
  };

  return observer;
}

// ── Prompt-submit, independent source-side channel: read the composer at submit ──
//
// The mutation-observer channel above depends on TWO render-path assumptions
// ([data-cy="user-message"] + .rendered-markdown) that were recon-confirmed for
// server-hydrated history messages but demonstrably do NOT hold for every live-typed
// message: on 2026-07-03, across two separate projects, the first (hydration-rendered)
// prompt was captured while every live-typed follow-up was silently missed — with the
// reconciliation sweep re-scanning the whole document every 1.5s for minutes, which
// rules out timing and proves the live-message DOM simply doesn't match the selectors.
// Rather than guess a third render-path selector with no live DOM access, this channel
// removes the render-path dependency entirely: read the user's text directly from the
// composer at the moment of submit (Enter keydown / send-button click), before the
// framework clears it. Both selectors involved are live-confirmed on real Replit:
// COMPOSER_SELECTOR is the exact selector inject-back successfully targets
// (replit-inject.ts), and the submit button's data-cy came from the user's own
// Elements-panel inspection (2026-07-02). Capture-phase listeners on the root beat the
// page's own handlers, so the text is still present when read. The rendered-message
// echo that may follow collapses via emitIfNewText's consecutive-identical guard.

const COMPOSER_SELECTOR = '.cm-content[contenteditable="true"]';
const SUBMIT_BUTTON_SELECTOR = '[data-cy="ai-prompt-submit"]';

// Replit's FILE editors are CodeMirror too — COMPOSER_SELECTOR alone could match the
// code editor and capture file contents as a "prompt" on every Enter keystroke. The
// chat composer is disambiguated by anchoring on the agent submit/stop button (both
// data-cys live-confirmed 2026-07-02): walk up from the button until an ancestor's
// subtree contains a CodeMirror editor — that shared container is the prompt box, and
// its editor is the chat composer. File editors live in different panes and never
// share a container with these buttons below the workspace root.
function findChatComposer(): HTMLElement | null {
  const anchor =
    document.querySelector(SUBMIT_BUTTON_SELECTOR) ?? document.querySelector(STOP_BUTTON_SELECTOR);
  let node: Element | null = anchor;
  while (node) {
    const cm = node.querySelector<HTMLElement>(COMPOSER_SELECTOR);
    if (cm) return cm;
    node = node.parentElement;
  }
  return null;
}

function readComposerText(input: HTMLElement): string {
  // CodeMirror 6 renders one .cm-line per line; textContent alone would drop the
  // line breaks of a multi-line prompt.
  const lines = Array.from(input.querySelectorAll('.cm-line'), (l) => l.textContent ?? '');
  const text = (lines.length > 0 ? lines.join('\n') : (input.textContent ?? '')).trim();
  // An empty CodeMirror editor renders its placeholder ("Message Agent…") as real
  // text inside the line — never capture that as a prompt.
  const placeholder = (input.querySelector('.cm-placeholder')?.textContent ?? '').trim();
  if (placeholder && text === placeholder) return '';
  return text;
}

function captureFromComposer(input: HTMLElement): void {
  const text = readComposerText(input);
  if (!text) return;
  emitIfNewText(text, '[nexpath] prompt captured at submit (composer read)');
}

export function observeComposerSubmit(root: Document | Element): { disconnect(): void } {
  const onKeyDown = (ev: Event): void => {
    const ke = ev as KeyboardEvent;
    // Shift+Enter is "newline", every other Enter variant (plain/Ctrl/Cmd) submits.
    if (ke.key !== 'Enter' || ke.shiftKey) return;
    const target = ev.target instanceof Element ? ev.target : null;
    const cm = target?.closest<HTMLElement>(COMPOSER_SELECTOR);
    if (!cm || cm !== findChatComposer()) return; // Enter in a file editor is just a newline
    captureFromComposer(cm);
  };
  const onClick = (ev: Event): void => {
    const target = ev.target instanceof Element ? ev.target : null;
    if (!target?.closest(SUBMIT_BUTTON_SELECTOR)) return;
    const cm = findChatComposer();
    if (!cm) return;
    captureFromComposer(cm);
  };
  root.addEventListener('keydown', onKeyDown, true);
  root.addEventListener('click', onClick, true);
  return {
    disconnect(): void {
      root.removeEventListener('keydown', onKeyDown, true);
      root.removeEventListener('click', onClick, true);
    },
  };
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
      emitResponseStoppedOnce();
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

// ── Response-stop, independent second signal: the "Worked for X seconds/minutes" label ──
//
// Three separate stop-button-based detection strategies (element-swap, attribute-
// toggle, presence-polling) all failed to reliably fire live, 2026-07-03, specifically
// on longer, multi-action responses. Rather than a fourth guess at the same button
// mechanism, this uses a completely independent signal: Replit's own chat transcript
// reliably shows a "Worked for X seconds"/"Worked for X minutes" label the moment a
// turn completes — confirmed by direct visual evidence across EVERY live test
// screenshot this session, both the one confirmed-working case and every case where
// stop-button detection failed. The exact selector/data-cy for this element isn't
// confirmed (no live DOM access to inspect it directly) — matched by text-content
// pattern instead, which is arguably more resilient anyway, since Replit's own CSS
// class names elsewhere carry deploy-specific content hashes that break on their next
// release. Runs in parallel with observeSubmitButton, not as a replacement for it —
// whichever detector notices completion first wins (emitResponseStoppedOnce dedups).

const WORKED_FOR_PATTERN = /\bWorked for\s+\d/;

function isWorkedForLabel(el: Element): boolean {
  // Length cap bounds false positives from a large container that happens to contain
  // this phrase somewhere deep inside unrelated content — a short, leaf-like label
  // matching this exact pattern is very unlikely to occur elsewhere on the page.
  const text = el.textContent?.trim() ?? '';
  return text.length > 0 && text.length < 60 && WORKED_FOR_PATTERN.test(text);
}

export function observeWorkedForLabel(root: Element): MutationObserver {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of Array.from(mutation.addedNodes)) {
        if (!(node instanceof Element)) continue;
        const matches = isWorkedForLabel(node)
          ? [node]
          : Array.from(node.querySelectorAll('*')).filter(isWorkedForLabel);
        if (matches.length === 0) continue;
        console.log('[nexpath] response-stop detected ("Worked for" label appeared)');
        emitResponseStoppedOnce();
      }
    }
  });
  observer.observe(root, { childList: true, subtree: true });
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
  observeComposerSubmit(document);
  observeUserMessages(document.body);
  observeSubmitButton(document.body);
  observeWorkedForLabel(document.body);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
