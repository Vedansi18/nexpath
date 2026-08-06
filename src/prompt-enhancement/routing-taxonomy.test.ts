import { describe, expect, it } from 'vitest';
import {
  DEBUG_PRIMARY_INTENTS,
  FEATURE_PRIMARY_INTENTS,
  MAINTENANCE_PRIMARY_INTENTS,
  PLANNING_PRIMARY_INTENTS,
  PROMPT_ENHANCEMENT_CAPABILITIES,
  PROMPT_ENHANCEMENT_FAMILIES,
  PROMPT_ENHANCEMENT_PRIMARY_INTENTS,
  PROMPT_ENHANCEMENT_TAXONOMY_PRESETS,
  QUICK_IMPROVEMENT_PRIMARY_INTENTS,
  REVIEW_PRIMARY_INTENTS,
  findPromptEnhancementTaxonomyGaps,
  getPromptEnhancementG1AApprovalInventory,
  getPromptEnhancementRoutingSourceGateSnapshot,
  routePromptEnhancement,
  type PromptEnhancementRouteInput,
} from './routing-taxonomy.js';

function routeInput(overrides: Partial<PromptEnhancementRouteInput>): PromptEnhancementRouteInput {
  return {
    routeDecisionId: 'route-test-1',
    promptText: 'Fix this failing test: npm test reports payment.spec.ts failed',
    currentStage: 'implementation',
    prevStage: 'task_breakdown',
    triggerKind: 'absence',
    firedKey: 'absence:debugging_observation_gap@implementation',
    effectiveFiredSource: 'classifier_fire_recommendation',
    selectedQualifyingAbsence: 'debugging_observation_gap',
    absenceGateReason: 'selected_qualifying_absence',
    classifierState: 'fire_recommended',
    degradedNoActionState: 'none',
    generatedOriginState: 'ordinary_user_prompt',
    ...overrides,
  };
}

function routeSourceSnapshot(
  overrides: Partial<NonNullable<PromptEnhancementRouteInput['sourceSnapshot']>> = {},
): NonNullable<PromptEnhancementRouteInput['sourceSnapshot']> {
  const sourceRef = {
    sourceRefId: 'source-a-current-prompt',
    sourceKind: 'source_a_user_prompt' as const,
    sourceId: 'current-prompt',
    sourceAuthorization: 'implementation_input' as const,
    evidenceStatus: 'present' as const,
    freshness: 'current' as const,
    confidence: 'high' as const,
    privacyClass: 'local_private' as const,
  };

  return {
    sourceAOriginalPromptRef: sourceRef,
    sourceRefs: [sourceRef],
    normalizedStageAbsenceSignalRefs: [],
    contentTemplateRecordFactRefs: [],
    popupQuestionSourceRefs: [],
    whyHelpSourceRefs: [],
    profileRoleModeRefs: [],
    rightGoodWorkStyleEnvRuntimeRefs: [],
    missingMemoryCandidateRefs: [],
    sourceLabels: [],
    promptStartStop: {
      hookBoundary: 'UserPromptSubmit -> runAuto',
      deliveryBoundary: 'Stop -> runStop',
      runAutoCanHoldOrReplaceSubmittedPrompt: false,
      sharedSignalCount: 137,
      classifierDegradedNoFireReasons: [],
    },
    store: {
      schemaVersion: 1,
      missingPromptEnhancementTables: [],
      cleanupGaps: [],
    },
    transcriptPathState: 'not_authority',
    streamBOutputs: [],
    paramEventChannels: [],
    servedVariantIdentityRefs: [],
    deliveryGateRefs: [],
    sourceOnlyHardFactRefs: [],
    ...overrides,
  };
}

