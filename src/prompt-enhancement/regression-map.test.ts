import { describe, expect, it } from 'vitest';
import { buildPromptEnhancementB5_1aH1RegressionMapV1 } from './regression-map.js';

describe('stage-5-1a-H1 prompt-start regression and acceptance mapping', () => {
  it('records the current legacy baseline separately from PE acceptance', () => {
    const packet = buildPromptEnhancementB5_1aH1RegressionMapV1();

    expect(packet.status).toBe('acceptance_blocked_pending_approved_inputs');
    expect(packet.readinessClaimAllowed).toBe(false);
    expect(packet.baseline).toMatchObject({
      observedFileCount: 4,
      observedTestCount: 157,
      observedOutcome: 'pass',
      legacyEvidenceOnly: true,
      provesPromptEnhancementDelivery: false,
    });
    expect(packet.baseline.files).toEqual([
      'src/cli/commands/auto.test.ts',
      'src/cli/commands/auto-hook-payload.test.ts',
      'src/cli/commands/auto-resolver.test.ts',
      'src/cli/commands/windsurf-hook.test.ts',
    ]);
    expect(packet.baselineSeparatedFromPeAcceptance).toBe(true);
  });

  it('maps all four locked H1 groups without inventing approved fixtures or contract revisions', () => {
    const packet = buildPromptEnhancementB5_1aH1RegressionMapV1();
    expect(packet.rows.map((row) => row.fixtureGroup)).toEqual([
      'shared_gate_integration',
      'no_popup_closed_disposition',
      'popup_authority',
      'legacy_regression',
    ]);
    expect(packet.rows.every((row) => row.approvedFixtureIds.length === 0)).toBe(true);
    expect(packet.rows.every((row) => row.contractRevision === null)).toBe(true);
    expect(packet.rows.every((row) => row.exactCommand.length > 0)).toBe(true);
    expect(packet.rows.every((row) => row.forbiddenEffects.length > 0)).toBe(true);
    expect(packet.classifierAndSharedGateUnchanged).toBe(true);
    expect(packet.noHostOrLegacyAuthority).toBe(true);
  });

  it('keeps missing approved inputs blocked while retaining the legacy baseline pass', () => {
    const packet = buildPromptEnhancementB5_1aH1RegressionMapV1();
    expect(packet.reasonCodes).toEqual([
      'approved_h1_contract_revision_missing',
      'approved_fixture_ids_missing',
      'pe_acceptance_not_claimed',
    ]);
    expect(packet.rows.find((row) => row.fixtureGroup === 'legacy_regression')?.passFail).toBe('pass');
    expect(packet.rows.filter((row) => row.fixtureGroup !== 'legacy_regression').every((row) => row.passFail === 'blocked_pending_approved_inputs')).toBe(true);
  });
});
