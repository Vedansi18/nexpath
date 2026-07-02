import browser from 'webextension-polyfill';
import type { KeyStorePort } from '../../core/ports/keystore.port.js';

/** KeyStorePort backed by storage.local (webextension-polyfill — Chrome + Firefox). */
export class ChromeStorageKeyAdapter implements KeyStorePort {
  async getKey(name: string): Promise<string | null> {
    const result = await browser.storage.local.get(name);
    const val = result[name];
    return typeof val === 'string' && val.length > 0 ? val : null;
  }
}
