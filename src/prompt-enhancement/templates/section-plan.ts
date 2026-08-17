import {
  PROMPT_ENHANCEMENT_CONTRACT_VERSION,
  type PromptEnhancementBodyPlanV1,
  type PromptEnhancementCallVisibilityMode,
  type PromptEnhancementEvidenceStatus,
  type PromptEnhancementFallbackMode,
  type PromptEnhancementSectionPlanItemV1,
  type PromptEnhancementSourceKind,
  type PromptEnhancementSourceRefV1,
  type PromptEnhancementValidationStatus,
} from '../contracts.js';
import type {
  PromptEnhancementCapabilityId,
  PromptEnhancementFamilyId,
  PromptEnhancementPrimaryIntent,
  PromptEnhancementRouteResult,
} from '../routing-taxonomy.js';
import { getPromptEnhancementTemplateByIntent } from './registry.js';

export type PromptEnhancementGuidanceSourceType =
  | 'stage_transition'
  | 'absence_signal'
  | 'content_template_record'
  | 'content_template_runtime_fact'
  | 'persistent_missing_signal_memory'
  | 'hard_fact'
  | 'right_good_pattern'
  | 'work_style_fact'
  | 'prompt_derived_fact';

/**
 * WHERE the fact's knowledge came from. Origin scope controls claim strength: a fact
 * known only from the current prompt must never pose as independent project knowledge,
 * and its claim policy is clamped accordingly at source mixing.
 */
export type PromptEnhancementSourceOriginScope =
  | 'current_prompt'
  | 'recent_prompt_history'
  | 'local_probe'
  | 'longitudinal_param_events'
  | 'served_variant_identity'
  | 'transcript_corroboration'
  | 'stored_memory'
  | 'content_template_registry'
  | 'content_template_runtime'
  | 'original_point_inventory';

/**
 * The strongest wording the composer may use for this fact. Assigned deterministically
 * from corroboration tier + origin scope — no generated claim may exceed it.
 */
export type PromptEnhancementClaimVerbPolicy =
  | 'may_state_as_user_practice'
  | 'may_state_as_project_capability'
  | 'must_have_behaviour_verified_practice'
  | 'must_phrase_as_possibility'
  | 'must_phrase_as_source_signal'
  | 'source_label_only'
  | 'do_not_render';

/**
 * WHAT the fact's knowledge is anchored to. Anchor shapes wording: a machine fact
 * must never be worded as project architecture, a project fact never as user
 * behaviour, and an unknown anchor suppresses certainty.
 */
export type PromptEnhancementSourceAnchorScope =
  | 'machine_environment'
  | 'project_root'
  | 'session_behavior'
  | 'longitudinal_user_behavior'
  | 'current_prompt_scope'
  | 'content_template_scope'
  | 'unknown_anchor';

/**
 * The fact's role in the composed body. Polarity routes it: a FALSE capability is
 * safety material (`safety_confirmation_support`), never project grounding.
 */
export type PromptEnhancementFactRole =
  | 'required_source_signal_survivor'
  | 'supporting_missing_practice'
  | 'project_grounding_support'
  | 'positive_practice_preservation'
  | 'neutral_style_support'
  | 'safety_confirmation_support'
  | 'served_variant_provenance_only'
  | 'source_label_only'
  | 'suppressed'
  | 'deferred';

export type PromptEnhancementGuidanceKind =
  | 'missing_practice'
  | 'stage_transition_discipline'
  | 'source_signal_guidance'
  | 'project_grounding'
  | 'positive_practice_preservation'
  | 'safety_or_confirmation'
  | 'requirement_source_state'
  | 'debug_evidence'
  | 'maintenance_preservation'
  | 'review_verification';

export type PromptEnhancementSuggestedActionKind =
  | 'clarify_requirement'
  | 'add_acceptance_criteria'
  | 'add_verification'
  | 'capture_reproduction'
  | 'preserve_behavior'
  | 'confirm_risk'
  | 'plan_rollback'
  | 'ground_in_project_fact'
  | 'ask_for_source'
  | 'handoff_sequence'
  | 'no_action_render_context_only';

export type PromptEnhancementGuidancePriority =
  | 'required_survivor'
  | 'high'
  | 'normal'
  | 'low'
  | 'suppressed'
  | 'handoff_only'
  | 'deferred_to_ds';

export type PromptEnhancementGuidanceRenderPolicy =
  | 'render_as_section'
  | 'render_as_inline_clause'
  | 'metadata_only'
  | 'why_help_only'
  | 'fallback_only'
  | 'suppress_with_reason'
  | 'defer_to_normal_ds';

