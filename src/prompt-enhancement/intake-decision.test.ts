import { describe, expect, it } from 'vitest';
import { evaluatePromptEnhancementMpsIntakeDecisionV1 } from './intake-decision.js';
import type { PromptEnhancementB3ContractEvidenceV1 } from './contract-intake.js';

const completeEvidence: readonly PromptEnhancementB3ContractEvidenceV1[] = [
  { evidenceId: 'DEP-stage-3-01', kind: 'mps_handoff', owner: 'engine_contract', state: 'supplied', contractRevision: 'content-owner-mps-v1', sourceRefs: ['content-owner:handoff:v1'] },
  { evidenceId: 'DEP-stage-3-02', kind: 'host_runtime', owner: 'host_transport', state: 'supplied', contractRevision: 'host-runtime-v1', sourceRefs: ['host-owner:host:v1'] },
  { evidenceId: 'DEP-TEST-01', kind: 'approved_b3_fixtures', owner: 'test_owner', state: 'supplied', contractRevision: 'fixtures-v1', sourceRefs: ['test:dep-b3'], fixtureIds: ['DEP-TEST-01-B3'] },
  { evidenceId: 'PE-B3-PRIVACY-FEEDBACK', kind: 'privacy_feedback_contract', owner: 'privacy_feedback', state: 'supplied', contractRevision: 'privacy-feedback-v1', sourceRefs: ['content-owner:privacy:v1'] },
];

describe('UI-5 MPS typed-runtime intake decision (gate evaluation only)', () => {
  it('blocks fail-closed and renders nothing when no external evidence is supplied', () => {
    const decision = evaluatePromptEnhancementMpsIntakeDecisionV1();
    expect(decision.renderPermission).toBe('mps_blocked_fail_closed');
    expect(decision.intakePacket.status).toBe('blocked_pending_external_evidence');
    expect(decision.reasonCodes[0]).toBe('mps_render_blocked_pending_intake');
    expect(decision.reasonCodes).toContain('evidence_missing:mps_handoff');
  });

  it('permits render only when the consumed intake packet is ready-for-review', () => {
    const decision = evaluatePromptEnhancementMpsIntakeDecisionV1({ evidence: completeEvidence });
    expect(decision.intakePacket.status).toBe('ready_for_review');
    expect(decision.renderPermission).toBe('mps_render_permitted');
    expect(decision.reasonCodes).toEqual([]);
  });

  it('stays blocked when any consumed evidence row is stale or malformed', () => {
    const stale = evaluatePromptEnhancementMpsIntakeDecisionV1({
      evidence: completeEvidence.map((row) => row.kind === 'host_runtime' ? { ...row, state: 'stale' as const } : row),
    });
    expect(stale.renderPermission).toBe('mps_blocked_fail_closed');
    expect(stale.reasonCodes).toContain('evidence_stale:host_runtime');

    // A supplied-but-malformed row (fixtures with no fixtureIds) also blocks at the decision level.
    const malformed = evaluatePromptEnhancementMpsIntakeDecisionV1({
      evidence: completeEvidence.map((row) => row.kind === 'approved_b3_fixtures' ? { ...row, fixtureIds: [] } : row),
    });
    expect(malformed.renderPermission).toBe('mps_blocked_fail_closed');
    expect(malformed.reasonCodes).toContain('missing_fixture_ids:approved_b3_fixtures');
  });

  it('never invents runtime, pointer, Stop correlation, terminality, delivery, or host transport', () => {
    const decision = evaluatePromptEnhancementMpsIntakeDecisionV1({ evidence: completeEvidence });
    expect(decision.authority).toEqual({
      createsLocalQueue: false,
      createsPointer: false,
      createsStopCorrelation: false,
      createsTerminality: false,
      createsDelivery: false,
      createsHostTransport: false,
    });
  });
});
