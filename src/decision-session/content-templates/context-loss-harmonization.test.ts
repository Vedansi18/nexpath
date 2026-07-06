import { describe, it, expect } from 'vitest';
import type { DecisionContent } from '../options.js';
import { ABSENCE_CONTEXT_LOSS_CASUAL } from './class5-session-quality.js';
import { CONTEXT_LOSS_BEGINNER_OVERRIDE } from './class5-records-beginner.js';
import { detectL2TriggersInText } from '../r5-injection.js';
import { findJargonViolations } from '../content-authoring-rules.js';

/** §4.E6 CTA-C4 gate: an option proposing a sensitive action must carry a confirm-seek. */
const l2Compliant = (option: string, whyDesc: string): boolean =>
  detectL2TriggersInText(option).length === 0 || /go-ahead|confirmation|ask me/i.test(whyDesc);

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
  it('preserves the casual register across EVERY position (H-1 over-formalization guard)', () => {
    // The H-1 risk: injecting formal Frame-D vocab (constraint/assumption/decision) into the
    // casual register makes it read formal. Guard: every casual option keeps a casual marker
    // (first-person "we/us/our/my/me/let's" or a contraction).
    const CASUAL_MARKER = /\b(let's|we|us|our|my|me)\b|n't\b|'(s|ve|re|ll|d)\b/i;
    for (const o of opts) expect(o).toMatch(CASUAL_MARKER);
  });
  it('every casual option is L2-compliant (§4.E6)', () => {
    for (const e of [...ABSENCE_CONTEXT_LOSS_CASUAL.L1, ...ABSENCE_CONTEXT_LOSS_CASUAL.L2, ...ABSENCE_CONTEXT_LOSS_CASUAL.L3]) {
      expect(l2Compliant(e.option, e.descBase)).toBe(true);
    }
  });
  it('every casual option is de-jargon clean (CTA-C3)', () => {
    for (const e of [...ABSENCE_CONTEXT_LOSS_CASUAL.L1, ...ABSENCE_CONTEXT_LOSS_CASUAL.L2, ...ABSENCE_CONTEXT_LOSS_CASUAL.L3]) {
      expect(findJargonViolations(e.option)).toEqual([]);
      expect(findJargonViolations(e.descBase)).toEqual([]);
    }
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
  it('every beginner cell is L2-compliant (§4.E6)', () => {
    for (const c of cells) expect(l2Compliant(c.option, c.whyDesc)).toBe(true);
  });
  it('every beginner cell is de-jargon clean (CTA-C3)', () => {
    for (const c of cells) {
      expect(findJargonViolations(c.option)).toEqual([]);
      expect(findJargonViolations(c.whyDesc)).toEqual([]);
    }
  });
});
