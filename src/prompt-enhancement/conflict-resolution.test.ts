import { describe, expect, it } from 'vitest';
import { resolvePromptEnhancementSourceConflictsV1 } from './conflict-resolution.js';
import type {
  PromptEnhancementGuidanceFact,
  PromptEnhancementGuidanceSourceType,
} from './templates/section-plan.js';

function fact(
  overrides: Partial<PromptEnhancementGuidanceFact> & { factId: string; sourceType: PromptEnhancementGuidanceSourceType; sourceIds: readonly string[] },
): PromptEnhancementGuidanceFact {
  return {
    guidanceKind: 'positive_practice_preservation',
    suggestedActionKind: 'preserve_behavior',
    targetFamily: 'family_agnostic',
    targetSectionKind: '',
    sourceEvidenceState: 'partial',
    priority: 'low',
    renderPolicy: 'metadata_only',
    riskLevel: 'none',
    safetyHooks: [],
    privacyClass: 'local_private',
    sanitizationState: 'identity_only_event',
    publicCopySafe: true,
    ...overrides,
  };
}

const rightGood = (key: string) => fact({ factId: `rg-${key}`, sourceType: 'right_good_pattern', sourceIds: [`right_good:${key}`] });
const absence = (key: string) =>
  fact({ factId: `ab-${key}`, sourceType: 'absence_signal', sourceIds: [`absence:${key}`], guidanceKind: 'missing_practice', priority: 'required_survivor', renderPolicy: 'render_as_section' });
const mistake = (key: string) =>
  fact({ factId: `mk-${key}`, sourceType: 'absence_signal', sourceIds: [`mistake:${key}`], guidanceKind: 'missing_practice', priority: 'normal', renderPolicy: 'render_as_section' });

describe('resolvePromptEnhancementSourceConflictsV1 (E2 / 2.4b)', () => {
  it('suppresses a positive fact contradicted by an active absence for the same practice', () => {
    const result = resolvePromptEnhancementSourceConflictsV1([absence('verification'), rightGood('verification')]);
    const rg = result.facts.find((f) => f.factId === 'rg-verification');
    expect(rg?.priority).toBe('suppressed');
    expect(rg?.renderPolicy).toBe('suppress_with_reason');
    expect(rg?.requiredBecause).toBe('contradicted_by:ab-verification');
    expect(result.suppressed).toEqual([
      { factId: 'rg-verification', reasonCode: 'right_good_contradicted_by_active_absence', conflictsWith: 'ab-verification' },
    ]);
  });

  it('suppresses a positive fact contradicted by a mistake signal (normalized into Source A)', () => {
    const result = resolvePromptEnhancementSourceConflictsV1([mistake('acceptance_criteria'), rightGood('acceptance_criteria')]);
    expect(result.facts.find((f) => f.factId === 'rg-acceptance_criteria')?.priority).toBe('suppressed');
    expect(result.suppressed[0].conflictsWith).toBe('mk-acceptance_criteria');
  });

  it('leaves a positive fact untouched when no active absence names the same practice', () => {
    const result = resolvePromptEnhancementSourceConflictsV1([absence('verification'), rightGood('writes_docs')]);
    const rg = result.facts.find((f) => f.factId === 'rg-writes_docs');
    expect(rg?.priority).toBe('low');
    expect(rg?.renderPolicy).toBe('metadata_only');
    expect(result.suppressed).toEqual([]);
  });

  it('does not touch the active absence facts themselves', () => {
    const result = resolvePromptEnhancementSourceConflictsV1([absence('verification'), rightGood('verification')]);
    expect(result.facts.find((f) => f.factId === 'ab-verification')?.priority).toBe('required_survivor');
  });

  it('is a no-op when there are no positive facts', () => {
    const facts = [absence('verification'), mistake('rollback')];
    const result = resolvePromptEnhancementSourceConflictsV1(facts);
    expect(result.suppressed).toEqual([]);
    expect(result.facts).toEqual(facts);
  });
});
