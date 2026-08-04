import {
  buildPromptEnhancementAcceptancePacketV1,
  validatePromptEnhancementAcceptancePacketV1,
  type PromptEnhancementAcceptancePacketV1,
} from './acceptance-matrix.js';
import { PROMPT_ENHANCEMENT_CONTRACT_VERSION } from './contracts.js';
import {
  buildPromptEnhancementPublicLaunchRecheckPacketV1,
  validatePromptEnhancementPublicLaunchRecheckPacketV1,
  type PromptEnhancementPublicLaunchFileFactsV1,
  type PromptEnhancementPublicLaunchRecheckPacketV1,
} from './public-launch-recheck.js';

export type PromptEnhancementFinalAcceptanceStatusV1 =
  | 'blocked_pending_evidence'
  | 'blocked_by_failed_gate'
  | 'ready_for_final_owner_review'
  | 'accepted_for_readiness_claim';

export type PromptEnhancementFinalAcceptanceSurfaceV1 =
  | 'api_contract'
  | 'ui_popup_session'
  | 'stop_bridge_delivery'
  | 'extension_payload_contract'
  | 'store_memory_feedback'
  | 'public_launch_recheck';

export type PromptEnhancementFinalAcceptanceNegativeAuthorityV1 =
  | 'old_decision_session_option_list'
  | 'old_decision_session_content_template_copy'
  | 'product_feedback_rating'
  | 'prompt_history_or_served_variant'
  | 'raw_stop_reason_transport'
  | 'raw_extension_payload'
  | 'same_turn_replacement_claim'
  | 'auto_send_claim';

export type PromptEnhancementFinalAcceptanceEvidenceStateV1 =
  | 'pass'
  | 'blocked'
  | 'missing'
  | 'not_applicable';

export type PromptEnhancementFinalConsistencyTargetV1 =
  | 'source_basis_and_launch_boundary'
  | 'content_template_source_reality'
  | 'trigger_surface_and_prompt_start_stop_boundary'
  | 'store_memory_feedback_and_bootstrap'
  | 'safety_privacy_and_sensitive_actions'
  | 'bhavnesh_ui_handoff'
  | 'vedansi_host_transport'
  | 'cost_latency_and_pe_g4'
  | 'test_and_readiness_evidence'
  | 'stale_term_scan';

export interface PromptEnhancementFinalAcceptanceSurfaceEvidenceV1 {
  surface: PromptEnhancementFinalAcceptanceSurfaceV1;
  evidenceState: PromptEnhancementFinalAcceptanceEvidenceStateV1;
  evidenceRefs: readonly string[];
  owner: 'hiren_content_api' | 'bhavnesh_ui_app' | 'vedansi_host_extension' | 'bhavnesh_release_check';
}

export interface PromptEnhancementFinalAcceptanceNegativeAuthorityCheckV1 {
  authority: PromptEnhancementFinalAcceptanceNegativeAuthorityV1;
  blockedAsSemanticAuthority: boolean;
  blockedAsActivationAuthority: boolean;
  blockedAsSourceUseAuthority: boolean;
  blockedAsFeedbackAuthority: boolean;
  blockedAsGeneratedOriginAuthority: boolean;
  blockedAsLaunchReadinessAuthority: boolean;
  evidenceRefs: readonly string[];
}

export interface PromptEnhancementFinalAcceptanceSignoffV1 {
  hirenFinalSignoff: 'missing' | 'approved';
  bhavneshCrossLayerAcceptance: 'missing' | 'approved';
  hirenTestSignoff: 'missing' | 'approved';
}

export interface PromptEnhancementFinalConsistencyEvidenceV1 {
  sourceSyncScanRerunAgainstLatestCheckout: boolean;
  staleActiveInstructionScanPassed: boolean;
  consistencyTargets: readonly {
    target: PromptEnhancementFinalConsistencyTargetV1;
    evidenceState: PromptEnhancementFinalAcceptanceEvidenceStateV1;
    devPlanTreatmentRefs: readonly string[];
  }[];
}

export interface PromptEnhancementFinalAcceptanceInputV1 {
  acceptancePacket?: PromptEnhancementAcceptancePacketV1;
  publicLaunchPacket?: PromptEnhancementPublicLaunchRecheckPacketV1;
  publicLaunchFacts?: PromptEnhancementPublicLaunchFileFactsV1;
  finalConsistencyEvidence?: PromptEnhancementFinalConsistencyEvidenceV1;
  surfaceEvidence: readonly PromptEnhancementFinalAcceptanceSurfaceEvidenceV1[];
  negativeAuthorityChecks: readonly PromptEnhancementFinalAcceptanceNegativeAuthorityCheckV1[];
  signoff: PromptEnhancementFinalAcceptanceSignoffV1;
}

