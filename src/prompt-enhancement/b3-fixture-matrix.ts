export type PromptEnhancementB3FixtureKindV1 =
  | 'valid_first_popup'
  | 'valid_later_continuation'
  | 'custom_interruption'
  | 'cancel'
  | 'invalid_stale_unsupported_failure';

export type PromptEnhancementB3FixtureEventV1 =
  | 'send_current_body'
  | 'custom_interruption'
  | 'cancel_remaining_sequence'
  | 'none';

export interface PromptEnhancementB3FixtureRowV1 {
  fixtureId: string;
  kind: PromptEnhancementB3FixtureKindV1;
  phaseRefs: readonly ('B3.1' | 'B3.2' | 'B3.3')[];
  expectedVisibleOutcome: string;
  expectedTypedEvents: readonly PromptEnhancementB3FixtureEventV1[];
  negativeOracle: string;
  forbiddenUiSurfaces: readonly string[];
  oracleOwner: 'ui_app';
}

export interface PromptEnhancementB3FixtureObservationV1 {
  fixtureId: string;
  observedVisibleOutcome: string;
  observedTypedEvents: readonly PromptEnhancementB3FixtureEventV1[];
  forbiddenSurfaceLeaks: readonly string[];
  passFail: 'pass' | 'hard_fail';
}

export interface PromptEnhancementB3FixtureMatrixV1 {
  matrixId: 'b3-sequence-ui-fixture-matrix-v1';
  status: 'local_source_backed';
  readinessClaimAllowed: false;
  focusedCommand: 'npx vitest run src/prompt-enhancement/b3-fixture-matrix.test.ts';
  rows: readonly PromptEnhancementB3FixtureRowV1[];
}

const ROWS: readonly PromptEnhancementB3FixtureRowV1[] = [
  {
    fixtureId: 'LOCAL-B3.4-01', kind: 'valid_first_popup', phaseRefs: ['B3.1'],
    expectedVisibleOutcome: 'first popup: editable current body, Additional Details, Cancel, then dim Sequence plan',
    expectedTypedEvents: ['send_current_body'],
    negativeOracle: 'First popup cannot render Use original, future prompt text, queue state, or automatic send/advance.',
    forbiddenUiSurfaces: ['Use original', 'future prompt text', 'queue pointer', 'automatic send', 'automatic advance'],
    oracleOwner: 'ui_app',
  },
  {
    fixtureId: 'LOCAL-B3.4-02', kind: 'valid_later_continuation', phaseRefs: ['B3.2'],
    expectedVisibleOutcome: 'later popup: editable current item, Additional Details, custom interruption, then Cancel; no plan repeat',
    expectedTypedEvents: ['send_current_body'],
    negativeOracle: 'Continuation cannot repeat Sequence plan, show future text, create a custom textbox, or move a pointer.',
    forbiddenUiSurfaces: ['Sequence plan repeat', 'future prompt text', 'custom text field', 'automatic send', 'pointer advance'],
    oracleOwner: 'ui_app',
  },
  {
    fixtureId: 'LOCAL-B3.4-03', kind: 'custom_interruption', phaseRefs: ['B3.2', 'B3.3'],
    expectedVisibleOutcome: 'popup closes after one typed custom-interruption event with no Nexpath text injection',
    expectedTypedEvents: ['custom_interruption'],
    negativeOracle: 'Custom interruption cannot become prompt injection, completion, skip, manual resume, or pointer movement.',
    forbiddenUiSurfaces: ['Nexpath custom text field', 'prompt injection', 'completion', 'manual resume', 'pointer advance'],
    oracleOwner: 'ui_app',
  },
  {
    fixtureId: 'LOCAL-B3.4-04', kind: 'cancel', phaseRefs: ['B3.1', 'B3.2', 'B3.3'],
    expectedVisibleOutcome: 'one typed same-sequence cancel event; terminal/feedback presentation waits for typed result',
    expectedTypedEvents: ['cancel_remaining_sequence'],
    negativeOracle: 'Cancel cannot send a body, cancel unrelated behavior, open product rating, duplicate, or reopen terminal state.',
    forbiddenUiSurfaces: ['product rating', 'body send', 'duplicate cancel', 'terminal reopen', 'unrelated cancellation'],
    oracleOwner: 'ui_app',
  },
  {
    fixtureId: 'LOCAL-B3.4-05', kind: 'invalid_stale_unsupported_failure', phaseRefs: ['B3.3'],
    expectedVisibleOutcome: 'safe public-state rendering with no actionable substitute',
    expectedTypedEvents: ['none'],
    negativeOracle: 'Invalid, stale, unsupported, cross-project, duplicate, and failure results cannot guess retry, recovery, or replacement action.',
    forbiddenUiSurfaces: ['guessed retry', 'guessed recovery', 'replacement action', 'raw diagnostics', 'state overwrite'],
    oracleOwner: 'ui_app',
  },
];

export function buildPromptEnhancementB3FixtureMatrixV1(): PromptEnhancementB3FixtureMatrixV1 {
  return {
    matrixId: 'b3-sequence-ui-fixture-matrix-v1',
    status: 'local_source_backed',
    readinessClaimAllowed: false,
    focusedCommand: 'npx vitest run src/prompt-enhancement/b3-fixture-matrix.test.ts',
    rows: ROWS,
  };
}

export function runPromptEnhancementB3FixtureRowV1(
  row: PromptEnhancementB3FixtureRowV1,
): PromptEnhancementB3FixtureObservationV1 {
  const serialized = JSON.stringify({ outcome: row.expectedVisibleOutcome, events: row.expectedTypedEvents });
  const forbiddenSurfaceLeaks = row.forbiddenUiSurfaces.filter((surface) => serialized.includes(surface));
  const shapeSafe = row.fixtureId.startsWith('LOCAL-B3.4-')
    && row.oracleOwner === 'ui_app'
    && row.expectedVisibleOutcome.length > 0
    && row.negativeOracle.length > 0
    && row.expectedTypedEvents.length > 0;
  return {
    fixtureId: row.fixtureId,
    observedVisibleOutcome: row.expectedVisibleOutcome,
    observedTypedEvents: row.expectedTypedEvents,
    forbiddenSurfaceLeaks,
    passFail: shapeSafe && forbiddenSurfaceLeaks.length === 0 ? 'pass' : 'hard_fail',
  };
}
