/**
 * The prompt-enhancement taxonomy IDS — a LEAF module with no imports, so both
 * the routing layer and the stage classifier can consume the id vocabulary
 * without a load-order cycle (the classifier builds its intent menu from these
 * at module load; importing them through the routing module exploded when the
 * routing module loaded first).
 */

export type PromptEnhancementFamilyId =
  | 'feature_delivery'
  | 'planning_spec'
  | 'issue_debug'
  | 'maintenance_refactor'
  | 'review_verification'
  | 'quick_improvement';

export type PromptEnhancementPrimaryIntent =
  | 'feature.idea_discussion'
  | 'feature.fresh_implementation'
  | 'feature.upgrade_extension'
  | 'planning.spec_or_prd'
  | 'planning.architecture_or_design'
  | 'planning.task_breakdown'
  | 'planning.rollout_release_plan'
  | 'planning.migration_plan'
  | 'planning.debugging_plan'
  | 'planning.refactor_plan'
  | 'issue_debug.new_bug_report'
  | 'issue_debug.regression_after_recent_change'
  | 'issue_debug.failing_test'
  | 'issue_debug.runtime_error_exception'
  | 'issue_debug.ui_behavior_mismatch'
  | 'issue_debug.integration_api_failure'
  | 'issue_debug.performance_problem'
  | 'issue_debug.flaky_behavior'
  | 'issue_debug.environment_config_issue'
  | 'issue_debug.reproduction_discovery'
  | 'issue_debug.production_incident_or_support'
  | 'maintenance.refactor_no_behavior_change'
  | 'maintenance.dependency_upgrade'
  | 'maintenance.migration_schema_change'
  | 'maintenance.cleanup_dead_code'
  | 'maintenance.performance_maintenance'
  | 'maintenance.test_hardening'
  | 'maintenance.documentation_config_upkeep'
  | 'maintenance.compatibility_update'
  | 'maintenance.risk_rollback_heavy'
  | 'maintenance.incremental_module_layer_cleanup'
  | 'review.verification_request'
  | 'review.code_or_diff_review'
  | 'review.requirements_fit_review'
  | 'review.security_review'
  | 'review.architecture_review'
  | 'review.performance_review'
  | 'review.api_contract_review'
  | 'review.test_review'
  | 'quick_improvement.local_polish_or_small_improvement';

export type PromptEnhancementCapabilityId =
  | 'capability.decomposition_candidate'
  | 'capability.confirmation_needed'
  | 'capability.adversarial_review'
  | 'capability.project_grounding'
  | 'capability.verification_required'
  | 'capability.risk_or_rollback'
  | 'capability.reproduction_or_evidence_needed'
  | 'capability.behavior_preservation'
  | 'capability.source_signal_guidance';

export const PROMPT_ENHANCEMENT_FAMILIES: readonly PromptEnhancementFamilyId[] = [
  'feature_delivery',
  'planning_spec',
  'issue_debug',
  'maintenance_refactor',
  'review_verification',
  'quick_improvement',
] as const;

export const PROMPT_ENHANCEMENT_CAPABILITIES: readonly PromptEnhancementCapabilityId[] = [
  'capability.decomposition_candidate',
  'capability.confirmation_needed',
  'capability.adversarial_review',
  'capability.project_grounding',
  'capability.verification_required',
  'capability.risk_or_rollback',
  'capability.reproduction_or_evidence_needed',
  'capability.behavior_preservation',
  'capability.source_signal_guidance',
] as const;

export const DEBUG_PRIMARY_INTENTS: readonly Extract<PromptEnhancementPrimaryIntent, `issue_debug.${string}`>[] = [
  'issue_debug.new_bug_report',
  'issue_debug.regression_after_recent_change',
  'issue_debug.failing_test',
  'issue_debug.runtime_error_exception',
  'issue_debug.ui_behavior_mismatch',
  'issue_debug.integration_api_failure',
  'issue_debug.performance_problem',
  'issue_debug.flaky_behavior',
  'issue_debug.environment_config_issue',
  'issue_debug.reproduction_discovery',
  'issue_debug.production_incident_or_support',
] as const;

