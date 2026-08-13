import { describe, expect, it } from 'vitest';
import type { PromptEnhancementSourceRefV1 } from '../contracts.js';
import {
  PROMPT_ENHANCEMENT_PRIMARY_INTENTS,
  PROMPT_ENHANCEMENT_TAXONOMY_PRESETS,
  routePromptEnhancement,
  type PromptEnhancementRouteInput,
} from '../routing-taxonomy.js';
import {
  findPromptEnhancementTemplateRegistryGaps,
  getPromptEnhancementTemplateByIntent,
  getPromptEnhancementTemplateRef,
  getPromptEnhancementTemplateRegistry,
} from './registry.js';
import {
  normalizeGuidanceFacts,
  planPromptEnhancementSections,
  type PromptEnhancementGuidanceFact,
} from './section-plan.js';

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

const contentTemplateSourceB: PromptEnhancementSourceRefV1 = {
  sourceRefId: 'source-b-content-template',
  sourceKind: 'content_template_fact',
  sourceId: 'ABSENCE_DEBUGGING_OBSERVATION',
  sourceAuthorization: 'source_fact_only',
  evidenceStatus: 'present',
  freshness: 'current',
  confidence: 'medium',
  privacyClass: 'raw_text_excluded',
};

const hardFactSourceB: PromptEnhancementSourceRefV1 = {
  sourceRefId: 'source-b-hard-fact',
  sourceKind: 'hard_fact_or_profile_signal',
  sourceId: 'project_fact:test-suite-present',
  sourceAuthorization: 'implementation_input',
  evidenceStatus: 'present',
  freshness: 'current',
  confidence: 'medium',
  privacyClass: 'local_private',
};

