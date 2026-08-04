import type { PromptEnhancementOwnerArea } from './contracts.js';

export type PromptEnhancementB2FixtureGroupV1 =
  | 'lifecycle'
  | 'explicit_intent'
  | 'cancel_recovery'
  | 'host_status_display'
  | 'regression_boundary';

export type PromptEnhancementB2FixturePacketStatusV1 =
  | 'blocked_pending_external_inputs'
  | 'ready_for_execution';

export interface PromptEnhancementB2FixtureRowV1 {
  rowId: string;
  group: PromptEnhancementB2FixtureGroupV1;
  phaseRefs: readonly ('B2.1' | 'B2.2' | 'B2.3' | 'B2.4')[];
  owner: 'bhavnesh_ui_app';
  requiredExternalDependencies: readonly ('DEP-B2-01' | 'DEP-B2-02' | 'DEP-TEST-01')[];
  approvedFixtureId: string | null;
  contractRevision: string | null;
  expectedVisibleOutcomes: readonly string[];
  expectedTypedEvents: readonly string[];
  negativeOracle: string;
  focusedCommand: string;
  observedOutcome: 'not_run_pending_external_inputs';
  oracleOwner: PromptEnhancementOwnerArea | 'external_owner_not_supplied';
  passFail: 'blocked_pending_external_inputs';
  closureDecision: 'blocked_pending_external_inputs';
}

export interface PromptEnhancementB2FixturePacketV1 {
  packetId: 'b2-bhavnesh-ui-fixture-packet-v1';
  status: PromptEnhancementB2FixturePacketStatusV1;
  readinessClaimAllowed: false;
  requiredExternalInputs: readonly [
    'DEP-B2-01',
    'DEP-B2-02',
    'DEP-TEST-01',
  ];
  rows: readonly PromptEnhancementB2FixtureRowV1[];
  focusedCommand: 'npx vitest run src/prompt-enhancement/b2-fixture-packet.test.ts';
  evidenceRule: 'render_and_typed_event_assertions_only';
  forbiddenEvidence: readonly [
    'vedansi_transport_success',
    'stop_bridge_internals',
    'hiren_semantic_validation',
    'old_decision_session',
    'raw_stop_reason',
    'clipboard_or_foreground',
  ];
}

export interface PromptEnhancementB2FixturePacketValidationV1 {
  ok: boolean;
  status: PromptEnhancementB2FixturePacketStatusV1;
  readinessClaimAllowed: false;
  reasonCodes: readonly string[];
}

const REQUIRED_GROUPS: readonly PromptEnhancementB2FixtureGroupV1[] = [
  'lifecycle',
  'explicit_intent',
  'cancel_recovery',
  'host_status_display',
  'regression_boundary',
];

const REQUIRED_DEPENDENCIES: readonly ('DEP-B2-01' | 'DEP-B2-02' | 'DEP-TEST-01')[] = [
  'DEP-B2-01',
  'DEP-B2-02',
  'DEP-TEST-01',
];

