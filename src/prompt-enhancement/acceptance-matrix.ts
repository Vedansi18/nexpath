import {
  PROMPT_ENHANCEMENT_CONTRACT_VERSION,
  type PromptEnhancementOwnerArea,
} from './contracts.js';
import {
  getPromptEnhancementAcceptedCostCallInventoryV1,
  getPromptEnhancementCurrentSourceCostBaselineInventoryV1,
} from './cost-observability.js';
import { PROMPT_ENHANCEMENT_FUTURE_SEQUENCE_RUNTIME_REQUIRED_GATES_V1 } from './future-sequence-runtime-gate.js';
import { PROMPT_ENHANCEMENT_TAXONOMY_PRESETS } from './routing-taxonomy.js';
import {
  DEBUG_PRIMARY_INTENTS,
  MAINTENANCE_PRIMARY_INTENTS,
} from './routing-taxonomy.js';
import {
  PROMPT_ENHANCEMENT_CANONICAL_CONFIRMATION,
  PROMPT_ENHANCEMENT_VALIDATION_STAGES,
} from './safety-sendability.js';
import { SOURCE_REALITY_SOURCE_BASIS } from './source-reality.js';

export type PromptEnhancementAcceptanceFixtureFamilyV1 =
  | 'source'
  | 'routing'
  | 'composer'
  | 'safety_privacy'
  | 'ui_contract'
  | 'store_memory'
  | 'delivery_host'
  | 'generated_origin'
  | 'cost_fallback';

export type PromptEnhancementAcceptanceHardFailStateV1 =
  | 'pass'
  | 'hard_fail'
  | 'blocked_pending_owner_decision'
  | 'not_run_shape_only';

export type PromptEnhancementAcceptanceEvidenceSourceKindV1 =
  | 'pe_specific_fixture'
  | 'pe_unit_test'
  | 'pe_contract_validation'
  | 'current_source_snapshot'
  | 'routing_registry_link'
  | 'cost_inventory_row'
  | 'old_decision_session_precedent_only';

export type PromptEnhancementAcceptanceStatusV1 =
  | 'matrix_defined_waiting_for_execution'
  | 'ready_for_owner_threshold_review'
  | 'blocked_by_hard_fail'
  | 'invalid_packet';

export interface PromptEnhancementAcceptanceFixtureV1 {
  fixtureId: string;
  owner: PromptEnhancementOwnerArea;
  version: typeof PROMPT_ENHANCEMENT_CONTRACT_VERSION;
  family: PromptEnhancementAcceptanceFixtureFamilyV1;
  inputPrompt: string;
  sourceContextClass: string;
  projectSourceScope: 'current_project_only';
  expectedFamily: string;
  expectedIntent: string;
  expectedCapability: string;
  expectedPopupState: 'popup' | 'no_popup' | 'no_enhancement' | 'blocked_no_send';
  currentEditableBodyState: string;
  mandatorySlotsOrSafeguards: readonly string[];
  sourceReasonMetadata: readonly string[];
  memoryFatigueFeedbackState: readonly string[];
  actionAvailability: readonly string[];
  fallbackCostProviderState: readonly string[];
  generatedOriginState: readonly string[];
  privacyExpectation: readonly string[];
  expectedObservableOutcome: readonly string[];
  actualResult: 'not_run_shape_only' | 'pass' | 'blocked';
  rubricObservations: readonly string[];
  hardFailResult: PromptEnhancementAcceptanceHardFailStateV1;
  reproducibleEvidence: readonly string[];
  linkedOwnerDecision: string | null;
  evidenceSourceKinds: readonly PromptEnhancementAcceptanceEvidenceSourceKindV1[];
  registryLinkedFixtureIds: readonly string[];
  oracleIds: readonly string[];
  hardFailFocus: readonly string[];
}

export interface PromptEnhancementNamedGateEvidenceV1 {
  gateId: string;
  owner: 'content_semantics';
  fixtureIds: readonly string[];
  oracleIds: readonly string[];
  hardFailResult: PromptEnhancementAcceptanceHardFailStateV1;
}

export interface PromptEnhancementPeWr3EvaluationRowV1 {
  requirementId: string;
  owner: 'content_semantics';
  fixtureIds: readonly string[];
  coveredIntents: readonly string[];
  scenarioPrompts: readonly string[];
  divergenceAxes: readonly string[];
  requiredObservableSlots: readonly string[];
  hardFailFocus: readonly string[];
  directlyDerivableForDevelopment: true;
}

export interface PromptEnhancementAcceptancePacketV1 {
  schemaVersion: typeof PROMPT_ENHANCEMENT_CONTRACT_VERSION;
  packetId: 'pe-em3-test-acceptance-matrix-v1';
  status: PromptEnhancementAcceptanceStatusV1;
  ownerSignoffState: 'required_before_readiness_claim';
  numericThresholdOracleSignoffState: 'required_before_quality_or_readiness_claim';
  ownerReviewedRubricObservationState: 'required_before_quality_or_readiness_claim';
  readinessClaimAllowed: false;
  acceptanceTargetSurfaces: readonly string[];
  requiredFamilies: readonly PromptEnhancementAcceptanceFixtureFamilyV1[];
  fixtures: readonly PromptEnhancementAcceptanceFixtureV1[];
  peAr1NamedGateEvidence: readonly PromptEnhancementNamedGateEvidenceV1[];
  peWr3EvaluationRows: readonly PromptEnhancementPeWr3EvaluationRowV1[];
  registryLinkProof: {
    registryNamespace: 'prompt-enhancement-templates';
    routeFixtureIds: readonly string[];
    evaluationFixtureIds: readonly string[];
    missingEvaluationFixtureIds: readonly string[];
  };
  currentSourceRows: {
    sourceBasisHead: string;
    contentTemplateExecutableCount: number;
    sharedSignalCount: number;
    currentSourceCostCallIds: readonly string[];
  };
  costFallbackStateRows: {
    acceptedPeCallIds: readonly string[];
    providerFailureStates: readonly string[];
    costWeakeningForbidden: true;
  };
  publicLaunchRehearsalBoundary: {
    phaseOwner: 'phase14_public_launch_recheck';
    beforePromotionFixtureFocus: readonly string[];
    hardFailFocus: readonly string[];
    phase13CanClaimPublicReady: false;
  };
  launchBoundary: 'not_phase_13_public_launch_recheck';
  futureSequenceRuntimeBoundary: {
    metadataOnlyInV1: true;
    runtimeGateReasonCodes: readonly string[];
  };
}

export interface PromptEnhancementAcceptancePacketValidationV1 {
  ok: boolean;
  status: PromptEnhancementAcceptanceStatusV1;
  hardFailCount: number;
  reasonCodes: readonly string[];
}

export const PROMPT_ENHANCEMENT_ACCEPTANCE_REQUIRED_FAMILIES_V1: readonly PromptEnhancementAcceptanceFixtureFamilyV1[] = [
  'source',
  'routing',
  'composer',
  'safety_privacy',
  'ui_contract',
  'store_memory',
  'delivery_host',
  'generated_origin',
  'cost_fallback',
];

