import { describe, expect, it } from 'vitest';
import {
  buildPromptEnhancementFinalAcceptancePacketV1,
  validatePromptEnhancementFinalAcceptancePacketV1,
  PROMPT_ENHANCEMENT_FINAL_CONSISTENCY_TARGETS_V1,
  PROMPT_ENHANCEMENT_FINAL_ACCEPTANCE_REQUIRED_NEGATIVE_AUTHORITIES_V1,
  PROMPT_ENHANCEMENT_FINAL_ACCEPTANCE_REQUIRED_SURFACES_V1,
  type PromptEnhancementFinalConsistencyEvidenceV1,
  type PromptEnhancementFinalAcceptanceNegativeAuthorityCheckV1,
  type PromptEnhancementFinalAcceptanceSurfaceEvidenceV1,
} from './final-acceptance.js';
import {
  buildPromptEnhancementPublicLaunchRecheckPacketV1,
  type PromptEnhancementPublicLaunchFileFactsV1,
} from './public-launch-recheck.js';

const surfaceEvidence: readonly PromptEnhancementFinalAcceptanceSurfaceEvidenceV1[] =
  PROMPT_ENHANCEMENT_FINAL_ACCEPTANCE_REQUIRED_SURFACES_V1.map((surface) => ({
    surface,
    evidenceState: 'pass',
    evidenceRefs: [`phase15:${surface}:acceptance`],
    owner: ownerForSurface(surface),
  }));

const negativeAuthorityChecks: readonly PromptEnhancementFinalAcceptanceNegativeAuthorityCheckV1[] =
  PROMPT_ENHANCEMENT_FINAL_ACCEPTANCE_REQUIRED_NEGATIVE_AUTHORITIES_V1.map((authority) => ({
    authority,
    blockedAsSemanticAuthority: true,
    blockedAsActivationAuthority: true,
    blockedAsSourceUseAuthority: true,
    blockedAsFeedbackAuthority: true,
    blockedAsGeneratedOriginAuthority: true,
    blockedAsLaunchReadinessAuthority: true,
    evidenceRefs: [`phase15:${authority}:negative`],
  }));

const finalConsistencyEvidence: PromptEnhancementFinalConsistencyEvidenceV1 = {
  sourceSyncScanRerunAgainstLatestCheckout: true,
  staleActiveInstructionScanPassed: true,
  consistencyTargets: PROMPT_ENHANCEMENT_FINAL_CONSISTENCY_TARGETS_V1.map((target) => ({
    target,
    evidenceState: 'pass',
    devPlanTreatmentRefs: [`phase15:${target}:dev-plan-treatment`],
  })),
};

