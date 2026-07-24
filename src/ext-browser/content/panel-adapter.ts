import browser from 'webextension-polyfill';
import type { UIPort, AdvisoryPayload, PanelEvent } from '../../core/ports/ui.port.js';
import type { ShowAdvisoryMsg } from './ipc.js';

/**
 * UIPort implementation for the browser extension.
 *
 * showAdvisory() sends the advisory to the content script on the active tab via
 * browser.tabs.sendMessage (webextension-polyfill — Promise-based, no callback/
 * lastError pattern needed), and waits for the user's panel-event reply.
 *
 * Runs in the SERVICE WORKER context.
 */
export class ContentScriptUIAdapter implements UIPort {
  constructor(private readonly tabId: number) {}

  async showAdvisory(payload: AdvisoryPayload): Promise<PanelEvent> {
    const msg: ShowAdvisoryMsg = { type: 'nexpath:show-advisory', payload };

    // A connection error (no tab / no listening content script) rejects this
    // promise directly — propagates to the caller, matching prior lastError behaviour.
    const response = await browser.tabs.sendMessage(this.tabId, msg) as PanelEvent | undefined;

    if (!response) {
      // Tab closed or content script didn't respond — treat as dismiss.
      return { type: 'dismiss', advisoryId: payload.advisoryId };
    }
    return response;
  }
}
