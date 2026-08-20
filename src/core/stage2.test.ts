import { describe, it, expect, vi } from 'vitest';
import type { LLMPort } from './ports/llm.port.js';
import type { LogPort } from './ports/log.port.js';
import type { SessionState, AbsenceFlag } from './classifier/types.js';
import {
  runStage2,
  shouldFireStage2,
  buildStage2Prompt,
  buildSignalList,
  parseStage2Response,
  STAGE2_MODEL,
  STAGE2_CONTEXT_WINDOW,
  STAGE2_LLM_MIN_CONFIDENCE,
  STAGE_LABEL,
  STAGE_FROM_LABEL,
} from './stage2.js';
import type { Stage2Input, Stage2TriggerResult } from './stage2.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makePromptRecord(text: string, index: number) {
  return { index, text, capturedAt: Date.now(), classifiedStage: 'implementation' as const, confidence: 0.8 };
}

function makeState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    sessionId:                    'test-session',
    projectRoot:                  '/test/project',
    startedAt:                    Date.now(),
    lastPromptAt:                 Date.now(),
    currentStage:                 'implementation',
    stageConfidence:              0.85,
    stageConfirmedAt:             5,
    promptsInCurrentStage:        20,
    promptCount:                  20,
    promptHistory:                Array.from({ length: 15 }, (_, i) => makePromptRecord(`impl step ${i + 1}`, i)),
    signalCounters:               {},
    absenceFlags:                 [],
    firedDecisionSessions:        [],
    profile:                      null,
    detectedLanguage:             undefined,
    consecutiveAcceptanceStreak:  0,
    ...overrides,
  };
}

function makeInput(overrides: Partial<Stage2Input> = {}): Stage2Input {
  return {
    state:         makeState(),
    detectedStage: 'implementation',
    confidence:    0.85,
    flagType:      'stage_transition',
    ...overrides,
  };
}

const VALID_LLM_JSON = {
  stage:                 'Implementation',
  stage_confidence:      0.88,
  signals_present:       ['test_creation'],
  signals_absent:        ['security_check'],
  fire_decision_session: true,
  selected_signal_key:   'test_creation',
  reason:                'Developer entered implementation without testing signals.',
};

function makeLLM(content: string): LLMPort {
  return { chat: vi.fn().mockResolvedValue(content) };
}

function makeErrorLLM(): LLMPort {
  return { chat: vi.fn().mockRejectedValue(new Error('network timeout')) };
}

// ── Constants ─────────────────────────────────────────────────────────────────

describe('stage2 constants', () => {
  it('STAGE2_MODEL is gpt-4o-mini', () => {
    expect(STAGE2_MODEL).toBe('gpt-4o-mini');
  });

  it('STAGE2_CONTEXT_WINDOW is 10', () => {
    expect(STAGE2_CONTEXT_WINDOW).toBe(10);
  });

  it('STAGE2_LLM_MIN_CONFIDENCE is 0.49', () => {
    expect(STAGE2_LLM_MIN_CONFIDENCE).toBe(0.49);
  });

  it('STAGE_LABEL covers all 8 stages', () => {
    const stages = ['idea', 'prd', 'architecture', 'task_breakdown', 'implementation', 'review_testing', 'release', 'feedback_loop'];
    for (const s of stages) expect(STAGE_LABEL).toHaveProperty(s);
  });

  it('STAGE_FROM_LABEL reverses STAGE_LABEL correctly', () => {
    for (const [k, v] of Object.entries(STAGE_LABEL)) {
      expect(STAGE_FROM_LABEL[v]).toBe(k);
    }
  });
});

// ── buildSignalList ───────────────────────────────────────────────────────────

describe('buildSignalList', () => {
  it('returns a non-empty string for implementation stage', () => {
    expect(buildSignalList('implementation').length).toBeGreaterThan(0);
  });

  it('includes signals expected in the implementation stage', () => {
    const result = buildSignalList('implementation');
    expect(result).toContain('test_creation');
    expect(result).toContain('security_check');
  });

  it('excludes signals only expected in other stages', () => {
    expect(buildSignalList('implementation')).not.toContain('rollback_planning');
  });
});