describe('Phase 15 cross-layer final acceptance', () => {
  it('blocks readiness in the current state when launch evidence and final signoff are missing', () => {
    const packet = buildPromptEnhancementFinalAcceptancePacketV1({
      surfaceEvidence,
      negativeAuthorityChecks,
      signoff: {
        hirenFinalSignoff: 'missing',
        bhavneshCrossLayerAcceptance: 'missing',
        hirenTestSignoff: 'missing',
      },
    });

    expect(packet.packetId).toBe('pe-dr6-cross-layer-final-acceptance-v1');
    expect(packet.owner).toBe('bhavnesh_cross_layer_acceptance');
    expect(packet.status).toBe('blocked_by_failed_gate');
    expect(packet.readinessClaimAllowed).toBe(false);
    expect(packet.acceptedForPublicLaunch).toBe(false);
    expect(packet.publicLaunchPacket.publicPromotionAllowed).toBe(false);
    expect(packet.finalAcceptanceRules).toMatchObject({
      apiUiStopExtensionStorePublicLaunchAcceptanceRequired: true,
      oldDecisionSessionAuthorityForbidden: true,
      productFeedbackAuthorityForbidden: true,
      promptHistoryAuthorityForbidden: true,
      rawTransportAuthorityForbidden: true,
      oldSourcesCannotActivatePromptEnhancement: true,
      oldSourcesCannotCreateSourceUseOrFeedback: true,
      oldSourcesCannotCreateGeneratedOrigin: true,
      oldSourcesCannotClaimLaunchReadiness: true,
      readinessRequiresAllEvidenceAndSignoff: true,
      doesNotAuthorizeFutureSequenceRuntime: true,
      doesNotAuthorizeImplementationByItself: true,
    });
    expect(packet.reasonCodes).toEqual(expect.arrayContaining([
      'public_launch_packet:not_approved_for_public_promotion',
      'public_launch_packet:launch_ready_claim_blocked',
      'final_signoff_missing:hiren',
      'final_signoff_missing:bhavnesh_cross_layer_acceptance',
      'final_signoff_missing:hiren_test',
    ]));
    expect(validatePromptEnhancementFinalAcceptancePacketV1(packet).ok).toBe(false);
  });

  it('accepts readiness only when every cross-layer surface, public-launch gate, negative authority, and owner signoff passes', () => {
    const publicLaunchPacket = buildPromptEnhancementPublicLaunchRecheckPacketV1(approvedPublicLaunchFacts());
    const packet = buildPromptEnhancementFinalAcceptancePacketV1({
      publicLaunchPacket,
      finalConsistencyEvidence,
      surfaceEvidence,
      negativeAuthorityChecks,
      signoff: {
        hirenFinalSignoff: 'approved',
        bhavneshCrossLayerAcceptance: 'approved',
        hirenTestSignoff: 'approved',
      },
    });

    expect(validatePromptEnhancementFinalAcceptancePacketV1(packet)).toEqual({
      ok: true,
      status: 'accepted_for_readiness_claim',
      readinessClaimAllowed: true,
      acceptedForPublicLaunch: true,
      reasonCodes: [],
    });
    expect(packet.requiredSurfaces).toEqual(PROMPT_ENHANCEMENT_FINAL_ACCEPTANCE_REQUIRED_SURFACES_V1);
    expect(packet.finalConsistencyEvidence.consistencyTargets.map((row) => row.target)).toEqual(PROMPT_ENHANCEMENT_FINAL_CONSISTENCY_TARGETS_V1);
    expect(packet.surfaceEvidence.map((row) => row.surface)).toEqual(PROMPT_ENHANCEMENT_FINAL_ACCEPTANCE_REQUIRED_SURFACES_V1);
    expect(packet.negativeAuthorityChecks.map((row) => row.authority)).toEqual(PROMPT_ENHANCEMENT_FINAL_ACCEPTANCE_REQUIRED_NEGATIVE_AUTHORITIES_V1);
  });

  it('hard-blocks old DS, product feedback, prompt history, and raw transport when any source is treated as authority', () => {
    const publicLaunchPacket = buildPromptEnhancementPublicLaunchRecheckPacketV1(approvedPublicLaunchFacts());
    const packet = buildPromptEnhancementFinalAcceptancePacketV1({
      publicLaunchPacket,
      finalConsistencyEvidence,
      surfaceEvidence: surfaceEvidence.map((row) => row.surface === 'store_memory_feedback'
        ? { ...row, evidenceState: 'missing' as const }
        : row),
      negativeAuthorityChecks: negativeAuthorityChecks.map((row) => row.authority === 'raw_stop_reason_transport'
        ? {
            ...row,
            blockedAsSemanticAuthority: false,
            blockedAsActivationAuthority: false,
            blockedAsSourceUseAuthority: false,
            blockedAsFeedbackAuthority: false,
            blockedAsGeneratedOriginAuthority: false,
            blockedAsLaunchReadinessAuthority: false,
          }
        : row),
      signoff: {
        hirenFinalSignoff: 'approved',
        bhavneshCrossLayerAcceptance: 'approved',
        hirenTestSignoff: 'approved',
      },
    });

    expect(packet.status).toBe('blocked_by_failed_gate');
    expect(packet.readinessClaimAllowed).toBe(false);
    expect(packet.reasonCodes).toEqual(expect.arrayContaining([
      'surface_missing_evidence:store_memory_feedback',
      'negative_authority_not_blocked:raw_stop_reason_transport',
      'negative_activation_not_blocked:raw_stop_reason_transport',
      'negative_source_use_not_blocked:raw_stop_reason_transport',
      'negative_feedback_not_blocked:raw_stop_reason_transport',
      'negative_generated_origin_not_blocked:raw_stop_reason_transport',
      'negative_launch_readiness_not_blocked:raw_stop_reason_transport',
    ]));
    expect(validatePromptEnhancementFinalAcceptancePacketV1(packet).reasonCodes).toEqual(expect.arrayContaining([
      'surface_missing_evidence:store_memory_feedback',
      'negative_authority_not_blocked:raw_stop_reason_transport',
      'negative_activation_not_blocked:raw_stop_reason_transport',
      'negative_source_use_not_blocked:raw_stop_reason_transport',
      'negative_feedback_not_blocked:raw_stop_reason_transport',
      'negative_generated_origin_not_blocked:raw_stop_reason_transport',
      'negative_launch_readiness_not_blocked:raw_stop_reason_transport',
    ]));
  });

  it('blocks readiness when Phase 15 source-sync and stale-term consistency evidence is absent or failed', () => {
    const publicLaunchPacket = buildPromptEnhancementPublicLaunchRecheckPacketV1(approvedPublicLaunchFacts());
    const packet = buildPromptEnhancementFinalAcceptancePacketV1({
      publicLaunchPacket,
      finalConsistencyEvidence: {
        sourceSyncScanRerunAgainstLatestCheckout: false,
        staleActiveInstructionScanPassed: false,
        consistencyTargets: finalConsistencyEvidence.consistencyTargets.map((row) => row.target === 'stale_term_scan'
          ? { ...row, evidenceState: 'blocked' as const, devPlanTreatmentRefs: [] }
          : row),
      },
      surfaceEvidence,
      negativeAuthorityChecks,
      signoff: {
        hirenFinalSignoff: 'approved',
        bhavneshCrossLayerAcceptance: 'approved',
        hirenTestSignoff: 'approved',
      },
    });

    expect(packet.readinessClaimAllowed).toBe(false);
    expect(packet.reasonCodes).toEqual(expect.arrayContaining([
      'final_consistency:source_sync_scan_not_rerun',
      'final_consistency:stale_active_instruction_scan_not_passed',
      'final_consistency:missing_treatment_ref:stale_term_scan',
      'final_consistency:blocked_target:stale_term_scan',
    ]));
  });

  it('rejects tampered packets that disable final acceptance safety rules or mismatch readiness state', () => {
    const publicLaunchPacket = buildPromptEnhancementPublicLaunchRecheckPacketV1(approvedPublicLaunchFacts());
    const packet = buildPromptEnhancementFinalAcceptancePacketV1({
      publicLaunchPacket,
      finalConsistencyEvidence,
      surfaceEvidence,
      negativeAuthorityChecks,
      signoff: {
        hirenFinalSignoff: 'approved',
        bhavneshCrossLayerAcceptance: 'approved',
        hirenTestSignoff: 'approved',
      },
    });

    packet.finalAcceptanceRules.rawTransportAuthorityForbidden = false;
    packet.finalAcceptanceRules.oldSourcesCannotActivatePromptEnhancement = false;
    packet.finalAcceptanceRules.oldSourcesCannotCreateSourceUseOrFeedback = false;
    packet.finalAcceptanceRules.oldSourcesCannotCreateGeneratedOrigin = false;
    packet.finalAcceptanceRules.oldSourcesCannotClaimLaunchReadiness = false;
    packet.finalAcceptanceRules.sourceSyncAndStaleScanRerunRequired = false;
    packet.finalAcceptanceRules.doesNotAuthorizeFutureSequenceRuntime = false;
    packet.finalAcceptanceRules.doesNotAuthorizeImplementationByItself = false;
    packet.readinessClaimAllowed = true;
    packet.acceptedForPublicLaunch = true;

    expect(validatePromptEnhancementFinalAcceptancePacketV1(packet).reasonCodes).toEqual(expect.arrayContaining([
      'raw_transport_authority_rule_disabled',
      'old_source_activation_rule_disabled',
      'old_source_use_feedback_rule_disabled',
      'old_source_generated_origin_rule_disabled',
      'old_source_launch_readiness_rule_disabled',
      'source_sync_stale_scan_rule_disabled',
      'future_sequence_runtime_authorized_by_final_acceptance',
      'implementation_authorized_by_final_consistency_pass',
      'readiness_claim_state_mismatch',
      'public_launch_acceptance_state_mismatch',
    ]));
  });
});

