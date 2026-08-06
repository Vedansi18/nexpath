import { describe, expect, it } from 'vitest';
import { buildPromptEnhancementMpsInteractionAccessibilityModelV1 } from './interaction-accessibility.js';

describe('stage-3-5 MPS interaction, accessibility, and visual hierarchy', () => {
  it('keeps first-popup focus order and first-only Sequence plan distinct from Cancel', () => {
    const model = buildPromptEnhancementMpsInteractionAccessibilityModelV1('first_popup');
    expect(model.focusOrder).toEqual(['enhanced_body', 'additional_details', 'cancel_remaining_sequence', 'sequence_plan']);
    expect(model.sequencePlan).toEqual({ visible: true, tone: 'dim_neutral', interactive: false, firstPopupOnly: true });
    expect(model.cancel).toMatchObject({ lastInteractiveAction: true, tone: 'muted_warning', terminalityLocal: false });
    expect(model.customInterruption.visible).toBe(false);
  });

  it('keeps later-popup keyboard/focus order and custom interruption accessible without a textbox', () => {
    const model = buildPromptEnhancementMpsInteractionAccessibilityModelV1('later_continuation');
    expect(model.focusOrder).toEqual(['enhanced_body', 'additional_details', 'custom_interruption', 'cancel_remaining_sequence']);
    expect(model.sequencePlan.visible).toBe(false);
    expect(model.customInterruption).toMatchObject({ visible: true, closesWithoutPromptInjection: true });
    expect(model.additionalDetails).toMatchObject({ visibleBelowBody: true, revisionTyped: true, customAgentTextbox: false });
  });

  it('locks keyboard and accessibility behavior without creating authority', () => {
    const model = buildPromptEnhancementMpsInteractionAccessibilityModelV1('later_continuation');
    expect(model.editorShortcuts).toEqual({
      ctrlOrCmdJ: 'insert_newline',
      ctrlOrCmdUpDown: 'move_by_line',
      leftRight: 'move_by_character',
      plainEnterInEditor: 'emit_one_current_body_plus_details_intent',
      escapeInEditor: 'leave_editor_focus_preserve_draft',
      upDownOutsideEditor: 'navigate_actions',
      enterOutsideEditor: 'activate_focused_action_only',
    });
    expect(model.accessibility.colorIsNotAuthority).toBe(true);
    expect(model.accessibility.focusIsNotAuthority).toBe(true);
    expect(model.authority).toEqual({ localSequenceRuntime: false, localPointerAdvance: false, localAutoSend: false, localTerminality: false, hostTransport: false });
  });
});