export interface PromptEnhancementFinalAcceptancePacketV1 {
  schemaVersion: typeof PROMPT_ENHANCEMENT_CONTRACT_VERSION;
  packetId: 'pe-dr6-cross-layer-final-acceptance-v1';
  owner: 'bhavnesh_cross_layer_acceptance';
  status: PromptEnhancementFinalAcceptanceStatusV1;
  readinessClaimAllowed: boolean;
  acceptedForPublicLaunch: boolean;
  acceptancePacket: PromptEnhancementAcceptancePacketV1;
  publicLaunchPacket: PromptEnhancementPublicLaunchRecheckPacketV1;
  finalConsistencyEvidence: PromptEnhancementFinalConsistencyEvidenceV1;
  requiredSurfaces: readonly PromptEnhancementFinalAcceptanceSurfaceV1[];
  surfaceEvidence: readonly PromptEnhancementFinalAcceptanceSurfaceEvidenceV1[];
  negativeAuthorityChecks: readonly PromptEnhancementFinalAcceptanceNegativeAuthorityCheckV1[];
  signoff: PromptEnhancementFinalAcceptanceSignoffV1;
  finalAcceptanceRules: {
    apiUiStopExtensionStorePublicLaunchAcceptanceRequired: true;
    oldDecisionSessionAuthorityForbidden: true;
    productFeedbackAuthorityForbidden: true;
    promptHistoryAuthorityForbidden: true;
    rawTransportAuthorityForbidden: true;
    oldSourcesCannotActivatePromptEnhancement: true;
    oldSourcesCannotCreateSourceUseOrFeedback: true;
    oldSourcesCannotCreateGeneratedOrigin: true;
    oldSourcesCannotClaimLaunchReadiness: true;
    sourceSyncAndStaleScanRerunRequired: true;
    readinessRequiresAllEvidenceAndSignoff: true;
    doesNotAuthorizeFutureSequenceRuntime: true;
    doesNotAuthorizeImplementationByItself: true;
  };
  reasonCodes: readonly string[];
}

export interface PromptEnhancementFinalAcceptanceValidationV1 {
  ok: boolean;
  status: PromptEnhancementFinalAcceptanceStatusV1;
  readinessClaimAllowed: boolean;
  acceptedForPublicLaunch: boolean;
  reasonCodes: readonly string[];
}

export const PROMPT_ENHANCEMENT_FINAL_ACCEPTANCE_REQUIRED_SURFACES_V1: readonly PromptEnhancementFinalAcceptanceSurfaceV1[] = [
  'api_contract',
  'ui_popup_session',
  'stop_bridge_delivery',
  'extension_payload_contract',
  'store_memory_feedback',
  'public_launch_recheck',
];

export const PROMPT_ENHANCEMENT_FINAL_ACCEPTANCE_REQUIRED_NEGATIVE_AUTHORITIES_V1: readonly PromptEnhancementFinalAcceptanceNegativeAuthorityV1[] = [
  'old_decision_session_option_list',
  'old_decision_session_content_template_copy',
  'product_feedback_rating',
  'prompt_history_or_served_variant',
  'raw_stop_reason_transport',
  'raw_extension_payload',
  'same_turn_replacement_claim',
  'auto_send_claim',
];

export const PROMPT_ENHANCEMENT_FINAL_CONSISTENCY_TARGETS_V1: readonly PromptEnhancementFinalConsistencyTargetV1[] = [
  'source_basis_and_launch_boundary',
  'content_template_source_reality',
  'trigger_surface_and_prompt_start_stop_boundary',
  'store_memory_feedback_and_bootstrap',
  'safety_privacy_and_sensitive_actions',
  'bhavnesh_ui_handoff',
  'vedansi_host_transport',
  'cost_latency_and_pe_g4',
  'test_and_readiness_evidence',
  'stale_term_scan',
];

const BLOCKED_PUBLIC_LAUNCH_FACTS: PromptEnhancementPublicLaunchFileFactsV1 = {
  projectRoot: '/repo',
  gitignoreText: 'src/prompt-enhancement/\nsrc/ext-vscode/prebuilds/\n',
  trackedFiles: [],
  checkIgnoredPaths: ['src/prompt-enhancement', 'src/ext-vscode/prebuilds'],
  promptEnhancementPathExists: true,
  promptEnhancementNestedGitExists: true,
  nestedGitRemoveOnlyProcedureApproved: false,
  pathRewriteRequested: false,
  packageJsonText: '{"scripts":{"build":"tsc","test":"vitest run"}}',
  tsconfigText: '{"include":["src/**/*"],"exclude":["node_modules","dist","src/ext-vscode"]}',
  publicGoingFileTexts: [],
  ownerLaunchDecision: 'missing',
};

