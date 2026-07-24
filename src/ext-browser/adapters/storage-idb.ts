import type { SessionState } from '../../core/classifier/types.js';

const DB_NAME = 'nexpath-db';
const DB_VERSION = 1;
const STORE_SESSIONS = 'nexpath-sessions';
const STORE_LANGUAGES = 'nexpath-languages';

/** Opens (or upgrades) the nexpath IndexedDB and returns the IDBDatabase. */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = (ev.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
        db.createObjectStore(STORE_SESSIONS, { keyPath: 'projectRoot' });
      }
      if (!db.objectStoreNames.contains(STORE_LANGUAGES)) {
        db.createObjectStore(STORE_LANGUAGES, { keyPath: 'projectRoot' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet<T>(db: IDBDatabase, storeName: string, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, storeName: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** Async IDB adapter — used by the SW to load/persist session state. */
export class IdbStorageAdapter {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private getDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = openDb();
    }
    return this.dbPromise;
  }

  async loadSessionState(projectRoot: string): Promise<SessionState | null> {
    const db = await this.getDb();
    const row = await idbGet<{ projectRoot: string; data: string }>(db, STORE_SESSIONS, projectRoot);
    if (!row) return null;
    try {
      return JSON.parse(row.data) as SessionState;
    } catch {
      return null;
    }
  }

  async saveSessionState(state: SessionState): Promise<void> {
    const db = await this.getDb();
    await idbPut(db, STORE_SESSIONS, { projectRoot: state.projectRoot, data: JSON.stringify(state) });
  }

  async getProjectDetectedLanguage(projectRoot: string): Promise<string | undefined> {
    const db = await this.getDb();
    const row = await idbGet<{ projectRoot: string; language: string }>(db, STORE_LANGUAGES, projectRoot);
    return row?.language;
  }

  async saveProjectDetectedLanguage(projectRoot: string, language: string): Promise<void> {
    const db = await this.getDb();
    await idbPut(db, STORE_LANGUAGES, { projectRoot, language });
  }
}
