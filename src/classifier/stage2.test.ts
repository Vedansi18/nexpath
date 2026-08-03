import { describe, it, expect } from 'vitest';
import type { SessionState, AbsenceFlag } from './types.js';
import {
  buildSignalList,
  shouldFireStage2,
  STAGE2_CONTEXT_WINDOW,
  STAGE2_LLM_MIN_CONFIDENCE,
  STAGE2_MODEL,
  STAGE_LABEL,
  STAGE_FROM_LABEL,
} from './Stage2Trigger.js';
import type { Stage2TriggerResult } from './Stage2Trigger.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makePromptRecord(text: string, index: number) {
  return {
    index,
    text,
    capturedAt: Date.now(),
    classifiedStage: 'implementation' as const,
    confidence: 0.8,
  };
}

function makeState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    sessionId:              'test-session',
    projectRoot:            '/test/project',
    startedAt:              Date.now(),
    lastPromptAt:           Date.now(),
    currentStage:           'implementation',
    stageConfidence:        0.85,
    stageConfirmedAt:       5,
    promptsInCurrentStage:  20,
    promptCount:            20,
    promptHistory:          Array.from({ length: 15 }, (_, i) =>
      makePromptRecord(`implement the auth module step ${i + 1}`, i),
    ),
    signalCounters:              {},
    absenceFlags:                [],
    firedDecisionSessions:       [],
    profile:                     null,
    detectedLanguage:            undefined,
    consecutiveAcceptanceStreak: 0,
    ...overrides,
  };
}

// ── STAGE_LABEL / STAGE_FROM_LABEL ────────────────────────────────────────────

describe('STAGE_LABEL and STAGE_FROM_LABEL', () => {
  it('covers all 8 stages', () => {
    const stages = ['idea', 'prd', 'architecture', 'task_breakdown', 'implementation', 'review_testing', 'release', 'feedback_loop'];
    for (const s of stages) {
      expect(STAGE_LABEL).toHaveProperty(s);
    }
  });

  it('STAGE_FROM_LABEL reverses STAGE_LABEL correctly', () => {
    for (const [k, v] of Object.entries(STAGE_LABEL)) {
      expect(STAGE_FROM_LABEL[v]).toBe(k);
    }
  });

  it('STAGE2_MODEL is gpt-4o-mini', () => {
    expect(STAGE2_MODEL).toBe('gpt-4o-mini');
  });

  it('STAGE2_CONTEXT_WINDOW is 10', () => {
    expect(STAGE2_CONTEXT_WINDOW).toBe(10);
  });

  it('STAGE2_LLM_MIN_CONFIDENCE is 0.49', () => {
    expect(STAGE2_LLM_MIN_CONFIDENCE).toBe(0.49);
  });
});

// ── buildSignalList ───────────────────────────────────────────────────────────

describe('buildSignalList', () => {
  it('returns non-empty string for implementation stage', () => {
    const result = buildSignalList('implementation');
    expect(result.length).toBeGreaterThan(0);
  });

  it('includes signals expected in the given stage', () => {
    const result = buildSignalList('implementation');
    // test_creation is expected in 'implementation'
    expect(result).toContain('test_creation');
    expect(result).toContain('security_check');
  });

  it('excludes signals not expected in the stage', () => {
    // rollback_planning is expected in 'release' only
    const result = buildSignalList('implementation');
    expect(result).not.toContain('rollback_planning');
  });

  it('returns different signal sets for different stages', () => {
    const impl   = buildSignalList('implementation');
    const release = buildSignalList('release');
    expect(impl).not.toBe(release);
  });

  it('includes signal key and description on each line', () => {
    const result = buildSignalList('implementation');
    // Each line should be "key: description"
    const lines = result.split('\n').filter(Boolean);
    for (const line of lines) {
      expect(line).toContain(':');
    }
  });
});

// ── shouldFireStage2 ──────────────────────────────────────────────────────────

