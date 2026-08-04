import type { PromptEnhancementOwnerArea } from './contracts.js';

export type PromptEnhancementB4FixtureGroupV1 =
  | 'state_mapping'
  | 'safe_fallback'
  | 'legacy_isolation'
  | 'privacy_boundary';

export interface PromptEnhancementB4FixtureRowV1 {
  rowId: string;
  group: PromptEnhancementB4FixtureGroupV1;
  owner: 'bhavnesh_ui_app';
  requiredExternalDependencies: readonly ['DEP-B4-01', 'DEP-TEST-01'];
  approvedFixtureId: string | null;
  contractRevision: string | null;
  expectedVisibleOutcomes: readonly string[];
  negativeOracle: string;
  focusedCommand: string;
  observedOutcome: 'not_run_pending_external_inputs';
  oracleOwner: PromptEnhancementOwnerArea | 'external_owner_not_supplied';
  passFail: 'blocked_pending_external_inputs';
  closureDecision: 'blocked_pending_external_inputs';
}

export interface PromptEnhancementB4FixturePacketV1 {
  packetId: 'b4-bhavnesh-config-fixture-packet-v1';
  status: 'blocked_pending_external_inputs';
  readinessClaimAllowed: false;
  requiredExternalInputs: readonly ['DEP-B4-01', 'DEP-TEST-01'];
  rows: readonly PromptEnhancementB4FixtureRowV1[];
  focusedCommand: 'npx vitest run src/prompt-enhancement/b4-fixture-packet.test.ts';
  evidenceRule: 'render_and_public_boundary_assertions_only';
  forbiddenEvidence: readonly [
    'hiren_config_validation_or_defaults',
    'provider_or_policy_authority',
    'old_decision_session_settings',
    'raw_config_or_private_paths',
    'launch_or_readiness_claim',
  ];
}

export interface PromptEnhancementB4FixturePacketValidationV1 {
  ok: boolean;
  status: 'blocked_pending_external_inputs';
  readinessClaimAllowed: false;
  reasonCodes: readonly string[];
}

const REQUIRED_GROUPS: readonly PromptEnhancementB4FixtureGroupV1[] = [
  'state_mapping',
  'safe_fallback',
  'legacy_isolation',
  'privacy_boundary',
];

const REQUIRED_DEPENDENCIES: readonly ['DEP-B4-01', 'DEP-TEST-01'] = [
  'DEP-B4-01',
  'DEP-TEST-01',
];

const FOCUSED_COMMAND = 'npx vitest run src/prompt-enhancement/b4-fixture-packet.test.ts';

