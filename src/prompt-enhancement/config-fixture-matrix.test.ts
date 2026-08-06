import { describe, expect, it } from 'vitest';
import {
  buildPromptEnhancementB4ConfigFixtureMatrixV1,
  runPromptEnhancementB4ConfigFixtureV1,
} from './config-fixture-matrix.js';

describe('B4.5 configuration UI fixture matrix', () => {
  it('defines every configuration matrix row without claiming readiness', () => {
    const matrix = buildPromptEnhancementB4ConfigFixtureMatrixV1();
    expect(matrix.matrixId).toBe('b4-config-fixture-matrix-v1');
    expect(matrix.contractRevision).toBe('pe-config-v1');
    expect(matrix.status).toBe('local_source_backed');
    expect(matrix.readinessClaimAllowed).toBe(false);
    expect(matrix.rows).toHaveLength(10);
    expect(new Set(matrix.rows.map((row) => row.fixtureId)).size).toBe(10);
    expect(matrix.rows.map((row) => row.kind)).toEqual([
      'approved_enabled_default', 'approved_disabled', 'unsupported', 'policy_disabled',
      'missing', 'unknown', 'malformed', 'invalid', 'stale', 'legacy_isolation',
    ]);
  });

  it('passes all expected state/event rows with non-interactive output', () => {
    const matrix = buildPromptEnhancementB4ConfigFixtureMatrixV1();
    const observations = matrix.rows.map(runPromptEnhancementB4ConfigFixtureV1);
    expect(observations.every((observation) => observation.passFail === 'pass')).toBe(true);
    expect(observations.every((observation) => observation.observedEvent === 'render_config_status_only')).toBe(true);
    expect(observations.every((observation) => observation.interactive === false)).toBe(true);
    expect(observations.every((observation) => observation.leakageDetected.length === 0)).toBe(true);
  });

  it('keeps missing, unknown, malformed, invalid, and stale config safe', () => {
    const matrix = buildPromptEnhancementB4ConfigFixtureMatrixV1();
    const observations = matrix.rows.map(runPromptEnhancementB4ConfigFixtureV1);
    const byId = new Map(observations.map((observation) => [observation.fixtureId, observation]));
    for (const id of ['LOCAL-B4.5-05', 'LOCAL-B4.5-06', 'LOCAL-B4.5-07', 'LOCAL-B4.5-08']) {
      expect(byId.get(id)?.observedStatus).toBe('unavailable');
    }
    expect(byId.get('LOCAL-B4.5-09')?.observedStatus).toBe('fallback');
  });

  it('proves legacy config/chooser values cannot control or leak into PE output', () => {
    const matrix = buildPromptEnhancementB4ConfigFixtureMatrixV1();
    const observation = runPromptEnhancementB4ConfigFixtureV1(matrix.rows[9]);
    expect(observation.observedStatus).toBe('enabled');
    expect(observation.leakageDetected).toEqual([]);
    expect(observation.passFail).toBe('pass');
  });
});
