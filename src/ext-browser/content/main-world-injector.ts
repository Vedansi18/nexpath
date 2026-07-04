import browser from 'webextension-polyfill';
import { resolveAgentFromHostname } from './agents/agent-hosts.js';
import { isPromptCapturedMsg, isResponseStoppedMsg, isShowAdvisoryMsg } from './ipc.js';
import type { PromptSubmitMsg, ResponseStopMsg } from './ipc.js';
import type { PanelEvent } from '../../core/ports/ui.port.js';

/**
 * Runs in the ISOLATED content-script world.
 *
 * Responsibilities:
 *   1. Drop a <script> tag pointing at main-world.js (runs in MAIN world to
 *      intercept window.fetch and emit postMessage events).
 *   2. Listen for postMessage events from the MAIN-world script.
 *   3. Forward them to the service worker via chrome.runtime.sendMessage.
 *   4. Listen for service-worker → content messages and hand them to inject.ts.
 */

declare global {
  interface Window {
    __nexpathMainWorldInjectorBootstrapped?: boolean;
  }
}

// ── Resolve project root from current tab URL ─────────────────────────────────

function resolveProjectRoot(): string {
  // Use origin as the project-root proxy in the browser; B3–B5 will refine.
  return window.location.origin;
}

function resolveAgent(): string {
  // Shared hostname→agent table (content/agents/agent-hosts.ts) — extracted in B4
  // when inject.ts's per-agent inject-back dispatch needed the same mapping.
  return resolveAgentFromHostname(window.location.hostname);
}

// browser.runtime.sendMessage() is supposed to transparently wake a terminated/idle
// MV3 service worker, but this has a real, confirmed failure mode: the SW can be
// asleep or mid-restart at the exact moment a message arrives (more likely the longer
// a tab sits idle relative to capture — e.g. a long-running agent turn, or a page-level
// flow like Replit's Publish pipeline running for minutes with no new prompt sent).
// Previously any sendMessage failure was swallowed by an empty catch — completely
// silent, no log, no retry — which is indistinguishable from "nothing was ever
// captured" from the console. Confirmed live 2026-07-03: prompt_submit_received simply
// never appeared for prompts submitted during/after a multi-minute Publish flow, with
// zero error anywhere. Retry once after a short delay (covers the transient wake-up
// race), and always log loudly on final failure so a dropped message is never silent
// again, even if the retry doesn't recover it.
const SEND_RETRY_DELAY_MS = 400;

function sendToServiceWorker(msg: PromptSubmitMsg | ResponseStopMsg): void {
  browser.runtime.sendMessage(msg).catch((firstErr: unknown) => {
    console.warn('[nexpath] sendMessage failed, retrying once:', msg.type, String(firstErr));
    setTimeout(() => {
      browser.runtime.sendMessage(msg).catch((retryErr: unknown) => {
        console.error('[nexpath] sendMessage failed on retry, message DROPPED:', msg.type, String(retryErr));
      });
    }, SEND_RETRY_DELAY_MS);
  });
}

function setupListeners(): void {
  // ── window.postMessage → service worker ──────────────────────────────────────

  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const msg = ev.data as unknown;

    if (isPromptCapturedMsg(msg)) {
      const sw: PromptSubmitMsg = {
        type: 'nexpath:prompt-submit',
        promptText: msg.promptText,
        projectRoot: resolveProjectRoot(),
        agent: msg.agent || resolveAgent(),
        tabId: 0, // SW fills real tab ID from sender.tab.id
      };
      sendToServiceWorker(sw);
      return;
    }

    if (isResponseStoppedMsg(msg)) {
      const sw: ResponseStopMsg = {
        type: 'nexpath:response-stop',
        projectRoot: resolveProjectRoot(),
        agent: msg.agent || resolveAgent(),
        tabId: 0,
      };
      sendToServiceWorker(sw);
    }
  });

  // ── Service worker → content → inject-back ───────────────────────────────────

  // Must always return a Promise (never a bare value) to match webextension-polyfill's
  // OnMessageListenerAsync shape exactly — a mixed Promise|undefined return doesn't
  // structurally match any of OnMessageListener's 3 alternatives and silently degrades
  // to an untyped callback (confirmed via tsconfig.ext-browser.json, 2026-07-02 — see
  // that file's header comment for why this class of error went uncaught all session).
  browser.runtime.onMessage.addListener((msg: unknown): Promise<unknown> => {
    // Re-dispatch to inject.ts (which handles panel mounting).
    window.dispatchEvent(new CustomEvent('nexpath:sw-message', { detail: msg }));

    if (!isShowAdvisoryMsg(msg)) return Promise.resolve(undefined);

    // panel-adapter.ts's ContentScriptUIAdapter.showAdvisory() awaits this listener's
    // return value directly (via browser.tabs.sendMessage) — without returning a
    // Promise here, it resolves as undefined almost immediately, which showAdvisory()
    // treats as a synthetic 'dismiss' regardless of what the user actually does. Wait
    // for inject.ts to report the real outcome (dispatched as 'nexpath:panel-event'
    // once the user selects or dismisses) before resolving, so session-state/cooldown
    // bookkeeping reflects reality. Single-in-flight assumption: the engine awaits
    // showAdvisory() before it can fire another advisory, so at most one listener is
    // ever pending at a time — no advisoryId correlation needed.
    return new Promise<PanelEvent>((resolve) => {
      const handlePanelEvent = (ev: Event): void => {
        window.removeEventListener('nexpath:panel-event', handlePanelEvent);
        resolve((ev as CustomEvent<PanelEvent>).detail);
      };
      window.addEventListener('nexpath:panel-event', handlePanelEvent);
    });
  });
}

// ── Idempotent-injection guard ──────────────────────────────────────────────────
//
// MV3 does not remove an old content script's running instance from an already-open
// tab just because the extension was reloaded — reload the extension without also
// hard-refreshing every open target tab, and 2+ independent copies of this script can
// end up alive in the same page simultaneously, each registering its own listeners,
// each independently forwarding every event to the service worker (confirmed root
// cause of duplicate nexpath:prompt-submit/response-stop deliveries, 2026-07-02 — see
// replit.ts's matching guard for the full explanation). A marker on `window` (shared
// across re-injections into the same page) makes this script's setup a no-op for any
// instance after the first.
if (window.__nexpathMainWorldInjectorBootstrapped) {
  console.log('[nexpath] main-world-injector: skipped, already bootstrapped in this page (stale re-injection guard)');
} else {
  window.__nexpathMainWorldInjectorBootstrapped = true;

  // ── Inject the MAIN-world script ──────────────────────────────────────────────

  const script = document.createElement('script');
  script.src = browser.runtime.getURL('inject/main-world.js');
  script.type = 'module';
  (document.head ?? document.documentElement).appendChild(script);
  script.remove();

  setupListeners();
}
