import { describe, expect, it } from 'vitest';
import {
  PROMPT_ENHANCEMENT_TAXONOMY_PRESETS,
  routePromptEnhancement,
  type PromptEnhancementPrimaryIntent,
  type PromptEnhancementRouteInput,
  type PromptEnhancementTaxonomyPreset,
} from '../routing-taxonomy.js';
import { planPromptEnhancementSections, type PromptEnhancementGuidanceFact } from './section-plan.js';
import { composePromptEnhancementBody } from '../compose-enhancement.js';
import type { PromptEnhancementSourceRefV1 } from '../contracts.js';

// Render-once: the ten restoration templates are about to become user-visible
// having never executed. Each renders once here — cheap, deterministic, no key
// — and the fixture asserts every one of ITS never-rendered section kinds
// actually composes with non-empty text, so "never executed" becomes
// "executed and inspected". The kind sets are DERIVED from the registry at
// test time, never hand-listed.

const RESTORATION_INTENTS = [
  'review.security_review',
  'review.code_or_diff_review',
  'review.architecture_review',
  'review.test_review',
  'review.requirements_fit_review',
  'review.verification_request',
  'review.api_contract_review',
  'review.performance_review',
  'planning.rollout_release_plan',
  'planning.migration_plan',
] as const;

function kindsOf(preset: PromptEnhancementTaxonomyPreset): Set<string> {
  const kinds = new Set([
    ...preset.requiredSections,
    ...preset.optionalSections,
    ...preset.conditionalSections,
    ...preset.shorterMinimum,
    ...preset.moreThoroughAdds,
    ...preset.moreProjectGroundedAdds,
  ]);
  if (preset.baselineSourceSignalSlot !== 'not_applicable') kinds.add(preset.baselineSourceSignalSlot);
  return kinds;
}

const otherKinds = new Set<string>();
for (const preset of PROMPT_ENHANCEMENT_TAXONOMY_PRESETS) {
  if ((RESTORATION_INTENTS as readonly string[]).includes(preset.primaryIntent)) continue;
  for (const kind of kindsOf(preset)) otherKinds.add(kind);
}

function deadKindsFor(intent: PromptEnhancementPrimaryIntent): readonly string[] {
  const preset = PROMPT_ENHANCEMENT_TAXONOMY_PRESETS.find((entry) => entry.primaryIntent === intent);
  if (!preset) throw new Error(`missing preset for ${intent}`);
  return [...kindsOf(preset)].filter((kind) => !otherKinds.has(kind));
}

const sourceA: PromptEnhancementSourceRefV1 = {
  sourceRefId: 'source-a-current-prompt',
  sourceKind: 'source_a_user_prompt',
  sourceId: 'prompt:current',
  sourceAuthorization: 'implementation_input',
  evidenceStatus: 'present',
  freshness: 'current',
  confidence: 'high',
  privacyClass: 'local_private',
};

function targetingFact(kind: string, index: number): PromptEnhancementGuidanceFact {
  return {
    factId: `render-once-${index}-${kind}`,
    sourceType: 'absence_signal',
    sourceIds: [`absence:render_once_${kind}`],
    guidanceKind: 'missing_practice',
    suggestedActionKind: 'no_action_render_context_only',
    targetFamily: 'family_agnostic',
    targetSectionKind: kind,
    sourceEvidenceState: 'strong',
    priority: 'normal',
    renderPolicy: 'render_as_section',
    riskLevel: 'low',
    safetyHooks: [],
    privacyClass: 'public_safe',
    sanitizationState: 'not_applicable',
    publicCopySafe: true,
  };
}

function routeFor(intent: PromptEnhancementPrimaryIntent): PromptEnhancementRouteInput {
  return {
    routeDecisionId: `render-once-${intent}`,
    promptText: 'render the restored template once for inspection',
    currentStage: 'implementation',
    prevStage: 'task_breakdown',
    triggerKind: 'stage_transition',
    firedKey: 'stage_transition:task_breakdown→implementation',
    classifierState: 'fire_recommended',
    degradedNoActionState: 'none',
    generatedOriginState: 'ordinary_user_prompt',
    classifierPrimaryIntent: intent,
    classifierIntentConfidence: 0.9,
    classifierCapabilityCandidates: [],
    classifierDebugEvidencePresent: [],
  };
}

describe('render-once: every never-rendered section kind of the ten restoration templates composes', () => {
  it('the derived class matches the knowledge table: 59 kinds through the ten templates', () => {
    const total = new Set(RESTORATION_INTENTS.flatMap((intent) => deadKindsFor(intent)));
    expect(total.size).toBe(59);
  });

  for (const intent of RESTORATION_INTENTS) {
    it(`${intent}: renders once — all of its never-rendered kinds compose with non-empty text`, () => {
      const dead = deadKindsFor(intent);
      expect(dead.length).toBeGreaterThan(0);
      const route = routePromptEnhancement(routeFor(intent));
      expect(route.primaryIntent).toBe(intent);
      const planning = planPromptEnhancementSections({
        routeResult: route,
        sourceRefs: [sourceA],
        guidanceFacts: dead.map((kind, index) => targetingFact(kind, index)),
      });
      const compose = composePromptEnhancementBody({
        enhancementId: `render-once-${intent}`,
        originalPromptText: 'render the restored template once for inspection',
        sectionPlanningResult: planning,
      });
      const sections = compose.currentBody?.sections ?? [];
      for (const kind of dead) {
        const section = sections.find((entry) => entry.sectionKind === kind);
        expect(section, `dead kind '${kind}' did not render`).toBeDefined();
        expect(section!.bodyText.trim().length, `dead kind '${kind}' rendered empty`).toBeGreaterThan(0);
      }
    });
  }
});
