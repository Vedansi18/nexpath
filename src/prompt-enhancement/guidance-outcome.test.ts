import { describe, expect, it } from 'vitest';
import type {
  PromptEnhancementPrepareRequestV1,
  PromptEnhancementSourceInputSnapshotV1,
  PromptEnhancementTriggerProvenanceV1,
} from './contracts.js';
import { resolvePromptEnhancementGuidanceOutcomeV1 } from './guidance-outcome.js';

// The outcome resolver only reads the trigger + source signals + levelState, so a
// focused cast fixture keeps the test on the unit under test.
function request(
  trigger: PromptEnhancementTriggerProvenanceV1,
  signals: Partial<PromptEnhancementSourceInputSnapshotV1> = {},
): PromptEnhancementPrepareRequestV1 {
  return {
    reviewMomentContext: { triggerProvenance: trigger },
    sourceSignals: {
      normalizedStageAbsenceSignalRefs: [],
      contentTemplateRecordFactRefs: [],
      missingMemoryCandidateRefs: [],
      rightGoodWorkStyleEnvRuntimeRefs: [],
      sourceOnlyHardFactRefs: [],
      ...signals,
    },
    userPreferenceContext: { levelState: 'default' },
  } as unknown as PromptEnhancementPrepareRequestV1;
}

describe('resolvePromptEnhancementGuidanceOutcomeV1 (E3 / 3.2 Path A)', () => {
  it('recovers the stage-transition signal key + show from a stage trigger', () => {
    const outcome = resolvePromptEnhancementGuidanceOutcomeV1(
      request({ triggerKind: 'stage_transition', currentStage: 'implementation', prevStage: 'task_breakdown' }),
    );
    expect(outcome.show).toBe(true);
    expect(outcome.primarySignalKey).toBe('stage:task_breakdown-to-implementation');
    expect(outcome.renderedSourceASignals.map((s) => s.signalKey)).toContain('stage:task_breakdown-to-implementation');
    expect(outcome.renderedSourceASignals.find((s) => s.isRequiredSurvivor)?.signalKey).toBe('stage:task_breakdown-to-implementation');
  });

  it('recovers the absence signal key from an absence trigger', () => {
    const outcome = resolvePromptEnhancementGuidanceOutcomeV1(
      request({ triggerKind: 'absence', currentStage: 'implementation', selectedQualifyingAbsence: 'acceptance_criteria' }),
    );
    expect(outcome.primarySignalKey).toBe('absence:acceptance_criteria');
  });

  it('no Source-A survivor (manual/none trigger, no signals) -> no show, null primary key', () => {
    const outcome = resolvePromptEnhancementGuidanceOutcomeV1(
      request({ triggerKind: 'none', currentStage: 'implementation' }),
    );
    expect(outcome.show).toBe(false);
    expect(outcome.primarySignalKey).toBeNull();
    expect(outcome.renderedSourceASignals).toEqual([]);
  });

  it('is deterministic — same request yields the same survivor the popup showed', () => {
    const r = request({ triggerKind: 'stage_transition', currentStage: 'implementation', prevStage: 'task_breakdown' });
    expect(resolvePromptEnhancementGuidanceOutcomeV1(r)).toEqual(resolvePromptEnhancementGuidanceOutcomeV1(r));
  });
});