describe('shouldFireStage2', () => {
  it('returns stage_transition kind when stage changed', () => {
    const state = makeState({ currentStage: 'implementation' });
    const result = shouldFireStage2(state, 'architecture', []);
    expect(result).toEqual({ kind: 'stage_transition' });
  });

  it('returns null when stage is the same (no transition)', () => {
    const state = makeState({ currentStage: 'implementation' });
    const result = shouldFireStage2(state, 'implementation', []);
    expect(result).toBeNull();
  });

  it('returns null when prevStage is undefined (no prior stage)', () => {
    const state = makeState({ currentStage: 'implementation' });
    const result = shouldFireStage2(state, undefined, []);
    expect(result).toBeNull();
  });

  it('returns absence kind with qualifying flags when a new absence flag is raised', () => {
    const state = makeState({ currentStage: 'implementation' });
    const flag: AbsenceFlag = {
      signalKey:     'test_creation',
      stage:         'implementation',
      raisedAtIndex: 20,
      cooldownUntil: 50,
    };
    const result = shouldFireStage2(state, undefined, [flag]);
    expect(result).toEqual({ kind: 'absence', qualifyingFlags: [flag] });
  });

  it('returns absence kind with all qualifying flags when multiple absence flags raised', () => {
    const state = makeState({ currentStage: 'implementation' });
    const flags: AbsenceFlag[] = [
      { signalKey: 'test_creation', stage: 'implementation', raisedAtIndex: 20, cooldownUntil: 50 },
      { signalKey: 'security_check', stage: 'implementation', raisedAtIndex: 20, cooldownUntil: 50 },
    ];
    const result = shouldFireStage2(state, undefined, flags);
    expect(result).toEqual({ kind: 'absence', qualifyingFlags: flags });
  });

  it('returns absence kind with active flags when low confidence + active absence flags exist', () => {
    const activeFlag: AbsenceFlag = {
      signalKey:     'test_creation',
      stage:         'implementation',
      raisedAtIndex: 10,
      cooldownUntil: 40, // not expired — promptCount=20 < 40
    };
    const state = makeState({
      stageConfidence: 0.40, // < 0.50
      promptCount:     20,
      absenceFlags:    [activeFlag],
    });
    const result = shouldFireStage2(state, undefined, []);
    expect(result).toEqual({ kind: 'absence', qualifyingFlags: [activeFlag] });
  });

  it('returns all active flags when multiple active flags exist (condition 3)', () => {
    const flag1: AbsenceFlag = { signalKey: 'test_creation', stage: 'implementation', raisedAtIndex: 10, cooldownUntil: 40 };
    const flag2: AbsenceFlag = { signalKey: 'security_check', stage: 'implementation', raisedAtIndex: 12, cooldownUntil: 40 };
    const state = makeState({
      stageConfidence: 0.40,
      promptCount:     20,
      absenceFlags:    [flag1, flag2],
    });
    const result = shouldFireStage2(state, undefined, []) as Stage2TriggerResult & { kind: 'absence' };
    expect(result?.kind).toBe('absence');
    expect(result?.qualifyingFlags).toHaveLength(2);
    expect(result?.qualifyingFlags.map(f => f.signalKey)).toContain('test_creation');
    expect(result?.qualifyingFlags.map(f => f.signalKey)).toContain('security_check');
  });

  it('returns null when low confidence but no active absence flag', () => {
    const state = makeState({
      stageConfidence: 0.40,
      promptCount:     20,
      absenceFlags:    [], // no flags
    });
    const result = shouldFireStage2(state, undefined, []);
    expect(result).toBeNull();
  });

  it('returns null when low confidence + flag in cooldown (expired)', () => {
    const expiredFlag: AbsenceFlag = {
      signalKey:        'test_creation',
      stage:            'implementation',
      raisedAtIndex:    5,
      cooldownUntil:    15, // expired — promptCount=20 >= 15
    };
    const state = makeState({
      stageConfidence: 0.40,
      promptCount:     20,
      absenceFlags:    [expiredFlag],
    });
    const result = shouldFireStage2(state, undefined, []);
    expect(result).toBeNull();
  });

  it('returns null when low confidence + flag already dismissed', () => {
    const dismissedFlag: AbsenceFlag = {
      signalKey:        'test_creation',
      stage:            'implementation',
      raisedAtIndex:    5,
      dismissedAtIndex: 10, // dismissed
      cooldownUntil:    40,
    };
    const state = makeState({
      stageConfidence: 0.40,
      promptCount:     20,
      absenceFlags:    [dismissedFlag],
    });
    const result = shouldFireStage2(state, undefined, []);
    expect(result).toBeNull();
  });

  it('stage transition takes priority over absence flags', () => {
    const flag: AbsenceFlag = {
      signalKey: 'test_creation', stage: 'implementation', raisedAtIndex: 20, cooldownUntil: 50,
    };
    const state = makeState({ currentStage: 'review_testing' });
    const result = shouldFireStage2(state, 'implementation', [flag]);
    expect(result).toEqual({ kind: 'stage_transition' });
  });

  it('high confidence + no flags → null (no fire needed)', () => {
    const state = makeState({ stageConfidence: 0.90 });
    const result = shouldFireStage2(state, undefined, []);
    expect(result).toBeNull();
  });
});
