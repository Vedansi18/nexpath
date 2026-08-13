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

const eventBase = {
  requestId: 'request-1',
  projectScope: '/repo',
  contractVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
  sequenceId: 'seq-1',
  sequenceItemId: 'item-1',
  explicitUserActionState: 'present_future_only',
  stateFreshness: 'current',
};

describe('acceptance executor (batch 5) — runtime-gate event / config fixtures', () => {
  it('test:acceptance-sequence-handoff-validity-cross-project', () => {
    // A continuation event scoped to a different project is not this project's authority.
    const result = evaluate('continue_current_item', { event: { ...eventBase, projectScope: '/other-repo' } });
    expect(result.allowed).toBe(false);
    expect(result.reasonCodes).toContain('runtime_event_project_scope_mismatch');
  });

  it('test:acceptance-sequence-stale-and-duplicate-continuation-event', () => {
    // stale_event_produces_no_popup + duplicate is a no-op: both fail closed, neither activates.
    const stale = evaluate('continue_current_item', { event: { ...eventBase, stateFreshness: 'stale' } });
    expect(stale.allowed).toBe(false);
    expect(stale.reasonCodes).toContain('runtime_event_stale_noop');
    const duplicate = evaluate('continue_current_item', { event: { ...eventBase, stateFreshness: 'duplicate' } });
    expect(duplicate.allowed).toBe(false);
    expect(duplicate.reasonCodes).toContain('runtime_event_duplicate_noop');
  });

  it('test:acceptance-sequence-custom-interruption-same-item-returns', () => {
    // interruption_is_neither_cancel_nor_completion: the custom path does not advance the pointer or
    // create a continuation, so the same item is still there to be offered again.
    const result = evaluate('custom_prompt_path', { event: eventBase });
    expect(result.allowed).toBe(false);
    expect(result.reasonCodes).toContain('future_sequence_3_custom_prompt_path_no_go');
    expect(result.continuationState).toBe('not_created_v1');
    expect(result.pointerAdvancementState).toBe('prohibited_v1');
  });

  it('test:acceptance-sequence-config-gate-off-is-silent', () => {
    // config_gate_off_is_silent: the setting off reduces behavior only — validated off, no runtime.
    const result = evaluate('create_sequence_state', {
      configSnapshot: { sequenceEnabled: 'off', arbitraryConfigRowsAreAuthority: false },
    });
    expect(result.allowed).toBe(false);
    expect(result.reasonCodes).toContain('sequence_config_off_reduces_behavior_only');
    expect(result.configState).toBe('validated_off_no_runtime');
  });
});
