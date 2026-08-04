import type { PromptEnhancementDraftIdentityV1 } from './local-draft.js';

export type PromptEnhancementEditorFieldV1 = 'enhanced_body' | 'additional_details';

export interface PromptEnhancementEditorBufferV1 {
  text: string;
  cursor: number;
  desiredVisualColumn: number;
  scrollVisualRow: number;
  dirty: boolean;
  focused: boolean;
}

export interface PromptEnhancementVisualLineV1 {
  text: string;
  startOffset: number;
  endOffset: number;
  physicalLine: number;
}

export interface PromptEnhancementMultilineEditorStateV1 {
  identity: PromptEnhancementDraftIdentityV1;
  fieldWidth: number;
  viewportRows: number;
  focusedField: PromptEnhancementEditorFieldV1 | null;
  editabilityState: 'editable' | 'locked';
  buffers: {
    enhanced_body: PromptEnhancementEditorBufferV1;
    additional_details: PromptEnhancementEditorBufferV1;
  };
}

export type PromptEnhancementEditorCommandV1 =
  | { type: 'insert_text'; text: string }
  | { type: 'insert_newline' }
  // Character deletion at the cursor: Backspace removes to the left, Delete to the right.
  | { type: 'delete_backward' }
  | { type: 'delete_forward' }
  | { type: 'move_left' }
  | { type: 'move_right' }
  | { type: 'move_visual_up' }
  | { type: 'move_visual_down' }
  | { type: 'plain_up' }
  | { type: 'plain_down' }
  | { type: 'escape' }
  | { type: 'plain_enter' }
  | { type: 'unsupported' };

export type PromptEnhancementEditorEffectV1 =
  | 'none'
  | 'focus_action_list'
  | 'typed_current_body_intent'
  | 'finish_additional_details';

export interface PromptEnhancementEditorStepV1 {
  state: PromptEnhancementMultilineEditorStateV1;
  effect: PromptEnhancementEditorEffectV1;
}

export function buildPromptEnhancementVisualLineMapV1(text: string, width: number): readonly PromptEnhancementVisualLineV1[] {
  const safeWidth = Math.max(1, Math.trunc(width));
  const lines: PromptEnhancementVisualLineV1[] = [];
  let physicalStart = 0;
  let physicalLine = 0;
  for (let offset = 0; offset <= text.length; offset++) {
    if (offset !== text.length && text[offset] !== '\n') continue;
    const physicalEnd = offset;
    if (physicalEnd === physicalStart) {
      lines.push({ text: '', startOffset: physicalStart, endOffset: physicalEnd, physicalLine });
    } else {
      for (let start = physicalStart; start < physicalEnd; start += safeWidth) {
        const end = Math.min(physicalEnd, start + safeWidth);
        lines.push({ text: text.slice(start, end), startOffset: start, endOffset: end, physicalLine });
      }
    }
    physicalStart = offset + 1;
    physicalLine += 1;
  }
  if (lines.length === 0) lines.push({ text: '', startOffset: 0, endOffset: 0, physicalLine: 0 });
  return lines;
}

/**
 * Visual (row, column) of the caret within a field's wrapped line map. The raw-TTY shell uses this
 * to place the terminal cursor at the REAL caret (accounting for the field's scroll offset), instead
 * of parking it on the field's first line.
 */
export function promptEnhancementCursorVisualPositionV1(
  buffer: Pick<PromptEnhancementEditorBufferV1, 'text' | 'cursor'>,
  width: number,
): { row: number; column: number } {
  return cursorVisualPosition(buffer.text, buffer.cursor, width);
}

function cursorVisualPosition(text: string, cursor: number, width: number): { row: number; column: number } {
  const lines = buildPromptEnhancementVisualLineMapV1(text, width);
  const safeCursor = Math.max(0, Math.min(text.length, Math.trunc(cursor)));
  const lineStart = lines.find((line) => safeCursor === line.startOffset && safeCursor < text.length);
  if (lineStart) return { row: lines.indexOf(lineStart), column: 0 };
  const exact = lines.find((line) => safeCursor >= line.startOffset && safeCursor <= line.endOffset);
  if (exact) return { row: lines.indexOf(exact), column: safeCursor - exact.startOffset };
  const last = lines[lines.length - 1]!;
  return { row: lines.length - 1, column: last.text.length };
}

function clampCursor(text: string, cursor: number): number {
  return Math.max(0, Math.min(text.length, Math.trunc(cursor)));
}

function clampNonNegative(value: number): number {
  return Math.max(0, Number.isFinite(value) ? Math.trunc(value) : 0);
}

function keepCursorVisible(buffer: PromptEnhancementEditorBufferV1, width: number, viewportRows: number): PromptEnhancementEditorBufferV1 {
  const position = cursorVisualPosition(buffer.text, buffer.cursor, width);
  const rows = Math.max(1, Math.trunc(viewportRows));
  const scroll = position.row < buffer.scrollVisualRow
    ? position.row
    : position.row >= buffer.scrollVisualRow + rows
      ? position.row - rows + 1
      : buffer.scrollVisualRow;
  return { ...buffer, desiredVisualColumn: position.column, scrollVisualRow: clampNonNegative(scroll) };
}

