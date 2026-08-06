export type PromptEnhancementMpsInteractionSurfaceV1 = 'first_popup' | 'later_continuation';

export interface PromptEnhancementMpsInteractionAccessibilityModelV1 {
  contractVersion: 1;
  surface: PromptEnhancementMpsInteractionSurfaceV1;
  focusOrder: readonly string[];
  editorShortcuts: {
    ctrlOrCmdJ: 'insert_newline';
    ctrlOrCmdUpDown: 'move_by_line';
    leftRight: 'move_by_character';
    plainEnterInEditor: 'emit_one_current_body_plus_details_intent';
    escapeInEditor: 'leave_editor_focus_preserve_draft';
    upDownOutsideEditor: 'navigate_actions';
    enterOutsideEditor: 'activate_focused_action_only';
  };
  additionalDetails: {
    visibleBelowBody: true;
    tone: 'lighter_enhancement';
    revisionTyped: true;
    customAgentTextbox: false;
  };
  customInterruption: {
    visible: boolean;
    label: 'I need to do something else first';
    helper: 'Write directly in the coding agent. This same sequence prompt returns after the response.';
    closesWithoutPromptInjection: true;
  };
  cancel: {
    lastInteractiveAction: true;
    tone: 'muted_warning';
    label: 'Cancel (remaining multi-prompt sequence)';
    terminalityLocal: false;
  };
  sequencePlan: {
    visible: boolean;
    tone: 'dim_neutral';
    interactive: false;
    firstPopupOnly: true;
  };
  accessibility: {
    bodyLabel: 'Use enhanced sequence prompt';
    additionalDetailsLabel: 'Additional details';
    cancelLabel: 'Cancel (remaining multi-prompt sequence)';
    customInterruptionHelperVisible: boolean;
    colorIsNotAuthority: true;
    focusIsNotAuthority: true;
  };
  authority: {
    localSequenceRuntime: false;
    localPointerAdvance: false;
    localAutoSend: false;
    localTerminality: false;
    hostTransport: false;
  };
}

export function buildPromptEnhancementMpsInteractionAccessibilityModelV1(
  surface: PromptEnhancementMpsInteractionSurfaceV1,
): PromptEnhancementMpsInteractionAccessibilityModelV1 {
  const firstPopup = surface === 'first_popup';
  return {
    contractVersion: 1,
    surface,
    focusOrder: firstPopup
      ? ['enhanced_body', 'additional_details', 'cancel_remaining_sequence', 'sequence_plan']
      : ['enhanced_body', 'additional_details', 'custom_interruption', 'cancel_remaining_sequence'],
    editorShortcuts: {
      ctrlOrCmdJ: 'insert_newline',
      ctrlOrCmdUpDown: 'move_by_line',
      leftRight: 'move_by_character',
      plainEnterInEditor: 'emit_one_current_body_plus_details_intent',
      escapeInEditor: 'leave_editor_focus_preserve_draft',
      upDownOutsideEditor: 'navigate_actions',
      enterOutsideEditor: 'activate_focused_action_only',
    },
    additionalDetails: {
      visibleBelowBody: true,
      tone: 'lighter_enhancement',
      revisionTyped: true,
      customAgentTextbox: false,
    },
    customInterruption: {
      visible: !firstPopup,
      label: 'I need to do something else first',
      helper: 'Write directly in the coding agent. This same sequence prompt returns after the response.',
      closesWithoutPromptInjection: true,
    },
    cancel: {
      lastInteractiveAction: true,
      tone: 'muted_warning',
      label: 'Cancel (remaining multi-prompt sequence)',
      terminalityLocal: false,
    },
    sequencePlan: {
      visible: firstPopup,
      tone: 'dim_neutral',
      interactive: false,
      firstPopupOnly: true,
    },
    accessibility: {
      bodyLabel: 'Use enhanced sequence prompt',
      additionalDetailsLabel: 'Additional details',
      cancelLabel: 'Cancel (remaining multi-prompt sequence)',
      customInterruptionHelperVisible: !firstPopup,
      colorIsNotAuthority: true,
      focusIsNotAuthority: true,
    },
    authority: {
      localSequenceRuntime: false,
      localPointerAdvance: false,
      localAutoSend: false,
      localTerminality: false,
      hostTransport: false,
    },
  };
}
