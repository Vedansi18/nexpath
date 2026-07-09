import { describe, it, expect } from 'vitest';
import { CONTEXT_LOSS_BEGINNER_OVERRIDE } from './class5-records-beginner.js';
import { detectL2TriggersInText } from '../r5-injection.js';
import { findJargonViolations } from '../content-authoring-rules.js';

/** §4.E6 CTA-C4 gate: an option proposing a sensitive action must carry a confirm-seek. */
const l2Compliant = (option: string, whyDesc: string): boolean =>
  detectL2TriggersInText(option).length === 0 || /go-ahead|confirmation|ask me/i.test(whyDesc);

// H-1 (D-R12-2): the BEGINNER register is harmonized to the Frame-D decision-thread frame
// (constraint / assumption / decision-thread) in its own voice, retaining its "track" anchor.
// (The former CASUAL-register assertions scanned the static ABSENCE_CONTEXT_LOSS_CASUAL set,
// retired with the B11 cutover — casual is now runtime-adapted from the record's base, and the
// base record's content quality is covered by class5-records.test.ts.)

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
