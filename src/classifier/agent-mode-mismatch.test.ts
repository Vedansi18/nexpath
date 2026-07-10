import { describe, it, expect } from 'vitest';
import { detectAgentModeMismatch, AGENT_MODE_MISMATCH_MIN_CONFIDENCE } from './agent-mode-mismatch.js';
import type { RuntimeContext } from './mistake-categories.js';

const CONF = AGENT_MODE_MISMATCH_MIN_CONFIDENCE;

function ctx(over: Partial<RuntimeContext>): RuntimeContext {
  return { stageConfidence: CONF, ...over };
}

describe('detectAgentModeMismatch', () => {
  it('fires when an execute mode runs during a planning stage', () => {
    expect(detectAgentModeMismatch(ctx({ currentAgentMode: 'auto', stage: 'idea' }))).toBe(1);
  });

  it('fires when a plan mode runs during an implementation stage', () => {
    expect(detectAgentModeMismatch(ctx({ currentAgentMode: 'plan', stage: 'implementation' }))).toBe(1);
  });

  it('does not fire when the mode matches the stage', () => {
    expect(detectAgentModeMismatch(ctx({ currentAgentMode: 'plan', stage: 'architecture' }))).toBe(0);
    expect(detectAgentModeMismatch(ctx({ currentAgentMode: 'acceptEdits', stage: 'implementation' }))).toBe(0);
  });

  it('does not fire for the neutral middle (normal/default mode) — only opposite ends clash', () => {
    expect(detectAgentModeMismatch(ctx({ currentAgentMode: 'default', stage: 'idea' }))).toBe(0);
    expect(detectAgentModeMismatch(ctx({ currentAgentMode: 'default', stage: 'implementation' }))).toBe(0);
  });

  it('is gated by the stricter stage-confidence bar', () => {
    expect(detectAgentModeMismatch(ctx({ currentAgentMode: 'auto', stage: 'idea', stageConfidence: CONF - 0.01 }))).toBe(0);
    expect(detectAgentModeMismatch(ctx({ currentAgentMode: 'auto', stage: 'idea', stageConfidence: CONF }))).toBe(1);
  });

  it('treats a missing stage confidence as below the bar', () => {
    expect(detectAgentModeMismatch({ currentAgentMode: 'auto', stage: 'idea' })).toBe(0);
  });

  it('stays neutral when the mode is unknown or absent (never guessed)', () => {
    expect(detectAgentModeMismatch(ctx({ currentAgentMode: 'some_future_mode', stage: 'idea' }))).toBe(0);
    expect(detectAgentModeMismatch(ctx({ stage: 'idea' }))).toBe(0);
  });

  it('stays neutral when the stage has no recommended band or is absent', () => {
    expect(detectAgentModeMismatch(ctx({ currentAgentMode: 'auto', stage: 'release' }))).toBe(0);
    expect(detectAgentModeMismatch(ctx({ currentAgentMode: 'auto', stage: 'feedback_loop' }))).toBe(0);
    expect(detectAgentModeMismatch(ctx({ currentAgentMode: 'auto' }))).toBe(0);
  });
});
