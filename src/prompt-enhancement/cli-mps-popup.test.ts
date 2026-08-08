import { describe, expect, it } from 'vitest';
import {
  PROMPT_ENHANCEMENT_MPS_CLI_FOOTER_V1,
  renderPromptEnhancementMpsContinuationFrameV1,
  renderPromptEnhancementMpsFirstPopupFrameV1,
} from './cli-mps-popup.js';
import {
  PROMPT_ENHANCEMENT_MPS_FIRST_POPUP_HEADING_V1,
  PROMPT_ENHANCEMENT_MPS_FIRST_POPUP_LAYOUT_V1,
  PROMPT_ENHANCEMENT_MPS_FIRST_POPUP_TITLE_V1,
  type PromptEnhancementMpsFirstPopupModelV1,
} from './first-popup.js';
import {
  PROMPT_ENHANCEMENT_MPS_CONTINUATION_LAYOUT_V1,
  PROMPT_ENHANCEMENT_MPS_CONTINUATION_POPUP_HEADING_V1,
  PROMPT_ENHANCEMENT_MPS_CONTINUATION_POPUP_TITLE_V1,
  PROMPT_ENHANCEMENT_MPS_CUSTOM_INTERRUPTION_HELPER_V1,
  PROMPT_ENHANCEMENT_MPS_CUSTOM_INTERRUPTION_LABEL_V1,
  createPromptEnhancementMpsContinuationCancelIntentV1,
  createPromptEnhancementMpsContinuationSendIntentV1,
  createPromptEnhancementMpsCustomInterruptionIntentV1,
  type PromptEnhancementMpsContinuationPopupModelV1,
} from './continuation-popup.js';

const ESC = String.fromCharCode(27);

/** Strip the continuous left rail ("│ " / bare "│") a plain frame line carries (owner request: full-height rail). */
function deRail(line: string | undefined): string {
  return (line ?? '').replace(/^│ ?/, '');
}

function model(overrides: Partial<PromptEnhancementMpsFirstPopupModelV1> = {}): PromptEnhancementMpsFirstPopupModelV1 {
  return {
    surface: 'prompt_enhancement_mps_first_popup',
    title: PROMPT_ENHANCEMENT_MPS_FIRST_POPUP_TITLE_V1,
    heading: PROMPT_ENHANCEMENT_MPS_FIRST_POPUP_HEADING_V1,
    layout: PROMPT_ENHANCEMENT_MPS_FIRST_POPUP_LAYOUT_V1,
    identity: {
      requestId: 'req-1',
      projectRoot: '/tmp/project',
      handoffDecisionId: 'handoff-1',
      currentBodyId: 'body-1',
      bodyRevision: 1,
      itemLineageRefs: ['handoff-slice:body-1:1'],
    },
    body: {
      text: 'First sequence step: set up the failing payment test.',
      editable: true,
      originalPromptText: 'Run the payment sequence.',
      originalPromptPreservation: 'visible_verbatim',
    },
    additionalDetails: { visible: true, text: 'Focus on the checkout module.', revision: 1 },
    actions: {
      submitCurrentBody: 'typed_current_body_plus_details',
      cancelRemainingSequence: {
        label: 'Cancel (remaining multi-prompt sequence)',
        state: 'available',
        disposition: 'blocked_no_send',
      },
      originalPrompt: 'not_rendered',
    },
    sequencePlan: { remainingTaskCount: 3, taskRoleLabels: ['implement', 'verify', 'document'] },
    keyboard: {
      plainEnter: 'emit_one_typed_current_body_plus_details_request',
      escape: 'leave_editor_focus_preserve_draft',
      ctrlOrCmdJ: 'insert_newline',
      ctrlOrCmdUpDown: 'move_by_line',
      leftRight: 'move_by_character',
    },
    authority: {
      localSequenceRuntime: false,
      localQueuePointer: false,
      localAutoSend: false,
      localAdvance: false,
      hostTransport: false,
    },
    ...overrides,
  };
}

