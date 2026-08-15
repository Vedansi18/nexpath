import { describe, expect, it } from 'vitest';
import { buildFutureSequenceRuntimeGateEvidenceV1 } from './future-sequence-runtime-gate-evidence.js';
import { evaluatePromptEnhancementFutureSequenceRuntimeGateV1 } from './future-sequence-runtime-gate.js';
import { PROMPT_ENHANCEMENT_CONTRACT_VERSION } from './contracts.js';

const okClient = () => ({});                       // constructs → provider available
const failClient = () => { throw new Error('no key'); }; // throws → provider unavailable

function gate(evidence: ReturnType<typeof buildFutureSequenceRuntimeGateEvidenceV1>) {
  return evaluatePromptEnhancementFutureSequenceRuntimeGateV1({
    schemaVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
    operation: 'continue_current_item',
    requestId: 'r-1',
    projectRoot: '/tmp/p6',
    evidence,
  });
}

describe('buildFutureSequenceRuntimeGateEvidenceV1 — MPS shell P6 (evidence reader)', () => {
  it('supplies the ten real flags and leaves flag 11 FALSE by default', () => {
    const e = buildFutureSequenceRuntimeGateEvidenceV1({ constructProviderClient: okClient });
    // The seven relayed owner approvals + the built runtime source.
    expect(e.lifecyclePolicyApproved).toBe(true);
    expect(e.engineReceiverContractApproved).toBe(true);
    expect(e.costNumericAcceptanceApproved).toBe(true);
    expect(e.crossLayerOwnerSnapshotApproved).toBe(true);
    expect(e.signedOwnerByDeliverableRegisterApproved).toBe(true);
    expect(e.privacyStoragePolicyApproved).toBe(true);
    expect(e.pendingNamedOwnerRegisterRowsClosed).toBe(true);
    expect(e.futureSequenceRuntimeSourceAvailable).toBe(true);
    // The two real proofs.
    expect(e.hostHoldCommitContractProven).toBe(true);
    expect(e.providerApiAvailabilityProven).toBe(true);
    // ⛔ Flag 11 is NOT derived — default false.
    expect(e.focusedRuntimeFixturesPassed).toBe(false);
  });

  it('sets flag 11 true ONLY when the owner acceptance-oracle sign-off is recorded', () => {
    const e = buildFutureSequenceRuntimeGateEvidenceV1({ constructProviderClient: okClient, ownerAcceptanceOracleSignoffRecorded: true });
    expect(e.focusedRuntimeFixturesPassed).toBe(true);
  });

  it('reports the provider unavailable when the client cannot be constructed', () => {
    const e = buildFutureSequenceRuntimeGateEvidenceV1({ constructProviderClient: failClient });
    expect(e.providerApiAvailabilityProven).toBe(false);
  });

  it('default output keeps the gate BLOCKED, with flag 11 as the SOLE missing code', () => {
    const result = gate(buildFutureSequenceRuntimeGateEvidenceV1({ constructProviderClient: okClient }));
    expect(result.allowed).toBe(false);
    // The ten real flags are satisfied; only the acceptance-oracle flag is missing.
    expect(result.missingGateCodes).toEqual(['focused_runtime_fixtures_pending']);
  });

  it('once the owner signs off, the SAME reader output opens the gate (no other change)', () => {
    const result = gate(buildFutureSequenceRuntimeGateEvidenceV1({ constructProviderClient: okClient, ownerAcceptanceOracleSignoffRecorded: true }));
    expect(result.allowed).toBe(true);
    expect(result.missingGateCodes).toEqual([]);
  });

  it('a missing provider key keeps the gate blocked even WITH the oracle sign-off (fail-closed on real reads)', () => {
    const result = gate(buildFutureSequenceRuntimeGateEvidenceV1({ constructProviderClient: failClient, ownerAcceptanceOracleSignoffRecorded: true }));
    expect(result.allowed).toBe(false);
    expect(result.missingGateCodes).toContain('provider_api_availability_pending');
  });
});
