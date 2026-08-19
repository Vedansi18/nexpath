import {
  PROMPT_ENHANCEMENT_CONTRACT_VERSION,
  type PromptEnhancementTemplateRegistryRefV1,
} from '../contracts.js';
import {
  PROMPT_ENHANCEMENT_CAPABILITIES,
  PROMPT_ENHANCEMENT_FAMILIES,
  PROMPT_ENHANCEMENT_PRIMARY_INTENTS,
  PROMPT_ENHANCEMENT_TAXONOMY_PRESETS,
  routePromptEnhancement,
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

/**
 * The prompt-reaches-intent ROUTABILITY layer. The id-presence gaps above
 * prove a record EXISTS per intent; this proves a realistic PROMPT actually
 * ROUTES to each intent through the production keyed path (the classifier's
 * proposal, preferred by the router). Ten intents were live for months with
 * id-presence green while no user prompt could reach them — this is the check
 * that would have caught it. One probe per intent; a generic route absorbing a
 * subtype is a reported gap, never a pass.
 */
export const PROMPT_ENHANCEMENT_ROUTABILITY_PROBES: readonly {
  primaryIntent: PromptEnhancementPrimaryIntent;
  promptText: string;
}[] = [
  { primaryIntent: 'feature.idea_discussion', promptText: 'I have an idea for a saved-filters feature, want to explore options' },
  { primaryIntent: 'feature.fresh_implementation', promptText: 'implement a rate limiter on the login endpoint' },
  { primaryIntent: 'feature.upgrade_extension', promptText: 'extend the export feature to also support csv' },
  { primaryIntent: 'planning.spec_or_prd', promptText: 'write a spec for the new onboarding flow' },
  { primaryIntent: 'planning.architecture_or_design', promptText: 'plan the architecture for the notification service' },
  { primaryIntent: 'planning.task_breakdown', promptText: 'break down the billing epic into ordered tasks' },
  { primaryIntent: 'planning.rollout_release_plan', promptText: 'plan the rollout for the new billing system' },
  { primaryIntent: 'planning.migration_plan', promptText: 'plan the migration from mongo to postgres' },
  { primaryIntent: 'planning.debugging_plan', promptText: 'write a debugging plan for the checkout crashes' },
  { primaryIntent: 'planning.refactor_plan', promptText: 'draft a refactor plan for the payments module' },
  { primaryIntent: 'issue_debug.new_bug_report', promptText: 'expected the total to be 100 but the actual is 90' },
  { primaryIntent: 'issue_debug.regression_after_recent_change', promptText: 'checkout worked before, it broke after the last deploy' },
  { primaryIntent: 'issue_debug.failing_test', promptText: 'the payment.spec.ts failing test blocks ci' },
  { primaryIntent: 'issue_debug.runtime_error_exception', promptText: 'runtime error in checkout, stack trace attached below' },
  { primaryIntent: 'issue_debug.ui_behavior_mismatch', promptText: 'the button layout renders wrong in the browser' },
  { primaryIntent: 'issue_debug.integration_api_failure', promptText: 'the upstream api returns status code 500 on checkout' },
  { primaryIntent: 'issue_debug.performance_problem', promptText: 'the checkout page is slow, this latency problem is a bug' },
  { primaryIntent: 'issue_debug.flaky_behavior', promptText: 'this suite is flaky, it fails intermittently on ci' },
  { primaryIntent: 'issue_debug.environment_config_issue', promptText: 'works locally but the ci environment config differs' },
  { primaryIntent: 'issue_debug.reproduction_discovery', promptText: 'something is broken in checkout, fix this' },
  { primaryIntent: 'issue_debug.production_incident_or_support', promptText: 'production outage right now, users cannot pay' },
  { primaryIntent: 'maintenance.refactor_no_behavior_change', promptText: 'refactor the order service without changing behavior' },
  { primaryIntent: 'maintenance.dependency_upgrade', promptText: 'upgrade the lodash package to the latest version' },
  { primaryIntent: 'maintenance.migration_schema_change', promptText: 'apply the database migration for the new orders schema' },
  { primaryIntent: 'maintenance.cleanup_dead_code', promptText: 'remove the dead code left in the utils folder' },
  { primaryIntent: 'maintenance.performance_maintenance', promptText: 'optimize the query layer as part of routine cleanup' },
  { primaryIntent: 'maintenance.test_hardening', promptText: 'stabilize tests across the suite, proper test hardening' },
  { primaryIntent: 'maintenance.documentation_config_upkeep', promptText: 'update docs and config for the deploy process' },
  { primaryIntent: 'maintenance.compatibility_update', promptText: 'compatibility update so the cli runs on node 22' },
  { primaryIntent: 'maintenance.risk_rollback_heavy', promptText: 'risky production migration, prepare the rollback path' },
  { primaryIntent: 'maintenance.incremental_module_layer_cleanup', promptText: 'incremental cleanup of the service layer module' },
  // The eight review subtypes + the two dead planning subtypes use the FROZEN
  // labelled-set phrasings (ids 12-21) verbatim — the restoration proof runs on
  // the same real-world wordings the baseline measured as unreachable.
  { primaryIntent: 'review.security_review', promptText: 'review my diff for security holes' },
  { primaryIntent: 'review.code_or_diff_review', promptText: 'can you review this PR before I merge' },
  { primaryIntent: 'review.architecture_review', promptText: 'does this design hold up if we add multi-tenant later' },
  { primaryIntent: 'review.test_review', promptText: 'review my tests, I think the coverage is fake' },
  { primaryIntent: 'review.requirements_fit_review', promptText: 'check whether this implementation matches the requirements doc' },
  { primaryIntent: 'review.verification_request', promptText: 'verify the fix actually works before we close the ticket' },
  { primaryIntent: 'review.api_contract_review', promptText: 'we changed the response schema, review the contract impact on integrators' },
  { primaryIntent: 'review.performance_review', promptText: 'review this hot path for performance before we scale to 10x traffic' },
  { primaryIntent: 'quick_improvement.local_polish_or_small_improvement', promptText: 'polish the button label wording a little' },
];

export function findPromptEnhancementRoutabilityGaps(): string[] {
  const gaps: string[] = [];
  const probed = new Set(PROMPT_ENHANCEMENT_ROUTABILITY_PROBES.map((probe) => probe.primaryIntent));
  for (const intent of PROMPT_ENHANCEMENT_PRIMARY_INTENTS) {
    if (!probed.has(intent)) gaps.push(`missing_routability_probe:${intent}`);
  }
  for (const probe of PROMPT_ENHANCEMENT_ROUTABILITY_PROBES) {
    const route = routePromptEnhancement({
      routeDecisionId: `routability:${probe.primaryIntent}`,
      promptText: probe.promptText,
      currentStage: 'implementation',
      triggerKind: 'stage_transition',
      classifierState: 'fire_recommended',
      degradedNoActionState: 'none',
      generatedOriginState: 'ordinary_user_prompt',
      classifierPrimaryIntent: probe.primaryIntent,
      classifierIntentConfidence: 0.9,
      classifierCapabilityCandidates: [],
      classifierDebugEvidencePresent: [],
    });
    if (route.noPopup) {
      gaps.push(`routability_no_popup:${probe.primaryIntent}:${route.reasonCodes.join(',')}`);
    } else if (route.primaryIntent !== probe.primaryIntent) {
      gaps.push(`routability_miss:${probe.primaryIntent}->${route.primaryIntent}`);
    }
  }
  return gaps;
}
