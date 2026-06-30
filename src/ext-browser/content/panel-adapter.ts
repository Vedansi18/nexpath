import type { UIPort, AdvisoryPayload, PanelEvent } from '../../core/ports/ui.port.js';
import { isShowAdvisoryMsg } from './ipc.js';
import type { ShowAdvisoryMsg } from './ipc.js';

/**
 * UIPort implementation for the browser extension.
 *
 * showAdvisory() sends the advisory to the content script on the active tab via
 * chrome.tabs.sendMessage, and waits for the user's panel-event reply.
 *
 * Runs in the SERVICE WORKER context.
 */
export class ContentScriptUIAdapter implements UIPort {
  constructor(private readonly tabId: number) {}

  showAdvisory(payload: AdvisoryPayload): Promise<PanelEvent> {
    return new Promise((resolve, reject) => {
      const msg: ShowAdvisoryMsg = { type: 'nexpath:show-advisory', payload };

      chrome.tabs.sendMessage(this.tabId, msg, (response: PanelEvent | undefined) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response) {
          // Tab closed or content script didn't respond — treat as dismiss.
          resolve({ type: 'dismiss', advisoryId: payload.advisoryId });
          return;
        }
        resolve(response);
      });
    });
  }
}