// ── shouldFireStage2 ──────────────────────────────────────────────────────────

describe('shouldFireStage2', () => {
  it('returns stage_transition when stage changed', () => {
    const state = makeState({ currentStage: 'implementation' });
    expect(shouldFireStage2(state, 'architecture', [])).toEqual({ kind: 'stage_transition' });
  });

  it('returns null when stage is the same', () => {
    const state = makeState({ currentStage: 'implementation' });
    expect(shouldFireStage2(state, 'implementation', [])).toBeNull();
  });

  it('returns null when prevStage is undefined', () => {
    const state = makeState({ currentStage: 'implementation' });
    expect(shouldFireStage2(state, undefined, [])).toBeNull();
  });

  it('returns absence kind with qualifying flags when new absence flags exist', () => {
    const flag: AbsenceFlag = { signalKey: 'test_creation', stage: 'implementation', raisedAtIndex: 20, cooldownUntil: 50 };
    const state = makeState({ currentStage: 'implementation' });
    const result = shouldFireStage2(state, undefined, [flag]);
    expect(result).toEqual({ kind: 'absence', qualifyingFlags: [flag] });
  });

  it('returns absence kind for low-confidence + active absence flags', () => {
    const activeFlag: AbsenceFlag = { signalKey: 'test_creation', stage: 'implementation', raisedAtIndex: 10, cooldownUntil: 40 };
    const state = makeState({ stageConfidence: 0.40, promptCount: 20, absenceFlags: [activeFlag] });
    const result = shouldFireStage2(state, undefined, []) as Stage2TriggerResult & { kind: 'absence' };
    expect(result?.kind).toBe('absence');
    expect(result?.qualifyingFlags).toHaveLength(1);
  });

  it('returns null when low confidence but no active absence flags', () => {
    const state = makeState({ stageConfidence: 0.40, promptCount: 20, absenceFlags: [] });
    expect(shouldFireStage2(state, undefined, [])).toBeNull();
  });

  it('stage transition takes priority over absence flags', () => {
    const flag: AbsenceFlag = { signalKey: 'test_creation', stage: 'implementation', raisedAtIndex: 20, cooldownUntil: 50 };
    const state = makeState({ currentStage: 'review_testing' });
    expect(shouldFireStage2(state, 'implementation', [flag])).toEqual({ kind: 'stage_transition' });
  });
});

// ── parseStage2Response ───────────────────────────────────────────────────────

describe('parseStage2Response', () => {
  it('parses a valid JSON response correctly', () => {
    const result = parseStage2Response(JSON.stringify(VALID_LLM_JSON));
    expect(result.stage).toBe('implementation');
    expect(result.stage_confidence).toBe(0.88);
    expect(result.fire_decision_session).toBe(true);
    expect(result.selected_signal_key).toBe('test_creation');
  });

  it('strips markdown fencing before parsing', () => {
    const fenced = '```json\n' + JSON.stringify(VALID_LLM_JSON) + '\n```';
    expect(parseStage2Response(fenced).stage).toBe('implementation');
  });

  it('overrides fire_decision_session to false when stage_confidence < STAGE2_LLM_MIN_CONFIDENCE', () => {
    const low = { ...VALID_LLM_JSON, stage_confidence: 0.45, fire_decision_session: true };
    expect(parseStage2Response(JSON.stringify(low)).fire_decision_session).toBe(false);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseStage2Response('not json')).toThrow('Stage 2: invalid JSON');
  });

  it('throws when stage field is missing', () => {
    const bad = { ...VALID_LLM_JSON, stage: undefined };
    expect(() => parseStage2Response(JSON.stringify(bad))).toThrow('"stage"');
  });

  it('throws on unknown stage label', () => {
    const bad = { ...VALID_LLM_JSON, stage: 'UnknownStage' };
    expect(() => parseStage2Response(JSON.stringify(bad))).toThrow('unknown stage label');
  });

  it('defaults selected_signal_key to empty string when absent', () => {
    const { selected_signal_key: _sk, ...without } = VALID_LLM_JSON;
    expect(parseStage2Response(JSON.stringify(without)).selected_signal_key).toBe('');
  });

  it('parses all 8 stage labels', () => {
    const stageTests: [string, string][] = [
      ['Idea', 'idea'], ['PRD/Spec', 'prd'], ['Architecture', 'architecture'],
      ['Task Breakdown', 'task_breakdown'], ['Implementation', 'implementation'],
      ['Review/Testing', 'review_testing'], ['Release', 'release'], ['Feedback Loop', 'feedback_loop'],
    ];
    for (const [label, expected] of stageTests) {
      expect(parseStage2Response(JSON.stringify({ ...VALID_LLM_JSON, stage: label })).stage).toBe(expected);
    }
  });
});