export interface PromptEnhancementGuidanceFact {
  factId: string;
  sourceType: PromptEnhancementGuidanceSourceType;
  sourceIds: readonly string[];
  guidanceKind: PromptEnhancementGuidanceKind;
  suggestedActionKind: PromptEnhancementSuggestedActionKind;
  targetFamily: PromptEnhancementFamilyId | 'family_agnostic';
  targetSectionKind: string;
  sourceEvidenceState: 'strong' | 'partial' | 'weak_low_risk' | 'weak_source_critical' | 'conflicting' | 'missing' | 'stale_or_unknown';
  priority: PromptEnhancementGuidancePriority;
  renderPolicy: PromptEnhancementGuidanceRenderPolicy;
  riskLevel: 'none' | 'low' | 'medium' | 'high' | 'sensitive_authority_risky';
  safetyHooks: readonly string[];
  privacyClass:
    | 'public_safe'
    | 'local_private'
    | 'sensitive_ref_only'
    | 'do_not_render'
    // The locked sensitivity treatments: generalize the wording, suppress the
    // content, or route through confirmation — content gates honour all three.
    | 'sensitive_generalize'
    | 'sensitive_suppress'
    | 'requires_confirmation';
  sanitizationState: 'not_applicable' | 'redacted_prompt_store' | 'prompt_derived_sanitized' | 'identity_only_event' | 'sensitive_ref_only' | 'unsafe_to_render';
  /**
   * Tier-1 evidence fields. Optional on the raw producer layer for compatibility;
   * REQUIRED at source mixing — the mixer normalizes every entering fact so none is
   * selected without them, and the registry (never a model) assigns the claim policy.
   */
  sourceOriginScope?: PromptEnhancementSourceOriginScope;
  claimVerbPolicy?: PromptEnhancementClaimVerbPolicy;
  factRole?: PromptEnhancementFactRole;
  /**
   * The fact's resolved CONTENT — a generic key/value pair, resolved by the CALLER
   * at the source boundary (never by PE reaching back out) and carried WITH the
   * fact so its gates travel with it. Absent when the fact is reference-only
   * (`sensitive_ref_only`) or unrenderable — those never cross with content.
   */
  evidence?: { readonly key: string; readonly value: string };
  sourceAnchorScope?: PromptEnhancementSourceAnchorScope;
  /** Monorepo/nested-root truth — must SURVIVE source mixing when present. */
  anchoredRoot?: string;
  projectShape?: string;
  /** Where the resolution actually happened — stamped at the boundary. */
  sourceRuntimePath?:
    | 'local_static'
    | 'local_store'
    | 'local_probe'
    | 'local_read_model'
    | 'runtime_llm_param_extract'
    | 'runtime_llm_grounding'
    | 'runtime_autogen'
    | 'unknown';
  requiredBecause?: string;
  signalAliasResolution?: string;
  servedVariantRef?: string;
  pinchQuestionSourceState?: 'signal-pinch-fields' | 'content-template-record' | 'why-help-by-signal-type' | 'future_contract_registry';
  registerRoleSource?: 'none' | 'profile_register' | 'configured_role' | 'content_template_register_override' | 'content_template_role_override' | 'runtime_selection_register';
  wordingHintPolicy?: 'none' | 'use_signal_description_as_intent' | 'use_template_topic_anchor' | 'use_template_register_precedent' | 'use_role_precedent' | 'use_user_language_lightly' | 'llm_rewrite_allowed' | 'do_not_use_wording_hint';
  wordingHintSourceIds?: readonly string[];
  profileContextRefs?: readonly string[];
  mergePolicy?: 'standalone' | 'merge_with_same_practice' | 'merge_into_section' | 'merge_as_supporting_clause' | 'do_not_merge';
  mergeGroupId?: string;
  mergedIntoFactId?: string;
  shortenPolicy?: 'may_shorten_wording' | 'may_collapse_to_clause' | 'may_move_to_why_help' | 'must_preserve_full_meaning' | 'do_not_shorten';
  shortenFloor?: 'source_ref_only' | 'one_clause' | 'one_bullet' | 'section_summary' | 'full_section';
  publicCopySafe: boolean;
  llmCallPolicy?: 'not_applicable_deterministic' | 'requires_cost_visible_row';
}

export interface PromptEnhancementSectionPlanningInput {
  routeResult: PromptEnhancementRouteResult;
  sourceRefs: readonly PromptEnhancementSourceRefV1[];
  guidanceFacts?: readonly PromptEnhancementGuidanceFact[];
}

