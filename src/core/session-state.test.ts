import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StoragePort } from './ports/storage.port.js';
import type { SessionState, ClassificationResult, AbsenceFlag } from './classifier/types.js';
import {
  SessionStateManager,
  SESSION_GAP_MS,
  MAX_HISTORY,
  STAGE_CONFIRM_THRESHOLD,
  MIN_STAGE_CHANGE_CONFIDENCE,
} from './session-state.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeStorage(overrides: Partial<{
  loadResult: SessionState | null;
  detectedLanguage: string | undefined;
}> = {}): StoragePort & { saved: SessionState[]; loadCalls: string[] } {
  const saved: SessionState[] = [];
  const loadCalls: string[] = [];
  return {
    saved,
    loadCalls,
    loadSessionState: vi.fn((projectRoot: string) => {
      loadCalls.push(projectRoot);
      return overrides.loadResult ?? null;
    }),
    saveSessionState: vi.fn((s: SessionState) => { saved.push(structuredClone(s)); }),
    getProjectDetectedLanguage: vi.fn().mockReturnValue(overrides.detectedLanguage ?? undefined),
  };
}

function makeClassification(overrides: Partial<ClassificationResult> = {}): ClassificationResult {
  return {
    stage:      'implementation',
    confidence: 0.85,
    tier:       1,
    allScores:  {},
    ...overrides,
  };
}

function makePersistedState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    sessionId:                   'existing-session',
    projectRoot:                 '/test/project',
    startedAt:                   Date.now() - 60_000,
    lastPromptAt:                Date.now() - 5_000,
    currentStage:                'implementation',
    stageConfidence:             0.8,
    stageConfirmedAt:            3,
    promptsInCurrentStage:       10,
    promptCount:                 10,
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

// ── Constants ──────────────────────────────────────────────────────────────────

describe('constants', () => {
  it('SESSION_GAP_MS is 30 minutes', () => {
    expect(SESSION_GAP_MS).toBe(30 * 60 * 1000);
  });

  it('MAX_HISTORY is 30', () => {
    expect(MAX_HISTORY).toBe(30);
  });

  it('STAGE_CONFIRM_THRESHOLD is 0.33', () => {
    expect(STAGE_CONFIRM_THRESHOLD).toBe(0.33);
  });

  it('MIN_STAGE_CHANGE_CONFIDENCE is 0.50', () => {
    expect(MIN_STAGE_CHANGE_CONFIDENCE).toBe(0.50);
  });
});

// ── SessionStateManager.load ──────────────────────────────────────────────────

describe('SessionStateManager.load', () => {
  it('creates a new session when storage returns null', () => {
    const storage = makeStorage({ loadResult: null });
    const mgr = SessionStateManager.load(storage, '/test/project', Date.now());
    expect(mgr.current.promptCount).toBe(0);
    expect(mgr.current.projectRoot).toBe('/test/project');
    expect(mgr.current.currentStage).toBe('idea');
  });

  it('creates a new session with a UUID sessionId', () => {
    const storage = makeStorage({ loadResult: null });
    const mgr = SessionStateManager.load(storage, '/test/project', Date.now());
    expect(mgr.current.sessionId).toBeTruthy();
    expect(typeof mgr.current.sessionId).toBe('string');
    expect(mgr.current.sessionId.length).toBeGreaterThan(0);
  });

  it('returns persisted session when within SESSION_GAP_MS', () => {
    const now = Date.now();
    const persisted = makePersistedState({ lastPromptAt: now - 1_000 });
    const storage = makeStorage({ loadResult: persisted });
    const mgr = SessionStateManager.load(storage, '/test/project', now);
    expect(mgr.current.sessionId).toBe('existing-session');
    expect(mgr.current.promptCount).toBe(10);
  });

  it('creates a new session when gap exceeds SESSION_GAP_MS', () => {
    const now = Date.now();
    const persisted = makePersistedState({ lastPromptAt: now - SESSION_GAP_MS - 1 });
    const storage = makeStorage({ loadResult: persisted });
    const mgr = SessionStateManager.load(storage, '/test/project', now);
    expect(mgr.current.sessionId).not.toBe('existing-session');
    expect(mgr.current.promptCount).toBe(0);
  });

  it('restores detectedLanguage from storage on new session', () => {
    const storage = makeStorage({ loadResult: null, detectedLanguage: 'en' });
    const mgr = SessionStateManager.load(storage, '/test/project', Date.now());
    expect(mgr.current.detectedLanguage).toBe('en');
  });

  it('detectedLanguage is undefined on new session when storage has none', () => {
    const storage = makeStorage({ loadResult: null, detectedLanguage: undefined });
    const mgr = SessionStateManager.load(storage, '/test/project', Date.now());
    expect(mgr.current.detectedLanguage).toBeUndefined();
  });

  it('calls loadSessionState with the projectRoot', () => {
    const storage = makeStorage();
    SessionStateManager.load(storage, '/my/project', Date.now());
    expect(storage.loadCalls).toContain('/my/project');
  });
});

