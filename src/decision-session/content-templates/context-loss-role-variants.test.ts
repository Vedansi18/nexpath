import { describe, it, expect } from 'vitest';
import type { UserProfile } from '../../classifier/types.js';
import { resolveDecisionContent, type DecisionContent } from '../options.js';
import { findVoiceViolations, findJargonViolations } from '../content-authoring-rules.js';
import { detectL2TriggersInText } from '../r5-injection.js';

/** §4.E6 CTA-C4 gate: an option proposing a sensitive action must carry a confirm-seek. */
const l2Compliant = (option: string, whyDesc: string): boolean =>
  detectL2TriggersInText(option).length === 0 || /go-ahead|confirmation|ask me/i.test(whyDesc);
import {
  ABSENCE_CONTEXT_LOSS_FOUNDER,
  ABSENCE_CONTEXT_LOSS_INDIE_HACKER,
  ABSENCE_CONTEXT_LOSS_PM,
} from './context-loss-role-variants.js';

const VARIANTS: Record<string, DecisionContent> = {
  founder: ABSENCE_CONTEXT_LOSS_FOUNDER,
  indie_hacker: ABSENCE_CONTEXT_LOSS_INDIE_HACKER,
  pm: ABSENCE_CONTEXT_LOSS_PM,
};

const options = (c: DecisionContent) => [...c.L1, ...c.L2, ...c.L3].map((e) => e.option);

describe('context_loss role variants — structure + decision anchor', () => {
  for (const [role, c] of Object.entries(VARIANTS)) {
    describe(role, () => {
      it('is the context_loss signal with non-empty pinch labels and ≥1 option per level', () => {
        expect(c.signalType).toBe('ABSENCE_CONTEXT_LOSS');
        expect(c.question.length).toBeGreaterThan(0);
        expect(c.pinchFallback.length).toBeGreaterThan(0);
        expect(c.L1.length).toBeGreaterThanOrEqual(1);
        expect(c.L2.length).toBeGreaterThanOrEqual(1);
        expect(c.L3.length).toBeGreaterThanOrEqual(1);
      });
      it('retains the "decision" keyword in every option', () => {
        for (const o of options(c)) expect(o.toLowerCase()).toContain('decision');
      });
      it('carries the Frame-D vocabulary (constraint + assumption across the set)', () => {
        const joined = options(c).join(' ').toLowerCase();
        expect(joined).toContain('constraint');
        expect(joined).toContain('assumption');
      });
    });
  }
});

describe('context_loss role variants — voice (option = user message TO the agent)', () => {
  for (const [role, c] of Object.entries(VARIANTS)) {
    it(`${role}: no banned third-person patterns in any option or why-desc`, () => {
      for (const e of [...c.L1, ...c.L2, ...c.L3]) {
        expect(findVoiceViolations(e.option)).toEqual([]);
        expect(findVoiceViolations(e.descBase)).toEqual([]);
      }
    });
  }
});

describe('context_loss role variants — L2 safeguard gate (§4.E6)', () => {
  for (const [role, c] of Object.entries(VARIANTS)) {
    it(`${role}: every option is L2-compliant (no sensitive action, or a confirm-seek)`, () => {
      for (const e of [...c.L1, ...c.L2, ...c.L3]) {
        expect(l2Compliant(e.option, e.descBase)).toBe(true);
      }
    });
  }
});

describe('context_loss role variants — de-jargon gate (CTA-C3)', () => {
  for (const [role, c] of Object.entries(VARIANTS)) {
    it(`${role}: no bare deployment/coding jargon in any option or why-desc`, () => {
      for (const e of [...c.L1, ...c.L2, ...c.L3]) {
        expect(findJargonViolations(e.option)).toEqual([]);
        expect(findJargonViolations(e.descBase)).toEqual([]);
      }
    });
  }
});

describe('context_loss role variants — register (casual founder/indie, formal PM)', () => {
  // H-1 over-formalization guard, applied per role register across EVERY position.
  const CASUAL_MARKER = /\b(let's|we|us|our|my|me)\b|n't\b|'(s|ve|re|ll|d)\b/i;

  it('founder + indie_hacker read casual in every option', () => {
    for (const o of [...options(ABSENCE_CONTEXT_LOSS_FOUNDER), ...options(ABSENCE_CONTEXT_LOSS_INDIE_HACKER)]) {
      expect(o).toMatch(CASUAL_MARKER);
    }
  });
  it('PM reads formal in every option (no casual markers)', () => {
    for (const o of options(ABSENCE_CONTEXT_LOSS_PM)) {
      expect(o).not.toMatch(CASUAL_MARKER);
    }
  });
});

describe('context_loss role variants — routing (role hit takes precedence)', () => {
  const profile = (role: string): UserProfile =>
    ({ nature: 'hardcore_pro', role } as unknown as UserProfile);

  it('founder → founder variant', () => {
    expect(resolveDecisionContent('implementation', 'absence:context_loss', profile('founder')))
      .toBe(ABSENCE_CONTEXT_LOSS_FOUNDER);
  });
  it('indie_hacker → indie_hacker variant', () => {
    expect(resolveDecisionContent('implementation', 'absence:context_loss', profile('indie_hacker')))
      .toBe(ABSENCE_CONTEXT_LOSS_INDIE_HACKER);
  });
  it('pm → pm variant', () => {
    expect(resolveDecisionContent('implementation', 'absence:context_loss', profile('pm')))
      .toBe(ABSENCE_CONTEXT_LOSS_PM);
  });
});
