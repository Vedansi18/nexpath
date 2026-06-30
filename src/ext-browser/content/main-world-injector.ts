import { isPromptCapturedMsg, isResponseStoppedMsg } from './ipc.js';
import type { PromptSubmitMsg, ResponseStopMsg } from './ipc.js';

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

// ── Inject the MAIN-world script ──────────────────────────────────────────────

const script = document.createElement('script');
script.src = chrome.runtime.getURL('inject/main-world.js');
script.type = 'module';
(document.head ?? document.documentElement).appendChild(script);
script.remove();

// ── Resolve project root from current tab URL ─────────────────────────────────

function resolveProjectRoot(): string {
  // Use origin as the project-root proxy in the browser; B3–B5 will refine.
  return window.location.origin;
}

function resolveAgent(): string {
  const host = window.location.hostname;
  if (host.endsWith('replit.com')) return 'replit';
  if (host === 'bolt.new' || host.endsWith('stackblitz.com')) return 'bolt';
  if (host === 'lovable.dev') return 'lovable';
  return 'unknown';
}

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
    chrome.runtime.sendMessage(sw).catch(() => { /* SW may not be up yet */ });
    return;
  }

  if (isResponseStoppedMsg(msg)) {
    const sw: ResponseStopMsg = {
      type: 'nexpath:response-stop',
      projectRoot: resolveProjectRoot(),
      agent: msg.agent || resolveAgent(),
      tabId: 0,
    };
    chrome.runtime.sendMessage(sw).catch(() => { /* SW may not be up yet */ });
  }
});

// ── Service worker → content → inject-back ───────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  // Re-dispatch to inject.ts (which handles panel mounting).
  window.dispatchEvent(new CustomEvent('nexpath:sw-message', { detail: msg }));
});
