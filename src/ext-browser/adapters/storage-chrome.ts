import type { KeyStorePort } from '../../core/ports/keystore.port.js';

/** KeyStorePort backed by chrome.storage.local (survives SW termination). */
export class ChromeStorageKeyAdapter implements KeyStorePort {
  async getKey(name: string): Promise<string | null> {
    const result = await chrome.storage.local.get(name);
    const val = result[name];
    return typeof val === 'string' && val.length > 0 ? val : null;
  }
}
