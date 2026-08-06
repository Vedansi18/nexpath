export const PROMPT_ENHANCEMENT_B5_1A_H1_REQUIRED_DEPENDENCIES_V1 = [
  'DEP-B5-01',
  'DEP-B5-02',
  'DEP-TEST-01',
] as const;

export type PromptEnhancementB5_1aH1FixtureGroupV1 =
  | 'shared_gate_integration'
  | 'no_popup_closed_disposition'
  | 'popup_authority'
  | 'legacy_regression';

export type PromptEnhancementB5_1aH1ObservedOutcomeV1 =
  | 'not_run_pending_approved_inputs'
  | 'pass'
  | 'hard_fail';

export interface PromptEnhancementB5_1aH1BaselineV1 {
  command: string;
  files: readonly string[];
  observedFileCount: 4;
  observedTestCount: 157;
  observedOutcome: 'pass';
  legacyEvidenceOnly: true;
  provesPromptEnhancementDelivery: false;
}

export interface PromptEnhancementB5_1aH1FixtureRowV1 {
  fixtureGroup: PromptEnhancementB5_1aH1FixtureGroupV1;
  localTestRefs: readonly string[];
  approvedFixtureIds: readonly string[];
  contractRevision: string | null;
  expectedSink: string;
  forbiddenEffects: readonly string[];
  oracleOwner: 'content_semantics' | 'ui_app' | 'host_transport' | 'cross_layer_acceptance';
  exactCommand: string;
  environment: string;
  observedOutcome: PromptEnhancementB5_1aH1ObservedOutcomeV1;
  passFail: 'blocked_pending_approved_inputs' | 'pass' | 'hard_fail';
}

export interface PromptEnhancementB5_1aH1RegressionMapPacketV1 {
  packetId: 'regression-acceptance-map-v1';
  status: 'acceptance_blocked_pending_approved_inputs' | 'ready_for_execution';
  readinessClaimAllowed: false;
  requiredDependencies: typeof PROMPT_ENHANCEMENT_B5_1A_H1_REQUIRED_DEPENDENCIES_V1;
  baseline: PromptEnhancementB5_1aH1BaselineV1;
  rows: readonly PromptEnhancementB5_1aH1FixtureRowV1[];
  baselineSeparatedFromPeAcceptance: true;
  classifierAndSharedGateUnchanged: true;
  noHostOrLegacyAuthority: true;
  reasonCodes: readonly string[];
}

const BASELINE_COMMAND = 'npx vitest run src/cli/commands/auto.test.ts src/cli/commands/auto-hook-payload.test.ts src/cli/commands/auto-resolver.test.ts src/cli/commands/windsurf-hook.test.ts';
const FOCUSED_COMMAND = 'npx vitest run src/cli/commands/auto.test.ts -t "stage-5-1a-H1"';

const ROWS: readonly PromptEnhancementB5_1aH1FixtureRowV1[] = [
  {
    fixtureGroup: 'shared_gate_integration',
    localTestRefs: [
      'auto.test.ts::calls the injected facade once for one eligible shared trigger',
      'auto.test.ts::keeps the PE facade at zero calls across representative shared early gates',
    ],
    approvedFixtureIds: [],
    contractRevision: null,
    expectedSink: 'PE preparation call occurs only after existing runAuto gates pass; blocked gates produce no facade call.',
    forbiddenEffects: ['new_pe_classifier', 'second_shared_gate', 'changed_gate_meaning'],
    oracleOwner: 'cross_layer_acceptance',
    exactCommand: FOCUSED_COMMAND,
    environment: 'NO_COLOR=1; approved H1 contract/source revision pending',
    observedOutcome: 'not_run_pending_approved_inputs',
    passFail: 'blocked_pending_approved_inputs',
  },
  {
    fixtureGroup: 'no_popup_closed_disposition',
    localTestRefs: [
      'auto.test.ts::passes validated current, original-fallback, and no-popup dispositions without inventing UI authority',
    ],
    approvedFixtureIds: [],
    contractRevision: null,
    expectedSink: 'Only supplied typed no-popup, fallback, or blocked state is consumed; no body, send, delivery, or sequence effect.',
    forbiddenEffects: ['inferred_body', 'automatic_send', 'delivery_claim', 'sequence_activation'],
    oracleOwner: 'content_semantics',
    exactCommand: FOCUSED_COMMAND,
    environment: 'NO_COLOR=1; approved H1 contract/source revision pending',
    observedOutcome: 'not_run_pending_approved_inputs',
    passFail: 'blocked_pending_approved_inputs',
  },
  {
    fixtureGroup: 'popup_authority',
    localTestRefs: [
      'facade.test.ts::returns show_current_body only for a valid typed result',
      'ui-boundary.test.ts::typed show_current_body creates the render boundary',
      'contracts.test.ts::rejects old Decision Session option-list payloads as PE API authority',
    ],
    approvedFixtureIds: [],
    contractRevision: null,
    expectedSink: 'Only typed show_current_body authorizes editable enhancement-body rendering.',
    forbiddenEffects: ['legacy_decision_session_authority', 'feedback_authority', 'history_authority', 'raw_transport_authority', 'clipboard_authority', 'missing_origin_authority'],
    oracleOwner: 'ui_app',
    exactCommand: FOCUSED_COMMAND,
    environment: 'NO_COLOR=1; approved H1 contract/source revision pending',
    observedOutcome: 'not_run_pending_approved_inputs',
    passFail: 'blocked_pending_approved_inputs',
  },
  {
    fixtureGroup: 'legacy_regression',
    localTestRefs: [
      'auto.test.ts::runAuto — no_action paths',
      'auto-hook-payload.test.ts',
      'auto-resolver.test.ts',
      'windsurf-hook.test.ts',
    ],
    approvedFixtureIds: [],
    contractRevision: null,
    expectedSink: 'Existing Decision Session, product-feedback, classifier, and hook behavior remains unchanged.',
    forbiddenEffects: ['legacy_behavior_rewrite', 'ownership_transfer', 'public_launch_claim'],
    oracleOwner: 'cross_layer_acceptance',
    exactCommand: BASELINE_COMMAND,
    environment: 'NO_COLOR=1',
    observedOutcome: 'pass',
    passFail: 'pass',
  },
];

export function buildPromptEnhancementB5_1aH1RegressionMapV1(): PromptEnhancementB5_1aH1RegressionMapPacketV1 {
  return {
    packetId: 'regression-acceptance-map-v1',
    status: 'acceptance_blocked_pending_approved_inputs',
    readinessClaimAllowed: false,
    requiredDependencies: PROMPT_ENHANCEMENT_B5_1A_H1_REQUIRED_DEPENDENCIES_V1,
    baseline: {
      command: BASELINE_COMMAND,
      files: [
        'src/cli/commands/auto.test.ts',
        'src/cli/commands/auto-hook-payload.test.ts',
        'src/cli/commands/auto-resolver.test.ts',
        'src/cli/commands/windsurf-hook.test.ts',
      ],
      observedFileCount: 4,
      observedTestCount: 157,
      observedOutcome: 'pass',
      legacyEvidenceOnly: true,
      provesPromptEnhancementDelivery: false,
    },
    rows: ROWS,
    baselineSeparatedFromPeAcceptance: true,
    classifierAndSharedGateUnchanged: true,
    noHostOrLegacyAuthority: true,
    reasonCodes: ['approved_h1_contract_revision_missing', 'approved_fixture_ids_missing', 'pe_acceptance_not_claimed'],
  };
}