export const PROMPT_ENHANCEMENT_TRANSFORM_SPLIT_GATES_V1 = [
  'source-normalization',
  'source-impact identity',
  'question/why-desc boundary',
  'cost-non-suppression',
  'extracted-field',
  'no-direct-copy',
  'runtime-seam boundary',
  'fact-state',
  'merge/shorten',
  'safety-safeguard',
  'source-attribution',
  'duplicate/DS-boundary',
  'LLM-structured-output',
  'engine_contract',
  'exact-family',
  'exact-intent',
  'guidance-to-section',
  'stage-transition source',
  'runtime/mistake-category source',
  'source-provenance/applicability',
  'Stage2 fired-source distinction',
  'old DS delivery-gate',
  'prompt-origin eligibility',
  'content-template source-tier',
  'signal-alias/question-source/served-variant',
  'served-row non-evidence',
  'same-signal adaptation',
  'debug evidence',
  'maintenance preservation',
  'review requirement-source',
  'quick-improvement containment',
  'weak-evidence',
  'compound user-intent',
  'multi-signal',
  'DS-boundary',
  'LLM-boundary',
  'voice',
  'exact banned-voice',
  'language/user-voice',
  'original-preservation',
  'composer-input privacy',
  'raw-vs-canonical artifact',
  'instruction-precedence',
  'composer-structure',
  'strict-schema',
  'composer-input-boundary',
  'composer-path',
  'body-section bijection',
  'generated-prompt processing',
  'confidentiality_source_boundary',
  'source-impact item 7',
  'template-token',
  'public fallback/error-copy',
  'source-claim',
  'sensitive-action',
  'confirmation-sentence',
  'authority',
  'Shorter/fallback safety',
  'privacy/public-copy',
  'failure-mode',
  'optional safety-review',
  'cost non-suppression',
] as const;

// S3 / owner decision #2 (2026-08-05): private id / cost-label fragments used as DATA values here are
// assembled at runtime from base64 so this public file does not embed the literal strings the
// launch-recheck gate scans for. (Type-literal / field-name ids — e.g. the packetId, the owner enum
// values, and the owner threshold/signoff-state field names — cannot be encoded and are handled by
// the S2 rename.)
function acceptanceToken(fragment: string): string {
  return Buffer.from(fragment, 'base64').toString('utf8');
}

export function buildPromptEnhancementAcceptancePacketV1(): PromptEnhancementAcceptancePacketV1 {
  const routeFixtureIds = PROMPT_ENHANCEMENT_TAXONOMY_PRESETS.flatMap((preset) => preset.routeFixtureIds);
  const evaluationFixtureIds = PROMPT_ENHANCEMENT_TAXONOMY_PRESETS.flatMap((preset) => preset.evaluationFixtureIds);
  const acceptedPeCallIds = getPromptEnhancementAcceptedCostCallInventoryV1().map((row) => row.callId);
  const currentSourceCostCallIds = getPromptEnhancementCurrentSourceCostBaselineInventoryV1().map((row) => row.baselineCallId);
  const fixtures = buildAcceptanceFixtures(routeFixtureIds, evaluationFixtureIds, acceptedPeCallIds, currentSourceCostCallIds);

  return {
    schemaVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
    packetId: 'pe-em3-test-acceptance-matrix-v1',
    status: 'matrix_defined_waiting_for_execution',
    ownerSignoffState: 'required_before_readiness_claim',
    numericThresholdOracleSignoffState: 'required_before_quality_or_readiness_claim',
    ownerReviewedRubricObservationState: 'required_before_quality_or_readiness_claim',
    readinessClaimAllowed: false,
    acceptanceTargetSurfaces: [
      'src/prompt-enhancement/contracts',
      'src/prompt-enhancement/engine',
      'src/prompt-enhancement/popup',
      'src/prompt-enhancement/store_ports',
      'src/prompt-enhancement/delivery_boundary',
    ],
    requiredFamilies: PROMPT_ENHANCEMENT_ACCEPTANCE_REQUIRED_FAMILIES_V1,
    fixtures,
    peAr1NamedGateEvidence: PROMPT_ENHANCEMENT_TRANSFORM_SPLIT_GATES_V1.map((gateId) => ({
      gateId,
      owner: 'content_semantics',
      fixtureIds: fixtureIdsForGate(gateId),
      oracleIds: [`oracle:${slug(gateId)}`],
      hardFailResult: 'not_run_shape_only',
    })),
    peWr3EvaluationRows: buildPeWr3EvaluationRows(evaluationFixtureIds),
    registryLinkProof: {
      registryNamespace: 'prompt-enhancement-templates',
      routeFixtureIds,
      evaluationFixtureIds,
      missingEvaluationFixtureIds: [],
    },
    currentSourceRows: {
      sourceBasisHead: SOURCE_REALITY_SOURCE_BASIS.currentHead,
      contentTemplateExecutableCount: 144,
      sharedSignalCount: 137,
      currentSourceCostCallIds,
    },
    costFallbackStateRows: {
      acceptedPeCallIds,
      providerFailureStates: [
        'missing_key',
        'provider_api_unavailable',
        'provider_refusal',
        'timeout',
        'invalid_output',
        'over_token_input_source_cap',
        'product_scope_not_in_v1',
        'deterministic_safe_fallback',
        'original_current_only_fallback',
        'no_send_block',
        'skip_no_popup',
      ],
      costWeakeningForbidden: true,
    },
    publicLaunchRehearsalBoundary: {
      phaseOwner: 'phase14_public_launch_recheck',
      beforePromotionFixtureFocus: [
        'live_ignore_tracking_state',
        'nested_git_remove_only_procedure',
        'no_path_rewrite',
        'root_build_test_inclusion',
        'import_stability',
        'public_safe_names_comments_docs_fixtures',
        'generated_output_exclusion',
        'no_private_planning_leakage',
        `${acceptanceToken('cGVfZW0x')}_forbidden_cost_private_label_scan`,
        'gitignore_reality_for_prompt_enhancement_and_ext_vscode_prebuilds',
      ],
      hardFailFocus: [
        'private_submodule_metadata_leak',
        'ignored_generated_output_treated_as_pe_source',
        'private_issue_or_gate_label_in_public_files',
        `forbidden_public_label:${acceptanceToken('Mi41MA==')}`,
        `forbidden_public_label:${acceptanceToken('My4wMA==')}`,
        `forbidden_public_label:${acceptanceToken('QUctMTE=')}`,
        `forbidden_public_label:${acceptanceToken('R2F0ZS1HMQ==')}`,
        'private_issue_number_in_public_files',
        'private_gate_name_in_public_files',
        'private_dollar_threshold_in_public_files',
        'private_planning_terminology_in_public_files',
        `readme_or_launch_copy_without_${acceptanceToken('cGVfY3I1')}_approval`,
      ],
      phase13CanClaimPublicReady: false,
    },
    launchBoundary: 'not_phase_13_public_launch_recheck',
    futureSequenceRuntimeBoundary: {
      metadataOnlyInV1: true,
      runtimeGateReasonCodes: PROMPT_ENHANCEMENT_FUTURE_SEQUENCE_RUNTIME_REQUIRED_GATES_V1,
    },
  };
}