function approvedPublicLaunchFacts(): PromptEnhancementPublicLaunchFileFactsV1 {
  return {
    projectRoot: '/repo',
    gitignoreText: 'dist/\nsrc/prompt-enhancement/\nsrc/ext-vscode/prebuilds/\n',
    trackedFiles: [
      'src/prompt-enhancement/contracts.ts',
      'src/prompt-enhancement/final-acceptance.ts',
    ],
    checkIgnoredPaths: ['src/prompt-enhancement', 'src/ext-vscode/prebuilds'],
    promptEnhancementPathExists: true,
    promptEnhancementNestedGitExists: false,
    nestedGitRemoveOnlyProcedureApproved: true,
    pathRewriteRequested: false,
    packageJsonText: '{"scripts":{"build":"tsc","test":"vitest run"}}',
    tsconfigText: '{"include":["src/**/*"],"exclude":["node_modules","dist","src/ext-vscode"]}',
    publicGoingFileTexts: [
      {
        path: 'src/prompt-enhancement/final-acceptance.ts',
        text: 'export const publicSafeAcceptance = "ids_counts_status_timing_only";',
      },
    ],
    ownerLaunchDecision: 'approved_public_promotion',
  };
}

function ownerForSurface(
  surface: PromptEnhancementFinalAcceptanceSurfaceEvidenceV1['surface'],
): PromptEnhancementFinalAcceptanceSurfaceEvidenceV1['owner'] {
  switch (surface) {
    case 'ui_popup_session':
      return 'bhavnesh_ui_app';
    case 'stop_bridge_delivery':
    case 'extension_payload_contract':
      return 'vedansi_host_extension';
    case 'public_launch_recheck':
      return 'bhavnesh_release_check';
    case 'api_contract':
    case 'store_memory_feedback':
      return 'hiren_content_api';
  }
}