describe('UI-6 MPS first-popup frame renderer (§3.3)', () => {
  it('renders the locked §3.3 structure, labels, plan, and footer', () => {
    const frame = renderPromptEnhancementMpsFirstPopupFrameV1(model());
    expect(frame).toContain('◆ NEXPATH CLI · Multi-prompt sequence');
    expect(frame).toContain('Use enhanced sequence prompt');
    expect(frame).toContain('First sequence step: set up the failing payment test.');
    expect(frame).toContain('Additional details');
    expect(frame).toContain('Focus on the checkout module.');
    expect(frame).toContain('Cancel (remaining multi-prompt sequence)');
    expect(frame).toContain('Sequence plan');
    expect(frame).toContain('Remaining: 3');
    expect(frame).toContain('Types: implement, verify, document');
    expect(frame).toContain(PROMPT_ENHANCEMENT_MPS_CLI_FOOTER_V1);
    // Title is the first line and the footer is the last line, behind the continuous left rail
    // (owner request: the rail runs the FULL frame height, exactly like the PE popup).
    const frameLines = frame.split('\n');
    expect(frameLines[0]).toBe('│ ◆ NEXPATH CLI · Multi-prompt sequence');
    expect(frameLines[frameLines.length - 1]).toBe('│ Enter send · Esc actions');
    for (const line of frameLines) expect(line.startsWith('│')).toBe(true);
    // Body precedes Additional details precedes Cancel precedes Sequence plan.
    expect(frame.indexOf('Use enhanced sequence prompt')).toBeLessThan(frame.indexOf('Additional details'));
    expect(frame.indexOf('Additional details')).toBeLessThan(frame.indexOf('Cancel (remaining'));
    expect(frame.indexOf('Cancel (remaining')).toBeLessThan(frame.indexOf('Sequence plan'));
  });

  it('dims the scroll indicators like a hint, not as body text (owner request 2026-08-07)', () => {
    // A windowed body puts "↑ N more lines above" / "↓ N more lines below …" as content lines.
    const withMarkers = model({
      body: { text: '↑ 22 more lines above\nreal body line\n↓ 5 more lines below · the whole prompt is included', editable: true, originalPromptText: 'x', originalPromptPreservation: 'visible_verbatim' },
    });
    const colored = renderPromptEnhancementMpsFirstPopupFrameV1(withMarkers, { focusIndex: 0, colorize: true });
    const gray = `${ESC}[90m`;
    const aboveLine = colored.split('\n').find((l) => l.includes('22 more lines above'));
    const belowLine = colored.split('\n').find((l) => l.includes('5 more lines below'));
    const bodyLine = colored.split('\n').find((l) => l.includes('real body line'));
    expect(aboveLine).toContain(gray); // scroll markers are dim…
    expect(belowLine).toContain(gray);
    expect(bodyLine).not.toContain(gray); // …real prompt text is not.
  });

  it('moves "· the whole prompt is included" from the ↓ marker onto the edit-keys hint (owner request 2026-08-07)', () => {
    const withMarker = model({
      body: { text: 'real line\n↓ 16 more lines below · the whole prompt is included', editable: true, originalPromptText: 'x', originalPromptPreservation: 'visible_verbatim' },
    });
    const frame = renderPromptEnhancementMpsFirstPopupFrameV1(withMarker, { focusIndex: 0, colorize: false });
    const markerLine = frame.split('\n').find((l) => l.includes('more lines below'));
    const keysLine = frame.split('\n').find((l) => l.includes('Ctrl+J new line'));
    // The marker is now just "↓ N more lines below" — the reassurance moved off it…
    expect(markerLine).toContain('↓ 16 more lines below');
    expect(markerLine).not.toContain('the whole prompt is included');
    // …and onto the edit-keys hint line.
    expect(keysLine).toContain('the whole prompt is included');
    // When there is NO hidden content, the edit-keys hint carries no reassurance.
    const noMarker = renderPromptEnhancementMpsFirstPopupFrameV1(model({
      body: { text: 'short body', editable: true, originalPromptText: 'x', originalPromptPreservation: 'visible_verbatim' },
    }), { focusIndex: 0, colorize: false });
    expect(noMarker.split('\n').find((l) => l.includes('Ctrl+J new line'))).not.toContain('the whole prompt is included');
  });

  it('renders a multi-line body as indented lines and an empty Additional details field', () => {
    const frame = renderPromptEnhancementMpsFirstPopupFrameV1(model({
      body: { text: 'line one\nline two', editable: true, originalPromptText: 'x', originalPromptPreservation: 'visible_verbatim' },
      additionalDetails: { visible: false, text: '', revision: 0 },
    }));
    expect(frame).toContain('    line one');
    expect(frame).toContain('    line two');
    // The Additional details heading still renders even when the field is empty (§3.3).
    expect(frame).toContain('Additional details');
  });

  it('sanitises every model-supplied string, including task role labels', () => {
    const frame = renderPromptEnhancementMpsFirstPopupFrameV1(model({
      sequencePlan: { remainingTaskCount: 2, taskRoleLabels: [`impl${ESC}[31mement`, 'verify'] },
    }), { colorize: false });
    expect(frame).not.toContain(ESC);
    expect(frame).toContain('Types: implement, verify');
  });

  it('clamps an out-of-range focusIndex to the interactive rows', () => {
    const high = renderPromptEnhancementMpsFirstPopupFrameV1(model(), { focusIndex: 99 });
    expect(deRail(high.split('\n').find((line) => line.includes('Cancel (remaining'))).startsWith('●')).toBe(true);
    const low = renderPromptEnhancementMpsFirstPopupFrameV1(model(), { focusIndex: -5 });
    expect(deRail(low.split('\n').find((line) => line.includes('Use enhanced sequence prompt'))).startsWith('●')).toBe(true);
  });

  it('never renders a forbidden surface (Use original, future text, queue, auto send/advance)', () => {
    const frame = renderPromptEnhancementMpsFirstPopupFrameV1(model());
    expect(frame).not.toContain('Use original');
    expect(frame).not.toMatch(/queue|pointer|automatic send|auto-send|advance/i);
  });

  it('is plain text when colorize is off and carries ANSI tones when on', () => {
    expect(renderPromptEnhancementMpsFirstPopupFrameV1(model(), { colorize: false })).not.toContain(ESC);
    expect(renderPromptEnhancementMpsFirstPopupFrameV1(model(), { colorize: true })).toContain(ESC);
  });

  it('marks only the focused interactive row (body/details/cancel), never the plan', () => {
    const onCancel = renderPromptEnhancementMpsFirstPopupFrameV1(model(), { focusIndex: 2 });
    const cancelLine = onCancel.split('\n').find((line) => line.includes('Cancel (remaining'));
    const bodyLine = onCancel.split('\n').find((line) => line.includes('Use enhanced sequence prompt'));
    expect(deRail(cancelLine).startsWith('●')).toBe(true);
    expect(deRail(bodyLine).startsWith('●')).toBe(false);
    // The non-interactive Sequence plan never gets the focus marker.
    const planLine = onCancel.split('\n').find((line) => deRail(line).trim() === 'Sequence plan');
    expect(planLine).toBeDefined();
    expect(deRail(planLine).trimStart().startsWith('●')).toBe(false);
  });

  it('renders the Cancel row EXTRA-light (pale) yellow in colorized mode and records the caret screen position (owner request)', () => {
    // Pale-yellow Cancel (owner request 2026-08-08): a touch softer than the bright hint yellow —
    // 256-colour 38;5;229. Applied only to the Cancel label, never the body row; the bright hint
    // yellow ([93m]) and the normal yellow ([33m], provider-failure notice) are unaffected.
    const colored = renderPromptEnhancementMpsFirstPopupFrameV1(model(), { focusIndex: 0, colorize: true });
    const cancelLine = colored.split('\n').find((line) => line.includes('Cancel (remaining'));
    const bodyLine = colored.split('\n').find((line) => line.includes('Use enhanced sequence prompt'));
    expect(cancelLine).toContain(`${ESC}[38;5;229m`);      // pale/extra-light yellow
    expect(cancelLine).not.toContain(`${ESC}[93m`);        // not the bright hint yellow
    expect(cancelLine).not.toContain(`${ESC}[33m`);        // not the normal (notice) yellow
    expect(bodyLine).not.toContain(`${ESC}[38;5;229m`);
    // Caret contract (same as the PE renderer): caretOut records the 1-based screen row of the
    // body's first content line, at column 7 (2-char rail + 4-space indent + 1-based).
    const caretOut = { row: -1, col: -1 };
    const frame = renderPromptEnhancementMpsFirstPopupFrameV1(model(), {
      focusIndex: 0,
      caret: { field: 'enhanced_body', visualRow: 0, visualColumn: 0 },
      caretOut,
    });
    const bodyContentRow = frame.split('\n').findIndex((line) => line.includes('First sequence step')) + 1;
    expect(caretOut.row).toBe(bodyContentRow);
    expect(caretOut.col).toBe(7);
  });

  it('strips ANSI/control chars from model-supplied text (public-safe)', () => {
    const injected = renderPromptEnhancementMpsFirstPopupFrameV1(
      model({ body: { text: `${ESC}[31mred${ESC}[0mbell`, editable: true, originalPromptText: 'x', originalPromptPreservation: 'visible_verbatim' } }),
      { colorize: false },
    );
    expect(injected).not.toContain(ESC);
    expect(injected).toContain('redbell');
  });

  it('shows the Cancel row as unavailable when disabled', () => {
    const frame = renderPromptEnhancementMpsFirstPopupFrameV1(model({
      actions: {
        submitCurrentBody: 'typed_current_body_plus_details',
        cancelRemainingSequence: { label: 'Cancel (remaining multi-prompt sequence)', state: 'disabled', disposition: 'blocked_no_send' },
        originalPrompt: 'not_rendered',
      },
    }));
    expect(frame).toContain('Cancel (remaining multi-prompt sequence)  (unavailable)');
  });

  it('renders pinch label + why-help (from the uiView) after the header and before the body, like PE', () => {
    const frame = renderPromptEnhancementMpsFirstPopupFrameV1(model({
      pinchLabel: { text: 'Careful — this sequence deletes data.', derivedFrom: 'overlay' },
      whyHelp: { text: 'Flagged because the sequence removes files.', reasonKind: 'sensitive_action' },
    }));
    expect(frame).toContain('Careful — this sequence deletes data.');
    expect(frame).toContain('Flagged because the sequence removes files.');
    const lines = frame.split('\n');
    const pinchIdx = lines.findIndex((l) => l.includes('Careful — this sequence deletes data.'));
    const bodyIdx = lines.findIndex((l) => l.includes('Use enhanced sequence prompt'));
    expect(pinchIdx).toBeGreaterThan(0);      // after the header
    expect(pinchIdx).toBeLessThan(bodyIdx);   // before the body row
  });

  it('omits pinch/why-help rows when the uiView supplies none (never invented)', () => {
    const frame = renderPromptEnhancementMpsFirstPopupFrameV1(model());
    expect(frame).not.toContain('Careful');
    expect(frame).not.toContain('Flagged because');
  });
});