// ── runStage2 (LLMPort API) ───────────────────────────────────────────────────

describe('runStage2', () => {
  it('calls llm.chat and returns parsed Stage2Output', async () => {
    const llm = makeLLM(JSON.stringify(VALID_LLM_JSON));
    const result = await runStage2(makeInput(), llm);
    expect(result.stage).toBe('implementation');
    expect(result.fire_decision_session).toBe(true);
    expect(llm.chat).toHaveBeenCalledOnce();
  });

  it('passes the correct model to llm.chat', async () => {
    const llm = makeLLM(JSON.stringify(VALID_LLM_JSON));
    await runStage2(makeInput(), llm);
    const call = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.model).toBe(STAGE2_MODEL);
  });

  it('passes temperature 0 to llm.chat', async () => {
    const llm = makeLLM(JSON.stringify(VALID_LLM_JSON));
    await runStage2(makeInput(), llm);
    const call = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.temperature).toBe(0);
  });

  it('passes timeoutMs to llm.chat', async () => {
    const llm = makeLLM(JSON.stringify(VALID_LLM_JSON));
    await runStage2(makeInput(), llm);
    const call = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(typeof call.timeoutMs).toBe('number');
  });

  it('throws when LLM returns invalid JSON', async () => {
    const llm = makeLLM('not json');
    await expect(runStage2(makeInput(), llm)).rejects.toThrow('Stage 2: invalid JSON');
  });

  it('propagates API errors', async () => {
    await expect(runStage2(makeInput(), makeErrorLLM())).rejects.toThrow('network timeout');
  });

  it('calls log.debug with stage2_raw when log is provided', async () => {
    const llm = makeLLM(JSON.stringify(VALID_LLM_JSON));
    const log: LogPort = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
    await runStage2(makeInput(), llm, log);
    expect(log.debug).toHaveBeenCalledWith('stage2_raw', expect.any(Object));
  });

  it('falls back selected_signal_key to first qualifying flag when LLM returns wrong key', async () => {
    const flag: AbsenceFlag = { signalKey: 'test_creation', stage: 'implementation', raisedAtIndex: 20, cooldownUntil: 50 };
    const resp = { ...VALID_LLM_JSON, selected_signal_key: 'unknown_signal' };
    const llm = makeLLM(JSON.stringify(resp));
    const input = makeInput({ flagType: 'absence', qualifyingFlags: [flag] });
    const result = await runStage2(input, llm);
    expect(result.selected_signal_key).toBe('test_creation');
  });

  it('keeps valid selected_signal_key when it is in qualifying flags', async () => {
    const flag: AbsenceFlag = { signalKey: 'test_creation', stage: 'implementation', raisedAtIndex: 20, cooldownUntil: 50 };
    const resp = { ...VALID_LLM_JSON, selected_signal_key: 'test_creation' };
    const llm = makeLLM(JSON.stringify(resp));
    const result = await runStage2(makeInput({ flagType: 'absence', qualifyingFlags: [flag] }), llm);
    expect(result.selected_signal_key).toBe('test_creation');
  });

  it('respects stage2Config.minConfidence override', async () => {
    const low = { ...VALID_LLM_JSON, stage_confidence: 0.55, fire_decision_session: true };
    const llm = makeLLM(JSON.stringify(low));
    const result = await runStage2(makeInput(), llm, undefined, { minConfidence: 0.60 });
    expect(result.fire_decision_session).toBe(false); // 0.55 < 0.60 → overridden
  });
});
