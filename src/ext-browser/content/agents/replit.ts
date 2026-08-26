import browser from 'webextension-polyfill';
import { createCaptureKit, setReplitSubmitInterceptor } from './capture-kit.js';
import { createReplitSubmitGate } from '../replit-submit-gate.js';
import { resolveSubmitFlow, submitFlowStorageKeys } from '../../adapters/submit-flow-config.js';
import { resolveProjectRootFromLocation } from './agent-hosts.js';
import { injectPromptText } from './replit-inject.js';

/**
 * Replit capture — B3. Thin agent config over the shared capture kit.
 *
 * Recon (internal recon) confirmed Replit's Agent chat runs
 * over a proprietary binary WebSocket (MessagePack) — not fetch, not a readable
 * WebSocket. Capture uses DOM observation against confirmed selectors instead of
 * the MAIN-world fetch/WebSocket wrapper (main-world-injector.ts still runs on
 * this page but never fires for Replit — its listener is reused via the kit
 * posting the same message shapes it already knows how to forward).
 *
 * Everything mechanism-shaped (dedup funnel, park-and-sweep, polling safety nets,
 * priming, the MV3 stale-re-injection guard) lives in capture-kit.ts — this file
 * holds only what is genuinely Replit-specific: selectors, their live-confirmed
 * evidence, and the text-extraction rules for Replit's DOM.
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

// Both composer-channel selectors are live-confirmed on real Replit: the composer
// selector is the exact selector inject-back successfully targets (replit-inject.ts —
// Replit's prompt input is CodeMirror 6, see recon §2.4), and the submit button's
// data-cy came from the user's own Elements-panel inspection (2026-07-02).
const COMPOSER_SELECTOR = '.cm-content[contenteditable="true"]';
const SUBMIT_BUTTON_SELECTOR = '[data-cy="ai-prompt-submit"]';

const CAPTURE_TIER = 'mutation-observer';

function extractPromptText(el: Element): string {
  const rendered = el.querySelector('.rendered-markdown');
  // A present-but-empty .rendered-markdown means a fill-in-progress shell — return ''
  // so the kit parks it for re-check rather than falling through to unrelated text
  // (timestamps, action labels) that happens to live elsewhere inside the element.
  if (rendered) return (rendered.textContent ?? '').trim();
  // No .rendered-markdown child at all: live-typed messages may render through a
  // different path than server-hydrated history (2026-07-03 — the second prompt of a
  // session was never captured even by the reconciliation sweep running for minutes,
  // proving the history-confirmed structure doesn't hold for every message render).
  return (el.textContent ?? '').trim();
}

function readComposerText(input: HTMLElement): string {
  // CodeMirror 6 renders one .cm-line per line; textContent alone would drop the
  // line breaks of a multi-line prompt.
  const lines = Array.from(input.querySelectorAll('.cm-line'), (l) => l.textContent ?? '');
  const text = (lines.length > 0 ? lines.join('\n') : (input.textContent ?? '')).trim();
  // An empty CodeMirror editor renders its placeholder ("Make, test, iterate…") as
  // real text inside the line — never capture that as a prompt.
  const placeholder = (input.querySelector('.cm-placeholder')?.textContent ?? '').trim();
  if (placeholder && text === placeholder) return '';
  return text;
}

const kit = createCaptureKit({
  agent: 'replit',
  captureTier: CAPTURE_TIER,
  bootstrapFlag: '__nexpathReplitBootstrapped',
  userMessageSelector: USER_MESSAGE_SELECTOR,
  extractPromptText,
  stopButtonSelector: STOP_BUTTON_SELECTOR,
  composer: {
    composerSelector: COMPOSER_SELECTOR,
    submitButtonSelector: SUBMIT_BUTTON_SELECTOR,
    readComposerText,
  },
  // Replit's transcript reliably shows "Worked for X seconds/minutes" the moment a
  // turn completes — confirmed by direct visual evidence across every live-test
  // screenshot (2026-07-03), then live-confirmed firing correctly. The exact
  // selector/data-cy for this element was never captured, so it's matched by text
  // pattern.
  completionLabel: {
    pattern: /\bWorked for\s+\d/,
    maxTextLength: 60,
    log: '[nexpath] response-stop detected ("Worked for" label appeared)',
  },
});

// ── Submit-time gate installation ────────────────────────────────────────────
//
// Installs the DOM gate that can cancel a composer submit, hold it, and then
// send either a replacement or the original. It is inert on this build: the gate
// ships with its readiness flag false (its re-issue path has not been proven on
// a live Replit project, and an unverified re-issue can lose a prompt), and it
// additionally refuses whenever the switch is disarmed. Installing it here
// rather than leaving it unreferenced means the flip to live is a one-line
// change to that flag, not new wiring — and it keeps the module in the bundle
// where its behaviour can be inspected.
// The switch is resolved HERE rather than read from the bridge module: each
// content-script entry point is bundled separately, so module-level state does
// not cross between them (this file's own note below explains the same hazard
// for capture). Resolving locally — once at load, then on every change — is
// self-contained and cheap. `armed` starts false, so an unresolved switch never
// intercepts.
let armed = false;
function trackSubmitFlow(): void {
  const apply = (): void => {
    void resolveSubmitFlow('replit')
      .then((r) => { armed = r.enabled; })
      .catch(() => { armed = false; });
  };
  apply();
  try {
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      const watched = new Set(submitFlowStorageKeys());
      if (Object.keys(changes).some((k) => watched.has(k))) apply();
    });
  } catch {
    /* no storage events — the load-time resolution still applies */
  }
}
trackSubmitFlow();

