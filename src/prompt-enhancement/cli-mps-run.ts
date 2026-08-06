import * as readline from 'node:readline';
import type { PromptEnhancementPrepareResultV1 } from './contracts.js';
import {
  buildPromptEnhancementMpsFirstPopupV1,
  createPromptEnhancementMpsCurrentBodyIntentV1,
} from './first-popup.js';
import { renderPromptEnhancementMpsFirstPopupFrameV1 } from './cli-mps-popup.js';
import { openPromptEnhancementInteractiveConsoleV1 } from './cli-submit-popup.js';

/**
 * MPS first-popup CLI runner (owner ruling 2026-08-06: the CLI MPS surface is complete; only the
 * extension-host surface stays pending with its owner).
 *
 * Minimal v1 interaction on the direct-TTY Stop host: render the locked stage-3-1 first-popup
 * frame (sequence plan + enhanced first-prompt body), then
 *   Enter -> the typed send-current-body intent (the caller injects the body as the next turn),
 *   Esc   -> declined (the caller falls through to the regular PE popup, where full editing lives).
 * No queue, pointer, auto-send, or sequence advancement is created here — the continuation
 * runtime remains policy-gated (`sequenceActivationPolicy: blocked_pending_…`).
 */
export type PromptEnhancementCliMpsKeyV1 = 'enter' | 'escape' | 'other';

export interface PromptEnhancementCliMpsInteractionV1 {
  next(frame: string): Promise<PromptEnhancementCliMpsKeyV1>;
  close(): void;
}

export type PromptEnhancementCliMpsOutcomeV1 =
  | { state: 'send'; bodyText: string }
  | { state: 'declined' }
  | { state: 'not_shown'; reasonCodes: readonly string[] };

export async function runPromptEnhancementCliMpsFirstPopupV1(input: {
  result: PromptEnhancementPrepareResultV1;
  interaction?: PromptEnhancementCliMpsInteractionV1 | null;
}): Promise<PromptEnhancementCliMpsOutcomeV1> {
  const handoffMetadata = input.result.uiView.handoffAndSequenceSummary;
  if (!handoffMetadata) return { state: 'not_shown', reasonCodes: ['no_handoff_sequence_summary'] };

  const built = buildPromptEnhancementMpsFirstPopupV1({
    result: input.result,
    handoffMetadata,
    // Cancel-remaining-sequence is a no-send outcome by contract (its disposition is the
    // locked 'blocked_no_send'); availability requires the result's no-automatic-send proof.
    cancel: { state: 'available', disposition: 'blocked_no_send' },
  });
  if (built.state !== 'ready') return { state: 'not_shown', reasonCodes: built.reasonCodes };

  const interaction = input.interaction === undefined
    ? createDefaultMpsInteractionV1()
    : input.interaction;
  if (!interaction) return { state: 'not_shown', reasonCodes: ['no_tty'] };

  try {
    for (;;) {
      const key = await interaction.next(renderPromptEnhancementMpsFirstPopupFrameV1(built.model, { focusIndex: 0, colorize: true }));
      if (key === 'escape') return { state: 'declined' };
      if (key !== 'enter') continue; // ignore other keys; redraw
      const intent = createPromptEnhancementMpsCurrentBodyIntentV1(built.model, { editedBodyText: built.model.body.text });
      if (intent.state !== 'intent_ready' || intent.intent.type !== 'send_current_body') {
        return { state: 'not_shown', reasonCodes: intent.state === 'intent_unavailable' ? intent.reasonCodes : ['intent_not_ready'] };
      }
      return { state: 'send', bodyText: intent.intent.editedBodyText };
    }
  } finally {
    interaction.close();
  }
}

/** Real /dev/tty interaction: paint the frame in place, read one keypress at a time. */
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
  let pending: { resolve: (key: PromptEnhancementCliMpsKeyV1) => void } | null = null;
  const onKeypress = (_str: string | undefined, key: readline.Key | undefined): void => {
    if (!pending) return;
    const { resolve } = pending;
    pending = null;
    const sequence = key?.sequence ?? '';
    if (key?.name === 'return' || key?.name === 'enter') resolve('enter');
    else if (key?.name === 'escape' || sequence === ESC || sequence === String.fromCharCode(3)) resolve('escape');
    else resolve('other');
  };
  input.on('keypress', onKeypress);

  return {
    next(frame) {
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
