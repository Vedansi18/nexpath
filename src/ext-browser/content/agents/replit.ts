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
const SUBMIT_BUTTON_SELECTOR = '[data-cy="ai-prompt-submit"]';
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

// Replit swaps its chat DOM from a lightweight loading shell to the fully-hydrated
// real list shortly after a project page finishes loading (confirmed live 2026-07-02:
// submitting a prompt while the tab title still read "Loading…" produced one capture,
// then a second identical-text capture the moment the title changed to the project
// name — same message, promptCount 1 then 2, no new prompt sent). Replit re-creates
// the message element as a new DOM node with the same text during that swap, so the
// WeakSet above (keyed by element identity) can't recognize it as already-seen — a
// short content+time window catches this specific transitional duplicate without
// suppressing a genuinely repeated prompt sent minutes apart.
const recentTexts = new Map<string, number>();
const TEXT_DEDUP_WINDOW_MS = 4000;

function isDuplicateText(text: string): boolean {
  const now = Date.now();
  const last = recentTexts.get(text);
  recentTexts.set(text, now);
  return last !== undefined && now - last < TEXT_DEDUP_WINDOW_MS;
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
          const text = extractPromptText(el);
          if (!text || isDuplicateText(text)) continue;
          emitPromptCaptured(text);
        }
      }
    }
  });
  observer.observe(root, { childList: true, subtree: true });
  return observer;
}

// ── Response-stop: the submit button's disabled attribute toggling off ─────────

export function observeSubmitButton(root: Node): MutationObserver {
  // Read current state at observer setup so an already-disabled button (e.g. observer
  // attached mid-turn) doesn't spuriously fire on its first observed transition.
  let wasDisabled = document.querySelector(SUBMIT_BUTTON_SELECTOR)?.hasAttribute('disabled') ?? false;
  const observer = new MutationObserver(() => {
    const btn = document.querySelector(SUBMIT_BUTTON_SELECTOR);
    if (!btn) return;
    const isDisabled = btn.hasAttribute('disabled');
    if (wasDisabled && !isDisabled) emitResponseStopped();
    wasDisabled = isDisabled;
  });
  observer.observe(root, { attributes: true, attributeFilter: ['disabled'], subtree: true });
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
