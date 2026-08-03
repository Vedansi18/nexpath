import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SessionState } from '../../core/classifier/types.js';

vi.mock('../../store/db.js', () => ({
  saveStore: vi.fn(),
}));
vi.mock('../../store/projects.js', () => ({
  getProject: vi.fn(),
}));

import { saveStore } from '../../store/db.js';
import { getProject } from '../../store/projects.js';
import { SqlJsStorageAdapter } from './storage.adapter.js';
import type { Store } from '../../store/db.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    sessionId:                   'test-session-id',
    projectRoot:                 '/test/project',
    startedAt:                   0,
    lastPromptAt:                0,
    currentStage:                'implementation',
    stageConfidence:             0.8,
    stageConfirmedAt:            2,
    promptsInCurrentStage:       5,
    promptCount:                 5,
    promptHistory:               [],
    signalCounters:              {},
    absenceFlags:                [],
    firedDecisionSessions:       [],
    profile:                     null,
    detectedLanguage:            undefined,
    lastInjectedPrompt:          null,
    lastAdvisoryPromptIndex:     -1,
    advisoryCount:               0,
    consecutiveAcceptanceStreak: 0,
    ...overrides,
  };
}

function makeStore(execResult: unknown): Store {
  return {
    db: {
      exec: vi.fn().mockReturnValue(execResult),
      run:  vi.fn(),
    },
  } as unknown as Store;
}

// ── loadSessionState ──────────────────────────────────────────────────────────

describe('SqlJsStorageAdapter.loadSessionState', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns null when no row exists in the database', () => {
    const store = makeStore([]);
    const adapter = new SqlJsStorageAdapter(store);
    expect(adapter.loadSessionState('/test/project')).toBeNull();
  });

  it('returns null when result[0] has no values', () => {
    const store = makeStore([{ values: [] }]);
    const adapter = new SqlJsStorageAdapter(store);
    expect(adapter.loadSessionState('/test/project')).toBeNull();
  });

  it('parses and returns SessionState from stored JSON', () => {
    const state = makeState();
    const store = makeStore([{ values: [[JSON.stringify(state)]] }]);
    const adapter = new SqlJsStorageAdapter(store);
    const result = adapter.loadSessionState('/test/project');
    expect(result?.sessionId).toBe('test-session-id');
    expect(result?.projectRoot).toBe('/test/project');
    expect(result?.currentStage).toBe('implementation');
  });

  it('returns null when stored JSON is malformed', () => {
    const store = makeStore([{ values: [['invalid json {']] }]);
    const adapter = new SqlJsStorageAdapter(store);
    expect(adapter.loadSessionState('/test/project')).toBeNull();
  });

  it('calls db.exec with the correct SQL and projectRoot parameter', () => {
    const store = makeStore([]);
    const adapter = new SqlJsStorageAdapter(store);
    adapter.loadSessionState('/my/project');
    expect(store.db.exec).toHaveBeenCalledWith(
      expect.stringContaining('session_states'),
      ['/my/project'],
    );
  });
});

// ── saveSessionState ──────────────────────────────────────────────────────────

describe('SqlJsStorageAdapter.saveSessionState', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('calls db.run with the upsert SQL and correct values', () => {
    const store = makeStore([]);
    const adapter = new SqlJsStorageAdapter(store);
    const state = makeState();
    adapter.saveSessionState(state);
    expect(store.db.run).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO session_states'),
      expect.arrayContaining([state.projectRoot, state.sessionId, JSON.stringify(state)]),
    );
  });

  it('calls saveStore after writing to the database', () => {
    const store = makeStore([]);
    const adapter = new SqlJsStorageAdapter(store);
    adapter.saveSessionState(makeState());
    expect(saveStore).toHaveBeenCalledWith(store);
  });

  it('serializes the full state as JSON', () => {
    const store = makeStore([]);
    const adapter = new SqlJsStorageAdapter(store);
    const state = makeState({ promptCount: 42 });
    adapter.saveSessionState(state);
    const runCall = (store.db.run as ReturnType<typeof vi.fn>).mock.calls[0];
    const params = runCall[1] as unknown[];
    const storedJson = params.find((p) => typeof p === 'string' && p.includes('"promptCount"')) as string;
    expect(JSON.parse(storedJson).promptCount).toBe(42);
  });
});

// ── getProjectDetectedLanguage ────────────────────────────────────────────────

describe('SqlJsStorageAdapter.getProjectDetectedLanguage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns undefined when getProject returns null', () => {
    vi.mocked(getProject).mockReturnValue(null as never);
    const store = makeStore([]);
    const adapter = new SqlJsStorageAdapter(store);
    expect(adapter.getProjectDetectedLanguage('/test/project')).toBeUndefined();
  });

  it('returns undefined when project has no detectedLanguage', () => {
    vi.mocked(getProject).mockReturnValue({ detectedLanguage: undefined } as never);
    const store = makeStore([]);
    const adapter = new SqlJsStorageAdapter(store);
    expect(adapter.getProjectDetectedLanguage('/test/project')).toBeUndefined();
  });

  it('returns the detectedLanguage when project exists', () => {
    vi.mocked(getProject).mockReturnValue({ detectedLanguage: 'ts' } as never);
    const store = makeStore([]);
    const adapter = new SqlJsStorageAdapter(store);
    expect(adapter.getProjectDetectedLanguage('/test/project')).toBe('ts');
  });

  it('calls getProject with the store and projectRoot', () => {
    vi.mocked(getProject).mockReturnValue(null as never);
    const store = makeStore([]);
    const adapter = new SqlJsStorageAdapter(store);
    adapter.getProjectDetectedLanguage('/my/project');
    expect(getProject).toHaveBeenCalledWith(store, '/my/project');
  });
});
