import type { PromptEnhancementMpsFirstPopupModelV1 } from './b3-first-popup.js';
import type { PromptEnhancementMpsContinuationPopupModelV1 } from './b3-continuation-popup.js';

// ---------------------------------------------------------------------------
// UI-6 — MPS first-popup host rendering (alignment plan §3.3).
//
// Pure, host-independent projection: it renders a validated first-popup model
// (built by `b3-first-popup.ts`) into the locked §3.3 terminal frame. It has NO
// runtime, queue, pointer, Stop correlation, terminality, delivery, or host
// transport, and never renders `Use original`, future prompt text, a queue
// pointer, or an automatic send/advance. Focus is a display cue only
// (focusIsNotAuthority); the interactive rows are body → Additional details →
// Cancel, and the Sequence plan block is dim and non-interactive.
//
// The editable body/details shown here are exactly the buffers the reused UI-2
// multiline editor maintains; wiring live keypresses/runtime is the gated host
// step and is intentionally not created here.
// ---------------------------------------------------------------------------

export const PROMPT_ENHANCEMENT_MPS_CLI_FOOTER_V1 = 'Enter send · Esc actions' as const;
export const PROMPT_ENHANCEMENT_MPS_CLI_SEQUENCE_PLAN_LABEL_V1 = 'Sequence plan' as const;
export const PROMPT_ENHANCEMENT_MPS_CLI_ADDITIONAL_DETAILS_LABEL_V1 = 'Additional details' as const;
/** Editing keys shown under a focused editable field (owner request), matching the PE popup. */
const PROMPT_ENHANCEMENT_MPS_CLI_EDIT_KEYS_HINT_V1 = 'Ctrl+J new line · Ctrl+↑/↓ move line' as const;

/**
 * ANSI tones, matching the PE popup: cyan title + rail, green (focused) / gray (unfocused)
 * radio bullet, bold (focused) / dim (unfocused) row label, dim non-interactive plan.
 * Off (plain text) for tests; colour is not authority.
 */
const PROMPT_ENHANCEMENT_MPS_CLI_SGR_V1 = (() => {
  const e = String.fromCharCode(27);
  return {
    cyan: `${e}[36m`,
    gray: `${e}[90m`,
    green: `${e}[32m`,
    dim: `${e}[2m`,
    bold: `${e}[1m`,
    reset: `${e}[0m`,
  };
})();

/**
 * Strip ANSI escape sequences + C0 control chars (and DEL, keeping tab/LF/CR)
 * from model-supplied text before rendering (public-safe). Built via RegExp so
 * no raw control bytes live in source; mirrors the PE popup's sanitiser.
 */
function publicText(value: string): string {
  const ansi = new RegExp('\\u001B(?:\\[[0-?]*[ -\\/]*[@-~]|\\][^\\u0007]*(?:\\u0007|\\u001B\\\\))', 'g');
  const control = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]', 'g');
  return value.replace(ansi, '').replace(control, '');
}

export interface PromptEnhancementMpsFirstPopupFrameStateV1 {
  /** Focused interactive row: 0 = body, 1 = Additional details, 2 = Cancel. Display cue only. */
  focusIndex?: number;
  /** Apply the §3.3 ANSI tones; off (plain text) for tests and oracles. */
  colorize?: boolean;
}

/**
 * Render the MPS first popup exactly as locked in §3.3 from a validated
 * first-popup model. Pure projection — emits only the enhanced sequence body,
 * Additional details, Cancel, and the dim Sequence plan; never `Use original`,
 * future prompt text, a queue pointer, or an automatic send/advance.
 */