export interface PromptEnhancementSectionPlanningResult {
  bodyPlan: PromptEnhancementBodyPlanV1;
  sectionPlans: readonly PromptEnhancementSectionPlanItemV1[];
  routeDecisionId: string;
  promptReviewOrigin: PromptEnhancementRouteResult['contractDecision']['promptReviewOrigin'];
  promptReviewProcessingPolicy: PromptEnhancementRouteResult['contractDecision']['promptReviewProcessingPolicy'];
  renderedFactIds: readonly string[];
  metadataOnlyFactIds: readonly string[];
  suppressedFactIds: readonly string[];
  deferredFactIds: readonly string[];
  registryNamespace: 'prompt-enhancement-templates';
  sourcePriorityState: 'source_a_first';
  contentTemplateFactsAreSourceBOnly: true;
  exposesPrecomputedVariants: false;
  usesOldDecisionSessionTemplateRecord: false;
  usesPeOnlyClassifier: false;
}

const SECTION_KIND_BY_ACTION: Record<PromptEnhancementSuggestedActionKind, string> = {
  clarify_requirement: 'uncertainty_or_clarification',
  add_acceptance_criteria: 'acceptance_or_output_expectation',
  add_verification: 'verification_or_test_plan',
  capture_reproduction: 'reproduction_or_evidence',
  preserve_behavior: 'behavior_preservation',
  confirm_risk: 'risk_safety_or_confirmation',
  plan_rollback: 'risk_safety_or_confirmation',
  ground_in_project_fact: 'project_grounding_facts',
  ask_for_source: 'requirement_source_state',
  handoff_sequence: 'handoff_or_sequence_candidate',
  no_action_render_context_only: 'context_and_constraints',
};

const SOURCE_KIND_BY_GUIDANCE_SOURCE: Record<PromptEnhancementGuidanceSourceType, PromptEnhancementSourceKind> = {
  stage_transition: 'stage_or_absence_signal',
  absence_signal: 'stage_or_absence_signal',
  content_template_record: 'content_template_fact',
  content_template_runtime_fact: 'content_template_fact',
  persistent_missing_signal_memory: 'prompt_enhancement_memory',
  hard_fact: 'hard_fact_or_profile_signal',
  right_good_pattern: 'hard_fact_or_profile_signal',
  work_style_fact: 'hard_fact_or_profile_signal',
  prompt_derived_fact: 'source_a_user_prompt',
};

/**
 * The slot-effect vocabulary, typed from each capability's locked "adds"
 * column. An obligation is what the attached capability requires its target
 * section to CONTAIN or GUARANTEE — the composer, the post-compose checks and
 * the fixtures all read the same typed value instead of prose.
 */
export type PromptEnhancementSlotObligationV1 =
  | 'reproduction_or_evidence_request'
  | 'no_invention_state'
  | 'behavior_lock'
  | 'baseline_current_output_proof'
  | 'no_unrelated_change_boundary'
  | 'before_after_verification'
  | 'review_checklist_challenge'
  | 'severity_residual_risk'
  | 'project_source_fact_slots'
  | 'known_unknown_wording'
  | 'source_ids_evidence_state'
  | 'confirmation_clarification'
  | 'send_policy_metadata'
  | 'safety_hook_linkage'
  | 'family_specific_verification'
  | 'risk_rollback_recovery'
  | 'dry_run_backup_pin_deployment'
  | 'safety_policy_hooks'
  | 'decomposition_handoff_metadata'
  | 'compact_first_popup_summary_support'
  | 'ordering_dependency'
  | 'baseline_source_signal'
  | 'source_kind_id_evidence_metadata'
  | 'public_safe_why_help_support';

/**
 * The slot-adds map — layer 3 of the capability design, NEW and named for one
 * meaning only (the flag-scoping map above it stays a flag-scoping map; one
 * map, one meaning). Each attached capability places its locked obligations on
 * its target section kind; the shape follows the one shipped slot precedent
 * (the baseline source-signal slot). The reproduction/evidence slot is FIRST —
 * its no-invention state is the typed answer to the fabrication defect, and
 * its slot is the one this design opened on.
 */
