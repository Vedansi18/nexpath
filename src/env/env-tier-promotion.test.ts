import { describe, it, expect } from 'vitest';
import { promoteEnvFactsToTierP, ENV_FACT_CORROBORATOR, corroborationTierForEnvFact, corroborationTierForRightGood } from './env-tier-promotion.js';
import { envFactsToGrounding } from '../decision-session/content-template-engine.js';
import type { FactMap } from './types.js';
import type { RightGoodProfile, RightGoodState } from '../classifier/right-good-aggregator.js';

function facts(obj: Record<string, boolean>): FactMap {
  const out: FactMap = {};
  for (const [k, value] of Object.entries(obj)) out[k] = { value, tier: 'C', confidence: 'high', detectedAt: 0 };
  return out;
}
function profile(
  states: Record<string, RightGoodState>,
  { verified = true }: { verified?: boolean } = {},
): RightGoodProfile {
  const out: Record<string, { state: RightGoodState; behaviourVerified: boolean }> = {};
  for (const [k, state] of Object.entries(states)) out[k] = { state, behaviourVerified: verified };
  return out as unknown as RightGoodProfile;
}

describe('promoteEnvFactsToTierP', () => {
  it('promotes a present capability fact to tier P when its corroborator reads RIGHT&GOOD', () => {
    const out = promoteEnvFactsToTierP(facts({ has_test_runner: true }), profile({ test_creation: 'right_good' }));
    expect(out.has_test_runner!.tier).toBe('P');
  });

  it('a claim-only RIGHT&GOOD (not behaviour-verified) never promotes — practice claims need observed behaviour', () => {
    const out = promoteEnvFactsToTierP(
      facts({ has_test_runner: true }),
      profile({ test_creation: 'right_good' }, { verified: false }),
    );
    expect(out.has_test_runner!.tier).toBe('C');
  });

  it('verified test RUNS corroborate the test-runner practice (any mapped signal suffices)', () => {
    const out = promoteEnvFactsToTierP(facts({ has_test_runner: true }), profile({ regression_check: 'right_good' }));
    expect(out.has_test_runner!.tier).toBe('P');
  });

  it('leaves the fact at tier C when the corroborator is not RIGHT&GOOD', () => {
    for (const state of ['neutral', 'mistake'] as RightGoodState[]) {
      const out = promoteEnvFactsToTierP(facts({ has_test_runner: true }), profile({ test_creation: state }));
      expect(out.has_test_runner!.tier).toBe('C');
    }
  });

  it('leaves the fact at tier C when there is no corroboration evidence at all (absent → neutral)', () => {
    const out = promoteEnvFactsToTierP(facts({ has_test_runner: true }), profile({}));
    expect(out.has_test_runner!.tier).toBe('C');
  });

  it('never promotes a fact that has no corroborator mapping', () => {
    const out = promoteEnvFactsToTierP(facts({ has_version_control: true }), profile({ test_creation: 'right_good' }));
    expect(out.has_version_control!.tier).toBe('C');
    expect(ENV_FACT_CORROBORATOR.has_version_control).toBeUndefined();
  });

  it('never promotes an absent (false) capability fact even when the behaviour is RIGHT&GOOD', () => {
    const out = promoteEnvFactsToTierP(facts({ has_security_scanner: false }), profile({ security_check: 'right_good' }));
    expect(out.has_security_scanner!.tier).toBe('C');
  });

  it('feeds the grounding tier: a promoted fact grounds as corroborated, an un-promoted as capability', () => {
    const promoted = promoteEnvFactsToTierP(facts({ has_test_runner: true }), profile({ test_creation: 'right_good' }));
    expect(envFactsToGrounding(promoted).find((g) => g.key === 'has_test_runner')?.tier).toBe('corroborated');
    const plain = promoteEnvFactsToTierP(facts({ has_test_runner: true }), profile({}));
    expect(envFactsToGrounding(plain).find((g) => g.key === 'has_test_runner')?.tier).toBe('capability');
  });
});

describe('corroboration tier for grounding (the boundary vocabulary)', () => {
  it('a tier-P fact reads promoted_practice_P', () => {
    const fact = { value: true as const, tier: 'P' as const, confidence: 'high' as const, detectedAt: 0 };
    expect(corroborationTierForEnvFact(fact)).toBe('promoted_practice_P');
  });

  it('a present tier-C fact reads capability', () => {
    const fact = { value: true as const, tier: 'C' as const, confidence: 'high' as const, detectedAt: 0 };
    expect(corroborationTierForEnvFact(fact)).toBe('capability');
  });

  it('a false fact reads uncorroborated — never a capability, never a practice', () => {
    const fact = { value: false as const, tier: 'C' as const, confidence: 'high' as const, detectedAt: 0 };
    expect(corroborationTierForEnvFact(fact)).toBe('uncorroborated');
  });

  it('a null (unknown) fact reads uncorroborated', () => {
    const fact = { value: null, tier: 'C' as const, confidence: 'low' as const, detectedAt: 0 };
    expect(corroborationTierForEnvFact(fact)).toBe('uncorroborated');
  });

  it('a behaviour-verified RIGHT&GOOD signal reads promoted_practice_P', () => {
    const signal = profile({ test_creation: 'right_good' })['test_creation']!;
    expect(corroborationTierForRightGood(signal)).toBe('promoted_practice_P');
  });

  it('a claim-only RIGHT&GOOD signal reads uncorroborated — never practice-grade from prompt text alone', () => {
    const signal = profile({ test_creation: 'right_good' }, { verified: false })['test_creation']!;
    expect(corroborationTierForRightGood(signal)).toBe('uncorroborated');
  });

  it('a wrong_bad signal reads uncorroborated', () => {
    const signal = profile({ test_creation: 'wrong_bad' })['test_creation']!;
    expect(corroborationTierForRightGood(signal)).toBe('uncorroborated');
  });
});
