import {
  PROMPT_ENHANCEMENT_CONTRACT_VERSION,
  type PromptEnhancementCompactFirstPopupSequenceSummaryV1,
  type PromptEnhancementCurrentBodyV1,
  type PromptEnhancementFallbackMode,
  type PromptEnhancementHandoffApplicabilityV1,
  type PromptEnhancementHandoffConfirmationTargetV1,
  type PromptEnhancementHandoffDecompositionGroupV1,
  type PromptEnhancementHandoffMetadataV1,
  type PromptEnhancementHandoffPointInventoryV1,
  type PromptEnhancementHandoffPrivacyStoragePolicyV1,
  type PromptEnhancementHandoffRuntimeGuardsV1,
  type PromptEnhancementHandoffSourceImpactMetadataV1,
  type PromptEnhancementHandoffTaskSliceV1,
  type PromptEnhancementSafetySummaryV1,
  type PromptEnhancementValidationStage,
} from './contracts.js';

export interface PromptEnhancementHandoffMetadataInputV1 {
  handoffDecisionId: string;
  requestId: string;
  projectRoot: string;
  currentBody: PromptEnhancementCurrentBodyV1;
  safetySummary: PromptEnhancementSafetySummaryV1;
  levelDepthState?: PromptEnhancementHandoffApplicabilityV1['levelDepthState'];
  hostCapabilityState?: PromptEnhancementHandoffApplicabilityV1['hostCapabilityState'];
  sourceScopeRefs?: readonly string[];
  handoffKind?: PromptEnhancementHandoffMetadataV1['handoffKind'];
  fallbackMode?: PromptEnhancementFallbackMode;
  sourceLineageRefs?: readonly string[];
  pointInventory?: readonly PromptEnhancementHandoffPointInventoryV1[];
  decompositionGroups?: readonly PromptEnhancementHandoffDecompositionGroupV1[];
  taskSlices?: readonly PromptEnhancementHandoffTaskSliceV1[];
  confirmationTargets?: readonly PromptEnhancementHandoffConfirmationTargetV1[];
  sourceImpact?: Partial<PromptEnhancementHandoffSourceImpactMetadataV1>;
  summary?: {
    summaryId: string;
    publicSafeText: string;
    remainingTaskCount: number;
    taskRoleLabels: readonly string[];
    sourceRefs?: readonly string[];
  };
  reasonCodes?: readonly string[];
}

export interface PromptEnhancementHandoffMetadataValidation {
  ok: boolean;
  reasonCodes: readonly string[];
}

const REQUIRED_RECEIVER_VALIDATION: readonly PromptEnhancementValidationStage[] = ['handoff', 'launch_check'];

const RUNTIME_GUARDS: PromptEnhancementHandoffRuntimeGuardsV1 = {
  createsRuntimeQueue: false,
  permitsContinuation: false,
  activeRuntimeState: 'not_created_v1',
  autoSendPolicy: 'prohibited',
  futurePromptBodiesRuntimePolicy: 'not_generated_not_stored_not_rendered',
  pointerAdvancementPolicy: 'prohibited',
  completionProofPolicy: 'not_claimed',
  responseWatcherPolicy: 'not_created_v1',
  durableResumePolicy: 'not_created_v1',
};

const PRIVACY_STORAGE_POLICY: PromptEnhancementHandoffPrivacyStoragePolicyV1 = {
  rawPromptBodiesExcluded: true,
  rawGeneratedBodiesExcluded: true,
  rawSourceExcerptsExcluded: true,
  rawFeedbackExcluded: true,
  futurePromptBodiesStored: false,
  oldDecisionSessionStoresAreAuthority: false,
  productFeedbackIsPeHandoffSignal: false,
  telemetryPolicy: 'ids_counts_status_only',
};

const NON_RUNTIME_REASON_CODES = [
  'v1_handoff_metadata_only',
  'v1_no_active_sequence_runtime',
  'future_prompt_bodies_not_generated',
] as const;

