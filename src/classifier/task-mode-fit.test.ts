import { describe, it, expect } from 'vitest';
import { recommendedModeBandForStage } from './task-mode-fit.js';
import type { Stage } from './types.js';

describe('recommendedModeBandForStage', () => {
  it('recommends the plan band for exploratory / design stages', () => {
    for (const stage of ['idea', 'prd', 'architecture', 'task_breakdown'] as Stage[]) {
      expect(recommendedModeBandForStage(stage)).toBe('plan');
    }
  });

  it('recommends the execute band for known-scope build / review stages', () => {
    for (const stage of ['implementation', 'review_testing'] as Stage[]) {
      expect(recommendedModeBandForStage(stage)).toBe('execute');
    }
  });

  it('returns undefined for stages with no clear recommendation', () => {
    for (const stage of ['release', 'feedback_loop'] as Stage[]) {
      expect(recommendedModeBandForStage(stage)).toBeUndefined();
    }
  });
});
