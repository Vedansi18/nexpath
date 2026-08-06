import {
  PROMPT_ENHANCEMENT_CONTRACT_VERSION,
  type PromptEnhancementTemplateRegistryRefV1,
} from '../contracts.js';
import {
  PROMPT_ENHANCEMENT_CAPABILITIES,
  PROMPT_ENHANCEMENT_FAMILIES,
  PROMPT_ENHANCEMENT_PRIMARY_INTENTS,
  PROMPT_ENHANCEMENT_TAXONOMY_PRESETS,
  type PromptEnhancementFamilyId,
  type PromptEnhancementPrimaryIntent,
  type PromptEnhancementTaxonomyPreset,
} from '../routing-taxonomy.js';

export interface PromptEnhancementTemplateRegistry {
  schemaVersion: typeof PROMPT_ENHANCEMENT_CONTRACT_VERSION;
  registryNamespace: 'prompt-enhancement-templates';
  templateType: 'prompt-enhancement-template';
  records: readonly PromptEnhancementTaxonomyPreset[];
  familyIds: readonly PromptEnhancementFamilyId[];
  primaryIntentIds: readonly PromptEnhancementPrimaryIntent[];
  noContentTemplateRecordEmbedding: true;
  noPrecomputedDirectionalVariants: true;
  noOldDecisionSessionRouting: true;
  noPeOnlyClassifier: true;
}

export function getPromptEnhancementTemplateRegistry(): PromptEnhancementTemplateRegistry {
  return {
    schemaVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
    registryNamespace: 'prompt-enhancement-templates',
    templateType: 'prompt-enhancement-template',
    records: PROMPT_ENHANCEMENT_TAXONOMY_PRESETS,
    familyIds: PROMPT_ENHANCEMENT_FAMILIES,
    primaryIntentIds: PROMPT_ENHANCEMENT_PRIMARY_INTENTS,
    noContentTemplateRecordEmbedding: true,
    noPrecomputedDirectionalVariants: true,
    noOldDecisionSessionRouting: true,
    noPeOnlyClassifier: true,
  };
}

export function getPromptEnhancementTemplateByIntent(
  primaryIntent: PromptEnhancementPrimaryIntent,
): PromptEnhancementTaxonomyPreset {
  const record = PROMPT_ENHANCEMENT_TAXONOMY_PRESETS.find((preset) => preset.primaryIntent === primaryIntent);
  if (!record) {
    throw new Error(`Missing prompt-enhancement template registry record for ${primaryIntent}`);
  }
  return record;
}

export function getPromptEnhancementTemplateRef(
  primaryIntent: PromptEnhancementPrimaryIntent,
): PromptEnhancementTemplateRegistryRefV1 {
  const record = getPromptEnhancementTemplateByIntent(primaryIntent);
  return {
    schemaVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
    templateId: record.id,
    registryNamespace: 'prompt-enhancement-templates',
    templateType: record.templateType,
    familyId: record.family,
    displayLabel: record.primaryIntent,
    primaryIntent: record.primaryIntent,
    intentTags: record.coveredIntentTags,
    capabilityIds: record.capabilityOverlays,
    triggerHints: record.routeFixtureIds,
    supportedLevels: ['default', 'shorter', 'more_thorough', 'more_project_grounded'],
    defaultLevel: 'default',
    applicabilityAxes: record.applicabilityAxes,
    applicabilityGuards: ['source_a_or_explicit_no_popup_reason_required', 'source_b_support_only'],
    sourcePriorityState: 'source_a_first',
    targetScopePolicy: 'source_a_plus_grounded_support',
    capabilityRequirements: record.capabilityOverlays,
    requiredSectionKinds: record.requiredSections,
    optionalSectionKinds: record.optionalSections,
    sectionSlots: [...record.requiredSections, ...record.conditionalSections],
    sectionOrderPolicy: 'fixed_required_before_optional',
    sourceGuidanceFloorPolicy: record.baselineSourceSignalSlot === 'not_applicable'
      ? 'explicit_fallback_reason'
      : 'required_when_popup_shown',
    originalPromptPreservationPolicy: 'visible_verbatim_required',
    allowedSourceKinds: ['source_a_user_prompt', 'stage_or_absence_signal', 'content_template_fact', 'hard_fact_or_profile_signal'],
    requiredSourceACoverage: 'visible_original_prompt',
    allowedSourceBSupportKinds: ['stage_or_absence_signal', 'content_template_fact', 'hard_fact_or_profile_signal', 'prompt_enhancement_memory'],
    baselineSourceSignalSlot: record.baselineSourceSignalSlot,
    sourceEvidenceStatusRules: ['present', 'not_applicable', 'unknown', 'failed_fallback', 'suppressed_for_privacy', 'suppressed_for_safety'],
    contentTemplateInputRefs: record.contentTemplateInputRefs,
    safetyHookIds: record.safetyHooks,
    sensitivityPolicy: 'deterministic_flags_required',
    voicePolicyRef: 'source-honest-user-to-agent-voice',
    confirmationRequirementPolicy: 'preserve_when_required',
    supportedDirectionalActions: ['shorter', 'more_thorough', 'more_project_grounded', 'apply_details'],
    composerPolicy: 'deterministic_only',
    deterministicRendererId: 'composer_pending',
    llmCallPolicy: 'no_call',
    tokenTimeoutProfileRef: 'cost_visible_call_policy_not_used_by_section_planner',
    validationRequirementIds: ['source_a_scope', 'source_b_support_only', 'route_fixture_linked', 'safety_hooks_present'],
    fallbackReasonCodes: ['provider_unavailable', 'timeout', 'malformed_output', 'validation_failed', 'not_applicable'],
    publicSafeDiagnosticCodes: ['fallback_or_no_popup', 'source_coverage', 'validation_failed'],
    fallbackPolicy: 'deterministic_body',
    testFixtureIds: [...record.routeFixtureIds, ...record.evaluationFixtureIds],
    invariantIds: [
      'no_pe_only_classifier',
      'no_old_static_decision_session_map',
      'no_source_b_only_popup',
      'no_precomputed_directional_variants',
    ],
    ownerArea: 'content_semantics',
    launchVisibility: 'private_until_launch_recheck',
    publicSafeSourceNotes: [
      'DS content-template refs are Source B only.',
      'Phase 4 section planning creates metadata and section records, not final prompt prose.',
    ],
    routeFixtureIds: record.routeFixtureIds,
    evaluationFixtureIds: record.evaluationFixtureIds,
  };
}

