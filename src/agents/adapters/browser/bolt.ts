import type { BrowserExtensionAdapter, InstallContext, InstallResult } from '../../types.js';

/**
 * Bolt.new — BrowserExtensionAdapter metadata (B4).
 *
 * Documents the capture contract `src/ext-browser/content/agents/bolt.ts` implements
 * against (origins, capture tiers) — the structural counterpart described in the
 * devplan's BrowserExtensionAdapter contract (§12).
 *
 * Deliberately NOT registered into the Node CLI's agent registry, for the same
 * reasons as the Replit adapter (see ./replit.ts's header): a browser-extension
 * agent has no local install step for the CLI to drive.
 */
export const boltAdapter: BrowserExtensionAdapter = {
  id:       'bolt',
  label:    'Bolt.new',
  category: 'browser-extension',

  origins: ['https://bolt.new/*', 'https://*.stackblitz.com/*'],

  // Recon-confirmed 2026-07-04 (docs/capture-recon/bolt-recon.md §3): 'fetch' is
  // the primary tier (page-context POST /api/chat/v2 — the exact opposite of
  // Replit, where fetch/WS were non-viable); 'dom-events' = the composer-read
  // channel; 'mutation-observer' = message-bubble observation + response-stop.
  capture: ['fetch', 'dom-events', 'mutation-observer'],

  contentScriptModule: 'content/agents/bolt.js',

  detect(): boolean {
    return false;
  },

  async install(_ctx: InstallContext): Promise<InstallResult> {
    return { status: 'skipped', notes: 'Bolt.new is a browser-extension agent — install the nexpath browser extension instead of running `nexpath install`.' };
  },

  async uninstall(_ctx: InstallContext): Promise<void> {
    // No-op — nothing was installed by this adapter.
  },
};
