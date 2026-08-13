import * as readline from 'node:readline';
import type { PromptEnhancementPrepareResultV1 } from './contracts.js';
import {
  buildPromptEnhancementMpsContinuationPopupV1,
  createPromptEnhancementMpsContinuationSendIntentV1,
  createPromptEnhancementMpsCustomInterruptionIntentV1,
  createPromptEnhancementMpsContinuationCancelIntentV1,
  type PromptEnhancementMpsContinuationInputV1,
  type PromptEnhancementMpsContinuationPopupModelV1,
} from './continuation-popup.js';
import { renderPromptEnhancementMpsContinuationFrameV1 } from './cli-mps-popup.js';
import {
  decodePromptEnhancementCliKeyV1,
  openPromptEnhancementInteractiveConsoleV1,
  promptEnhancementCliViewportV1,
  windowPromptEnhancementFieldForDisplayV1,
  buildPromptEnhancementCliFeedbackStateV1,
  reducePromptEnhancementCliFeedbackV1,
  renderPromptEnhancementCliFeedbackFrameV1,
} from './cli-submit-popup.js';
import {
  buildPromptEnhancementMultilineEditorStateV1,
  reducePromptEnhancementMultilineEditorV1,
  resizePromptEnhancementMultilineEditorV1,
  decodePromptEnhancementEditorInputV1,
  promptEnhancementCursorVisualPositionV1,
  promptEnhancementKeepFieldCursorVisibleV1,
  type PromptEnhancementEditorFieldV1,
  type PromptEnhancementMultilineEditorStateV1,
} from './multiline-editor.js';
import type { PromptEnhancementCliMpsInteractionV1, PromptEnhancementCliMpsCancelFeedbackV1 } from './cli-mps-run.js';
import type { PromptActionSignalKind } from '../store/feedback-signals.js';
import {
  deliverSequenceContinuationOutcomeV1,
  type PromptEnhancementSequenceContinuationDeliveryV1,
} from './sequence-continuation-delivery.js';
import type { PromptEnhancementSequenceRuntimeStateV1 } from './sequence-runtime.js';

/**
 * MPS continuation-popup CLI shell (locked §3.4 layout).
 *
 * Sibling of the first-popup shell (`cli-mps-run.ts`), for the LATER continuation surface. Same
 * no-scroll / two-pass-fill / caret discipline; the differences are the locked §3.4 semantics:
 *   ↑/↓          — move focus across the FOUR interactive rows
 *                  (body / Additional details / "I need to do something else first" / Cancel)
 *   plain Enter  — row 0: send the enhanced next-item BODY only (unapplied details are not sent)
 *                  row 1: APPLY the typed details INTO the body above and clear the field (PE parity)
 *                  row 2: the typed custom-interruption intent — the popup CLOSES, the pointer does
 *                         NOT advance, and the SAME item returns at the next Stop. Neither cancel
 *                         nor completion (locked split 3).
 *                  row 3: the typed cancel-remaining-sequence intent, then the PEF feedback popup;
 *                         the flow ENDS there (cancelled) — sequence-scoped, never a global disable.
 *   Esc          — declined (leave editor focus / dismiss without a decision)
 *   typing       — edits the focused editable field via the shared multiline editor
 * No queue, pointer, auto-send, or automatic advance is created here — the returned intent is
 * delivered by the Stop-hook adapter (P4), and activation stays behind the runtime gate (P5).
 */

const INTERACTIVE_ROW_COUNT = 4;
const DETAILS_DISPLAY_ROWS = 5;
/** Non-body chrome lines in a continuation frame (header, row labels, details, interruption, cancel, spacing, footer). */
const FRAME_CHROME_LINES = 21;

export type PromptEnhancementCliMpsContinuationOutcomeV1 =
  | { state: 'send'; bodyText: string }
  | { state: 'interruption' }
  | { state: 'declined' }
  | { state: 'cancelled'; feedback?: PromptEnhancementCliMpsCancelFeedbackV1 }
  | { state: 'not_shown'; reasonCodes: readonly string[] };

