import { describe, it, expect } from 'vitest';
import { runBuildGate, checkTopicKeyword } from '../content-template-tooling.js';
import {
  reviewRecord, checkVoice, checkEscalation, checkL2Safeguard, findVoiceViolations, findJargonViolations,
} from '../content-authoring-rules.js';
import { composeWhyDesc } from '../content-template-engine.js';
import { ABSENCE_SECRET_IN_PROMPT_RECORD } from './class-security-safety.js';
import { ABSENCE_ENV_AND_SECRETS_RECORD } from './class4-records.js';

// A3 — ABSENCE_SECRET_IN_PROMPT: a NEW security/safety signal (no legacy shipped headline),
// so ALL 5 columns are authored fresh — col-3 is NOT a frozen anchor and is subject to every
// authoring gate. Sensitive: rotation + history-scrub → l2SafeguardRequired + safeguard line.

const kw = 'secret';
const optionsOf = (lf: Record<number, { cell: { option: string; whyDesc: string } } | undefined>) =>
  Object.values(lf).filter(Boolean).map((f) => f!.cell);

describe('A3 — ABSENCE_SECRET_IN_PROMPT (new signal, no frozen col-3)', () => {
  const r = ABSENCE_SECRET_IN_PROMPT_RECORD;

  it('passes the build gate (schema-valid + level-1 floor)', () => {
    expect(runBuildGate([r]).ok).toBe(true);
  });
  it('authors all 5 maturity columns', () => {
    expect(Object.keys(r.levelForms).map(Number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });
  it('is de-jargon clean in EVERY column (col-3 authored → not exempt) + headline-only + full coverage', () => {
    const review = reviewRecord(r, kw);
    expect(review.jargonByLevel).toEqual({});
    expect(review.headlineOnly.ok).toBe(true);
    expect(review.coverage.ok).toBe(true);
  });
  it('retains the "secret" keyword in every option AND why-desc (col-3 not exempt)', () => {
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
  it('carries the L2 sensitive-action safeguard that names THIS record\'s action (rotate keys / rewrite history)', () => {
    expect(r.l2SafeguardRequired).toBe(true);
    expect(r.l2SafeguardLine ?? '').toMatch(/go-ahead|ask me/i);
    // Gap 3 — the line names its OWN action, not a generic confirm-seek (no cross-record mismatch).
    expect(r.l2SafeguardLine ?? '').toMatch(/rotate|key|history/i);
    expect(checkL2Safeguard(r).ok).toBe(true);
  });
  it('serves the safeguard as the LAST line of every composed column (Gap 1 — the served path, not just the static gate)', () => {
    // The record is ship-dark, so no SHIPPED_CONTENT_TEMPLATES test exercises its serving —
    // verify the safeguard is actually appended by composeWhyDesc on each column.
    for (const lvl of [1, 3, 5] as const) {
      const composed = composeWhyDesc({ cell: r.levelForms[lvl]!.cell, slots: r.slots, l2Safeguard: r.l2SafeguardLine });
      expect(composed.endsWith(r.l2SafeguardLine!)).toBe(true);
    }
  });
  it('the l2SafeguardLine is itself CA-bound-clean: voice-clean, de-jargon-clean, no runtime placeholders (Gap 2)', () => {
    const line = r.l2SafeguardLine!;
    expect(findVoiceViolations(line)).toEqual([]);
    expect(findJargonViolations(line)).toEqual([]);
    expect(line).not.toContain('{R');
  });
  it('the heaviest column yields a written artifact', () => {
    expect(r.levelForms[5]!.cell.option.toLowerCase()).toMatch(/write|note/);
  });
  it('never contains a literal secret token (no-echo guard, belt-and-suspenders to the static+sanitize rule)', () => {
    const SECRET_RE = /\b(sk-[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{12,}|ghp_[A-Za-z0-9]{20,})\b|(api[_-]?key|password|token)\s*[:=]\s*\S{8,}/i;
    for (const c of optionsOf(r.levelForms)) {
      expect(c.option).not.toMatch(SECRET_RE);
      expect(c.whyDesc).not.toMatch(SECRET_RE);
    }
  });
});

describe('A3 — differentiation vs ENV_AND_SECRETS (A2 dedup constraint)', () => {
  it('SECRET_IN_PROMPT and ENV_AND_SECRETS share no option text', () => {
    const a = optionsOf(ABSENCE_SECRET_IN_PROMPT_RECORD.levelForms).map((c) => c.option);
    const b = optionsOf(ABSENCE_ENV_AND_SECRETS_RECORD.levelForms).map((c) => c.option);
    for (const opt of a) expect(b).not.toContain(opt);
  });
});