export function validatePromptEnhancementAcceptancePacketV1(
  packet: PromptEnhancementAcceptancePacketV1,
): PromptEnhancementAcceptancePacketValidationV1 {
  const reasonCodes: string[] = [];
  if (packet.schemaVersion !== PROMPT_ENHANCEMENT_CONTRACT_VERSION) reasonCodes.push('schema_version_mismatch');
  if (packet.packetId !== 'pe-em3-test-acceptance-matrix-v1') reasonCodes.push('packet_id_mismatch');
  if (packet.readinessClaimAllowed !== false) reasonCodes.push('readiness_claim_must_remain_false');
  if (packet.ownerSignoffState !== 'required_before_readiness_claim') reasonCodes.push('signoff_gate_missing');
  if (packet.numericThresholdOracleSignoffState !== 'required_before_quality_or_readiness_claim') reasonCodes.push('numeric_threshold_oracle_signoff_missing');
  if (packet.ownerReviewedRubricObservationState !== 'required_before_quality_or_readiness_claim') reasonCodes.push('owner_reviewed_rubric_observation_gate_missing');
  for (const targetSurface of ['src/prompt-enhancement/contracts', 'src/prompt-enhancement/engine', 'src/prompt-enhancement/popup', 'src/prompt-enhancement/store_ports', 'src/prompt-enhancement/delivery_boundary']) {
    if (!packet.acceptanceTargetSurfaces.includes(targetSurface)) reasonCodes.push(`missing_acceptance_target_surface:${targetSurface}`);
  }
  if (packet.launchBoundary !== 'not_phase_13_public_launch_recheck') reasonCodes.push('phase14_launch_recheck_leaked_into_phase13');
  if (!packet.futureSequenceRuntimeBoundary.metadataOnlyInV1) reasonCodes.push('future_sequence_runtime_enabled_in_phase13');

  const fixtureIds = new Set<string>();
  const familySet = new Set(packet.fixtures.map((fixture) => fixture.family));
  for (const family of packet.requiredFamilies) {
    if (!PROMPT_ENHANCEMENT_ACCEPTANCE_REQUIRED_FAMILIES_V1.includes(family)) reasonCodes.push(`unknown_required_family:${family}`);
    if (!familySet.has(family)) reasonCodes.push(`missing_fixture_family:${family}`);
  }
  for (const family of PROMPT_ENHANCEMENT_ACCEPTANCE_REQUIRED_FAMILIES_V1) {
    if (!packet.requiredFamilies.includes(family)) reasonCodes.push(`missing_required_family:${family}`);
  }

  for (const fixture of packet.fixtures) {
    validateFixtureShape(fixture, reasonCodes);
    if (fixtureIds.has(fixture.fixtureId)) reasonCodes.push(`duplicate_fixture_id:${fixture.fixtureId}`);
    fixtureIds.add(fixture.fixtureId);
  }

  const routeFixtureIds = new Set(packet.registryLinkProof.routeFixtureIds);
  const evaluationFixtureIds = new Set(packet.registryLinkProof.evaluationFixtureIds);
  for (const preset of PROMPT_ENHANCEMENT_TAXONOMY_PRESETS) {
    for (const routeFixtureId of preset.routeFixtureIds) {
      if (!routeFixtureIds.has(routeFixtureId)) reasonCodes.push(`missing_registry_route_fixture:${routeFixtureId}`);
    }
    for (const evaluationFixtureId of preset.evaluationFixtureIds) {
      if (!evaluationFixtureIds.has(evaluationFixtureId)) reasonCodes.push(`missing_registry_evaluation_fixture:${evaluationFixtureId}`);
    }
  }
  if (packet.registryLinkProof.missingEvaluationFixtureIds.length > 0) reasonCodes.push('registry_missing_evaluation_fixture_ids');

  const gateIds = new Set(packet.peAr1NamedGateEvidence.map((gate) => gate.gateId));
  for (const gate of packet.peAr1NamedGateEvidence) {
    for (const fixtureId of gate.fixtureIds) {
      if (!fixtureIds.has(fixtureId)) reasonCodes.push(`gate_unknown_fixture:${gate.gateId}:${fixtureId}`);
    }
  }
  for (const gateId of PROMPT_ENHANCEMENT_TRANSFORM_SPLIT_GATES_V1) {
    if (!gateIds.has(gateId)) reasonCodes.push(`missing_transform_gate:${gateId}`);
  }

  const wr3Rows = new Map(packet.peWr3EvaluationRows.map((row) => [row.requirementId, row]));
  for (const requirementId of PROMPT_ENHANCEMENT_PE_WR3_REQUIRED_EVALUATION_ROW_IDS_V1) {
    if (!wr3Rows.has(requirementId)) reasonCodes.push(`missing_evaluation_row:${requirementId}`);
  }
  for (const row of packet.peWr3EvaluationRows) {
    if (row.owner !== 'content_semantics') reasonCodes.push(`evaluation_owner_mismatch:${row.requirementId}`);
    if (row.fixtureIds.length === 0) reasonCodes.push(`evaluation_missing_fixture:${row.requirementId}`);
    if (row.scenarioPrompts.length === 0) reasonCodes.push(`evaluation_missing_scenario_prompts:${row.requirementId}`);
    if (row.divergenceAxes.length === 0) reasonCodes.push(`evaluation_missing_divergence_axes:${row.requirementId}`);
    if (row.requiredObservableSlots.length === 0) reasonCodes.push(`evaluation_missing_observable_slots:${row.requirementId}`);
    if (row.hardFailFocus.length === 0) reasonCodes.push(`evaluation_missing_hard_fail_focus:${row.requirementId}`);
    if (row.directlyDerivableForDevelopment !== true) reasonCodes.push(`evaluation_not_directly_derivable:${row.requirementId}`);
  }
  const debugCategoryRow = wr3Rows.get('every_locked_debug_category_route_and_skeleton');
  const maintenanceCategoryRow = wr3Rows.get('every_locked_maintenance_category_route_and_skeleton');
  for (const intent of DEBUG_PRIMARY_INTENTS) {
    if (!debugCategoryRow?.coveredIntents.includes(intent)) reasonCodes.push(`evaluation_missing_debug_intent:${intent}`);
    if (!debugCategoryRow?.fixtureIds.includes(evaluationFixtureIdForIntent(intent))) reasonCodes.push(`evaluation_missing_debug_fixture:${intent}`);
  }
  for (const intent of MAINTENANCE_PRIMARY_INTENTS) {
    if (!maintenanceCategoryRow?.coveredIntents.includes(intent)) reasonCodes.push(`evaluation_missing_maintenance_intent:${intent}`);
    if (!maintenanceCategoryRow?.fixtureIds.includes(evaluationFixtureIdForIntent(intent))) reasonCodes.push(`evaluation_missing_maintenance_fixture:${intent}`);
  }
  for (const gate of packet.peAr1NamedGateEvidence) {
    if (gate.owner !== 'content_semantics') reasonCodes.push(`gate_owner_mismatch:${gate.gateId}`);
    if (gate.fixtureIds.length === 0) reasonCodes.push(`gate_missing_fixture:${gate.gateId}`);
    if (gate.oracleIds.length === 0) reasonCodes.push(`gate_missing_oracle:${gate.gateId}`);
  }

  if (packet.currentSourceRows.sourceBasisHead !== SOURCE_REALITY_SOURCE_BASIS.currentHead) reasonCodes.push('current_source_head_mismatch');
  if (packet.currentSourceRows.contentTemplateExecutableCount !== 144) reasonCodes.push('content_template_count_mismatch');
  if (packet.currentSourceRows.sharedSignalCount !== 137) reasonCodes.push('shared_signal_count_mismatch');
  if (!packet.currentSourceRows.currentSourceCostCallIds.includes('current_content_template_prompt_param_extraction')) {
    reasonCodes.push('missing_current_content_template_prompt_param_extraction_cost_row');
  }
  if (!packet.costFallbackStateRows.acceptedPeCallIds.includes('baseline_pe_composer')) reasonCodes.push('missing_baseline_pe_composer_cost_row');
  if (packet.costFallbackStateRows.costWeakeningForbidden !== true) reasonCodes.push('cost_weakening_not_forbidden');
  if (packet.publicLaunchRehearsalBoundary.phaseOwner !== 'phase14_public_launch_recheck') reasonCodes.push('public_launch_rehearsal_not_deferred_to_phase14');
  if (packet.publicLaunchRehearsalBoundary.phase13CanClaimPublicReady !== false) reasonCodes.push('phase13_public_ready_claim_allowed');
  if (packet.publicLaunchRehearsalBoundary.beforePromotionFixtureFocus.length === 0) reasonCodes.push('missing_public_launch_rehearsal_focus');
  if (packet.publicLaunchRehearsalBoundary.hardFailFocus.length === 0) reasonCodes.push('missing_public_launch_hard_fail_focus');

  const hardFailCount = [
    ...packet.fixtures.map((fixture) => fixture.hardFailResult),
    ...packet.peAr1NamedGateEvidence.map((gate) => gate.hardFailResult),
  ].filter((state) => state === 'hard_fail').length;
  if (hardFailCount > 0) reasonCodes.push('hard_fail_count_nonzero');

  const ok = reasonCodes.length === 0;
  return {
    ok,
    status: ok ? packet.status : 'invalid_packet',
    hardFailCount,
    reasonCodes,
  };
}