export const SLOT_EFFECTS_BY_CAPABILITY_V1: Partial<Record<PromptEnhancementCapabilityId, {
  targetSectionKind: string;
  obligations: readonly PromptEnhancementSlotObligationV1[];
}>> = {
  'capability.reproduction_or_evidence_needed': {
    targetSectionKind: 'reproduction_or_evidence',
    obligations: ['reproduction_or_evidence_request', 'no_invention_state'],
  },
  'capability.behavior_preservation': {
    targetSectionKind: 'behavior_preservation',
    obligations: ['behavior_lock', 'baseline_current_output_proof', 'no_unrelated_change_boundary', 'before_after_verification'],
  },
  'capability.adversarial_review': {
    targetSectionKind: 'finding_format',
    obligations: ['review_checklist_challenge', 'severity_residual_risk'],
  },
  'capability.project_grounding': {
    targetSectionKind: 'project_grounding_facts',
    obligations: ['project_source_fact_slots', 'known_unknown_wording', 'source_ids_evidence_state'],
  },
  'capability.confirmation_needed': {
    targetSectionKind: 'risk_safety_or_confirmation',
    obligations: ['confirmation_clarification', 'send_policy_metadata', 'safety_hook_linkage'],
  },
  'capability.verification_required': {
    targetSectionKind: 'verification_or_test_plan',
    obligations: ['family_specific_verification'],
  },
  'capability.risk_or_rollback': {
    targetSectionKind: 'risk_safety_or_confirmation',
    obligations: ['risk_rollback_recovery', 'dry_run_backup_pin_deployment', 'safety_policy_hooks'],
  },
  'capability.decomposition_candidate': {
    targetSectionKind: 'point_inventory_or_decomposition',
    obligations: ['decomposition_handoff_metadata', 'compact_first_popup_summary_support', 'ordering_dependency'],
  },
  'capability.source_signal_guidance': {
    targetSectionKind: 'source_signal_guidance',
    obligations: ['baseline_source_signal', 'source_kind_id_evidence_metadata', 'public_safe_why_help_support'],
  },
};

function slotObligationsFor(
  sectionKind: string,
  capabilityOverlays: readonly PromptEnhancementCapabilityId[],
): readonly PromptEnhancementSlotObligationV1[] {
  const obligations = new Set<PromptEnhancementSlotObligationV1>();
  for (const capability of capabilityOverlays) {
    const effect = SLOT_EFFECTS_BY_CAPABILITY_V1[capability];
    if (effect && effect.targetSectionKind === sectionKind) {
      for (const obligation of effect.obligations) obligations.add(obligation);
    }
  }
  return [...obligations];
}

const SECTION_REQUIRED_BY_CAPABILITY: Partial<Record<PromptEnhancementCapabilityId, string>> = {
  'capability.decomposition_candidate': 'point_inventory_or_decomposition',
  'capability.confirmation_needed': 'risk_safety_or_confirmation',
  'capability.adversarial_review': 'finding_format',
  'capability.project_grounding': 'project_grounding_facts',
  'capability.verification_required': 'verification_or_test_plan',
  'capability.risk_or_rollback': 'risk_safety_or_confirmation',
  'capability.reproduction_or_evidence_needed': 'reproduction_or_evidence',
  'capability.behavior_preservation': 'behavior_preservation',
  'capability.source_signal_guidance': 'source_signal_guidance',
};

