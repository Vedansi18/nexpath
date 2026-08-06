import * as readline from 'node:readline';
import type { PromptEnhancementPrepareResultV1 } from './contracts.js';
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
} from './cli-submit-popup.js';
import {
  buildPromptEnhancementMultilineEditorStateV1,
  reducePromptEnhancementMultilineEditorV1,
  resizePromptEnhancementMultilineEditorV1,
  decodePromptEnhancementEditorInputV1,
  type PromptEnhancementEditorFieldV1,
  type PromptEnhancementMultilineEditorStateV1,
} from './multiline-editor.js';

/**
 * MPS first-popup CLI shell (locked stage-3-1 layout §3.3).
 *
 * The pure renderer/model/intents were built long ago; THIS shell is the interactive host that was
 * deferred while MPS was gated. It follows the locked keyboard map exactly:
 *   ↑/↓          — move focus across the three interactive rows (body / Additional details / Cancel)
 *   plain Enter  — rows 0/1: emit the ONE typed current-body-plus-details request (send)
 *                  row 2:    the typed cancel-remaining-sequence intent (declined -> PE popup)
 *   Esc          — declined (falls through to the regular PE popup)
 *   typing       — edits the focused editable field via the shared multiline editor
 * and the same no-scroll discipline as the PE shell: both editable fields are WINDOWED to the
 * viewport and the frame is hard-capped to the window height, repainted in place — the frame can
 * never scroll, so stale copies can never stack in scrollback.
 * No queue, pointer, auto-send, or sequence advancement is created here (activation stays gated).
 */
export interface PromptEnhancementCliMpsInteractionV1 {
  /** Paint the frame, resolve with the next RAW key sequence. */
  next(frame: string): Promise<string>;
  close(): void;
  /** Current window size for viewport math; test interactions may omit it. */
  size?(): { columns: number; rows: number };
}

export type PromptEnhancementCliMpsOutcomeV1 =
  | { state: 'send'; bodyText: string }
  | { state: 'declined' }
  | { state: 'not_shown'; reasonCodes: readonly string[] };

const INTERACTIVE_ROW_COUNT = 3;
const DETAILS_DISPLAY_ROWS = 5;
/** Non-body chrome lines in a frame (header, pinch/why, row labels, plan, footer, spacing). */
const FRAME_CHROME_LINES = 20;

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
  // The body viewport leaves room for the frame chrome so the WHOLE frame fits the window.
  const bodyRows = (): number => Math.max(3, Math.min(
    promptEnhancementCliViewportV1(size().columns, size().rows).viewportRows,
    size().rows - FRAME_CHROME_LINES - DETAILS_DISPLAY_ROWS,
  ));

  let focusIndex = 0;
  let editor: PromptEnhancementMultilineEditorStateV1 = buildPromptEnhancementMultilineEditorStateV1({
    identity: {
      enhancementId: input.result.enhancementId,
      currentBodyId: model.identity.currentBodyId,
      bodyRevision: model.identity.bodyRevision,
      validationDecisionId: input.result.validationDecisionId,
    },
    enhancedBodyText: model.body.text,
    additionalDetailsText: model.additionalDetails.text,
    fieldWidth: fieldWidth(),
    viewportRows: bodyRows(),
    focusedField: 'enhanced_body',
  });

  const focusedField = (): PromptEnhancementEditorFieldV1 | null =>
    focusIndex === 0 ? 'enhanced_body' : focusIndex === 1 ? 'additional_details' : null;

  const renderFrame = (): string => {
    editor = resizePromptEnhancementMultilineEditorV1(editor, fieldWidth(), bodyRows());
    const width = editor.fieldWidth;
    const bodyDisplay = windowPromptEnhancementFieldForDisplayV1(editor.buffers.enhanced_body, width, editor.viewportRows);
    const detailsDisplay = editor.buffers.additional_details.text
      ? windowPromptEnhancementFieldForDisplayV1(editor.buffers.additional_details, width, DETAILS_DISPLAY_ROWS)
      : '';
    // Display-only projection of the model: the windowed field texts render; the FULL texts stay
    // in the editor buffers and are what a send emits.
    const displayModel: PromptEnhancementMpsFirstPopupModelV1 = {
      ...model,
      body: { ...model.body, text: bodyDisplay },
      additionalDetails: { ...model.additionalDetails, text: detailsDisplay },
    };
    return renderPromptEnhancementMpsFirstPopupFrameV1(displayModel, { focusIndex, colorize: true });
  };

  try {
    for (;;) {
      const raw = await interaction.next(renderFrame());
      const key = decodePromptEnhancementCliKeyV1(raw);

      if (key.kind === 'escape') return { state: 'declined' };
      if (key.kind === 'up' || key.kind === 'down') {
        focusIndex = (focusIndex + (key.kind === 'down' ? 1 : INTERACTIVE_ROW_COUNT - 1)) % INTERACTIVE_ROW_COUNT;
        editor = { ...editor, focusedField: focusedField() };
        continue;
      }
      if (key.kind === 'enter') {
        if (focusIndex === 2) {
          // Typed cancel-remaining-sequence intent; with no runtime to cancel in v1 this resolves
          // as declined and the caller falls through to the regular PE popup.
          const cancel = createPromptEnhancementMpsCancelIntentV1(model);
          return cancel.state === 'intent_ready' ? { state: 'declined' } : { state: 'declined' };
        }
        const bodyText = editor.buffers.enhanced_body.text;
        if (bodyText.trim().length === 0) continue; // never send an empty body
        const intent = createPromptEnhancementMpsCurrentBodyIntentV1(model, {
          editedBodyText: bodyText,
          additionalDetailsText: editor.buffers.additional_details.text,
        });
        if (intent.state !== 'intent_ready' || intent.intent.type !== 'send_current_body') {
          return { state: 'not_shown', reasonCodes: intent.state === 'intent_unavailable' ? intent.reasonCodes : ['intent_not_ready'] };
        }
        const details = intent.intent.additionalDetailsText.trim();
        return {
          state: 'send',
          bodyText: details.length > 0
            ? `${intent.intent.editedBodyText}\n\nAdditional details to incorporate:\n${details}`
            : intent.intent.editedBodyText,
        };
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

  return {
    size() {
      return { columns: output.columns ?? 80, rows: output.rows ?? 24 };
    },
    next(frame) {
      // Per-line erase + clear-below + hard height cap: the frame can never scroll, so repaints
      // stay strictly in place and no stale frame can accumulate in scrollback.
      const maxLines = Math.max(1, (output.rows ?? 24) - 1);
      const content = frame.split('\n').slice(0, maxLines).map((line) => `${line}${ESC}[K`).join('\n');
      output.write(`${ESC}[H${content}${ESC}[0J`);
      return new Promise((resolve) => { pending = { resolve }; });
    },
    close() {
      if (closed) return;
      closed = true;
      try { output.write(`${ESC}[?25h`); } catch { /* fd may already be closed */ }
      input.off('keypress', onKeypress);
      if (input.isTTY) input.setRawMode?.(false);
      input.pause();
      if (owned) {
        try { input.destroy(); } catch { /* already closed */ }
        try { output.destroy(); } catch { /* shares the fd */ }
      }
    },
  };
}