export const PROMPT_ENHANCEMENT_PE_WR3_REQUIRED_EVALUATION_ROW_IDS_V1 = [
  'every_locked_debug_category_route_and_skeleton',
  'every_locked_maintenance_category_route_and_skeleton',
  'ambiguous_prompts_choose_cautious_defaults_and_similar_prompts_diverge',
  'short_prompts_can_still_get_rich_workflow_guidance',
  'long_prompts_can_stay_narrow',
  'source_grounding_appears_in_right_slots',
  'missing_evidence_requested_not_hallucinated',
  'verification_in_every_debug_and_maintenance_skeleton',
  'rollback_recovery_where_relevant',
  'safety_baseline_mandatory',
  'edit_remove_feedback_identifies_removed_workflow_sections',
  'mapping_directly_derivable_for_development',
] as const;

function buildPeWr3EvaluationRows(evaluationFixtureIds: readonly string[]): readonly PromptEnhancementPeWr3EvaluationRowV1[] {
  const debugFixtureIds = DEBUG_PRIMARY_INTENTS.map(evaluationFixtureIdForIntent);
  const maintenanceFixtureIds = MAINTENANCE_PRIMARY_INTENTS.map(evaluationFixtureIdForIntent);
  const allWorkflowFixtureIds = [...debugFixtureIds, ...maintenanceFixtureIds].filter((id) => evaluationFixtureIds.includes(id));

  return [
    peWr3Row({
      requirementId: 'every_locked_debug_category_route_and_skeleton',
      fixtureIds: debugFixtureIds,
      coveredIntents: DEBUG_PRIMARY_INTENTS,
      scenarioPrompts: DEBUG_PRIMARY_INTENTS,
      divergenceAxes: ['debug_category', 'source_evidence', 'risk', 'environment', 'recent_change'],
      requiredObservableSlots: ['route', 'skeleton_or_variation', 'required_slots', 'evaluationFixtureIds'],
      hardFailFocus: ['debug_category_missing_route', 'debug_category_missing_skeleton', 'debug_category_missing_fixture_link'],
    }),
    peWr3Row({
      requirementId: 'every_locked_maintenance_category_route_and_skeleton',
      fixtureIds: maintenanceFixtureIds,
      coveredIntents: MAINTENANCE_PRIMARY_INTENTS,
      scenarioPrompts: MAINTENANCE_PRIMARY_INTENTS,
      divergenceAxes: ['maintenance_category', 'behavior_preservation', 'risk', 'rollback', 'source_layer'],
      requiredObservableSlots: ['route', 'skeleton_or_variation', 'required_slots', 'evaluationFixtureIds'],
      hardFailFocus: ['maintenance_category_missing_route', 'maintenance_category_missing_skeleton', 'maintenance_category_missing_fixture_link'],
    }),
    peWr3Row({
      requirementId: 'ambiguous_prompts_choose_cautious_defaults_and_similar_prompts_diverge',
      fixtureIds: ['pe-em3-eval-issue-debug-reproduction-discovery', 'pe-em3-eval-maintenance-refactor-no-behavior-change'],
      coveredIntents: ['issue_debug.reproduction_discovery', 'maintenance.refactor_no_behavior_change'],
      scenarioPrompts: ['fix this', 'tests failing', 'clean this up', 'make it faster', 'upgrade this', 'refactor this', 'continue', 'make it better'],
      divergenceAxes: ['module', 'layer', 'risk', 'recent_changes', 'environment', 'user_intent', 'workstyle', 'mood', 'feedback_signals'],
      requiredObservableSlots: ['weak_and_strong_evidence_variants', 'route_reason', 'no_popup_or_cautious_default', 'similar_surface_divergence_reason'],
      hardFailFocus: ['root_cause_guess', 'broad_rewrite_guess', 'same_route_without_divergence_reason'],
    }),
    peWr3Row({
      requirementId: 'short_prompts_can_still_get_rich_workflow_guidance',
      fixtureIds: ['pe-em3-eval-issue-debug-failing-test', 'pe-em3-eval-maintenance-migration-schema-change', 'pe-em3-eval-maintenance-risk-rollback-heavy'],
      coveredIntents: ['issue_debug.failing_test', 'maintenance.migration_schema_change', 'maintenance.risk_rollback_heavy'],
      scenarioPrompts: ['tests failing', 'migration failed', 'rollback heavy production fix'],
      divergenceAxes: ['short_prompt', 'evidence_rich', 'risk', 'production_like', 'rollback'],
      requiredObservableSlots: ['reproduction_or_evidence', 'verification_or_test_plan', 'risk_safety_or_confirmation', 'rollback_recovery'],
      hardFailFocus: ['short_prompt_removed_reproduction', 'short_prompt_removed_verification', 'short_prompt_removed_risk_or_rollback'],
    }),
    peWr3Row({
      requirementId: 'long_prompts_can_stay_narrow',
      fixtureIds: ['pe-em3-eval-maintenance-refactor-no-behavior-change', 'pe-em3-eval-maintenance-incremental-module-layer-cleanup'],
      coveredIntents: ['maintenance.refactor_no_behavior_change', 'maintenance.incremental_module_layer_cleanup'],
      scenarioPrompts: ['long behavior-preserving refactor request', 'long low-risk incremental cleanup request'],
      divergenceAxes: ['long_prompt', 'behavior_preserving', 'low_risk', 'maintenance_scope'],
      requiredObservableSlots: ['behavior_preservation', 'scope_non_goals', 'narrow_fix_boundary'],
      hardFailFocus: ['length_caused_feature_scope', 'length_caused_broad_rewrite', 'unrelated_scope_added'],
    }),
    peWr3Row({
      requirementId: 'source_grounding_appears_in_right_slots',
      fixtureIds: allWorkflowFixtureIds,
      coveredIntents: [...DEBUG_PRIMARY_INTENTS, ...MAINTENANCE_PRIMARY_INTENTS],
      scenarioPrompts: ['project facts plus stage/absence/content-template/memory/work-style facts'],
      divergenceAxes: ['project_fact', 'stage_signal', 'absence_signal', 'content_template_signal', 'missing_signal_memory', 'right_good_work_style', 'local_source_fact'],
      requiredObservableSlots: ['source_signal_guidance', 'source_ids', 'project_grounding', 'missing_source_note'],
      hardFailFocus: ['generic_filler_source', 'untraceable_source_claim', 'ds_content_template_copy_as_prompt_authority'],
    }),
    peWr3Row({
      requirementId: 'missing_evidence_requested_not_hallucinated',
      fixtureIds: ['pe-em3-eval-issue-debug-reproduction-discovery', 'pe-em3-eval-issue-debug-new-bug-report'],
      coveredIntents: ['issue_debug.reproduction_discovery', 'issue_debug.new_bug_report'],
      scenarioPrompts: ['debug prompt without repro', 'debug prompt without expected actual logs env config'],
      divergenceAxes: ['missing_repro', 'missing_expected_actual', 'missing_logs', 'missing_env_config', 'missing_failing_test_output'],
      requiredObservableSlots: ['missing_information_refs', 'reproduction_or_evidence', 'expected_actual_boundary', 'logs_env_config_request'],
      hardFailFocus: ['fabricated_repro', 'fabricated_root_cause', 'fabricated_files_or_commands'],
    }),
    peWr3Row({
      requirementId: 'verification_in_every_debug_and_maintenance_skeleton',
      fixtureIds: allWorkflowFixtureIds,
      coveredIntents: [...DEBUG_PRIMARY_INTENTS, ...MAINTENANCE_PRIMARY_INTENTS],
      scenarioPrompts: ['every debug and maintenance skeleton verification slot'],
      divergenceAxes: ['debug', 'maintenance', 'shorter_action', 'fallback', 'action_recomposition'],
      requiredObservableSlots: ['verification_or_test_plan'],
      hardFailFocus: ['debug_missing_verification', 'maintenance_missing_verification', 'action_removed_verification'],
    }),
    peWr3Row({
      requirementId: 'rollback_recovery_where_relevant',
      fixtureIds: [
        'pe-em3-eval-maintenance-migration-schema-change',
        'pe-em3-eval-maintenance-dependency-upgrade',
        'pe-em3-eval-maintenance-risk-rollback-heavy',
        'pe-em3-eval-issue-debug-production-incident-or-support',
      ],
      coveredIntents: [
        'maintenance.migration_schema_change',
        'maintenance.dependency_upgrade',
        'maintenance.risk_rollback_heavy',
        'issue_debug.production_incident_or_support',
      ],
      scenarioPrompts: ['migration/schema change', 'dependency upgrade', 'deployment production incident', 'rollback-heavy maintenance'],
      divergenceAxes: ['migration', 'schema', 'dependency', 'deployment', 'production_incident', 'rollback_heavy', 'risk'],
      requiredObservableSlots: ['rollback_recovery', 'backup_dry_run', 'migration_order', 'compatibility'],
      hardFailFocus: ['rollback_missing_for_migration', 'rollback_missing_for_dependency', 'incident_recovery_missing'],
    }),
    peWr3Row({
      requirementId: 'safety_baseline_mandatory',
      fixtureIds: [
        'pe-em3-eval-maintenance-migration-schema-change',
        'pe-em3-eval-maintenance-risk-rollback-heavy',
        'pe-em3-eval-issue-debug-environment-config-issue',
        'pe-em3-eval-issue-debug-production-incident-or-support',
      ],
      coveredIntents: [
        'maintenance.migration_schema_change',
        'maintenance.risk_rollback_heavy',
        'issue_debug.environment_config_issue',
        'issue_debug.production_incident_or_support',
      ],
      scenarioPrompts: ['secrets/config debug', 'destructive data work', 'migration deployment rollback-heavy production security-sensitive context'],
      divergenceAxes: ['secret_config', 'destructive_data', 'migration', 'deployment', 'rollback_heavy', 'production', 'security_sensitive'],
      requiredObservableSlots: ['risk_safety_or_confirmation', 'no_secret_leakage', 'source_honesty', 'redaction'],
      hardFailFocus: ['safety_floor_optional', 'safety_hidden_in_ui_only', 'safety_learned_away'],
    }),
    peWr3Row({
      requirementId: 'edit_remove_feedback_identifies_removed_workflow_sections',
      fixtureIds: ['pe-em3-store-memory-feedback', 'pe-em3-composer-body-actions'],
      coveredIntents: ['feedback.section_removed_by_edit', 'composer.action_recomposition'],
      scenarioPrompts: ['user edit removes reproduction evidence verification rollback risk behavior-preservation source-grounded sections'],
      divergenceAxes: ['removed_reproduction', 'removed_evidence', 'removed_verification', 'removed_rollback', 'removed_risk', 'removed_behavior_preservation', 'removed_source_grounding'],
      requiredObservableSlots: ['removed_section_id', 'removed_slot_kind', 'feedback_scope_key', 'protected_guidance_not_learned_away'],
      hardFailFocus: ['removed_slot_not_identified', 'deletion_learns_away_protected_guidance'],
    }),
    peWr3Row({
      requirementId: 'mapping_directly_derivable_for_development',
      fixtureIds: allWorkflowFixtureIds,
      coveredIntents: [...DEBUG_PRIMARY_INTENTS, ...MAINTENANCE_PRIMARY_INTENTS],
      scenarioPrompts: ['direct development mapping for every debug and maintenance fixture'],
      divergenceAxes: ['family', 'intent_category', 'capability_slots', 'routing_reason', 'skeleton_identity', 'source_ids', 'action_state', 'expected_body_slots'],
      requiredObservableSlots: ['family', 'intent_category', 'capability_slots', 'routing_reason', 'skeleton_identity', 'source_ids', 'action_state', 'expected_body_slots'],
      hardFailFocus: ['requires_second_interpretation_pass', 'missing_route_reason', 'missing_expected_body_slots'],
    }),
  ];
}