export function planPromptEnhancementSections(
  input: PromptEnhancementSectionPlanningInput,
): PromptEnhancementSectionPlanningResult {
  const route = input.routeResult;
  const template = getPromptEnhancementTemplateByIntent(route.primaryIntent);
  const sourceA = sourceARef(input.sourceRefs);
  const facts = normalizeGuidanceFacts(input.guidanceFacts ?? []);
  const candidateSectionKinds = orderedUnique([
    'original_request_or_goal',
    ...template.requiredSections,
    ...route.capabilityOverlays.map((capability) => SECTION_REQUIRED_BY_CAPABILITY[capability]).filter(isString),
    ...facts.filter(isRenderableFact).map(sectionKindForFact),
  ]);

  if (route.noPopup) {
    return {
      bodyPlan: {
        bodyPlanId: `${route.contractDecision.routeDecisionId}:body-plan`,
        bodyRevision: 1,
        routeDecisionId: route.contractDecision.routeDecisionId,
        orderedSectionPlans: [],
        originalPromptPreservation: 'fallback_original_only',
        groundedSourceGuidancePolicy: 'explicit_fallback_reason',
        generatedOriginPolicy: 'attach_generated_origin_metadata',
        futurePromptTextPolicy: 'not_generated_not_stored_not_rendered',
        exposesPrecomputedVariants: false,
      },
      sectionPlans: [],
      routeDecisionId: route.contractDecision.routeDecisionId,
      promptReviewOrigin: route.contractDecision.promptReviewOrigin,
      promptReviewProcessingPolicy: route.contractDecision.promptReviewProcessingPolicy,
      renderedFactIds: [],
      metadataOnlyFactIds: facts.filter(isMetadataOnlyFact).map((fact) => fact.factId),
      suppressedFactIds: facts.filter(isSuppressedFact).map((fact) => fact.factId),
      deferredFactIds: facts.filter(isDeferredFact).map((fact) => fact.factId),
      registryNamespace: 'prompt-enhancement-templates',
      sourcePriorityState: 'source_a_first',
      contentTemplateFactsAreSourceBOnly: true,
      exposesPrecomputedVariants: false,
      usesOldDecisionSessionTemplateRecord: false,
      usesPeOnlyClassifier: false,
    };
  }

  const sectionPlans = candidateSectionKinds.map((sectionKind, index) =>
    buildSectionPlan({
      route,
      templateId: template.id,
      sectionKind,
      order: index + 1,
      sourceRefs: input.sourceRefs,
      sourceA,
      facts,
      required: template.requiredSections.includes(sectionKind) || sectionKind === 'original_request_or_goal',
    }),
  );
  const bodyPlan: PromptEnhancementBodyPlanV1 = {
    bodyPlanId: `${route.contractDecision.routeDecisionId}:body-plan`,
    bodyRevision: 1,
    routeDecisionId: route.contractDecision.routeDecisionId,
    orderedSectionPlans: sectionPlans,
    originalPromptPreservation: 'visible_verbatim',
    groundedSourceGuidancePolicy: template.baselineSourceSignalSlot === 'not_applicable'
      ? 'explicit_fallback_reason'
      : 'required_when_popup_shown',
    generatedOriginPolicy: 'attach_generated_origin_metadata',
    futurePromptTextPolicy: 'not_generated_not_stored_not_rendered',
    exposesPrecomputedVariants: false,
  };

  return {
    bodyPlan,
    sectionPlans,
    routeDecisionId: route.contractDecision.routeDecisionId,
    promptReviewOrigin: route.contractDecision.promptReviewOrigin,
    promptReviewProcessingPolicy: route.contractDecision.promptReviewProcessingPolicy,
    renderedFactIds: facts.filter(isRenderableFact).map((fact) => fact.factId),
    metadataOnlyFactIds: facts.filter(isMetadataOnlyFact).map((fact) => fact.factId),
    suppressedFactIds: facts.filter(isSuppressedFact).map((fact) => fact.factId),
    deferredFactIds: facts.filter(isDeferredFact).map((fact) => fact.factId),
    registryNamespace: 'prompt-enhancement-templates',
    sourcePriorityState: 'source_a_first',
    contentTemplateFactsAreSourceBOnly: true,
    exposesPrecomputedVariants: false,
    usesOldDecisionSessionTemplateRecord: false,
    usesPeOnlyClassifier: false,
  };
}

