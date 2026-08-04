import { describe, expect, it } from 'vitest';

/**
 * UI-0 — Source-control and exact acceptance baseline.
 *
 * This is the process/test entry gate for the terminal-ui-alignment plan. It
 * makes NO product-visible change: the live `cli-submit-popup.ts` renderer is
 * untouched. UI-0 delivers two things and nothing more:
 *
 *  1. An acceptance oracle that fails when a forbidden target state appears —
 *     a numeric option row, a `.done` terminator, old Decision Session
 *     option-list wording, a second enhanced-send row, an auto-send marker, or
 *     MPS UI rendered without typed runtime input (plan §5 UI-0 closure).
 *  2. The current numeric-menu + `.done` renderer output recorded verbatim as
 *     the failing baseline, so the oracle demonstrably rejects today's UI.
 *
 * The live-renderer acceptance cases (UI-1..UI-4) are staged as `it.todo`
 * because the current renderer writes to `/dev/tty` and is not yet capturable;
 * they are wired once UI-1/UI-2 route rendering through an injectable stream.
 */

type PromptEnhancementCliForbiddenTargetStateV1 =
  | 'numeric_option_row'
  | 'done_terminator'
  | 'old_decision_session_wording'
  | 'second_enhanced_send_row'
  | 'auto_send_without_typed_intent'
  | 'mps_ui_without_typed_runtime';

interface PromptEnhancementCliAcceptanceInputV1 {
  frame: string;
  mpsRuntimeAuthorized?: boolean;
}

interface PromptEnhancementCliAcceptanceEvaluationV1 {
  pass: boolean;
  violations: readonly PromptEnhancementCliForbiddenTargetStateV1[];
}

const PROMPT_ENHANCEMENT_EDITOR_HEADING = 'Use enhanced prompt';
const MULTI_PROMPT_SEQUENCE_TITLE = 'Nexpath · Multi-prompt sequence';

/** Decision Session option-list phrases that must never appear in a PE frame. */
const OLD_DECISION_SESSION_WORDINGS = [
  'Show simpler options',
  'Skip for now',
  'Copy to clipboard',
] as const;

/**
 * The UI-0 acceptance oracle. Given a rendered popup frame, it reports every
 * forbidden target state present. `pass` is true only for a clean frame.
 */
function evaluatePromptEnhancementCliAcceptanceV1(
  input: PromptEnhancementCliAcceptanceInputV1,
): PromptEnhancementCliAcceptanceEvaluationV1 {
  const { frame } = input;
  const lowerFrame = frame.toLowerCase();
  const violations: PromptEnhancementCliForbiddenTargetStateV1[] = [];

  const hasNumericRow = frame
    .split('\n')
    .some((line) => /^\s*(?:[│|]\s*)?\d+\)\s/.test(line));
  if (hasNumericRow) violations.push('numeric_option_row');

  if (/\.done\b/.test(frame)) violations.push('done_terminator');

  if (OLD_DECISION_SESSION_WORDINGS.some((wording) => lowerFrame.includes(wording.toLowerCase()))) {
    violations.push('old_decision_session_wording');
  }

  // The editor heading is allowed exactly once; a second occurrence is a
  // forbidden separate enhanced-send/confirmation row (B1.1).
  const headingOccurrences = frame.split(PROMPT_ENHANCEMENT_EDITOR_HEADING).length - 1;
  if (headingOccurrences > 1) violations.push('second_enhanced_send_row');

  if (/auto[-\s]?send/i.test(frame) || /automatically send/i.test(frame)) {
    violations.push('auto_send_without_typed_intent');
  }

  if (!input.mpsRuntimeAuthorized && frame.includes(MULTI_PROMPT_SEQUENCE_TITLE)) {
    violations.push('mps_ui_without_typed_runtime');
  }

  return { pass: violations.length === 0, violations };
}

/**
 * Recorded failing baseline — the current `cli-submit-popup.ts` frame, using
 * its exact strings (numeric 1-8 menu, `└ Enter = ... choose 1-8:`).
 */
const CURRENT_NUMERIC_MENU_BASELINE_FRAME = [
  '┌────────────',
  '│ Nexpath · Prompt enhancement',
  '│',
  '│ Use enhanced prompt',
  '│   <one enhanced prompt body>',
  '│',
  '│ Additional details: (none)',
  '│',
  '│ 1) Edit enhanced prompt',
  '│ 2) Additional details',
  '│ 3) Shorter',
  '│ 4) More thorough',
  '│ 5) More project-grounded',
  '│ 6) Feedback',
  '│ 7) Use original prompt',
  '│ 8) Close (no send)',
  '└ Enter = use enhanced prompt · choose 1-8: ',
].join('\n');

/** Recorded failing baseline — the current `.done`-terminated line editor. */
const CURRENT_DONE_EDITOR_BASELINE_SAMPLE = [
  'Edit enhanced prompt',
  '<current text>',
  'Enter replacement text. Finish with a line containing only .done',
  '> ',
].join('\n');

/** The locked section 3.1 PE target frame (no numeric rows, no `.done`). */
const TARGET_PE_FRAME = [
  'Nexpath · Prompt enhancement',
  '',
  'Use enhanced prompt',
  '<one focused editable enhanced-prompt body>',
  '',
  'Additional details',
  '<one focused editable details field>',
  '',
  'Shorter',
  'More thorough',
  'More project-grounded',
  'Feedback',
  'Use original prompt',
  '',
  'Enter send enhanced · Esc actions · Ctrl+J new line',
].join('\n');

