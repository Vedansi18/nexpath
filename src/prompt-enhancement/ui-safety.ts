import {
  validatePromptEnhancementPrepareResultV1,
  type PromptEnhancementActionType,
  type PromptEnhancementAvailabilityState,
  type PromptEnhancementHostSurface,
  type PromptEnhancementPrepareResultV1,
  type PromptEnhancementPublicDiagnosticCategory,
  type PromptEnhancementPublicTrustCueLabel,
} from './contracts.js';
import {
  buildPromptEnhancementPopupRenderModelV1,
  PROMPT_ENHANCEMENT_EDITOR_HEADING_V1,
  PROMPT_ENHANCEMENT_POPUP_LAYOUT_V1,
  PROMPT_ENHANCEMENT_POPUP_TITLE_V1,
  type PromptEnhancementPopupRenderModelV1,
} from './popup-render-model.js';
import type {
  PromptEnhancementPopupActionAvailability,
  PromptEnhancementPopupLifecycleState,
} from './popup-session.js';
import type { PromptEnhancementUiBoundaryInputV1 } from './ui-boundary.js';

/**
 * B1.5 is deliberately a host-independent safety presentation boundary. It
 * consumes the already-typed popup model, strips private identifiers and
 * unsafe display text, and exposes only stable UI state. It does not decide
 * content-owner-owned safety meaning or perform host/transport work.
 */
export type PromptEnhancementSafeUiStateV1 =
  | 'loading'
  | 'ready'
  | 'retrying'
  | 'fallback'
  | 'unsupported'
  | 'no_send'
  | 'error_shell';

export interface PromptEnhancementSafeUiControlV1 {
  actionType: PromptEnhancementActionType;
  label: PromptEnhancementPopupRenderModelV1['controls']['currentBody']['label'];
  availability: PromptEnhancementAvailabilityState;
  uiAvailabilityState?: PromptEnhancementPopupActionAvailability;
}

export interface PromptEnhancementSafeUiModelV1 {
  state: PromptEnhancementSafeUiStateV1;
  title: typeof PROMPT_ENHANCEMENT_POPUP_TITLE_V1;
  editorHeading: typeof PROMPT_ENHANCEMENT_EDITOR_HEADING_V1;
  layout: typeof PROMPT_ENHANCEMENT_POPUP_LAYOUT_V1;
  identity?: PromptEnhancementPopupRenderModelV1['identity'];
  body?: {
    text: string;
    editable: boolean;
  };
  controls: readonly PromptEnhancementSafeUiControlV1[];
  publicCopy: {
    trustCues: readonly PromptEnhancementSafeUiTrustCueV1[];
    diagnostics: readonly PromptEnhancementSafeUiDiagnosticV1[];
    stateMessage: string;
  };
  accessibility: {
    dialogRole: 'dialog';
    onePopupOnly: true;
    keyboardTraversalRequired: true;
    visibleFocusRequired: true;
    focusTarget: 'body' | 'actions' | 'close' | 'fallback' | 'error_announcement';
    liveRegion: 'polite';
    contrastNotColorOnly: true;
  };
  safety: {
    generatedBodyExcluded: boolean;
    privateDiagnosticsExcluded: true;
    unsafeMarkupRejected: true;
    rawTransportAuthorityRejected: true;
    hostCspBoundary: 'selected_host';
  };
  reasonCodes: readonly PromptEnhancementSafeReasonCodeV1[];
}

export interface PromptEnhancementSafeUiTrustCueV1 {
  label: PromptEnhancementPublicTrustCueLabel;
  text: string;
}

export interface PromptEnhancementSafeUiDiagnosticV1 {
  category: PromptEnhancementPublicDiagnosticCategory;
  text: string;
}

export type PromptEnhancementSafeReasonCodeV1 =
  | 'invalid_or_stale_input'
  | 'typed_no_popup'
  | 'unsupported_host'
  | 'safe_fallback'
  | 'blocked_no_send'
  | 'ready';

export interface PromptEnhancementSafeUiInputV1
  extends Omit<PromptEnhancementUiBoundaryInputV1, 'result'> {
  result: unknown;
}

