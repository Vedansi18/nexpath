import { describe, it, expect } from 'vitest';
import { makeMemoryStoragePort } from './memory-storage.js';
import type { SessionState } from '../../core/classifier/types.js';

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

describe('makeMemoryStoragePort', () => {
  it('loadSessionState returns preloaded state for matching projectRoot', () => {
    const state = makeState({ projectRoot: '/project' });
    const { port } = makeMemoryStoragePort(state);
    expect(port.loadSessionState('/project')).toEqual(state);
  });

  it('loadSessionState returns null for different projectRoot', () => {
    const state = makeState({ projectRoot: '/project' });
    const { port } = makeMemoryStoragePort(state);
    expect(port.loadSessionState('/other')).toBeNull();
  });

  it('loadSessionState returns null when no state preloaded', () => {
    const { port } = makeMemoryStoragePort(null);
    expect(port.loadSessionState('/project')).toBeNull();
  });

  it('saveSessionState updates current state', () => {
    const { port, getLatestState } = makeMemoryStoragePort(null);
    const state = makeState({ projectRoot: '/proj' });
    port.saveSessionState(state);
    expect(getLatestState()).toEqual(state);
  });

  it('loadSessionState returns saved state after save', () => {
    const { port } = makeMemoryStoragePort(null);
    const state = makeState({ projectRoot: '/proj' });
    port.saveSessionState(state);
    expect(port.loadSessionState('/proj')).toEqual(state);
  });

  it('getLatestState returns preloaded state initially', () => {
    const state = makeState({ projectRoot: '/project' });
    const { getLatestState } = makeMemoryStoragePort(state);
    expect(getLatestState()).toEqual(state);
  });

  it('getLatestState returns null when preloaded with null', () => {
    const { getLatestState } = makeMemoryStoragePort(null);
    expect(getLatestState()).toBeNull();
  });

  it('getProjectDetectedLanguage returns preloaded language', () => {
    const state = makeState({ projectRoot: '/proj' });
    const { port } = makeMemoryStoragePort(state, 'fr');
    expect(port.getProjectDetectedLanguage('/proj')).toBe('fr');
  });

  it('getProjectDetectedLanguage returns undefined when no language preloaded', () => {
    const state = makeState({ projectRoot: '/proj' });
    const { port } = makeMemoryStoragePort(state);
    expect(port.getProjectDetectedLanguage('/proj')).toBeUndefined();
  });

  it('getProjectDetectedLanguage returns undefined for different projectRoot', () => {
    const state = makeState({ projectRoot: '/proj' });
    const { port } = makeMemoryStoragePort(state, 'en');
    expect(port.getProjectDetectedLanguage('/other')).toBeUndefined();
  });

  it('successive saves update getLatestState each time', () => {
    const { port, getLatestState } = makeMemoryStoragePort(null);
    const s1 = makeState({ projectRoot: '/proj', promptCount: 1 });
    const s2 = makeState({ projectRoot: '/proj', promptCount: 2 });
    port.saveSessionState(s1);
    expect(getLatestState()?.promptCount).toBe(1);
    port.saveSessionState(s2);
    expect(getLatestState()?.promptCount).toBe(2);
  });
});
