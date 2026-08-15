import { describe, expect, it } from 'vitest';
import { proveCliHostHoldCommitContractV1 } from './cli-host-hold-commit-contract.js';
import { promptEnhancementSequenceBatchExitActionV1 } from './sequence-batch-composer.js';

describe('CLI host-hold commit contract — the proof flag 9 reads', () => {
  it('proves future_hold_proven: the host holds the commit on send and releases it otherwise', () => {
    const proof = proveCliHostHoldCommitContractV1();
    expect(proof.holdsBatchOnSend).toBe(true);
    expect(proof.discardsBatchOnNonSend).toBe(true);
    expect(proof.hostCapabilityState).toBe('future_hold_proven');
  });

  it('is derived from the real exit-action contract, not asserted', () => {
    // The proof's two halves ARE the exit-action mapping — a send holds, every other exit discards.
    expect(promptEnhancementSequenceBatchExitActionV1('user_sends')).toBe('await_batch_before_exit');
    for (const exit of ['popup_closed', 'escape', 'use_original'] as const) {
      expect(promptEnhancementSequenceBatchExitActionV1(exit)).toBe('discard_batch');
    }
    // So the capability is future_hold_proven precisely because that mapping holds — if a send ever
    // stopped awaiting, holdsBatchOnSend would be false and the state would fall to stop_bridge_only.
    const proof = proveCliHostHoldCommitContractV1();
    expect(proof.hostCapabilityState === 'future_hold_proven')
      .toBe(proof.holdsBatchOnSend && proof.discardsBatchOnNonSend);
  });
});