/**
 * MPS-2 (6.1): wire the continuation shell's outcome to the delivery mapper. This is what the P5
 * launcher calls after the shell returns — it REACHES `deliverSequenceContinuationOutcomeV1`, which had
 * no production caller (so a later mapping change, 6.2, would otherwise alter a function nobody runs).
 *
 * The shell's five states are converted to the four the mapper consumes (the cancel-feedback the popup
 * collected is a separate step the launcher already forwarded, so it is dropped from the mapper input);
 * `not_shown` — the popup never rendered — keeps the offered item pending, to be re-offered next Stop
 * (nothing was decided, so nothing is delivered). The launcher persists the returned `nextState` and
 * acts on the returned `kind`; no runtime logic lives inline. (Missing/invalid RESULTS — the four silent
 * exit events — are 6.4's detection, not this mapper.)
 */
export function deliverPromptEnhancementCliMpsContinuationOutcomeV1(
  offeredState: PromptEnhancementSequenceRuntimeStateV1,
  outcome: PromptEnhancementCliMpsContinuationOutcomeV1,
  actionId: string,
): PromptEnhancementSequenceContinuationDeliveryV1 {
  switch (outcome.state) {
    case 'not_shown':
      return { kind: 'keep', nextState: offeredState };
    case 'send':
      return deliverSequenceContinuationOutcomeV1(offeredState, { state: 'send', bodyText: outcome.bodyText }, actionId);
    case 'interruption':
      return deliverSequenceContinuationOutcomeV1(offeredState, { state: 'interruption' }, actionId);
    case 'declined':
      return deliverSequenceContinuationOutcomeV1(offeredState, { state: 'declined' }, actionId);
    case 'cancelled':
      return deliverSequenceContinuationOutcomeV1(offeredState, { state: 'cancelled' }, actionId);
  }
}

/** The continuation-shell outcome states caught in-process (a REPORTED result, not a silent exit). */
const PROMPT_ENHANCEMENT_MPS_CONTINUATION_OUTCOME_STATES_V1: readonly PromptEnhancementCliMpsContinuationOutcomeV1['state'][] = [
  'send',
  'interruption',
  'declined',
  'cancelled',
  'not_shown',
];

/** True only for a well-formed reported outcome; a missing (null/undefined), unrecognized, or incomplete result is not one. */
function isPromptEnhancementCliMpsContinuationOutcomeV1(
  result: unknown,
): result is PromptEnhancementCliMpsContinuationOutcomeV1 {
  if (typeof result !== 'object' || result === null) return false;
  const state = (result as { state?: unknown }).state;
  if (typeof state !== 'string' || !(PROMPT_ENHANCEMENT_MPS_CONTINUATION_OUTCOME_STATES_V1 as readonly string[]).includes(state)) {
    return false;
  }
  // A `send` result MUST carry a string body: a recognized-but-incomplete send is an INVALID result
  // (6.4 — invalid → cancel), not a reported outcome, so it falls to the silent-exit cancel rather than
  // injecting an undefined body. The other states carry no delivery-critical payload, so a partial one
  // already maps to keep/cancel harmlessly and needs no deeper check.
  if (state === 'send' && typeof (result as { bodyText?: unknown }).bodyText !== 'string') return false;
  return true;
}

