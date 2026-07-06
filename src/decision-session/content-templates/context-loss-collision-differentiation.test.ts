import { describe, it, expect } from 'vitest';
import {
  ABSENCE_CONTEXT_LOSS,
  ABSENCE_SESSION_LENGTH_CHECKPOINT_FORMAL,
} from './class5-session-quality.js';

// context_loss FORMAL and session_length_checkpoint FORMAL previously shared identical
// L1[0]/L2[0]/L3[0] text (and near-identical L2[1]). The Frame-D re-author differentiates
// context_loss (constraint / assumption / decision-thread reconstruction) from
// session_length_checkpoint (a status checkpoint: working / in-progress / next step).

describe('context_loss FORMAL — Frame-D collision differentiation', () => {
  const ctx = ABSENCE_CONTEXT_LOSS;
  const chk = ABSENCE_SESSION_LENGTH_CHECKPOINT_FORMAL;

  it('the four re-authored positions are distinct from session_length_checkpoint FORMAL', () => {
    expect(ctx.L1[0].option).not.toBe(chk.L1[0].option);
    expect(ctx.L2[0].option).not.toBe(chk.L2[0].option);
    expect(ctx.L2[1].option).not.toBe(chk.L2[1].option);
    expect(ctx.L3[0].option).not.toBe(chk.L3[0].option);
  });

  it('L1[0] carries the full Frame-D triad — constraints + assumptions + decision-thread', () => {
    const o = ctx.L1[0].option.toLowerCase();
    expect(o).toContain('constraint');
    expect(o).toContain('assumption');
    expect(o).toContain('decision-thread');
  });

  it('L2[0] leads with implicit constraints/assumptions, not "current state / working / next step"', () => {
    const o = ctx.L2[0].option.toLowerCase();
    expect(o).toContain('constraint');
    expect(o).toContain('assumption');
    expect(o).not.toContain('what is working');
  });

  it('L2[1] is the decision-thread reconstruction (not a status checkpoint)', () => {
    expect(ctx.L2[1].option.toLowerCase()).toContain('decision-thread');
  });

  it('L3[0] anchors the single most important constraint/assumption/decision to carry forward', () => {
    const o = ctx.L3[0].option.toLowerCase();
    expect(o).toContain('constraint');
    expect(o).toContain('assumption');
    expect(o).toContain('decision');
  });

  it('the descBase layer stays Frame-D aligned (option-text + desc-base reinforce each other)', () => {
    expect(ctx.L1[0].descBase.toLowerCase()).toContain('decision-thread');
  });
});