describe('prompt-enhancement routing and taxonomy', () => {
  it('keeps Phase 3 source gates aligned with current shared source reality', () => {
    const snapshot = getPromptEnhancementRoutingSourceGateSnapshot();

    expect(snapshot.stageIds).toEqual([
      'idea',
      'prd',
      'architecture',
      'task_breakdown',
      'implementation',
      'review_testing',
      'release',
      'feedback_loop',
    ]);
    expect(snapshot.stageIds).not.toContain('debug');
    expect(snapshot.stageIds).not.toContain('maintenance');
    expect(snapshot.promptStartBoundary).toBe('UserPromptSubmit -> runAuto');
    expect(snapshot.promptStartCanReplaceSameTurn).toBe(false);
    expect(snapshot.deliveryBoundary).toBe('Stop -> runStop');
    expect(snapshot.sharedSignalCount).toBe(137);
    expect(snapshot.allStageChecklistLineCount).toBeGreaterThan(130);
    expect(snapshot.shippedDecisionSessionContentTemplateRecords).toBe(144);
    expect(snapshot.stageTransitionSignalIds).toEqual([
      'IDEA_TO_PRD',
      'PRD_TO_ARCHITECTURE',
      'ARCHITECTURE_TO_TASKS',
      'IMPLEMENTATION_TO_REVIEW',
      'REVIEW_TO_RELEASE',
      'RELEASE_TO_FEEDBACK',
      'TASK_REVIEW',
    ]);
    expect(snapshot.firstTriggerGates).toContain('post_advisory_cooldown');
    expect(snapshot.firstTriggerGates).toContain('dedupe');
    expect(snapshot.firstTriggerGates).toContain('session_advisory_cap');
    expect(snapshot.classifierDegradedNoFireReasons).toContain('release_guard_scaffolding_without_verification_token');
    expect(snapshot.releaseGuard).toBe('scaffolding_without_release_verification_forces_no_fire');
    expect(snapshot.promptStartInputs).toContain('profile');
    expect(snapshot.promptStartInputs).toContain('role');
    expect(snapshot.promptStartInputs).toContain('mode');
    expect(snapshot.promptStartInputs).toContain('permission_mode');
    expect(snapshot.promptStartInputs).toContain('transcript_path');
    expect(snapshot.promptStartInputs).toContain('content_template_source_outputs');
    expect(snapshot.contentTemplateQuestionServing).toBe('signal-pinch-fields');
    expect(snapshot.contentTemplateSourceCascade).toEqual(['uploaded', 'autogen', 'shipped', 'default']);
    expect(snapshot.liveContentTemplateSourceUse).toBe('source_b_input_only');
    expect(snapshot.promptEnhancementClassifier).toBe('not_authorized');
    expect(snapshot.oldStaticDecisionSessionRouting).toBe('not_authorized');
    expect(snapshot.sameTurnPromptReplacement).toBe('not_authorized');
    expect(snapshot.normalDecisionSessionAdvisoryCompatibility).toBe('read_only_no_mutation');
    expect(snapshot.registryNamespace).toBe('prompt-enhancement-templates');
  });

  it('defines the exact six Phase 3 families with exact inventory coverage', () => {
    expect(PROMPT_ENHANCEMENT_FAMILIES).toEqual([
      'feature_delivery',
      'planning_spec',
      'issue_debug',
      'maintenance_refactor',
      'review_verification',
      'quick_improvement',
    ]);

    const presetFamilies = new Set(PROMPT_ENHANCEMENT_TAXONOMY_PRESETS.map((preset) => preset.family));
    for (const family of PROMPT_ENHANCEMENT_FAMILIES) {
      expect(presetFamilies.has(family)).toBe(true);
    }

    expect(PROMPT_ENHANCEMENT_PRIMARY_INTENTS).toEqual([
      ...FEATURE_PRIMARY_INTENTS,
      ...PLANNING_PRIMARY_INTENTS,
      ...DEBUG_PRIMARY_INTENTS,
      ...MAINTENANCE_PRIMARY_INTENTS,
      ...REVIEW_PRIMARY_INTENTS,
      ...QUICK_IMPROVEMENT_PRIMARY_INTENTS,
    ]);
    const presetIntents = new Set(PROMPT_ENHANCEMENT_TAXONOMY_PRESETS.map((preset) => preset.primaryIntent));
    for (const intent of PROMPT_ENHANCEMENT_PRIMARY_INTENTS) {
      expect(presetIntents.has(intent)).toBe(true);
    }

    const presetCapabilities = new Set(PROMPT_ENHANCEMENT_TAXONOMY_PRESETS.flatMap((preset) => preset.capabilityOverlays));
    for (const capability of PROMPT_ENHANCEMENT_CAPABILITIES) {
      expect(presetCapabilities.has(capability)).toBe(true);
    }
    expect(findPromptEnhancementTaxonomyGaps()).toEqual([]);
  });

  it('makes every preset registry-linked and prevents content-template or route-call confusion', () => {
    for (const preset of PROMPT_ENHANCEMENT_TAXONOMY_PRESETS) {
      expect(preset.templateType).toBe('prompt-enhancement-template');
      expect(PROMPT_ENHANCEMENT_FAMILIES).toContain(preset.family);
      expect(preset.routeFixtureIds.length).toBeGreaterThan(0);
      expect(preset.evaluationFixtureIds.length).toBeGreaterThan(0);
      expect(preset.metadataContract).toContain('route_input_evidence');
      expect(preset.metadataContract).toContain('call_visibility_mode');
      expect(preset.callVisibilityMode).toBe('deterministic');
      expect(preset.llmCallPolicy).toBe('no_call');
      expect(preset.contentTemplateRuntimeSeamUse).toBe('none');
      expect(preset.shorterMinimum.length).toBeGreaterThan(0);
      expect(preset.safetyHooks).toContain('source_honesty');
      expect(preset.noPopupContract.sendOriginalPreserved).toBe(true);
      expect(preset.fallbackContract.sendOriginalPreserved).toBe(true);
    }
  });

  it('records G1A as an approval inventory without pretending the gate is closed', () => {
    const inventory = getPromptEnhancementG1AApprovalInventory();

    expect(inventory.gateId).toBe('routing_taxonomy_approval_inventory');
    expect(inventory.status).toBe('pending_hiren_review');
    expect(inventory.families).toEqual(PROMPT_ENHANCEMENT_FAMILIES);
    expect(inventory.routeFixtureIds.length).toBe(PROMPT_ENHANCEMENT_TAXONOMY_PRESETS.length);
    expect(inventory.evaluationFixtureIds.length).toBe(PROMPT_ENHANCEMENT_TAXONOMY_PRESETS.length);
    expect(inventory.intentAliases).toEqual({
      'review.code_diff_review': 'review.code_or_diff_review',
    });
    expect(inventory.presetRecords.length).toBe(PROMPT_ENHANCEMENT_TAXONOMY_PRESETS.length);
    for (const preset of inventory.presetRecords) {
      expect(preset.baseSkeletonId).toMatch(/^skeleton-/);
      expect(preset.capabilityCompatibility.length).toBe(PROMPT_ENHANCEMENT_CAPABILITIES.length);
      for (const capabilityId of PROMPT_ENHANCEMENT_CAPABILITIES) {
        const compatibility = preset.capabilityCompatibility.find((entry) => entry.capabilityId === capabilityId);
        expect(compatibility).toBeDefined();
        expect(compatibility?.status).toBe(
          preset.capabilityOverlays.includes(capabilityId) ? 'compatible' : 'rejected',
        );
      }
      expect(preset.requiredSections.length).toBeGreaterThan(0);
      expect(preset.conditionalSections.length).toBeGreaterThan(0);
      expect(preset.routeFixtureIds.length).toBeGreaterThan(0);
      expect(preset.evaluationFixtureIds.length).toBeGreaterThan(0);
      expect(preset.noPopupFixtureId).toMatch(/^pe-ar3-no-popup-/);
    }
    expect(inventory.unsupportedOrDeferredScenarios).toContain('pe_only_classifier');
    expect(inventory.unsupportedOrDeferredScenarios).toContain('source_b_only_popup_authority');
    expect(inventory.unsupportedOrDeferredScenarios).toContain('cost_based_quality_downgrade');
    expect(inventory.unsupportedOrDeferredScenarioRecords).toEqual([
      {
        id: 'pe_only_classifier',
        reasonCode: 'must_consume_shared_signal_adapter_not_new_detector',
      },
      {
        id: 'old_static_decision_session_routing',
        reasonCode: 'decision_session_content_templates_are_source_b_only',
      },
      {
        id: 'source_b_only_popup_authority',
        reasonCode: 'source_a_or_source_critical_exception_required_to_show_popup',
      },
      {
        id: 'same_turn_prompt_replacement',
        reasonCode: 'host_hold_replacement_not_source_proven',
      },
      {
        id: 'active_sequence_runtime',
        reasonCode: 'future_sequence_runtime_owned_by_handoff_gates',
      },
      {
        id: 'cost_based_quality_downgrade',
        reasonCode: 'cost_acceptance_forbids_route_weakening',
      },
    ]);
  });

  it.each([
    ['planning.migration_plan', ['data_schema_source_of_truth', 'migration_order', 'backup_dry_run', 'rollback_recovery', 'verification_or_test_plan']],
    ['planning.refactor_plan', ['behavior_preservation', 'affected_surface', 'incremental_steps', 'verification_or_test_plan']],
    ['issue_debug.failing_test', ['test_command_output', 'fixture_mock_context', 'narrow_fix_boundary', 'verification_or_test_plan']],
    ['issue_debug.integration_api_failure', ['request_response_sample', 'status_schema_contract', 'auth_config_boundary', 'verification_or_test_plan']],
    ['issue_debug.performance_problem', ['baseline_current_metric', 'workload_or_input_size', 'profiling_measurement_path', 'verification_or_test_plan']],
    ['maintenance.dependency_upgrade', ['current_new_versions', 'changelog_breaking_change_state', 'compatibility', 'rollback_recovery', 'verification_or_test_plan']],
    ['maintenance.cleanup_dead_code', ['unused_code_proof', 'reference_search', 'affected_behavior_tests', 'verification_or_test_plan']],
    ['maintenance.documentation_config_upkeep', ['source_of_truth_state', 'docs_config_alignment', 'no_secret_leakage', 'verification_or_test_plan']],
    ['review.code_or_diff_review', ['code_diff_target', 'review_scope', 'finding_format', 'verification_or_test_plan']],
    ['review.security_review', ['security_surface', 'threat_input_auth_secret_data_checks', 'finding_format', 'verification_or_test_plan']],
    ['review.api_contract_review', ['request_response_schema', 'backward_compatibility_boundary', 'contract_test_expectation', 'finding_format']],
  ] as const)('carries exact per-intent section obligations for %s', (intent, requiredSections) => {
    const preset = PROMPT_ENHANCEMENT_TAXONOMY_PRESETS.find((record) => record.primaryIntent === intent);

    expect(preset).toBeDefined();
    for (const section of requiredSections) {
      expect(preset?.requiredSections).toContain(section);
    }
    expect(preset?.routeFixtureIds[0]).toMatch(/^pe-ar3-route-/);
    expect(preset?.evaluationFixtureIds[0]).toMatch(/^pe-em3-eval-/);
  });

  it.each([
    ...DEBUG_PRIMARY_INTENTS.map((intent) => [intent, ['reproduction', 'evidence', 'verification']] as const),
    ...MAINTENANCE_PRIMARY_INTENTS.map((intent) => [intent, ['verification']] as const),
    ...REVIEW_PRIMARY_INTENTS.map((intent) => [intent, ['finding', 'verification']] as const),
  ] as const)('keeps locked PE-WR-3 category %s distinct with registry fixture links', (intent, expectedWords) => {
    const preset = PROMPT_ENHANCEMENT_TAXONOMY_PRESETS.find((record) => record.primaryIntent === intent);
    const searchableSlots = [
      ...(preset?.requiredSections ?? []),
      ...(preset?.conditionalSections ?? []),
      ...(preset?.moreThoroughAdds ?? []),
      ...(preset?.moreProjectGroundedAdds ?? []),
    ].join(' ');

    expect(preset).toBeDefined();
    expect(preset?.baseSkeletonId).toMatch(/^skeleton-/);
    expect(preset?.routeFixtureIds).toHaveLength(1);
    expect(preset?.evaluationFixtureIds).toHaveLength(1);
    for (const expectedWord of expectedWords) {
      expect(searchableSlots).toContain(expectedWord);
    }
  });

  it.each([
    ['Explore product idea options for onboarding', 'feature_delivery', 'feature.idea_discussion'],
    ['Build a new settings page', 'feature_delivery', 'feature.fresh_implementation'],
    ['Extend the existing settings page with export support', 'feature_delivery', 'feature.upgrade_extension'],
    ['Create a PRD for onboarding', 'planning_spec', 'planning.spec_or_prd'],
    ['Plan architecture for the payments service', 'planning_spec', 'planning.architecture_or_design'],
    ['Break down the checkout work into tasks', 'planning_spec', 'planning.task_breakdown'],
    ['Create a release plan for billing', 'planning_spec', 'planning.rollout_release_plan'],
    ['Plan the database migration', 'planning_spec', 'planning.migration_plan'],
    ['Create a debugging plan for flaky checkout', 'planning_spec', 'planning.debugging_plan'],
    ['Create a refactor plan for the auth module', 'planning_spec', 'planning.refactor_plan'],
    ['Bug in payment form: expected success but actual error', 'issue_debug', 'issue_debug.new_bug_report'],
    ['Worked before but broke after a recent change', 'issue_debug', 'issue_debug.regression_after_recent_change'],
    ['Failing test payment.spec.ts in npm test', 'issue_debug', 'issue_debug.failing_test'],
    ['Runtime error exception with stack trace', 'issue_debug', 'issue_debug.runtime_error_exception'],
    ['UI layout button visual mismatch on browser', 'issue_debug', 'issue_debug.ui_behavior_mismatch'],
    ['API failure status code 500 request response schema mismatch', 'issue_debug', 'issue_debug.integration_api_failure'],
    ['Performance problem: slow latency in search is a bug', 'issue_debug', 'issue_debug.performance_problem'],
    ['Flaky intermittent race in checkout test', 'issue_debug', 'issue_debug.flaky_behavior'],
    ['Environment config local vs CI issue', 'issue_debug', 'issue_debug.environment_config_issue'],
    ['Bug not working without repro details', 'issue_debug', 'issue_debug.reproduction_discovery'],
    ['Production incident outage support ticket', 'issue_debug', 'issue_debug.production_incident_or_support'],
    ['Refactor auth module without behavior change', 'maintenance_refactor', 'maintenance.refactor_no_behavior_change'],
    ['Upgrade dependency package version and lockfile', 'maintenance_refactor', 'maintenance.dependency_upgrade'],
    ['Schema data migration for orders table', 'maintenance_refactor', 'maintenance.migration_schema_change'],
    ['Remove dead code and unused code', 'maintenance_refactor', 'maintenance.cleanup_dead_code'],
    ['Refactor performance make faster maintenance task', 'maintenance_refactor', 'maintenance.performance_maintenance'],
    ['Harden tests and stabilize fixtures', 'maintenance_refactor', 'maintenance.test_hardening'],
    ['Update docs/config examples', 'maintenance_refactor', 'maintenance.documentation_config_upkeep'],
    ['Compatibility update for supported browser versions', 'maintenance_refactor', 'maintenance.compatibility_update'],
    ['Risky deploy needs rollback notes', 'maintenance_refactor', 'maintenance.risk_rollback_heavy'],
    ['Incremental module layer cleanup', 'maintenance_refactor', 'maintenance.incremental_module_layer_cleanup'],
    ['Verify checkout behavior', 'review_verification', 'review.verification_request'],
    ['Code review this diff', 'review_verification', 'review.code_or_diff_review'],
    ['Requirements fit review against acceptance criteria', 'review_verification', 'review.requirements_fit_review'],
    ['Security review auth handling', 'review_verification', 'review.security_review'],
    ['Architecture review payments service', 'review_verification', 'review.architecture_review'],
    ['Performance review search endpoint', 'review_verification', 'review.performance_review'],
    ['API contract review for checkout response', 'review_verification', 'review.api_contract_review'],
    ['Test review checkout specs', 'review_verification', 'review.test_review'],
    ['Polish wording in this small label', 'quick_improvement', 'quick_improvement.local_polish_or_small_improvement'],
  ] as const)('routes %s to %s / %s', (promptText, expectedFamily, expectedIntent) => {
    const result = routePromptEnhancement(routeInput({
      routeDecisionId: `route-${expectedIntent}`,
      promptText,
      triggerKind: 'manual',
      firedKey: undefined,
      effectiveFiredSource: undefined,
      selectedQualifyingAbsence: undefined,
      absenceGateReason: undefined,
    }));

    expect(result.noPopup).toBe(false);
    expect(result.familyId).toBe(expectedFamily);
    expect(result.primaryIntent).toBe(expectedIntent);
    expect(result.contractDecision.selectedTemplateRef.familyId).toBe(expectedFamily);
    expect(result.contractDecision.selectedTemplateRef.primaryIntent).toBe(expectedIntent);
    expect(result.contractDecision.registryLinkedFixtureIds.length).toBeGreaterThanOrEqual(2);
    expect(result.contractDecision.usesPeOnlyClassifier).toBe(false);
    expect(result.contractDecision.usesOldStaticDecisionSessionMap).toBe(false);
  });

  describe('P3-G1 — a build/implement intent is not misrouted by an incidental broad noun', () => {
    it.each([
      ['implement a code review tool', 'feature_delivery', 'feature.fresh_implementation'],
      ['add audit logging', 'feature_delivery', 'feature.fresh_implementation'],
      ["here's the plan: build a payment module", 'feature_delivery', 'feature.fresh_implementation'],
    ] as const)('%s -> %s / %s (not review/planning)', (promptText, family, intent) => {
      const result = routePromptEnhancement(routeInput({ promptText }));
      expect(result.noPopup).toBe(false);
      expect(result.familyId).toBe(family);
      expect(result.primaryIntent).toBe(intent);
    });

    it('does not over-correct genuine review / planning prompts', () => {
      expect(routePromptEnhancement(routeInput({ promptText: 'review this code for bugs' })).primaryIntent).toBe('review.code_or_diff_review');
      expect(routePromptEnhancement(routeInput({ promptText: 'verify the payment fix' })).primaryIntent).toBe('review.verification_request');
      expect(routePromptEnhancement(routeInput({ promptText: 'write a spec for the new api' })).primaryIntent).toBe('planning.spec_or_prd');
      // 'build' as a NOUN ("the build process") must not be mistaken for a build intent.
      expect(routePromptEnhancement(routeInput({ promptText: 'review the build process for issues' })).primaryIntent).toBe('review.verification_request');
    });
  });

  it.each([
    ['idea', 'prd'],
    ['prd', 'architecture'],
    ['architecture', 'task_breakdown'],
    ['task_breakdown', 'implementation'],
    ['implementation', 'review_testing'],
    ['review_testing', 'release'],
    ['release', 'feedback_loop'],
    ['feedback_loop', 'feedback_loop'],
  ] as const)('preserves stage-transition tuple evidence for %s -> %s', (prevStage, currentStage) => {
    const result = routePromptEnhancement(routeInput({
      routeDecisionId: `route-stage-${prevStage}-${currentStage}`,
      promptText: currentStage === 'feedback_loop'
        ? 'Review user feedback and plan follow-up verification'
        : 'Build a small implementation with verification',
      prevStage,
      currentStage,
      sourceFactRefs: [`stage-transition:${prevStage}->${currentStage}`],
    }));

    expect(result.noPopup).toBe(false);
    expect(result.routeEvidenceRefs).toContain(`stage:${prevStage}->${currentStage}`);
    expect(result.routeEvidenceRefs).toContain(`source_fact:stage-transition:${prevStage}->${currentStage}`);
    expect(result.contractDecision.usesPeOnlyClassifier).toBe(false);
  });

  it('covers fresh project/setup routing without using a special debug/setup stage', () => {
    const result = routePromptEnhancement(routeInput({
      routeDecisionId: 'route-fresh-project-setup',
      promptText: 'Plan initial project setup and architecture constraints',
      currentStage: 'architecture',
      prevStage: 'prd',
      firedKey: 'absence:architecture_decision_gap@architecture',
      sourceFactRefs: ['source:project_setup:fresh_project'],
    }));

    expect(result.familyId).toBe('planning_spec');
    expect(result.primaryIntent).toBe('planning.architecture_or_design');
    expect(result.routeEvidenceRefs).toContain('stage:prd->architecture');
    expect(result.routeEvidenceRefs).toContain('source_fact:source:project_setup:fresh_project');
  });

  it('routes failing-test debug through shared/source evidence without PE-only classifier authority', () => {
    const result = routePromptEnhancement(routeInput({
      firstTriggerGateState: {
        frequencyGate: 'pass',
        minPromptGate: 'pass',
        cooldownState: 'pass',
        dedupeState: 'pass',
        sessionCapState: 'pass',
        classifierRecommendationState: 'fire_recommended',
      },
      permissionMode: 'workspace-write',
      transcriptPathState: 'provided',
      streamBOutputRefs: ['implementation_checkpoint'],
      paramEventChannels: ['served', 'transcript'],
      runtimeEnvFactRefs: ['runtime:local_cli'],
      rightGoodWorkStyleRefs: ['right_good:behavior_verified'],
      stage2SelectionState: 'selected',
    }));

    expect(result.noPopup).toBe(false);
    expect(result.familyId).toBe('issue_debug');
    expect(result.primaryIntent).toBe('issue_debug.failing_test');
    expect(result.capabilityOverlays).toContain('capability.reproduction_or_evidence_needed');
    expect(result.capabilityOverlays).toContain('capability.verification_required');
    expect(result.capabilityOverlays).toContain('capability.source_signal_guidance');
    expect(result.routeEvidenceRefs).toContain('signal:absence:debugging_observation_gap@implementation');
    expect(result.routeEvidenceRefs).toContain('stage:task_breakdown->implementation');
    expect(result.routeEvidenceRefs).toContain('trigger_kind:absence');
    expect(result.routeEvidenceRefs).toContain('absence_gate:selected_qualifying_absence');
    expect(result.routeEvidenceRefs).toContain('gate:cooldown:pass');
    expect(result.routeEvidenceRefs).toContain('gate:dedupe:pass');
    expect(result.routeEvidenceRefs).toContain('gate:session_cap:pass');
    expect(result.routeEvidenceRefs).toContain('permission_mode:workspace-write');
    expect(result.routeEvidenceRefs).toContain('transcript_path:provided');
    expect(result.routeEvidenceRefs).toContain('stream_b:implementation_checkpoint');
    expect(result.routeEvidenceRefs).toContain('param_event:served');
    expect(result.routeEvidenceRefs).toContain('runtime_env:runtime:local_cli');
    expect(result.routeEvidenceRefs).toContain('right_good_work_style:right_good:behavior_verified');
    expect(result.routeEvidenceRefs).toContain('stage2_selection:selected');
    expect(result.contractDecision.usesPeOnlyClassifier).toBe(false);
    expect(result.contractDecision.usesOldStaticDecisionSessionMap).toBe(false);
    expect(result.contractDecision.promptReviewOrigin).toBe('user_authored_current_prompt');
    expect(result.contractDecision.promptReviewProcessingPolicy).toBe('eligible_for_initial_pe_route');
    expect(result.contractDecision.familyId).toBe('issue_debug');
    expect(result.contractDecision.primaryIntent).toBe('issue_debug.failing_test');
    expect(result.contractDecision.capabilityOverlays).toEqual(result.selectedPreset.capabilityOverlays);
    expect(result.contractDecision.compoundPromptState).toBe('single_intent');
    expect(result.contractDecision.userPointCoverageRefs).toEqual(['user_point:1']);
    expect(result.contractDecision.nonPrimaryUserIntentHandling).toBe('covered_by_primary');
    expect(result.contractDecision.routeCandidates[0]).toMatchObject({
      familyId: 'issue_debug',
      primaryIntent: 'issue_debug.failing_test',
      confidence: 'strong',
      state: 'selected',
    });
    expect(result.contractDecision.secondaryIntentTags).toEqual([]);
    expect(result.contractDecision.rejectedRouteReasonCodes).toContain('weaker_than_current_intent');
    expect(result.contractDecision.signalProvenance).toContain('stage_or_absence_signal');
    expect(result.contractDecision.signalProvenance).toContain('keyword');
    expect(result.contractDecision.signalProvenance).toContain('stream_b');
    expect(result.contractDecision.signalProvenance).toContain('param_event');
    expect(result.contractDecision.signalProvenance).toContain('transcript');
    expect(result.contractDecision.signalProvenance).toContain('permission_mode');
    expect(result.contractDecision.signalProvenance).toContain('stage2:selected');
    expect(result.contractDecision.sourceSignalRole).toBe('effective_fired_advisory_source');
    expect(result.contractDecision.stage2SelectionState).toBe('selected');
    expect(result.contractDecision.sourceSignalPolicy).toBe('render_baseline_guidance');
    expect(result.contractDecision.sectionPlanRefs).toContain('route-test-1:section:1:original_request_or_goal');
    expect(result.contractDecision.sectionPlanRefs).toContain('route-test-1:section:2:test_command_output');
    expect(result.contractDecision.fallbackMode).toBe('none');
    expect(result.contractDecision.ambiguityState).toBe('clear');
    expect(result.contractDecision.routeEvidence).toEqual(result.routeEvidenceRefs);
    expect(result.contractDecision.llmRoutePolicy).toEqual({
      mode: 'no_call',
      owner: 'hiren_content_api',
      peEm1WorksheetRow: 'not_applicable_deterministic',
      freeformRouteOutputAllowed: false,
    });
    expect(result.contractDecision.selectedTemplateRef.registryNamespace).toBe('prompt-enhancement-templates');
    expect(result.contractDecision.registryLinkedFixtureIds).toContain('pe-ar3-route-issue-debug-failing-test');
    expect(result.contractDecision.registryLinkedFixtureIds).toContain('pe-em3-eval-issue-debug-failing-test');
  });

  it.each([
    ['selected', 'effective_fired_advisory_source'],
    ['qualifying_but_unselected', 'qualifying_unselected_absence'],
    ['supplementary_present', 'supplementary_stage2_present'],
    ['absent_unselected_diagnostic', 'absent_unselected_diagnostic'],
    ['counter_update_only', 'counter_update_only'],
    ['rejected_unknown_key', 'rejected_unknown_model_key'],
  ] as const)('preserves Stage2 %s role distinction without collapsing source roles', (stage2SelectionState, expectedRole) => {
    const result = routePromptEnhancement(routeInput({
      routeDecisionId: `route-stage2-${stage2SelectionState}`,
      promptText: 'Review checkout implementation readiness',
      triggerKind: 'manual',
      firedKey: undefined,
      effectiveFiredSource: undefined,
      selectedQualifyingAbsence: undefined,
      absenceGateReason: undefined,
      stage2SelectionState,
    }));

    expect(result.noPopup).toBe(false);
    expect(result.contractDecision.stage2SelectionState).toBe(stage2SelectionState);
    expect(result.contractDecision.sourceSignalRole).toBe(expectedRole);
    expect(result.contractDecision.signalProvenance).toContain(`stage2:${stage2SelectionState}`);
    expect(result.routeEvidenceRefs).toContain(`stage2_selection:${stage2SelectionState}`);
    expect(result.contractDecision.usesPeOnlyClassifier).toBe(false);
  });

  it('preserves multi-intent route record metadata instead of treating secondary user tasks as rejected weak source candidates', () => {
    const result = routePromptEnhancement(routeInput({
      routeDecisionId: 'route-multi-intent-debug-review',
      promptText: 'Fix the failing test, then review whether the API contract changed',
      triggerKind: 'manual',
      firedKey: undefined,
      effectiveFiredSource: undefined,
      selectedQualifyingAbsence: undefined,
      absenceGateReason: undefined,
    }));

    expect(result.noPopup).toBe(false);
    expect(result.contractDecision.compoundPromptState).toBe('multi_intent_one_prompt');
    expect(result.contractDecision.userPointCoverageRefs).toEqual(['user_point:1', 'user_point:2']);
    expect(result.contractDecision.nonPrimaryUserIntentHandling).toBe('covered_by_secondary_tag');
    expect(result.secondaryIntentTags).toContain('review.api_contract_review');
    expect(result.contractDecision.secondaryIntentTags).toEqual(result.secondaryIntentTags);
    expect(result.contractDecision.routeConfidence).toBe(result.routeConfidence);
    expect(result.contractDecision.sectionPlanRefs.length).toBeGreaterThan(0);
    expect(result.contractDecision.rejectedRouteReasonCodes).toContain('weaker_than_current_intent');
    expect(result.contractDecision.rejectedRouteReasonCodes).not.toContain('insufficient_evidence');
  });

  it('splits comma-separated user points when the route record marks a compound prompt', () => {
    const result = routePromptEnhancement(routeInput({
      routeDecisionId: 'route-comma-multi-intent',
      promptText: 'Fix the failing test, review the API contract',
      triggerKind: 'manual',
      firedKey: undefined,
      effectiveFiredSource: undefined,
      selectedQualifyingAbsence: undefined,
      absenceGateReason: undefined,
    }));

    expect(result.contractDecision.compoundPromptState).toBe('multi_intent_one_prompt');
    expect(result.contractDecision.userPointCoverageRefs).toEqual(['user_point:1', 'user_point:2']);
    expect(result.contractDecision.nonPrimaryUserIntentHandling).toBe('covered_by_secondary_tag');
    expect(result.contractDecision.secondaryIntentTags).toContain('review.api_contract_review');
  });

  it('records generated, old-DS, sequence, and unknown origins as metadata-only or guarded skip policies', () => {
    expect(routePromptEnhancement(routeInput({
      generatedOriginState: 'pe_generated',
    })).contractDecision.promptReviewProcessingPolicy).toBe('metadata_only_skip_pe_route');
    const actionGenerated = routePromptEnhancement(routeInput({
      generatedOriginState: 'pe_action_generated',
    }));
    expect(actionGenerated.noPopup).toBe(true);
    expect(actionGenerated.contractDecision.promptReviewOrigin).toBe('pe_action_generated_send');
    expect(actionGenerated.contractDecision.promptReviewProcessingPolicy).toBe('metadata_only_skip_pe_route');
    expect(routePromptEnhancement(routeInput({
      generatedOriginState: 'old_ds_advisory_injected',
    })).contractDecision.promptReviewProcessingPolicy).toBe('old_ds_guard_skip');
    expect(routePromptEnhancement(routeInput({
      generatedOriginState: 'sequence_generated',
    })).contractDecision.promptReviewProcessingPolicy).toBe('sequence_owned_by_handoff_runtime_gate');
    expect(routePromptEnhancement(routeInput({
      generatedOriginState: 'unknown',
    })).contractDecision.promptReviewProcessingPolicy).toBe('fallback_origin_unknown');
  });

  it('blocks routing when first-trigger gate state says cooldown, dedupe, session cap, or classifier no-fire blocks', () => {
    for (const [gateName, firstTriggerGateState] of [
      ['cooldown', {
        frequencyGate: 'pass',
        minPromptGate: 'pass',
        cooldownState: 'blocked',
        dedupeState: 'pass',
        sessionCapState: 'pass',
        classifierRecommendationState: 'fire_recommended',
      }],
      ['dedupe', {
        frequencyGate: 'pass',
        minPromptGate: 'pass',
        cooldownState: 'pass',
        dedupeState: 'blocked',
        sessionCapState: 'pass',
        classifierRecommendationState: 'fire_recommended',
      }],
      ['session_cap', {
        frequencyGate: 'pass',
        minPromptGate: 'pass',
        cooldownState: 'pass',
        dedupeState: 'pass',
        sessionCapState: 'blocked',
        classifierRecommendationState: 'fire_recommended',
      }],
      ['classifier_no_fire', {
        frequencyGate: 'pass',
        minPromptGate: 'pass',
        cooldownState: 'pass',
        dedupeState: 'pass',
        sessionCapState: 'pass',
        classifierRecommendationState: 'no_fire',
      }],
    ] as const) {
      const result = routePromptEnhancement(routeInput({
        routeDecisionId: `route-blocked-${gateName}`,
        firstTriggerGateState,
      }));

      expect(result.noPopup).toBe(true);
      expect(result.reasonCodes).toContain('first_trigger_gate_blocked_no_popup');
      expect(result.contractDecision.suppressionState).toBe('suppressed_no_signal');
    }
  });

  it('skips degraded classifier/release-guard states instead of firing from local fallback', () => {
    const result = routePromptEnhancement(routeInput({
      classifierState: 'degraded_no_fire',
      degradedNoActionState: 'degraded_no_fire',
      sourceFactRefs: ['release_guard_scaffolding_without_verification_token'],
    }));

    expect(result.noPopup).toBe(true);
    expect(result.reasonCodes).toContain('degraded_classifier_no_fire');
    expect(result.contractDecision.usesPeOnlyClassifier).toBe(false);
  });

  it('skips ambiguous weak starts instead of inventing generic intent', () => {
    for (const promptText of ['fix this', 'continue', 'make it better', 'plan this', 'upgrade this', 'refactor this']) {
      const result = routePromptEnhancement(routeInput({
        routeDecisionId: `route-${promptText.replaceAll(' ', '-')}`,
        promptText,
        triggerKind: 'manual',
        firedKey: undefined,
        effectiveFiredSource: undefined,
        selectedQualifyingAbsence: undefined,
        absenceGateReason: undefined,
      }));

      expect(result.noPopup).toBe(true);
      expect(result.fallbackMode).toBe('skip_no_popup');
      expect(result.routeConfidence).toBe('weak_low_risk');
      expect(result.reasonCodes).toContain('ambiguous_weak_evidence_skip_no_popup');
      expect(result.contractDecision.ambiguityState).toBe('skip_no_useful_guidance');
      expect(result.contractDecision.suppressionState).toBe('suppressed_no_signal');
    }
  });

  it.each([
    ['fix this', {
      promptText: 'fix this failing test',
      expectedFamily: 'issue_debug',
      expectedIntent: 'issue_debug.failing_test',
      evidence: { firedKey: 'absence:debugging_observation_gap@implementation' },
    }],
    ['continue', {
      promptText: 'continue',
      expectedFamily: 'planning_spec',
      expectedIntent: 'planning.task_breakdown',
      evidence: { recentPromptEvidenceRefs: ['recent-task:checkout-flow-known-target'] },
    }],
    ['make it better', {
      promptText: 'make it better',
      expectedFamily: 'quick_improvement',
      expectedIntent: 'quick_improvement.local_polish_or_small_improvement',
      evidence: { sourceFactRefs: ['source:local-polish:button-label-known'] },
    }],
    ['plan this', {
      promptText: 'plan this',
      expectedFamily: 'planning_spec',
      expectedIntent: 'planning.spec_or_prd',
      evidence: { recentPromptEvidenceRefs: ['recent-task:billing-spec-known-target'] },
    }],
  ] as const)('routes ambiguous start %s only when evidence identifies the target', (_start, scenario) => {
    const result = routePromptEnhancement(routeInput({
      routeDecisionId: `route-ambiguous-strong-${scenario.expectedIntent}`,
      promptText: scenario.promptText,
      triggerKind: 'manual',
      effectiveFiredSource: undefined,
      selectedQualifyingAbsence: undefined,
      absenceGateReason: undefined,
      ...scenario.evidence,
    }));

    expect(result.noPopup).toBe(false);
    expect(result.familyId).toBe(scenario.expectedFamily);
    expect(result.primaryIntent).toBe(scenario.expectedIntent);
  });

  it('does not allow Source B-only content-template facts to open the popup', () => {
    const result = routePromptEnhancement(routeInput({
      promptText: 'ok',
      triggerKind: 'none',
      firedKey: undefined,
      effectiveFiredSource: undefined,
      selectedQualifyingAbsence: undefined,
      absenceGateReason: undefined,
      contentTemplateFactRefs: ['ABSENCE_DEBUGGING_OBSERVATION'],
    }));

    expect(result.noPopup).toBe(true);
    expect(result.reasonCodes).toContain('source_b_only_cannot_open_popup');
    expect(result.contractDecision.selectedTemplateRef.registryNamespace).toBe('prompt-enhancement-templates');
    expect(result.contractDecision.selectedTemplateRef.contentTemplateInputRefs).toEqual([]);
    expect(result.contractDecision.usesOldStaticDecisionSessionMap).toBe(false);
  });

  it('does not allow hard/source facts alone to open the popup without useful Source A', () => {
    const result = routePromptEnhancement(routeInput({
      promptText: 'ok',
      triggerKind: 'none',
      firedKey: undefined,
      effectiveFiredSource: undefined,
      selectedQualifyingAbsence: undefined,
      absenceGateReason: undefined,
      sourceFactRefs: ['hard_fact:project_has_recent_test_failure'],
    }));

    expect(result.noPopup).toBe(true);
    expect(result.reasonCodes).toContain('source_b_only_cannot_open_popup');
    expect(result.routeEvidenceRefs).toContain('source_fact:hard_fact:project_has_recent_test_failure');
  });

  it('does not allow source-only hard facts to open the popup without Source A intent', () => {
    const result = routePromptEnhancement(routeInput({
      promptText: 'ok',
      triggerKind: 'none',
      firedKey: undefined,
      effectiveFiredSource: undefined,
      selectedQualifyingAbsence: undefined,
      absenceGateReason: undefined,
      sourceSnapshot: routeSourceSnapshot({
        sourceOnlyHardFactRefs: ['hard_fact:source-only-no-popup-authority'],
      }),
    }));

    expect(result.noPopup).toBe(true);
    expect(result.reasonCodes).toContain('source_b_only_cannot_open_popup');
    expect(result.contractDecision.sourceSignalPolicy).toBe('skip_no_popup');
    expect(result.routeConfidence).toBe('weak_low_risk');
  });

  it.each([
    ['served variant identity', { servedVariantIdentityRefs: ['served:variant:identity-only'] }],
    ['DS delivery gate', { deliveryGateRefs: ['freq_once_per_session'] }],
  ] as const)('keeps %s evidence as provenance-only instead of route truth', (_label, sourceSnapshot) => {
    const result = routePromptEnhancement(routeInput({
      promptText: 'ok',
      triggerKind: 'none',
      firedKey: undefined,
      effectiveFiredSource: undefined,
      selectedQualifyingAbsence: undefined,
      absenceGateReason: undefined,
      sourceSnapshot: routeSourceSnapshot(sourceSnapshot),
    }));

    expect(result.noPopup).toBe(true);
    expect(result.reasonCodes).toContain('ambiguous_weak_evidence_skip_no_popup');
    expect(result.reasonCodes).not.toContain('source_b_only_cannot_open_popup');
    expect(result.contractDecision.sourceSignalPolicy).toBe('skip_no_popup');
  });

  it('routes conflicting prompt and source evidence to planning-first with conflicting metadata', () => {
    const result = routePromptEnhancement(routeInput({
      routeDecisionId: 'route-conflicting-source-evidence',
      promptText: 'Build the checkout export endpoint',
      triggerKind: 'manual',
      firedKey: undefined,
      effectiveFiredSource: undefined,
      selectedQualifyingAbsence: undefined,
      absenceGateReason: undefined,
      sourceFactRefs: [
        'source:target:checkout-export',
        'conflicting_requirement_source:billing-export-disabled',
      ],
    }));

    expect(result.noPopup).toBe(false);
    expect(result.familyId).toBe('planning_spec');
    expect(result.primaryIntent).toBe('planning.spec_or_prd');
    expect(result.routeConfidence).toBe('conflicting');
    expect(result.fallbackMode).toBe('planning_first');
    expect(result.reasonCodes).toContain('conflicting_requirement_source');
    expect(result.contractDecision.ambiguityState).toBe('conflicting_evidence');
    expect(result.routeEvidenceRefs).toContain('source_fact:conflicting_requirement_source:billing-export-disabled');
  });

  it.each([
    ['low-risk unrelated source fact', {
      sourceFactRefs: ['low_risk_unrelated_signal:style-nudge-not-useful-for-security-review'],
      memoryFeedbackRefs: [],
      expectedReasonCode: 'low_risk_unrelated_signal',
      expectedSuppressionState: 'suppressed_source_mismatch',
    }],
    ['scoped feedback suppression', {
      sourceFactRefs: [],
      memoryFeedbackRefs: ['suppressed_by_scoped_feedback:review-scope:not-needed'],
      expectedReasonCode: 'suppressed_by_scoped_feedback',
      expectedSuppressionState: 'suppressed_scoped_feedback',
    }],
  ] as const)('suppresses %s with typed source policy while preserving clear Source A route', (_label, scenario) => {
    const result = routePromptEnhancement(routeInput({
      routeDecisionId: `route-suppressed-source-${scenario.expectedReasonCode}`,
      promptText: 'Security review the auth diff',
      triggerKind: 'manual',
      firedKey: undefined,
      effectiveFiredSource: undefined,
      selectedQualifyingAbsence: undefined,
      absenceGateReason: undefined,
      sourceFactRefs: scenario.sourceFactRefs,
      memoryFeedbackRefs: scenario.memoryFeedbackRefs,
    }));

    expect(result.noPopup).toBe(false);
    expect(result.familyId).toBe('review_verification');
    expect(result.primaryIntent).toBe('review.security_review');
    expect(result.reasonCodes).toContain(scenario.expectedReasonCode);
    expect(result.contractDecision.sourceSignalPolicy).toBe('suppress_with_reason');
    expect(result.contractDecision.suppressionState).toBe(scenario.expectedSuppressionState);
    expect(result.contractDecision.rejectedRouteReasonCodes).toContain(scenario.expectedReasonCode);
    expect(result.contractDecision.routeCandidates.some((candidate) => candidate.state === 'suppressed')).toBe(true);
  });

  it.each(['fix this', 'continue', 'make it better', 'plan this'] as const)(
    'uses planning-first for ambiguous high-risk/source-critical start %s without guessing execution',
    (promptText) => {
    const result = routePromptEnhancement(routeInput({
      routeDecisionId: `route-high-risk-${promptText.replaceAll(' ', '-')}`,
      promptText,
      triggerKind: 'absence',
      firedKey: 'absence:source-critical-migration-risk@implementation',
      selectedQualifyingAbsence: 'source-critical-migration-risk',
      sourceFactRefs: ['source-critical:migration:rollback-required'],
    }));

    expect(result.noPopup).toBe(false);
    expect(result.familyId).toBe('planning_spec');
    expect(result.fallbackMode).toBe('planning_first');
    expect(result.routeConfidence).toBe('weak_source_critical');
    expect(result.contractDecision.fallbackMode).toBe('planning_first');
    expect(result.contractDecision.ambiguityState).toBe('weak_high_risk');
    expect(result.capabilityOverlays).toContain('capability.risk_or_rollback');
    expect(result.capabilityOverlays).toContain('capability.confirmation_needed');
    expect(result.reasonCodes).toContain('ambiguous_surface_high_risk_source_critical_exception');
  });

  it('makes similar-looking prompts diverge by evidence instead of surface text', () => {
    const debug = routePromptEnhancement(routeInput({
      promptText: 'Performance problem: make it faster because latency is a bug',
      sourceFactRefs: ['source:bug:latency-regression'],
    }));
    const maintenance = routePromptEnhancement(routeInput({
      promptText: 'make faster refactor maintenance task',
      sourceFactRefs: ['source:maintenance:measured-baseline'],
    }));

    expect(debug.familyId).toBe('issue_debug');
    expect(debug.primaryIntent).toBe('issue_debug.performance_problem');
    expect(maintenance.familyId).toBe('maintenance_refactor');
    expect(maintenance.primaryIntent).toBe('maintenance.performance_maintenance');
  });

  it('routes maintenance/refactor prompts with behavior-preservation and rollback overlays', () => {
    const result = routePromptEnhancement(routeInput({
      promptText: 'Refactor this module without behavior change and keep rollback notes',
      currentStage: 'review_testing',
      firedKey: 'absence:incremental_implementation_checkpoint_gap@review_testing',
    }));

    expect(result.familyId).toBe('maintenance_refactor');
    expect(result.primaryIntent).toBe('maintenance.risk_rollback_heavy');
    expect(result.capabilityOverlays).toContain('capability.behavior_preservation');
    expect(result.capabilityOverlays).toContain('capability.risk_or_rollback');
    expect(result.capabilityOverlays).toContain('capability.confirmation_needed');
    expect(result.contractDecision.capabilityOverlays).toEqual(result.capabilityOverlays);
    expect(result.contractDecision.routeCandidates[0]?.capabilityIds).toEqual(result.capabilityOverlays);
    expect(result.contractDecision.selectedTemplateRef.requiredSectionKinds).toContain('behavior_preservation');
    expect(result.contractDecision.selectedTemplateRef.requiredSectionKinds).toContain('verification_or_test_plan');
  });

  it('routes review/security and planning/migration to their exact primary intents', () => {
    const security = routePromptEnhancement(routeInput({
      promptText: 'Do a security review of this auth change',
      currentStage: 'review_testing',
      firedKey: 'absence:security_review_gap@review_testing',
    }));
    const planning = routePromptEnhancement(routeInput({
      routeDecisionId: 'route-migration-plan',
      promptText: 'Plan the database migration with backup and rollback',
      currentStage: 'architecture',
      firedKey: 'absence:architecture_decision_gap@architecture',
    }));

    expect(security.familyId).toBe('review_verification');
    expect(security.primaryIntent).toBe('review.security_review');
    expect(security.capabilityOverlays).toContain('capability.adversarial_review');
    expect(security.capabilityOverlays).toContain('capability.risk_or_rollback');
    expect(planning.familyId).toBe('planning_spec');
    expect(planning.primaryIntent).toBe('planning.migration_plan');
    expect(planning.capabilityOverlays).toContain('capability.decomposition_candidate');
    expect(planning.capabilityOverlays).toContain('capability.risk_or_rollback');
  });

  it('skips generated-origin and old decision-session reinjection paths', () => {
    const generated = routePromptEnhancement(routeInput({
      promptText: 'Fix this failing test',
      generatedOriginState: 'pe_generated',
    }));
    const oldDs = routePromptEnhancement(routeInput({
      promptText: 'Fix this failing test',
      oldDecisionSessionPayloadPresent: true,
    }));

    expect(generated.noPopup).toBe(true);
    expect(generated.reasonCodes).toContain('old_or_generated_origin_skip');
    expect(oldDs.noPopup).toBe(true);
    expect(oldDs.reasonCodes).toContain('old_or_generated_origin_skip');
  });

  it('records dev-plan provenance channels without making served identity rows route authority', () => {
    const result = routePromptEnhancement(routeInput({
      routeDecisionId: 'route-provenance-channel-check',
      promptText: 'Review this API contract for compatibility',
      triggerKind: 'manual',
      firedKey: undefined,
      effectiveFiredSource: undefined,
      selectedQualifyingAbsence: undefined,
      absenceGateReason: undefined,
      sourceFactRefs: [
        'live:mistake-category:api_contract',
        'governance:mistake-category:registry-only',
        'meta:mistake-category:registry-note',
        'dark:mistake-category:unshipped',
        'historical_import:baseline-review',
        'vibe:uncertain',
        'probe:needs-source',
        'project-type:web-cli',
        'role:backend',
        'nature:maintenance',
      ],
      profileTieBreakerRefs: ['profile:role:backend'],
      sourceSnapshot: {
        schemaVersion: 'pe-contract-v1',
        contentTemplateRecords: [],
        contentTemplateRecordFactRefs: ['ct:ABSENCE_API_CONTRACT'],
        popupQuestionSourceRefs: ['pinch:ABSENCE_API_CONTRACT'],
        whyHelpSourceRefs: ['why:ABSENCE_API_CONTRACT'],
        contentTemplate: {
          recordSignalType: 'ABSENCE_API_CONTRACT',
          contentSource: 'content-template',
          resolvedRecordIdentity: 'ABSENCE_API_CONTRACT',
          resolvedSource: 'shipped',
          sourceCascade: ['uploaded', 'autogen', 'shipped', 'default'],
          registerOverridePath: 'base',
          safeguardRequired: false,
          questionServing: 'signal-pinch-fields',
        },
        contentTemplateSourceLayer: 'shipped',
        promptStartBoundary: 'UserPromptSubmit -> runAuto',
        promptStartCanReplaceSameTurn: false,
        stopBoundary: 'Stop -> runStop',
        stageIds: ['idea', 'prd', 'architecture', 'task_breakdown', 'implementation', 'review_testing', 'release', 'feedback_loop'],
        sharedSignalCount: 137,
        shippedDecisionSessionContentTemplateRecords: 144,
        streamBOutputs: [],
        paramEventChannels: [],
        runtimeEnvFacts: [],
        servedVariantIdentityRefs: ['served:variant:identity-only'],
        deliveryGateRefs: ['freq_once_per_session'],
        sourceOnlyHardFactRefs: ['hard_fact:source-only-no-popup-authority'],
      },
    }));

    expect(result.noPopup).toBe(false);
    expect(result.contractDecision.signalProvenance).toContain('keyword');
    expect(result.contractDecision.signalProvenance).toContain('vibe');
    expect(result.contractDecision.signalProvenance).toContain('probe');
    expect(result.contractDecision.signalProvenance).toContain('live_source');
    expect(result.contractDecision.signalProvenance).toContain('historical_import');
    expect(result.contractDecision.signalProvenance).toContain('served_identity_only');
    expect(result.contractDecision.signalProvenance).toContain('project_type_applicability');
    expect(result.contractDecision.signalProvenance).toContain('role_gate');
    expect(result.contractDecision.signalProvenance).toContain('nature_gate');
    expect(result.contractDecision.signalProvenance).toContain('mistake_category_live');
    expect(result.contractDecision.signalProvenance).toContain('mistake_category_governance');
    expect(result.contractDecision.signalProvenance).toContain('mistake_category_meta');
    expect(result.contractDecision.signalProvenance).toContain('mistake_category_dark');
    expect(result.contractDecision.signalProvenance).toContain('profile_role_mode');
    expect(result.contractDecision.sourceSignalRole).toBe('none');
    expect(result.contractDecision.routeEvidence).toContain('content_template_source_tier:shipped');
    expect(result.contractDecision.routeEvidence).toContain('content_template_source_cascade:uploaded');
    expect(result.contractDecision.routeEvidence).toContain('content_template_source_cascade:autogen');
    expect(result.contractDecision.routeEvidence).toContain('content_template_source_cascade:shipped');
    expect(result.contractDecision.routeEvidence).toContain('content_template_source_cascade:default');
    expect(result.contractDecision.routeEvidence).toContain('signal_alias_resolution:ABSENCE_API_CONTRACT');
    expect(result.contractDecision.routeEvidence).toContain('pinch_question_source_state:signal-pinch-fields');
    expect(result.contractDecision.routeEvidence).toContain('popup_question_source:pinch:ABSENCE_API_CONTRACT');
    expect(result.contractDecision.routeEvidence).toContain('why_help_source:why:ABSENCE_API_CONTRACT');
    expect(result.contractDecision.routeEvidence).toContain('served_variant:served:variant:identity-only');
    expect(result.contractDecision.routeEvidence).toContain('ds_delivery_gate:freq_once_per_session');
    expect(result.contractDecision.routeEvidence).toContain('source_only_hard_fact:hard_fact:source-only-no-popup-authority');
    expect(result.contractDecision.routeEvidence).toContain('sanitization_state:not_required');
  });
});
