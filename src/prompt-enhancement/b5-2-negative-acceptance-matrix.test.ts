import { describe, expect, it } from 'vitest';
import { buildPromptEnhancementB5_2NegativeAcceptanceMatrixV1 } from './b5-2-negative-acceptance-matrix.js';

describe('B5.2 cross-layer negative acceptance matrix', () => {
  it('defines all planned authority-negative inputs and remains evidence-blocked', () => {
    const packet = buildPromptEnhancementB5_2NegativeAcceptanceMatrixV1();

    expect(packet.status).toBe('acceptance_blocked_pending_owner_evidence');
    expect(packet.readinessClaimAllowed).toBe(false);
    expect(packet.requiredDependencies).toEqual(['DEP-B5-02', 'DEP-TEST-01']);
    expect(packet.rows).toHaveLength(10);
    expect(packet.rows.map((row) => row.invalidInput)).toEqual([
      'old_decision_session_rows',
      'product_feedback',
      'prompt_history',
      'raw_stop_reason',
      'selected_prompt',
      'clipboard_text',
      'last_injected_prompt',
      'extension_labels',
      'missing_host_capability',
      'missing_or_malformed_generated_origin',
    ]);
    expect(packet.reasonCodes).toEqual([
      'dep_b5_02_evidence_missing',
      'dep_test_01_evidence_missing',
      'owner_fixture_oracles_pending',
    ]);
  });

  it('requires typed safe outcomes and forbids every substitute authority', () => {
    const packet = buildPromptEnhancementB5_2NegativeAcceptanceMatrixV1();

    expect(packet.rows.every((row) => row.fixtureIds.length === 0)).toBe(true);
    expect(packet.rows.every((row) => row.contractRevision === null && row.sourceRevision === null)).toBe(true);
    expect(packet.rows.every((row) => row.expectedNoSideEffects.length === 6)).toBe(true);
    expect(packet.rows.every((row) => row.passFail === 'blocked_pending_owner_evidence')).toBe(true);
    expect(packet.genericQaSubstitutionForbidden).toBe(true);
    expect(packet.oldDecisionSessionSubstitutionForbidden).toBe(true);
    expect(packet.transportSuccessSubstitutionForbidden).toBe(true);
    expect(packet.rawPrivatePayloadSubstitutionForbidden).toBe(true);
    expect(packet.localInferenceSubstitutionForbidden).toBe(true);
  });

  it('keeps host capability and generated-origin gaps on safe typed fallbacks', () => {
    const packet = buildPromptEnhancementB5_2NegativeAcceptanceMatrixV1();

    expect(packet.rows.find((row) => row.invalidInput === 'missing_host_capability')?.expectedUiFallback).toBe('blocked_no_send');
    expect(packet.rows.find((row) => row.invalidInput === 'missing_or_malformed_generated_origin')?.expectedUiFallback).toBe('no_popup_not_applicable');
  });
});
