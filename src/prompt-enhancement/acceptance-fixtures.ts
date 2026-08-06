import {
  buildPromptEnhancementTweakPresentationModelV1,
  type PromptEnhancementTweakPresentationModelV1,
} from './tweak-presentation.js';

export type PromptEnhancementB4AcceptanceFixtureKindV1 =
  | 'enabled'
  | 'disabled'
  | 'unavailable'
  | 'unsupported'
  | 'policy_disabled'
  | 'fallback'
  | 'malformed'
  | 'stale'
  | 'provider_api_unavailable'
  | 'outside_v1'
  | 'legacy_isolation';

export interface PromptEnhancementB4AcceptanceFixtureV1 {
  fixtureId: string;
  kind: PromptEnhancementB4AcceptanceFixtureKindV1;
  contract: unknown;
  freshness?: 'current' | 'stale' | 'unknown';
  expectedStatus: PromptEnhancementTweakPresentationModelV1['status'];
  expectedEvent: 'render_status_only';
  negativeOracle: string;
  oracleOwner: 'ui_app';
}

export interface PromptEnhancementB4AcceptanceObservationV1 {
  fixtureId: string;
  observedStatus: PromptEnhancementTweakPresentationModelV1['status'];
  observedEvent: 'render_status_only';
  interactive: false;
  action: null;
  leakageDetected: readonly string[];
  passFail: 'pass' | 'hard_fail';
}

export interface PromptEnhancementB4AcceptancePacketV1 {
  packetId: 'ui-owner-acceptance-fixtures-v1';
  contractRevision: 'pe-tweak-v1';
  status: 'local_source_backed';
  readinessClaimAllowed: false;
  focusedCommand: 'npx vitest run src/prompt-enhancement/acceptance-fixtures.test.ts';
  rows: readonly PromptEnhancementB4AcceptanceFixtureV1[];
}

const CONTRACT_REVISION = 'pe-tweak-v1' as const;

function typed(state: string, freshness = 'current', extras: Record<string, unknown> = {}) {
  return {
    state,
    freshness,
    contractRevision: CONTRACT_REVISION,
    arbitraryConfigRowsAreAuthority: false,
    legacyDecisionSessionConfigIsAuthority: false,
    ...extras,
  };
}

const ROWS: readonly PromptEnhancementB4AcceptanceFixtureV1[] = [
  row('LOCAL-stage-4-4-01', 'enabled', 'enabled', typed('enabled')),
  row('LOCAL-stage-4-4-02', 'disabled', 'disabled', typed('disabled')),
  row('LOCAL-stage-4-4-03', 'unavailable', 'unavailable', typed('unavailable')),
  row('LOCAL-stage-4-4-04', 'unsupported', 'unsupported', typed('unsupported')),
  row('LOCAL-stage-4-4-05', 'policy_disabled', 'policy_disabled', typed('policy_disabled')),
  row('LOCAL-stage-4-4-06', 'fallback', 'fallback', typed('fallback')),
  row('LOCAL-stage-4-4-07', 'malformed', 'unavailable', { state: 'unknown' }),
  row('LOCAL-stage-4-4-08', 'stale', 'fallback', typed('enabled', 'stale')),
  row('LOCAL-stage-4-4-09', 'provider_api_unavailable', 'unavailable', typed('unavailable', 'current', {
    providerApiAvailable: false,
    providerError: 'private-provider-error-must-not-render',
  })),
  row('LOCAL-stage-4-4-10', 'outside_v1', 'outside_v1', typed('outside_v1')),
  row('LOCAL-stage-4-4-11', 'legacy_isolation', 'enabled', typed('enabled', 'current', {
    decisionSessionRole: 'legacy-role-must-not-render',
    advisoryFrequency: 'legacy-frequency-must-not-render',
    promptHistory: 'legacy-history-must-not-render',
    selectedPrompt: 'legacy-selected-prompt-must-not-render',
    hostState: 'legacy-host-state-must-not-render',
    visibleLabel: 'legacy-label-must-not-render',
  })),
];

function row(
  fixtureId: string,
  kind: PromptEnhancementB4AcceptanceFixtureKindV1,
  expectedStatus: PromptEnhancementB4AcceptanceFixtureV1['expectedStatus'],
  contract: unknown,
  freshness?: PromptEnhancementB4AcceptanceFixtureV1['freshness'],
): PromptEnhancementB4AcceptanceFixtureV1 {
  return {
    fixtureId,
    kind,
    contract,
    freshness,
    expectedStatus,
    expectedEvent: 'render_status_only',
    negativeOracle: 'UI renders only typed state; no local config, provider, legacy, host, or label authority can alter it.',
    oracleOwner: 'ui_app',
  };
}

export function buildPromptEnhancementB4AcceptanceFixturePacketV1(): PromptEnhancementB4AcceptancePacketV1 {
  return {
    packetId: 'ui-owner-acceptance-fixtures-v1',
    contractRevision: CONTRACT_REVISION,
    status: 'local_source_backed',
    readinessClaimAllowed: false,
    focusedCommand: 'npx vitest run src/prompt-enhancement/acceptance-fixtures.test.ts',
    rows: ROWS,
  };
}

export function runPromptEnhancementB4AcceptanceFixtureV1(
  fixture: PromptEnhancementB4AcceptanceFixtureV1,
): PromptEnhancementB4AcceptanceObservationV1 {
  const model = buildPromptEnhancementTweakPresentationModelV1({ contract: fixture.contract, freshness: fixture.freshness });
  const rendered = JSON.stringify(model);
  const forbiddenValues = [
    '/home/',
    'prompt_enhancement.sequence.enabled',
    'private-provider-error-must-not-render',
    'legacy-role-must-not-render',
    'legacy-frequency-must-not-render',
    'legacy-history-must-not-render',
    'legacy-selected-prompt-must-not-render',
    'legacy-host-state-must-not-render',
    'legacy-label-must-not-render',
    'Decision Session',
  ];
  const leakageDetected = forbiddenValues.filter((value) => rendered.includes(value));
  const passFail = model.status === fixture.expectedStatus
    && model.interactive === false
    && model.action === null
    && leakageDetected.length === 0
    ? 'pass'
    : 'hard_fail';
  return {
    fixtureId: fixture.fixtureId,
    observedStatus: model.status,
    observedEvent: 'render_status_only',
    interactive: false,
    action: null,
    leakageDetected,
    passFail,
  };
}

