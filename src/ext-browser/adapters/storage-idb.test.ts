import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SessionState } from '../../core/classifier/types.js';

/**
 * IdbStorageAdapter tests — use a setter-based IDB mock so onsuccess fires
 * AFTER the adapter has a chance to set the handler (simulates real IDB timing).
 */

// ── Setter-based IDB request mock ─────────────────────────────────────────────

function makeRequest<T>(resultValue: T) {
  let _onsuccess: ((ev: unknown) => void) | null = null;
  const req = {
    get result() { return resultValue; },
    get onsuccess() { return _onsuccess; },
    set onsuccess(fn: ((ev: unknown) => void) | null) {
      _onsuccess = fn;
      if (fn) queueMicrotask(() => fn({ target: req }));
    },
    onerror: null,
  };
  return req;
}

function makeOpenRequest(db: unknown) {
  let _onsuccess: ((ev: unknown) => void) | null = null;
  const req = {
    result: db,
    get onsuccess() { return _onsuccess; },
    set onsuccess(fn: ((ev: unknown) => void) | null) {
      _onsuccess = fn;
      if (fn) queueMicrotask(() => fn({ target: req }));
    },
    onupgradeneeded: null,
    onerror: null,
  };
  return req;
}

// ── In-memory store ───────────────────────────────────────────────────────────

function makeMemoryDb() {
  const stores: Record<string, Record<string, unknown>> = {
    'nexpath-sessions': {},
    'nexpath-languages': {},
  };

  function makeObjectStore(storeName: string) {
    return {
      get(key: string) {
        return makeRequest(stores[storeName]?.[key]);
      },
      put(value: Record<string, unknown>) {
        const key = value['projectRoot'] as string;
        if (!stores[storeName]) stores[storeName] = {};
        stores[storeName][key] = value;
        return makeRequest(key);
      },
    };
  }

  return {
    objectStoreNames: { contains: () => true },
    transaction(_name: string) {
      return { objectStore: (n: string) => makeObjectStore(n) };
    },
    stores,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    sessionId: 'sess-1',
    projectRoot: '/project',
    startedAt: 1000,
    lastPromptAt: 1000,
    currentStage: 'prd',
    stageConfidence: 0.8,
    stageConfirmedAt: 0,
    promptsInCurrentStage: 0,
    promptCount: 0,
    promptHistory: [],
    signalCounters: {},
    absenceFlags: [],
    firedDecisionSessions: [],
    profile: null,
    detectedLanguage: undefined,
    lastInjectedPrompt: null,
    lastAdvisoryPromptIndex: -1,
    advisoryCount: 0,
    consecutiveAcceptanceStreak: 0,
    ...overrides,
  } as SessionState;
}

async function makeAdapter() {
  vi.resetModules();
  const { IdbStorageAdapter } = await import('./storage-idb.js');
  return new IdbStorageAdapter();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('IdbStorageAdapter', () => {
  let db: ReturnType<typeof makeMemoryDb>;

  beforeEach(() => {
    db = makeMemoryDb();
    vi.stubGlobal('indexedDB', {
      open: () => makeOpenRequest(db),
    });
  });

  it('loadSessionState returns null when store is empty', async () => {
    const adapter = await makeAdapter();
    const result = await adapter.loadSessionState('/project');
    expect(result).toBeNull();
  });

  it('loadSessionState returns null on malformed JSON', async () => {
    // Pre-seed the store with bad JSON
    db.stores['nexpath-sessions']['/project'] = { projectRoot: '/project', data: '{invalid' };

    const adapter = await makeAdapter();
    const result = await adapter.loadSessionState('/project');
    expect(result).toBeNull();
  });

  it('saveSessionState persists state as JSON', async () => {
    const adapter = await makeAdapter();
    const state = makeState({ projectRoot: '/proj', promptCount: 5 });
    await adapter.saveSessionState(state);

    const row = db.stores['nexpath-sessions']['/proj'] as { projectRoot: string; data: string };
    expect(row).toBeDefined();
    const parsed = JSON.parse(row.data) as SessionState;
    expect(parsed.promptCount).toBe(5);
  });

  it('loadSessionState returns parsed state after save', async () => {
    const adapter = await makeAdapter();
    const state = makeState({ projectRoot: '/proj', promptCount: 7 });
    await adapter.saveSessionState(state);
    const loaded = await adapter.loadSessionState('/proj');
    expect(loaded?.promptCount).toBe(7);
    expect(loaded?.projectRoot).toBe('/proj');
  });

  it('getProjectDetectedLanguage returns undefined when nothing stored', async () => {
    const adapter = await makeAdapter();
    const lang = await adapter.getProjectDetectedLanguage('/proj');
    expect(lang).toBeUndefined();
  });

  it('saveProjectDetectedLanguage and getProjectDetectedLanguage round-trip', async () => {
    const adapter = await makeAdapter();
    await adapter.saveProjectDetectedLanguage('/proj', 'fr');
    const lang = await adapter.getProjectDetectedLanguage('/proj');
    expect(lang).toBe('fr');
  });

  it('successive saves overwrite previous state', async () => {
    const adapter = await makeAdapter();
    await adapter.saveSessionState(makeState({ projectRoot: '/proj', promptCount: 1 }));
    await adapter.saveSessionState(makeState({ projectRoot: '/proj', promptCount: 9 }));
    const loaded = await adapter.loadSessionState('/proj');
    expect(loaded?.promptCount).toBe(9);
  });
});