function routeInput(overrides: Partial<PromptEnhancementRouteInput>): PromptEnhancementRouteInput {
  return {
    routeDecisionId: 'phase4-route-1',
    promptText: 'Fix this failing test and include verification',
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

function fact(overrides: Partial<PromptEnhancementGuidanceFact>): PromptEnhancementGuidanceFact {
  return {
    factId: 'fact-1',
    sourceType: 'content_template_record',
    sourceIds: ['ABSENCE_DEBUGGING_OBSERVATION'],
    guidanceKind: 'debug_evidence',
    suggestedActionKind: 'capture_reproduction',
    targetFamily: 'issue_debug',
    targetSectionKind: 'reproduction_or_evidence',
    sourceEvidenceState: 'strong',
    priority: 'required_survivor',
    renderPolicy: 'render_as_section',
    riskLevel: 'none',
    safetyHooks: ['source_honesty'],
    privacyClass: 'local_private',
    sanitizationState: 'prompt_derived_sanitized',
    publicCopySafe: true,
    ...overrides,
  };
}

describe('prompt-enhancement template registry and section planner', () => {
  it('exposes a distinct prompt-enhancement-template registry with no orphan family or primary intent', () => {
    const registry = getPromptEnhancementTemplateRegistry();

    expect(registry.registryNamespace).toBe('prompt-enhancement-templates');
    expect(registry.templateType).toBe('prompt-enhancement-template');
    expect(registry.noContentTemplateRecordEmbedding).toBe(true);
    expect(registry.noPrecomputedDirectionalVariants).toBe(true);
    expect(registry.noOldDecisionSessionRouting).toBe(true);
    expect(registry.noPeOnlyClassifier).toBe(true);
    expect(registry.records).toHaveLength(PROMPT_ENHANCEMENT_PRIMARY_INTENTS.length);
    expect(new Set(registry.records.map((record) => record.primaryIntent))).toEqual(new Set(PROMPT_ENHANCEMENT_PRIMARY_INTENTS));
    expect(findPromptEnhancementTemplateRegistryGaps()).toEqual([]);
  });

  it.each(PROMPT_ENHANCEMENT_PRIMARY_INTENTS)('maps primary intent %s to one family, skeleton, and fixture pair', (primaryIntent) => {
    const template = getPromptEnhancementTemplateByIntent(primaryIntent);
    const templateRef = getPromptEnhancementTemplateRef(primaryIntent);

    expect(template.primaryIntent).toBe(primaryIntent);
    expect(template.templateType).toBe('prompt-enhancement-template');
    expect(template.baseSkeletonId).toMatch(/^skeleton-/);
    expect(template.requiredSections.length).toBeGreaterThan(0);
    expect(template.routeFixtureIds).toHaveLength(1);
    expect(template.evaluationFixtureIds).toHaveLength(1);
    expect(template.shorterMinimum.length).toBeGreaterThan(0);
    expect(template.safetyHooks).toContain('source_honesty');
    expect(template.contentTemplateRuntimeSeamUse).toBe('none');
    expect(template.llmCallPolicy).toBe('no_call');
    expect(templateRef.registryNamespace).toBe('prompt-enhancement-templates');
    expect(templateRef.requiredSectionKinds).toEqual(template.requiredSections);
    expect(templateRef.testFixtureIds).toEqual([...template.routeFixtureIds, ...template.evaluationFixtureIds]);
  });

  it.each([
    ['issue_debug.failing_test', ['test_command_output', 'fixture_mock_context', 'narrow_fix_boundary', 'verification_or_test_plan']],
    ['maintenance.migration_schema_change', ['data_shape_change', 'migration_order', 'backup_dry_run', 'rollback_recovery', 'data_integrity_verification']],
    ['review.security_review', ['security_surface', 'threat_input_auth_secret_data_checks', 'finding_format', 'verification_or_test_plan']],
    ['feature.upgrade_extension', ['current_behavior', 'desired_extension', 'compatibility', 'verification_or_test_plan']],
    ['planning.task_breakdown', ['point_inventory_or_decomposition', 'task_order_dependencies', 'acceptance_or_output_expectation']],
  ] as const)('keeps %s section obligations as typed registry data', (primaryIntent, requiredSections) => {
    const template = getPromptEnhancementTemplateByIntent(primaryIntent);

    for (const section of requiredSections) {
      expect(template.requiredSections).toContain(section);
    }
    expect(template.metadataContract).toContain('route_input_evidence');
    expect(template.metadataContract).toContain('source_ids');
    expect(template.metadataContract).toContain('fallback_state');
  });

  it('plans required sections from the selected route before any composer body exists', () => {
    const route = routePromptEnhancement(routeInput({}));
    const result = planPromptEnhancementSections({
      routeResult: route,
      sourceRefs: [sourceA, contentTemplateSourceB],
      guidanceFacts: [fact({ factId: 'fact-debug-repro' })],
    });

    expect(result.registryNamespace).toBe('prompt-enhancement-templates');
    expect(result.exposesPrecomputedVariants).toBe(false);
    expect(result.usesOldDecisionSessionTemplateRecord).toBe(false);
    expect(result.usesPeOnlyClassifier).toBe(false);
    expect(result.bodyPlan.routeDecisionId).toBe(route.contractDecision.routeDecisionId);
    expect(result.bodyPlan.originalPromptPreservation).toBe('visible_verbatim');
    expect(result.bodyPlan.exposesPrecomputedVariants).toBe(false);
    expect(result.bodyPlan.orderedSectionPlans).toEqual(result.sectionPlans);
    expect(result.sectionPlans.map((section) => section.sectionKind)).toEqual(expect.arrayContaining([
      'original_request_or_goal',
      'test_command_output',
      'fixture_mock_context',
      'reproduction_or_evidence',
      'narrow_fix_boundary',
      'verification_or_test_plan',
      'source_signal_guidance',
    ]));
  });

  it('keeps Source A as the original section and content-template facts as Source B metadata only', () => {
    const route = routePromptEnhancement(routeInput({}));
    const result = planPromptEnhancementSections({
      routeResult: route,
      sourceRefs: [sourceA, contentTemplateSourceB],
      guidanceFacts: [fact({
        factId: 'fact-content-template-source-b',
        sourceType: 'content_template_record',
        sourceIds: ['ABSENCE_DEBUGGING_OBSERVATION'],
        targetSectionKind: 'source_signal_guidance',
        guidanceKind: 'source_signal_guidance',
        suggestedActionKind: 'add_verification',
      })],
    });

    const original = result.sectionPlans.find((section) => section.sectionKind === 'original_request_or_goal');
    const sourceGuidance = result.sectionPlans.find((section) => section.sectionKind === 'source_signal_guidance');

    expect(original?.sourceKind).toBe('source_a_user_prompt');
    expect(original?.sourceIds).toEqual(['prompt:current']);
    expect(sourceGuidance?.sourceKind).toBe('content_template_fact');
    expect(sourceGuidance?.sourceIds).toEqual(['ABSENCE_DEBUGGING_OBSERVATION']);
    expect(sourceGuidance?.contentTemplateRuntimeSeamUse).toBe('none');
    expect(sourceGuidance?.structuredContentPartRefs).toContain('guidance_fact:fact-content-template-source-b');
  });

  it('maps guidance kinds and suggested actions to deterministic section kinds without raw DS prose', () => {
    const normalized = normalizeGuidanceFacts([
      fact({
        factId: 'fact-verification',
        sourceType: 'absence_signal',
        sourceIds: ['absence:verification_gap'],
        guidanceKind: 'missing_practice',
        suggestedActionKind: 'add_verification',
        targetSectionKind: '',
      }),
      fact({
        factId: 'fact-risk',
        sourceType: 'hard_fact',
        sourceIds: ['risk:migration'],
        guidanceKind: 'safety_or_confirmation',
        suggestedActionKind: 'plan_rollback',
        targetSectionKind: '',
        riskLevel: 'high',
        safetyHooks: ['sensitive_action_confirmation'],
      }),
    ]);

    expect(normalized[0]?.targetSectionKind).toBe('verification_or_test_plan');
    expect(normalized[1]?.targetSectionKind).toBe('risk_safety_or_confirmation');
    expect(normalized[0]?.wordingHintPolicy).toBe('do_not_use_wording_hint');
    expect(normalized[0]?.llmCallPolicy).toBe('not_applicable_deterministic');
  });

  it('preserves required survivor, safety, source, and confirmation floors in section metadata', () => {
    const route = routePromptEnhancement(routeInput({
      promptText: 'Plan the database migration with backup rollback and verification',
      currentStage: 'architecture',
      firedKey: 'absence:architecture_decision_gap@architecture',
    }));
    const result = planPromptEnhancementSections({
      routeResult: route,
      sourceRefs: [sourceA, hardFactSourceB],
      guidanceFacts: [
        fact({
          factId: 'fact-rollback',
          sourceType: 'hard_fact',
          sourceIds: ['project_fact:test-suite-present'],
          guidanceKind: 'safety_or_confirmation',
          suggestedActionKind: 'plan_rollback',
          targetFamily: 'planning_spec',
          targetSectionKind: 'risk_safety_or_confirmation',
          riskLevel: 'high',
          safetyHooks: ['sensitive_action_confirmation', 'risk_or_rollback'],
          requiredBecause: 'migration_or_data_shape_change',
        }),
      ],
    });

    const risk = result.sectionPlans.find((section) => section.sectionKind === 'risk_safety_or_confirmation');

    expect(risk?.isRequired).toBe(true);
    expect(risk?.safetyFlags).toContain('source_honesty');
    expect(risk?.safetyFlags).toContain('no_authority_escalation');
    expect(risk?.safetyFlags).toContain('sensitive_action_confirmation');
    expect(risk?.safetyFlags).toContain('risk_or_rollback');
    expect(risk?.sensitivityFlags).toContain('risk:high');
    expect(risk?.supportedActions).toEqual(['use_current_body', 'use_original', 'shorter', 'more_thorough', 'more_project_grounded', 'apply_details']);
  });

  it('records suppressed, deferred, and metadata-only facts instead of silently dropping them', () => {
    const route = routePromptEnhancement(routeInput({ promptText: 'Security review this auth diff' }));
    const result = planPromptEnhancementSections({
      routeResult: route,
      sourceRefs: [sourceA, hardFactSourceB],
      guidanceFacts: [
        fact({
          factId: 'fact-metadata',
          sourceType: 'work_style_fact',
          sourceIds: ['work-style:concise'],
          guidanceKind: 'positive_practice_preservation',
          suggestedActionKind: 'no_action_render_context_only',
          targetFamily: 'family_agnostic',
          targetSectionKind: 'context_and_constraints',
          priority: 'low',
          renderPolicy: 'metadata_only',
        }),
        fact({
          factId: 'fact-suppressed',
          priority: 'suppressed',
          renderPolicy: 'suppress_with_reason',
          sourceIds: ['session_quality_low_value'],
        }),
        fact({
          factId: 'fact-deferred',
          priority: 'deferred_to_ds',
          renderPolicy: 'defer_to_normal_ds',
          sourceIds: ['old-ds:pending-advisory'],
        }),
      ],
    });

    expect(result.renderedFactIds).toEqual([]);
    expect(result.metadataOnlyFactIds).toEqual(['fact-metadata']);
    expect(result.suppressedFactIds).toEqual(['fact-suppressed']);
    expect(result.deferredFactIds).toEqual(['fact-deferred']);
  });

  it('does not create section plans or future prompt bodies for no-popup routes', () => {
    const route = routePromptEnhancement(routeInput({
      promptText: 'ok',
      triggerKind: 'none',
      firedKey: undefined,
      effectiveFiredSource: undefined,
      selectedQualifyingAbsence: undefined,
      absenceGateReason: undefined,
    }));
    const result = planPromptEnhancementSections({
      routeResult: route,
      sourceRefs: [sourceA],
      guidanceFacts: [fact({ factId: 'fact-low-info', priority: 'low', renderPolicy: 'metadata_only' })],
    });

    expect(route.noPopup).toBe(true);
    expect(result.sectionPlans).toEqual([]);
    expect(result.bodyPlan.orderedSectionPlans).toEqual([]);
    expect(result.bodyPlan.originalPromptPreservation).toBe('fallback_original_only');
    expect(result.bodyPlan.futurePromptTextPolicy).toBe('not_generated_not_stored_not_rendered');
    expect(result.bodyPlan.exposesPrecomputedVariants).toBe(false);
  });

  it('fails fast when H2 section planning lacks Source A original prompt authority', () => {
    const route = routePromptEnhancement(routeInput({}));

    expect(() => planPromptEnhancementSections({
      routeResult: route,
      sourceRefs: [contentTemplateSourceB],
    })).toThrow('Phase 4 section planning requires a Source A original prompt ref');
  });

  it('keeps every registry record free of DS template identity and hidden runtime seams', () => {
    for (const template of PROMPT_ENHANCEMENT_TAXONOMY_PRESETS) {
      expect(template.templateType).toBe('prompt-enhancement-template');
      expect(template.contentTemplateRuntimeSeamUse).toBe('none');
      expect(template.contentTemplateInputRefs).toEqual([]);
      expect(template.callVisibilityMode).toBe('deterministic');
      expect(template.llmCallPolicy).toBe('no_call');
      expect(template.fallbackContract.sendOriginalPreserved).toBe(true);
      expect(template.noPopupContract.sendOriginalPreserved).toBe(true);
    }
  });

  it('declares rejected capability compatibility instead of hiding unattached overlays', () => {
    const template = getPromptEnhancementTemplateByIntent(
      'quick_improvement.local_polish_or_small_improvement',
    );

    expect(template.capabilityCompatibility).toHaveLength(9);
    expect(template.capabilityCompatibility.find((compatibility) => (
      compatibility.capabilityId === 'capability.verification_required'
    ))).toMatchObject({
      status: 'compatible',
      reasonCode: 'declared_by_capability_contract',
    });
    expect(template.capabilityCompatibility.find((compatibility) => (
      compatibility.capabilityId === 'capability.adversarial_review'
    ))).toMatchObject({
      status: 'rejected',
      reasonCode: 'not_attached_to_selected_family_intent_or_current_scope',
    });
  });
});

describe('guidance semantics projected for the wording composer', () => {
  function planWith(facts: readonly PromptEnhancementGuidanceFact[]) {
    return planPromptEnhancementSections({
      routeResult: routePromptEnhancement(routeInput({})),
      sourceRefs: [sourceA, contentTemplateSourceB],
      guidanceFacts: facts,
    });
  }

  it('projects a public-safe fact so the section knows what it cites, not just its id', () => {
    const result = planWith([fact({ factId: 'fact-repro', privacyClass: 'public_safe' })]);

    const projected = result.guidanceSemantics.filter((entry) => entry.factId === 'fact-repro');
    expect(projected.length).toBeGreaterThan(0);
    expect(projected[0]).toMatchObject({
      guidanceKind: 'debug_evidence',
      suggestedActionKind: 'capture_reproduction',
      sourceEvidenceState: 'strong',
      riskLevel: 'none',
    });
    // It must point at a section that actually exists in this plan.
    const sectionIds = new Set(result.sectionPlans.map((plan) => plan.sectionId));
    expect(sectionIds.has(projected[0]!.sectionId)).toBe(true);
  });

  it('the same plan without the fact projects nothing — this is what changes the wording', () => {
    expect(planWith([]).guidanceSemantics).toEqual([]);
  });

  it('a fact with no section in the plan projects nothing', () => {
    // A RENDERABLE fact creates its own section, so it always has one — the planner adds the
    // section kind the fact targets. The only way a fact has no section is that it does not
    // render at all, which is what these render policies mean.
    for (const renderPolicy of ['metadata_only', 'why_help_only', 'suppress_with_reason', 'defer_to_normal_ds'] as const) {
      const result = planWith([fact({ factId: 'fact-unrendered', privacyClass: 'public_safe', renderPolicy })]);
      expect(result.guidanceSemantics.some((entry) => entry.factId === 'fact-unrendered')).toBe(false);
    }
  });

  it('withholds a local_private fact even when publicCopySafe is true', () => {
    const result = planWith([fact({
      factId: 'fact-private',
      privacyClass: 'local_private',
      publicCopySafe: true,
    })]);
    expect(result.guidanceSemantics.some((entry) => entry.factId === 'fact-private')).toBe(false);
  });

  it('withholds a fact whose sanitization state marks it unsafe to render', () => {
    for (const sanitizationState of ['unsafe_to_render', 'sensitive_ref_only'] as const) {
      const result = planWith([fact({ factId: 'fact-unsafe', privacyClass: 'public_safe', sanitizationState })]);
      expect(result.guidanceSemantics.some((entry) => entry.factId === 'fact-unsafe')).toBe(false);
    }
  });

  it('projects closed vocabularies only — never the free-text fields', () => {
    const secret = 'INTERNAL-PROJECT-DETAIL-DO-NOT-SEND';
    const result = planWith([fact({
      factId: 'fact-repro',
      privacyClass: 'public_safe',
      requiredBecause: secret,
      signalAliasResolution: secret,
      mergeGroupId: secret,
    })]);

    expect(JSON.stringify(result.guidanceSemantics)).not.toContain(secret);
    for (const entry of result.guidanceSemantics) {
      expect(Object.keys(entry).sort()).toEqual([
        'factId', 'guidanceKind', 'priority', 'riskLevel',
        'sectionId', 'sourceEvidenceState', 'sourceType', 'suggestedActionKind',
      ]);
    }
  });
});
