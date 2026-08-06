import { describe, expect, it } from 'vitest';
import { isPromptEnhancementNlpHeavyCaseV1 } from './composer-gate.js';
import type { PromptEnhancementRouteResult } from './routing-taxonomy.js';

function route(
  ambiguityState: PromptEnhancementRouteResult['contractDecision']['ambiguityState'],
  compoundPromptState: PromptEnhancementRouteResult['contractDecision']['compoundPromptState'],
): PromptEnhancementRouteResult {
  return { contractDecision: { ambiguityState, compoundPromptState } } as unknown as PromptEnhancementRouteResult;
}

describe('isPromptEnhancementNlpHeavyCaseV1 (E4 / 4.2)', () => {
  it('a clear single-intent prompt is NOT NLP-heavy (deterministic)', () => {
    expect(isPromptEnhancementNlpHeavyCaseV1(route('clear', 'single_intent'))).toBe(false);
  });

  it('a clear multi-point-same-intent prompt is still deterministic', () => {
    expect(isPromptEnhancementNlpHeavyCaseV1(route('clear', 'multi_point_same_intent'))).toBe(false);
  });

  it.each([
    'ambiguous_surface_prompt',
    'missing_target',
    'conflicting_evidence',
    'weak_high_risk',
  ] as const)('a non-clear ambiguity state (%s) is NLP-heavy', (ambiguity) => {
    expect(isPromptEnhancementNlpHeavyCaseV1(route(ambiguity, 'single_intent'))).toBe(true);
  });

  it.each([
    'multi_intent_one_prompt',
    'ambiguous_multi_intent',
  ] as const)('a multi-intent compound state (%s) is NLP-heavy even when ambiguity is clear', (compound) => {
    expect(isPromptEnhancementNlpHeavyCaseV1(route('clear', compound))).toBe(true);
  });
});