export function buildPromptEnhancementHandoffMetadataV1(
  input: PromptEnhancementHandoffMetadataInputV1,
): PromptEnhancementHandoffMetadataV1 {
  const handoffKind = input.handoffKind ?? 'metadata_only';
  const sourceLineageRefs = uniqueNonEmpty([
    ...(input.sourceLineageRefs ?? []),
    ...input.currentBody.sourceAttribution.map((source) => source.sourceRefId),
    ...input.currentBody.sections.flatMap((section) => section.sourceFactIds),
  ]);
  const pointInventory = input.pointInventory ?? buildPointInventory(sourceLineageRefs);
  const decompositionGroups = input.decompositionGroups ?? buildDecompositionGroups(input.currentBody, pointInventory);
  const taskSlices = input.taskSlices ?? buildTaskSlices(input.currentBody, pointInventory, decompositionGroups, handoffKind);
  const applicabilityState = handoffKind === 'none'
    ? 'not_applicable'
    : handoffKind === 'blocked_or_deferred_sequence'
      ? 'blocked_pending_runtime'
      : 'metadata_only_candidate';
  const applicability: PromptEnhancementHandoffApplicabilityV1 = {
    applicabilityDecisionId: `${input.handoffDecisionId}:applicability`,
    taskSliceRefs: taskSlices.map((slice) => slice.taskSliceId),
    decompositionGroupRefs: decompositionGroups.map((group) => group.decompositionGroupId),
    sourcePointRefs: pointInventory.map((point) => point.pointRefId),
    state: applicabilityState,
    intentFamily: input.currentBody.sections[0]?.familyId ?? 'unknown',
    intentCategory: input.currentBody.sections[0]?.primaryIntent ?? 'unknown',
    levelDepthState: input.levelDepthState ?? 'default',
    riskSafetyState: input.safetySummary.validationStatus,
    dependencyOrderState: taskSlices.some((slice) => slice.dependencySliceRefs.length > 0)
      ? 'source_backed_dependencies'
      : 'no_dependencies',
    currentBodyCoverageState: taskSlices.length > 0 ? 'current_body_plus_metadata' : 'covered_in_current_body',
    promptSizeApiAvailabilityState: 'not_measured_v1_metadata_only',
    hostCapabilityState: input.hostCapabilityState ?? 'stop_bridge_only',
    explicitUserRuntimeState: 'not_started_v1',
    granularityActionabilityState: applicabilityState === 'not_applicable'
      ? 'manual_planning_only'
      : 'metadata_only_candidate',
    splitMergeDisposition: handoffKind === 'none' ? 'single_current_body' : 'metadata_only_split_candidate',
    granularityFailureDisposition: 'current_or_original_fallback_no_runtime',
    sourcePriorityRefs: [],
    sourcePriorityState: 'no_priority_claim_v1',
    targetScopeRefs: input.sourceScopeRefs ?? ['project:current'],
    targetSurfaceState: 'unknown_no_runtime',
    workspaceBindingState: 'current_workspace_only',
    scopeBindingDisposition: 'bound_to_current_project',
    expectedDeliverableState: handoffKind === 'none' ? 'current_body_guidance_only' : 'metadata_only_candidate',
    deliverableContractRefs: [],
    outputFormatPolicy: handoffKind === 'none' ? 'current_body_guidance_only' : 'metadata_only_no_runtime',
    completionEvidenceRequirementState: 'not_runtime_proof_v1',
    acceptanceCriteriaRefs: [],
    successConditionState: 'not_runtime_evaluated_v1',
    definitionOfDoneState: 'not_runtime_evaluated_v1',
    acceptanceVerificationPolicy: 'user_owned_not_runtime_v1',
    acceptanceFailureDisposition: 'current_or_original_fallback_no_runtime',
    atomicGroupId: 'none',
    atomicGroupRefs: [],
    coDeliveryRequirementState: 'none',
    partialCompletionPolicy: 'no_runtime_partial_completion_v1',
    rollbackCouplingState: 'not_runtime_v1',
    atomicGroupFailureDisposition: 'current_or_original_fallback_no_runtime',
    sourceConflictState: 'none',
    conflictingSourcePointRefs: [],
    conflictResolutionPolicy: 'current_body_or_no_runtime',
    unresolvedConflictDisposition: 'current_or_original_fallback_no_runtime',
    conflictVisibilityPolicy: 'public_safe_reason_codes_only',
    userNoSequenceConstraintState: 'none',
    onePromptOnlyConstraintState: 'none',
    sequenceSuppressionSourceState: 'none',
    noSplitOverrideDisposition: 'not_allowed_v1',
    partialItemConsentState: 'deferred_out_of_v1',
    clarificationApplicabilityState: 'not_required',
    userInputRequirementState: 'not_required',
    missingInformationRefs: [],
    clarificationQuestionKindState: 'none',
    answerDependencyState: 'none',
    agentPermissionModeSnapshot: 'unknown',
    itemExecutionCapabilityRequirementState: 'not_evaluated_v1_metadata_only',
    toolAccessRequirementRefs: [],
    capabilityMismatchDisposition: 'current_or_original_fallback_no_runtime',
    manualExecutionRequiredState: 'not_evaluated_v1_metadata_only',
    conditionalInstructionState: 'represented_in_current_body',
    itemOrderingMode: 'no_runtime_order',
    independentItemState: 'not_parallelized_v1',
    unorderedGroupId: 'none',
    serializationDisposition: 'metadata_only_no_runtime_order',
    userOrderPreferenceState: 'not_specified',
    parallelExecutionPolicy: 'not_supported_v1',
    confidence: pointInventory.length > 0 ? 'medium' : 'none',
    receiverCanActivateRuntime: false,
    reasonCodes: applicabilityState === 'not_applicable'
      ? ['not_sequence']
      : ['metadata_only_no_runtime_activation'],
  };
  return {
    handoffMetadataVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
    handoffDecisionId: input.handoffDecisionId,
    currentBodyId: input.currentBody.currentBodyId,
    bodyRevision: input.currentBody.bodyRevision,
    handoffKind,
    sequenceActivationPolicy: 'blocked_pending_sequence_runtime_and_cost_gates',
    futurePromptTextPolicy: 'not_generated_not_stored_not_rendered',
    suggestedNextPromptPolicy: handoffKind === 'none' ? 'not_applicable' : 'metadata_refs_only',
    suggestedNextPromptRefs: [],
    currentBodyValidityState: 'valid_for_current_body_revision',
    itemLineageRefs: taskSlices.map((slice) => slice.taskSliceId),
    sourceLineageRefs,
    scope: {
      requestId: input.requestId,
      projectRoot: input.projectRoot,
      projectScopeState: 'current_project_only',
      sourceScopeRefs: input.sourceScopeRefs ?? ['project:current'],
      crossProjectApplicationPolicy: 'reject',
      staleResponsePolicy: 'ignore_no_overwrite',
    },
    applicabilityState,
    riskConfirmationState: input.safetySummary.sensitiveActionState,
    fallbackMode: input.fallbackMode ?? 'none',
    receiverValidationRequirements: REQUIRED_RECEIVER_VALIDATION,
    activationState: 'no_activation_v1',
    userHandoffConsentState: handoffKind === 'none' ? 'not_applicable' : 'not_accepted',
    compactFirstPopupSequenceSummary: buildCompactSummary(input, handoffKind, sourceLineageRefs),
    pointInventory,
    decompositionGroups,
    taskSlices,
    applicability,
    confirmationTargets: input.confirmationTargets ?? buildConfirmationTargets(input.safetySummary, pointInventory),
    sourceImpact: buildSourceImpact(input.handoffDecisionId, input.sourceImpact),
    runtimeGuards: { ...RUNTIME_GUARDS },
    privacyStoragePolicy: { ...PRIVACY_STORAGE_POLICY },
    ownerBoundary: {
      semanticOwner: 'content_semantics',
      uiConsumer: 'ui_app',
      hostOwner: 'host_transport',
      runtimeOwnerState: 'future_future_sequence_only_after_gates',
    },
    reasonCodes: uniqueNonEmpty([...(input.reasonCodes ?? []), ...NON_RUNTIME_REASON_CODES]),
  };
}