export function buildPromptEnhancementB2FixturePacketV1(): PromptEnhancementB2FixturePacketV1 {
  const dependencyRefs = [...REQUIRED_DEPENDENCIES] as readonly ('DEP-B2-01' | 'DEP-B2-02' | 'DEP-TEST-01')[];
  return {
    packetId: 'b2-bhavnesh-ui-fixture-packet-v1',
    status: 'blocked_pending_external_inputs',
    readinessClaimAllowed: false,
    requiredExternalInputs: ['DEP-B2-01', 'DEP-B2-02', 'DEP-TEST-01'],
    rows: [
      {
        rowId: 'b2-5-lifecycle', group: 'lifecycle', phaseRefs: ['B2.1'], owner: 'bhavnesh_ui_app',
        requiredExternalDependencies: dependencyRefs, approvedFixtureId: null, contractRevision: null,
        expectedVisibleOutcomes: ['typed eligible/open renders one popup', 'typed no-popup/deferred/stale/unavailable renders no interactive send surface'],
        expectedTypedEvents: ['render emits no send, feedback, cancel, or delivery event'],
        negativeOracle: 'legacy Decision Session, product feedback, or missing typed state cannot create PE authority',
        focusedCommand: 'npx vitest run src/prompt-enhancement/b2-fixture-packet.test.ts', observedOutcome: 'not_run_pending_external_inputs', oracleOwner: 'external_owner_not_supplied', passFail: 'blocked_pending_external_inputs', closureDecision: 'blocked_pending_external_inputs',
      },
      {
        rowId: 'b2-5-explicit-intent', group: 'explicit_intent', phaseRefs: ['B2.2'], owner: 'bhavnesh_ui_app',
        requiredExternalDependencies: dependencyRefs, approvedFixtureId: null, contractRevision: null,
        expectedVisibleOutcomes: ['current-body and original controls remain distinct and identity-bound'],
        expectedTypedEvents: ['current control emits exactly one typed current intent', 'original control emits exactly one typed original intent', 'render/focus/retry/adjustment emits no send intent'],
        negativeOracle: 'stale, duplicate, dirty-detail, or non-user event cannot produce delivery intent',
        focusedCommand: 'npx vitest run src/prompt-enhancement/b2-fixture-packet.test.ts', observedOutcome: 'not_run_pending_external_inputs', oracleOwner: 'external_owner_not_supplied', passFail: 'blocked_pending_external_inputs', closureDecision: 'blocked_pending_external_inputs',
      },
      {
        rowId: 'b2-5-cancel-recovery', group: 'cancel_recovery', phaseRefs: ['B2.3'], owner: 'bhavnesh_ui_app',
        requiredExternalDependencies: dependencyRefs, approvedFixtureId: null, contractRevision: null,
        expectedVisibleOutcomes: ['cancel/no-send, timeout, invalid/stale, unsupported, and failure show typed safe recovery'],
        expectedTypedEvents: ['no automatic send; only a fresh explicit typed fallback/cancel action may be presented'],
        negativeOracle: 'recovery state cannot silently convert into current/original delivery or transport',
        focusedCommand: 'npx vitest run src/prompt-enhancement/b2-fixture-packet.test.ts', observedOutcome: 'not_run_pending_external_inputs', oracleOwner: 'external_owner_not_supplied', passFail: 'blocked_pending_external_inputs', closureDecision: 'blocked_pending_external_inputs',
      },
      {
        rowId: 'b2-5-host-status', group: 'host_status_display', phaseRefs: ['B2.4'], owner: 'bhavnesh_ui_app',
        requiredExternalDependencies: dependencyRefs, approvedFixtureId: null, contractRevision: null,
        expectedVisibleOutcomes: ['inserted, copied, manual-paste, manual-submit, failed, unknown, unsupported, and waiting remain distinct'],
        expectedTypedEvents: ['display emits no transport, execution, consent, completion, or sequence event'],
        negativeOracle: 'platform, foreground, copy/paste, insertion, or transport attempt cannot become sent/execution proof',
        focusedCommand: 'npx vitest run src/prompt-enhancement/b2-fixture-packet.test.ts', observedOutcome: 'not_run_pending_external_inputs', oracleOwner: 'external_owner_not_supplied', passFail: 'blocked_pending_external_inputs', closureDecision: 'blocked_pending_external_inputs',
      },
      {
        rowId: 'b2-5-regression-boundary', group: 'regression_boundary', phaseRefs: ['B2.1', 'B2.2', 'B2.3', 'B2.4'], owner: 'bhavnesh_ui_app',
        requiredExternalDependencies: dependencyRefs, approvedFixtureId: null, contractRevision: null,
        expectedVisibleOutcomes: ['only the supplied typed PE state is rendered'],
        expectedTypedEvents: ['old Decision Session, raw Stop reason, selectedPrompt, clipboard/manual text, foreground, and transport attempt emit no PE authority'],
        negativeOracle: 'legacy/runtime/transport evidence cannot activate popup, send, delivery, feedback, or sequence progress',
        focusedCommand: 'npx vitest run src/prompt-enhancement/b2-fixture-packet.test.ts', observedOutcome: 'not_run_pending_external_inputs', oracleOwner: 'external_owner_not_supplied', passFail: 'blocked_pending_external_inputs', closureDecision: 'blocked_pending_external_inputs',
      },
    ],
    focusedCommand: 'npx vitest run src/prompt-enhancement/b2-fixture-packet.test.ts',
    evidenceRule: 'render_and_typed_event_assertions_only',
    forbiddenEvidence: ['vedansi_transport_success', 'stop_bridge_internals', 'hiren_semantic_validation', 'old_decision_session', 'raw_stop_reason', 'clipboard_or_foreground'],
  };
}

export function validatePromptEnhancementB2FixturePacketV1(
  packet: PromptEnhancementB2FixturePacketV1,
): PromptEnhancementB2FixturePacketValidationV1 {
  const reasonCodes: string[] = [];
  if (packet.packetId !== 'b2-bhavnesh-ui-fixture-packet-v1') reasonCodes.push('packet_id_mismatch');
  if (packet.readinessClaimAllowed !== false) reasonCodes.push('readiness_claim_must_remain_false');
  if (packet.status !== 'blocked_pending_external_inputs') reasonCodes.push('external_inputs_not_supplied');
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
    if (row.expectedTypedEvents.length === 0) reasonCodes.push(`missing_event_oracle:${row.rowId}`);
    if (row.negativeOracle.length === 0) reasonCodes.push(`missing_negative_oracle:${row.rowId}`);
    if (row.observedOutcome !== 'not_run_pending_external_inputs') reasonCodes.push(`observed_result_claimed:${row.rowId}`);
    if (row.passFail !== 'blocked_pending_external_inputs') reasonCodes.push(`pass_fail_claimed:${row.rowId}`);
    if (row.closureDecision !== 'blocked_pending_external_inputs') reasonCodes.push(`closure_claimed:${row.rowId}`);
  }
  return { ok: reasonCodes.length === 0, status: packet.status, readinessClaimAllowed: false, reasonCodes };
}