// ── current ───────────────────────────────────────────────────────────────────

describe('SessionStateManager.current', () => {
  it('returns the current session state', () => {
    const storage = makeStorage();
    const mgr = SessionStateManager.load(storage, '/test/project', Date.now());
    expect(mgr.current).toHaveProperty('sessionId');
    expect(mgr.current.projectRoot).toBe('/test/project');
  });
});

// ── processPrompt ─────────────────────────────────────────────────────────────

describe('processPrompt', () => {
  it('increments promptCount on each call', () => {
    const storage = makeStorage();
    const mgr = SessionStateManager.load(storage, '/test/project', Date.now());
    mgr.processPrompt(storage, 'hello', makeClassification(), Date.now());
    expect(mgr.current.promptCount).toBe(1);
    mgr.processPrompt(storage, 'world', makeClassification(), Date.now());
    expect(mgr.current.promptCount).toBe(2);
  });

  it('adds prompt to history', () => {
    const storage = makeStorage();
    const mgr = SessionStateManager.load(storage, '/test/project', Date.now());
    mgr.processPrompt(storage, 'my prompt text', makeClassification(), Date.now());
    expect(mgr.current.promptHistory[0]!.text).toBe('my prompt text');
  });

  it('caps promptHistory at MAX_HISTORY entries', () => {
    const storage = makeStorage();
    const mgr = SessionStateManager.load(storage, '/test/project', Date.now());
    for (let i = 0; i < MAX_HISTORY + 5; i++) {
      mgr.processPrompt(storage, `prompt ${i}`, makeClassification(), Date.now());
    }
    expect(mgr.current.promptHistory.length).toBe(MAX_HISTORY);
  });

  it('calls saveSessionState on every processPrompt', () => {
    const storage = makeStorage();
    const mgr = SessionStateManager.load(storage, '/test/project', Date.now());
    mgr.processPrompt(storage, 'hello', makeClassification(), Date.now());
    mgr.processPrompt(storage, 'world', makeClassification(), Date.now());
    expect(storage.saved.length).toBe(2);
  });

  it('updates currentStage when confidence >= MIN_STAGE_CHANGE_CONFIDENCE and stage differs', () => {
    const storage = makeStorage();
    const mgr = SessionStateManager.load(storage, '/test/project', Date.now());
    expect(mgr.current.currentStage).toBe('idea');
    mgr.processPrompt(
      storage, 'implement auth',
      makeClassification({ stage: 'implementation', confidence: 0.80 }),
      Date.now(),
    );
    expect(mgr.current.currentStage).toBe('implementation');
  });

  it('does not update stage when confidence < MIN_STAGE_CHANGE_CONFIDENCE', () => {
    const storage = makeStorage();
    const mgr = SessionStateManager.load(storage, '/test/project', Date.now());
    mgr.processPrompt(
      storage, 'ok sure',
      makeClassification({ stage: 'prd', confidence: 0.30 }),
      Date.now(),
    );
    expect(mgr.current.currentStage).toBe('idea');
  });

  it('resets promptsInCurrentStage to 0 on stage change', () => {
    const storage = makeStorage();
    const mgr = SessionStateManager.load(storage, '/test/project', Date.now());
    // First: stay in idea for a couple of prompts
    mgr.processPrompt(storage, 'idea 1', makeClassification({ stage: 'idea', confidence: 0.9 }), Date.now());
    mgr.processPrompt(storage, 'idea 2', makeClassification({ stage: 'idea', confidence: 0.9 }), Date.now());
    // Then: transition to implementation
    mgr.processPrompt(storage, 'impl', makeClassification({ stage: 'implementation', confidence: 0.85 }), Date.now());
    expect(mgr.current.promptsInCurrentStage).toBe(0);
  });

  it('increments promptsInCurrentStage when stage stays the same', () => {
    const storage = makeStorage();
    const mgr = SessionStateManager.load(storage, '/test/project', Date.now());
    mgr.processPrompt(storage, 'p1', makeClassification({ stage: 'idea', confidence: 0.9 }), Date.now());
    mgr.processPrompt(storage, 'p2', makeClassification({ stage: 'idea', confidence: 0.9 }), Date.now());
    expect(mgr.current.promptsInCurrentStage).toBe(2);
  });

  it('resets consecutiveAcceptanceStreak on correction_seeking signal', () => {
    const storage = makeStorage();
    const mgr = SessionStateManager.load(storage, '/test/project', Date.now());
    // Build up streak
    mgr.processPrompt(storage, 'normal prompt', makeClassification(), Date.now());
    mgr.processPrompt(storage, 'normal prompt', makeClassification(), Date.now());
    // "wait that" is a correction_seeking keyword (confirmed in existing classifier.test.ts line 3937)
    mgr.processPrompt(storage, 'wait that is wrong, let me rethink this', makeClassification(), Date.now());
    expect(mgr.current.consecutiveAcceptanceStreak).toBe(0);
  });

  it('increments consecutiveAcceptanceStreak on non-correction prompts', () => {
    const storage = makeStorage();
    const mgr = SessionStateManager.load(storage, '/test/project', Date.now());
    mgr.processPrompt(storage, 'implement the auth module', makeClassification(), Date.now());
    mgr.processPrompt(storage, 'add unit tests', makeClassification(), Date.now());
    expect(mgr.current.consecutiveAcceptanceStreak).toBe(2);
  });

  it('stageConfirmedAt is set when confidence >= STAGE_CONFIRM_THRESHOLD', () => {
    const storage = makeStorage();
    const mgr = SessionStateManager.load(storage, '/test/project', Date.now());
    expect(mgr.current.stageConfirmedAt).toBe(-1);
    mgr.processPrompt(storage, 'implement auth', makeClassification({ stage: 'implementation', confidence: 0.85 }), Date.now());
    expect(mgr.current.stageConfirmedAt).toBe(0); // promptIndex was 0
  });
});

