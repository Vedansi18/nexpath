import type { PromptEnhancementPrepareRequestV1 } from './contracts.js';
import type { PromptEnhancementGuidanceFact } from './templates/section-plan.js';
import { buildPromptEnhancementGuidanceFactsV1 } from './guidance-facts.js';
import { resolvePromptEnhancementSourceConflictsV1 } from './conflict-resolution.js';
import { applyPromptEnhancementSourceMixV1 } from './source-mix.js';
import { applyPromptEnhancementGuidanceGateV1 } from './guidance-gate.js';

/**
 * Re-run the E2 guidance pipeline (build -> conflict -> source mix -> DR2-G1 gate)
 * on a persisted prepare request to recover the rendered Source-A signals — their
 * stable signal keys and risk — at the show/feedback outcome (E3 / phase 3.2, Path A).
 *
 * The prepare result does not surface the guidance-fact signal keys (its
 * sectionsForFeedback fall back to the Source-A ref id), so the runtime re-derives
 * them from `pending.request` by re-running the same deterministic pipeline — reusing
 * the locked E2 modules as the single source of truth, with no content-engine change.
 * Deterministic (no LLM), so re-running yields the same survivor the popup showed.
 */
export interface PromptEnhancementRenderedSignalV1 {
  signalKey: string;
  riskLevel: PromptEnhancementGuidanceFact['riskLevel'];
  isRequiredSurvivor: boolean;
}

export interface PromptEnhancementGuidanceOutcomeV1 {
  show: boolean;
  primarySignalKey: string | null;
  primaryRiskLevel: PromptEnhancementGuidanceFact['riskLevel'] | null;
  renderedSourceASignals: readonly PromptEnhancementRenderedSignalV1[];
}

export function resolvePromptEnhancementGuidanceOutcomeV1(
  request: PromptEnhancementPrepareRequestV1,
): PromptEnhancementGuidanceOutcomeV1 {
  const facts = buildPromptEnhancementGuidanceFactsV1(request);
  const resolved = resolvePromptEnhancementSourceConflictsV1(facts).facts;
  const mix = applyPromptEnhancementSourceMixV1(resolved, request.userPreferenceContext.levelState);
  const gate = applyPromptEnhancementGuidanceGateV1(mix);

  const survivor = mix.requiredSurvivor;
  const renderedSourceASignals = mix.classifiedFacts
    .filter(
      (entry) =>
        entry.lane === 'source_a' &&
        (entry.selectionRole === 'selected_required' || entry.selectionRole === 'selected_supporting'),
    )
    .map((entry) => ({
      signalKey: entry.fact.sourceIds[0] ?? entry.fact.factId,
      riskLevel: entry.fact.riskLevel,
      isRequiredSurvivor: entry.selectionRole === 'selected_required',
    }));

  return {
    show: gate.show,
    primarySignalKey: survivor ? survivor.sourceIds[0] ?? survivor.factId : null,
    primaryRiskLevel: survivor ? survivor.riskLevel : null,
    renderedSourceASignals,
  };
}
