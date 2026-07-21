import { describe, it, expect } from 'vitest';
import type OpenAI from 'openai';
import { runBuildGate, checkTopicKeyword, checkOptionLengthBudget } from '../content-template-tooling.js';
import {
  reviewRecord, checkVoice, checkEscalation, checkL2Safeguard, findVoiceViolations, findJargonViolations,
} from '../content-authoring-rules.js';
import {
  composeAdvisory, resolveRegisterForms, type RecordCandidateLookup,
} from '../content-template-engine.js';
import { validateContentTemplateRecord, type ContentTemplateRecord } from '../content-template-schema.js';
import { detectL2TriggersInText } from '../r5-injection.js';
import { ABSENCE_FRUSTRATION_SPIRAL_RECORD, MOOD_META_PARAM_AXES } from './class-mood-meta.js';
import { FRUSTRATION_SPIRAL_BEGINNER_OVERRIDE } from './class-mood-meta-beginner.js';

// A8 — ABSENCE_FRUSTRATION_SPIRAL: a NEW mood/meta signal, keyword "pause". NOT security: the
// register is empathetic (step back / a smaller next step), never condescending or clinical,
// never "you're doing it wrong". No sensitive action → NO L2 safeguard, no option is an L2 trigger.

const kw = 'pause';
const optionsOf = (lf: Record<number, { cell: { option: string; whyDesc: string } } | undefined>) =>
  Object.values(lf).filter(Boolean).map((f) => f!.cell);

function mockClient(reply: string): OpenAI {
  return { chat: { completions: { create: async () => ({ choices: [{ message: { content: reply } }] }) } } } as unknown as OpenAI;
}
function lookupOf(map: Partial<Record<string, unknown>>): RecordCandidateLookup {
  return (source) => map[source];
}
function asOverrideRecord(r: ContentTemplateRecord): ContentTemplateRecord {
  return { ...r, levelForms: resolveRegisterForms(r, 'beginner') };
}

/** Condescending / blaming phrasings the empathetic register must never use (A8 tone). */
const BLAME_RE = /\byou'?re doing (it|this|that) wrong\b|\byou failed\b|\byour (mistake|fault)\b|\bwrong approach\b|\byou keep (making|getting|doing)\b|\byou should have\b|\bstop (making|being)\b|\bgiving up\b/i;