export function validatePromptEnhancementHandoffMetadataV1(
  metadata: PromptEnhancementHandoffMetadataV1,
  currentBody: Pick<PromptEnhancementCurrentBodyV1, 'currentBodyId' | 'bodyRevision'>,
  safetySummary: Pick<PromptEnhancementSafetySummaryV1, 'sensitiveActionState'>,
  scope?: Pick<PromptEnhancementHandoffMetadataV1['scope'], 'requestId' | 'projectRoot'>,
): PromptEnhancementHandoffMetadataValidation {
  const reasonCodes: string[] = [];
  if (metadata.handoffMetadataVersion !== PROMPT_ENHANCEMENT_CONTRACT_VERSION) reasonCodes.push('unsupported_schema_version');
  if (metadata.currentBodyId !== currentBody.currentBodyId) reasonCodes.push('current_body_id_mismatch');
  if (metadata.bodyRevision !== currentBody.bodyRevision) reasonCodes.push('body_revision_mismatch');
  if (!hasScope(metadata.scope, scope)) reasonCodes.push('handoff_scope_unsafe');
  if (metadata.sequenceActivationPolicy !== 'blocked_pending_sequence_runtime_and_cost_gates') {
    reasonCodes.push('sequence_activation_policy_not_blocked');
  }
  if (metadata.futurePromptTextPolicy !== 'not_generated_not_stored_not_rendered') reasonCodes.push('future_prompt_text_policy_not_blocked');
  if (metadata.suggestedNextPromptRefs.length > 0) reasonCodes.push('future_prompt_refs_present');
  if (metadata.riskConfirmationState !== safetySummary.sensitiveActionState) reasonCodes.push('risk_confirmation_mismatch');
  for (const requiredStage of REQUIRED_RECEIVER_VALIDATION) {
    if (!metadata.receiverValidationRequirements.includes(requiredStage)) {
      reasonCodes.push(`missing_receiver_validation_${requiredStage}`);
    }
  }
  if (metadata.activationState !== 'no_activation_v1') reasonCodes.push('runtime_activation_not_rejected');
  if (metadata.userHandoffConsentState === 'explicitly_accepted_approved_runtime') reasonCodes.push('runtime_consent_not_v1_safe');
  if (metadata.handoffKind !== 'none' && metadata.pointInventory.length === 0) reasonCodes.push('missing_point_inventory');
  if (metadata.handoffKind !== 'none' && metadata.taskSlices.length === 0) reasonCodes.push('missing_task_slices');
  if (metadata.applicability.receiverCanActivateRuntime) reasonCodes.push('applicability_can_activate_runtime');
  if (!hasApplicability(metadata.applicability, metadata.applicabilityState)) reasonCodes.push('applicability_state_mismatch');
  if (!hasSourceImpact(metadata.sourceImpact)) reasonCodes.push('source_impact_incomplete');
  if (!hasRuntimeGuards(metadata.runtimeGuards)) reasonCodes.push('runtime_guards_unsafe');
  if (!hasPrivacyStoragePolicy(metadata.privacyStoragePolicy)) reasonCodes.push('privacy_storage_policy_unsafe');
  if (!hasOwnerBoundary(metadata.ownerBoundary)) reasonCodes.push('owner_boundary_unsafe');
  if (hasUnsafeCompactSummary(metadata)) reasonCodes.push('unsafe_compact_summary');
  if (containsDisallowedRuntimeOrFuturePromptKeys(metadata)) reasonCodes.push('runtime_or_future_prompt_body_field_present');
  if (metadata.reasonCodes.length === 0) reasonCodes.push('missing_reason_codes');
  return { ok: reasonCodes.length === 0, reasonCodes };
}