function buildSectionPlan(input: {
  route: PromptEnhancementRouteResult;
  templateId: string;
  sectionKind: string;
  order: number;
  sourceRefs: readonly PromptEnhancementSourceRefV1[];
  sourceA: PromptEnhancementSourceRefV1;
  facts: readonly PromptEnhancementGuidanceFact[];
  required: boolean;
}): PromptEnhancementSectionPlanItemV1 {
  const matchingFacts = input.facts.filter((fact) => isRenderableFact(fact) && sectionKindForFact(fact) === input.sectionKind);
  const sourceRefs = selectSourceRefs(input.sectionKind, input.sourceRefs, input.sourceA, matchingFacts);
  const sourceKind = sourceKindForSection(input.sectionKind, matchingFacts, sourceRefs);
  const sourceEvidenceStatus = evidenceStatusFor(input.route.routeConfidence, matchingFacts);
  const fallbackMode = fallbackModeFor(input.route.fallbackMode);

  return {
    sectionPlanId: `${input.route.contractDecision.routeDecisionId}:section-plan:${input.order}:${input.sectionKind}`,
    sectionId: `${input.route.contractDecision.routeDecisionId}:section:${input.order}:${input.sectionKind}`,
    sectionKind: input.sectionKind,
    templateId: input.templateId,
    familyId: input.route.familyId,
    primaryIntent: input.route.primaryIntent,
    order: input.order,
    sourceRefs,
    sourceKind,
    sourceIds: sourceRefs.map((ref) => ref.sourceId),
    sourceEvidenceStatus,
    slotEvidenceStatus: slotEvidenceStatusFor(input.sectionKind, sourceEvidenceStatus, matchingFacts),
    slotObligations: slotObligationsFor(input.sectionKind, input.route.capabilityOverlays),
    baselineSourceSignalSlot: input.route.selectedPreset.baselineSourceSignalSlot,
    requirementSourceStatus: requirementSourceStatusFor(input.route.familyId, input.sectionKind, matchingFacts),
    isRequired: input.required || isMandatorySurvivorSection(input.sectionKind, input.route.capabilityOverlays, matchingFacts),
    isEditable: true,
    removalFeedbackPolicy: 'typed_event_required',
    safetyFlags: safetyFlagsFor(input.sectionKind, input.route.capabilityOverlays, matchingFacts),
    sensitivityFlags: sensitivityFlagsFor(matchingFacts),
    validationStatus: validationStatusFor(input.route.noPopup),
    fallbackMode,
    callVisibilityMode: callVisibilityModeFor(input.route.selectedPreset.callVisibilityMode),
    deterministicTextBasisPolicy: 'structured_parts',
    textDraftRef: `composer_pending:${input.sectionKind}`,
    // The section's why-help refs (they surface as whyHelpReasonCodes on the
    // composed section). An under-evidenced route that still shows did so ONLY
    // through the gate's locked high-risk exception — the public-safe reason
    // code rides this EXISTING surface so the popup can explain itself; the
    // label wording for it is content, owned elsewhere. Codes only, no text.
    structuredContentPartRefs: [
      ...(matchingFacts.length > 0
        ? matchingFacts.map((fact) => `guidance_fact:${fact.factId}`)
        : [`section_kind:${input.sectionKind}`]),
      ...(input.route.ladderResolution.state === 'under_evidenced'
        ? ['gate_reason:under_evidenced_high_risk_exception']
        : []),
    ],
    supportedActions: ['use_current_body', 'use_original', 'shorter', 'more_thorough', 'more_project_grounded', 'apply_details'],
    contentTemplateRuntimeSeamUse: 'none',
    handoffCapabilityFlags: input.route.capabilityOverlays.includes('capability.decomposition_candidate')
      ? ['metadata_only_no_sequence_runtime']
      : ['no_runtime_sequence_v1'],
  };
}

export function normalizeGuidanceFacts(
  facts: readonly PromptEnhancementGuidanceFact[],
): readonly PromptEnhancementGuidanceFact[] {
  return facts.map((fact) => ({
    ...fact,
    targetSectionKind: fact.targetSectionKind || SECTION_KIND_BY_ACTION[fact.suggestedActionKind],
    mergePolicy: fact.mergePolicy ?? 'standalone',
    shortenPolicy: fact.shortenPolicy ?? (fact.priority === 'required_survivor' ? 'must_preserve_full_meaning' : 'may_shorten_wording'),
    shortenFloor: fact.shortenFloor ?? (fact.priority === 'required_survivor' ? 'section_summary' : 'one_clause'),
    registerRoleSource: fact.registerRoleSource ?? 'none',
    wordingHintPolicy: fact.wordingHintPolicy ?? 'do_not_use_wording_hint',
    wordingHintSourceIds: fact.wordingHintSourceIds ?? [],
    profileContextRefs: fact.profileContextRefs ?? [],
    llmCallPolicy: fact.llmCallPolicy ?? 'not_applicable_deterministic',
  }));
}

function sectionKindForFact(fact: PromptEnhancementGuidanceFact): string {
  return fact.targetSectionKind || SECTION_KIND_BY_ACTION[fact.suggestedActionKind];
}

function sourceARef(sourceRefs: readonly PromptEnhancementSourceRefV1[]): PromptEnhancementSourceRefV1 {
  const sourceA = sourceRefs.find((ref) => ref.sourceKind === 'source_a_user_prompt');
  if (!sourceA) {
    throw new Error('Phase 4 section planning requires a Source A original prompt ref');
  }
  return sourceA;
}

function selectSourceRefs(
  sectionKind: string,
  sourceRefs: readonly PromptEnhancementSourceRefV1[],
  sourceA: PromptEnhancementSourceRefV1,
  facts: readonly PromptEnhancementGuidanceFact[],
): readonly PromptEnhancementSourceRefV1[] {
  if (sectionKind === 'original_request_or_goal') return [sourceA];
  const factSourceIds = new Set(facts.flatMap((fact) => fact.sourceIds));
  const matched = sourceRefs.filter((ref) => factSourceIds.has(ref.sourceId) || factSourceIds.has(ref.sourceRefId));
  if (matched.length > 0) return matched;
  if (sectionKind === 'source_signal_guidance') {
    const sourceB = sourceRefs.filter((ref) => ref.sourceKind !== 'source_a_user_prompt');
    return sourceB.length > 0 ? sourceB : [sourceA];
  }
  return [sourceA];
}

