/**
 * KeyStorePort — abstracts API key retrieval.
 *
 * CLI implementation: ApiKeyAdapter (wraps ApiKeyResolver — env → .env → keychain).
 * Browser implementation: ChromeStorageKeyAdapter (reads chrome.storage.local).
 */
export interface KeyStorePort {
  getKey(name: string): Promise<string | null>;
}