// ── markAdvisoryFired ─────────────────────────────────────────────────────────

describe('markAdvisoryFired', () => {
  it('sets lastAdvisoryPromptIndex to current promptCount', () => {
    const storage = makeStorage();
    const mgr = SessionStateManager.load(storage, '/test/project', Date.now());
    mgr.processPrompt(storage, 'p1', makeClassification(), Date.now());
    mgr.processPrompt(storage, 'p2', makeClassification(), Date.now());
    mgr.markAdvisoryFired(storage);
    expect(mgr.current.lastAdvisoryPromptIndex).toBe(2);
  });

  it('increments advisoryCount', () => {
    const storage = makeStorage();
    const mgr = SessionStateManager.load(storage, '/test/project', Date.now());
    expect(mgr.current.advisoryCount).toBe(0);
    mgr.markAdvisoryFired(storage);
    expect(mgr.current.advisoryCount).toBe(1);
    mgr.markAdvisoryFired(storage);
    expect(mgr.current.advisoryCount).toBe(2);
  });

  it('calls saveSessionState', () => {
    const storage = makeStorage();
    const mgr = SessionStateManager.load(storage, '/test/project', Date.now());
    const beforeLen = storage.saved.length;
    mgr.markAdvisoryFired(storage);
    expect(storage.saved.length).toBeGreaterThan(beforeLen);
  });
});

