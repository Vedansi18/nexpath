import type { PromptEnhancementPrepareResultV1 } from './contracts.js';
import { validatePromptEnhancementHandoffMetadataV1 } from './handoff-metadata.js';
import {
  createPromptEnhancementSequenceRuntimeStateV1,
  type PromptEnhancementSequenceRuntimeReasonCodeV1,
  type PromptEnhancementSequenceRuntimeStateV1,
} from './sequence-runtime.js';

/**
 * First-send sequence intake for the continuation flow: consume the typed handoff/sequence
 * summary from a prepared result at the moment the user EXPLICITLY sends the first sequence
 * prompt from the MPS popup, and produce the local bookkeeping state (ids/counts only).
 *
 * Fail-closed by design: a missing, invalid, foreign-project, or empty-remainder handoff is
 * a typed no-op — the ordinary flow continues, no partial state is written, nothing throws.
 * Recording a row here authorizes NOTHING by itself: future prompt text is never stored, and
 * the runtime gate remains the sole authority for whether a continuation surface may open.
 */

export type PromptEnhancementSequenceIntakeReasonCodeV1 =
  | 'handoff_missing'
  | 'handoff_invalid'
  | 'summary_missing'
  | 'scope_mismatch'
  | 'no_remaining_items'
  | PromptEnhancementSequenceRuntimeReasonCodeV1;

export type PromptEnhancementSequenceIntakeResultV1 =
  | { state: 'sequence_recorded'; runtime: PromptEnhancementSequenceRuntimeStateV1 }
  | { state: 'no_sequence'; reasonCode: PromptEnhancementSequenceIntakeReasonCodeV1 };

export interface PromptEnhancementSequenceIntakeInputV1 {
  result:      PromptEnhancementPrepareResultV1;
  projectRoot: string;
  sessionId:   string;
}

export function intakePromptEnhancementSequenceOnFirstSendV1(
  input: PromptEnhancementSequenceIntakeInputV1,
): PromptEnhancementSequenceIntakeResultV1 {
  const handoff = input.result.uiView.handoffAndSequenceSummary;
  if (!handoff) return { state: 'no_sequence', reasonCode: 'handoff_missing' };
  // Re-validate fail-closed even though the engine validated at emission — the intake is the
  // last gate before a durable row, and a row must never come from an unvalidated payload.
  // The scope argument binds the handoff to THIS project (cross-project policy is 'reject').
  const validation = validatePromptEnhancementHandoffMetadataV1(
    handoff,
    input.result.currentBody,
    input.result.safetySummary,
    { requestId: input.result.requestId, projectRoot: input.projectRoot },
  );
  if (!validation.ok) {
    const scopeMismatch = handoff.scope.projectRoot !== input.projectRoot;
    return { state: 'no_sequence', reasonCode: scopeMismatch ? 'scope_mismatch' : 'handoff_invalid' };
  }
  const summary = handoff.compactFirstPopupSequenceSummary;
  if (!summary) return { state: 'no_sequence', reasonCode: 'summary_missing' };
  // The first prompt was just sent; the sequence only exists if something remains after it.
  if (summary.remainingTaskCount < 1) {
    return { state: 'no_sequence', reasonCode: 'no_remaining_items' };
  }
  const created = createPromptEnhancementSequenceRuntimeStateV1({
    sequenceId:    handoff.handoffDecisionId,
    enhancementId: input.result.enhancementId,
    projectRoot:   input.projectRoot,
    sessionId:     input.sessionId,
    // Counts only, never text: total = the sent first item + the remaining items.
    itemCount:     summary.remainingTaskCount + 1,
  });
  if (!created.ok) return { state: 'no_sequence', reasonCode: created.reasonCode };
  return { state: 'sequence_recorded', runtime: created.state };
}
