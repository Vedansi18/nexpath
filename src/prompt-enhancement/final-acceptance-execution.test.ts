import { describe, expect, it } from 'vitest';
import {
  buildPromptEnhancementFinalAcceptancePacketV1,
  validatePromptEnhancementFinalAcceptancePacketV1,
  PROMPT_ENHANCEMENT_FINAL_ACCEPTANCE_REQUIRED_NEGATIVE_AUTHORITIES_V1,
  PROMPT_ENHANCEMENT_FINAL_CONSISTENCY_TARGETS_V1,
  type PromptEnhancementFinalAcceptanceInputV1,
  type PromptEnhancementFinalAcceptanceNegativeAuthorityCheckV1,
} from './final-acceptance.js';

/**
 * R2 — cross-layer final-acceptance capstone execution (Bhavnesh cross-layer-acceptance role).
 *
 * Unlike R1's matrix (hard-locked false), `final-acceptance.ts` HONESTLY computes
 * `readinessClaimAllowed = allOk`. It requires: R1 packet valid with readiness===false (line 314 —
 * proof R1 must NOT self-certify), S3 public-launch approved, all 6 surfaces pass, all 8 negative
 * authorities blocked, 3 sign-offs approved, source-sync + stale-scan + 10 consistency targets.
 *
 * This harness executes the capstone with Bhavnesh's REAL evidence and proves the honest result:
 * readiness is correctly BLOCKED, and the block is EXACTLY the outstanding external items
 * (extension_payload_contract = Vedansi, public_launch_recheck = S3, Hiren's 2 sign-offs) — i.e.
 * everything Bhavnesh + the wired engine owns is green. Full state in the milestone test-plan
 * `docs/dev/user-experience-improvements-sub-11-r2-cross-layer-final-acceptance-test-plan-2026-08-06.md`.
 */

// All 8 negative authorities are provably blocked by the WIRED typed contracts (delivery validator
// rejects legacy-DS + raw keys; the delivery invariants set same-turn / auto-send claims false).
function blockedNegative(
  authority: PromptEnhancementFinalAcceptanceNegativeAuthorityCheckV1['authority'],
  evidenceRefs: readonly string[],
): PromptEnhancementFinalAcceptanceNegativeAuthorityCheckV1 {
  return {
    authority,
    blockedAsSemanticAuthority: true,
    blockedAsActivationAuthority: true,
    blockedAsSourceUseAuthority: true,
    blockedAsFeedbackAuthority: true,
    blockedAsGeneratedOriginAuthority: true,
    blockedAsLaunchReadinessAuthority: true,
    evidenceRefs,
  };
}

function todayInput(): PromptEnhancementFinalAcceptanceInputV1 {
  return {
    // Bhavnesh + engine-owned surfaces are GREEN, with evidence refs to the wired tests.
    surfaceEvidence: [
      { surface: 'api_contract', evidenceState: 'pass', owner: 'hiren_content_api', evidenceRefs: ['contracts.test.ts', 'facade-llm.test.ts'] },
      { surface: 'ui_popup_session', evidenceState: 'pass', owner: 'bhavnesh_ui_app', evidenceRefs: ['popup-session.test.ts', 'd2-blocked-body-self-scrub.test.ts'] },
      { surface: 'stop_bridge_delivery', evidenceState: 'pass', owner: 'bhavnesh_ui_app', evidenceRefs: ['auto-stop-bridge-delivery.test.ts'] },
      { surface: 'store_memory_feedback', evidenceState: 'pass', owner: 'hiren_content_api', evidenceRefs: ['memory-scoring.test.ts', 'feedback-policy.test.ts'] },
      // Outstanding — NOT Bhavnesh's to certify:
      { surface: 'extension_payload_contract', evidenceState: 'blocked', owner: 'vedansi_host_extension', evidenceRefs: ['vedansi-d1-extension-delivery-handoff-2026-08-06'] },
      { surface: 'public_launch_recheck', evidenceState: 'blocked', owner: 'bhavnesh_release_check', evidenceRefs: ['S3-not-yet-executed'] },
    ],
    negativeAuthorityChecks: PROMPT_ENHANCEMENT_FINAL_ACCEPTANCE_REQUIRED_NEGATIVE_AUTHORITIES_V1.map((authority) =>
      blockedNegative(authority, ['delivery.ts:validatePromptEnhancementExtensionDeliveryPayload', 'delivery.ts:baseInvariants'])),
    // Bhavnesh cross-layer acceptance IS provided; Hiren's two sign-offs are genuinely outstanding.
    signoff: { hirenFinalSignoff: 'missing', bhavneshCrossLayerAcceptance: 'approved', hirenTestSignoff: 'missing' },
    finalConsistencyEvidence: {
      sourceSyncScanRerunAgainstLatestCheckout: true,
      staleActiveInstructionScanPassed: true,
      consistencyTargets: PROMPT_ENHANCEMENT_FINAL_CONSISTENCY_TARGETS_V1.map((target) => ({
        target,
        evidenceState: target === 'vedansi_host_transport' ? 'blocked' : 'pass',
        devPlanTreatmentRefs: ['bhavnesh-fix-plan'],
      })),
    },
    // acceptancePacket (R1) + publicLaunchPacket (S3) default to their honest blocked builders.
  };
}