/** The locked section 3.2 PEF target sub-flow, rendered inside the PE frame. */
const TARGET_PEF_FRAME = [
  'Feedback',
  'Not relevant enough',
  'Too much or too long',
  'Other',
  'Back',
].join('\n');

describe('UI-0 acceptance oracle — forbidden target states', () => {
  it('flags a numeric option row', () => {
    const evaluation = evaluatePromptEnhancementCliAcceptanceV1({ frame: '1) Edit enhanced prompt' });
    expect(evaluation.pass).toBe(false);
    expect(evaluation.violations).toContain('numeric_option_row');
  });

  it('flags a `.done` terminator', () => {
    const evaluation = evaluatePromptEnhancementCliAcceptanceV1({
      frame: 'Finish with a line containing only .done',
    });
    expect(evaluation.pass).toBe(false);
    expect(evaluation.violations).toContain('done_terminator');
  });

  it('flags old Decision Session option-list wording', () => {
    expect(evaluatePromptEnhancementCliAcceptanceV1({ frame: 'Show simpler options →' }).violations)
      .toContain('old_decision_session_wording');
    expect(evaluatePromptEnhancementCliAcceptanceV1({ frame: 'Skip for now' }).violations)
      .toContain('old_decision_session_wording');
    expect(evaluatePromptEnhancementCliAcceptanceV1({ frame: 'Copy to clipboard — edit before sending' }).violations)
      .toContain('old_decision_session_wording');
  });

  it('flags a second enhanced-send row but allows the single editor heading', () => {
    const heading = evaluatePromptEnhancementCliAcceptanceV1({ frame: 'Use enhanced prompt\nbody' });
    expect(heading.violations).not.toContain('second_enhanced_send_row');
    const doubled = evaluatePromptEnhancementCliAcceptanceV1({
      frame: 'Use enhanced prompt\nbody\n\nUse enhanced prompt',
    });
    expect(doubled.violations).toContain('second_enhanced_send_row');
  });

  it('flags an auto-send marker', () => {
    expect(evaluatePromptEnhancementCliAcceptanceV1({ frame: 'auto-send in 3s' }).violations)
      .toContain('auto_send_without_typed_intent');
    expect(evaluatePromptEnhancementCliAcceptanceV1({ frame: 'automatically send the enhanced prompt' }).violations)
      .toContain('auto_send_without_typed_intent');
  });

  it('flags MPS UI without typed runtime and allows it once runtime is authorized', () => {
    expect(evaluatePromptEnhancementCliAcceptanceV1({ frame: MULTI_PROMPT_SEQUENCE_TITLE }).violations)
      .toContain('mps_ui_without_typed_runtime');
    expect(evaluatePromptEnhancementCliAcceptanceV1({ frame: MULTI_PROMPT_SEQUENCE_TITLE, mpsRuntimeAuthorized: true }).pass)
      .toBe(true);
  });
});

describe('UI-0 recorded failing baseline — the current renderer', () => {
  it('rejects the current numeric 1-8 menu as the failing baseline', () => {
    const evaluation = evaluatePromptEnhancementCliAcceptanceV1({ frame: CURRENT_NUMERIC_MENU_BASELINE_FRAME });
    expect(evaluation.pass).toBe(false);
    expect(evaluation.violations).toContain('numeric_option_row');
  });

  it('rejects the current `.done` line editor as the failing baseline', () => {
    const evaluation = evaluatePromptEnhancementCliAcceptanceV1({ frame: CURRENT_DONE_EDITOR_BASELINE_SAMPLE });
    expect(evaluation.pass).toBe(false);
    expect(evaluation.violations).toContain('done_terminator');
  });
});

describe('UI-0 target acceptance samples — the locked section 3.1/3.2 UI', () => {
  it('passes the locked PE target frame', () => {
    expect(evaluatePromptEnhancementCliAcceptanceV1({ frame: TARGET_PE_FRAME })).toEqual({ pass: true, violations: [] });
  });

  it('passes the locked PEF target sub-flow', () => {
    expect(evaluatePromptEnhancementCliAcceptanceV1({ frame: TARGET_PEF_FRAME })).toEqual({ pass: true, violations: [] });
  });
});

/**
 * Live-renderer acceptance cases — staged for UI-1..UI-4. These run the oracle
 * above against the real captured popup frame once the renderer is refactored
 * (UI-1/UI-2) to write to an injectable stream instead of `/dev/tty`.
 */
// UI-1 renderer, UI-2 interaction reducer + editor, and UI-3 feedback reducer +
// renderer are all unit-tested in `cli-submit-popup.test.ts`. What remains staged
// is the manual end-to-end acceptance over a real terminal (UI-4): driving the
// raw-TTY shell (keypresses, redraw, resize, feedback-on-cancel) and confirming
// the captured live PE/PEF frames pass the oracle above.
describe('UI-4 live-host acceptance (manual/staged)', () => {
  it.todo('UI-4: drive the live raw-TTY popup end-to-end and confirm captured PE/PEF frames pass the acceptance oracle');
});