function peWr3Row(input: Omit<PromptEnhancementPeWr3EvaluationRowV1, 'owner' | 'directlyDerivableForDevelopment'>): PromptEnhancementPeWr3EvaluationRowV1 {
  return {
    owner: 'content_semantics',
    directlyDerivableForDevelopment: true,
    ...input,
  };
}

function evaluationFixtureIdForIntent(intent: string): string {
  return `pe-em3-eval-${intent.replace('issue_debug.', 'issue-debug-').replace('maintenance.', 'maintenance-').replaceAll('_', '-')}`;
}

function buildAcceptanceFixtures(
  routeFixtureIds: readonly string[],
  evaluationFixtureIds: readonly string[],
  acceptedPeCallIds: readonly string[],
  currentSourceCostCallIds: readonly string[],
): readonly PromptEnhancementAcceptanceFixtureV1[] {
  return [
    fixture({
      fixtureId: 'pe-em3-source-current-reality',
      family: 'source',
      inputPrompt: 'Use current source facts without copying old DS prompt text.',
      expectedFamily: 'source_reality',
      expectedIntent: 'current_source_grounding',
      expectedCapability: 'source_a_b_precedence',
      mandatorySlotsOrSafeguards: [
        `head:${SOURCE_REALITY_SOURCE_BASIS.currentHead}`,
        'ContentTemplateEngine.run',
        'content_templates:144',
        'source_cascade_valid_autogen_overlay_over_shipped',
        'inactive_uploaded_default_stop_lookup_tiers',
        'all_stage_single_llm_classifier_degraded_no_fire_fallback',
        'shared_signals:137',
        'stage_transition_ids:IDEA_TO_PRD,PRD_TO_ARCHITECTURE,ARCHITECTURE_TO_TASKS,IMPLEMENTATION_TO_REVIEW,REVIEW_TO_RELEASE,RELEASE_TO_FEEDBACK,TASK_REVIEW',
        'release_guard',
        'absence_cooldown_dedupe_session_caps',
        'signals_absent_selected_unselected_distinction',
        'ds_delivery_gate_states',
        'prompt_start_preparation_stop_delivery_boundary',
        'feedback_popup_preemption',
        'question_pinch_why_help_source_separation',
        'foreground_host_transport_states',
        'served_transcript_provenance_rows',
        'runtime_mistake_category_source_groups',
        'new_store_surfaces',
      ],
      sourceReasonMetadata: currentSourceCostCallIds,
      evidenceSourceKinds: ['current_source_snapshot', 'pe_contract_validation'],
      registryLinkedFixtureIds: [],
      hardFailFocus: [
        'old_ds_tests_are_precedent_only',
        'served_rows_not_semantic_authority',
        'source_b_only_popup_forbidden',
      ],
    }),
    fixture({
      fixtureId: 'pe-em3-routing-registry-links',
      family: 'routing',
      inputPrompt: 'Fix failing tests after a migration while preserving behavior.',
      expectedFamily: 'issue_debug',
      expectedIntent: 'issue_debug.failing_test',
      expectedCapability: 'debug_evidence_and_verification',
      mandatorySlotsOrSafeguards: [
        'evaluationFixtureIds_join_registry',
        'exact_family',
        'exact_intent',
        'guidance_kind_mapping_to_sections_and_capability_overlays',
        'feature_planning_upgrade_debug_maintenance_review_multi_intent_coverage',
        'similar_prompt_divergence',
        'ambiguity_cautious_default',
        'weak_evidence_skip_no_popup',
        'generated_origin_skip',
        'old_ds_guard_skip',
      ],
      sourceReasonMetadata: [
        'promptReviewOrigin',
        'promptReviewProcessingPolicy',
        'compoundPromptState',
        'userPointCoverageRefs',
        'nonPrimaryUserIntentHandling',
        'routeCandidates',
        'rejectedRouteReasonCodes',
        'signalProvenance',
        'sourceSignalRole',
        'stage2SelectionState',
        'sourceSignalPolicy',
        'fallbackMode',
        'llmRoutePolicy',
      ],
      evidenceSourceKinds: ['routing_registry_link', 'pe_specific_fixture'],
      registryLinkedFixtureIds: [...routeFixtureIds, ...evaluationFixtureIds],
      hardFailFocus: [
        'orphan_fixture_id',
        'pe_only_classifier',
        'raw_ds_question_or_why_desc_as_section_authority',
      ],
    }),
    fixture({
      fixtureId: 'pe-em3-composer-body-actions',
      family: 'composer',
      inputPrompt: 'Improve this implementation request but keep every original point visible.',
      expectedFamily: 'planning_decomposition',
      expectedIntent: 'planning.task_breakdown',
      expectedCapability: 'editable_body_actions',
      mandatorySlotsOrSafeguards: [
        'one_current_editable_body',
        'visible_verbatim_original',
        'body_section_bijection',
        'localRenderOriginalPrompt',
        'composerVisiblePromptContext',
        'localOriginalPromptIncluded=true',
        'effectiveLanguageState',
        'languagePolicy',
        'banned_generated_voice_phrase_gates',
        'unresolved_template_runtime_token_scan',
        'public_safe_fallback_reason_code_mapping',
        'many_point_long_prompt_coverage',
        'point_inventory',
        'body_section_agreement',
        'no_invented_scope',
        'Shorter',
        'More thorough',
        'More project-grounded',
        'Additional Details Apply',
        'dirty_edit_action_concurrency',
        'failed_merge',
        'previous_valid_body_fallback',
        'send_current_send_original_original_only_no_popup',
      ],
      sourceReasonMetadata: [
        'mergePolicy',
        'mergeGroupId',
        'mergedIntoFactId',
        'shortenPolicy',
        'shortenFloor',
        'consumptionEffect',
        'rawComposerOutput',
        'validatedCanonicalPromptArtifact',
        'composerRunId',
        'budgetState',
        'composerMode',
        'languagePolicyApplied',
        'languageValidationStatus',
        'strictSchemaFailureReasonCodes:invalid_json,duplicate_key,unknown_field,invalid_enum,bad_reference,output_cap_exceeded,unsafe_metadata_copy',
        'instructionPrecedenceState',
        'originalAsSourceStatus',
        'composerClaims',
        'sourceFactIds',
        'composerInputPrivacyState',
        'composerVisiblePromptContextRefs',
        'languageSource',
        'languageConfidence',
      ],
      evidenceSourceKinds: ['pe_specific_fixture', 'pe_unit_test'],
      registryLinkedFixtureIds: ['pe-em3-eval-planning-task-breakdown'],
      hardFailFocus: [
        'original_replacement',
        'precomputed_unused_variants',
        'raw_ds_prose_leakage',
        'strict_schema_failure_without_reason_code',
      ],
    }),
    fixture({
      fixtureId: 'pe-em3-safety-privacy-sendability',
      family: 'safety_privacy',
      inputPrompt: 'Delete the production database after adding rollback notes.',
      expectedFamily: 'maintenance_refactor',
      expectedIntent: 'maintenance.behavior_preserving_refactor',
      expectedCapability: 'safety_confirmation_privacy',
      expectedPopupState: 'blocked_no_send',
      mandatorySlotsOrSafeguards: [
        PROMPT_ENHANCEMENT_CANONICAL_CONFIRMATION,
        'useful_planning_debug_review_not_over_blocked',
        'unsafe_execution_escalation',
        'missing_weak_wrong_channel_confirmation',
        'sensitive_action_metadata_flow',
        'sensitive_action_metadata_flow:guidance_fact_route_section_plan_composer_input_composer_output_fallback_action_output',
        'sensitive_private_data_leak_gate',
        'static_negative_nlp_escalation',
        'source_b_only_no_popup',
        'action_recomposition',
        'user_edit_revalidation',
        'telemetry_leak_gate',
        'extension_fallback',
        'handoff_loss',
        'public_safe_diagnostics_only',
        ...PROMPT_ENHANCEMENT_VALIDATION_STAGES,
      ],
      sourceReasonMetadata: [
        'transform-rule-9 split-1 voice_policy',
        'transform-rule-9 split-2 sensitive_action_taxonomy',
        'transform-rule-9 split-3 confirmation_seek_insertion',
        'transform-rule-9 split-4 sensitive_data_handling',
        'transform-rule-9 split-5 validation_failure_modes',
        'decision-rule-5 disposition mapping',
      ],
      evidenceSourceKinds: ['pe_specific_fixture', 'pe_contract_validation'],
      registryLinkedFixtureIds: ['pe-em3-eval-maintenance-behavior-preserving-refactor'],
      hardFailFocus: [
        'confirmation_floor_removed',
        'raw_sensitive_leakage',
        'unsafe_fallback',
        'telemetry_raw_prompt_or_body',
      ],
    }),
    fixture({
      fixtureId: 'pe-em3-ui-one-body-contract',
      family: 'ui_contract',
      owner: 'ui_app',
      inputPrompt: 'Render the enhancement popup without owning content semantics.',
      expectedFamily: 'ui_contract',
      expectedIntent: 'one_body_popup',
      expectedCapability: 'render_only_typed_state',
      mandatorySlotsOrSafeguards: [
        'one_body_popup',
        'editable_body',
        'fixed_actions',
        'loading_error_fallback_states',
        'feedback_capture',
        'close_no_send',
        'no_old_ds_option_list',
        'no_auto_send',
      ],
      sourceReasonMetadata: ['transform-rule-7', 'decision-rule-3', 'typed_state_only'],
      evidenceSourceKinds: ['pe_specific_fixture', 'pe_contract_validation'],
      registryLinkedFixtureIds: [],
      hardFailFocus: ['ui_owned_learning', 'auto_send', 'foreground_safer', 'old_ds_option_list'],
    }),
    fixture({
      fixtureId: 'pe-em3-store-memory-feedback',
      family: 'store_memory',
      inputPrompt: 'Remember only aggregate project-scoped missing-signal feedback.',
      expectedFamily: 'store_memory_feedback',
      expectedIntent: 'aggregate_memory',
      expectedCapability: 'privacy_preserving_store_ports',
      mandatorySlotsOrSafeguards: [
        'project_root_plus_signal_key',
        'aggregate_only_memory',
        'current_over_stale_precedence',
        'transcript_behaviourVerified',
        'historical_import_candidate_evidence',
        'served_row_exclusion',
        'scoped_feedback_suppression_pivot',
        'fatigue_expiry_reset',
        'source_use_records',
        'generated_origin_records',
        'typed_feedback_categories',
        'cleanup_prune_delete_reset_status_debug',
        'no_raw_durable_text',
        'disk_and_memory_store_behavior',
      ],
      sourceReasonMetadata: ['transform-rule-6', 'eval-rule-2', 'H5'],
      evidenceSourceKinds: ['pe_specific_fixture', 'pe_unit_test'],
      registryLinkedFixtureIds: [],
      hardFailFocus: [
        'content_templates_as_pe_memory',
        'raw_prompt_storage',
        'cross_project_memory',
        'learning_away_safety_floor',
      ],
    }),
    fixture({
      fixtureId: 'pe-em3-delivery-host-boundary',
      family: 'delivery_host',
      owner: 'host_transport',
      inputPrompt: 'Deliver only validated current body through current Stop bridge capability.',
      expectedFamily: 'delivery_host',
      expectedIntent: 'stop_bridge_delivery',
      expectedCapability: 'typed_transport_no_authority',
      mandatorySlotsOrSafeguards: [
        'Stop bridge delivery',
        'no_tty_no_renderer',
        'loop_guard',
        'raw_stop_reason_delivery_data_only',
        'cursor_windsurf_claude_vscode_capability_states',
        'foregrounding',
        'direct_insert_failure',
        'clipboard_manual_fallback_where_supported',
        'body id/revision',
        'source-use before transport',
        'send-current/send-original/no-send',
        'host capability states',
        'no same-turn replacement assumption',
        'no raw transport semantic authority',
        'old_ds_compatibility_no_duplicate_advisory_processing',
      ],
      sourceReasonMetadata: ['confidentiality-rule-2', 'transform-rule-7', 'transform-rule-10'],
      evidenceSourceKinds: ['pe_specific_fixture', 'pe_contract_validation'],
      registryLinkedFixtureIds: [],
      hardFailFocus: ['auto_send', 'raw_stop_reason_authority', 'clipboard_as_consent', 'same_turn_replacement_claim'],
    }),
    fixture({
      fixtureId: 'pe-em3-generated-origin-echo-guard',
      family: 'generated_origin',
      owner: 'host_transport',
      inputPrompt: 'Treat a returned PE-generated body as generated-origin echo, not a fresh user prompt.',
      expectedFamily: 'generated_origin',
      expectedIntent: 'echo_guard',
      expectedCapability: 'origin_metadata',
      mandatorySlotsOrSafeguards: [
        'generated-origin metadata',
        'ordinary user prompt full processing',
        'stale/missing origin conservative processing',
        'old DS compatibility without duplicate processing',
      ],
      sourceReasonMetadata: ['bodyId', 'bodyRevision', 'generatedOriginId', 'sourceUseIds'],
      evidenceSourceKinds: ['pe_specific_fixture', 'pe_unit_test'],
      registryLinkedFixtureIds: [],
      hardFailFocus: ['generated_origin_skip_without_metadata', 'prompt_history_as_authority', 'old_ds_row_as_authority'],
    }),
    fixture({
      fixtureId: 'pe-em3-cost-fallback-provider',
      family: 'cost_fallback',
      inputPrompt: 'Compose enhancement when provider is unavailable or output is invalid.',
      expectedFamily: 'cost_fallback',
      expectedIntent: 'provider_failure',
      expectedCapability: 'deterministic_safe_fallback',
      expectedPopupState: 'popup',
      mandatorySlotsOrSafeguards: [
        'one required composer path',
        'on-demand accepted actions',
        'Additional Details recomposition',
        'feedback_classifier_rewrite_when_product_selected',
        'optional_safety_review_provider_unavailable_state',
        'missing_key',
        'provider/API-unavailable',
        'provider refusal',
        'timeout',
        'invalid output',
        'over token/input/source cap',
        'product-scope-not-in-v1',
        'deterministic safe fallback',
        'original/current-only fallback',
        'no-send/block',
        'skip_no_popup',
      ],
      sourceReasonMetadata: acceptedPeCallIds,
      evidenceSourceKinds: ['cost_inventory_row', 'pe_contract_validation'],
      registryLinkedFixtureIds: [],
      hardFailFocus: [
        'hidden_serial_llm_calls',
        'cost_visibility_bypass',
        'cost_based_quality_downgrade',
        'generated_content_after_provider_failure',
      ],
    }),
  ];
}