const SAFE_STATE_MESSAGES: Record<PromptEnhancementSafeUiStateV1, string> = {
  loading: 'Enhanced prompt is being prepared.',
  ready: 'Review the enhanced prompt before sending.',
  retrying: 'Prompt enhancement is being checked again.',
  fallback: 'Prompt enhancement is unavailable; use the available safe option.',
  unsupported: 'Prompt enhancement is not available in this host.',
  no_send: 'No message was sent.',
  error_shell: 'Prompt enhancement could not be displayed safely.',
};

const PRIVATE_DISPLAY_MARKERS = [
  /(?:^|[\\/])home[\\/]/i,
  /(?:^|[\\/])users[\\/]/i,
  /\b(?:api[_ -]?key|secret|stack trace|private path|source path|raw prompt|raw generated)\b/i,
  /\b(?:pe[-_ ]?(?:ar|dr)|gate[-_ ]?g\d+|internal diagnostic|research label)\b/i,
];

const UNSAFE_URI_MARKER = /\b(?:javascript|data|vbscript):/i;

export function buildPromptEnhancementSafeUiModelV1(
  input: PromptEnhancementSafeUiInputV1,
): PromptEnhancementSafeUiModelV1 {
  const validation = validatePromptEnhancementPrepareResultV1(input.result);
  if (!validation.ok) {
    return shell('error_shell', ['invalid_or_stale_input']);
  }

  const rendered = buildPromptEnhancementPopupRenderModelV1({
    ...input,
    result: input.result as PromptEnhancementPrepareResultV1,
  });
  if (rendered.state === 'no_popup') {
    const reason = rendered.reasonCodes.includes('typed_no_popup_disposition')
      ? 'typed_no_popup'
      : rendered.reasonCodes.includes('delivery_surface_mismatch')
        ? 'unsupported_host'
        : 'invalid_or_stale_input';
    const state = reason === 'typed_no_popup'
      ? 'no_send'
      : reason === 'unsupported_host' ? 'unsupported' : 'error_shell';
    return shell(state, [reason]);
  }

  return fromRenderModel(rendered.model);
}

function fromRenderModel(model: PromptEnhancementPopupRenderModelV1): PromptEnhancementSafeUiModelV1 {
  const state = safeStateFor(model.session.popupLifecycleState, model.session.sendabilityState, model.session.extensionCapabilityState, model.session.visibleSurfaceAckState);
  const bodyAllowed = state === 'ready';
  const trustCues = model.publicCopy.trustCues.flatMap(toSafeTrustCue);
  const diagnostics = model.publicCopy.diagnostics.flatMap(toSafeDiagnostic);
  const controls = controlsFor(model, state);
  return {
    state,
    title: model.title,
    editorHeading: model.editorHeading,
    layout: model.layout,
    identity: model.identity,
    ...(bodyAllowed ? { body: { text: escapeDisplayText(model.body.text), editable: model.body.editable } } : {}),
    controls,
    publicCopy: {
      trustCues,
      diagnostics,
      stateMessage: SAFE_STATE_MESSAGES[state],
    },
    accessibility: accessibilityFor(state),
    safety: {
      generatedBodyExcluded: !bodyAllowed,
      privateDiagnosticsExcluded: true,
      unsafeMarkupRejected: true,
      rawTransportAuthorityRejected: true,
      hostCspBoundary: 'selected_host',
    },
    reasonCodes: state === 'ready'
      ? ['ready']
      : state === 'fallback'
        ? ['safe_fallback']
        : state === 'no_send'
          ? ['blocked_no_send']
          : state === 'unsupported'
            ? ['unsupported_host']
            : ['invalid_or_stale_input'],
  };
}

function shell(
  state: PromptEnhancementSafeUiStateV1,
  reasonCodes: readonly PromptEnhancementSafeReasonCodeV1[],
): PromptEnhancementSafeUiModelV1 {
  return {
    state,
    title: PROMPT_ENHANCEMENT_POPUP_TITLE_V1,
    editorHeading: PROMPT_ENHANCEMENT_EDITOR_HEADING_V1,
    layout: PROMPT_ENHANCEMENT_POPUP_LAYOUT_V1,
    controls: [],
    publicCopy: { trustCues: [], diagnostics: [], stateMessage: SAFE_STATE_MESSAGES[state] },
    accessibility: accessibilityFor(state),
    safety: {
      generatedBodyExcluded: true,
      privateDiagnosticsExcluded: true,
      unsafeMarkupRejected: true,
      rawTransportAuthorityRejected: true,
      hostCspBoundary: 'selected_host',
    },
    reasonCodes,
  };
}