function bufferFor(text: string, focused: boolean, width: number): PromptEnhancementEditorBufferV1 {
  return {
    text,
    cursor: text.length,
    desiredVisualColumn: cursorVisualPosition(text, text.length, width).column,
    scrollVisualRow: 0,
    dirty: false,
    focused,
  };
}

export function buildPromptEnhancementMultilineEditorStateV1(input: {
  identity: PromptEnhancementDraftIdentityV1;
  enhancedBodyText: string;
  additionalDetailsText?: string;
  fieldWidth: number;
  viewportRows: number;
  focusedField?: PromptEnhancementEditorFieldV1 | null;
  editable?: boolean;
}): PromptEnhancementMultilineEditorStateV1 {
  const focusedField = input.focusedField ?? null;
  const safeWidth = Math.max(1, Math.trunc(input.fieldWidth));
  const safeRows = Math.max(1, Math.trunc(input.viewportRows));
  return {
    identity: input.identity,
    fieldWidth: safeWidth,
    viewportRows: safeRows,
    focusedField,
    editabilityState: input.editable === false ? 'locked' : 'editable',
    buffers: {
      enhanced_body: bufferFor(input.enhancedBodyText, focusedField === 'enhanced_body', safeWidth),
      additional_details: bufferFor(input.additionalDetailsText ?? '', focusedField === 'additional_details', safeWidth),
    },
  };
}

export function promptEnhancementEditorIdentityMatchesV1(
  state: PromptEnhancementMultilineEditorStateV1,
  identity: PromptEnhancementDraftIdentityV1,
): boolean {
  return state.identity.enhancementId === identity.enhancementId
    && state.identity.currentBodyId === identity.currentBodyId
    && state.identity.bodyRevision === identity.bodyRevision
    && state.identity.validationDecisionId === identity.validationDecisionId;
}

export function resizePromptEnhancementMultilineEditorV1(
  state: PromptEnhancementMultilineEditorStateV1,
  fieldWidth: number,
  viewportRows: number,
): PromptEnhancementMultilineEditorStateV1 {
  const nextWidth = Math.max(1, Math.trunc(fieldWidth));
  const nextRows = Math.max(1, Math.trunc(viewportRows));
  return {
    ...state,
    fieldWidth: nextWidth,
    viewportRows: nextRows,
    buffers: {
      enhanced_body: keepCursorVisible(state.buffers.enhanced_body, nextWidth, nextRows),
      additional_details: keepCursorVisible(state.buffers.additional_details, nextWidth, nextRows),
    },
  };
}

function withBuffer(
  state: PromptEnhancementMultilineEditorStateV1,
  field: PromptEnhancementEditorFieldV1,
  buffer: PromptEnhancementEditorBufferV1,
): PromptEnhancementMultilineEditorStateV1 {
  return { ...state, buffers: { ...state.buffers, [field]: buffer } };
}

function moveHorizontal(
  state: PromptEnhancementMultilineEditorStateV1,
  field: PromptEnhancementEditorFieldV1,
  direction: -1 | 1,
): PromptEnhancementMultilineEditorStateV1 {
  const buffer = state.buffers[field];
  const cursor = clampCursor(buffer.text, buffer.cursor + direction);
  return withBuffer(state, field, keepCursorVisible({ ...buffer, cursor }, state.fieldWidth, state.viewportRows));
}

function moveVisual(
  state: PromptEnhancementMultilineEditorStateV1,
  field: PromptEnhancementEditorFieldV1,
  direction: -1 | 1,
): PromptEnhancementMultilineEditorStateV1 {
  const buffer = state.buffers[field];
  const lines = buildPromptEnhancementVisualLineMapV1(buffer.text, state.fieldWidth);
  let position = cursorVisualPosition(buffer.text, buffer.cursor, state.fieldWidth);
  if (
    position.column === 0
    && buffer.desiredVisualColumn > 0
    && position.row > 0
    && lines[position.row - 1]!.endOffset === buffer.cursor
  ) {
    position = { row: position.row - 1, column: lines[position.row - 1]!.text.length };
  }
  const targetRow = Math.max(0, Math.min(lines.length - 1, position.row + direction));
  const target = lines[targetRow]!;
  const desiredVisualColumn = Math.min(buffer.desiredVisualColumn, target.text.length);
  const cursor = target.startOffset + desiredVisualColumn;
  return withBuffer(state, field, {
    ...keepCursorVisible({ ...buffer, cursor }, state.fieldWidth, state.viewportRows),
    desiredVisualColumn,
  });
}

/**
 * Remove the single character adjacent to the cursor (direction -1 = Backspace,
 * +1 = Delete). A no-op while the field is locked or when the cursor sits at the
 * buffer edge; deleting across a `\n` joins the two physical lines.
 */