export function buildPromptEnhancementB4FixturePacketV1(): PromptEnhancementB4FixturePacketV1 {
  return {
    packetId: 'b4-bhavnesh-config-fixture-packet-v1',
    status: 'blocked_pending_external_inputs',
    readinessClaimAllowed: false,
    requiredExternalInputs: [...REQUIRED_DEPENDENCIES],
    rows: [
      {
        rowId: 'b4-state-mapping', group: 'state_mapping', owner: 'bhavnesh_ui_app',
        requiredExternalDependencies: [...REQUIRED_DEPENDENCIES], approvedFixtureId: null, contractRevision: null,
        expectedVisibleOutcomes: ['enabled, disabled, unavailable, unsupported, policy-disabled, and fallback remain distinct and non-interactive'],
        negativeOracle: 'UI cannot invent a state, default, action, or availability from local labels or host state',
        focusedCommand: FOCUSED_COMMAND, observedOutcome: 'not_run_pending_external_inputs', oracleOwner: 'external_owner_not_supplied',
        passFail: 'blocked_pending_external_inputs', closureDecision: 'blocked_pending_external_inputs',
      },
      {
        rowId: 'b4-safe-fallback', group: 'safe_fallback', owner: 'bhavnesh_ui_app',
        requiredExternalDependencies: [...REQUIRED_DEPENDENCIES], approvedFixtureId: null, contractRevision: null,
        expectedVisibleOutcomes: ['missing, malformed, invalid, unknown, stale, provider-unavailable, and outside-V1 states show approved safe unavailable/fallback copy'],
        negativeOracle: 'invalid or stale input cannot enable PE or expose a substitute control',
        focusedCommand: FOCUSED_COMMAND, observedOutcome: 'not_run_pending_external_inputs', oracleOwner: 'external_owner_not_supplied',
        passFail: 'blocked_pending_external_inputs', closureDecision: 'blocked_pending_external_inputs',
      },
      {
        rowId: 'b4-legacy-isolation', group: 'legacy_isolation', owner: 'bhavnesh_ui_app',
        requiredExternalDependencies: [...REQUIRED_DEPENDENCIES], approvedFixtureId: null, contractRevision: null,
        expectedVisibleOutcomes: ['Prompt Enhancement presentation remains independent from old Decision Session settings and chooser labels'],
        negativeOracle: 'old role, advisory, frequency, history, or chooser values cannot control PE configuration display',
        focusedCommand: FOCUSED_COMMAND, observedOutcome: 'not_run_pending_external_inputs', oracleOwner: 'external_owner_not_supplied',
        passFail: 'blocked_pending_external_inputs', closureDecision: 'blocked_pending_external_inputs',
      },
      {
        rowId: 'b4-privacy-boundary', group: 'privacy_boundary', owner: 'bhavnesh_ui_app',
        requiredExternalDependencies: [...REQUIRED_DEPENDENCIES], approvedFixtureId: null, contractRevision: null,
        expectedVisibleOutcomes: ['public-safe labels and diagnostics exclude raw config, private paths, storage details, provider errors, and planning terms'],
        negativeOracle: 'raw config or internal/provider detail cannot enter the rendered model or diagnostics',
        focusedCommand: FOCUSED_COMMAND, observedOutcome: 'not_run_pending_external_inputs', oracleOwner: 'external_owner_not_supplied',
        passFail: 'blocked_pending_external_inputs', closureDecision: 'blocked_pending_external_inputs',
      },
    ],
    focusedCommand: FOCUSED_COMMAND,
    evidenceRule: 'render_and_public_boundary_assertions_only',
    forbiddenEvidence: ['hiren_config_validation_or_defaults', 'provider_or_policy_authority', 'old_decision_session_settings', 'raw_config_or_private_paths', 'launch_or_readiness_claim'],
  };
}

export function validatePromptEnhancementB4FixturePacketV1(
  packet: PromptEnhancementB4FixturePacketV1,
): PromptEnhancementB4FixturePacketValidationV1 {
  const reasonCodes: string[] = [];
  if (packet.packetId !== 'b4-bhavnesh-config-fixture-packet-v1') reasonCodes.push('packet_id_mismatch');
  if (packet.status !== 'blocked_pending_external_inputs') reasonCodes.push('external_inputs_not_supplied');
  if (packet.readinessClaimAllowed !== false) reasonCodes.push('readiness_claim_must_remain_false');
  if (packet.rows.length !== REQUIRED_GROUPS.length) reasonCodes.push('fixture_group_count_mismatch');
  const groups = new Set(packet.rows.map((row) => row.group));
  for (const group of REQUIRED_GROUPS) if (!groups.has(group)) reasonCodes.push(`missing_fixture_group:${group}`);
  for (const row of packet.rows) {
    if (row.owner !== 'bhavnesh_ui_app') reasonCodes.push(`owner_mismatch:${row.rowId}`);
    if (row.approvedFixtureId !== null) reasonCodes.push(`unapproved_fixture_claim:${row.rowId}`);
    if (row.contractRevision !== null) reasonCodes.push(`unapproved_contract_claim:${row.rowId}`);
    if (row.requiredExternalDependencies.length !== REQUIRED_DEPENDENCIES.length) reasonCodes.push(`dependency_refs_incomplete:${row.rowId}`);
    for (const dependency of REQUIRED_DEPENDENCIES) if (!row.requiredExternalDependencies.includes(dependency)) reasonCodes.push(`missing_dependency:${row.rowId}:${dependency}`);
    if (row.expectedVisibleOutcomes.length === 0) reasonCodes.push(`missing_visible_oracle:${row.rowId}`);
    if (row.negativeOracle.length === 0) reasonCodes.push(`missing_negative_oracle:${row.rowId}`);
    if (row.observedOutcome !== 'not_run_pending_external_inputs') reasonCodes.push(`observed_result_claimed:${row.rowId}`);
    if (row.passFail !== 'blocked_pending_external_inputs') reasonCodes.push(`pass_fail_claimed:${row.rowId}`);
    if (row.closureDecision !== 'blocked_pending_external_inputs') reasonCodes.push(`closure_claimed:${row.rowId}`);
  }
  return { ok: reasonCodes.length === 0, status: packet.status, readinessClaimAllowed: false, reasonCodes };
}

