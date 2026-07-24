import type { BrowserExtensionAdapter, InstallContext, InstallResult } from '../../types.js';

/**
 * Lovable — BrowserExtensionAdapter metadata (B5).
 *
 * Documents the capture contract `src/ext-browser/content/agents/lovable.ts`
 * implements against (origins, capture tiers) — the structural counterpart
 * described in the devplan's BrowserExtensionAdapter contract (§12).
 *
 * Deliberately NOT registered into the Node CLI's agent registry, for the same
 * reasons as the Replit/Bolt adapters (see ./replit.ts's header): a
 * browser-extension agent has no local install step for the CLI to drive.
 */
export const lovableAdapter: BrowserExtensionAdapter = {
  id:       'lovable',
  label:    'Lovable',
  category: 'browser-extension',

  origins: ['https://lovable.dev/*'],

  // Recon-confirmed 2026-07-06 (internal recon): 'fetch'
  // is the primary tier (page-context POST api.lovable.dev/projects/<id>/chat —
  // the devplan's WebSocket guess was wrong); 'dom-events' = the composer-read
  // channel; 'mutation-observer' = message-bubble observation + response-stop.
  capture: ['fetch', 'dom-events', 'mutation-observer'],

  contentScriptModule: 'content/agents/lovable.js',

  detect(): boolean {
    return false;
  },

  async install(_ctx: InstallContext): Promise<InstallResult> {
    return { status: 'skipped', notes: 'Lovable is a browser-extension agent — install the nexpath browser extension instead of running `nexpath install`.' };
  },

  async uninstall(_ctx: InstallContext): Promise<void> {
    // No-op — nothing was installed by this adapter.
  },
};
