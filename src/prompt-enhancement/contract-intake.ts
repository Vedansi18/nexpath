export type PromptEnhancementB3ContractEvidenceKindV1 =
  | 'mps_handoff'
  | 'host_runtime'
  | 'approved_b3_fixtures'
  | 'privacy_feedback_contract';

export type PromptEnhancementB3ContractEvidenceStateV1 =
  | 'supplied'
  | 'missing'
  | 'unknown'
  | 'stale'
  | 'contradictory';

export interface PromptEnhancementB3ContractEvidenceV1 {
  evidenceId: string;
  kind: PromptEnhancementB3ContractEvidenceKindV1;
  owner: 'engine_contract' | 'host_transport' | 'test_owner' | 'privacy_feedback';
  state: PromptEnhancementB3ContractEvidenceStateV1;
  contractRevision?: string;
  sourceRefs?: readonly string[];
  fixtureIds?: readonly string[];
}

export interface PromptEnhancementB3ContractIntakeInputV1 {
  evidence?: readonly PromptEnhancementB3ContractEvidenceV1[];
}

export interface PromptEnhancementB3ContractIntakePacketV1 {
  packetId: 'mps-contract-intake-v1';
  status: 'blocked_pending_external_evidence' | 'ready_for_review';
  readinessClaimAllowed: false;
  readyForPhaseWideClosure: boolean;
  evidence: readonly PromptEnhancementB3ContractEvidenceV1[];
  missingEvidenceKinds: readonly PromptEnhancementB3ContractEvidenceKindV1[];
  reasonCodes: readonly string[];
  authority: {
    createsRuntime: false;
    createsTransport: false;
    createsTerminality: false;
    createsFeedbackDecision: false;
  };
}

const REQUIRED_EVIDENCE: readonly {
  kind: PromptEnhancementB3ContractEvidenceKindV1;
  evidenceId: string;
  owner: PromptEnhancementB3ContractEvidenceV1['owner'];
}[] = [
  { kind: 'mps_handoff', evidenceId: 'DEP-B3-01', owner: 'engine_contract' },
  { kind: 'host_runtime', evidenceId: 'DEP-B3-02', owner: 'host_transport' },
  { kind: 'approved_b3_fixtures', evidenceId: 'DEP-TEST-01', owner: 'test_owner' },
  { kind: 'privacy_feedback_contract', evidenceId: 'PE-B3-PRIVACY-FEEDBACK', owner: 'privacy_feedback' },
];

export function buildPromptEnhancementB3ContractIntakePacketV1(
  input: PromptEnhancementB3ContractIntakeInputV1 = {},
): PromptEnhancementB3ContractIntakePacketV1 {
  const supplied = input.evidence ?? [];
  const evidence = REQUIRED_EVIDENCE.map((required) => supplied.find((row) => row.kind === required.kind) ?? {
    evidenceId: required.evidenceId,
    kind: required.kind,
    owner: required.owner,
    state: 'missing' as const,
  });
  const reasonCodes: string[] = [];
  const missingEvidenceKinds: PromptEnhancementB3ContractEvidenceKindV1[] = [];
  for (const row of evidence) {
    if (row.state !== 'supplied') {
      missingEvidenceKinds.push(row.kind);
      reasonCodes.push(`evidence_${row.state}:${row.kind}`);
      continue;
    }
    if (!row.contractRevision || row.contractRevision.trim().length === 0) reasonCodes.push(`missing_revision:${row.kind}`);
    if (!row.sourceRefs || row.sourceRefs.length === 0) reasonCodes.push(`missing_source_refs:${row.kind}`);
    if (row.kind === 'approved_b3_fixtures' && (!row.fixtureIds || row.fixtureIds.length === 0)) {
      reasonCodes.push('missing_fixture_ids:approved_b3_fixtures');
    }
  }
  const readyForPhaseWideClosure = reasonCodes.length === 0 && missingEvidenceKinds.length === 0;
  return {
    packetId: 'mps-contract-intake-v1',
    status: readyForPhaseWideClosure ? 'ready_for_review' : 'blocked_pending_external_evidence',
    readinessClaimAllowed: false,
    readyForPhaseWideClosure,
    evidence,
    missingEvidenceKinds,
    reasonCodes,
    authority: {
      createsRuntime: false,
      createsTransport: false,
      createsTerminality: false,
      createsFeedbackDecision: false,
    },
  };
}