function continuationModel(overrides: Partial<PromptEnhancementMpsContinuationPopupModelV1> = {}): PromptEnhancementMpsContinuationPopupModelV1 {
  return {
    surface: 'prompt_enhancement_mps_continuation_popup',
    title: PROMPT_ENHANCEMENT_MPS_CONTINUATION_POPUP_TITLE_V1,
    heading: PROMPT_ENHANCEMENT_MPS_CONTINUATION_POPUP_HEADING_V1,
    layout: PROMPT_ENHANCEMENT_MPS_CONTINUATION_LAYOUT_V1,
    identity: { requestId: 'req-1', projectRoot: '/tmp/project', sequenceId: 'seq-1', sequenceItemId: 'item-2', currentItemRevision: 2, bodyRevision: 1, detailsRevision: 1 },
    body: { text: 'Next sequence step: apply the fix and run the focused checkout test.', editable: true, originalPromptText: 'Run the checkout fix sequence.' },
    additionalDetails: { visible: true, text: 'Keep scope to the payments module.', revision: 1 },
    actions: {
      submitCurrentBody: 'typed_current_body_plus_details',
      customInterruption: { label: PROMPT_ENHANCEMENT_MPS_CUSTOM_INTERRUPTION_LABEL_V1, helper: PROMPT_ENHANCEMENT_MPS_CUSTOM_INTERRUPTION_HELPER_V1 },
      cancelRemainingSequence: { label: 'Cancel (remaining multi-prompt sequence)', state: 'available', disposition: 'blocked_no_send' },
      originalPrompt: 'not_rendered',
    },
    keyboard: {
      plainEnter: 'emit_one_typed_current_body_plus_details_request',
      escape: 'leave_editor_focus_preserve_draft',
      ctrlOrCmdJ: 'insert_newline',
      ctrlOrCmdUpDown: 'move_by_line',
      leftRight: 'move_by_character',
    },
    authority: {
      localSequenceRuntime: false,
      localQueuePointer: false,
      localAutoSend: false,
      localAdvance: false,
      stopIsCompletionProof: false,
      customInterruptionIsCancel: false,
      hostTransport: false,
    },
    ...overrides,
  };
}