/**
 * MPS-2 (6.4): detect the FOUR SILENT continuation-exit events. Only Escape/Ctrl+C are caught
 * in-process and return a typed outcome (Ctrl+C is folded into Esc → `declined`). OS close, timeout,
 * crash, and unknown-loss return NOTHING — so the parent that AWAITS the continuation popup is handed a
 * missing (null/undefined) or invalid (unrecognized-shape, or an incomplete `send` with no body) result
 * instead of an outcome. At a
 * CONTINUATION that missing/invalid result IS a cancel signal: every exit ends the active sequence
 * (§0), so it maps to the SAME terminal cancel the Cancel/Escape paths use — routed through the mapper's
 * `declined` case (whose comment already states "every exit event ends it, not just the Cancel button").
 * No feedback is attached: the popup is gone, and the feedback step is never added to a silent exit
 * (Trap §2).
 *
 * ⚠️ Continuation-only. At the FIRST popup nothing has activated yet, so a missing result is nothing
 * to cancel; that surface keeps its own not-shown handling and is deliberately not routed here.
 * A legitimately-rendered-then-`not_shown` outcome (e.g. no_tty) is a REPORTED result, NOT a silent
 * exit: it flows through the 6.1 bridge and keeps the item pending (re-offered next Stop).
 * ⛔ Error handling is UNCHANGED: a crash that THROWS still propagates and is logged as a crash
 * upstream — this classifies a RETURNED value only, and never catches or reinterprets an error.
 */
export function deliverPromptEnhancementCliMpsContinuationResultV1(
  offeredState: PromptEnhancementSequenceRuntimeStateV1,
  result: unknown,
  actionId: string,
): PromptEnhancementSequenceContinuationDeliveryV1 {
  if (isPromptEnhancementCliMpsContinuationOutcomeV1(result)) {
    return deliverPromptEnhancementCliMpsContinuationOutcomeV1(offeredState, result, actionId);
  }
  // Silent exit (missing/invalid result) at a continuation → terminal cancel, no feedback.
  return deliverSequenceContinuationOutcomeV1(offeredState, { state: 'declined' }, actionId);
}

