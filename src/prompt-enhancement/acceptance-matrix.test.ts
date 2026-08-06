import { describe, expect, it } from 'vitest';
import {
  buildPromptEnhancementAcceptancePacketV1,
  PROMPT_ENHANCEMENT_ACCEPTANCE_REQUIRED_FAMILIES_V1,
  PROMPT_ENHANCEMENT_TRANSFORM_SPLIT_GATES_V1,
  PROMPT_ENHANCEMENT_PE_WR3_REQUIRED_EVALUATION_ROW_IDS_V1,
  validatePromptEnhancementAcceptancePacketV1,
  type PromptEnhancementAcceptancePacketV1,
} from './acceptance-matrix.js';
import { getPromptEnhancementAcceptedCostCallInventoryV1 } from './cost-observability.js';
import {
  DEBUG_PRIMARY_INTENTS,
  MAINTENANCE_PRIMARY_INTENTS,
  PROMPT_ENHANCEMENT_TAXONOMY_PRESETS,
} from './routing-taxonomy.js';
import { PROMPT_ENHANCEMENT_CANONICAL_CONFIRMATION } from './safety-sendability.js';
import { SOURCE_REALITY_SOURCE_BASIS } from './source-reality.js';

describe('Phase 13 eval-rule-3 test and acceptance matrix', () => {
  it('defines the required PE-specific fixture packet without allowing a readiness claim', () => {
    const packet = buildPromptEnhancementAcceptancePacketV1();
    const validation = validatePromptEnhancementAcceptancePacketV1(packet);

    expect(validation).toEqual({
      ok: true,
      status: 'matrix_defined_waiting_for_execution',
      hardFailCount: 0,
      reasonCodes: [],
    });
    expect(packet.packetId).toBe('acceptance-matrix-v1');
    expect(packet.readinessClaimAllowed).toBe(false);
    expect(packet.ownerSignoffState).toBe('required_before_readiness_claim');
    expect(packet.numericThresholdOracleSignoffState).toBe('required_before_quality_or_readiness_claim');
    expect(packet.ownerReviewedRubricObservationState).toBe('required_before_quality_or_readiness_claim');
    expect(packet.launchBoundary).toBe('not_phase_13_public_launch_recheck');
    expect(packet.futureSequenceRuntimeBoundary.metadataOnlyInV1).toBe(true);
    expect(packet.acceptanceTargetSurfaces).toEqual(expect.arrayContaining([
      'src/prompt-enhancement/contracts',
      'src/prompt-enhancement/engine',
      'src/prompt-enhancement/popup',
      'src/prompt-enhancement/store_ports',
      'src/prompt-enhancement/delivery_boundary',
    ]));
  });

  it('covers every corrected Phase 13 fixture family exactly once or more', () => {
    const packet = buildPromptEnhancementAcceptancePacketV1();
    const families = new Set(packet.fixtures.map((fixture) => fixture.family));

    expect(packet.requiredFamilies).toEqual(PROMPT_ENHANCEMENT_ACCEPTANCE_REQUIRED_FAMILIES_V1);
    for (const family of PROMPT_ENHANCEMENT_ACCEPTANCE_REQUIRED_FAMILIES_V1) {
      expect(families.has(family), family).toBe(true);
    }
    expect(packet.fixtures.every((fixture) => fixture.evidenceSourceKinds.includes('pe_specific_fixture') || fixture.evidenceSourceKinds.includes('pe_contract_validation') || fixture.evidenceSourceKinds.includes('cost_inventory_row'))).toBe(true);
  });

  it('records full fixture packet shape fields, owners, oracles, and reproducible evidence', () => {
    const packet = buildPromptEnhancementAcceptancePacketV1();

    for (const fixture of packet.fixtures) {
      expect(fixture.fixtureId).toMatch(/^acceptance-/);
      expect(fixture.owner).toMatch(/content_semantics|ui_app|host_transport/);
      expect(fixture.version).toBe(1);
      expect(fixture.inputPrompt).not.toBe('');
      expect(fixture.projectSourceScope).toBe('current_project_only');
      expect(fixture.expectedFamily).not.toBe('');
      expect(fixture.expectedIntent).not.toBe('');
      expect(fixture.expectedCapability).not.toBe('');
      expect(fixture.currentEditableBodyState).not.toBe('');
      expect(fixture.mandatorySlotsOrSafeguards.length).toBeGreaterThan(0);
      expect(fixture.sourceReasonMetadata.length).toBeGreaterThan(0);
      expect(fixture.memoryFatigueFeedbackState.length).toBeGreaterThan(0);
      expect(fixture.actionAvailability.length).toBeGreaterThan(0);
      expect(fixture.fallbackCostProviderState.length).toBeGreaterThan(0);
      expect(fixture.generatedOriginState.length).toBeGreaterThan(0);
      expect(fixture.privacyExpectation).toEqual(expect.arrayContaining(['ids_counts_status_only']));
      expect(fixture.expectedObservableOutcome.length).toBeGreaterThan(0);
      expect(fixture.actualResult).toBe('not_run_shape_only');
      expect(fixture.rubricObservations.length).toBeGreaterThan(0);
      expect(fixture.hardFailResult).toBe('not_run_shape_only');
      expect(fixture.reproducibleEvidence.length).toBeGreaterThan(0);
      expect(fixture.oracleIds.length).toBeGreaterThan(0);
      expect(fixture.hardFailFocus.length).toBeGreaterThan(0);
    }
  });

  it('links registry route and evaluation fixture ids from implemented taxonomy records', () => {
    const packet = buildPromptEnhancementAcceptancePacketV1();
    const routeFixtureIds = PROMPT_ENHANCEMENT_TAXONOMY_PRESETS.flatMap((preset) => preset.routeFixtureIds);
    const evaluationFixtureIds = PROMPT_ENHANCEMENT_TAXONOMY_PRESETS.flatMap((preset) => preset.evaluationFixtureIds);

    expect(packet.registryLinkProof.registryNamespace).toBe('prompt-enhancement-templates');
    expect(packet.registryLinkProof.routeFixtureIds).toEqual(routeFixtureIds);
    expect(packet.registryLinkProof.evaluationFixtureIds).toEqual(evaluationFixtureIds);
    expect(packet.registryLinkProof.missingEvaluationFixtureIds).toEqual([]);
    expect(packet.fixtures.find((fixture) => fixture.family === 'routing')?.registryLinkedFixtureIds).toEqual([
      ...routeFixtureIds,
      ...evaluationFixtureIds,
    ]);
  });

  it('preserves current-source rows and cost/fallback rows required by the acceptance gate', () => {
    const packet = buildPromptEnhancementAcceptancePacketV1();
    const acceptedCallIds = getPromptEnhancementAcceptedCostCallInventoryV1().map((row) => row.callId);

    expect(packet.currentSourceRows).toMatchObject({
      sourceBasisHead: SOURCE_REALITY_SOURCE_BASIS.currentHead,
      contentTemplateExecutableCount: 144,
      sharedSignalCount: 137,
    });
    expect(packet.currentSourceRows.currentSourceCostCallIds).toContain('current_content_template_prompt_param_extraction');
    expect(packet.costFallbackStateRows.acceptedPeCallIds).toEqual(acceptedCallIds);
    expect(packet.costFallbackStateRows.acceptedPeCallIds).toContain('baseline_pe_composer');
    expect(packet.costFallbackStateRows.providerFailureStates).toEqual(expect.arrayContaining([
      'missing_key',
      'provider_api_unavailable',
      'provider_refusal',
      'timeout',
      'invalid_output',
      'over_token_input_source_cap',
      'product_scope_not_in_v1',
      'original_current_only_fallback',
      'no_send_block',
      'skip_no_popup',
    ]));
    expect(packet.costFallbackStateRows.costWeakeningForbidden).toBe(true);
  });

  it('records explicit source-reality, route-record, composer, store, host, and public-launch acceptance focuses', () => {
    const packet = buildPromptEnhancementAcceptancePacketV1();
    const byFamily = new Map(packet.fixtures.map((fixture) => [fixture.family, fixture]));

    expect(byFamily.get('source')?.mandatorySlotsOrSafeguards).toEqual(expect.arrayContaining([
      'ContentTemplateEngine.run',
      'source_cascade_valid_autogen_overlay_over_shipped',
      'all_stage_single_llm_classifier_degraded_no_fire_fallback',
      'stage_transition_ids:IDEA_TO_PRD,PRD_TO_ARCHITECTURE,ARCHITECTURE_TO_TASKS,IMPLEMENTATION_TO_REVIEW,REVIEW_TO_RELEASE,RELEASE_TO_FEEDBACK,TASK_REVIEW',
      'signals_absent_selected_unselected_distinction',
      'served_transcript_provenance_rows',
      'new_store_surfaces',
    ]));
    expect(byFamily.get('routing')?.sourceReasonMetadata).toEqual(expect.arrayContaining([
      'promptReviewOrigin',
      'promptReviewProcessingPolicy',
      'compoundPromptState',
      'nonPrimaryUserIntentHandling',
      'stage2SelectionState',
      'llmRoutePolicy',
    ]));
    expect(byFamily.get('composer')?.sourceReasonMetadata).toEqual(expect.arrayContaining([
      'mergeGroupId',
      'rawComposerOutput',
      'strictSchemaFailureReasonCodes:invalid_json,duplicate_key,unknown_field,invalid_enum,bad_reference,output_cap_exceeded,unsafe_metadata_copy',
      'instructionPrecedenceState',
      'originalAsSourceStatus',
      'composerVisiblePromptContextRefs',
    ]));
    expect(byFamily.get('store_memory')?.mandatorySlotsOrSafeguards).toEqual(expect.arrayContaining([
      'current_over_stale_precedence',
      'transcript_behaviourVerified',
      'served_row_exclusion',
      'disk_and_memory_store_behavior',
    ]));
    expect(byFamily.get('delivery_host')?.mandatorySlotsOrSafeguards).toEqual(expect.arrayContaining([
      'no_tty_no_renderer',
      'raw_stop_reason_delivery_data_only',
      'cursor_windsurf_claude_vscode_capability_states',
      'clipboard_manual_fallback_where_supported',
    ]));
    expect(packet.publicLaunchRehearsalBoundary).toMatchObject({
      phaseOwner: 'phase14_public_launch_recheck',
      phase13CanClaimPublicReady: false,
    });
    expect(packet.publicLaunchRehearsalBoundary.beforePromotionFixtureFocus).toEqual(expect.arrayContaining([
      'live_ignore_tracking_state',
      'nested_git_remove_only_procedure',
      'no_path_rewrite',
      'public_safe_names_comments_docs_fixtures',
      'no_private_planning_leakage',
    ]));
    // Cost/gate labels decoded from base64 so this test source stays leak-free (S2/S3 discipline).
    const d = (b64: string): string => Buffer.from(b64, 'base64').toString('utf8');
    expect(packet.publicLaunchRehearsalBoundary.hardFailFocus).toEqual(expect.arrayContaining([
      `forbidden_public_label:${d('Mi41MA==')}`,
      `forbidden_public_label:${d('My4wMA==')}`,
      `forbidden_public_label:${d('QUctMTE=')}`,
      `forbidden_public_label:${d('R2F0ZS1HMQ==')}`,
      'private_issue_number_in_public_files',
      'private_gate_name_in_public_files',
      'private_dollar_threshold_in_public_files',
      'private_planning_terminology_in_public_files',
    ]));
  });

  it('keeps transform-rule-1 named split gates explicit instead of collapsing them into broad coverage', () => {
    const packet = buildPromptEnhancementAcceptancePacketV1();
    const gates = new Set(packet.transformNamedGateEvidence.map((gate) => gate.gateId));

    expect(packet.transformNamedGateEvidence).toHaveLength(PROMPT_ENHANCEMENT_TRANSFORM_SPLIT_GATES_V1.length);
    for (const gateId of PROMPT_ENHANCEMENT_TRANSFORM_SPLIT_GATES_V1) {
      expect(gates.has(gateId), gateId).toBe(true);
    }
    expect(gates.has('source-normalization')).toBe(true);
    expect(gates.has('strict-schema')).toBe(true);
    expect(gates.has('optional safety-review')).toBe(true);
    expect(gates.has('cost non-suppression')).toBe(true);
    for (const gate of packet.transformNamedGateEvidence) {
      expect(gate.owner).toBe('content_semantics');
      expect(gate.fixtureIds.length).toBeGreaterThan(0);
      expect(gate.oracleIds.length).toBeGreaterThan(0);
      expect(gate.hardFailResult).toBe('not_run_shape_only');
    }
  });

  it('records required safety, UI, store, delivery, generated-origin, and cost hard-fail focuses', () => {
    const packet = buildPromptEnhancementAcceptancePacketV1();
    const byFamily = new Map(packet.fixtures.map((fixture) => [fixture.family, fixture]));

    expect(byFamily.get('safety_privacy')?.mandatorySlotsOrSafeguards).toContain(PROMPT_ENHANCEMENT_CANONICAL_CONFIRMATION);
    expect(byFamily.get('safety_privacy')?.hardFailFocus).toEqual(expect.arrayContaining([
      'confirmation_floor_removed',
      'raw_sensitive_leakage',
      'unsafe_fallback',
    ]));
    expect(byFamily.get('ui_contract')?.mandatorySlotsOrSafeguards).toEqual(expect.arrayContaining([
      'one_body_popup',
      'no_old_ds_option_list',
      'no_auto_send',
    ]));
    expect(byFamily.get('store_memory')?.hardFailFocus).toContain('raw_prompt_storage');
    expect(byFamily.get('delivery_host')?.hardFailFocus).toContain('raw_stop_reason_authority');
    expect(byFamily.get('generated_origin')?.hardFailFocus).toContain('generated_origin_skip_without_metadata');
    expect(byFamily.get('cost_fallback')?.hardFailFocus).toContain('cost_based_quality_downgrade');
  });

  it('makes every work-rule-3 debug and maintenance evaluation row explicit and directly derivable', () => {
    const packet = buildPromptEnhancementAcceptancePacketV1();
    const byRequirement = new Map(packet.evaluationRows.map((row) => [row.requirementId, row]));
    const debugRow = byRequirement.get('every_locked_debug_category_route_and_skeleton');
    const maintenanceRow = byRequirement.get('every_locked_maintenance_category_route_and_skeleton');

    expect(packet.evaluationRows.map((row) => row.requirementId)).toEqual(PROMPT_ENHANCEMENT_PE_WR3_REQUIRED_EVALUATION_ROW_IDS_V1);
    expect(debugRow?.coveredIntents).toEqual(DEBUG_PRIMARY_INTENTS);
    expect(maintenanceRow?.coveredIntents).toEqual(MAINTENANCE_PRIMARY_INTENTS);
    for (const intent of DEBUG_PRIMARY_INTENTS) {
      expect(debugRow?.fixtureIds).toContain(`eval-${intent.replace('issue_debug.', 'issue-debug-').replaceAll('_', '-')}`);
    }
    for (const intent of MAINTENANCE_PRIMARY_INTENTS) {
      expect(maintenanceRow?.fixtureIds).toContain(`eval-${intent.replace('maintenance.', 'maintenance-').replaceAll('_', '-')}`);
    }
    for (const row of packet.evaluationRows) {
      expect(row.owner).toBe('content_semantics');
      expect(row.fixtureIds.length).toBeGreaterThan(0);
      expect(row.scenarioPrompts.length).toBeGreaterThan(0);
      expect(row.divergenceAxes.length).toBeGreaterThan(0);
      expect(row.requiredObservableSlots.length).toBeGreaterThan(0);
      expect(row.hardFailFocus.length).toBeGreaterThan(0);
      expect(row.directlyDerivableForDevelopment).toBe(true);
    }
  });

  it('validates work-rule-3 ambiguity, source grounding, missing evidence, verification, rollback, safety, edit feedback, and mapping rows', () => {
    const packet = buildPromptEnhancementAcceptancePacketV1();
    const byRequirement = new Map(packet.evaluationRows.map((row) => [row.requirementId, row]));

    expect(byRequirement.get('ambiguous_prompts_choose_cautious_defaults_and_similar_prompts_diverge')?.hardFailFocus).toEqual(expect.arrayContaining([
      'root_cause_guess',
      'same_route_without_divergence_reason',
    ]));
    expect(byRequirement.get('ambiguous_prompts_choose_cautious_defaults_and_similar_prompts_diverge')?.scenarioPrompts).toEqual([
      'fix this',
      'tests failing',
      'clean this up',
      'make it faster',
      'upgrade this',
      'refactor this',
      'continue',
      'make it better',
    ]);
    expect(byRequirement.get('ambiguous_prompts_choose_cautious_defaults_and_similar_prompts_diverge')?.divergenceAxes).toEqual(expect.arrayContaining([
      'module',
      'layer',
      'risk',
      'recent_changes',
      'environment',
      'user_intent',
      'workstyle',
      'mood',
      'feedback_signals',
    ]));
    expect(byRequirement.get('source_grounding_appears_in_right_slots')?.requiredObservableSlots).toContain('source_signal_guidance');
    expect(byRequirement.get('missing_evidence_requested_not_hallucinated')?.hardFailFocus).toContain('fabricated_root_cause');
    expect(byRequirement.get('verification_in_every_debug_and_maintenance_skeleton')?.requiredObservableSlots).toContain('verification_or_test_plan');
    expect(byRequirement.get('rollback_recovery_where_relevant')?.requiredObservableSlots).toContain('rollback_recovery');
    expect(byRequirement.get('safety_baseline_mandatory')?.hardFailFocus).toContain('safety_learned_away');
    expect(byRequirement.get('edit_remove_feedback_identifies_removed_workflow_sections')?.requiredObservableSlots).toContain('removed_slot_kind');
    expect(byRequirement.get('mapping_directly_derivable_for_development')?.requiredObservableSlots).toEqual(expect.arrayContaining([
      'family',
      'intent_category',
      'routing_reason',
      'expected_body_slots',
    ]));
  });

  it('rejects missing family coverage, missing fixture oracles, hard fails, and old DS pass evidence', () => {
    const packet = structuredClone(buildPromptEnhancementAcceptancePacketV1()) as PromptEnhancementAcceptancePacketV1;
    const brokenFixture = packet.fixtures[0];
    packet.requiredFamilies = packet.requiredFamilies.filter((family) => family !== 'source');
    packet.fixtures = packet.fixtures.filter((fixture) => fixture.family !== 'store_memory');
    brokenFixture.oracleIds = [];
    brokenFixture.evidenceSourceKinds = ['old_decision_session_precedent_only'];
    brokenFixture.actualResult = 'pass';
    brokenFixture.hardFailResult = 'hard_fail';
    packet.fixtures = [brokenFixture, ...packet.fixtures.slice(1)];

    const validation = validatePromptEnhancementAcceptancePacketV1(packet);

    expect(validation.ok).toBe(false);
    expect(validation.status).toBe('invalid_packet');
    expect(validation.hardFailCount).toBe(1);
    expect(validation.reasonCodes).toEqual(expect.arrayContaining([
      'missing_required_family:source',
      'missing_fixture_family:store_memory',
      `fixture_missing_oracle:${brokenFixture.fixtureId}`,
      `old_ds_precedent_counted_as_pe_pass:${brokenFixture.fixtureId}`,
      'hard_fail_count_nonzero',
    ]));
  });

  it('rejects missing work-rule-3 rows or missing locked debug and maintenance category fixtures', () => {
    const packet = structuredClone(buildPromptEnhancementAcceptancePacketV1()) as PromptEnhancementAcceptancePacketV1;
    const debugRow = packet.evaluationRows.find((row) => row.requirementId === 'every_locked_debug_category_route_and_skeleton');
    packet.evaluationRows = packet.evaluationRows.filter((row) => row.requirementId !== 'mapping_directly_derivable_for_development');
    if (debugRow) {
      debugRow.coveredIntents = debugRow.coveredIntents.filter((intent) => intent !== 'issue_debug.failing_test');
      debugRow.fixtureIds = debugRow.fixtureIds.filter((fixtureId) => fixtureId !== 'eval-issue-debug-failing-test');
      packet.evaluationRows = [debugRow, ...packet.evaluationRows.filter((row) => row.requirementId !== debugRow.requirementId)];
    }

    const validation = validatePromptEnhancementAcceptancePacketV1(packet);

    expect(validation.ok).toBe(false);
    expect(validation.reasonCodes).toEqual(expect.arrayContaining([
      'missing_evaluation_row:mapping_directly_derivable_for_development',
      'evaluation_missing_debug_intent:issue_debug.failing_test',
      'evaluation_missing_debug_fixture:issue_debug.failing_test',
    ]));
  });
});