describe('UI-7 MPS continuation-popup frame renderer (§3.4)', () => {
  it('renders the locked §3.4 structure, the interruption label + helper, and footer', () => {
    const frame = renderPromptEnhancementMpsContinuationFrameV1(continuationModel());
    expect(frame).toContain('◆ NEXPATH CLI · Multi-prompt sequence');
    expect(frame).toContain('Use enhanced sequence prompt');
    expect(frame).toContain('Next sequence step: apply the fix and run the focused checkout test.');
    expect(frame).toContain('Additional details');
    expect(frame).toContain('Keep scope to the payments module.');
    expect(frame).toContain('I need to do something else first');
    expect(frame).toContain('Write directly in the coding agent. This same sequence prompt returns after the response.');
    expect(frame).toContain('Cancel (remaining multi-prompt sequence)');
    expect(frame).toContain(PROMPT_ENHANCEMENT_MPS_CLI_FOOTER_V1);
    const frameLines = frame.split('\n');
    expect(frameLines[0]).toBe('│ ◆ NEXPATH CLI · Multi-prompt sequence');
    expect(frameLines[frameLines.length - 1]).toBe('│ Enter send · Esc actions');
    for (const line of frameLines) expect(line.startsWith('│')).toBe(true);
    // Body → Additional details → interruption → Cancel.
    expect(frame.indexOf('Use enhanced sequence prompt')).toBeLessThan(frame.indexOf('Additional details'));
    expect(frame.indexOf('Additional details')).toBeLessThan(frame.indexOf('I need to do something else first'));
    expect(frame.indexOf('I need to do something else first')).toBeLessThan(frame.indexOf('Cancel (remaining'));
  });

  it('never repeats the Sequence plan, remaining count, or future-item details (§3.4)', () => {
    const frame = renderPromptEnhancementMpsContinuationFrameV1(continuationModel());
    expect(frame).not.toContain('Sequence plan');
    expect(frame).not.toContain('Remaining:');
    expect(frame).not.toContain('Types:');
  });

  it('never renders a forbidden surface (Use original, future text, queue, auto send/advance)', () => {
    const frame = renderPromptEnhancementMpsContinuationFrameV1(continuationModel());
    expect(frame).not.toContain('Use original');
    expect(frame).not.toMatch(/queue|pointer|automatic send|auto-send|advance/i);
  });

  it('is plain text when colorize is off and carries ANSI tones when on', () => {
    expect(renderPromptEnhancementMpsContinuationFrameV1(continuationModel(), { colorize: false })).not.toContain(ESC);
    expect(renderPromptEnhancementMpsContinuationFrameV1(continuationModel(), { colorize: true })).toContain(ESC);
  });

  it('marks only the focused interactive row across the 4 rows, clamping out-of-range focus', () => {
    const onInterruption = renderPromptEnhancementMpsContinuationFrameV1(continuationModel(), { focusIndex: 2 });
    expect(deRail(onInterruption.split('\n').find((line) => line.includes('I need to do something else first'))).startsWith('●')).toBe(true);
    expect(deRail(onInterruption.split('\n').find((line) => line.includes('Use enhanced sequence prompt'))).startsWith('●')).toBe(false);
    const clamped = renderPromptEnhancementMpsContinuationFrameV1(continuationModel(), { focusIndex: 99 });
    expect(deRail(clamped.split('\n').find((line) => line.includes('Cancel (remaining'))).startsWith('●')).toBe(true);
  });

  it('strips ANSI/control chars from model-supplied text (public-safe)', () => {
    const injected = renderPromptEnhancementMpsContinuationFrameV1(
      continuationModel({ body: { text: `${ESC}[31mred${ESC}[0mbell`, editable: true, originalPromptText: 'x' } }),
      { colorize: false },
    );
    expect(injected).not.toContain(ESC);
    expect(injected).toContain('redbell');
  });

  it('shows the Cancel row as unavailable when disabled', () => {
    const frame = renderPromptEnhancementMpsContinuationFrameV1(continuationModel({
      actions: {
        submitCurrentBody: 'typed_current_body_plus_details',
        customInterruption: { label: PROMPT_ENHANCEMENT_MPS_CUSTOM_INTERRUPTION_LABEL_V1, helper: PROMPT_ENHANCEMENT_MPS_CUSTOM_INTERRUPTION_HELPER_V1 },
        cancelRemainingSequence: { label: 'Cancel (remaining multi-prompt sequence)', state: 'disabled', disposition: 'blocked_no_send' },
        originalPrompt: 'not_rendered',
      },
    }));
    expect(frame).toContain('Cancel (remaining multi-prompt sequence)  (unavailable)');
  });
});

