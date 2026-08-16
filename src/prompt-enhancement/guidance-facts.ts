import type { PromptEnhancementPrepareRequestV1 } from './contracts.js';
import type {
  PromptEnhancementGuidanceFact,
  PromptEnhancementGuidancePriority,
  PromptEnhancementClaimVerbPolicy,
} from './templates/section-plan.js';

/**
 * transform-rule-1 split 1 — guidance-fact builder (E2 / phase 2.1).
 *
 * Normalizes the request's already-collected source signals (E1 feeds) into typed
 * {@link PromptEnhancementGuidanceFact} records. This is the deterministic seam that
 * transform-rule-1 requires *before* {@link planPromptEnhancementSections} and *before* any
 * composer wording — no LLM, no direct copy of content-template option/whyDesc text.
 *
 * Scope of 2.1: construct + dedupe + rank the raw fact set with transform-rule-1-correct
 * required fields (sourceType / guidanceKind / priority / renderPolicy / risk /
 * privacy / sanitization). The transform-rule-2 dual-lane source-mix caps (2.2) and the
 * DR2-G1 gate (2.3) are applied on top of this list in their own sub-phases; the
 * `planPromptEnhancementSections` wiring is 2.5. Per-signal `suggestedActionKind`
 * refinement (absence -> verification vs reproduction, etc.) is eval-rule-3 / R1 data;
 * v1 defaults it safely to `no_action_render_context_only` where unknown.
 */
/**
 * Canonical missing-signal memory keys. The builder (write side) and the auto.ts
 * memory query (read side) MUST agree on these, or memory never suppresses a repeat
 * signal. Kept token-safe (no '>' etc.) because they become persisted memory keys.
 */
export function promptEnhancementStageSignalKeyV1(prevStage: string | undefined, currentStage: string): string {
  return `stage:${prevStage ?? 'unknown'}-to-${currentStage}`;
}

export function promptEnhancementAbsenceSignalKeyV1(absenceKey: string): string {
  return `absence:${absenceKey}`;
}

/**
 * The REGISTRY's claim-wording rule, computed from the corroboration tier that
 * crossed the boundary: practice wording only for behaviour-corroborated tier P,
 * capability wording for present-but-uncorroborated capabilities, possibility
 * wording otherwise. Deterministic — never model-assigned.
 */
export function claimVerbPolicyForCorroborationTier(
  tier: 'promoted_practice_P' | 'capability' | 'uncorroborated',
): PromptEnhancementClaimVerbPolicy {
  switch (tier) {
    case 'promoted_practice_P': return 'may_state_as_user_practice';
    case 'capability':          return 'may_state_as_project_capability';
    case 'uncorroborated':      return 'must_phrase_as_possibility';
  }
}

