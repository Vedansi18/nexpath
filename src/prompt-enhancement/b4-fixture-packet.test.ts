import { describe, expect, it } from 'vitest';
import {
  buildPromptEnhancementB4FixturePacketV1,
  validatePromptEnhancementB4FixturePacketV1,
} from './b4-fixture-packet.js';

describe('DEP-B4-01 / DEP-TEST-01 B4 fixture intake boundary', () => {
  it('defines all B4 fixture groups without claiming readiness', () => {
    const packet = buildPromptEnhancementB4FixturePacketV1();
    expect(packet.rows.map((row) => row.group)).toEqual([
      'state_mapping', 'safe_fallback', 'legacy_isolation', 'privacy_boundary',
    ]);
    expect(packet.status).toBe('blocked_pending_external_inputs');
    expect(packet.readinessClaimAllowed).toBe(false);
  });

  it('keeps every row linked to both external dependencies and blocked', () => {
    const packet = buildPromptEnhancementB4FixturePacketV1();
    for (const row of packet.rows) {
      expect(row.requiredExternalDependencies).toEqual(['DEP-B4-01', 'DEP-TEST-01']);
      expect(row.approvedFixtureId).toBeNull();
      expect(row.contractRevision).toBeNull();
      expect(row.observedOutcome).toBe('not_run_pending_external_inputs');
      expect(row.passFail).toBe('blocked_pending_external_inputs');
      expect(row.closureDecision).toBe('blocked_pending_external_inputs');
    }
  });

  it('validates the packet while rejecting invented approval or pass claims', () => {
    const packet = buildPromptEnhancementB4FixturePacketV1();
    expect(validatePromptEnhancementB4FixturePacketV1(packet)).toEqual({
      ok: true,
      status: 'blocked_pending_external_inputs',
      readinessClaimAllowed: false,
      reasonCodes: [],
    });
    const claimed = { ...packet, rows: packet.rows.map((row) => ({ ...row, approvedFixtureId: 'invented' })) };
    expect(validatePromptEnhancementB4FixturePacketV1(claimed).ok).toBe(false);
  });

  it('keeps evidence limited to UI/public-boundary assertions', () => {
    const packet = buildPromptEnhancementB4FixturePacketV1();
    expect(packet.evidenceRule).toBe('render_and_public_boundary_assertions_only');
    expect(packet.forbiddenEvidence).toContain('hiren_config_validation_or_defaults');
    expect(packet.forbiddenEvidence).toContain('old_decision_session_settings');
    expect(packet.forbiddenEvidence).toContain('launch_or_readiness_claim');
  });
});