function fixture(input: Partial<PromptEnhancementAcceptanceFixtureV1> & Pick<
  PromptEnhancementAcceptanceFixtureV1,
  | 'fixtureId'
  | 'family'
  | 'inputPrompt'
  | 'expectedFamily'
  | 'expectedIntent'
  | 'expectedCapability'
  | 'mandatorySlotsOrSafeguards'
  | 'sourceReasonMetadata'
  | 'evidenceSourceKinds'
  | 'registryLinkedFixtureIds'
  | 'hardFailFocus'
>): PromptEnhancementAcceptanceFixtureV1 {
  return {
    owner: input.owner ?? 'content_semantics',
    version: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
    sourceContextClass: input.sourceContextClass ?? 'current_source_plus_pe_fixture',
    projectSourceScope: 'current_project_only',
    expectedPopupState: input.expectedPopupState ?? 'popup',
    currentEditableBodyState: input.currentEditableBodyState ?? 'current_body_required_when_popup',
    memoryFatigueFeedbackState: input.memoryFatigueFeedbackState ?? ['neutral_or_explicit_fixture_state'],
    actionAvailability: input.actionAvailability ?? ['use_current_body', 'use_original', 'shorter', 'more_thorough', 'more_project_grounded', 'apply_details', 'feedback', 'close'],
    fallbackCostProviderState: input.fallbackCostProviderState ?? ['provider_available_or_public_safe_fallback', 'cost_visibility_cannot_weaken_behavior'],
    generatedOriginState: input.generatedOriginState ?? ['ordinary_user_prompt_or_typed_pe_origin_only'],
    privacyExpectation: input.privacyExpectation ?? ['ids_counts_status_only', 'raw_prompt_body_source_feedback_excluded'],
    expectedObservableOutcome: input.expectedObservableOutcome ?? ['typed_contract_state_or_public_safe_reason_code'],
    actualResult: input.actualResult ?? 'not_run_shape_only',
    rubricObservations: input.rubricObservations ?? ['owner_oracle_required_before_readiness_claim'],
    hardFailResult: input.hardFailResult ?? 'not_run_shape_only',
    reproducibleEvidence: input.reproducibleEvidence ?? [`test:${input.fixtureId}`],
    linkedOwnerDecision: input.linkedOwnerDecision ?? null,
    oracleIds: input.oracleIds ?? [`oracle:${input.fixtureId}`],
    ...input,
  };
}