function buildPointInventory(sourceRefs: readonly string[]): readonly PromptEnhancementHandoffPointInventoryV1[] {
  return sourceRefs.map((sourceRef, index) => ({
    pointRefId: `handoff-point:${index + 1}`,
    sourcePointRef: sourceRef,
    order: index + 1,
    explicitness: 'inferred_from_source_signal',
    dependencyPointRefs: [],
    riskConfirmationRequired: false,
    sourceSupportState: 'present',
    currentBodyCoverageState: 'covered_in_current_body',
    privacyClass: 'local_private_ref_only',
    reasonCodes: ['source_ref_metadata_only'],
  }));
}

function buildDecompositionGroups(
  currentBody: PromptEnhancementCurrentBodyV1,
  points: readonly PromptEnhancementHandoffPointInventoryV1[],
): readonly PromptEnhancementHandoffDecompositionGroupV1[] {
  if (points.length === 0) return [];
  return [{
    decompositionGroupId: `handoff-group:${currentBody.currentBodyId}:1`,
    pointRefs: points.map((point) => point.pointRefId),
    bodySectionRefs: currentBody.sections.map((section) => section.sectionId),
    groupingReason: 'single_current_body_group',
    splitRequirementState: 'candidate_metadata_only',
    sourceRefs: uniqueNonEmpty(points.map((point) => point.sourcePointRef)),
    riskConfirmationRefs: [],
    publicSafeSummaryVisible: true,
    invalidLineageBehavior: 'suppress_handoff',
  }];
}

