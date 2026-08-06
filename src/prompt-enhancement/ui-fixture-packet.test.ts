import { describe, expect, it } from 'vitest';
import {
  buildPromptEnhancementB2FixturePacketV1,
  validatePromptEnhancementB2FixturePacketV1,
} from './ui-fixture-packet.js';

describe('stage-2-5 ui-owner UI fixture and acceptance packet', () => {
  it('defines all stage-2-1-stage-2-4 UI fixture groups without making a readiness claim', () => {
    const packet = buildPromptEnhancementB2FixturePacketV1();
    expect(validatePromptEnhancementB2FixturePacketV1(packet)).toEqual({
      ok: true,
      status: 'blocked_pending_external_inputs',
      readinessClaimAllowed: false,
      reasonCodes: [],
    });
    expect(packet.rows.map((row) => row.group)).toEqual([
      'lifecycle',
      'explicit_intent',
      'cancel_recovery',
      'host_status_display',
      'regression_boundary',
    ]);
    expect(packet.rows.every((row) => row.owner === 'ui_app')).toBe(true);
    expect(packet.rows.every((row) => row.approvedFixtureId === null && row.contractRevision === null)).toBe(true);
  });

  it('keeps every row blocked until DEP-stage-2-01/02 and DEP-TEST-01 inputs arrive', () => {
    const packet = buildPromptEnhancementB2FixturePacketV1();
    for (const row of packet.rows) {
      expect(row.requiredExternalDependencies).toEqual(['DEP-stage-2-01', 'DEP-stage-2-02', 'DEP-TEST-01']);
      expect(row.observedOutcome).toBe('not_run_pending_external_inputs');
      expect(row.passFail).toBe('blocked_pending_external_inputs');
      expect(row.closureDecision).toBe('blocked_pending_external_inputs');
      expect(row.oracleOwner).toBe('external_owner_not_supplied');
      expect(row.expectedVisibleOutcomes.length).toBeGreaterThan(0);
      expect(row.expectedTypedEvents.length).toBeGreaterThan(0);
      expect(row.negativeOracle).not.toBe('');
    }
  });

  it('rejects an invented fixture, contract revision, or observed pass result', () => {
    const packet = structuredClone(buildPromptEnhancementB2FixturePacketV1());
    packet.rows[0].approvedFixtureId = 'invented-fixture';
    packet.rows[1].contractRevision = 'invented-contract';
    packet.rows[2].observedOutcome = 'not_run_pending_external_inputs';
    packet.rows[2].passFail = 'blocked_pending_external_inputs';
    packet.rows[2].closureDecision = 'blocked_pending_external_inputs';
    packet.status = 'ready_for_execution';
    const validation = validatePromptEnhancementB2FixturePacketV1(packet);
    expect(validation.ok).toBe(false);
    expect(validation.reasonCodes).toEqual(expect.arrayContaining([
      'external_inputs_not_supplied',
      'unapproved_fixture_claim:stage-2-5-lifecycle',
      'unapproved_contract_claim:stage-2-5-explicit-intent',
    ]));
  });

  it('keeps transport and legacy evidence outside the ui-owner packet authority', () => {
    const packet = buildPromptEnhancementB2FixturePacketV1();
    expect(packet.evidenceRule).toBe('render_and_typed_event_assertions_only');
    expect(packet.forbiddenEvidence).toEqual(expect.arrayContaining([
      'host_transport_success',
      'stop_bridge_internals',
      'semantic_validation',
      'old_decision_session',
      'raw_stop_reason',
      'clipboard_or_foreground',
    ]));
    expect(packet.rows.find((row) => row.group === 'regression_boundary')?.negativeOracle).toContain('legacy');
  });
});
