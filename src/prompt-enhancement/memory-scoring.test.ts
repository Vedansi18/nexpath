import { describe, expect, it } from 'vitest';
import type { PromptEnhancementMemoryRow } from '../store/prompt-enhancement.js';
import { scorePromptEnhancementMemoryCandidates } from './memory-scoring.js';

function row(overrides: Partial<PromptEnhancementMemoryRow> & { signalKey: string }): PromptEnhancementMemoryRow {
  return {
    projectRoot: '/tmp/project',
    schemaVersion: 1,
    evidenceCount: 3,
    positiveCount: 0,
    negativeCount: 0,
    currentEvidenceState: 'historical_candidate',
    confidenceBand: 'medium',
    sourceStrength: 'moderate',
    protectionState: 'none',
    fatigueState: 'none',
    suppressionState: 'none',
    lastUsedAt: null,
    lastEvidenceAt: null,
    decayAfter: null,
    status: 'qualified',
    reasonCodes: [],
    provenance: { sourceIds: [], sectionIds: [], memoryEvidenceOnly: true, rawTextStored: false },
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('scorePromptEnhancementMemoryCandidates (E2 / 2.4)', () => {
  it('keeps a normal historical candidate as eligible', () => {
    const result = scorePromptEnhancementMemoryCandidates([row({ signalKey: 's1' })]);
    expect(result.eligible.map((c) => c.signalKey)).toEqual(['s1']);
    expect(result.suppressed).toEqual([]);
    expect(result.eligible[0].factPriority).toBe('normal');
    expect(result.eligible[0].factEvidenceState).toBe('partial');
  });

  it('suppresses a fatigued signal (do not re-surface an over-shown signal)', () => {
    const result = scorePromptEnhancementMemoryCandidates([row({ signalKey: 's1', fatigueState: 'fatigued' })]);
    expect(result.eligible).toEqual([]);
    expect(result.suppressed).toEqual([{ signalKey: 's1', reasonCode: 'memory_fatigued' }]);
  });

  it('suppresses a scoped-suppressed signal (do not re-surface a repeatedly-edited-out signal)', () => {
    const result = scorePromptEnhancementMemoryCandidates([row({ signalKey: 's1', suppressionState: 'suppressed_scoped' })]);
    expect(result.eligible).toEqual([]);
    expect(result.suppressed).toEqual([{ signalKey: 's1', reasonCode: 'memory_suppressed_scoped' }]);
  });

  it('safety-protected memory survives fatigue AND suppression, as required_survivor', () => {
    const result = scorePromptEnhancementMemoryCandidates([
      row({ signalKey: 's1', protectionState: 'safety_protected', fatigueState: 'fatigued', suppressionState: 'suppressed_scoped' }),
    ]);
    expect(result.suppressed).toEqual([]);
    expect(result.eligible).toHaveLength(1);
    expect(result.eligible[0].safetyProtected).toBe(true);
    expect(result.eligible[0].factPriority).toBe('required_survivor');
  });

  it('mandatory- and high-risk-protected also survive and anchor as required_survivor', () => {
    const result = scorePromptEnhancementMemoryCandidates([
      row({ signalKey: 'm', protectionState: 'mandatory_protected', fatigueState: 'fatigued' }),
      row({ signalKey: 'h', protectionState: 'high_risk_protected', suppressionState: 'suppressed_scoped' }),
    ]);
    expect(result.eligible.map((c) => c.factPriority)).toEqual(['required_survivor', 'required_survivor']);
  });

  it('a live-current high-confidence candidate scores high', () => {
    const result = scorePromptEnhancementMemoryCandidates([
      row({ signalKey: 's1', currentEvidenceState: 'live_current', confidenceBand: 'high' }),
    ]);
    expect(result.eligible[0].factPriority).toBe('high');
    expect(result.eligible[0].factEvidenceState).toBe('strong');
  });

  it('a live-current but low-confidence candidate is normal / partial, not high / strong', () => {
    const result = scorePromptEnhancementMemoryCandidates([
      row({ signalKey: 's1', currentEvidenceState: 'live_current', confidenceBand: 'low' }),
    ]);
    expect(result.eligible[0].factPriority).toBe('normal');
    expect(result.eligible[0].factEvidenceState).toBe('partial');
  });

  it('near-threshold fatigue/suppression candidates are kept but deprioritized to low', () => {
    const result = scorePromptEnhancementMemoryCandidates([
      row({ signalKey: 'f', fatigueState: 'candidate' }),
      row({ signalKey: 's', suppressionState: 'candidate_scoped' }),
    ]);
    expect(result.eligible.map((c) => c.factPriority)).toEqual(['low', 'low']);
  });

  it('acceptance #1: a signal edited-out twice (negativeCount>=2) is suppressed at query time', () => {
    const result = scorePromptEnhancementMemoryCandidates([row({ signalKey: 's1', negativeCount: 2 })]);
    expect(result.eligible).toEqual([]);
    expect(result.suppressed).toEqual([{ signalKey: 's1', reasonCode: 'memory_suppressed_scoped' }]);
  });

  it('edited-out once (negativeCount===1) is kept but deprioritized to low (near threshold)', () => {
    const result = scorePromptEnhancementMemoryCandidates([row({ signalKey: 's1', negativeCount: 1 })]);
    expect(result.eligible).toHaveLength(1);
    expect(result.eligible[0].factPriority).toBe('low');
  });

  it('a fresh signal (no edit-outs) still surfaces', () => {
    const result = scorePromptEnhancementMemoryCandidates([row({ signalKey: 's1', negativeCount: 0 })]);
    expect(result.eligible.map((c) => c.signalKey)).toEqual(['s1']);
  });

  it('safety-protected memory survives even after two edit-outs', () => {
    const result = scorePromptEnhancementMemoryCandidates([
      row({ signalKey: 's1', negativeCount: 3, protectionState: 'safety_protected' }),
    ]);
    expect(result.eligible.map((c) => c.factPriority)).toEqual(['required_survivor']);
  });

  it('unknown-neutral evidence is weak_low_risk', () => {
    const result = scorePromptEnhancementMemoryCandidates([
      row({ signalKey: 's1', currentEvidenceState: 'unknown_neutral' }),
    ]);
    expect(result.eligible[0].factEvidenceState).toBe('weak_low_risk');
  });
});
