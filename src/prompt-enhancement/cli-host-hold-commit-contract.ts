/**
 * The CLI Stop-hook host-hold commit contract, and the proof the runtime gate reads.
 *
 * `hostHoldCommitContractProven` (gate evidence flag 9) attests one host capability: the CLI Stop-hook
 * can HOLD the turn open until the sequence batch commits, and persist that commit SYNCHRONOUSLY before
 * it force-exits — never fire-and-forget. This is the CLI-owner half of the transport split (Q5:
 * "CLI Stop-hook = the CLI lane"); the VS Code extension host is a separate surface, parked with the extension-host lane.
 *
 * The proof is DERIVED, not asserted: it reads the real `promptEnhancementSequenceBatchExitActionV1`
 * contract. The host holds the commit exactly when a SEND awaits the batch before exit (so the wording
 * is not killed mid-flight) and a non-send exit discards it (so an Escape at second three is not a
 * twenty-second hang). If that mapping ever changed, this returns `stop_bridge_only` and the flag stays
 * unproven — it cannot report `future_hold_proven` for a host that does not, in fact, hold.
 *
 * The second half of the contract — the write is synchronous before the force-exit, not a
 * fire-and-forget promise the exit would kill (MPS-8/MPS-9, stop.ts) — is proven separately by the
 * persist-before-block acceptance backing test; it is the precondition this capability depends on.
 */
import { promptEnhancementSequenceBatchExitActionV1 } from './sequence-batch-composer.js';

export interface PromptEnhancementCliHostHoldCommitProofV1 {
  /** `future_hold_proven` only when the host both holds on send and releases on a non-send exit. */
  hostCapabilityState: 'future_hold_proven' | 'stop_bridge_only';
  /** A send awaits the batch before exit — the commit is not killed mid-flight. */
  holdsBatchOnSend: boolean;
  /** Close / Escape / Use-original discard the batch — no hang when there is nothing to protect. */
  discardsBatchOnNonSend: boolean;
}

/**
 * Derive the CLI host-hold commit proof from the live exit-action contract.
 *
 * Returns `future_hold_proven` when the host holds the commit on send and releases it otherwise —
 * the shape the runtime event carries and the gate requires for `hostHoldCommitContractProven`.
 */
export function proveCliHostHoldCommitContractV1(): PromptEnhancementCliHostHoldCommitProofV1 {
  const holdsBatchOnSend = promptEnhancementSequenceBatchExitActionV1('user_sends') === 'await_batch_before_exit';
  const discardsBatchOnNonSend = (['popup_closed', 'escape', 'use_original'] as const)
    .every((exit) => promptEnhancementSequenceBatchExitActionV1(exit) === 'discard_batch');
  const proven = holdsBatchOnSend && discardsBatchOnNonSend;
  return {
    hostCapabilityState: proven ? 'future_hold_proven' : 'stop_bridge_only',
    holdsBatchOnSend,
    discardsBatchOnNonSend,
  };
}
