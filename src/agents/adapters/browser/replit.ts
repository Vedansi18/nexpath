import type { BrowserExtensionAdapter, InstallContext, InstallResult } from '../../types.js';

/**
 * Replit — BrowserExtensionAdapter metadata (B3).
 *
 * This object documents the capture contract that `src/ext-browser/content/agents/replit.ts`
 * implements against (origins, capture tiers) — it is the structural counterpart described in
 * the devplan's BrowserExtensionAdapter contract (§12).
 *
 * Deliberately NOT registered into the Node CLI's agent registry (../../registry.ts /
 * ../../index.ts): that registry drives `nexpath install`/`nexpath status`, which install
 * hooks/extensions onto the user's local machine. A browser-extension agent has no local
 * install step to drive from the CLI — the user installs the extension itself (Chrome Web
 * Store / unpacked), and capture happens entirely inside the browser sandbox. Wiring this into
 * the shared registry would change `nexpath status`/`install` output for something outside
 * B3's scope and with no CLI-side behaviour to actually perform — a decision, not an oversight.
 */
export const replitAdapter: BrowserExtensionAdapter = {
  id:       'replit',
  label:    'Replit',
  category: 'browser-extension',

  origins: ['https://*.replit.com/*'],

  // 'fetch' and 'websocket' confirmed non-viable for Replit — see docs/capture-recon/replit-recon.md.
  // 'dom-events' added 2026-07-04: the source-side composer capture channel (capture-phase
  // Enter/click reading the composer at submit, fb2014b) is the devplan's ladder tier 4 —
  // it became necessary when live testing proved rendered-message selectors don't hold for
  // live-typed messages. Both tiers run in parallel; mutation-observer stays listed first
  // as the primary (it also carries response-stop detection).
  capture: ['mutation-observer', 'dom-events'],

  contentScriptModule: 'content/agents/replit.js',

  // No meaningful Node-CLI-side detection/install exists for a browser-extension agent —
  // see file header. These exist only to satisfy the shared AgentAdapter interface.
  detect(): boolean {
    return false;
  },

  async install(_ctx: InstallContext): Promise<InstallResult> {
    return { status: 'skipped', notes: 'Replit is a browser-extension agent — install the nexpath browser extension instead of running `nexpath install`.' };
  },

  async uninstall(_ctx: InstallContext): Promise<void> {
    // No-op — nothing was installed by this adapter.
  },
};
