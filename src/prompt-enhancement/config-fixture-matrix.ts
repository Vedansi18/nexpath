import {
  buildPromptEnhancementValidatedConfigDisplayModelV1,
  type PromptEnhancementValidatedConfigDisplayModelV1,
} from './validated-config-display.js';

export type PromptEnhancementB4ConfigMatrixKindV1 =
  | 'approved_enabled_default'
  | 'approved_disabled'
  | 'unsupported'
  | 'policy_disabled'
  | 'missing'
  | 'unknown'
  | 'malformed'
  | 'invalid'
  | 'stale'
  | 'legacy_isolation';

export interface PromptEnhancementB4ConfigMatrixFixtureV1 {
  fixtureId: string;
  kind: PromptEnhancementB4ConfigMatrixKindV1;
  configResult: unknown;
  freshness?: 'current' | 'stale' | 'unknown';
  expectedStatus: PromptEnhancementValidatedConfigDisplayModelV1['status'];
  expectedEvent: 'render_config_status_only';
  negativeOracle: string;
  oracleOwner: 'ui_app';
}

export interface PromptEnhancementB4ConfigMatrixObservationV1 {
  fixtureId: string;
  observedStatus: PromptEnhancementValidatedConfigDisplayModelV1['status'];
  observedEvent: 'render_config_status_only';
  interactive: false;
  leakageDetected: readonly string[];
  passFail: 'pass' | 'hard_fail';
}

export interface PromptEnhancementB4ConfigFixtureMatrixV1 {
  matrixId: 'b4-config-fixture-matrix-v1';
  contractRevision: 'pe-config-v1';
  status: 'local_source_backed';
  readinessClaimAllowed: false;
  focusedCommand: 'npx vitest run src/prompt-enhancement/config-fixture-matrix.test.ts';
  rows: readonly PromptEnhancementB4ConfigMatrixFixtureV1[];
}

const TYPED_FLAGS = {
  arbitraryConfigRowsAreAuthority: false,
  legacyDecisionSessionConfigIsAuthority: false,
} as const;

function typed(state: string, freshness = 'current', extras: Record<string, unknown> = {}) {
  return { state, freshness, ...TYPED_FLAGS, ...extras };
}

const ROWS: readonly PromptEnhancementB4ConfigMatrixFixtureV1[] = [
  row('LOCAL-B4.5-01', 'approved_enabled_default', 'enabled', typed('enabled')),
  row('LOCAL-B4.5-02', 'approved_disabled', 'disabled', typed('disabled')),
  row('LOCAL-B4.5-03', 'unsupported', 'unsupported', typed('unsupported')),
  row('LOCAL-B4.5-04', 'policy_disabled', 'policy_disabled', typed('policy_disabled')),
  row('LOCAL-B4.5-05', 'missing', 'unavailable', undefined),
  row('LOCAL-B4.5-06', 'unknown', 'unavailable', typed('new_state')),
  row('LOCAL-B4.5-07', 'malformed', 'unavailable', { state: 'enabled' }),
  row('LOCAL-B4.5-08', 'invalid', 'unavailable', typed('invalid_state')),
  row('LOCAL-B4.5-09', 'stale', 'fallback', typed('enabled', 'stale')),
  row('LOCAL-B4.5-10', 'legacy_isolation', 'enabled', typed('enabled', 'current', {
    prompt_enhancement_sequence_enabled: 'legacy-value-must-not-render',
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
  kind: PromptEnhancementB4ConfigMatrixKindV1,
  expectedStatus: PromptEnhancementB4ConfigMatrixFixtureV1['expectedStatus'],
  configResult: unknown,
  freshness?: PromptEnhancementB4ConfigMatrixFixtureV1['freshness'],
): PromptEnhancementB4ConfigMatrixFixtureV1 {
  return {
    fixtureId,
    kind,
    configResult,
    freshness,
    expectedStatus,
    expectedEvent: 'render_config_status_only',
    negativeOracle: 'UI renders only validated typed state; no key, default, legacy value, host state, or label controls it.',
    oracleOwner: 'ui_app',
  };
}

export function buildPromptEnhancementB4ConfigFixtureMatrixV1(): PromptEnhancementB4ConfigFixtureMatrixV1 {
  return {
    matrixId: 'b4-config-fixture-matrix-v1',
    contractRevision: 'pe-config-v1',
    status: 'local_source_backed',
    readinessClaimAllowed: false,
    focusedCommand: 'npx vitest run src/prompt-enhancement/config-fixture-matrix.test.ts',
    rows: ROWS,
  };
}

export function runPromptEnhancementB4ConfigFixtureV1(
  fixture: PromptEnhancementB4ConfigMatrixFixtureV1,
): PromptEnhancementB4ConfigMatrixObservationV1 {
  const model = buildPromptEnhancementValidatedConfigDisplayModelV1({
    configResult: fixture.configResult,
    freshness: fixture.freshness,
  });
  const rendered = JSON.stringify(model);
  const forbiddenValues = [
    '/home/',
    'prompt_enhancement.sequence.enabled',
    'legacy-value-must-not-render',
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
    && leakageDetected.length === 0
    ? 'pass'
    : 'hard_fail';
  return {
    fixtureId: fixture.fixtureId,
    observedStatus: model.status,
    observedEvent: 'render_config_status_only',
    interactive: false,
    leakageDetected,
    passFail,
  };
}