export function renderPromptEnhancementMpsFirstPopupFrameV1(
  model: PromptEnhancementMpsFirstPopupModelV1,
  frameState: PromptEnhancementMpsFirstPopupFrameStateV1 = {},
): string {
  const c = frameState.colorize ? PROMPT_ENHANCEMENT_MPS_CLI_SGR_V1 : null;
  const interactiveRowCount = 3; // body, Additional details, Cancel
  const focusIndex = Math.max(0, Math.min(interactiveRowCount - 1, Math.trunc(frameState.focusIndex ?? 0)));
  // Radio row identical to the PE popup (owner request: MPS mirrors the PE popup): a cyan rail, a
  // green ● (focused) / gray ○ (unfocused) bullet, and a bold (focused) / dim (unfocused) label.
  // Plain "  ● label" for tests — colour is not authority.
  const radioRow = (rowIndex: number, label: string, suffix = ''): string => {
    const focused = rowIndex === focusIndex;
    const glyph = focused ? '●' : '○';
    if (!c) return `  ${glyph} ${label}${suffix}`;
    const bullet = focused ? `${c.green}${glyph}${c.reset}` : `${c.gray}${glyph}${c.reset}`;
    const styled = focused ? `${c.bold}${label}${c.reset}` : `${c.dim}${label}${c.reset}`;
    return `${c.cyan}│${c.reset} ${bullet} ${styled}${suffix}`;
  };
  const lines: string[] = [];

  // Branded header identical to the PE popup (owner request): "◆ NEXPATH CLI ·
  // <surface>", cyan+bold, then a dim rule the same width and a blank line. Only
  // the surface name changes; model.title stays the identity.
  const surfaceLabel = publicText(model.title).replace(/^Nexpath\s*·\s*/i, '');
  const header = `◆ NEXPATH CLI · ${surfaceLabel}`;
  lines.push(c ? `${c.cyan}${c.bold}${header}${c.reset}` : header);
  lines.push(c ? `${c.dim}${'─'.repeat(header.length)}${c.reset}` : '─'.repeat(header.length));
  lines.push('');

  // Pinch label (bold) + why-help (gray) from the typed uiView — same source and styling as the
  // PE popup; rendered only when supplied (the UI never invents them).
  if (model.pinchLabel) lines.push(c ? `${c.bold}${publicText(model.pinchLabel.text)}${c.reset}` : publicText(model.pinchLabel.text));
  if (model.whyHelp) lines.push(c ? `${c.gray}${publicText(model.whyHelp.text)}${c.reset}` : publicText(model.whyHelp.text));
  if (model.pinchLabel || model.whyHelp) lines.push('');

  const editKeysHint = (): string =>
    c ? `      ${c.gray}${PROMPT_ENHANCEMENT_MPS_CLI_EDIT_KEYS_HINT_V1}${c.reset}` : `      ${PROMPT_ENHANCEMENT_MPS_CLI_EDIT_KEYS_HINT_V1}`;

  // Enhanced sequence body — primary, interactive row 0.
  const heading = publicText(model.heading);
  lines.push(radioRow(0, heading));
  for (const bodyLine of publicText(model.body.text).split('\n')) lines.push(`    ${bodyLine}`);
  if (focusIndex === 0) lines.push(editKeysHint()); // owner request: editing keys under the focused editable field
  lines.push('');

  // Additional details — interactive row 1.
  const detailsLabel = PROMPT_ENHANCEMENT_MPS_CLI_ADDITIONAL_DETAILS_LABEL_V1;
  lines.push(radioRow(1, detailsLabel));
  for (const detailLine of publicText(model.additionalDetails.text).split('\n')) lines.push(`    ${detailLine}`);
  if (focusIndex === 1) lines.push(editKeysHint());
  lines.push('');

  // Cancel — interactive row 2, last interactive action.
  const cancelLabel = publicText(model.actions.cancelRemainingSequence.label);
  const cancelUnavailable = model.actions.cancelRemainingSequence.state === 'disabled' ? '  (unavailable)' : '';
  lines.push(radioRow(2, cancelLabel, cancelUnavailable));
  lines.push('');

  // Sequence plan — dim gray, non-interactive, first popup only.
  const planLabel = PROMPT_ENHANCEMENT_MPS_CLI_SEQUENCE_PLAN_LABEL_V1;
  const remaining = `Remaining: ${model.sequencePlan.remainingTaskCount}`;
  const types = `Types: ${model.sequencePlan.taskRoleLabels.map((label) => publicText(label)).join(', ')}`;
  lines.push(c ? `  ${c.dim}${planLabel}${c.reset}` : `  ${planLabel}`);
  lines.push(c ? `  ${c.dim}${remaining}${c.reset}` : `  ${remaining}`);
  lines.push(c ? `  ${c.dim}${types}${c.reset}` : `  ${types}`);
  lines.push('');

  lines.push(c ? `${c.dim}${PROMPT_ENHANCEMENT_MPS_CLI_FOOTER_V1}${c.reset}` : PROMPT_ENHANCEMENT_MPS_CLI_FOOTER_V1);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// UI-7 — MPS continuation host rendering (alignment plan §3.4).
//
// Same pure-projection contract as the first popup, for the later continuation
// surface. It renders body → Additional details → the custom-interruption row
// (label + helper) → Cancel, and — unlike the first popup — NEVER repeats the
// Sequence plan, remaining count, or future-item details. The custom
// interruption is neither cancel nor completion; the same pending item may
// return only after the typed host/runtime correlation allows it (gated). No
// runtime, pointer, Stop-completion, terminality, delivery, or transport.
// ---------------------------------------------------------------------------

export interface PromptEnhancementMpsContinuationFrameStateV1 {
  /** Focused interactive row: 0 = body, 1 = Additional details, 2 = custom interruption, 3 = Cancel. Display cue only. */
  focusIndex?: number;
  /** Apply the §3.4 ANSI tones; off (plain text) for tests and oracles. */
  colorize?: boolean;
}

/**
 * Render the MPS continuation popup exactly as locked in §3.4 from a validated
 * continuation model. Pure projection — emits the enhanced next body, Additional
 * details, the "I need to do something else first" interruption (label + helper),
 * and Cancel; it never repeats the Sequence plan and never renders `Use original`,
 * future prompt text, a queue pointer, or an automatic send/advance.
 */
export function renderPromptEnhancementMpsContinuationFrameV1(
  model: PromptEnhancementMpsContinuationPopupModelV1,
  frameState: PromptEnhancementMpsContinuationFrameStateV1 = {},
): string {
  const c = frameState.colorize ? PROMPT_ENHANCEMENT_MPS_CLI_SGR_V1 : null;
  const interactiveRowCount = 4; // body, Additional details, custom interruption, Cancel
  const focusIndex = Math.max(0, Math.min(interactiveRowCount - 1, Math.trunc(frameState.focusIndex ?? 0)));
  // Radio row identical to the PE popup (owner request: MPS mirrors the PE popup): a cyan rail, a
  // green ● (focused) / gray ○ (unfocused) bullet, and a bold (focused) / dim (unfocused) label.
  // Plain "  ● label" for tests — colour is not authority.
  const radioRow = (rowIndex: number, label: string, suffix = ''): string => {
    const focused = rowIndex === focusIndex;
    const glyph = focused ? '●' : '○';
    if (!c) return `  ${glyph} ${label}${suffix}`;
    const bullet = focused ? `${c.green}${glyph}${c.reset}` : `${c.gray}${glyph}${c.reset}`;
    const styled = focused ? `${c.bold}${label}${c.reset}` : `${c.dim}${label}${c.reset}`;
    return `${c.cyan}│${c.reset} ${bullet} ${styled}${suffix}`;
  };
  const lines: string[] = [];

  // Branded header identical to the PE popup (owner request): "◆ NEXPATH CLI ·
  // <surface>", cyan+bold, then a dim rule the same width and a blank line. Only
  // the surface name changes; model.title stays the identity.
  const surfaceLabel = publicText(model.title).replace(/^Nexpath\s*·\s*/i, '');
  const header = `◆ NEXPATH CLI · ${surfaceLabel}`;
  lines.push(c ? `${c.cyan}${c.bold}${header}${c.reset}` : header);
  lines.push(c ? `${c.dim}${'─'.repeat(header.length)}${c.reset}` : '─'.repeat(header.length));
  lines.push('');

  // Pinch label (bold) + why-help (gray) from the typed uiView — same source and styling as the
  // PE popup; rendered only when supplied (the UI never invents them).
  if (model.pinchLabel) lines.push(c ? `${c.bold}${publicText(model.pinchLabel.text)}${c.reset}` : publicText(model.pinchLabel.text));
  if (model.whyHelp) lines.push(c ? `${c.gray}${publicText(model.whyHelp.text)}${c.reset}` : publicText(model.whyHelp.text));
  if (model.pinchLabel || model.whyHelp) lines.push('');

  const editKeysHint = (): string =>
    c ? `      ${c.gray}${PROMPT_ENHANCEMENT_MPS_CLI_EDIT_KEYS_HINT_V1}${c.reset}` : `      ${PROMPT_ENHANCEMENT_MPS_CLI_EDIT_KEYS_HINT_V1}`;

  // Enhanced next sequence body — primary, interactive row 0.
  const heading = publicText(model.heading);
  lines.push(radioRow(0, heading));
  for (const bodyLine of publicText(model.body.text).split('\n')) lines.push(`    ${bodyLine}`);
  if (focusIndex === 0) lines.push(editKeysHint()); // owner request: editing keys under the focused editable field
  lines.push('');

  // Additional details — interactive row 1.
  const detailsLabel = PROMPT_ENHANCEMENT_MPS_CLI_ADDITIONAL_DETAILS_LABEL_V1;
  lines.push(radioRow(1, detailsLabel));
  for (const detailLine of publicText(model.additionalDetails.text).split('\n')) lines.push(`    ${detailLine}`);
  if (focusIndex === 1) lines.push(editKeysHint());
  lines.push('');

  // Custom interruption — interactive row 2: label, then dim helper. Neither cancel nor completion.
  const interruptionLabel = publicText(model.actions.customInterruption.label);
  lines.push(radioRow(2, interruptionLabel));
  for (const helperLine of publicText(model.actions.customInterruption.helper).split('\n')) {
    lines.push(c ? `    ${c.dim}${helperLine}${c.reset}` : `    ${helperLine}`);
  }
  lines.push('');

  // Cancel — interactive row 3.
  const cancelLabel = publicText(model.actions.cancelRemainingSequence.label);
  const cancelUnavailable = model.actions.cancelRemainingSequence.state === 'disabled' ? '  (unavailable)' : '';
  lines.push(radioRow(3, cancelLabel, cancelUnavailable));
  lines.push('');

  // No Sequence plan / Remaining / Types on the continuation surface (§3.4).
  lines.push(c ? `${c.dim}${PROMPT_ENHANCEMENT_MPS_CLI_FOOTER_V1}${c.reset}` : PROMPT_ENHANCEMENT_MPS_CLI_FOOTER_V1);

  return lines.join('\n');
}