function sourceKindForSection(
  sectionKind: string,
  facts: readonly PromptEnhancementGuidanceFact[],
  sourceRefs: readonly PromptEnhancementSourceRefV1[],
): PromptEnhancementSourceKind {
  if (sectionKind === 'original_request_or_goal') return 'source_a_user_prompt';
  const factSourceKind = facts.find((fact) => isRenderableFact(fact))?.sourceType;
  if (factSourceKind) return SOURCE_KIND_BY_GUIDANCE_SOURCE[factSourceKind];
  return sourceRefs.find((ref) => ref.sourceKind !== 'source_a_user_prompt')?.sourceKind ?? 'source_a_user_prompt';
}

function evidenceStatusFor(
  routeConfidence: PromptEnhancementRouteResult['routeConfidence'],
  facts: readonly PromptEnhancementGuidanceFact[],
): PromptEnhancementEvidenceStatus {
  if (facts.some((fact) => fact.sourceEvidenceState === 'missing')) return 'unknown';
  if (facts.some((fact) => fact.sourceEvidenceState === 'stale_or_unknown')) return 'stale';
  if (routeConfidence === 'missing') return 'unknown';
  if (facts.some((fact) => fact.sourceEvidenceState === 'conflicting')) return 'unknown';
  return 'present';
}

function slotEvidenceStatusFor(
  sectionKind: string,
  sourceEvidenceStatus: PromptEnhancementEvidenceStatus,
  facts: readonly PromptEnhancementGuidanceFact[],
): PromptEnhancementEvidenceStatus {
  if (sectionKind === 'original_request_or_goal') return 'present';
  if (facts.some((fact) => fact.renderPolicy === 'fallback_only')) return 'failed_fallback';
  return sourceEvidenceStatus;
}

function requirementSourceStatusFor(
  familyId: PromptEnhancementFamilyId,
  sectionKind: string,
  facts: readonly PromptEnhancementGuidanceFact[],
): PromptEnhancementEvidenceStatus {
  if (sectionKind === 'requirement_source_state' || familyId === 'review_verification' || familyId === 'planning_spec') {
    return facts.some((fact) => fact.guidanceKind === 'requirement_source_state' && fact.sourceEvidenceState !== 'missing')
      ? 'present'
      : 'unknown';
  }
  return 'not_applicable';
}

function isMandatorySurvivorSection(
  sectionKind: string,
  capabilities: readonly PromptEnhancementCapabilityId[],
  facts: readonly PromptEnhancementGuidanceFact[],
): boolean {
  return capabilities.some((capability) => SECTION_REQUIRED_BY_CAPABILITY[capability] === sectionKind) ||
    facts.some((fact) => fact.priority === 'required_survivor');
}

/**
 * Which sections each capability overlay applies to.
 *
 * Transcribed from the milestone's capability-overlay table (analysis L3325-3335, mirrored in the
 * dev plan at L6008). Every row of that table names the sections its capability affects — the
 * overlays were never meant to be global. Applying them to every section instead made the flags a
 * constant: every section reported the same set, so nothing downstream could tell one from another,
 * and `risk_or_rollback` sat on `behavior_preservation` where it means nothing.
 *
 * The dev plan states the bound directly: "Scope must remain bounded and must not add noisy
 * rollback text to unrelated low-risk prompts."
 *
 * ⚠️ Only two of these entries are consulted today — `confirmation_needed` and `risk_or_rollback`,
 * the only capabilities that have ever contributed a safety flag. The rest are here because this is
 * the transcription of the design table and splitting it would leave the record in two places; they
 * become live the moment another capability contributes a flag. Do not read a nine-entry map as
 * proof that nine capabilities are scoped — `capabilityScopedSafetyFlagsV1` names the two that are,
 * and a test pins that list so a third cannot be added silently.
 */
