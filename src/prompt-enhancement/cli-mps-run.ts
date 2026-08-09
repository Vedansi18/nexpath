import * as readline from 'node:readline';
import type { PromptEnhancementPrepareResultV1 } from './contracts.js';
import type { PromptActionSignalKind } from '../store/feedback-signals.js';
import {
  buildPromptEnhancementMpsFirstPopupV1,
  createPromptEnhancementMpsCurrentBodyIntentV1,
  createPromptEnhancementMpsCancelIntentV1,
  type PromptEnhancementMpsFirstPopupModelV1,
} from './first-popup.js';
import { renderPromptEnhancementMpsFirstPopupFrameV1 } from './cli-mps-popup.js';
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
import { buildPromptEnhancementUiBoundarySessionV1 } from './ui-boundary.js';
import {
  buildPromptEnhancementFeedbackAdapterStateV1,
  openPromptEnhancementFeedbackV1,
  editPromptEnhancementOtherFeedbackV1,
  submitPromptEnhancementSuggestedFeedbackV1,
  submitPromptEnhancementOtherFeedbackV1,
} from './feedback-adapter.js';
import type { PromptEnhancementPopupEventV1 } from './popup-session.js';

/**
 * MPS first-popup CLI shell (locked stage-3-1 layout §3.3).
 *
 * The pure renderer/model/intents were built long ago; THIS shell is the interactive host that was
 * deferred while MPS was gated. It follows the locked keyboard map exactly:
 *   ↑/↓          — move focus across the three interactive rows (body / Additional details / Cancel)
 *   plain Enter  — row 0: send the enhanced sequence BODY only (unapplied details are not sent)
 *                  row 1: APPLY the typed details INTO the enhanced sequence prompt above and
 *                         clear the field (owner request 2026-08-07 — same behaviour as the PE
 *                         popup's Apply-details; details are never sent as a separate prompt)
 *                  row 2: the typed cancel-remaining-sequence intent, then the PEF feedback
 *                         popup (owner request 2026-08-06) — the flow ENDS there (cancelled);
 *                         the PE popup never opens after a cancel
 *   Esc          — declined (falls through to the regular PE popup)
 *   typing       — edits the focused editable field via the shared multiline editor
 * and the same no-scroll discipline as the PE shell: both editable fields are WINDOWED to the
 * viewport and the frame is hard-capped to the window height, repainted in place — the frame can
 * never scroll, so stale copies can never stack in scrollback. The hardware cursor is placed at
 * the caret of the focused editable field (owner request), exactly like the PE shell.
 * No queue, pointer, auto-send, or sequence advancement is created here (activation stays gated).
 */
export interface PromptEnhancementCliMpsInteractionV1 {
  /**
   * Paint the frame, resolve with the next RAW key sequence. `cursor` is the 1-based screen
   * position for the hardware cursor (caret of the focused editable field), or null to hide it;
   * test interactions may ignore it.
   */
  next(frame: string, cursor?: { row: number; col: number } | null): Promise<string>;
  close(): void;
  /** Current window size for viewport math; test interactions may omit it. */
  size?(): { columns: number; rows: number };
}

/** Feedback collected by the PEF popup that follows Cancel (owner request 2026-08-06). */
export type PromptEnhancementCliMpsCancelFeedbackV1 =
  | { kind: 'suggested'; category: 'not_relevant_enough' | 'too_much_or_too_long' }
  | { kind: 'other'; text: string };

export type PromptEnhancementCliMpsOutcomeV1 =
  | { state: 'send'; bodyText: string }
  | { state: 'declined' }
  | { state: 'cancelled'; feedback?: PromptEnhancementCliMpsCancelFeedbackV1 }
  | { state: 'not_shown'; reasonCodes: readonly string[] };

/**
 * NF Plan B (B-3): map an MPS popup outcome state to its content-free per-action signal kind. Covers the
 * first-popup states (send / declined / cancelled) and the continuation-only `interruption` (for when
 * that runner goes live). `not_shown` (and edits) are not actions → undefined.
 */