function deleteAt(
  state: PromptEnhancementMultilineEditorStateV1,
  field: PromptEnhancementEditorFieldV1,
  direction: -1 | 1,
): PromptEnhancementMultilineEditorStateV1 {
  if (state.editabilityState !== 'editable') return state;
  const buffer = state.buffers[field];
  const removeAt = direction === -1 ? buffer.cursor - 1 : buffer.cursor;
  if (removeAt < 0 || removeAt >= buffer.text.length) return state;
  const nextText = buffer.text.slice(0, removeAt) + buffer.text.slice(removeAt + 1);
  const next = { ...buffer, text: nextText, cursor: removeAt, dirty: true };
  return withBuffer(state, field, keepCursorVisible(next, state.fieldWidth, state.viewportRows));
}

function insert(
  state: PromptEnhancementMultilineEditorStateV1,
  field: PromptEnhancementEditorFieldV1,
  text: string,
): PromptEnhancementMultilineEditorStateV1 {
  if (state.editabilityState !== 'editable' || text.length === 0) return state;
  const buffer = state.buffers[field];
  const inserted = text.replace(/\r\n?/g, '\n');
  const nextText = buffer.text.slice(0, buffer.cursor) + inserted + buffer.text.slice(buffer.cursor);
  const next = { ...buffer, text: nextText, cursor: buffer.cursor + inserted.length, dirty: true };
  return withBuffer(state, field, keepCursorVisible(next, state.fieldWidth, state.viewportRows));
}

export function reducePromptEnhancementMultilineEditorV1(
  state: PromptEnhancementMultilineEditorStateV1,
  command: PromptEnhancementEditorCommandV1,
): PromptEnhancementEditorStepV1 {
  const field = state.focusedField;
  if (!field) return { state, effect: 'none' };
  if (command.type === 'plain_up' || command.type === 'plain_down' || command.type === 'escape') {
    const buffers = {
      ...state.buffers,
      [field]: { ...state.buffers[field], focused: false },
    };
    return { state: { ...state, buffers, focusedField: null }, effect: 'focus_action_list' };
  }
  if (command.type === 'insert_text') return { state: insert(state, field, command.text), effect: 'none' };
  if (command.type === 'insert_newline') return { state: insert(state, field, '\n'), effect: 'none' };
  if (command.type === 'delete_backward') return { state: deleteAt(state, field, -1), effect: 'none' };
  if (command.type === 'delete_forward') return { state: deleteAt(state, field, 1), effect: 'none' };
  if (command.type === 'move_left') return { state: moveHorizontal(state, field, -1), effect: 'none' };
  if (command.type === 'move_right') return { state: moveHorizontal(state, field, 1), effect: 'none' };
  if (command.type === 'move_visual_up') return { state: moveVisual(state, field, -1), effect: 'none' };
  if (command.type === 'move_visual_down') return { state: moveVisual(state, field, 1), effect: 'none' };
  if (command.type === 'plain_enter') {
    return {
      state,
      effect: field === 'enhanced_body' ? 'typed_current_body_intent' : 'finish_additional_details',
    };
  }
  return { state, effect: 'none' };
}

export type PromptEnhancementRawEditorInputV1 =
  | string
  | { sequence: string; ctrl?: boolean };

/** Decode only PE editor input; this is intentionally independent of the DS normalizer. */
export function decodePromptEnhancementEditorInputV1(
  input: PromptEnhancementRawEditorInputV1,
  field: PromptEnhancementEditorFieldV1,
): PromptEnhancementEditorCommandV1 {
  const raw = typeof input === 'string' ? input : input.sequence;
  if (raw === '\u001b[A' || raw === '\u001b[B') return { type: raw.endsWith('A') ? 'plain_up' : 'plain_down' };
  if (raw === '\u001b[D') return { type: 'move_left' };
  if (raw === '\u001b[C') return { type: 'move_right' };
  if (raw === '\u001b[1;5A' || raw === '\u001b[5A') return { type: 'move_visual_up' };
  if (raw === '\u001b[1;5B' || raw === '\u001b[5B') return { type: 'move_visual_down' };
  if (raw === '\u001b' || raw === '\r') return raw === '\u001b' ? { type: 'escape' } : { type: 'plain_enter' };
  if (raw === '\n') return { type: 'insert_newline' };
  // Delete key (ESC[3~), then Backspace (DEL 0x7f / BS 0x08).
  if (raw === '\u001b[3~') return { type: 'delete_forward' };
  if (raw === '\u007f' || raw === '\b') return { type: 'delete_backward' };
  if (raw.includes('\u001b')) return { type: 'unsupported' };
  // Reject any remaining control byte, including a pasted DEL (0x7f), so it
  // never reaches the buffer as a literal character; newlines are handled above.
  if ([...raw].some((character) => {
    const code = character.charCodeAt(0);
    return (code < 0x20 || code === 0x7f) && character !== '\n' && character !== '\r';
  })) return { type: 'unsupported' };
  // Any other printable input, including a lone space, inserts at the cursor.
  if (raw.length > 0) return { type: 'insert_text', text: raw };
  return { type: 'unsupported' };
}