function sendToSw(msg: unknown): void {
  try {
    void browser.runtime.sendMessage(msg).catch(() => { /* SW asleep */ });
  } catch { /* context invalidated */ }
}

setReplitSubmitInterceptor((ev, prompt, input, composer) => {
  const gate = ensureSubmitGate(input, composer);
  return gate.maybeIntercept(ev, prompt);
});

let replitGate: ReturnType<typeof createReplitSubmitGate> | null = null;

function ensureSubmitGate(
  input: HTMLElement,
  composer: { readComposerText: (el: HTMLElement) => string },
): ReturnType<typeof createReplitSubmitGate> {
  if (replitGate) return replitGate;
  replitGate = createReplitSubmitGate({
    isArmed: () => armed,
    decide: async (ctx) => {
      const res = await browser.runtime.sendMessage({
        type: 'nexpath:submit-decision-request',
        site: 'replit',
        projectRoot: resolveProjectRootFromLocation(
          window.location.hostname, window.location.pathname, window.location.origin,
        ) ?? '',
        requestId: `${ctx.submitId}#${Date.now()}`,
        prompt: ctx.prompt,
        submitId: ctx.submitId,
      }) as { decision?: { kind?: string; replacement?: string } } | undefined;
      const d = res?.decision;
      if (d?.kind === 'block' && typeof d.replacement === 'string' && d.replacement.length > 0) {
        return { kind: 'block', replacement: d.replacement };
      }
      return { kind: 'allow' };
    },
    emit: (event, data) => {
      sendToSw({ type: 'nexpath:submit-flow-event', site: 'replit', event, data: data ?? {} });
    },
    readComposerText: () => composer.readComposerText(input),
    // injectViaSimulatedPaste already performs the send (and verifies the text
    // landed first), so delivering a replacement is one call.
    deliverReplacement: async (text) => {
      await injectPromptText(text);
      return true;
    },
    // Re-issuing means submitting what is ALREADY in the composer — we cancelled
    // the user's own submit, so the text is still there. Clicking Replit's real
    // send control is the closest thing to what the user did.
    reissueOriginal: async () => {
      const btn = document.querySelector<HTMLElement>(SUBMIT_BUTTON_SELECTOR);
      if (!btn) return false;
      btn.click();
      return true;
    },
  });
  return replitGate;
}

// Re-exported under the original names so tests (and any future callers) keep a
// stable, Replit-named surface; the implementations are the shared kit's.
export const observeUserMessages = kit.observeUserMessages;
export const observeComposerSubmit = kit.observeComposerSubmit;
export const observeSubmitButton = kit.observeStopButton;
export const observeWorkedForLabel = kit.observeCompletionLabel;
export const bootstrap = kit.bootstrap;
export const __resetResponseStopDedupForTests = kit.resetResponseStopDedupForTests;
export const __resetPromptCaptureStateForTests = kit.resetPromptCaptureStateForTests;

// Inject-back (injectPromptText) deliberately lives in ./replit-inject.ts, NOT here —
// see that file's header comment for why: this file auto-runs bootstrap() below at
// import time, and content/inject.ts also needs inject-back, but importing anything
// from THIS file into inject.ts would duplicate that auto-run into inject.js's own
// bundle (esbuild inlines a module's full top-level code, side effects included, into
// every entry point that imports from it) — silently doubling every capture.

// Import-time auto-bootstrap. Capture its teardown so a test that imports this module
// (which triggers the auto-run) can dispose the long-lived observers + 1.5s poll
// interval instead of leaking them past its jsdom-environment teardown. Production
// ignores it — the content script runs for the page's whole lifetime.
let autoBootstrapTeardown: (() => void) | undefined;
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { autoBootstrapTeardown = bootstrap(); });
} else {
  autoBootstrapTeardown = bootstrap();
}
export const __teardownAutoBootstrapForTests = (): void => autoBootstrapTeardown?.();