export function promptEnhancementMpsActionSignalKindV1(
  state: string,
): PromptActionSignalKind | undefined {
  switch (state) {
    case 'send':         return 'mps_send';
    case 'cancelled':    return 'mps_cancel';
    case 'declined':     return 'mps_decline';
    case 'interruption': return 'mps_interruption';
    default:             return undefined;
  }
}

const INTERACTIVE_ROW_COUNT = 3;
const DETAILS_DISPLAY_ROWS = 5;
/** Non-body chrome lines in a frame (header, pinch/why, row labels, details helpers, plan, footer, spacing). */
const FRAME_CHROME_LINES = 23;

export async function runPromptEnhancementCliMpsFirstPopupV1(input: {
  result: PromptEnhancementPrepareResultV1;
  interaction?: PromptEnhancementCliMpsInteractionV1 | null;
}): Promise<PromptEnhancementCliMpsOutcomeV1> {
  const handoffMetadata = input.result.uiView.handoffAndSequenceSummary;
  if (!handoffMetadata) return { state: 'not_shown', reasonCodes: ['no_handoff_sequence_summary'] };

  const built = buildPromptEnhancementMpsFirstPopupV1({
    result: input.result,
    handoffMetadata,
    // Cancel-remaining-sequence is a no-send outcome by contract (locked 'blocked_no_send');
    // availability requires the result's no-automatic-send proof.
    cancel: { state: 'available', disposition: 'blocked_no_send' },
  });
  if (built.state !== 'ready') return { state: 'not_shown', reasonCodes: built.reasonCodes };
  const model = built.model;

  const interaction = input.interaction === undefined
    ? createDefaultMpsInteractionV1()
    : input.interaction;
  if (!interaction) return { state: 'not_shown', reasonCodes: ['no_tty'] };

  const size = (): { columns: number; rows: number } => interaction.size?.() ?? { columns: 80, rows: 24 };
  const fieldWidth = (): number => promptEnhancementCliViewportV1(size().columns, size().rows).fieldWidth;
  // A rough body height for editor init / feedback state only; the real per-frame height is
  // MEASURED in renderFrame (two-pass) so the body fills the window exactly (owner request
  // 2026-08-07 — the body was tiny with a lot of dead space below the footer).
  const bodyRows = (): number => Math.max(3, size().rows - FRAME_CHROME_LINES - DETAILS_DISPLAY_ROWS);
  // Measure the exact non-body chrome by rendering a 1-line-body probe with the SAME focus and
  // details content, then give the body every remaining row (rows - 1 for the no-scroll cap).
  // This adapts to the variable header (pinch/why) and the current details block with no hardcoded
  // chrome constant, so the frame always fills to the window bottom and never scrolls.
  const measureBodyViewport = (detailsDisplay: string): number => {
    const probeModel: PromptEnhancementMpsFirstPopupModelV1 = {
      ...model,
      body: { ...model.body, text: 'x' },
      additionalDetails: { ...model.additionalDetails, text: detailsDisplay },
    };
    const chromeLines = renderPromptEnhancementMpsFirstPopupFrameV1(probeModel, { focusIndex, colorize: false }).split('\n').length - 1;
    return Math.max(3, size().rows - 1 - chromeLines);
  };

  let focusIndex = 0;
  const editorIdentity = {
    enhancementId: input.result.enhancementId,
    currentBodyId: model.identity.currentBodyId,
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
  // Open with the body at the TOP (the buffer builder parks the cursor at the end, and resize
  // scrolls to the cursor — which would show the tail first). Matches the PE popup's open state.
  editor = {
    ...editor,
    buffers: {
      ...editor.buffers,
      enhanced_body: { ...editor.buffers.enhanced_body, cursor: 0, desiredVisualColumn: 0, scrollVisualRow: 0 },
    },
  };

  const focusedField = (): PromptEnhancementEditorFieldV1 | null =>
    focusIndex === 0 ? 'enhanced_body' : focusIndex === 1 ? 'additional_details' : null;

  const renderFrame = (): { frame: string; cursor: { row: number; col: number } | null } => {
    const width = fieldWidth();
    const field = focusedField();
    // The details display is capped at DETAILS_DISPLAY_ROWS (< the body viewport), so sync its
    // scroll to that cap when focused — or its caret could fall outside the shown lines. Same
    // discipline as the PE shell's render(). Details is windowed FIRST because it feeds the chrome
    // measurement that sizes the body.
    const detailsBuffer = field === 'additional_details'
      ? promptEnhancementKeepFieldCursorVisibleV1(editor.buffers.additional_details, width, DETAILS_DISPLAY_ROWS)
      : editor.buffers.additional_details;
    const detailsDisplay = detailsBuffer.text
      ? windowPromptEnhancementFieldForDisplayV1(detailsBuffer, width, DETAILS_DISPLAY_ROWS)
      : '';
    // Size the body to fill the window (two-pass measured chrome), then resize the editor to it.
    editor = resizePromptEnhancementMultilineEditorV1(editor, width, measureBodyViewport(detailsDisplay));
    const bodyBuffer = editor.buffers.enhanced_body;
    const bodyDisplay = windowPromptEnhancementFieldForDisplayV1(bodyBuffer, width, editor.viewportRows);
    // Caret row is window-relative, from the SAME synced buffer used for the display. If it falls
    // outside the shown lines, leave it unset so the cursor is hidden rather than misplaced.
    let caret: { field: PromptEnhancementEditorFieldV1; visualRow: number; visualColumn: number } | undefined;
    if (field) {
      const buffer = field === 'enhanced_body' ? bodyBuffer : detailsBuffer;
      const shownLines = (field === 'enhanced_body' ? bodyDisplay : detailsDisplay).split('\n').length;
      const pos = promptEnhancementCursorVisualPositionV1(buffer, width);
      const visualRow = pos.row - buffer.scrollVisualRow;
      if (visualRow >= 0 && visualRow < shownLines) caret = { field, visualRow, visualColumn: pos.column };
    }
    // Display-only projection of the model: the windowed field texts render; the FULL texts stay
    // in the editor buffers and are what a send emits.
    const displayModel: PromptEnhancementMpsFirstPopupModelV1 = {
      ...model,
      body: { ...model.body, text: bodyDisplay },
      additionalDetails: { ...model.additionalDetails, text: detailsDisplay },
    };
    const caretOut = { row: -1, col: -1 };
    const frame = renderPromptEnhancementMpsFirstPopupFrameV1(displayModel, { focusIndex, colorize: true, caret, caretOut });
    // Never place the cursor off-frame: an off-window caret hides the cursor, never strands it.
    const cursor = caret && caretOut.row > 0 && caretOut.row <= Math.max(1, size().rows - 1)
      ? { row: caretOut.row, col: caretOut.col }
      : null;
    return { frame, cursor };
  };

  // Cancel → the PEF feedback popup (owner request 2026-08-06): reuse the PE shell's pure
  // feedback state/reducer/renderer unchanged. Esc/Ctrl+C skips (no feedback); Enter submits a
  // reason or the typed Other text. The cursor stays hidden, matching the PE feedback popup.
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
        // Clamped (not wrapped) focus move — the same row behaviour as the PE popup reducer.
        focusIndex = key.kind === 'up'
          ? Math.max(0, focusIndex - 1)
          : Math.min(INTERACTIVE_ROW_COUNT - 1, focusIndex + 1);
        editor = { ...editor, focusedField: focusedField() };
        continue;
      }
      if (key.kind === 'enter') {
        if (focusIndex === 2) {
          // Typed cancel-remaining-sequence intent (metadata-only; no runtime exists to cancel in
          // v1), then the PEF feedback popup. The outcome is CANCELLED — the caller must end the
          // flow here (owner request 2026-08-06: never open the PE popup after a cancel).
          createPromptEnhancementMpsCancelIntentV1(model);
          const feedback = await runCancelFeedback();
          return feedback ? { state: 'cancelled', feedback } : { state: 'cancelled' };
        }
        if (focusIndex === 1) {
          // APPLY details (owner request 2026-08-07, PE-popup parity): the typed details merge
          // INTO the enhanced sequence prompt above and the field clears — details are never
          // sent as a separate prompt. The rebuilt body opens scrolled to the appended details
          // (cursor at the end) so the user SEES where they landed; focus returns to the body
          // row, so the next Enter sends the merged prompt. Blank details apply nothing.
          const details = editor.buffers.additional_details.text.trim();
          if (details.length === 0) continue;
          // Repeated applies extend the ONE details block (no duplicate headings — same rule as
          // the PE popup).
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
        // Row 0 — send the enhanced sequence BODY only. Unapplied details are not sent
        // (the details row's own hint says exactly that, matching the PE popup).
        const bodyText = editor.buffers.enhanced_body.text;
        if (bodyText.trim().length === 0) continue; // never send an empty body
        const intent = createPromptEnhancementMpsCurrentBodyIntentV1(model, {
          editedBodyText: bodyText,
          additionalDetailsText: '',
        });
        if (intent.state !== 'intent_ready' || intent.intent.type !== 'send_current_body') {
          return { state: 'not_shown', reasonCodes: intent.state === 'intent_unavailable' ? intent.reasonCodes : ['intent_not_ready'] };
        }
        return { state: 'send', bodyText: intent.intent.editedBodyText };
      }
      // Editor input for the focused editable field (typing, backspace, Ctrl+J newline, moves).
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

/**
 * Build the typed PEF popup event for feedback collected by the MPS cancel flow, reusing the
 * SAME boundary/adapter chain the PE popup uses (session from the validated result, feedback
 * adapter open, typed submit). Returns null when the result cannot host a feedback event —
 * recording is best-effort and the caller simply skips it. Pure; the caller records the event.
 */
export function buildPromptEnhancementMpsCancelFeedbackEventV1(
  result: PromptEnhancementPrepareResultV1,
  feedback: PromptEnhancementCliMpsCancelFeedbackV1,
  timestampMs: number,
): PromptEnhancementPopupEventV1 | null {
  const boundary = buildPromptEnhancementUiBoundarySessionV1({
    result,
    timestampMs,
    deliverySurface: result.delivery.deliveryChannel,
  });
  if (boundary.state !== 'session_ready') return null;
  let adapter = openPromptEnhancementFeedbackV1(buildPromptEnhancementFeedbackAdapterStateV1(boundary.session));
  if (adapter.status !== 'open') return null;
  const submitted = feedback.kind === 'suggested'
    ? submitPromptEnhancementSuggestedFeedbackV1(adapter, feedback.category, timestampMs)
    : (() => {
        const text = feedback.text.trim();
        if (text.length === 0) return undefined;
        adapter = editPromptEnhancementOtherFeedbackV1(adapter, text);
        return submitPromptEnhancementOtherFeedbackV1(adapter, timestampMs);
      })();
  return submitted && submitted.state === 'event_ready' ? submitted.event : null;
}

/** Real console interaction: in-place no-scroll paint + one raw keypress per read. */
function createDefaultMpsInteractionV1(): PromptEnhancementCliMpsInteractionV1 | null {
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
  // Repaint on window resize (parity with the PE shell): a spawned terminal often opens at a
  // default small size and is resized to its real geometry a moment later. Resolve the pending
  // read with an empty sentinel so the shell loop re-renders at the new size (the empty key is a
  // no-op in the reducer). Without this, MPS stayed stuck at the initial small height — a tiny
  // body with dead space below (live iMac/Windows report 2026-08-07).
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
      // Per-line erase + clear-below + hard height cap: the frame can never scroll, so repaints
      // stay strictly in place and no stale frame can accumulate in scrollback.
      const maxLines = Math.max(1, (output.rows ?? 24) - 1);
      const content = frame.split('\n').slice(0, maxLines).map((line) => `${line}${ESC}[K`).join('\n');
      output.write(`${ESC}[H${content}${ESC}[0J`);
      // Hardware cursor at the focused editable field's caret (owner request), like the PE shell:
      // shown only where the renderer recorded a real on-screen caret; hidden otherwise.
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
