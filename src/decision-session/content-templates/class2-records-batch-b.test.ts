import { describe, it, expect } from 'vitest';
import {
  CLASS2_RECORDS_BATCH_B, CLASS2_RECORDS, VERIFICATION_PARAM_AXES, A3_SPINE, A6_SPINE,
} from './class2-records.js';
import { runBuildGate, checkTopicKeyword, checkOptionLengthBudget } from '../content-template-tooling.js';
import { reviewRecord, checkVoice, checkEscalation } from '../content-authoring-rules.js';

const KEYWORDS: Record<string, string> = {
  ABSENCE_CODE_DOCUMENTATION_GAP: 'comment',
  ABSENCE_TECHNICAL_DEBT_ACKNOWLEDGMENT: 'debt',
  ABSENCE_TEST_DEPTH_CHECK: 'test',
  ABSENCE_SECURITY_REVIEW_GAP: 'security',
  ABSENCE_ERROR_HANDLING_COVERAGE: 'error',
  ABSENCE_REFACTORING_CHECKPOINT: 'refactor',
  ABSENCE_SELF_REVIEW_HABIT: 'review',
  ABSENCE_PERFORMANCE_AWARENESS: 'performance',
  ABSENCE_DOCUMENTATION_BEFORE_ASK: 'docs',
  ABSENCE_OUTPUT_VERIFICATION: 'run',
};

/**
 * Per-signalType author-declared practice-richness weights (the escalation-
 * monotonicity input — author intent, NOT a word-count proxy, which is disallowed).
 * Every column adds a named practice, so the intended shape is a strict 1→5 climb
 * for all; the semantic judgment stays a human-review concern.
 */
const PRACTICE_WEIGHTS: Record<string, readonly number[]> = Object.fromEntries(
  Object.keys(KEYWORDS).map((s) => [s, [1, 2, 3, 4, 5]]),
);

/** The only two valid class-2 spines (verification cadence / maintainability). */
const VALID_SPINES = [A3_SPINE, A6_SPINE];

describe('class-2 — set completeness', () => {
  it('batch A + batch B = the 21 distinct class-2 signalTypes', () => {
    expect(new Set(CLASS2_RECORDS.map((r) => r.signalType)).size).toBe(21);
  });
  it('batch B covers the 10 casual-/beginner-only signalTypes', () => {
    expect(CLASS2_RECORDS_BATCH_B.map((r) => r.signalType)).toEqual(Object.keys(KEYWORDS));
  });
  it('the whole class passes the build gate (schema + level-1 floor)', () => {
    expect(runBuildGate(CLASS2_RECORDS).ok).toBe(true);
  });
});

describe('class-2 batch B — per-record full-depth gates', () => {
  for (const r of CLASS2_RECORDS_BATCH_B) {
    describe(r.signalType, () => {
      const kw = KEYWORDS[r.signalType];

      it('authors all 5 maturity columns', () => {
        expect(Object.keys(r.levelForms).map(Number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
      });

      it('is de-jargon clean in authored columns (col-3 frozen exempt), headline-only, full coverage', () => {
        const review = reviewRecord(r, kw);
        const jargon = { ...review.jargonByLevel };
        delete jargon[3]; // col-3 is frozen shipped text — not subject to the authoring de-jargon discipline
        expect(jargon).toEqual({});
        expect(review.headlineOnly.ok).toBe(true);
        expect(review.coverage.ok).toBe(true);
      });

      it('keeps its keyword in every option, and every AUTHORED why-desc (col-3 frozen exempt)', () => {
        const res = checkTopicKeyword(r, kw);
        expect(res.missingInOption).toEqual([]);
        expect(res.missingInWhyDesc.filter((l) => l !== 3)).toEqual([]);
      });

      it('author-declared practice richness is monotonic for THIS record', () => {
        expect(PRACTICE_WEIGHTS[r.signalType]).toBeDefined();                 // not vacuous: an undeclared record must fail
        expect(checkEscalation(PRACTICE_WEIGHTS[r.signalType]).ok).toBe(true);
      });

      it('declares grounded param axes (defined, non-empty, valid representation tags) + a valid family spine', () => {
        expect(r.paramAxes).toBeDefined();                                    // not vacuous: a missing axes block must fail
        expect(Object.keys(r.paramAxes ?? {}).length).toBeGreaterThan(0);
        expect(r.paramAxes).toEqual(VERIFICATION_PARAM_AXES);                 // the class's grounded axes, pinned
        expect(Object.values(r.paramAxes ?? {}).every((t) => ['closed-ordinal', 'nominal', 'extensible', 'open'].includes(t))).toBe(true);
        expect((r.spine ?? []).length).toBeGreaterThan(0);
        // spine must be EXACTLY one of the two family spines — catches a mis-assigned/typo'd thread
        expect(VALID_SPINES.some((s) => JSON.stringify(s) === JSON.stringify(r.spine))).toBe(true);
      });

      it('AUTHORED options (1/2/4/5) fit the length budget; col-3 frozen exempt; col-1 ≤ col-5; voice-clean', () => {
        // col-3 anchors on a long principle-cited casual line → exempt from the budget.
        expect(checkOptionLengthBudget(r).overLevels.filter((l) => l !== 3)).toEqual([]);
        expect(r.levelForms[1]!.cell.option.length).toBeLessThanOrEqual(r.levelForms[5]!.cell.option.length);
        expect(checkVoice(r).ok).toBe(true);
      });

      it('col-5 yields a file/artifact', () => {
        expect(r.levelForms[5]!.cell.option).toMatch(/\b(files?|runbooks?|notes?|docs?|readme|plans?)\b/i);
      });
    });
  }
});