describe('A8 — ABSENCE_FRUSTRATION_SPIRAL (new mood/meta signal, no L2 safeguard)', () => {
  const r = ABSENCE_FRUSTRATION_SPIRAL_RECORD;

  it('passes the build gate (schema-valid + level-1 floor)', () => {
    expect(runBuildGate([r]).ok).toBe(true);
  });
  it('authors all 5 maturity columns', () => {
    expect(Object.keys(r.levelForms).map(Number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });
  it('declares the grounded param axes; no spine', () => {
    expect(r.paramAxes).toBeDefined();
    expect(r.paramAxes).toEqual(MOOD_META_PARAM_AXES);
    expect(r.spine).toBeUndefined();
  });
  it('is de-jargon clean in every column + headline-only + full coverage', () => {
    const review = reviewRecord(r, kw);
    expect(review.jargonByLevel).toEqual({});
    expect(review.headlineOnly.ok).toBe(true);
    expect(review.coverage.ok).toBe(true);
  });
  it('retains the "pause" keyword in every option AND why-desc', () => {
    const res = checkTopicKeyword(r, kw);
    expect(res.missingInOption).toEqual([]);
    expect(res.missingInWhyDesc).toEqual([]);
  });
  it('practice richness is monotonic', () => {
    expect(checkEscalation([1, 2, 3, 4, 5]).ok).toBe(true);
  });
  it('is voice-clean (option = the user\'s message TO the agent)', () => {
    expect(checkVoice(r).ok).toBe(true);
  });
  it('fits the copy-paste budget in every column, col-1 ≤ col-5', () => {
    expect(checkOptionLengthBudget(r).overLevels).toEqual([]);
    expect(r.levelForms[1]!.cell.option.length).toBeLessThanOrEqual(r.levelForms[5]!.cell.option.length);
  });
  it('the heaviest column yields a written artifact', () => {
    expect(r.levelForms[5]!.cell.option.toLowerCase()).toMatch(/write|note/);
  });
  it('stored cells are bare core lines — no {R...} / {{...}} runtime grammar', () => {
    const PLACEHOLDER = /\{[R{]/;
    for (const c of optionsOf(r.levelForms)) {
      expect(c.option).not.toMatch(PLACEHOLDER);
      expect(c.whyDesc).not.toMatch(PLACEHOLDER);
    }
  });
  it('carries NO L2 safeguard, and no option is an L2 trigger (mood/meta — no sensitive action)', () => {
    expect(r.l2SafeguardRequired).toBeFalsy();
    expect(r.l2SafeguardLine).toBeUndefined();
    expect(checkL2Safeguard(r).ok).toBe(true);
    expect(checkL2Safeguard(r).unguardedLevels).toEqual([]);
    for (const c of optionsOf(r.levelForms)) {
      expect(detectL2TriggersInText(c.option)).toEqual([]); // genuinely no sensitive action to guard
    }
  });
  it('is empathetic — never condescending / blaming (A8 tone requirement)', () => {
    for (const c of optionsOf(r.levelForms)) {
      expect(c.option).not.toMatch(BLAME_RE);
      expect(c.whyDesc).not.toMatch(BLAME_RE);
    }
  });
});

describe('A8 — FRUSTRATION_SPIRAL beginner override', () => {
  const r = ABSENCE_FRUSTRATION_SPIRAL_RECORD;
  const synth = asOverrideRecord(r);
  const cells = optionsOf(FRUSTRATION_SPIRAL_BEGINNER_OVERRIDE.levelForms);

  it('is a structurally-divergent register override (not a vocab tweak)', () => {
    expect(FRUSTRATION_SPIRAL_BEGINNER_OVERRIDE.divergence).toBe('structurally-divergent');
  });
  it('authors all 5 maturity columns (parity with the base record)', () => {
    expect(Object.keys(FRUSTRATION_SPIRAL_BEGINNER_OVERRIDE.levelForms).map(Number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });
  it('retains "pause" in every beginner option AND why-desc', () => {
    for (const c of cells) {
      expect(c.option.toLowerCase()).toContain(kw);
      expect(c.whyDesc.toLowerCase()).toContain(kw);
    }
  });
  it('is voice-clean + de-jargon clean, and stays warm — never condescending / blaming (both channels)', () => {
    for (const c of cells) {
      expect(findVoiceViolations(c.option)).toEqual([]);
      expect(findVoiceViolations(c.whyDesc)).toEqual([]);
      expect(findJargonViolations(c.option)).toEqual([]);
      expect(findJargonViolations(c.whyDesc)).toEqual([]);
      expect(c.option).not.toMatch(BLAME_RE);
      expect(c.whyDesc).not.toMatch(BLAME_RE);
    }
  });
  it('the beginner-substituted record is schema-valid, all-5-column, floored, voice-clean', () => {
    expect(validateContentTemplateRecord(synth).ok).toBe(true);
    expect(Object.keys(synth.levelForms).map(Number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(checkVoice(synth).ok).toBe(true);
  });
  it('is de-jargon clean, headline-only, full-coverage; monotonic; within budget; artifact parity; no L2 trigger', () => {
    const review = reviewRecord(synth, kw);
    expect(review.jargonByLevel).toEqual({});
    expect(review.headlineOnly.ok).toBe(true);
    expect(review.coverage.ok).toBe(true);
    expect(checkEscalation([1, 2, 3, 4, 5]).ok).toBe(true);
    expect(checkOptionLengthBudget(synth).overLevels).toEqual([]);
    const ARTIFACT = /write|note/i;
    expect(synth.levelForms[5]!.cell.option).toMatch(ARTIFACT);
    expect(ARTIFACT.test(synth.levelForms[5]!.cell.option)).toBe(ARTIFACT.test(r.levelForms[5]!.cell.option));
    expect(checkL2Safeguard(synth).ok).toBe(true);
    for (const c of optionsOf(synth.levelForms)) expect(detectL2TriggersInText(c.option)).toEqual([]);
  });
});

describe('A8 — FRUSTRATION_SPIRAL engine serving', () => {
  const r = ABSENCE_FRUSTRATION_SPIRAL_RECORD;

  it('composeAdvisory serves the beginner override option when register=beginner, base otherwise', async () => {
    const beg = await composeAdvisory({ lookup: lookupOf({ shipped: r }), level: 1, register: 'beginner' }, mockClient(JSON.stringify({ whyDesc: 'w' })));
    const base = await composeAdvisory({ lookup: lookupOf({ shipped: r }), level: 1 }, mockClient(JSON.stringify({ whyDesc: 'w' })));
    expect(beg?.option).toBe(resolveRegisterForms(r, 'beginner')[1]!.cell.option);
    expect(base?.option).toBe(r.levelForms[1]!.cell.option);
    expect(beg?.option).not.toBe(base?.option);
  });

  it('appends no safeguard line to the served column (mood/meta — nothing to append)', async () => {
    for (const lvl of [1, 3, 5] as const) {
      const out = await composeAdvisory({ lookup: lookupOf({ shipped: r }), level: lvl, register: 'beginner' }, mockClient(JSON.stringify({ whyDesc: 'woven' })));
      expect(out?.whyDesc).not.toMatch(/ask me for go-ahead|before you/i);
    }
  });
});