export function findPromptEnhancementTemplateRegistryGaps(): string[] {
  const gaps: string[] = [];
  const registry = getPromptEnhancementTemplateRegistry();
  const byFamily = new Set(registry.records.map((record) => record.family));
  const byIntent = new Set(registry.records.map((record) => record.primaryIntent));
  const byCapability = new Set(registry.records.flatMap((record) => record.capabilityOverlays));

  for (const family of registry.familyIds) {
    if (!byFamily.has(family)) gaps.push(`missing_family:${family}`);
  }
  for (const intent of registry.primaryIntentIds) {
    if (!byIntent.has(intent)) gaps.push(`missing_primary_intent:${intent}`);
  }
  for (const capability of PROMPT_ENHANCEMENT_CAPABILITIES) {
    if (!byCapability.has(capability)) gaps.push(`missing_capability:${capability}`);
  }
  for (const record of registry.records) {
    if (record.templateType !== 'prompt-enhancement-template') gaps.push(`wrong_template_type:${record.id}`);
    if (record.contentTemplateRuntimeSeamUse !== 'none') gaps.push(`hidden_content_template_runtime_seam:${record.id}`);
    if (record.llmCallPolicy !== 'no_call') gaps.push(`hidden_registry_llm_call:${record.id}`);
    if (record.routeFixtureIds.length === 0) gaps.push(`missing_route_fixture:${record.id}`);
    if (record.evaluationFixtureIds.length === 0) gaps.push(`missing_evaluation_fixture:${record.id}`);
    if (record.shorterMinimum.length === 0) gaps.push(`missing_shorter_survivor_floor:${record.id}`);
    if (record.safetyHooks.length === 0) gaps.push(`missing_safety_hooks:${record.id}`);
    if (record.baselineSourceSignalSlot !== 'not_applicable' && !record.optionalSections.includes('source_signal_guidance') && !record.requiredSections.includes('source_signal_guidance')) {
      gaps.push(`missing_source_signal_slot:${record.id}`);
    }

    const compatibilityByCapability = new Map(
      record.capabilityCompatibility.map((compatibility) => [
        compatibility.capabilityId,
        compatibility,
      ]),
    );
    for (const capability of PROMPT_ENHANCEMENT_CAPABILITIES) {
      if (!compatibilityByCapability.has(capability)) {
        gaps.push(`missing_capability_compatibility:${record.id}:${capability}`);
      }
    }
    for (const capability of record.capabilityOverlays) {
      if (compatibilityByCapability.get(capability)?.status !== 'compatible') {
        gaps.push(`attached_capability_not_compatible:${record.id}:${capability}`);
      }
    }
  }

  return gaps;
}