const MISSING_FINAL_CONSISTENCY_EVIDENCE: PromptEnhancementFinalConsistencyEvidenceV1 = {
  sourceSyncScanRerunAgainstLatestCheckout: false,
  staleActiveInstructionScanPassed: false,
  consistencyTargets: [],
};

export function buildPromptEnhancementFinalAcceptancePacketV1(
  input: PromptEnhancementFinalAcceptanceInputV1,
): PromptEnhancementFinalAcceptancePacketV1 {
  const acceptancePacket = input.acceptancePacket ?? buildPromptEnhancementAcceptancePacketV1();
  const publicLaunchPacket = input.publicLaunchPacket
    ?? buildPromptEnhancementPublicLaunchRecheckPacketV1(input.publicLaunchFacts ?? BLOCKED_PUBLIC_LAUNCH_FACTS);
  const finalConsistencyEvidence = input.finalConsistencyEvidence ?? MISSING_FINAL_CONSISTENCY_EVIDENCE;
  const reasonCodes = validatePromptEnhancementFinalAcceptanceInputV1({
    acceptancePacket,
    publicLaunchPacket,
    finalConsistencyEvidence,
    surfaceEvidence: input.surfaceEvidence,
    negativeAuthorityChecks: input.negativeAuthorityChecks,
    signoff: input.signoff,
  });
  const hardGateFailed = reasonCodes.some((reason) => reason.startsWith('acceptance_packet:')
    || reason.startsWith('public_launch_packet:')
    || reason.startsWith('surface_blocked:')
    || reason.startsWith('negative_authority_not_blocked:')
    || reason.startsWith('final_signoff_missing:'));
  const allOk = reasonCodes.length === 0;

  return {
    schemaVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
    packetId: 'pe-dr6-cross-layer-final-acceptance-v1',
    owner: 'bhavnesh_cross_layer_acceptance',
    status: allOk
      ? 'accepted_for_readiness_claim'
      : hardGateFailed
        ? 'blocked_by_failed_gate'
        : 'blocked_pending_evidence',
    readinessClaimAllowed: allOk,
    acceptedForPublicLaunch: allOk && publicLaunchPacket.publicPromotionAllowed,
    acceptancePacket,
    publicLaunchPacket,
    finalConsistencyEvidence,
    requiredSurfaces: PROMPT_ENHANCEMENT_FINAL_ACCEPTANCE_REQUIRED_SURFACES_V1,
    surfaceEvidence: input.surfaceEvidence,
    negativeAuthorityChecks: input.negativeAuthorityChecks,
    signoff: input.signoff,
    finalAcceptanceRules: {
      apiUiStopExtensionStorePublicLaunchAcceptanceRequired: true,
      oldDecisionSessionAuthorityForbidden: true,
      productFeedbackAuthorityForbidden: true,
      promptHistoryAuthorityForbidden: true,
      rawTransportAuthorityForbidden: true,
      oldSourcesCannotActivatePromptEnhancement: true,
      oldSourcesCannotCreateSourceUseOrFeedback: true,
      oldSourcesCannotCreateGeneratedOrigin: true,
      oldSourcesCannotClaimLaunchReadiness: true,
      sourceSyncAndStaleScanRerunRequired: true,
      readinessRequiresAllEvidenceAndSignoff: true,
      doesNotAuthorizeFutureSequenceRuntime: true,
      doesNotAuthorizeImplementationByItself: true,
    },
    reasonCodes,
  };
}