function buildTaskSlices(
  currentBody: PromptEnhancementCurrentBodyV1,
  points: readonly PromptEnhancementHandoffPointInventoryV1[],
  groups: readonly PromptEnhancementHandoffDecompositionGroupV1[],
  handoffKind: PromptEnhancementHandoffMetadataV1['handoffKind'],
): readonly PromptEnhancementHandoffTaskSliceV1[] {
  if (points.length === 0) return [];
  const groupId = groups[0]?.decompositionGroupId ?? 'not_applicable';
  return points.map((point, index) => ({
    taskSliceId: `handoff-slice:${currentBody.currentBodyId}:${index + 1}`,
    sourcePointRefs: [point.pointRefId],
    decompositionGroupId: groupId,
    bodySectionRefs: currentBody.sections.map((section) => section.sectionId),
    dependencySliceRefs: [],
    sequenceRole: handoffKind === 'none' ? 'not_sequence' : 'future_candidate_metadata_only',
    futurePromptCandidateState: handoffKind === 'blocked_or_deferred_sequence'
      ? 'blocked_pending_runtime'
      : 'candidate_metadata_only',
    editInvalidationState: 'valid_until_body_revision_changes',
    handoffEligibilityState: handoffKind === 'none' ? 'not_eligible' : 'eligible_metadata_only',
    reasonCodes: ['future_prompt_text_not_generated'],
  }));
}

function buildConfirmationTargets(
  safetySummary: PromptEnhancementSafetySummaryV1,
  points: readonly PromptEnhancementHandoffPointInventoryV1[],
): readonly PromptEnhancementHandoffConfirmationTargetV1[] {
  if (safetySummary.sensitiveActionState === 'none') return [];
  return [{
    confirmationTargetId: 'handoff-confirmation:current-body',
    mode: 'body_visible_confirmation',
    targetRefs: points.map((point) => point.pointRefId),
    riskRefs: ['sensitive_action_state'],
    bodyVisibilityState: safetySummary.sensitiveActionState === 'confirmation_required_present'
      ? 'visible_in_current_body'
      : 'missing_invalid',
    satisfiedByMetadata: false,
  }];
}

