import { describe, it, expect } from 'vitest';
import type { UserProfile } from '../../classifier/types.js';
import { resolveDecisionContent, type DecisionContent } from '../options.js';
import { findVoiceViolations } from '../content-authoring-rules.js';
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

describe('context_loss role variants — register', () => {
  it('founder + indie_hacker read casual (first-person "let\'s")', () => {
    expect(ABSENCE_CONTEXT_LOSS_FOUNDER.L1[0].option.toLowerCase()).toContain("let's");
    expect(ABSENCE_CONTEXT_LOSS_INDIE_HACKER.L1[0].option.toLowerCase()).toContain("let's");
  });
  it('PM reads formal (no casual "let\'s")', () => {
    const pm = options(ABSENCE_CONTEXT_LOSS_PM).join(' ').toLowerCase();
    expect(pm).not.toContain("let's");
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
