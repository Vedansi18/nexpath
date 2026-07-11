import { describe, it, expect } from 'vitest';
import type OpenAI from 'openai';
import { ABSENCE_CONTEXT_LOSS_RECORD } from './class5-records.js';
import { resolveRegisterForms, composeAdvisory, type RecordCandidateLookup } from '../content-template-engine.js';
import { checkVoice } from '../content-authoring-rules.js';
import { checkTopicKeyword } from '../content-template-tooling.js';
import { validateContentTemplateRecord, type ContentTemplateRecord } from '../content-template-schema.js';

function mockClient(reply: string): OpenAI {
  return { chat: { completions: { create: async () => ({ choices: [{ message: { content: reply } }] }) } } } as unknown as OpenAI;
}
function lookupOf(map: Partial<Record<string, unknown>>): RecordCandidateLookup {
  return (source) => map[source];
}
const client = mockClient(JSON.stringify({ whyDesc: 'w' }));
const ROLES = ['founder', 'indie_hacker', 'pm'] as const;

/** A synthetic record exposing a role override's forms as its base, for the content-agnostic checkers. */
function asRoleRecord(role: string): ContentTemplateRecord {
  return {
    ...ABSENCE_CONTEXT_LOSS_RECORD,
    levelForms: ABSENCE_CONTEXT_LOSS_RECORD.roleOverrides![role]!.levelForms,
    registerOverrides: undefined,
    roleOverrides: undefined,
  };
}

describe('context_loss role overrides (B11) — set level', () => {
  it('the record carries founder / indie_hacker / pm role overrides', () => {
    expect(Object.keys(ABSENCE_CONTEXT_LOSS_RECORD.roleOverrides ?? {}).sort()).toEqual(['founder', 'indie_hacker', 'pm']);
  });
});

describe('context_loss role overrides — per-role gates', () => {
  for (const role of ROLES) {
    const synth = asRoleRecord(role);
    describe(role, () => {
      it('is a schema-valid, all-5-column, floored ladder', () => {
        expect(validateContentTemplateRecord(synth).ok).toBe(true);
        expect(Object.keys(synth.levelForms).map(Number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
      });
      it('keeps the "decision" keyword in every option and why-desc', () => {
        const res = checkTopicKeyword(synth, 'decision');
        expect(res.missingInOption).toEqual([]);
        expect(res.missingInWhyDesc).toEqual([]);
      });
      it('is voice-clean', () => {
        expect(checkVoice(synth).ok).toBe(true);
      });
    });
  }
});

describe('context_loss role overrides — engine serves the role variant (role → register → base)', () => {
  const lookup = lookupOf({ shipped: ABSENCE_CONTEXT_LOSS_RECORD });

  it('serves each role its own option; distinct from the base and from each other', async () => {
    const base    = await composeAdvisory({ lookup, level: 3, register: 'casual' }, client);
    const founder = await composeAdvisory({ lookup, level: 3, register: 'casual', role: 'founder' }, client);
    const indie   = await composeAdvisory({ lookup, level: 3, register: 'casual', role: 'indie_hacker' }, client);
    const pm      = await composeAdvisory({ lookup, level: 3, register: 'formal', role: 'pm' }, client);
    for (const o of [base, founder, indie, pm]) expect(o).not.toBeNull();
    expect(founder!.option).not.toBe(base!.option);
    expect(indie!.option).not.toBe(base!.option);
    expect(pm!.option).not.toBe(base!.option);
    expect(new Set([founder!.option, indie!.option, pm!.option]).size).toBe(3); // three distinct role variants
  });

  it('beginner register is EXCLUSIVE — a beginner founder gets the beginner override, not the founder role variant', () => {
    const founderForms  = resolveRegisterForms(ABSENCE_CONTEXT_LOSS_RECORD, 'casual', 'founder');
    const beginnerForms = resolveRegisterForms(ABSENCE_CONTEXT_LOSS_RECORD, 'beginner', 'founder');
    expect(beginnerForms).not.toBe(founderForms);
    expect(beginnerForms).toBe(ABSENCE_CONTEXT_LOSS_RECORD.registerOverrides!['beginner']!.levelForms);
  });
});
