/**
 * Acceptance executor — batch 4: the fail-closed authority fixtures the runtime gate drives.
 *
 * Each `it` is a backing test named for the fixture (`test:${fixtureId}`), calling the future-sequence
 * runtime gate and asserting the state it fails closed into. It does NOT mark the register fixture as
 * passing — the owner oracle judges readiness; this is the evidence it reads.
 */
import { describe, expect, it } from 'vitest';
import { PROMPT_ENHANCEMENT_CONTRACT_VERSION, type PromptEnhancementFutureSequenceRuntimeOperationV1 } from './contracts.js';
import {
  assertPromptEnhancementFutureSequenceRuntimeBlockedV1,
  evaluatePromptEnhancementFutureSequenceRuntimeGateV1,
} from './future-sequence-runtime-gate.js';

const evaluate = (
  operation: PromptEnhancementFutureSequenceRuntimeOperationV1,
  extra: Record<string, unknown> = {},
) => evaluatePromptEnhancementFutureSequenceRuntimeGateV1({
  schemaVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
  operation,
  requestId: 'request-1',
  projectRoot: '/repo',
  configSnapshot: { sequenceEnabled: 'on', arbitraryConfigRowsAreAuthority: false },
  rawContentPresence: {},
  ...extra,
} as Parameters<typeof evaluatePromptEnhancementFutureSequenceRuntimeGateV1>[0]);

describe('acceptance executor (batch 4) — runtime-gate fail-closed fixtures', () => {
  it('test:acceptance-sequence-no-auto-start', () => {
    // no_auto_start: no operation moves the runtime off prohibited — no auto-send, no pointer advance.
    for (const op of ['create_sequence_state', 'accept_handoff_start_order', 'continue_current_item'] as const) {
      const result = evaluate(op);
      expect(result.allowed).toBe(false);
      expect(result.autoSendState).toBe('prohibited_v1');
      expect(result.pointerAdvancementState).toBe('prohibited_v1');
    }
  });

  it('test:acceptance-sequence-no-popup-no-sequence-row', () => {
    // no_popup_no_sequence_row: with no runtime, no identity and no queue row are created.
    const result = evaluate('create_sequence_state');
    expect(assertPromptEnhancementFutureSequenceRuntimeBlockedV1(result)).toBe(true);
    expect(result.sequenceIdentityState).toBe('not_created_v1');
    expect(result.queueState).toBe('not_created_v1');
    expect(result.status).toBe('blocked_future_sequence_runtime_v1');
  });

  it('test:acceptance-sequence-stop-is-not-completion-proof', () => {
    // stop_is_not_completion_proof: a Stop / response-finished signal is not proof an item completed.
    const result = evaluate('response_finished_stop_completion', {
      event: {
        requestId: 'request-1',
        projectScope: '/repo',
        contractVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
        explicitUserActionState: 'absent',
        stateFreshness: 'current',
      },
    });
    expect(result.allowed).toBe(false);
    expect(result.stopCompletionState).toBe('not_proof_v1');
    expect(result.stopOrResponseEventAuthorityState).toBe('non_proof_no_runtime');
  });

  it('test:acceptance-sequence-old-decision-session-not-authority', () => {
    // old_decision_session_not_authority: legacy authority signals are rejected, never a runtime grant.
    const result = evaluate('runtime_acceptance');
    expect(result.allowed).toBe(false);
    expect(result.legacyAuthoritySignalsRejected).toBe(true);
    expect(result.runtimeAcceptanceState).toBe('no_go_v1');
  });
});