export function buildPromptEnhancementGuidanceFactsV1(
  request: PromptEnhancementPrepareRequestV1,
): readonly PromptEnhancementGuidanceFact[] {
  const signals = request.sourceSignals;
  const facts: PromptEnhancementGuidanceFact[] = [];
  let seq = 0;
  const nextId = (kind: string): string => `pe-fact-${kind}-${seq++}`;

  // Source A — the current review-moment trigger. This is the live stage/absence
  // Source-A candidate (analysis L5567): even when nothing is persisted in the
  // signal refs yet, a fresh stage transition or absence anchors the popup.
  const trigger = request.reviewMomentContext.triggerProvenance;
  if (trigger.triggerKind === 'stage_transition') {
    facts.push({
      factId: nextId('stage'),
      sourceType: 'stage_transition',
      sourceIds: [promptEnhancementStageSignalKeyV1(trigger.prevStage, trigger.currentStage)],
      guidanceKind: 'stage_transition_discipline',
      suggestedActionKind: 'no_action_render_context_only',
      targetFamily: 'family_agnostic',
      targetSectionKind: 'source_signal_guidance',
      sourceEvidenceState: 'strong',
      sourceOriginScope: 'current_prompt',
      claimVerbPolicy: 'must_phrase_as_source_signal',
      factRole: 'supporting_missing_practice',
      priority: 'high',
      renderPolicy: 'render_as_section',
      riskLevel: 'low',
      safetyHooks: [],
      privacyClass: 'public_safe',
      sanitizationState: 'not_applicable',
      publicCopySafe: true,
    });
  } else if (trigger.triggerKind === 'absence') {
    facts.push({
      factId: nextId('signal'),
      sourceType: 'absence_signal',
      sourceIds: [promptEnhancementAbsenceSignalKeyV1(trigger.selectedQualifyingAbsence ?? trigger.firedKey ?? trigger.currentStage)],
      guidanceKind: 'missing_practice',
      suggestedActionKind: 'no_action_render_context_only',
      targetFamily: 'family_agnostic',
      targetSectionKind: 'source_signal_guidance',
      sourceEvidenceState: 'strong',
      sourceOriginScope: 'current_prompt',
      claimVerbPolicy: 'must_phrase_as_source_signal',
      factRole: 'required_source_signal_survivor',
      priority: 'required_survivor',
      renderPolicy: 'render_as_section',
      riskLevel: 'low',
      safetyHooks: [],
      privacyClass: 'public_safe',
      sanitizationState: 'not_applicable',
      requiredBecause: 'source_signal_guidance_shown_in_popup',
      publicCopySafe: true,
    });
  }

  // Source A — required survivors. Stage/absence signals shown in the popup are
  // transform-rule-4/5/9 floors ("source/signal guidance in a shown popup"): must survive.
  for (const ref of signals.normalizedStageAbsenceSignalRefs) {
    facts.push({
      factId: nextId('signal'),
      sourceType: 'absence_signal',
      sourceIds: [ref],
      guidanceKind: 'missing_practice',
      suggestedActionKind: 'no_action_render_context_only',
      targetFamily: 'family_agnostic',
      targetSectionKind: 'source_signal_guidance',
      sourceEvidenceState: 'strong',
      sourceOriginScope: 'current_prompt',
      claimVerbPolicy: 'must_phrase_as_source_signal',
      factRole: 'required_source_signal_survivor',
      priority: 'required_survivor',
      renderPolicy: 'render_as_section',
      riskLevel: 'low',
      safetyHooks: [],
      privacyClass: 'public_safe',
      sanitizationState: 'not_applicable',
      requiredBecause: 'source_signal_guidance_shown_in_popup',
      publicCopySafe: true,
    });
  }

  // Source A — content-template records are source *evidence / precedent only*
  // (no direct copy of option/whyDesc); render as a supporting clause, not a body.
  for (const ref of signals.contentTemplateRecordFactRefs) {
    facts.push({
      factId: nextId('ctpl'),
      sourceType: 'content_template_record',
      sourceIds: [ref],
      guidanceKind: 'source_signal_guidance',
      suggestedActionKind: 'no_action_render_context_only',
      targetFamily: 'family_agnostic',
      targetSectionKind: 'source_signal_guidance',
      sourceEvidenceState: 'partial',
      sourceOriginScope: 'content_template_registry',
      claimVerbPolicy: 'must_phrase_as_source_signal',
      factRole: 'supporting_missing_practice',
      priority: 'normal',
      renderPolicy: 'render_as_inline_clause',
      riskLevel: 'none',
      safetyHooks: [],
      privacyClass: 'local_private',
      sanitizationState: 'not_applicable',
      mergePolicy: 'merge_as_supporting_clause',
      wordingHintPolicy: 'use_template_topic_anchor',
      publicCopySafe: true,
    });
  }

  // Source A — persistent missing-signal memory (populated by E3). Shape is ready
  // now per transform-rule-1: frequency/recency/confidence/fatigue must fit the same record.
  for (const ref of signals.missingMemoryCandidateRefs) {
    facts.push({
      factId: nextId('mem'),
      sourceType: 'persistent_missing_signal_memory',
      sourceIds: [ref],
      guidanceKind: 'missing_practice',
      suggestedActionKind: 'no_action_render_context_only',
      targetFamily: 'family_agnostic',
      targetSectionKind: 'source_signal_guidance',
      sourceEvidenceState: 'partial',
      sourceOriginScope: 'stored_memory',
      claimVerbPolicy: 'must_phrase_as_source_signal',
      factRole: 'supporting_missing_practice',
      priority: 'normal',
      renderPolicy: 'render_as_section',
      riskLevel: 'low',
      safetyHooks: [],
      privacyClass: 'local_private',
      sanitizationState: 'identity_only_event',
      publicCopySafe: true,
    });
  }

  // Source B — hard facts (env-derived project grounding). Bounded grounding, not
  // a required survivor; transform-rule-2 (2.2) owns final relevance/priority mixing.
  // Claim wording comes from the corroboration tier that crossed the boundary, and
  // POLARITY routes the role: a FALSE capability is safety material, never grounding;
  // an unknown probe stays stale_or_unknown — never a confident negative.
  for (const ref of signals.sourceOnlyHardFactRefs) {
    const tier = signals.groundingTierByRef?.[ref] ?? 'uncorroborated';
    const polarity = signals.groundingPolarityByRef?.[ref] ?? 'present';
    const isFalseCapability = polarity === 'false_capability';
    const isUnknown = polarity === 'unknown';
    facts.push({
      factId: nextId('hard'),
      sourceType: 'hard_fact',
      sourceIds: [ref],
      guidanceKind: 'project_grounding',
      suggestedActionKind: 'ground_in_project_fact',
      targetFamily: 'family_agnostic',
      targetSectionKind: '',
      sourceEvidenceState: isUnknown ? 'stale_or_unknown' : 'strong',
      sourceOriginScope: 'local_probe',
      claimVerbPolicy: isFalseCapability
        ? 'source_label_only'
        : isUnknown
          ? 'must_phrase_as_possibility'
          : claimVerbPolicyForCorroborationTier(tier),
      factRole: isFalseCapability ? 'safety_confirmation_support' : 'project_grounding_support',
      priority: 'normal',
      renderPolicy: isFalseCapability ? 'metadata_only' : 'render_as_section',
      riskLevel: 'none',
      safetyHooks: isFalseCapability ? ['pe_ar9_negative_capability'] : [],
      privacyClass: 'local_private',
      sanitizationState: 'not_applicable',
      publicCopySafe: true,
    });
  }

  // RIGHT&GOOD / work-style / env-runtime profile signals.
  for (const ref of signals.rightGoodWorkStyleEnvRuntimeRefs) {
    if (ref.startsWith('mistake:')) {
      // A recurring mistake is a negative-capability signal: a missing practice, so
      // it belongs in Source A (fix-plan §4b), NOT the positive Source-B pattern lane.
      facts.push({
        factId: nextId('mistake'),
        sourceType: 'absence_signal',
        sourceIds: [ref],
        guidanceKind: 'missing_practice',
        suggestedActionKind: 'no_action_render_context_only',
        targetFamily: 'family_agnostic',
        targetSectionKind: 'source_signal_guidance',
        sourceEvidenceState: 'partial',
        sourceOriginScope: 'longitudinal_param_events',
        claimVerbPolicy: 'must_phrase_as_source_signal',
        factRole: 'supporting_missing_practice',
        priority: 'normal',
        renderPolicy: 'render_as_section',
        riskLevel: 'low',
        safetyHooks: [],
        privacyClass: 'local_private',
        sanitizationState: 'identity_only_event',
        publicCopySafe: true,
      });
      continue;
    }
    // Positive RIGHT&GOOD and work-style signals are weak Source-B tie-breakers only
    // (transform-rule-1): they adapt register/emphasis, never override instructions/safety/
    // routing. Render as metadata, not their own section.
    const isWorkStyle = ref.startsWith('work_style:');
    // RIGHT&GOOD claim strength follows the boundary's corroboration tier: practice
    // wording only when behaviour-verified; work-style stays style metadata.
    const profileTier = signals.groundingTierByRef?.[ref] ?? 'uncorroborated';
    facts.push({
      factId: nextId('profile'),
      sourceType: isWorkStyle ? 'work_style_fact' : 'right_good_pattern',
      sourceIds: [ref],
      guidanceKind: 'positive_practice_preservation',
      suggestedActionKind: isWorkStyle ? 'no_action_render_context_only' : 'preserve_behavior',
      targetFamily: 'family_agnostic',
      targetSectionKind: '',
      sourceEvidenceState: 'partial',
      sourceOriginScope: 'longitudinal_param_events',
      claimVerbPolicy: isWorkStyle
        ? 'source_label_only'
        : profileTier === 'promoted_practice_P'
          ? 'may_state_as_user_practice'
          : 'must_phrase_as_possibility',
      factRole: isWorkStyle ? 'neutral_style_support' : 'positive_practice_preservation',
      priority: 'low',
      renderPolicy: 'metadata_only',
      riskLevel: 'none',
      safetyHooks: [],
      privacyClass: 'local_private',
      sanitizationState: 'identity_only_event',
      registerRoleSource: 'profile_register',
      publicCopySafe: true,
    });
  }

  return rankGuidanceFacts(dedupeGuidanceFacts(facts));
}

const GUIDANCE_PRIORITY_RANK: Record<PromptEnhancementGuidancePriority, number> = {
  required_survivor: 0,
  high: 1,
  normal: 2,
  low: 3,
  handoff_only: 4,
  deferred_to_ds: 5,
  suppressed: 6,
};

/** Drop duplicate facts that share source type + source id (same evidence twice). */
function dedupeGuidanceFacts(
  facts: readonly PromptEnhancementGuidanceFact[],
): readonly PromptEnhancementGuidanceFact[] {
  const seen = new Set<string>();
  return facts.filter((fact) => {
    const key = `${fact.sourceType}:${fact.sourceIds.join(',')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Stable rank: required survivors first, then high/normal/low. Preserves input order within a tier. */
function rankGuidanceFacts(
  facts: readonly PromptEnhancementGuidanceFact[],
): readonly PromptEnhancementGuidanceFact[] {
  return facts
    .map((fact, index) => ({ fact, index }))
    .sort((a, b) => {
      const byPriority = GUIDANCE_PRIORITY_RANK[a.fact.priority] - GUIDANCE_PRIORITY_RANK[b.fact.priority];
      return byPriority !== 0 ? byPriority : a.index - b.index;
    })
    .map((entry) => entry.fact);
}