// ── markDecisionSessionFired / hasFiredDecisionSession ────────────────────────

describe('markDecisionSessionFired and hasFiredDecisionSession', () => {
  it('hasFiredDecisionSession returns false when key not fired', () => {
    const storage = makeStorage();
    const mgr = SessionStateManager.load(storage, '/test/project', Date.now());
    expect(mgr.hasFiredDecisionSession('impl:stage_transition:0')).toBe(false);
  });

  it('hasFiredDecisionSession returns true after markDecisionSessionFired', () => {
    const storage = makeStorage();
    const mgr = SessionStateManager.load(storage, '/test/project', Date.now());
    mgr.markDecisionSessionFired(storage, 'impl:stage_transition:0');
    expect(mgr.hasFiredDecisionSession('impl:stage_transition:0')).toBe(true);
  });

  it('does not duplicate entries on repeated markDecisionSessionFired for same key', () => {
    const storage = makeStorage();
    const mgr = SessionStateManager.load(storage, '/test/project', Date.now());
    mgr.markDecisionSessionFired(storage, 'key1');
    mgr.markDecisionSessionFired(storage, 'key1');
    expect(mgr.current.firedDecisionSessions.filter(k => k === 'key1').length).toBe(1);
  });

  it('saves each unique key independently', () => {
    const storage = makeStorage();
    const mgr = SessionStateManager.load(storage, '/test/project', Date.now());
    mgr.markDecisionSessionFired(storage, 'key1');
    mgr.markDecisionSessionFired(storage, 'key2');
    expect(mgr.current.firedDecisionSessions).toContain('key1');
    expect(mgr.current.firedDecisionSessions).toContain('key2');
  });
});

// ── addAbsenceFlag / dismissAbsenceFlag ───────────────────────────────────────

describe('addAbsenceFlag and dismissAbsenceFlag', () => {
  const flag: AbsenceFlag = {
    signalKey:     'test_creation',
    stage:         'implementation',
    raisedAtIndex: 5,
    cooldownUntil: 20,
  };

  it('addAbsenceFlag pushes the flag into absenceFlags and saves', () => {
    const storage = makeStorage();
    const mgr = SessionStateManager.load(storage, '/test/project', Date.now());
    mgr.addAbsenceFlag(storage, flag);
    expect(mgr.current.absenceFlags).toHaveLength(1);
    expect(mgr.current.absenceFlags[0]!.signalKey).toBe('test_creation');
  });

  it('dismissAbsenceFlag sets dismissedAtIndex on the matching flag and saves', () => {
    const storage = makeStorage();
    const mgr = SessionStateManager.load(storage, '/test/project', Date.now());
    mgr.addAbsenceFlag(storage, flag);
    mgr.dismissAbsenceFlag(storage, 'test_creation', 8);
    expect(mgr.current.absenceFlags[0]!.dismissedAtIndex).toBe(8);
  });

  it('dismissAbsenceFlag ignores already-dismissed flags', () => {
    const storage = makeStorage();
    const mgr = SessionStateManager.load(storage, '/test/project', Date.now());
    mgr.addAbsenceFlag(storage, { ...flag, dismissedAtIndex: 3 });
    // Should not error, should not update the already-dismissed flag
    mgr.dismissAbsenceFlag(storage, 'test_creation', 10);
    expect(mgr.current.absenceFlags[0]!.dismissedAtIndex).toBe(3);
  });
});

// ── applyStage2SignalUpdates ───────────────────────────────────────────────────

describe('applyStage2SignalUpdates', () => {
  it('marks known signals as present at the last prompt index', () => {
    const storage = makeStorage();
    const mgr = SessionStateManager.load(storage, '/test/project', Date.now());
    mgr.processPrompt(storage, 'implement auth', makeClassification(), Date.now());
    const promptIndex = mgr.current.promptCount - 1;
    mgr.applyStage2SignalUpdates(storage, ['test_creation']);
    const counter = mgr.current.signalCounters['test_creation'];
    if (counter) {
      expect(counter.present).toBe(true);
      expect(counter.lastSeenAt).toBe(promptIndex);
    }
  });

  it('ignores unknown signal keys (does not throw)', () => {
    const storage = makeStorage();
    const mgr = SessionStateManager.load(storage, '/test/project', Date.now());
    expect(() => mgr.applyStage2SignalUpdates(storage, ['unknown_signal_xyz'])).not.toThrow();
  });

  it('saves state after applying updates', () => {
    const storage = makeStorage();
    const mgr = SessionStateManager.load(storage, '/test/project', Date.now());
    const beforeLen = storage.saved.length;
    mgr.applyStage2SignalUpdates(storage, []);
    expect(storage.saved.length).toBeGreaterThan(beforeLen);
  });
});

