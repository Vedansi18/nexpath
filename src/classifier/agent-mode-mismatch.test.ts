import { describe, it, expect } from 'vitest';
import {
  detectExecuteDuringPlanning,
  detectRestrictedDuringBuild,
  AGENT_MODE_MISMATCH_MIN_CONFIDENCE,
} from './agent-mode-mismatch.js';
import type { RuntimeContext } from './mistake-categories.js';

const CONF = AGENT_MODE_MISMATCH_MIN_CONFIDENCE;

function ctx(over: Partial<RuntimeContext>): RuntimeContext {
  return { stageConfidence: CONF, ...over };
}

describe('detectExecuteDuringPlanning', () => {
  it('fires when an execute mode runs during a planning stage', () => {
    expect(detectExecuteDuringPlanning(ctx({ currentAgentMode: 'auto', stage: 'idea' }))).toBe(1);
    expect(detectExecuteDuringPlanning(ctx({ currentAgentMode: 'bypassPermissions', stage: 'architecture' }))).toBe(1);
  });

  it('does not fire in the opposite direction (plan mode during implementation)', () => {
    expect(detectExecuteDuringPlanning(ctx({ currentAgentMode: 'plan', stage: 'implementation' }))).toBe(0);
  });

  it('does not fire when the mode matches, nor for the neutral default middle', () => {
    expect(detectExecuteDuringPlanning(ctx({ currentAgentMode: 'plan', stage: 'idea' }))).toBe(0);
    expect(detectExecuteDuringPlanning(ctx({ currentAgentMode: 'default', stage: 'idea' }))).toBe(0);
  });
});

describe('detectRestrictedDuringBuild', () => {
  it('fires when a plan/read-only mode runs during an implementation stage', () => {
    expect(detectRestrictedDuringBuild(ctx({ currentAgentMode: 'plan', stage: 'implementation' }))).toBe(1);
    expect(detectRestrictedDuringBuild(ctx({ currentAgentMode: 'plan', stage: 'review_testing' }))).toBe(1);
  });

  it('does not fire in the opposite direction (execute mode during planning)', () => {
    expect(detectRestrictedDuringBuild(ctx({ currentAgentMode: 'auto', stage: 'idea' }))).toBe(0);
  });

  it('does not fire when the mode matches, nor for the neutral default middle', () => {
    expect(detectRestrictedDuringBuild(ctx({ currentAgentMode: 'acceptEdits', stage: 'implementation' }))).toBe(0);
    expect(detectRestrictedDuringBuild(ctx({ currentAgentMode: 'default', stage: 'implementation' }))).toBe(0);
  });
});

describe('the stricter stage-confidence bar (shared by both directions)', () => {
  it('gates both detectors below the bar and admits them at the bar', () => {
    expect(detectExecuteDuringPlanning(ctx({ currentAgentMode: 'auto', stage: 'idea', stageConfidence: CONF - 0.01 }))).toBe(0);
    expect(detectExecuteDuringPlanning(ctx({ currentAgentMode: 'auto', stage: 'idea', stageConfidence: CONF }))).toBe(1);
    expect(detectRestrictedDuringBuild(ctx({ currentAgentMode: 'plan', stage: 'implementation', stageConfidence: CONF - 0.01 }))).toBe(0);
    expect(detectRestrictedDuringBuild(ctx({ currentAgentMode: 'plan', stage: 'implementation', stageConfidence: CONF }))).toBe(1);
  });

  it('treats a missing stage confidence as below the bar', () => {
    expect(detectExecuteDuringPlanning({ currentAgentMode: 'auto', stage: 'idea' })).toBe(0);
    expect(detectRestrictedDuringBuild({ currentAgentMode: 'plan', stage: 'implementation' })).toBe(0);
  });
});

describe('neutral on unknown / unmapped inputs (both directions)', () => {
  it('stays 0 for an unknown or absent mode', () => {
    expect(detectExecuteDuringPlanning(ctx({ currentAgentMode: 'some_future_mode', stage: 'idea' }))).toBe(0);
    expect(detectExecuteDuringPlanning(ctx({ stage: 'idea' }))).toBe(0);
    expect(detectRestrictedDuringBuild(ctx({ currentAgentMode: 'some_future_mode', stage: 'implementation' }))).toBe(0);
  });

  it('stays 0 for a stage with no recommended band or an absent stage', () => {
    expect(detectExecuteDuringPlanning(ctx({ currentAgentMode: 'auto', stage: 'release' }))).toBe(0);
    expect(detectRestrictedDuringBuild(ctx({ currentAgentMode: 'plan', stage: 'feedback_loop' }))).toBe(0);
    expect(detectExecuteDuringPlanning(ctx({ currentAgentMode: 'auto' }))).toBe(0);
  });
});
