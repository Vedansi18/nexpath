import { describe, it, expect } from 'vitest';
import { runBuildGate } from '../content-template-tooling.js';
import { checkVoice, checkL2Safeguard, findVoiceViolations, findJargonViolations } from '../content-authoring-rules.js';
import { composeWhyDesc } from '../content-template-engine.js';
import {
  ABSENCE_CODING_AGENT_MODE_MISMATCH_RECORD,
  ABSENCE_AGENT_MODE_TOO_RESTRICTED_RECORD,
  AGENT_MODE_PARAM_AXES,
  CLASS_AGENT_MODE_RECORDS,
} from './class-agent-mode.js';

const optionsOf = (lf: Record<number, { cell: { option: string; whyDesc: string } } | undefined>) =>
  Object.values(lf).filter(Boolean).map((f) => f!.cell);

const RECORDS = [
  { name: 'ABSENCE_CODING_AGENT_MODE_MISMATCH (execute-while-planning)', r: ABSENCE_CODING_AGENT_MODE_MISMATCH_RECORD },
  { name: 'ABSENCE_AGENT_MODE_TOO_RESTRICTED (restricted-while-building)', r: ABSENCE_AGENT_MODE_TOO_RESTRICTED_RECORD },
];

describe.each(RECORDS)('$name', ({ r }) => {
  it('passes the build gate (schema-valid + level-1 floor)', () => {
    expect(runBuildGate([r]).ok).toBe(true);
  });
  it('authors all 5 maturity columns', () => {
    expect(Object.keys(r.levelForms).map(Number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });
  it('declares the grounded param axes', () => {
    expect(r.paramAxes).toEqual(AGENT_MODE_PARAM_AXES);
  });
  it('is voice-clean (option = the user\'s message TO the agent)', () => {
    expect(checkVoice(r).ok).toBe(true);
  });
  it('stored cells carry no {R...} / {{...}} runtime grammar', () => {
    const PLACEHOLDER = /\{[R{]/;
    for (const c of optionsOf(r.levelForms)) {
      expect(c.option).not.toMatch(PLACEHOLDER);
      expect(c.whyDesc).not.toMatch(PLACEHOLDER);
    }
  });
  it('carries the record-level go-ahead safeguard, served as the LAST line of every composed column', () => {
    expect(r.l2SafeguardRequired).toBe(true);
    expect(r.l2SafeguardLine ?? '').toMatch(/go-ahead|ask me/i);
    expect(checkL2Safeguard(r).ok).toBe(true);
    expect(checkL2Safeguard(r).unguardedLevels).toEqual([]);
    for (const lvl of [1, 2, 3, 4, 5] as const) {
      const composed = composeWhyDesc({ cell: r.levelForms[lvl]!.cell, slots: r.slots, l2Safeguard: r.l2SafeguardLine });
      expect(composed.endsWith(r.l2SafeguardLine!)).toBe(true);
    }
  });
  it('the safeguard line is itself CA-bound-clean (voice + jargon + no placeholders)', () => {
    const line = r.l2SafeguardLine!;
    expect(findVoiceViolations(line)).toEqual([]);
    expect(findJargonViolations(line)).toEqual([]);
    expect(line).not.toMatch(/\{[R{]/);
  });
  it('the beginner override is a full 5-column structurally-divergent ladder, voice-clean', () => {
    const ov = r.registerOverrides!.beginner!;
    expect(ov.divergence).toBe('structurally-divergent');
    expect(Object.keys(ov.levelForms!).map(Number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    for (const c of optionsOf(ov.levelForms!)) {
      expect(findVoiceViolations(c.option)).toEqual([]);
      expect(findVoiceViolations(c.whyDesc)).toEqual([]);
    }
  });
});

describe('coding-agent-mode records — set', () => {
  it('exports both directional records', () => {
    expect(CLASS_AGENT_MODE_RECORDS.map((r) => r.signalType)).toEqual([
      'ABSENCE_CODING_AGENT_MODE_MISMATCH',
      'ABSENCE_AGENT_MODE_TOO_RESTRICTED',
    ]);
  });
  it('the two directions share no option text', () => {
    const a = optionsOf(ABSENCE_CODING_AGENT_MODE_MISMATCH_RECORD.levelForms).map((c) => c.option);
    const b = optionsOf(ABSENCE_AGENT_MODE_TOO_RESTRICTED_RECORD.levelForms).map((c) => c.option);
    for (const opt of a) expect(b).not.toContain(opt);
  });
});