export async function runPromptEnhancementCliMpsContinuationPopupV1(input: {
  result: PromptEnhancementPrepareResultV1;
  handoffMetadata: PromptEnhancementMpsContinuationInputV1['handoffMetadata'];
  event: PromptEnhancementMpsContinuationInputV1['event'];
  // MPS-3 (Part B): sequence position for the progress line, supplied by the caller (P5 launcher off
  // the packaged continuation / runtime state); the shell never recomputes it.
  progress: PromptEnhancementMpsContinuationInputV1['progress'];
  // MPS-12: the served item's kind, supplied by the caller off the packaged continuation.
  itemKind: PromptEnhancementMpsContinuationInputV1['itemKind'];
  interaction?: PromptEnhancementCliMpsInteractionV1 | null;
  /**
   * NF Plan B — content-free per-action sink (kind + timestamp only, never text). Fires
   * `mps_apply_details` when the user applies additional details here, mirroring the first popup and
   * the PE popup. Parity only until this runner is wired to a live caller (continuation runtime is
   * gated); optional — unset = no capture.
   */
  actionSignalSink?: (kind: PromptActionSignalKind, occurredAt: number) => void;
}): Promise<PromptEnhancementCliMpsContinuationOutcomeV1> {
  const built = buildPromptEnhancementMpsContinuationPopupV1({
    result: input.result,
    handoffMetadata: input.handoffMetadata,
    event: input.event,
    progress: input.progress,
    itemKind: input.itemKind,
    additionalDetails: { text: '', revision: 0 },
    // Cancel-remaining-sequence is a no-send outcome by contract (locked 'blocked_no_send');
    // availability requires the result's no-automatic-send proof.
    cancel: { state: 'available', disposition: 'blocked_no_send' },
  });
  if (built.state !== 'ready') return { state: 'not_shown', reasonCodes: built.reasonCodes };
  const model = built.model;

  const interaction = input.interaction === undefined
    ? createDefaultMpsContinuationInteractionV1()
    : input.interaction;
  if (!interaction) return { state: 'not_shown', reasonCodes: ['no_tty'] };

  const size = (): { columns: number; rows: number } => interaction.size?.() ?? { columns: 80, rows: 24 };
  const fieldWidth = (): number => promptEnhancementCliViewportV1(size().columns, size().rows).fieldWidth;
  const bodyRows = (): number => Math.max(3, size().rows - FRAME_CHROME_LINES - DETAILS_DISPLAY_ROWS);
  // Measure the exact non-body chrome with a 1-line-body probe (same focus + details), then give
  // the body every remaining row (rows - 1 for the no-scroll cap) so the frame fills the window.
  const measureBodyViewport = (detailsDisplay: string): number => {
    const probeModel: PromptEnhancementMpsContinuationPopupModelV1 = {
      ...model,
      body: { ...model.body, text: 'x' },
      additionalDetails: { ...model.additionalDetails, text: detailsDisplay },
    };
    const chromeLines = renderPromptEnhancementMpsContinuationFrameV1(probeModel, { focusIndex, colorize: false }).split('\n').length - 1;
    return Math.max(3, size().rows - 1 - chromeLines);
  };

  let focusIndex = 0;
  const editorIdentity = {
    enhancementId: input.result.enhancementId,
    currentBodyId: input.result.currentBody.currentBodyId,
    bodyRevision: model.identity.bodyRevision,
    validationDecisionId: input.result.validationDecisionId,
  };
  let editor: PromptEnhancementMultilineEditorStateV1 = buildPromptEnhancementMultilineEditorStateV1({
    identity: editorIdentity,
    enhancedBodyText: model.body.text,
    additionalDetailsText: model.additionalDetails.text,
    fieldWidth: fieldWidth(),
    viewportRows: bodyRows(),
    focusedField: 'enhanced_body',
  });
  // Open with the body at the TOP (matches the first popup's open state).
  editor = {
    ...editor,
    buffers: {
      ...editor.buffers,
      enhanced_body: { ...editor.buffers.enhanced_body, cursor: 0, desiredVisualColumn: 0, scrollVisualRow: 0 },
    },
  };

  // Only rows 0/1 are editable; rows 2 (interruption) and 3 (Cancel) have no field.
  const focusedField = (): PromptEnhancementEditorFieldV1 | null =>
    focusIndex === 0 ? 'enhanced_body' : focusIndex === 1 ? 'additional_details' : null;

  const renderFrame = (): { frame: string; cursor: { row: number; col: number } | null } => {
    const width = fieldWidth();
    const field = focusedField();
    const detailsBuffer = field === 'additional_details'
      ? promptEnhancementKeepFieldCursorVisibleV1(editor.buffers.additional_details, width, DETAILS_DISPLAY_ROWS)
      : editor.buffers.additional_details;
    const detailsDisplay = detailsBuffer.text
      ? windowPromptEnhancementFieldForDisplayV1(detailsBuffer, width, DETAILS_DISPLAY_ROWS)
      : '';
    editor = resizePromptEnhancementMultilineEditorV1(editor, width, measureBodyViewport(detailsDisplay));
    const bodyBuffer = editor.buffers.enhanced_body;
    const bodyDisplay = windowPromptEnhancementFieldForDisplayV1(bodyBuffer, width, editor.viewportRows);
    let caret: { field: PromptEnhancementEditorFieldV1; visualRow: number; visualColumn: number } | undefined;
    if (field) {
      const buffer = field === 'enhanced_body' ? bodyBuffer : detailsBuffer;
      const shownLines = (field === 'enhanced_body' ? bodyDisplay : detailsDisplay).split('\n').length;
      const pos = promptEnhancementCursorVisualPositionV1(buffer, width);
      const visualRow = pos.row - buffer.scrollVisualRow;
      if (visualRow >= 0 && visualRow < shownLines) caret = { field, visualRow, visualColumn: pos.column };
    }
    const displayModel: PromptEnhancementMpsContinuationPopupModelV1 = {
      ...model,
      body: { ...model.body, text: bodyDisplay },
      additionalDetails: { ...model.additionalDetails, text: detailsDisplay },
    };
    const caretOut = { row: -1, col: -1 };
    const frame = renderPromptEnhancementMpsContinuationFrameV1(displayModel, { focusIndex, colorize: true, caret, caretOut });
    const cursor = caret && caretOut.row > 0 && caretOut.row <= Math.max(1, size().rows - 1)
      ? { row: caretOut.row, col: caretOut.col }
      : null;
    return { frame, cursor };
  };

  // Cancel → the PEF feedback popup (owner request 2026-08-06): reuse the PE shell's pure feedback
  // state/reducer/renderer unchanged, exactly like the first-popup shell.
  const runCancelFeedback = async (): Promise<PromptEnhancementCliMpsCancelFeedbackV1 | undefined> => {
    let fb = buildPromptEnhancementCliFeedbackStateV1({ fieldWidth: fieldWidth(), viewportRows: bodyRows() });
    for (;;) {
      const raw = await interaction.next(renderPromptEnhancementCliFeedbackFrameV1(fb, { colorize: true }), null);
      const stepped = reducePromptEnhancementCliFeedbackV1(fb, decodePromptEnhancementCliKeyV1(raw));
      fb = stepped.state;
      if (stepped.result.kind === 'dismiss') return undefined;
      if (stepped.result.kind === 'suggested') return { kind: 'suggested', category: stepped.result.category };
      if (stepped.result.kind === 'other') return { kind: 'other', text: stepped.result.text };
    }
  };

  try {
    for (;;) {
      const { frame, cursor } = renderFrame();
      const raw = await interaction.next(frame, cursor);
      const key = decodePromptEnhancementCliKeyV1(raw);

      if (key.kind === 'escape') return { state: 'declined' };
      if (key.kind === 'up' || key.kind === 'down') {
        focusIndex = key.kind === 'up'
          ? Math.max(0, focusIndex - 1)
          : Math.min(INTERACTIVE_ROW_COUNT - 1, focusIndex + 1);
        editor = { ...editor, focusedField: focusedField() };
        continue;
      }
      if (key.kind === 'enter') {
        if (focusIndex === 3) {
          // Cancel-remaining-sequence (sequence-scoped, blocked_no_send), then the PEF popup. The
          // outcome is CANCELLED — the caller ends the flow here (never re-opens the PE popup).
          const intent = createPromptEnhancementMpsContinuationCancelIntentV1(model);
          if (intent.state !== 'intent_ready') return { state: 'not_shown', reasonCodes: intent.reasonCodes };
          const feedback = await runCancelFeedback();
          return feedback ? { state: 'cancelled', feedback } : { state: 'cancelled' };
        }
        if (focusIndex === 2) {
          // Custom interruption (locked split 3): the popup CLOSES, the pointer does NOT advance,
          // the SAME item returns after the next Stop. Not a cancel, not a completion.
          const intent = createPromptEnhancementMpsCustomInterruptionIntentV1(model);
          if (intent.state !== 'intent_ready') return { state: 'not_shown', reasonCodes: intent.reasonCodes };
          return { state: 'interruption' };
        }
        if (focusIndex === 1) {
          // APPLY details (PE parity): merge the typed details INTO the body above and clear the
          // field; repeated applies extend the ONE block (no duplicate heading). Blank = no-op.
          const details = editor.buffers.additional_details.text.trim();
          if (details.length === 0) continue;
          // NF Plan B — record the apply action (content-free kind + timestamp) at the moment it is
          // issued; only a REAL apply fires (past the blank guard). Text is never carried.
          input.actionSignalSink?.('mps_apply_details', Date.now());
          const detailsHeading = 'Additional details to incorporate:';
          const mergedBody = editor.buffers.enhanced_body.text.includes(detailsHeading)
            ? `${editor.buffers.enhanced_body.text}\n${details}`
            : `${editor.buffers.enhanced_body.text}\n\n${detailsHeading}\n${details}`;
          editor = buildPromptEnhancementMultilineEditorStateV1({
            identity: editorIdentity,
            enhancedBodyText: mergedBody,
            additionalDetailsText: '',
            fieldWidth: fieldWidth(),
            viewportRows: bodyRows(),
            focusedField: 'enhanced_body',
          });
          focusIndex = 0;
          continue;
        }
        // Row 0 — send the enhanced next-item BODY only (unapplied details are not sent).
        const bodyText = editor.buffers.enhanced_body.text;
        if (bodyText.trim().length === 0) continue;
        const intent = createPromptEnhancementMpsContinuationSendIntentV1(model, {
          editedBodyText: bodyText,
          additionalDetailsText: '',
        });
        if (intent.state !== 'intent_ready' || intent.intent.type !== 'send_current_body') {
          return { state: 'not_shown', reasonCodes: intent.state === 'intent_unavailable' ? intent.reasonCodes : ['intent_not_ready'] };
        }
        return { state: 'send', bodyText: intent.intent.editedBodyText };
      }
      const field = focusedField();
      if (field && (key.kind === 'editor' || key.kind === 'space')) {
        const command = decodePromptEnhancementEditorInputV1(key.kind === 'space' ? ' ' : key.raw, field);
        editor = reducePromptEnhancementMultilineEditorV1({ ...editor, focusedField: field }, command).state;
      }
    }
  } finally {
    interaction.close();
  }
}

