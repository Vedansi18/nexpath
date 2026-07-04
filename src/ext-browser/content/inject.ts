import { isShowAdvisoryMsg } from './ipc.js';
import { mountStubPanel } from '../ui/stub-panel.js';
import type { PanelEvent } from '../../core/ports/ui.port.js';
// Imports from the *-inject.ts modules, NOT the capture entries (replit.ts /
// bolt.ts) — those auto-run their capture bootstrap at import time, and esbuild
// would inline that into this bundle too, duplicating every observer (confirmed
// bug, fixed 2026-07-02 — see replit-inject.ts's header comment).
import { injectPromptText as injectPromptTextReplit } from './agents/replit-inject.js';
import { injectPromptText as injectPromptTextBolt } from './agents/bolt-inject.js';
import { clipboardFallback } from './agents/inject-kit.js';
import { resolveAgentFromHostname } from './agents/agent-hosts.js';

// Per-agent inject-back dispatch (B4 — the per-agent split B3's comment planned).
// A host with no injector yet (lovable until B5, unknown hosts) degrades to the
// clipboard fallback rather than silently doing nothing or using the wrong
// agent's editor mechanics.
const INJECTORS: Record<string, (text: string) => Promise<void>> = {
  replit: injectPromptTextReplit,
  bolt: injectPromptTextBolt,
};

function injectPromptText(text: string): Promise<void> {
  const injector = INJECTORS[resolveAgentFromHostname(window.location.hostname)];
  return injector ? injector(text) : clipboardFallback(text);
}

declare global {
  interface Window {
    __nexpathInjectBootstrapped?: boolean;
  }
}

const SUPPORTED_SCHEMA_VERSION = 1;

let panelRoot: HTMLDivElement | null = null;

function removePanel(): void {
  panelRoot?.remove();
  panelRoot = null;
}

function setupListener(): void {
  window.addEventListener('nexpath:sw-message', (ev) => {
    const msg = (ev as CustomEvent<unknown>).detail;
    if (!isShowAdvisoryMsg(msg)) return;

    // Guard against schema mismatches — log and bail rather than crash.
    if (msg.payload.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
      console.warn(
        `[nexpath] Advisory schemaVersion mismatch: got ${msg.payload.schemaVersion}, expected ${SUPPORTED_SCHEMA_VERSION}. Ignoring.`,
      );
      return;
    }

    removePanel();

    panelRoot = document.createElement('div');
    panelRoot.id = 'nexpath-panel-root';
    document.body.appendChild(panelRoot);

    const payload = msg.payload;

    // mountStubPanel returns the closed ShadowRoot reference (root.shadowRoot is null for closed).
    mountStubPanel(panelRoot, payload, (event) => {
      // Report the real outcome back to main-world-injector.ts, which is holding the
      // SW's showAdvisory() reply open waiting for this — without it, every advisory
      // resolves as a synthetic 'dismiss' on the SW side regardless of what the user
      // actually clicked (see main-world-injector.ts's onMessage listener).
      let panelEvent: PanelEvent;
      if (event.type === 'select') {
        const option = payload.options[event.optionIndex];
        panelEvent = { type: 'select', advisoryId: payload.advisoryId, selectedOptionId: option?.id ?? '' };
        injectPromptText(event.text).catch(() => { /* fallback-to-clipboard already handles failure internally */ });
      } else {
        panelEvent = { type: 'dismiss', advisoryId: payload.advisoryId };
      }
      window.dispatchEvent(new CustomEvent('nexpath:panel-event', { detail: panelEvent }));
      removePanel();
    });
  });
}

// Idempotent-injection guard — see main-world-injector.ts / replit.ts for the full
// explanation (stale content-script instances from a prior extension reload can stay
// alive in an already-open tab; without this, 2+ copies of this listener would each
// independently mount a panel for the same advisory).
if (window.__nexpathInjectBootstrapped) {
  console.log('[nexpath] inject: skipped, already bootstrapped in this page (stale re-injection guard)');
} else {
  window.__nexpathInjectBootstrapped = true;
  setupListener();
}