const SECTIONS_BY_CAPABILITY: Partial<Record<PromptEnhancementCapabilityId, readonly string[]>> = {
  'capability.risk_or_rollback': [
    'risk_safety_or_confirmation', 'verification_or_test_plan', 'behavior_preservation', 'handoff_or_sequence_candidate',
  ],
  'capability.confirmation_needed': [
    'risk_safety_or_confirmation', 'verification_or_test_plan', 'behavior_preservation', 'handoff_or_sequence_candidate',
  ],
  'capability.verification_required': ['verification_or_test_plan', 'acceptance_or_output_expectation'],
  'capability.reproduction_or_evidence_needed': [
    'reproduction_or_evidence', 'verification_or_test_plan', 'uncertainty_or_clarification',
  ],
  'capability.behavior_preservation': ['behavior_preservation', 'context_and_constraints', 'verification_or_test_plan'],
  'capability.project_grounding': ['project_grounding_facts'],
  'capability.source_signal_guidance': [
    'source_signal_guidance', 'approach_or_steps', 'verification_or_test_plan', 'risk_safety_or_confirmation',
  ],
  'capability.adversarial_review': [
    'requirement_source_state', 'verification_or_test_plan', 'acceptance_or_output_expectation', 'uncertainty_or_clarification',
  ],
  'capability.decomposition_candidate': ['handoff_or_sequence_candidate'],
};

/**
 * The capabilities whose overlay actually reaches `safetyFlags`, and are therefore scoped.
 *
 * Exported so a test can pin it: the map above lists every capability in the design table, but only
 * these contribute a flag, and a reader who assumes otherwise will believe scoping covers more than
 * it does. Adding a third capability to `safetyFlagsFor` must fail that test until this list agrees.
 */
export const capabilityScopedSafetyFlagsV1: readonly PromptEnhancementCapabilityId[] = [
  'capability.confirmation_needed',
  'capability.risk_or_rollback',
];

function capabilityAppliesToSection(
  capability: PromptEnhancementCapabilityId,
  sectionKind: string,
): boolean {
  return SECTIONS_BY_CAPABILITY[capability]?.includes(sectionKind) ?? false;
}

function safetyFlagsFor(
  sectionKind: string,
  capabilities: readonly PromptEnhancementCapabilityId[],
  facts: readonly PromptEnhancementGuidanceFact[],
): readonly string[] {
  // Unconditional, and deliberately so: these are not capability overlays. Every generated section
  // must be honest about its sources and must not escalate authority, whatever the route asked for,
  // and the design does not scope them to a subset.
  const flags = new Set(['source_honesty', 'no_authority_escalation']);
  if (
    sectionKind === 'risk_safety_or_confirmation'
    || (capabilities.includes('capability.confirmation_needed')
      && capabilityAppliesToSection('capability.confirmation_needed', sectionKind))
  ) {
    flags.add('sensitive_action_confirmation');
  }
  if (
    capabilities.includes('capability.risk_or_rollback')
    && capabilityAppliesToSection('capability.risk_or_rollback', sectionKind)
  ) {
    flags.add('risk_or_rollback');
  }
  // Fact-supplied hooks are untouched: they arrive per fact, and facts are already matched to their
  // own section, so these were never the blanket half.
  for (const fact of facts) {
    for (const hook of fact.safetyHooks) flags.add(hook);
  }
  return [...flags];
}

function sensitivityFlagsFor(facts: readonly PromptEnhancementGuidanceFact[]): readonly string[] {
  return facts
    .filter((fact) => fact.riskLevel === 'high' || fact.riskLevel === 'sensitive_authority_risky')
    .map((fact) => `risk:${fact.riskLevel}`);
}

function validationStatusFor(noPopup: boolean): PromptEnhancementValidationStatus {
  return noPopup ? 'no_popup' : 'valid';
}

function fallbackModeFor(routeFallbackMode: PromptEnhancementRouteResult['fallbackMode']): PromptEnhancementFallbackMode {
  return routeFallbackMode === 'skip_no_popup' ? 'no_popup' : 'none';
}

function callVisibilityModeFor(mode: PromptEnhancementCallVisibilityMode): PromptEnhancementCallVisibilityMode {
  return mode;
}

function isRenderableFact(fact: PromptEnhancementGuidanceFact): boolean {
  return fact.renderPolicy === 'render_as_section' || fact.renderPolicy === 'render_as_inline_clause';
}

function isMetadataOnlyFact(fact: PromptEnhancementGuidanceFact): boolean {
  return fact.renderPolicy === 'metadata_only' || fact.renderPolicy === 'why_help_only';
}

function isSuppressedFact(fact: PromptEnhancementGuidanceFact): boolean {
  return fact.priority === 'suppressed' || fact.renderPolicy === 'suppress_with_reason';
}

function isDeferredFact(fact: PromptEnhancementGuidanceFact): boolean {
  return fact.priority === 'deferred_to_ds' || fact.priority === 'handoff_only' || fact.renderPolicy === 'defer_to_normal_ds';
}

function orderedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter(Boolean))];
}

function isString(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}