function buildCompactSummary(
  input: PromptEnhancementHandoffMetadataInputV1,
  handoffKind: PromptEnhancementHandoffMetadataV1['handoffKind'],
  sourceRefs: readonly string[],
): PromptEnhancementCompactFirstPopupSequenceSummaryV1 | undefined {
  if (handoffKind !== 'compact_sequence_summary_candidate' && handoffKind !== 'first_prompt_handoff_candidate') {
    return undefined;
  }
  const summary = input.summary ?? {
    summaryId: `${input.handoffDecisionId}:summary`,
    publicSafeText: 'Additional task metadata is available after the current body.',
    remainingTaskCount: 0,
    taskRoleLabels: [],
  };
  return {
    summaryId: summary.summaryId,
    currentBodyId: input.currentBody.currentBodyId,
    bodyRevision: input.currentBody.bodyRevision,
    publicSafeText: summary.publicSafeText,
    remainingTaskCount: summary.remainingTaskCount,
    taskRoleLabels: summary.taskRoleLabels,
    sourceRefs: summary.sourceRefs ?? sourceRefs,
    containsFuturePromptText: false,
    rawPromptTextExcluded: true,
    rawGeneratedBodyExcluded: true,
    bodyBoundMetadataOnly: true,
  };
}

function buildSourceImpact(
  handoffDecisionId: string,
  overrides: Partial<PromptEnhancementHandoffSourceImpactMetadataV1> | undefined,
): PromptEnhancementHandoffSourceImpactMetadataV1 {
  return {
    sourceImpactMetadataId: `${handoffDecisionId}:source-impact`,
    contentTemplateSourceRefs: [],
    contentTemplateVariantIdentityRefs: [],
    servedVariantEventRefs: [],
    recordSignalTypes: [],
    recordSourceTiers: [],
    recordSchemaVersions: [],
    recordQuestionRefs: [],
    recordPinchFallbackRefs: [],
    recordRegisterSnapshotRefs: [],
    recordRoleSnapshotRefs: [],
    recordMaturityLevelSnapshotRefs: [],
    recordSnapshotRefs: [],
    recordComposePathRefs: [],
    recordSafeguardStateRefs: [],
    sourceCascadeOutcomeRefs: [],
    whyDescDeliveryDisposition: 'not_source_truth_not_future_prompt_text',
    feedbackPreemptionDisposition: 'not_pe_exposure_or_handoff_acceptance',
    transportEvidenceDisposition: 'delivery_attempt_only_not_semantic_authority',
    stageClassifierDegradedDisposition: 'cannot_create_handoff_candidate',
    generatedOriginPolicyState: 'typed_origin_lineage_required',
    ...overrides,
  };
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function hasRuntimeGuards(value: unknown): boolean {
  const guards = asRecord(value);
  return guards.createsRuntimeQueue === false
    && guards.permitsContinuation === false
    && guards.activeRuntimeState === 'not_created_v1'
    && guards.autoSendPolicy === 'prohibited'
    && guards.futurePromptBodiesRuntimePolicy === 'not_generated_not_stored_not_rendered'
    && guards.pointerAdvancementPolicy === 'prohibited'
    && guards.completionProofPolicy === 'not_claimed'
    && guards.responseWatcherPolicy === 'not_created_v1'
    && guards.durableResumePolicy === 'not_created_v1';
}

function hasScope(
  value: unknown,
  expectedScope: Pick<PromptEnhancementHandoffMetadataV1['scope'], 'requestId' | 'projectRoot'> | undefined,
): boolean {
  const scope = asRecord(value);
  return scope.requestId === (expectedScope?.requestId ?? scope.requestId)
    && typeof scope.requestId === 'string'
    && scope.projectRoot === (expectedScope?.projectRoot ?? scope.projectRoot)
    && typeof scope.projectRoot === 'string'
    && scope.projectScopeState === 'current_project_only'
    && Array.isArray(scope.sourceScopeRefs)
    && scope.sourceScopeRefs.length > 0
    && scope.crossProjectApplicationPolicy === 'reject'
    && scope.staleResponsePolicy === 'ignore_no_overwrite';
}

function hasApplicability(value: unknown, metadataState: PromptEnhancementHandoffMetadataV1['applicabilityState']): boolean {
  const applicability = asRecord(value);
  return applicability.state === metadataState
    && Array.isArray(applicability.taskSliceRefs)
    && Array.isArray(applicability.decompositionGroupRefs)
    && Array.isArray(applicability.sourcePointRefs)
    && typeof applicability.intentFamily === 'string'
    && typeof applicability.intentCategory === 'string'
    && typeof applicability.levelDepthState === 'string'
    && typeof applicability.riskSafetyState === 'string'
    && typeof applicability.dependencyOrderState === 'string'
    && typeof applicability.currentBodyCoverageState === 'string'
    && applicability.promptSizeApiAvailabilityState === 'not_measured_v1_metadata_only'
    && typeof applicability.hostCapabilityState === 'string'
    && applicability.explicitUserRuntimeState === 'not_started_v1'
    && typeof applicability.granularityActionabilityState === 'string'
    && typeof applicability.splitMergeDisposition === 'string'
    && applicability.granularityFailureDisposition === 'current_or_original_fallback_no_runtime'
    && Array.isArray(applicability.sourcePriorityRefs)
    && typeof applicability.sourcePriorityState === 'string'
    && Array.isArray(applicability.targetScopeRefs)
    && applicability.targetScopeRefs.length > 0
    && typeof applicability.targetSurfaceState === 'string'
    && typeof applicability.workspaceBindingState === 'string'
    && typeof applicability.scopeBindingDisposition === 'string'
    && typeof applicability.expectedDeliverableState === 'string'
    && Array.isArray(applicability.deliverableContractRefs)
    && typeof applicability.outputFormatPolicy === 'string'
    && applicability.completionEvidenceRequirementState === 'not_runtime_proof_v1'
    && Array.isArray(applicability.acceptanceCriteriaRefs)
    && applicability.successConditionState === 'not_runtime_evaluated_v1'
    && applicability.definitionOfDoneState === 'not_runtime_evaluated_v1'
    && applicability.acceptanceVerificationPolicy === 'user_owned_not_runtime_v1'
    && applicability.acceptanceFailureDisposition === 'current_or_original_fallback_no_runtime'
    && typeof applicability.atomicGroupId === 'string'
    && Array.isArray(applicability.atomicGroupRefs)
    && typeof applicability.coDeliveryRequirementState === 'string'
    && applicability.partialCompletionPolicy === 'no_runtime_partial_completion_v1'
    && applicability.rollbackCouplingState === 'not_runtime_v1'
    && applicability.atomicGroupFailureDisposition === 'current_or_original_fallback_no_runtime'
    && typeof applicability.sourceConflictState === 'string'
    && Array.isArray(applicability.conflictingSourcePointRefs)
    && applicability.conflictResolutionPolicy === 'current_body_or_no_runtime'
    && applicability.unresolvedConflictDisposition === 'current_or_original_fallback_no_runtime'
    && applicability.conflictVisibilityPolicy === 'public_safe_reason_codes_only'
    && typeof applicability.userNoSequenceConstraintState === 'string'
    && typeof applicability.onePromptOnlyConstraintState === 'string'
    && typeof applicability.sequenceSuppressionSourceState === 'string'
    && applicability.noSplitOverrideDisposition === 'not_allowed_v1'
    && applicability.partialItemConsentState === 'deferred_out_of_v1'
    && typeof applicability.clarificationApplicabilityState === 'string'
    && typeof applicability.userInputRequirementState === 'string'
    && Array.isArray(applicability.missingInformationRefs)
    && typeof applicability.clarificationQuestionKindState === 'string'
    && typeof applicability.answerDependencyState === 'string'
    && typeof applicability.agentPermissionModeSnapshot === 'string'
    && typeof applicability.itemExecutionCapabilityRequirementState === 'string'
    && Array.isArray(applicability.toolAccessRequirementRefs)
    && applicability.capabilityMismatchDisposition === 'current_or_original_fallback_no_runtime'
    && typeof applicability.manualExecutionRequiredState === 'string'
    && typeof applicability.conditionalInstructionState === 'string'
    && applicability.itemOrderingMode === 'no_runtime_order'
    && typeof applicability.independentItemState === 'string'
    && typeof applicability.unorderedGroupId === 'string'
    && applicability.serializationDisposition === 'metadata_only_no_runtime_order'
    && typeof applicability.userOrderPreferenceState === 'string'
    && applicability.parallelExecutionPolicy === 'not_supported_v1'
    && applicability.receiverCanActivateRuntime === false;
}

function hasSourceImpact(value: unknown): boolean {
  const sourceImpact = asRecord(value);
  return typeof sourceImpact.sourceImpactMetadataId === 'string'
    && Array.isArray(sourceImpact.contentTemplateSourceRefs)
    && Array.isArray(sourceImpact.contentTemplateVariantIdentityRefs)
    && Array.isArray(sourceImpact.servedVariantEventRefs)
    && Array.isArray(sourceImpact.recordSignalTypes)
    && Array.isArray(sourceImpact.recordSourceTiers)
    && Array.isArray(sourceImpact.recordSchemaVersions)
    && Array.isArray(sourceImpact.recordQuestionRefs)
    && Array.isArray(sourceImpact.recordPinchFallbackRefs)
    && Array.isArray(sourceImpact.recordRegisterSnapshotRefs)
    && Array.isArray(sourceImpact.recordRoleSnapshotRefs)
    && Array.isArray(sourceImpact.recordMaturityLevelSnapshotRefs)
    && Array.isArray(sourceImpact.recordSnapshotRefs)
    && Array.isArray(sourceImpact.recordComposePathRefs)
    && Array.isArray(sourceImpact.recordSafeguardStateRefs)
    && Array.isArray(sourceImpact.sourceCascadeOutcomeRefs)
    && sourceImpact.whyDescDeliveryDisposition === 'not_source_truth_not_future_prompt_text'
    && sourceImpact.feedbackPreemptionDisposition === 'not_pe_exposure_or_handoff_acceptance'
    && sourceImpact.transportEvidenceDisposition === 'delivery_attempt_only_not_semantic_authority'
    && sourceImpact.stageClassifierDegradedDisposition === 'cannot_create_handoff_candidate'
    && sourceImpact.generatedOriginPolicyState === 'typed_origin_lineage_required';
}

function hasPrivacyStoragePolicy(value: unknown): boolean {
  const policy = asRecord(value);
  return policy.rawPromptBodiesExcluded === true
    && policy.rawGeneratedBodiesExcluded === true
    && policy.rawSourceExcerptsExcluded === true
    && policy.rawFeedbackExcluded === true
    && policy.futurePromptBodiesStored === false
    && policy.oldDecisionSessionStoresAreAuthority === false
    && policy.productFeedbackIsPeHandoffSignal === false
    && policy.telemetryPolicy === 'ids_counts_status_only';
}

function hasOwnerBoundary(value: unknown): boolean {
  const boundary = asRecord(value);
  return boundary.semanticOwner === 'content_semantics'
    && boundary.uiConsumer === 'ui_app'
    && boundary.hostOwner === 'host_transport'
    && boundary.runtimeOwnerState === 'future_future_sequence_only_after_gates';
}

function hasUnsafeCompactSummary(metadata: PromptEnhancementHandoffMetadataV1): boolean {
  const summary = metadata.compactFirstPopupSequenceSummary;
  if (!summary) {
    return metadata.handoffKind === 'compact_sequence_summary_candidate'
      || metadata.handoffKind === 'first_prompt_handoff_candidate';
  }
  return summary.currentBodyId !== metadata.currentBodyId
    || summary.bodyRevision !== metadata.bodyRevision
    || summary.containsFuturePromptText !== false
    || summary.rawPromptTextExcluded !== true
    || summary.rawGeneratedBodyExcluded !== true
    || summary.bodyBoundMetadataOnly !== true;
}

function containsDisallowedRuntimeOrFuturePromptKeys(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.some(([key, child]) => {
    if (
      key === 'queue'
      || key === 'runtimeQueue'
      || key === 'continuationState'
      || key === 'futurePromptBodies'
      || key === 'futurePromptText'
      || key === 'autoSend'
      || key === 'autoAdvance'
      || key === 'completionProof'
    ) {
      return true;
    }
    if (Array.isArray(child)) return child.some((item) => containsDisallowedRuntimeOrFuturePromptKeys(item));
    return containsDisallowedRuntimeOrFuturePromptKeys(child);
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