export const MAINTENANCE_PRIMARY_INTENTS: readonly Extract<PromptEnhancementPrimaryIntent, `maintenance.${string}`>[] = [
  'maintenance.refactor_no_behavior_change',
  'maintenance.dependency_upgrade',
  'maintenance.migration_schema_change',
  'maintenance.cleanup_dead_code',
  'maintenance.performance_maintenance',
  'maintenance.test_hardening',
  'maintenance.documentation_config_upkeep',
  'maintenance.compatibility_update',
  'maintenance.risk_rollback_heavy',
  'maintenance.incremental_module_layer_cleanup',
] as const;

export const REVIEW_PRIMARY_INTENTS: readonly Extract<PromptEnhancementPrimaryIntent, `review.${string}`>[] = [
  'review.verification_request',
  'review.code_or_diff_review',
  'review.requirements_fit_review',
  'review.security_review',
  'review.architecture_review',
  'review.performance_review',
  'review.api_contract_review',
  'review.test_review',
] as const;

export const FEATURE_PRIMARY_INTENTS: readonly Extract<PromptEnhancementPrimaryIntent, `feature.${string}`>[] = [
  'feature.idea_discussion',
  'feature.fresh_implementation',
  'feature.upgrade_extension',
] as const;

export const PLANNING_PRIMARY_INTENTS: readonly Extract<PromptEnhancementPrimaryIntent, `planning.${string}`>[] = [
  'planning.spec_or_prd',
  'planning.architecture_or_design',
  'planning.task_breakdown',
  'planning.rollout_release_plan',
  'planning.migration_plan',
  'planning.debugging_plan',
  'planning.refactor_plan',
] as const;

export const QUICK_IMPROVEMENT_PRIMARY_INTENTS: readonly Extract<PromptEnhancementPrimaryIntent, `quick_improvement.${string}`>[] = [
  'quick_improvement.local_polish_or_small_improvement',
] as const;

export const PROMPT_ENHANCEMENT_PRIMARY_INTENTS: readonly PromptEnhancementPrimaryIntent[] = [
  ...FEATURE_PRIMARY_INTENTS,
  ...PLANNING_PRIMARY_INTENTS,
  ...DEBUG_PRIMARY_INTENTS,
  ...MAINTENANCE_PRIMARY_INTENTS,
  ...REVIEW_PRIMARY_INTENTS,
  ...QUICK_IMPROVEMENT_PRIMARY_INTENTS,
] as const;

export const PROMPT_ENHANCEMENT_INTENT_ALIASES = {
  'review.code_diff_review': 'review.code_or_diff_review',
} as const;

/**
 * The eight debug-evidence forms the classifier's observation reports on. This
 * is the FULL enumeration — a prompt whose only evidence is a screenshot or a
 * metrics graph must not read as evidence-less. Lives in this leaf because both
 * the classifier (observation vocabulary) and the routing registry (the
 * evidence-lacking attachment rule) consume it.
 */
export const DEBUG_EVIDENCE_FORMS = [
  'reproduction_steps',
  'logs',
  'failing_test_details',
  'environment',
  'request_response_samples',
  'screenshots',
  'metrics',
  'recent_change_evidence',
] as const;

export type DebugEvidenceForm = (typeof DEBUG_EVIDENCE_FORMS)[number];

/**
 * The routing layer's evidence-ladder outcome. Every routing path used to name
 * a concrete family even when nothing supported it; this state makes "the
 * ladder did not resolve" REPRESENTABLE — a typed routing outcome, not a
 * family. Rungs 1-5 can resolve (explicit prompt evidence · project/source
 * facts · current signals · recent history · persistent memory/feedback);
 * rung 6 (profile tie-breakers) is walked but never resolves alone; rung 7
 * (coding-agent response context) is locked deferred and never walked. The
 * section planner and the popup decision consume the state; the locked
 * dispositions for the under-evidenced case belong to the routing fallback
 * layer, not to this type.
 */
export type PromptEnhancementLadderResolutionV1 =
  | { state: 'resolved'; resolvedByRung: 1 | 2 | 3 | 4 | 5 }
  | { state: 'under_evidenced'; rungsWalked: readonly number[] };
