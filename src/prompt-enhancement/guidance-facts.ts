import type { PromptEnhancementPrepareRequestV1 } from './contracts.js';
import type {
  PromptEnhancementGuidanceFact,
  PromptEnhancementGuidancePriority,
} from './templates/section-plan.js';

/**
 * PE-AR-1 split 1 — guidance-fact builder (E2 / phase 2.1).
 *
 * Normalizes the request's already-collected source signals (E1 feeds) into typed
 * {@link PromptEnhancementGuidanceFact} records. This is the deterministic seam that
 * PE-AR-1 requires *before* {@link planPromptEnhancementSections} and *before* any
 * composer wording — no LLM, no direct copy of content-template option/whyDesc text.
 *
 * Scope of 2.1: construct + dedupe + rank the raw fact set with PE-AR-1-correct
 * required fields (sourceType / guidanceKind / priority / renderPolicy / risk /
 * privacy / sanitization). The PE-AR-2 dual-lane source-mix caps (2.2) and the
 * DR2-G1 gate (2.3) are applied on top of this list in their own sub-phases; the
 * `planPromptEnhancementSections` wiring is 2.5. Per-signal `suggestedActionKind`
 * refinement (absence -> verification vs reproduction, etc.) is PE-EM-3 / R1 data;
 * v1 defaults it safely to `no_action_render_context_only` where unknown.
 */
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
      // Token-safe separator ('>' is not a public-safe token char, and this id
      // becomes a persisted memory signal key in E3).
      sourceIds: [`stage:${trigger.prevStage ?? 'unknown'}-to-${trigger.currentStage}`],
      guidanceKind: 'stage_transition_discipline',
      suggestedActionKind: 'no_action_render_context_only',
      targetFamily: 'family_agnostic',
      targetSectionKind: 'source_signal_guidance',
      sourceEvidenceState: 'strong',
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
      sourceIds: [`absence:${trigger.selectedQualifyingAbsence ?? trigger.firedKey ?? trigger.currentStage}`],
      guidanceKind: 'missing_practice',
      suggestedActionKind: 'no_action_render_context_only',
      targetFamily: 'family_agnostic',
      targetSectionKind: 'source_signal_guidance',
      sourceEvidenceState: 'strong',
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
  // PE-AR-4/5/9 floors ("source/signal guidance in a shown popup"): must survive.
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
  // now per PE-AR-1: frequency/recency/confidence/fatigue must fit the same record.
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
  // a required survivor; PE-AR-2 (2.2) owns final relevance/priority mixing.
  for (const ref of signals.sourceOnlyHardFactRefs) {
    facts.push({
      factId: nextId('hard'),
      sourceType: 'hard_fact',
      sourceIds: [ref],
      guidanceKind: 'project_grounding',
      suggestedActionKind: 'ground_in_project_fact',
      targetFamily: 'family_agnostic',
      targetSectionKind: '',
      sourceEvidenceState: 'strong',
      priority: 'normal',
      renderPolicy: 'render_as_section',
      riskLevel: 'none',
      safetyHooks: [],
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
    // (PE-AR-1): they adapt register/emphasis, never override instructions/safety/
    // routing. Render as metadata, not their own section.
    const isWorkStyle = ref.startsWith('work_style:');
    facts.push({
      factId: nextId('profile'),
      sourceType: isWorkStyle ? 'work_style_fact' : 'right_good_pattern',
      sourceIds: [ref],
      guidanceKind: 'positive_practice_preservation',
      suggestedActionKind: isWorkStyle ? 'no_action_render_context_only' : 'preserve_behavior',
      targetFamily: 'family_agnostic',
      targetSectionKind: '',
      sourceEvidenceState: 'partial',
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