/** Real console interaction: in-place no-scroll paint + one raw keypress per read (same as the first-popup shell). */
function createDefaultMpsContinuationInteractionV1(): PromptEnhancementCliMpsInteractionV1 | null {
  const consoleStreams = openPromptEnhancementInteractiveConsoleV1();
  if (!consoleStreams) return null;
  const { input, output, owned } = consoleStreams;

  const ESC = String.fromCharCode(27);
  readline.emitKeypressEvents(input);
  if (input.isTTY) input.setRawMode?.(true);
  input.resume();
  output.write(`${ESC}[2J${ESC}[3J${ESC}[H${ESC}[?25l`);

  let closed = false;
  let pending: { resolve: (raw: string) => void } | null = null;
  const onKeypress = (str: string | undefined, key: readline.Key | undefined): void => {
    if (!pending) return;
    const { resolve } = pending;
    pending = null;
    if (str === String.fromCharCode(3)) { resolve(ESC); return; } // Ctrl+C behaves as Esc (declined)
    resolve(key?.sequence ?? str ?? '');
  };
  input.on('keypress', onKeypress);
  const onResize = (): void => {
    if (closed || !pending) return;
    const { resolve } = pending;
    pending = null;
    resolve('');
  };
  output.on('resize', onResize);

  return {
    size() {
      return { columns: output.columns ?? 80, rows: output.rows ?? 24 };
    },
    next(frame, cursor) {
      const maxLines = Math.max(1, (output.rows ?? 24) - 1);
      const content = frame.split('\n').slice(0, maxLines).map((line) => `${line}${ESC}[K`).join('\n');
      output.write(`${ESC}[H${content}${ESC}[0J`);
      if (cursor && cursor.row > 0 && cursor.row <= maxLines) {
        output.write(`${ESC}[${cursor.row};${cursor.col}H${ESC}[?25h`);
      } else {
        output.write(`${ESC}[?25l`);
      }
      return new Promise((resolve) => { pending = { resolve }; });
    },
    close() {
      if (closed) return;
      closed = true;
      try { output.write(`${ESC}[?25h`); } catch { /* fd may already be closed */ }
      input.off('keypress', onKeypress);
      output.off('resize', onResize);
      if (input.isTTY) input.setRawMode?.(false);
      input.pause();
      if (owned) {
        try { input.destroy(); } catch { /* already closed */ }
        try { output.destroy(); } catch { /* shares the fd */ }
      }
    },
  };
}