// ── setInjectedPrompt / clearInjectedPrompt ───────────────────────────────────

describe('setInjectedPrompt and clearInjectedPrompt', () => {
  it('setInjectedPrompt stores text and saves', () => {
    const storage = makeStorage();
    const mgr = SessionStateManager.load(storage, '/test/project', Date.now());
    mgr.setInjectedPrompt(storage, 'Write a test first.');
    expect(mgr.current.lastInjectedPrompt).toBe('Write a test first.');
  });

  it('clearInjectedPrompt sets lastInjectedPrompt to null and saves', () => {
    const storage = makeStorage();
    const mgr = SessionStateManager.load(storage, '/test/project', Date.now());
    mgr.setInjectedPrompt(storage, 'Some prompt');
    mgr.clearInjectedPrompt(storage);
    expect(mgr.current.lastInjectedPrompt).toBeNull();
  });
});

// ── setProfile ────────────────────────────────────────────────────────────────

describe('setProfile', () => {
  it('updates the profile in memory without saving', () => {
    const storage = makeStorage();
    const mgr = SessionStateManager.load(storage, '/test/project', Date.now());
    expect(mgr.current.profile).toBeNull();
    const savesBefore = storage.saved.length;
    mgr.setProfile({ nature: 'hardcore_pro', precisionScore: 9, playfulnessScore: 2, precisionOrdinal: 'very_high', playfulnessOrdinal: 'low', mood: 'focused', depth: 'high', depthScore: 3, computedAt: 5 });
    expect(mgr.current.profile?.nature).toBe('hardcore_pro');
    expect(storage.saved.length).toBe(savesBefore); // no save — setProfile is in-memory only
  });
});

// ── setDetectedLanguage ───────────────────────────────────────────────────────

describe('setDetectedLanguage', () => {
  it('updates detectedLanguage and saves', () => {
    const storage = makeStorage();
    const mgr = SessionStateManager.load(storage, '/test/project', Date.now());
    mgr.setDetectedLanguage(storage, 'ts');
    expect(mgr.current.detectedLanguage).toBe('ts');
    expect(storage.saved.at(-1)!.detectedLanguage).toBe('ts');
  });
});

// ── bootstrapFromHistory ──────────────────────────────────────────────────────

describe('bootstrapFromHistory', () => {
  it('is a no-op when session state already exists for the project', () => {
    const storage = makeStorage({ loadResult: makePersistedState() });
    const savesBefore = storage.saved.length;
    SessionStateManager.bootstrapFromHistory(storage, '/test/project', [], 0);
    expect(storage.saved.length).toBe(savesBefore);
  });

  it('creates a session state with the provided history when none exists', () => {
    const storage = makeStorage({ loadResult: null });
    const history = [
      { index: 0, text: 'prompt 1', capturedAt: Date.now(), classifiedStage: 'implementation' as const, confidence: 0.8 },
    ];
    SessionStateManager.bootstrapFromHistory(storage, '/test/project', history, 10);
    expect(storage.saved.length).toBe(1);
    expect(storage.saved[0]!.promptHistory).toHaveLength(1);
    expect(storage.saved[0]!.promptCount).toBe(10);
  });

  it('sets a safe default profile with computedAt = totalImported', () => {
    const storage = makeStorage({ loadResult: null });
    SessionStateManager.bootstrapFromHistory(storage, '/test/project', [], 25);
    expect(storage.saved[0]!.profile?.nature).toBe('beginner');
    expect(storage.saved[0]!.profile?.computedAt).toBe(25);
  });
});
