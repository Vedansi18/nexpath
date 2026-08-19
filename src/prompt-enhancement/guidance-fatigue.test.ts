import { describe, expect, it } from 'vitest';
import {
  buildPromptEnhancementFatigueKeyV1,
  isPromptEnhancementFatigueEligibleV1,
  stampPromptEnhancementFatigueKeysV1,
} from './guidance-fatigue.js';
import { normalizeGuidanceFacts, type PromptEnhancementGuidanceFact } from './templates/section-plan.js';
import { resolvePromptEnhancementSourceConflictsV1 } from './conflict-resolution.js';
import { applyPromptEnhancementSourceMixV1 } from './source-mix.js';

function fact(overrides: Partial<PromptEnhancementGuidanceFact> = {}): PromptEnhancementGuidanceFact {
  return {
    factId: 'pe-fact-signal-0',
    sourceType: 'absence_signal',
    sourceIds: ['absence:verification_gap@implementation'],
    guidanceKind: 'missing_practice',
    suggestedActionKind: 'add_verification',
    targetFamily: 'family_agnostic',
    targetSectionKind: 'verification_or_test_plan',
    sourceEvidenceState: 'strong',
    priority: 'normal',
    renderPolicy: 'render_as_section',
    riskLevel: 'low',
    safetyHooks: [],
    privacyClass: 'public_safe',
    sanitizationState: 'not_applicable',
    ...overrides,
  };
}

// No default parameter here on purpose: a default fires when `undefined` is
// passed EXPLICITLY, which would have silently turned the no-scope test into a
// scoped one and let a global key through green.
const keyFor = (f: PromptEnhancementGuidanceFact, scope: string | undefined): string | undefined =>
  buildPromptEnhancementFatigueKeyV1({ fact: f, projectScopeId: scope });

describe('F3 fatigueKey — repeated guidance is recognisable by key', () => {
  it('the SAME guidance raised again produces the SAME key', () => {
    // Two different prompts, two sessions, same underlying guidance. This is the
    // whole point: "we already asked this and were ignored".
    expect(keyFor(fact({ factId: 'pe-fact-signal-0' }), 'project-alpha'))
      .toBe(keyFor(fact({ factId: 'pe-fact-signal-9' }), 'project-alpha'));
  });

  it('different guidance produces a different key', () => {
    expect(keyFor(fact(), 'project-alpha')).not.toBe(keyFor(fact({
      sourceIds: ['absence:debugging_observation_gap@implementation'],
      targetSectionKind: 'reproduction_or_evidence',
    }), 'project-alpha'));
  });

  it('source-id ORDER does not change the key', () => {
    const a = keyFor(fact({ sourceIds: ['absence:a', 'env:b'] }), 'project-alpha');
    const b = keyFor(fact({ sourceIds: ['env:b', 'absence:a'] }), 'project-alpha');
    expect(a).toBe(b);
  });
});

describe('F3 fatigueKey — the L4980 gate: what the key must NEVER be', () => {
  it('FAILS on raw prompt text: no prompt-derived content reaches the key', () => {
    // The fact's own resolved evidence carries prompt-derived text. If any of it
    // leaked into the key, the key would change every time the user rephrased —
    // and would carry their text into storage.
    const withPromptText = fact({
      evidence: { key: 'stack_trace', value: 'at Object.total (/app/src/checkout/total.ts:44:9)' },
    });
    const key = keyFor(withPromptText, 'project-alpha') ?? '';
    expect(key).not.toContain('checkout');
    expect(key).not.toContain('total.ts');
    expect(key).not.toContain('stack_trace');
    // ...and rephrasing does not change it.
    expect(key).toBe(keyFor(fact({ evidence: { key: 'stack_trace', value: 'totally different text' } }), 'project-alpha'));
  });

  it('FAILS on cross-project keys: the same guidance in another project keys differently', () => {
    expect(keyFor(fact(), 'project-alpha')).not.toBe(keyFor(fact(), 'project-beta'));
  });

  it('FAILS on a global key: without a project scope there is NO key at all', () => {
    expect(keyFor(fact(), undefined)).toBeUndefined();
    expect(keyFor(fact(), '   ')).toBeUndefined();
  });

  it('the digest separator is unambiguous: regrouped ids do not collide', () => {
    // With a space separator, ['alpha beta','gamma'] and ['alpha','beta gamma']
    // both join to "alpha beta gamma" and fingerprint identically — two distinct
    // guidances would then share one fade counter. Guards the separator choice.
    const sensitive = (ids: readonly string[]) =>
      keyFor(fact({ privacyClass: 'sensitive_ref_only', sourceIds: [...ids] }), 'project-alpha');
    expect(sensitive(['alpha beta', 'gamma'])).not.toBe(sensitive(['alpha', 'beta gamma']));
  });

  it('the project scope is fingerprinted, never embedded literally', () => {
    // Callers may pass a root path, which is a local filesystem literal.
    const key = keyFor(fact(), 'C:/Users/dev/secret-client-project') ?? '';
    expect(key).not.toContain('secret-client-project');
    expect(key).not.toContain('Users');
  });

  it.each([
    ['a prompt-derived source type', { sourceType: 'prompt_derived_fact' as const }],
    ['a current-prompt origin scope', { sourceOriginScope: 'current_prompt' as const }],
  ])('FAILS on raw prompt text structurally: %s is fingerprinted, never literal', (_label, overrides) => {
    // No producer emits these today, so this guards the prohibition rather than
    // a live path: a future prompt-derived producer must not be able to carry
    // prompt content into a key that is stored and compared across sessions.
    const key = keyFor(fact({
      ...overrides,
      sourceIds: ['prompt:the-user-typed-this-literal-phrase'],
    }), 'project-alpha') ?? '';
    expect(key).not.toContain('the-user-typed-this-literal-phrase');
    expect(key).toContain('fp_');
  });

  it('a SENSITIVE fact contributes a redacted fingerprint, not its literal source id', () => {
    const sensitive = fact({
      sourceIds: ['absence:secret_in_prompt@implementation'],
      privacyClass: 'requires_confirmation',
      riskLevel: 'low',
      guidanceKind: 'missing_practice',
    });
    const key = keyFor(sensitive, 'project-alpha') ?? '';
    expect(key).not.toContain('secret_in_prompt');
    expect(key).toContain('fp_');
    // Still stable: the same sensitive guidance keys the same way.
    expect(key).toBe(keyFor(sensitive, 'project-alpha'));
  });
});

