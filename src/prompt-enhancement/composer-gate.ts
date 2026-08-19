import type { PromptEnhancementRouteResult } from './routing-taxonomy.js';

/**
 * E4 — NLP-heavy gate (phase 4.2).
 *
 * Decides whether a shown popup warrants the bounded LLM composer call vs. the
 * deterministic renderer. Per fix-plan §4a this reads the DETERMINISTIC route
 * result's ambiguity / compound-prompt state (NOT section-plan.ts): LLM wording is
 * warranted for vague / conflicting / ambiguous / multi-intent prompts; an obvious
 * clear single-intent prompt renders deterministically.
 *
 * The route's `ambiguityState` already folds in prompt weakness / low-information /
 * maturity (via `isWeakAmbiguousPrompt` / `isLowInformationPrompt` upstream), so the
 * request maturity refs are captured transitively through it. Deterministic — no LLM.
 */
const COMPOUND_NLP_HEAVY_STATES: ReadonlySet<
  PromptEnhancementRouteResult['contractDecision']['compoundPromptState']
> = new Set(['multi_intent_one_prompt', 'ambiguous_multi_intent']);

export function isPromptEnhancementNlpHeavyCaseV1(route: PromptEnhancementRouteResult): boolean {
  const decision = route.contractDecision;
  if (decision.ambiguityState !== 'clear') return true;
  if (COMPOUND_NLP_HEAVY_STATES.has(decision.compoundPromptState)) return true;
  return false;
}