export function validatePromptEnhancementFinalAcceptancePacketV1(
  packet: PromptEnhancementFinalAcceptancePacketV1,
): PromptEnhancementFinalAcceptanceValidationV1 {
  const reasonCodes = validatePromptEnhancementFinalAcceptanceInputV1(packet);
  if (packet.schemaVersion !== PROMPT_ENHANCEMENT_CONTRACT_VERSION) reasonCodes.push('schema_version_mismatch');
  if (packet.packetId !== 'pe-dr6-cross-layer-final-acceptance-v1') reasonCodes.push('packet_id_mismatch');
  if (packet.owner !== 'bhavnesh_cross_layer_acceptance') reasonCodes.push('owner_mismatch');
  for (const surface of PROMPT_ENHANCEMENT_FINAL_ACCEPTANCE_REQUIRED_SURFACES_V1) {
    if (!packet.requiredSurfaces.includes(surface)) reasonCodes.push(`missing_required_surface:${surface}`);
  }
  if (!packet.finalAcceptanceRules.apiUiStopExtensionStorePublicLaunchAcceptanceRequired) reasonCodes.push('cross_layer_acceptance_rule_disabled');
  if (!packet.finalAcceptanceRules.oldDecisionSessionAuthorityForbidden) reasonCodes.push('old_ds_authority_rule_disabled');
  if (!packet.finalAcceptanceRules.productFeedbackAuthorityForbidden) reasonCodes.push('product_feedback_authority_rule_disabled');
  if (!packet.finalAcceptanceRules.promptHistoryAuthorityForbidden) reasonCodes.push('prompt_history_authority_rule_disabled');
  if (!packet.finalAcceptanceRules.rawTransportAuthorityForbidden) reasonCodes.push('raw_transport_authority_rule_disabled');
  if (!packet.finalAcceptanceRules.oldSourcesCannotActivatePromptEnhancement) reasonCodes.push('old_source_activation_rule_disabled');
  if (!packet.finalAcceptanceRules.oldSourcesCannotCreateSourceUseOrFeedback) reasonCodes.push('old_source_use_feedback_rule_disabled');
  if (!packet.finalAcceptanceRules.oldSourcesCannotCreateGeneratedOrigin) reasonCodes.push('old_source_generated_origin_rule_disabled');
  if (!packet.finalAcceptanceRules.oldSourcesCannotClaimLaunchReadiness) reasonCodes.push('old_source_launch_readiness_rule_disabled');
  if (!packet.finalAcceptanceRules.sourceSyncAndStaleScanRerunRequired) reasonCodes.push('source_sync_stale_scan_rule_disabled');
  if (!packet.finalAcceptanceRules.readinessRequiresAllEvidenceAndSignoff) reasonCodes.push('readiness_signoff_rule_disabled');
  if (!packet.finalAcceptanceRules.doesNotAuthorizeFutureSequenceRuntime) reasonCodes.push('future_sequence_runtime_authorized_by_final_acceptance');
  if (!packet.finalAcceptanceRules.doesNotAuthorizeImplementationByItself) reasonCodes.push('implementation_authorized_by_final_consistency_pass');

  const allOk = reasonCodes.length === 0;
  if (packet.readinessClaimAllowed !== allOk) reasonCodes.push('readiness_claim_state_mismatch');
  if (packet.acceptedForPublicLaunch !== (allOk && packet.publicLaunchPacket.publicPromotionAllowed)) {
    reasonCodes.push('public_launch_acceptance_state_mismatch');
  }
  const expectedStatus: PromptEnhancementFinalAcceptanceStatusV1 = allOk
    ? 'accepted_for_readiness_claim'
    : reasonCodes.some((reason) => reason.startsWith('acceptance_packet:')
      || reason.startsWith('public_launch_packet:')
      || reason.startsWith('surface_blocked:')
      || reason.startsWith('negative_authority_not_blocked:')
      || reason.startsWith('final_signoff_missing:'))
      ? 'blocked_by_failed_gate'
      : 'blocked_pending_evidence';
  if (packet.status !== expectedStatus) reasonCodes.push(`status_mismatch:${expectedStatus}`);

  return {
    ok: reasonCodes.length === 0,
    status: reasonCodes.length === 0 ? packet.status : expectedStatus,
    readinessClaimAllowed: reasonCodes.length === 0,
    acceptedForPublicLaunch: reasonCodes.length === 0 && packet.publicLaunchPacket.publicPromotionAllowed,
    reasonCodes,
  };
}

