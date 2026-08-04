import { describe, expect, it } from 'vitest';
import {
  buildPromptEnhancementB3ContractIntakePacketV1,
  type PromptEnhancementB3ContractEvidenceV1,
} from './b3-contract-intake.js';

const completeEvidence: readonly PromptEnhancementB3ContractEvidenceV1[] = [
  { evidenceId: 'DEP-B3-01', kind: 'hiren_mps_handoff', owner: 'hiren_pe_contract', state: 'supplied', contractRevision: 'hiren-mps-v1', sourceRefs: ['hiren:handoff:v1'] },
  { evidenceId: 'DEP-B3-02', kind: 'vedansi_host_runtime', owner: 'vedansi_runtime', state: 'supplied', contractRevision: 'host-runtime-v1', sourceRefs: ['vedansi:host:v1'] },
  { evidenceId: 'DEP-TEST-01', kind: 'approved_b3_fixtures', owner: 'hiren_test_owner', state: 'supplied', contractRevision: 'fixtures-v1', sourceRefs: ['test:dep-b3'], fixtureIds: ['DEP-TEST-01-B3'] },
  { evidenceId: 'PE-B3-PRIVACY-FEEDBACK', kind: 'privacy_feedback_contract', owner: 'hiren_privacy_feedback', state: 'supplied', contractRevision: 'privacy-feedback-v1', sourceRefs: ['hiren:privacy:v1'] },
];

describe('B3.6 MPS contract intake gate', () => {
  it('fails closed when external evidence is absent and never claims readiness', () => {
    const packet = buildPromptEnhancementB3ContractIntakePacketV1();
    expect(packet.status).toBe('blocked_pending_external_evidence');
    expect(packet.readinessClaimAllowed).toBe(false);
    expect(packet.readyForPhaseWideClosure).toBe(false);
    expect(packet.missingEvidenceKinds).toHaveLength(4);
    expect(packet.authority).toEqual({ createsRuntime: false, createsTransport: false, createsTerminality: false, createsFeedbackDecision: false });
  });

  it('accepts complete typed evidence only as ready-for-review, never as automatic GO', () => {
    const packet = buildPromptEnhancementB3ContractIntakePacketV1({ evidence: completeEvidence });
    expect(packet.status).toBe('ready_for_review');
    expect(packet.readyForPhaseWideClosure).toBe(true);
    expect(packet.readinessClaimAllowed).toBe(false);
    expect(packet.reasonCodes).toEqual([]);
  });

  it('keeps stale/contradictory/malformed evidence blocked with explicit reasons', () => {
    const packet = buildPromptEnhancementB3ContractIntakePacketV1({ evidence: completeEvidence.map((row) => row.kind === 'vedansi_host_runtime'
      ? { ...row, state: 'stale' as const }
      : row.kind === 'approved_b3_fixtures'
        ? { ...row, fixtureIds: [] }
        : row) });
    expect(packet.status).toBe('blocked_pending_external_evidence');
    expect(packet.reasonCodes).toContain('evidence_stale:vedansi_host_runtime');
    expect(packet.reasonCodes).toContain('missing_fixture_ids:approved_b3_fixtures');
    expect(packet.readyForPhaseWideClosure).toBe(false);
  });
});
