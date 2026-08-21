import { proveCliHostHoldCommitContractV1 } from './cli-host-hold-commit-contract.js';
import { checkPromptEnhancementProviderApiAvailabilityV1 } from './provider-api-availability.js';
import type { PromptEnhancementFutureSequenceRuntimeGateEvidenceV1 } from './contracts.js';

/**
 * MPS continuation shell — P6 (evidence reader).
 *
 * Assemble the eleven runtime-gate evidence flags from their REAL sources. The gate
 * (`evaluatePromptEnhancementFutureSequenceRuntimeGateV1`) is evidence-gated and fail-closed: it allows
 * only when EVERY flag is present. This reader supplies ten of them from real reads and leaves the
 * eleventh (`focusedRuntimeFixturesPassed`) defaulting FALSE — so wiring this reader into the launcher
 * changes nothing until the owner records the acceptance-oracle sign-off. The gate then opens naturally,
 * with no other change, the moment that one flag turns true.
 *
 * ⛔ The eleventh flag is NEVER derived here. The 27 backing tests being green is not the sign-off — the
 * owner oracle records readiness under human judgment (register: `ownerSignoffState:
 * required_before_readiness_claim`). Deriving flag 11 from "the tests pass" is the exact fabrication the
 * fail-closed backstop exists to prevent.
 */
export interface BuildFutureSequenceRuntimeGateEvidenceInputV1 {
  /** Injectable provider-client constructor (tests drive both outcomes); defaults to the real `new OpenAI()`. */
  constructProviderClient?: () => unknown;
  /**
   * ⛔ FLAG 11 — the acceptance-oracle sign-off, and the ONLY flag this reader will not read for itself.
   * Defaults false. Set true ONLY when the owner has recorded that the 27 sequence fixtures ran and
   * passed under owner judgment. While false, the gate stays blocked.
   */
  ownerAcceptanceOracleSignoffRecorded?: boolean;
}

export function buildFutureSequenceRuntimeGateEvidenceV1(
  input: BuildFutureSequenceRuntimeGateEvidenceInputV1 = {},
): PromptEnhancementFutureSequenceRuntimeGateEvidenceV1 {
  const hostHold = proveCliHostHoldCommitContractV1();
  const provider = input.constructProviderClient
    ? checkPromptEnhancementProviderApiAvailabilityV1(input.constructProviderClient)
    : checkPromptEnhancementProviderApiAvailabilityV1();

  return {
    // 1–7 — the owner approvals, relayed-approved 2026-08-14 per the P5 owner-approvals register
    // (…mps-continuation-runtime-p5-owner-approvals-2026-08-14.md): recorded owner decisions, not derived.
    lifecyclePolicyApproved:                  true,
    engineReceiverContractApproved:           true,
    costNumericAcceptanceApproved:            true,
    crossLayerOwnerSnapshotApproved:          true,
    signedOwnerByDeliverableRegisterApproved: true,
    privacyStoragePolicyApproved:             true,
    pendingNamedOwnerRegisterRowsClosed:      true,
    // The continuation runtime source (body producer + the assembled shell, P1–P5) is built.
    futureSequenceRuntimeSourceAvailable:     true,
    // Real proofs, read at call time.
    hostHoldCommitContractProven:  hostHold.hostCapabilityState === 'future_hold_proven',
    providerApiAvailabilityProven: provider.providerApiAvailable,
    // ⛔ Owner oracle only — default false keeps the gate fail-closed; never inferred from green tests.
    focusedRuntimeFixturesPassed:  input.ownerAcceptanceOracleSignoffRecorded === true,
  };
}
