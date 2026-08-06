export const PROMPT_ENHANCEMENT_B5_1_REQUIRED_DEPENDENCIES_V1 = [
  'DEP-B5-01',
  'DEP-B5-02',
  'DEP-TEST-01',
] as const;

export type PromptEnhancementB5EvidenceStateV1 = 'supplied' | 'missing' | 'unknown' | 'stale' | 'contradictory';

export type PromptEnhancementB5RegisterStatusV1 = 'blocked_pending_evidence' | 'ready_for_owner_review';

export interface PromptEnhancementB5EvidenceRowV1 {
  rowId: string;
  apiContractRef: string;
  uiSurfaceRef: string;
  stopExtensionRef: string;
  storeGeneratedOriginRef: string;
  launchAcceptanceRef: string;
  owner: 'content_semantics' | 'ui_app' | 'host_transport' | 'release_check' | 'cross_layer_acceptance';
  evidenceState: PromptEnhancementB5EvidenceStateV1;
  contractRevision: string | null;
  sourceRevision: string | null;
  fixtureIds: readonly string[];
  focusedCommand: string;
  expectedOutput: string;
  observedOutput: string | null;
  safeFallback: 'blocked_no_send' | 'no_popup_not_applicable' | 'fallback_to_original' | 'typed_state_only';
  unresolvedQuestion: string | null;
  evidenceDate: string | null;
  closureDecision: 'blocked_pending_owner_evidence' | 'ready_for_owner_review';
}

export interface PromptEnhancementB5EvidenceRegisterPacketV1 {
  packetId: 'b5-evidence-owner-register-v1';
  status: PromptEnhancementB5RegisterStatusV1;
  readinessClaimAllowed: false;
  requiredDependencies: typeof PROMPT_ENHANCEMENT_B5_1_REQUIRED_DEPENDENCIES_V1;
  rows: readonly PromptEnhancementB5EvidenceRowV1[];
  ownerBoundaries: {
    contentSemanticsStorePrivacyCost: 'external';
    hostTransport: 'external';
    testOracle: 'external';
    launchScope: 'external';
  };
  forbiddenAuthority: readonly ['inferred_pe_authority', 'locally_invented_oracle', 'raw_private_payload', 'go_claim'];
  reasonCodes: readonly string[];
}

const REQUIRED_ROW_IDS = [
  'b5-api-ui-stop-store-launch',
] as const;

function defaultRow(): PromptEnhancementB5EvidenceRowV1 {
  return {
    rowId: REQUIRED_ROW_IDS[0],
    apiContractRef: 'pending_DEP-B5-02_api_contract',
    uiSurfaceRef: 'pending_ui_consumer',
    stopExtensionRef: 'pending_DEP-B5-02_host_contract',
    storeGeneratedOriginRef: 'pending_DEP-B5-02_store_generated_origin',
    launchAcceptanceRef: 'pending_DEP-B5-01_launch_acceptance',
    owner: 'cross_layer_acceptance',
    evidenceState: 'missing',
    contractRevision: null,
    sourceRevision: null,
    fixtureIds: [],
    focusedCommand: 'npx vitest run src/prompt-enhancement/b5-evidence-register.test.ts',
    expectedOutput: 'All cross-layer evidence fields are supplied or remain explicitly blocked.',
    observedOutput: null,
    safeFallback: 'blocked_no_send',
    unresolvedQuestion: 'Await DEP-B5-01, DEP-B5-02, and DEP-TEST-01 owner evidence.',
    evidenceDate: null,
    closureDecision: 'blocked_pending_owner_evidence',
  };
}

export function buildPromptEnhancementB5EvidenceRegisterV1(
  rows: readonly PromptEnhancementB5EvidenceRowV1[] = [defaultRow()],
): PromptEnhancementB5EvidenceRegisterPacketV1 {
  const reasonCodes: string[] = [];
  const complete = rows.length === REQUIRED_ROW_IDS.length
    && rows.every((row) => row.evidenceState === 'supplied'
      && row.contractRevision !== null
      && row.sourceRevision !== null
      && row.fixtureIds.length > 0
      && row.observedOutput !== null
      && row.evidenceDate !== null
      && row.unresolvedQuestion === null
      && row.closureDecision === 'ready_for_owner_review');
  if (!complete) reasonCodes.push('cross_layer_evidence_incomplete_or_owner_blocked');

  return {
    packetId: 'b5-evidence-owner-register-v1',
    status: complete ? 'ready_for_owner_review' : 'blocked_pending_evidence',
    readinessClaimAllowed: false,
    requiredDependencies: PROMPT_ENHANCEMENT_B5_1_REQUIRED_DEPENDENCIES_V1,
    rows,
    ownerBoundaries: {
      contentSemanticsStorePrivacyCost: 'external',
      hostTransport: 'external',
      testOracle: 'external',
      launchScope: 'external',
    },
    forbiddenAuthority: ['inferred_pe_authority', 'locally_invented_oracle', 'raw_private_payload', 'go_claim'],
    reasonCodes,
  };
}
