import {
  createPromptEnhancementPopupEventV1,
  type PromptEnhancementPopupEventV1,
  type PromptEnhancementPopupSessionV1,
} from './popup-session.js';

export const PROMPT_ENHANCEMENT_FEEDBACK_CATEGORIES = [
  'not_relevant_enough',
  'too_much_or_too_long',
] as const;

export type PromptEnhancementFeedbackCategory =
  | (typeof PROMPT_ENHANCEMENT_FEEDBACK_CATEGORIES)[number]
  | 'custom_typed';

export type PromptEnhancementFeedbackAdapterStatusV1 =
  | 'hidden'
  | 'open'
  | 'other_editing'
  | 'submitting'
  | 'acknowledged'
  | 'unavailable';

export interface PromptEnhancementFeedbackAdapterStateV1 {
  status: PromptEnhancementFeedbackAdapterStatusV1;
  session: PromptEnhancementPopupSessionV1;
  draftText?: string;
  inFlightEventIdentity?: string;
  acknowledgementText?: string;
  reasonCodes: readonly string[];
}

export interface PromptEnhancementFeedbackAcknowledgementV1 {
  stableEventIdentity: string;
  status: 'accepted' | 'rejected' | 'unavailable';
  publicSafeText: string;
}

export type PromptEnhancementFeedbackSubmitResultV1 =
  | {
      state: 'event_ready';
      adapterState: PromptEnhancementFeedbackAdapterStateV1;
      event: PromptEnhancementPopupEventV1;
    }
  | {
      state: 'no_event';
      adapterState: PromptEnhancementFeedbackAdapterStateV1;
      reasonCodes: readonly string[];
    };


export function buildPromptEnhancementFeedbackAdapterStateV1(
  session: PromptEnhancementPopupSessionV1,
): PromptEnhancementFeedbackAdapterStateV1 {
  return { status: 'hidden', session, reasonCodes: [] };
}

export function openPromptEnhancementFeedbackV1(
  state: PromptEnhancementFeedbackAdapterStateV1,
): PromptEnhancementFeedbackAdapterStateV1 {
  if (state.session.feedbackEntry.state !== 'available' || !state.session.feedbackEntry.actionId) {
    return { ...state, status: 'unavailable', reasonCodes: ['feedback_unavailable'] };
  }
  return { ...state, status: 'open', reasonCodes: [] };
}

export function editPromptEnhancementOtherFeedbackV1(
  state: PromptEnhancementFeedbackAdapterStateV1,
  draftText: string,
): PromptEnhancementFeedbackAdapterStateV1 {
  if (state.status !== 'open' && state.status !== 'other_editing') return state;
  const boundedDraft = draftText; // content-owner sink applies the approved bound; UI keeps this draft transient only.
  return { ...state, status: 'other_editing', draftText: boundedDraft, reasonCodes: [] };
}

export function submitPromptEnhancementSuggestedFeedbackV1(
  state: PromptEnhancementFeedbackAdapterStateV1,
  category: Exclude<PromptEnhancementFeedbackCategory, 'custom_typed'>,
  timestampMs: number,
  currentBodyId = state.session.currentBodyId,
  bodyRevision = state.session.bodyRevision,
): PromptEnhancementFeedbackSubmitResultV1 {
  return submitFeedback(state, category, timestampMs, currentBodyId, bodyRevision);
}

export function submitPromptEnhancementOtherFeedbackV1(
  state: PromptEnhancementFeedbackAdapterStateV1,
  timestampMs: number,
  currentBodyId = state.session.currentBodyId,
  bodyRevision = state.session.bodyRevision,
): PromptEnhancementFeedbackSubmitResultV1 {
  const draft = state.draftText?.trim() ?? '';
  if (draft.length === 0) return noEvent(state, ['empty_custom_feedback']);
  return submitFeedback(state, 'custom_typed', timestampMs, currentBodyId, bodyRevision);
}

export function cancelPromptEnhancementFeedbackV1(
  state: PromptEnhancementFeedbackAdapterStateV1,
): PromptEnhancementFeedbackAdapterStateV1 {
  if (state.status === 'submitting') return state;
  return {
    ...state,
    status: 'hidden',
    draftText: undefined,
    inFlightEventIdentity: undefined,
    acknowledgementText: undefined,
    reasonCodes: [],
  };
}

export function resolvePromptEnhancementFeedbackAcknowledgementV1(
  state: PromptEnhancementFeedbackAdapterStateV1,
  acknowledgement: PromptEnhancementFeedbackAcknowledgementV1,
): PromptEnhancementFeedbackAdapterStateV1 {
  if (state.status !== 'submitting' || state.inFlightEventIdentity !== acknowledgement.stableEventIdentity) {
    return { ...state, reasonCodes: ['stale_or_mismatched_feedback_acknowledgement'] };
  }
  if (acknowledgement.status === 'accepted') {
    return {
      ...state,
      status: 'acknowledged',
      draftText: undefined,
      inFlightEventIdentity: undefined,
      acknowledgementText: acknowledgement.publicSafeText,
      reasonCodes: [],
    };
  }
  return {
    ...state,
    status: 'unavailable',
    draftText: undefined,
    inFlightEventIdentity: undefined,
    acknowledgementText: acknowledgement.publicSafeText,
    reasonCodes: [acknowledgement.status === 'rejected' ? 'feedback_rejected' : 'feedback_unavailable'],
  };
}

function submitFeedback(
  state: PromptEnhancementFeedbackAdapterStateV1,
  category: PromptEnhancementFeedbackCategory,
  timestampMs: number,
  currentBodyId: string,
  bodyRevision: number,
): PromptEnhancementFeedbackSubmitResultV1 {
  if (state.status !== 'open' && state.status !== 'other_editing') return noEvent(state, ['feedback_not_open']);
  if (state.session.feedbackEntry.state !== 'available' || !state.session.feedbackEntry.actionId) {
    return noEvent({ ...state, status: 'unavailable' }, ['feedback_unavailable']);
  }
  if (!Number.isFinite(timestampMs) || timestampMs < 0) return noEvent(state, ['invalid_feedback_timestamp']);

  const event = createPromptEnhancementPopupEventV1({
    session: state.session,
    eventType: 'explicit_feedback',
    actionId: state.session.feedbackEntry.actionId,
    currentBodyId,
    bodyRevision,
    feedbackCategory: category,
    timestampMs,
    realUserInitiated: true,
  });
  if (event.staleOrMismatched || event.reasonCodes.length > 0) {
    return noEvent(state, event.reasonCodes.length > 0 ? event.reasonCodes : ['stale_or_mismatched_feedback_event']);
  }
  return {
    state: 'event_ready',
    adapterState: {
      ...state,
      status: 'submitting',
      draftText: undefined,
      inFlightEventIdentity: feedbackIdentity(event),
      reasonCodes: [],
    },
    event,
  };
}

function feedbackIdentity(event: PromptEnhancementPopupEventV1): string {
  return `${event.enhancementId}:${event.actionId}:${event.currentBodyId}:${event.bodyRevision}:${event.timestampMs}`;
}

function noEvent(
  state: PromptEnhancementFeedbackAdapterStateV1,
  reasonCodes: readonly string[],
): PromptEnhancementFeedbackSubmitResultV1 {
  return { state: 'no_event', adapterState: { ...state, reasonCodes }, reasonCodes };
}
