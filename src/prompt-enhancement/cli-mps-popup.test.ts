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
    // Title is the first line and the footer is the last line, verbatim.
    const frameLines = frame.split('\n');
    expect(frameLines[0]).toBe('◆ NEXPATH CLI · Multi-prompt sequence');
    expect(frameLines[frameLines.length - 1]).toBe('Enter send · Esc actions');
    // Body precedes Additional details precedes Cancel precedes Sequence plan.
    expect(frame.indexOf('Use enhanced sequence prompt')).toBeLessThan(frame.indexOf('Additional details'));
    expect(frame.indexOf('Additional details')).toBeLessThan(frame.indexOf('Cancel (remaining'));
    expect(frame.indexOf('Cancel (remaining')).toBeLessThan(frame.indexOf('Sequence plan'));
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
    expect(high.split('\n').find((line) => line.includes('Cancel (remaining'))?.trimStart().startsWith('●')).toBe(true);
    const low = renderPromptEnhancementMpsFirstPopupFrameV1(model(), { focusIndex: -5 });
    expect(low.split('\n').find((line) => line.includes('Use enhanced sequence prompt'))?.trimStart().startsWith('●')).toBe(true);
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
    expect(cancelLine?.trimStart().startsWith('●')).toBe(true);
    expect(bodyLine?.trimStart().startsWith('●')).toBe(false);
    // The non-interactive Sequence plan never gets the focus marker.
    const planLine = onCancel.split('\n').find((line) => line.trim() === 'Sequence plan');
    expect(planLine?.trimStart().startsWith('●')).toBe(false);
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
    expect(frameLines[0]).toBe('◆ NEXPATH CLI · Multi-prompt sequence');
    expect(frameLines[frameLines.length - 1]).toBe('Enter send · Esc actions');
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
    expect(onInterruption.split('\n').find((line) => line.includes('I need to do something else first'))?.trimStart().startsWith('●')).toBe(true);
    expect(onInterruption.split('\n').find((line) => line.includes('Use enhanced sequence prompt'))?.trimStart().startsWith('●')).toBe(false);
    const clamped = renderPromptEnhancementMpsContinuationFrameV1(continuationModel(), { focusIndex: 99 });
    expect(clamped.split('\n').find((line) => line.includes('Cancel (remaining'))?.trimStart().startsWith('●')).toBe(true);
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