describe('F3 never-faded guard — safety and source-critical facts are NEVER faded', () => {
  it.each([
    ['high risk', { riskLevel: 'high' as const }],
    ['sensitive authority risk', { riskLevel: 'sensitive_authority_risky' as const }],
    ['safety_or_confirmation guidance', { guidanceKind: 'safety_or_confirmation' as const }],
    ['a safety-confirmation role', { factRole: 'safety_confirmation_support' as const }],
    ['a linked safety hook', { safetyHooks: ['safety_sensitive_source'] }],
  ])('%s is not fatigue-eligible', (_label, overrides) => {
    expect(isPromptEnhancementFatigueEligibleV1(fact(overrides))).toBe(false);
  });

  it.each([
    ['requires_confirmation', { privacyClass: 'requires_confirmation' as const }],
    ['sensitive_suppress', { privacyClass: 'sensitive_suppress' as const }],
    ['sensitive_ref_only', { privacyClass: 'sensitive_ref_only' as const }],
    ['do_not_render', { privacyClass: 'do_not_render' as const }],
    ['unsafe_to_render sanitization', { sanitizationState: 'unsafe_to_render' as const }],
  ])('a SENSITIVE treatment state (%s) is not fatigue-eligible either', (_label, overrides) => {
    // These carry no risk level and no safety hook of their own, so they used to
    // fall through the guard while STILL being fingerprinted in the key —
    // "too sensitive to name, but fine to suppress" is incoherent, and
    // prohibition 17 protects the confirmation lane by name.
    expect(isPromptEnhancementFatigueEligibleV1(fact(overrides))).toBe(false);
  });

  it('prompt-scoped facts stay FADEABLE — fingerprinting is about storage, not safety', () => {
    // The opposite error: folding prompt-scoping into the never-faded set would
    // disable fatigue for exactly the guidance most likely to repeat.
    expect(isPromptEnhancementFatigueEligibleV1(fact({ sourceType: 'prompt_derived_fact' }))).toBe(true);
    expect(isPromptEnhancementFatigueEligibleV1(fact({ sourceOriginScope: 'current_prompt' }))).toBe(true);
  });

  it('an ordinary missing-practice fact IS eligible', () => {
    expect(isPromptEnhancementFatigueEligibleV1(fact())).toBe(true);
  });

  it('a protected fact is stamped with NO key, so it cannot be matched and faded at all', () => {
    // Structural rather than a check a future consumer must remember to call:
    // with no key there is nothing to count repeats against.
    const [ordinary, safety] = stampPromptEnhancementFatigueKeysV1(
      [fact(), fact({ factId: 'pe-fact-safety-1', guidanceKind: 'safety_or_confirmation' })],
      'project-alpha',
    );
    expect(ordinary!.fatigueKey).toBeDefined();
    expect(safety!.fatigueKey).toBeUndefined();
  });

  it('the stamper leaves facts untouched when no project scope exists', () => {
    const [stamped] = stampPromptEnhancementFatigueKeysV1([fact()], undefined);
    expect(stamped!.fatigueKey).toBeUndefined();
  });
});

describe('F3 fatigueKey survives the pipeline that carries it', () => {
  // The key has NO consumer until the source rule/the fatigue rule land, which means nothing else
  // in the suite would notice if a layer dropped it. These hops survive today
  // only because they SPREAD facts rather than rebuilding them field by field —
  // a refactor to field-by-field construction would silently produce keys that
  // die before anyone can read them. This is the only thing guarding that.
  const keyed = (facts: readonly PromptEnhancementGuidanceFact[]): number =>
    facts.filter((entry) => entry.fatigueKey !== undefined).length;

  const stamped = (): readonly PromptEnhancementGuidanceFact[] =>
    stampPromptEnhancementFatigueKeysV1(
      [fact(), fact({ factId: 'pe-fact-signal-1', sourceIds: ['absence:acceptance_gap@implementation'] })],
      'project-alpha',
    );

  it('conflict resolution preserves the key', () => {
    const input = stamped();
    expect(keyed(input)).toBe(2);
    expect(keyed(resolvePromptEnhancementSourceConflictsV1(input).facts)).toBe(2);
  });

  it('the source mixer preserves the key, including on the required survivor', () => {
    const mix = applyPromptEnhancementSourceMixV1(
      resolvePromptEnhancementSourceConflictsV1(stamped()).facts,
      'default',
    );
    expect(mix.requiredSurvivor?.fatigueKey).toBeDefined();
    expect(keyed(mix.renderedFacts)).toBeGreaterThan(0);
  });

  it('fact normalization preserves the key', () => {
    expect(keyed(normalizeGuidanceFacts(stamped()))).toBe(2);
  });
});
