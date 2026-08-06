import { describe, expect, it } from 'vitest';
import {
  buildPromptEnhancementB5EvidenceRegisterV1,
  type PromptEnhancementB5EvidenceRowV1,
} from './b5-evidence-register.js';

const completeRow: PromptEnhancementB5EvidenceRowV1 = {
  rowId: 'b5-api-ui-stop-store-launch',
  apiContractRef: 'content-owner:pe-contract:v1',
  uiSurfaceRef: 'ui-owner:pe-ui:v1',
  stopExtensionRef: 'host-owner:host-runtime:v1',
  storeGeneratedOriginRef: 'content-owner:store-origin:v1',
  launchAcceptanceRef: 'content-owner:pe-cr-5-g8:v1',
  owner: 'cross_layer_acceptance',
  evidenceState: 'supplied',
  contractRevision: 'contracts-v1',
  sourceRevision: '221d379',
  fixtureIds: ['DEP-TEST-01-B5-01'],
  focusedCommand: 'npx vitest run src/prompt-enhancement/b5-evidence-register.test.ts',
  expectedOutput: 'Each cross-layer row records typed evidence and owner closure.',
  observedOutput: 'Evidence packet observed with all required fields.',
  safeFallback: 'typed_state_only',
  unresolvedQuestion: null,
  evidenceDate: '2026-08-01',
  closureDecision: 'ready_for_owner_review',
};

describe('B5.1 evidence intake and owner register', () => {
  it('fails closed with explicit owner dependencies and safe fallback when evidence is absent', () => {
    const packet = buildPromptEnhancementB5EvidenceRegisterV1();

    expect(packet.status).toBe('blocked_pending_evidence');
    expect(packet.readinessClaimAllowed).toBe(false);
    expect(packet.requiredDependencies).toEqual(['DEP-B5-01', 'DEP-B5-02', 'DEP-TEST-01']);
    expect(packet.rows).toHaveLength(1);
    expect(packet.rows[0]?.safeFallback).toBe('blocked_no_send');
    expect(packet.rows[0]?.closureDecision).toBe('blocked_pending_owner_evidence');
    expect(packet.reasonCodes).toContain('cross_layer_evidence_incomplete_or_owner_blocked');
    expect(packet.ownerBoundaries).toEqual({
      contentSemanticsStorePrivacyCost: 'external',
      hostTransport: 'external',
      testOracle: 'external',
      launchScope: 'external',
    });
  });

  it('accepts a complete cross-layer row only as owner review, never as GO', () => {
    const packet = buildPromptEnhancementB5EvidenceRegisterV1([completeRow]);

    expect(packet.status).toBe('ready_for_owner_review');
    expect(packet.readinessClaimAllowed).toBe(false);
    expect(packet.reasonCodes).toEqual([]);
    expect(packet.rows[0]).toMatchObject({
      apiContractRef: 'content-owner:pe-contract:v1',
      uiSurfaceRef: 'ui-owner:pe-ui:v1',
      stopExtensionRef: 'host-owner:host-runtime:v1',
      storeGeneratedOriginRef: 'content-owner:store-origin:v1',
      launchAcceptanceRef: 'content-owner:pe-cr-5-g8:v1',
      fixtureIds: ['DEP-TEST-01-B5-01'],
      closureDecision: 'ready_for_owner_review',
    });
  });

  it('keeps stale, partial, and contradictory evidence blocked', () => {
    const packet = buildPromptEnhancementB5EvidenceRegisterV1([{
      ...completeRow,
      evidenceState: 'stale',
      unresolvedQuestion: 'Source revision is stale; owner recheck required.',
      closureDecision: 'blocked_pending_owner_evidence',
    }]);

    expect(packet.status).toBe('blocked_pending_evidence');
    expect(packet.readinessClaimAllowed).toBe(false);
    expect(packet.reasonCodes).toContain('cross_layer_evidence_incomplete_or_owner_blocked');
    expect(packet.rows[0]?.safeFallback).toBe('typed_state_only');
  });
});