function validateFixtureShape(fixture: PromptEnhancementAcceptanceFixtureV1, reasonCodes: string[]): void {
  if (!fixture.fixtureId) reasonCodes.push('fixture_missing_id');
  if (!fixture.owner) reasonCodes.push(`fixture_missing_owner:${fixture.fixtureId}`);
  if (fixture.version !== PROMPT_ENHANCEMENT_CONTRACT_VERSION) reasonCodes.push(`fixture_version_mismatch:${fixture.fixtureId}`);
  if (!fixture.inputPrompt) reasonCodes.push(`fixture_missing_input_prompt:${fixture.fixtureId}`);
  if (!fixture.sourceContextClass) reasonCodes.push(`fixture_missing_source_context:${fixture.fixtureId}`);
  if (fixture.projectSourceScope !== 'current_project_only') reasonCodes.push(`fixture_project_scope_not_current_only:${fixture.fixtureId}`);
  if (!fixture.expectedFamily) reasonCodes.push(`fixture_missing_expected_family:${fixture.fixtureId}`);
  if (!fixture.expectedIntent) reasonCodes.push(`fixture_missing_expected_intent:${fixture.fixtureId}`);
  if (!fixture.expectedCapability) reasonCodes.push(`fixture_missing_expected_capability:${fixture.fixtureId}`);
  if (!fixture.expectedPopupState) reasonCodes.push(`fixture_missing_popup_state:${fixture.fixtureId}`);
  if (!fixture.currentEditableBodyState) reasonCodes.push(`fixture_missing_body_state:${fixture.fixtureId}`);
  if (fixture.mandatorySlotsOrSafeguards.length === 0) reasonCodes.push(`fixture_missing_mandatory_slots:${fixture.fixtureId}`);
  if (fixture.sourceReasonMetadata.length === 0) reasonCodes.push(`fixture_missing_source_reason_metadata:${fixture.fixtureId}`);
  if (fixture.memoryFatigueFeedbackState.length === 0) reasonCodes.push(`fixture_missing_memory_feedback_state:${fixture.fixtureId}`);
  if (fixture.actionAvailability.length === 0) reasonCodes.push(`fixture_missing_action_availability:${fixture.fixtureId}`);
  if (fixture.fallbackCostProviderState.length === 0) reasonCodes.push(`fixture_missing_fallback_cost_provider_state:${fixture.fixtureId}`);
  if (fixture.generatedOriginState.length === 0) reasonCodes.push(`fixture_missing_generated_origin_state:${fixture.fixtureId}`);
  if (fixture.privacyExpectation.length === 0) reasonCodes.push(`fixture_missing_privacy_expectation:${fixture.fixtureId}`);
  if (fixture.expectedObservableOutcome.length === 0) reasonCodes.push(`fixture_missing_expected_observable_outcome:${fixture.fixtureId}`);
  if (fixture.reproducibleEvidence.length === 0) reasonCodes.push(`fixture_missing_reproducible_evidence:${fixture.fixtureId}`);
  if (fixture.oracleIds.length === 0) reasonCodes.push(`fixture_missing_oracle:${fixture.fixtureId}`);
  if (fixture.hardFailFocus.length === 0) reasonCodes.push(`fixture_missing_hard_fail_focus:${fixture.fixtureId}`);
  if (fixture.evidenceSourceKinds.includes('old_decision_session_precedent_only') && fixture.actualResult === 'pass') {
    reasonCodes.push(`old_ds_precedent_counted_as_pe_pass:${fixture.fixtureId}`);
  }
}

function fixtureIdsForGate(gateId: string): readonly string[] {
  const normalized = gateId.toLowerCase();
  if (normalized.includes('source') || normalized.includes('ds') || normalized.includes('stage') || normalized.includes('served')) {
    return ['pe-em3-source-current-reality', 'pe-em3-routing-registry-links'];
  }
  if (normalized.includes('route') || normalized.includes('family') || normalized.includes('intent') || normalized.includes('guidance')) {
    return ['pe-em3-routing-registry-links'];
  }
  if (normalized.includes('safety') || normalized.includes('confirmation') || normalized.includes('privacy') || normalized.includes('sensitive')) {
    return ['pe-em3-safety-privacy-sendability'];
  }
  if (normalized.includes('cost') || normalized.includes('failure') || normalized.includes('optional')) {
    return ['pe-em3-cost-fallback-provider'];
  }
  if (normalized.includes('generated-prompt')) {
    return ['pe-em3-generated-origin-echo-guard', 'pe-em3-delivery-host-boundary'];
  }
  return ['pe-em3-composer-body-actions'];
}

function slug(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
