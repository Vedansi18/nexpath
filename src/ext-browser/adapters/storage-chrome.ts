import browser from 'webextension-polyfill';
import type { KeyStorePort } from '../../core/ports/keystore.port.js';

/** KeyStorePort backed by storage.local (webextension-polyfill — Chrome + Firefox). */
export class ChromeStorageKeyAdapter implements KeyStorePort {
  async getKey(name: string): Promise<string | null> {
    const result = await browser.storage.local.get(name);
    const val = result[name];
    return typeof val === 'string' && val.length > 0 ? val : null;
  }

  // Beyond KeyStorePort (read-only by design): the SW also needs to persist small
  // records that must survive SW restarts AND page navigations (e.g. the cross-page
  // prompt-dedup record) — storage.local is the only store that does both without
  // an IDB schema migration.
  async setKey(name: string, value: string): Promise<void> {
    await browser.storage.local.set({ [name]: value });
  }
}