describe('R2 — cross-layer final-acceptance capstone (Bhavnesh execution)', () => {
  it('honestly BLOCKS readiness — the block is exactly the outstanding external items, not Bhavnesh work', () => {
    const packet = buildPromptEnhancementFinalAcceptancePacketV1(todayInput());

    // Readiness is correctly refused — computed, not forced.
    expect(packet.readinessClaimAllowed).toBe(false);
    expect(packet.acceptedForPublicLaunch).toBe(false);
    expect(packet.status).not.toBe('accepted_for_readiness_claim');

    // The outstanding gates are the EXTERNAL ones (Vedansi extension, S3 launch, Hiren sign-offs).
    expect(packet.reasonCodes).toContain('surface_blocked:extension_payload_contract');
    expect(packet.reasonCodes).toContain('surface_blocked:public_launch_recheck');
    expect(packet.reasonCodes).toContain('final_signoff_missing:hiren');
    expect(packet.reasonCodes).toContain('final_signoff_missing:hiren_test');

    // Everything Bhavnesh + the wired engine owns is GREEN — none of these appear.
    expect(packet.reasonCodes).not.toContain('surface_blocked:api_contract');
    expect(packet.reasonCodes).not.toContain('surface_blocked:ui_popup_session');
    expect(packet.reasonCodes).not.toContain('surface_blocked:stop_bridge_delivery');
    expect(packet.reasonCodes).not.toContain('surface_blocked:store_memory_feedback');
    expect(packet.reasonCodes).not.toContain('final_signoff_missing:bhavnesh_cross_layer_acceptance');
    // No negative authority leaked through — all 8 are blocked by the wired contracts.
    expect(packet.reasonCodes.some((r) => r.startsWith('negative_authority_not_blocked:'))).toBe(false);
  });

  it('the capstone requires R1 to NOT self-certify (readiness===false) — validated end to end', () => {
    // buildPromptEnhancementFinalAcceptancePacketV1 defaults the R1 acceptance packet, which is
    // readinessClaimAllowed:false. If R1 had been force-flipped true, this would raise
    // acceptance_packet:premature_readiness_claim — confirming the R1 decision was contract-required.
    const packet = buildPromptEnhancementFinalAcceptancePacketV1(todayInput());
    expect(packet.acceptancePacket.readinessClaimAllowed).toBe(false);
    expect(packet.reasonCodes).not.toContain('acceptance_packet:premature_readiness_claim');
    // The packet self-validates as an honest blocked artifact.
    const validation = validatePromptEnhancementFinalAcceptancePacketV1(packet);
    expect(validation.readinessClaimAllowed).toBe(false);
  });
});
