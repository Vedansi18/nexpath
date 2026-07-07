import { describe, it, expect } from 'vitest';
import type OpenAI from 'openai';
import { checkVoice, checkL2Safeguard, findVoiceViolations, findJargonViolations } from '../content-authoring-rules.js';
import {
  composeAdvisory, resolveRegisterForms, type RecordCandidateLookup,
} from '../content-template-engine.js';
import { validateContentTemplateRecord, type ContentTemplateRecord } from '../content-template-schema.js';
import { ABSENCE_SECRET_IN_PROMPT_RECORD } from './class-security-safety.js';
import { SECRET_IN_PROMPT_BEGINNER_OVERRIDE } from './class-security-safety-beginner.js';

// A3 — ABSENCE_SECRET_IN_PROMPT `_BEGINNER` register override. Mirrors the established
// per-class beginner-L2 coverage (class4-records-beginner.test.ts): the flagged base record's
// safeguard MUST reach the beginner-register served column too (plan §6.1 item 9). Because the
// record is ship-dark, no SHIPPED_CONTENT_TEMPLATES test exercises this — so its beginner
// serving path is verified here or nowhere.

const kw = 'secret';
const optionsOf = (lf: Record<number, { cell: { option: string; whyDesc: string } } | undefined>) =>
  Object.values(lf).filter(Boolean).map((f) => f!.cell);

function mockClient(reply: string): OpenAI {
  return { chat: { completions: { create: async () => ({ choices: [{ message: { content: reply } }] }) } } } as unknown as OpenAI;
}
function lookupOf(map: Partial<Record<string, unknown>>): RecordCandidateLookup {
  return (source) => map[source];
}
/** The base record with its beginner forms substituted — the shape the engine serves a beginner user. */
function asOverrideRecord(r: ContentTemplateRecord): ContentTemplateRecord {
  return { ...r, levelForms: resolveRegisterForms(r, 'beginner') };
}

describe('A3 — SECRET_IN_PROMPT beginner override (authoring gates)', () => {
  const cells = optionsOf(SECRET_IN_PROMPT_BEGINNER_OVERRIDE.levelForms);

  it('authors all 5 maturity columns (parity with the base record)', () => {
    expect(
      Object.keys(SECRET_IN_PROMPT_BEGINNER_OVERRIDE.levelForms).map(Number).sort((a, b) => a - b),
    ).toEqual([1, 2, 3, 4, 5]);
  });
  it('retains "secret" in every beginner option AND why-desc', () => {
    for (const c of cells) {
      expect(c.option.toLowerCase()).toContain(kw);
      expect(c.whyDesc.toLowerCase()).toContain(kw);
    }
  });
  it('is voice-clean + de-jargon clean (both channels)', () => {
    for (const c of cells) {
      expect(findVoiceViolations(c.option)).toEqual([]);
      expect(findVoiceViolations(c.whyDesc)).toEqual([]);
      expect(findJargonViolations(c.option)).toEqual([]);
      expect(findJargonViolations(c.whyDesc)).toEqual([]);
    }
  });
  it('never contains a literal secret token (no-echo guard on the beginner cells too)', () => {
    const SECRET_RE = /\b(sk-[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{12,}|ghp_[A-Za-z0-9]{20,})\b|(api[_-]?key|password|token)\s*[:=]\s*\S{8,}/i;
    for (const c of cells) {
      expect(c.option).not.toMatch(SECRET_RE);
      expect(c.whyDesc).not.toMatch(SECRET_RE);
    }
  });
});

describe('A3 — SECRET_IN_PROMPT beginner override (synthesized-record gates)', () => {
  const r = ABSENCE_SECRET_IN_PROMPT_RECORD;
  const synth = asOverrideRecord(r);

  it('the beginner-substituted record is schema-valid, all-5-column, floored (Gap 6)', () => {
    expect(validateContentTemplateRecord(synth).ok).toBe(true);
    expect(Object.keys(synth.levelForms).map(Number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(checkVoice(synth).ok).toBe(true);
  });
  it('inherits the base sensitive flag + line, so every beginner column is L2-guarded (Gap 5)', () => {
    expect(r.l2SafeguardRequired).toBe(true);
    expect(checkL2Safeguard(synth).ok).toBe(true);
    expect(checkL2Safeguard(synth).unguardedLevels).toEqual([]);
  });
});

describe('A3 — SECRET_IN_PROMPT beginner override (engine serving)', () => {
  const r = ABSENCE_SECRET_IN_PROMPT_RECORD;

  it('composeAdvisory serves the beginner override option when register=beginner, base otherwise (Gap 7)', async () => {
    const beg = await composeAdvisory({ lookup: lookupOf({ shipped: r }), level: 1, register: 'beginner' }, mockClient(JSON.stringify({ whyDesc: 'w' })));
    const base = await composeAdvisory({ lookup: lookupOf({ shipped: r }), level: 1 }, mockClient(JSON.stringify({ whyDesc: 'w' })));
    expect(beg?.option).toBe(resolveRegisterForms(r, 'beginner')[1]!.cell.option);
    expect(base?.option).toBe(r.levelForms[1]!.cell.option);
    expect(beg?.option).not.toBe(base?.option);
  });

  it('appends the action-specific l2SafeguardLine to the beginner-register served column too (Gap 4 — plan §6.1 item 9)', async () => {
    expect(r.l2SafeguardRequired).toBe(true);
    for (const lvl of [1, 3, 5] as const) {
      const out = await composeAdvisory({ lookup: lookupOf({ shipped: r }), level: lvl, register: 'beginner' }, mockClient(JSON.stringify({ whyDesc: 'woven' })));
      expect(out?.whyDesc).toContain(r.l2SafeguardLine!);
    }
  });
});
