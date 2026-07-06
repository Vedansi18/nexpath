import { describe, it, expect } from 'vitest';
import type { DecisionContent } from '../options.js';
import { ABSENCE_CONTEXT_LOSS_CASUAL } from './class5-session-quality.js';
import { CONTEXT_LOSS_BEGINNER_OVERRIDE } from './class5-records-beginner.js';

// H-1 (D-R12-2): the CASUAL + BEGINNER registers are fully harmonized to the Frame-D
// decision-thread frame (constraint / assumption / decision-thread) in their own voice,
// each retaining its own topic anchor (casual: "decision"; beginner: "track").

const casualOptions = (c: DecisionContent) => [...c.L1, ...c.L2, ...c.L3].map((e) => e.option);

describe('context_loss H-1 — CASUAL harmonized to the decision-thread frame', () => {
  const opts = casualOptions(ABSENCE_CONTEXT_LOSS_CASUAL);

  it('retains the "decision" anchor in every casual option', () => {
    for (const o of opts) expect(o.toLowerCase()).toContain('decision');
  });
  it('carries the Frame-D vocabulary (constraint + assumption across the set)', () => {
    const joined = opts.join(' ').toLowerCase();
    expect(joined).toContain('constraint');
    expect(joined).toContain('assumption');
  });
  it('preserves the casual first-person voice', () => {
    expect(ABSENCE_CONTEXT_LOSS_CASUAL.L1[0].option.toLowerCase()).toMatch(/let's|\bwe\b/);
  });
});

describe('context_loss H-1 — BEGINNER harmonized to the decision-thread frame', () => {
  const cells = Object.values(CONTEXT_LOSS_BEGINNER_OVERRIDE.levelForms).map((f) => f!.cell);
  const options = cells.map((c) => c.option);

  it('retains the "track" beginner anchor in every option (incl. the frozen col-3)', () => {
    for (const o of options) expect(o.toLowerCase()).toContain('track');
  });
  it('carries the Frame-D vocabulary across the set (limits/constraints + assumptions + decision/thread)', () => {
    const joined = options.join(' ').toLowerCase();
    expect(joined).toMatch(/limit|constraint/);
    expect(joined).toMatch(/assum/);
    expect(joined).toMatch(/decision|thread/);
  });
});
