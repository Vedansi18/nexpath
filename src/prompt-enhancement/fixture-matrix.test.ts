import { describe, expect, it } from 'vitest';
import {
  buildPromptEnhancementB3FixtureMatrixV1,
  runPromptEnhancementB3FixtureRowV1,
} from './fixture-matrix.js';

describe('B3.4 MPS UI fixture matrix', () => {
  it('defines the locked first/later/interruption/cancel/negative scenarios', () => {
    const matrix = buildPromptEnhancementB3FixtureMatrixV1();
    expect(matrix.matrixId).toBe('b3-sequence-ui-fixture-matrix-v1');
    expect(matrix.status).toBe('local_source_backed');
    expect(matrix.readinessClaimAllowed).toBe(false);
    expect(matrix.rows).toHaveLength(5);
    expect(matrix.rows.map((row) => row.kind)).toEqual([
      'valid_first_popup', 'valid_later_continuation', 'custom_interruption', 'cancel', 'invalid_stale_unsupported_failure',
    ]);
  });

  it('passes every UI-only row without forbidden surface leakage', () => {
    const matrix = buildPromptEnhancementB3FixtureMatrixV1();
    const observations = matrix.rows.map(runPromptEnhancementB3FixtureRowV1);
    expect(observations.every((observation) => observation.passFail === 'pass')).toBe(true);
    expect(observations.every((observation) => observation.forbiddenSurfaceLeaks.length === 0)).toBe(true);
  });

  it('keeps event authority limited to one typed UI event per scenario', () => {
    const matrix = buildPromptEnhancementB3FixtureMatrixV1();
    const observations = matrix.rows.map(runPromptEnhancementB3FixtureRowV1);
    expect(observations.map((observation) => observation.observedTypedEvents)).toEqual([
      ['send_current_body'], ['send_current_body'], ['custom_interruption'], ['cancel_remaining_sequence'], ['none'],
    ]);
  });
});
