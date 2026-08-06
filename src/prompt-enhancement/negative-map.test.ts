import { describe, expect, it } from 'vitest';
import { buildPromptEnhancementB5_1bH1NegativeMapV1 } from './negative-map.js';

describe('stage-5-1b-H1 negative-disposition execution map', () => {
  it('defines all five approved routing rows and keeps the map acceptance-blocked', () => {
    const packet = buildPromptEnhancementB5_1bH1NegativeMapV1();

    expect(packet.status).toBe('acceptance_blocked_pending_approved_inputs');
    expect(packet.readinessClaimAllowed).toBe(false);
    expect(packet.requiredDependencies).toEqual(['DEP-stage-5-02', 'DEP-TEST-01']);
    expect(packet.rows.map((row) => row.rowId)).toEqual([
      'stage-5-1b-stage-1-01',
      'stage-5-1b-stage-1-02',
      'stage-5-1b-stage-1-03',
      'stage-5-1b-stage-1-04',
      'stage-5-1b-stage-1-05',
    ]);
    expect(packet.reasonCodes).toEqual([
      'approved_h1_contract_revision_missing',
      'approved_fixture_ids_missing',
      'negative_fixture_execution_pending',
    ]);
  });

  it('keeps every negative row typed, no-send, and free of authority side effects', () => {
    const packet = buildPromptEnhancementB5_1bH1NegativeMapV1();

    expect(packet.rows.every((row) => row.approvedFixtureIds.length === 0)).toBe(true);
    expect(packet.rows.every((row) => row.contractRevision === null)).toBe(true);
    expect(packet.rows.every((row) => row.expectedNoSideEffects.length > 0)).toBe(true);
    expect(packet.rows.every((row) => row.forbiddenInference.length > 0)).toBe(true);
    expect(packet.rows.every((row) => row.passFail === 'blocked_pending_approved_inputs')).toBe(true);
    expect(packet.consumesExistingRunAutoPacket).toBe(true);
    expect(packet.sharedGateMeaningChanged).toBe(false);
    expect(packet.classifierReordered).toBe(false);
    expect(packet.hostTransportImplemented).toBe(false);
    expect(packet.legacyAuthorityCreated).toBe(false);
  });

  it('keeps the valid positive boundary distinct from all negative sinks', () => {
    const packet = buildPromptEnhancementB5_1bH1NegativeMapV1();
    const positive = packet.rows.find((row) => row.rowId === 'stage-5-1b-stage-1-04');
    const negative = packet.rows.filter((row) => row.rowId !== 'stage-5-1b-stage-1-04');

    expect(positive?.expectedSink).toBe('show_current_body');
    expect(negative.every((row) => row.expectedSink !== 'show_current_body')).toBe(true);
    expect(positive?.forbiddenInference).toContain('render_to_delivery');
  });
});
