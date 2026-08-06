import { describe, expect, it } from 'vitest';
import {
  buildPromptEnhancementMultilineEditorStateV1,
  buildPromptEnhancementVisualLineMapV1,
  decodePromptEnhancementEditorInputV1,
  promptEnhancementEditorIdentityMatchesV1,
  reducePromptEnhancementMultilineEditorV1,
  resizePromptEnhancementMultilineEditorV1,
} from './multiline-editor.js';

const identity = {
  enhancementId: 'enhancement-1',
  currentBodyId: 'body-1',
  bodyRevision: 1,
  validationDecisionId: 'validation-1',
} as const;

function editor(overrides: Partial<Parameters<typeof buildPromptEnhancementMultilineEditorStateV1>[0]> = {}) {
  return buildPromptEnhancementMultilineEditorStateV1({
    identity,
    enhancedBodyText: 'alpha',
    fieldWidth: 4,
    viewportRows: 2,
    focusedField: 'enhanced_body',
    ...overrides,
  });
}

describe('stage-1-2a pure multiline editor state machine', () => {
  it('maps actual newlines and wrapped visual rows without changing the text', () => {
    const lines = buildPromptEnhancementVisualLineMapV1('abcd\nef', 3);
    expect(lines.map((line) => line.text)).toEqual(['abc', 'd', 'ef']);
    expect(lines.map((line) => [line.startOffset, line.endOffset])).toEqual([[0, 3], [3, 4], [5, 7]]);
  });

  it('inserts printable paste and Ctrl+J as real newlines at the cursor', () => {
    let state = editor({ enhancedBodyText: 'ab' });
    state = reducePromptEnhancementMultilineEditorV1(state, { type: 'move_left' }).state;
    state = reducePromptEnhancementMultilineEditorV1(state, { type: 'insert_text', text: 'X\nY' }).state;
    expect(state.buffers.enhanced_body.text).toBe('aX\nYb');
    expect(state.buffers.enhanced_body.dirty).toBe(true);
    state = reducePromptEnhancementMultilineEditorV1(state, { type: 'insert_newline' }).state;
    expect(state.buffers.enhanced_body.text).toBe('aX\nY\nb');
  });

  it('moves left/right across physical line boundaries one character boundary at a time', () => {
    let state = editor({ enhancedBodyText: 'ab\ncd' });
    state = reducePromptEnhancementMultilineEditorV1(state, { type: 'move_left' }).state;
    expect(state.buffers.enhanced_body.cursor).toBe(4);
    state = reducePromptEnhancementMultilineEditorV1(state, { type: 'move_left' }).state;
    expect(state.buffers.enhanced_body.cursor).toBe(3);
    state = reducePromptEnhancementMultilineEditorV1(state, { type: 'move_right' }).state;
    expect(state.buffers.enhanced_body.cursor).toBe(4);
  });

  it('moves Ctrl+Up/Down through wrapped rows using the nearest valid column', () => {
    let state = editor({ enhancedBodyText: 'abcd\nefghijkl' });
    state = reducePromptEnhancementMultilineEditorV1(state, { type: 'move_visual_up' }).state;
    expect(state.buffers.enhanced_body.cursor).toBe(9);
    state = reducePromptEnhancementMultilineEditorV1(state, { type: 'move_visual_up' }).state;
    expect(state.buffers.enhanced_body.cursor).toBe(4);
    state = reducePromptEnhancementMultilineEditorV1(state, { type: 'move_visual_down' }).state;
    expect(state.buffers.enhanced_body.cursor).toBe(9);
  });

  it('leaves editor focus on plain arrows and Escape while preserving the local draft', () => {
    let state = editor();
    state = reducePromptEnhancementMultilineEditorV1(state, { type: 'insert_text', text: ' changed' }).state;
    const up = reducePromptEnhancementMultilineEditorV1(state, { type: 'plain_up' });
    expect(up.effect).toBe('focus_action_list');
    expect(up.state.focusedField).toBeNull();
    expect(up.state.buffers.enhanced_body.text).toBe('alpha changed');
    const escaped = reducePromptEnhancementMultilineEditorV1(state, { type: 'escape' });
    expect(escaped.effect).toBe('focus_action_list');
    expect(escaped.state.buffers.enhanced_body.dirty).toBe(true);
  });

  it('routes plain Enter by field without delivering or applying anything', () => {
    expect(reducePromptEnhancementMultilineEditorV1(editor(), { type: 'plain_enter' }).effect)
      .toBe('typed_current_body_intent');
    const details = editor({ focusedField: 'additional_details' });
    expect(reducePromptEnhancementMultilineEditorV1(details, { type: 'plain_enter' }).effect)
      .toBe('finish_additional_details');
  });

  it('keeps fields isolated and blocks mutation while locked', () => {
    const state = editor({ additionalDetailsText: 'notes', focusedField: 'additional_details' });
    const details = reducePromptEnhancementMultilineEditorV1(state, { type: 'insert_text', text: '!' }).state;
    expect(details.buffers.additional_details.text).toBe('notes!');
    expect(details.buffers.enhanced_body.text).toBe('alpha');
    const locked = editor({ editable: false });
    const unchanged = reducePromptEnhancementMultilineEditorV1(locked, { type: 'insert_text', text: 'x' }).state;
    expect(unchanged).toEqual(locked);
  });

  it('keeps the cursor visible inside only the active field after resize', () => {
    let state = editor({ enhancedBodyText: 'abcdefghijkl', viewportRows: 1 });
    state = reducePromptEnhancementMultilineEditorV1(state, { type: 'move_visual_up' }).state;
    const resized = resizePromptEnhancementMultilineEditorV1(state, 3, 1);
    expect(resized.fieldWidth).toBe(3);
    expect(resized.viewportRows).toBe(1);
    expect(resized.buffers.enhanced_body.scrollVisualRow).toBeGreaterThanOrEqual(0);
    expect(resized.buffers.additional_details.scrollVisualRow).toBe(0);
  });

  it('decodes Ctrl+J, Enter, arrows, Escape, and unsupported editor keys distinctly', () => {
    expect(decodePromptEnhancementEditorInputV1('\n', 'enhanced_body')).toEqual({ type: 'insert_newline' });
    expect(decodePromptEnhancementEditorInputV1('\r', 'enhanced_body')).toEqual({ type: 'plain_enter' });
    expect(decodePromptEnhancementEditorInputV1('\u001b[A', 'enhanced_body')).toEqual({ type: 'plain_up' });
    expect(decodePromptEnhancementEditorInputV1('\u001b[1;5B', 'enhanced_body')).toEqual({ type: 'move_visual_down' });
    expect(decodePromptEnhancementEditorInputV1('\u001b', 'enhanced_body')).toEqual({ type: 'escape' });
    expect(decodePromptEnhancementEditorInputV1(' ', 'enhanced_body')).toEqual({ type: 'insert_text', text: ' ' });
    expect(decodePromptEnhancementEditorInputV1('\u001b[Z', 'enhanced_body')).toEqual({ type: 'unsupported' });
  });

  it('deletes backward and forward at the cursor, joining physical lines', () => {
    let state = editor({ enhancedBodyText: 'ab\ncd' });
    state = reducePromptEnhancementMultilineEditorV1(state, { type: 'delete_backward' }).state;
    expect(state.buffers.enhanced_body.text).toBe('ab\nc');
    expect(state.buffers.enhanced_body.dirty).toBe(true);
    state = reducePromptEnhancementMultilineEditorV1(state, { type: 'move_left' }).state;
    state = reducePromptEnhancementMultilineEditorV1(state, { type: 'delete_backward' }).state;
    expect(state.buffers.enhanced_body.text).toBe('abc');
    expect(state.buffers.enhanced_body.cursor).toBe(2);
    state = reducePromptEnhancementMultilineEditorV1(state, { type: 'move_left' }).state;
    state = reducePromptEnhancementMultilineEditorV1(state, { type: 'delete_forward' }).state;
    expect(state.buffers.enhanced_body.text).toBe('ac');
    expect(state.buffers.enhanced_body.cursor).toBe(1);
  });

  it('ignores deletion at buffer boundaries and while locked', () => {
    let state = editor({ enhancedBodyText: 'ab' });
    state = reducePromptEnhancementMultilineEditorV1(state, { type: 'delete_forward' }).state;
    expect(state.buffers.enhanced_body.text).toBe('ab');
    state = reducePromptEnhancementMultilineEditorV1(state, { type: 'move_left' }).state;
    state = reducePromptEnhancementMultilineEditorV1(state, { type: 'move_left' }).state;
    state = reducePromptEnhancementMultilineEditorV1(state, { type: 'delete_backward' }).state;
    expect(state.buffers.enhanced_body.text).toBe('ab');
    const locked = editor({ editable: false });
    expect(reducePromptEnhancementMultilineEditorV1(locked, { type: 'delete_backward' }).state).toEqual(locked);
  });

  it('decodes Backspace, Delete, and space as editor commands', () => {
    expect(decodePromptEnhancementEditorInputV1('\u007f', 'enhanced_body')).toEqual({ type: 'delete_backward' });
    expect(decodePromptEnhancementEditorInputV1('\b', 'enhanced_body')).toEqual({ type: 'delete_backward' });
    expect(decodePromptEnhancementEditorInputV1('\u001b[3~', 'enhanced_body')).toEqual({ type: 'delete_forward' });
    expect(decodePromptEnhancementEditorInputV1(' ', 'additional_details')).toEqual({ type: 'insert_text', text: ' ' });
    expect(decodePromptEnhancementEditorInputV1('a\u007fb', 'enhanced_body')).toEqual({ type: 'unsupported' });
  });

  it('uses the typed identity as the stale-input boundary', () => {
    const state = editor();
    expect(promptEnhancementEditorIdentityMatchesV1(state, identity)).toBe(true);
    expect(promptEnhancementEditorIdentityMatchesV1(state, { ...identity, bodyRevision: 2 })).toBe(false);
  });
});