function validatePromptEnhancementFinalAcceptanceInputV1(input: {
  acceptancePacket: PromptEnhancementAcceptancePacketV1;
  publicLaunchPacket: PromptEnhancementPublicLaunchRecheckPacketV1;
  finalConsistencyEvidence: PromptEnhancementFinalConsistencyEvidenceV1;
  surfaceEvidence: readonly PromptEnhancementFinalAcceptanceSurfaceEvidenceV1[];
  negativeAuthorityChecks: readonly PromptEnhancementFinalAcceptanceNegativeAuthorityCheckV1[];
  signoff: PromptEnhancementFinalAcceptanceSignoffV1;
}): string[] {
  const reasonCodes: string[] = [];
  const acceptanceValidation = validatePromptEnhancementAcceptancePacketV1(input.acceptancePacket);
  for (const reason of acceptanceValidation.reasonCodes) reasonCodes.push(`acceptance_packet:${reason}`);
  if (!acceptanceValidation.ok) reasonCodes.push('acceptance_packet:invalid');
  if (input.acceptancePacket.readinessClaimAllowed !== false) reasonCodes.push('acceptance_packet:premature_readiness_claim');

  const publicLaunchReasons = validatePromptEnhancementPublicLaunchRecheckPacketV1(input.publicLaunchPacket);
  for (const reason of publicLaunchReasons) reasonCodes.push(`public_launch_packet:${reason}`);
  if (!input.publicLaunchPacket.publicPromotionAllowed) reasonCodes.push('public_launch_packet:not_approved_for_public_promotion');
  if (!input.publicLaunchPacket.launchReadyClaimAllowed) reasonCodes.push('public_launch_packet:launch_ready_claim_blocked');

  if (!input.finalConsistencyEvidence.sourceSyncScanRerunAgainstLatestCheckout) {
    reasonCodes.push('final_consistency:source_sync_scan_not_rerun');
  }
  if (!input.finalConsistencyEvidence.staleActiveInstructionScanPassed) {
    reasonCodes.push('final_consistency:stale_active_instruction_scan_not_passed');
  }
  const consistencyTargets = new Map(input.finalConsistencyEvidence.consistencyTargets.map((row) => [row.target, row]));
  for (const target of PROMPT_ENHANCEMENT_FINAL_CONSISTENCY_TARGETS_V1) {
    const row = consistencyTargets.get(target);
    if (!row) {
      reasonCodes.push(`final_consistency:missing_target:${target}`);
      continue;
    }
    if (row.devPlanTreatmentRefs.length === 0) reasonCodes.push(`final_consistency:missing_treatment_ref:${target}`);
    if (row.evidenceState === 'blocked') reasonCodes.push(`final_consistency:blocked_target:${target}`);
    if (row.evidenceState === 'missing') reasonCodes.push(`final_consistency:missing_evidence:${target}`);
  }

  const surfaces = new Map(input.surfaceEvidence.map((row) => [row.surface, row]));
  for (const surface of PROMPT_ENHANCEMENT_FINAL_ACCEPTANCE_REQUIRED_SURFACES_V1) {
    const row = surfaces.get(surface);
    if (!row) {
      reasonCodes.push(`surface_missing:${surface}`);
      continue;
    }
    if (row.evidenceRefs.length === 0) reasonCodes.push(`surface_missing_evidence_ref:${surface}`);
    if (row.evidenceState === 'blocked') reasonCodes.push(`surface_blocked:${surface}`);
    if (row.evidenceState === 'missing') reasonCodes.push(`surface_missing_evidence:${surface}`);
  }

  const negativeAuthorities = new Map(input.negativeAuthorityChecks.map((row) => [row.authority, row]));
  for (const authority of PROMPT_ENHANCEMENT_FINAL_ACCEPTANCE_REQUIRED_NEGATIVE_AUTHORITIES_V1) {
    const row = negativeAuthorities.get(authority);
    if (!row) {
      reasonCodes.push(`negative_authority_missing:${authority}`);
      continue;
    }
    if (!row.blockedAsSemanticAuthority) reasonCodes.push(`negative_authority_not_blocked:${authority}`);
    if (!row.blockedAsActivationAuthority) reasonCodes.push(`negative_activation_not_blocked:${authority}`);
    if (!row.blockedAsSourceUseAuthority) reasonCodes.push(`negative_source_use_not_blocked:${authority}`);
    if (!row.blockedAsFeedbackAuthority) reasonCodes.push(`negative_feedback_not_blocked:${authority}`);
    if (!row.blockedAsGeneratedOriginAuthority) reasonCodes.push(`negative_generated_origin_not_blocked:${authority}`);
    if (!row.blockedAsLaunchReadinessAuthority) reasonCodes.push(`negative_launch_readiness_not_blocked:${authority}`);
    if (row.evidenceRefs.length === 0) reasonCodes.push(`negative_authority_missing_evidence_ref:${authority}`);
  }

  if (input.signoff.hirenFinalSignoff !== 'approved') reasonCodes.push('final_signoff_missing:hiren');
  if (input.signoff.bhavneshCrossLayerAcceptance !== 'approved') reasonCodes.push('final_signoff_missing:bhavnesh_cross_layer_acceptance');
  if (input.signoff.hirenTestSignoff !== 'approved') reasonCodes.push('final_signoff_missing:hiren_test');
  return reasonCodes;
}