function safeStateFor(
  lifecycleState: PromptEnhancementPopupLifecycleState,
  sendabilityState: PromptEnhancementSafeUiModelV1['state'] extends never ? never : PromptEnhancementPopupRenderModelV1['session']['sendabilityState'],
  extensionCapabilityState: PromptEnhancementPopupRenderModelV1['session']['extensionCapabilityState'],
  visibleSurfaceAckState: PromptEnhancementPopupRenderModelV1['session']['visibleSurfaceAckState'],
): PromptEnhancementSafeUiStateV1 {
  if (extensionCapabilityState === 'extension_payload_mismatch' || extensionCapabilityState === 'extension_fallback_non_old_copy_unavailable') {
    return 'unsupported';
  }
  if (visibleSurfaceAckState === 'unsupported_host_or_extension' || visibleSurfaceAckState === 'no_tty') return 'unsupported';
  if (lifecycleState === 'initial_loading') return 'loading';
  if (lifecycleState === 'action_loading') return 'retrying';
  if (lifecycleState === 'validation_repair') return 'retrying';
  if (lifecycleState === 'fallback_current_or_original' || sendabilityState === 'original_only') return 'fallback';
  if (
    lifecycleState === 'not_applicable_no_popup'
    || lifecycleState === 'blocked_or_no_send_high_risk'
    || lifecycleState === 'skipped_or_rejected'
    || lifecycleState === 'delivered_to_input'
    || sendabilityState === 'no_send'
    || sendabilityState === 'no_popup'
  ) return 'no_send';
  return 'ready';
}

function controlsFor(model: PromptEnhancementPopupRenderModelV1, state: PromptEnhancementSafeUiStateV1): readonly PromptEnhancementSafeUiControlV1[] {
  if (state === 'error_shell' || state === 'unsupported' || state === 'no_send') return [];
  const entries = [
    model.controls.currentBody,
    model.controls.original,
    ...model.controls.directional.map((item) => ({
      actionType: item.action.actionType,
      label: item.action.label,
      availability: item.action.availability,
      uiAvailabilityState: item.uiAvailabilityState,
    })),
    ...(model.controls.additionalDetails ? [model.controls.additionalDetails] : []),
    ...(model.controls.feedback ? [model.controls.feedback] : []),
    model.controls.close,
  ];
  return entries.map((entry) => ({
    actionType: entry.actionType,
    label: entry.label,
    availability: entry.availability,
    ...('uiAvailabilityState' in entry ? { uiAvailabilityState: entry.uiAvailabilityState } : {}),
  }));
}

function accessibilityFor(state: PromptEnhancementSafeUiStateV1): PromptEnhancementSafeUiModelV1['accessibility'] {
  return {
    dialogRole: 'dialog',
    onePopupOnly: true,
    keyboardTraversalRequired: true,
    visibleFocusRequired: true,
    focusTarget: state === 'ready' ? 'body' : state === 'fallback' || state === 'unsupported' ? 'fallback' : state === 'no_send' ? 'close' : 'error_announcement',
    liveRegion: 'polite',
    contrastNotColorOnly: true,
  };
}

function toSafeTrustCue(cue: PromptEnhancementPopupRenderModelV1['publicCopy']['trustCues'][number]): PromptEnhancementSafeUiTrustCueV1[] {
  const text = safePublicText(cue.publicSafeText);
  return text === undefined ? [] : [{ label: cue.label, text }];
}

function toSafeDiagnostic(diagnostic: PromptEnhancementPopupRenderModelV1['publicCopy']['diagnostics'][number]): PromptEnhancementSafeUiDiagnosticV1[] {
  const text = safePublicText(diagnostic.publicSafeText);
  return text === undefined ? [] : [{ category: diagnostic.category, text }];
}

function safePublicText(value: string): string | undefined {
  if (PRIVATE_DISPLAY_MARKERS.some((marker) => marker.test(value)) || UNSAFE_URI_MARKER.test(value)) return undefined;
  return escapeDisplayText(value);
}

function escapeDisplayText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