describe('UI-7 MPS continuation lifecycle proof (3 paths)', () => {
  it('path 1 — send the current item emits exactly one typed send_current_body intent', () => {
    const model = continuationModel();
    const result = createPromptEnhancementMpsContinuationSendIntentV1(model, { editedBodyText: model.body.text });
    expect(result.state).toBe('intent_ready');
    if (result.state !== 'intent_ready') throw new Error('expected intent');
    expect(result.intent.type).toBe('send_current_body');
    expect(result.intent.identity.sequenceItemId).toBe('item-2');
  });

  it('path 2 — custom interruption is neither cancel nor completion; the same item may return', () => {
    const model = continuationModel();
    // The interruption surface is reachable and rendered.
    expect(renderPromptEnhancementMpsContinuationFrameV1(model)).toContain('I need to do something else first');
    const result = createPromptEnhancementMpsCustomInterruptionIntentV1(model);
    expect(result.state).toBe('intent_ready');
    if (result.state !== 'intent_ready') throw new Error('expected intent');
    expect(result.intent.type).toBe('custom_interruption');
    // Closing for a direct-user detour is not a cancel and not a completion — the pending item can return.
    expect(model.authority.customInterruptionIsCancel).toBe(false);
    expect(model.authority.stopIsCompletionProof).toBe(false);
    expect(model.authority.localAdvance).toBe(false);
  });

  it('path 3 — terminal cancel emits one blocked_no_send cancel intent and no send/advance', () => {
    const model = continuationModel();
    const result = createPromptEnhancementMpsContinuationCancelIntentV1(model);
    expect(result.state).toBe('intent_ready');
    if (result.state !== 'intent_ready') throw new Error('expected intent');
    expect(result.intent.type).toBe('cancel_remaining_sequence');
    expect(result.intent.disposition).toBe('blocked_no_send');
    // A disabled cancel yields no intent.
    const disabled = createPromptEnhancementMpsContinuationCancelIntentV1(continuationModel({
      actions: {
        submitCurrentBody: 'typed_current_body_plus_details',
        customInterruption: { label: PROMPT_ENHANCEMENT_MPS_CUSTOM_INTERRUPTION_LABEL_V1, helper: PROMPT_ENHANCEMENT_MPS_CUSTOM_INTERRUPTION_HELPER_V1 },
        cancelRemainingSequence: { label: 'Cancel (remaining multi-prompt sequence)', state: 'disabled', disposition: 'blocked_no_send' },
        originalPrompt: 'not_rendered',
      },
    }));
    expect(disabled.state).toBe('intent_unavailable');
  });
});
