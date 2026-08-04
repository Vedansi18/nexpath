import type { PromptEnhancementPopupSessionV1 } from './popup-session.js';

export interface PromptEnhancementDraftIdentityV1 {
  enhancementId: string;
  currentBodyId: string;
  bodyRevision: number;
  validationDecisionId: string;
}

export interface PromptEnhancementLocalEditorDraftV1 {
  text: string;
  cursorOffset: number;
  viewportTopLine: number;
  viewportLeftColumn: number;
  dirty: boolean;
}

export interface PromptEnhancementLocalDraftStateV1 {
  identity: PromptEnhancementDraftIdentityV1;
  currentBody: PromptEnhancementLocalEditorDraftV1;
  additionalDetails: PromptEnhancementLocalEditorDraftV1;
  editabilityState: PromptEnhancementPopupSessionV1['preSendBoundaryState']['editabilityState'];
  additionalDetailsState: PromptEnhancementPopupSessionV1['additionalDetailsState'];
}

export type PromptEnhancementLocalDraftBuildResultV1 =
  | { state: 'draft_ready'; draft: PromptEnhancementLocalDraftStateV1 }
  | { state: 'no_draft'; reasonCodes: readonly string[] };

export type PromptEnhancementLocalDraftReconcileResultV1 =
  | { state: 'updated'; identityChanged: boolean; draft: PromptEnhancementLocalDraftStateV1 }
  | { state: 'ignored_stale'; reasonCodes: readonly ['stale_or_mismatched_draft']; draft: PromptEnhancementLocalDraftStateV1 }
  | { state: 'no_draft'; reasonCodes: readonly string[] };

function identityFor(session: PromptEnhancementPopupSessionV1): PromptEnhancementDraftIdentityV1 {
  return {
    enhancementId: session.enhancementId,
    currentBodyId: session.currentBodyId,
    bodyRevision: session.bodyRevision,
    validationDecisionId: session.validationDecisionId,
  };
}

function sameIdentity(
  left: PromptEnhancementDraftIdentityV1,
  right: PromptEnhancementDraftIdentityV1,
): boolean {
  return left.enhancementId === right.enhancementId
    && left.currentBodyId === right.currentBodyId
    && left.bodyRevision === right.bodyRevision
    && left.validationDecisionId === right.validationDecisionId;
}

function clampCursor(text: string, cursorOffset: number): number {
  if (!Number.isFinite(cursorOffset)) return text.length;
  return Math.max(0, Math.min(text.length, Math.trunc(cursorOffset)));
}

function nonNegativeInteger(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

function field(
  text: string,
  cursorOffset = text.length,
  viewportTopLine = 0,
  viewportLeftColumn = 0,
  dirty = false,
): PromptEnhancementLocalEditorDraftV1 {
  return {
    text,
    cursorOffset: clampCursor(text, cursorOffset),
    viewportTopLine: nonNegativeInteger(viewportTopLine),
    viewportLeftColumn: nonNegativeInteger(viewportLeftColumn),
    dirty,
  };
}

function validSession(session: PromptEnhancementPopupSessionV1): boolean {
  return session.currentBodyText.trim().length > 0
    && session.enhancementId.trim().length > 0
    && session.currentBodyId.trim().length > 0
    && session.validationDecisionId.trim().length > 0
    && Number.isInteger(session.bodyRevision)
    && session.bodyRevision >= 0;
}

function draftFor(
  session: PromptEnhancementPopupSessionV1,
  currentBody: PromptEnhancementLocalEditorDraftV1,
  additionalDetails: PromptEnhancementLocalEditorDraftV1,
  additionalDetailsState = additionalDetails.dirty ? 'dirty_unsubmitted' : session.additionalDetailsState,
): PromptEnhancementLocalDraftStateV1 {
  return {
    identity: identityFor(session),
    currentBody,
    additionalDetails,
    editabilityState: session.preSendBoundaryState.editabilityState,
    additionalDetailsState,
  };
}

/**
 * Build ephemeral B1.2 local draft state from the typed popup session.
 * This model has no store, telemetry, clipboard, host, or delivery side effect.
 */
export function buildPromptEnhancementLocalDraftV1(
  session: PromptEnhancementPopupSessionV1,
): PromptEnhancementLocalDraftBuildResultV1 {
  if (!validSession(session)) {
    return { state: 'no_draft', reasonCodes: ['invalid_or_blank_current_body'] };
  }
  return {
    state: 'draft_ready',
    draft: draftFor(session, field(session.currentBodyText), field(''), session.additionalDetailsState),
  };
}

/**
 * Reconcile a typed re-render with local ephemeral state. Dirty matching drafts
 * win over redraws; a new canonical identity always starts a separate draft.
 */
export function reconcilePromptEnhancementLocalDraftV1(
  draft: PromptEnhancementLocalDraftStateV1,
  session: PromptEnhancementPopupSessionV1,
  staleOrMismatched = false,
): PromptEnhancementLocalDraftReconcileResultV1 {
  if (staleOrMismatched) {
    return { state: 'ignored_stale', reasonCodes: ['stale_or_mismatched_draft'], draft };
  }
  if (!validSession(session)) {
    return { state: 'no_draft', reasonCodes: ['invalid_or_blank_current_body'] };
  }

  const incomingIdentity = identityFor(session);
  if (!sameIdentity(draft.identity, incomingIdentity)) {
    const next = buildPromptEnhancementLocalDraftV1(session);
    if (next.state === 'no_draft') return next;
    return { state: 'updated', identityChanged: true, draft: next.draft };
  }

  const currentBody = draft.currentBody.dirty
    ? draft.currentBody
    : field(session.currentBodyText, draft.currentBody.cursorOffset, draft.currentBody.viewportTopLine, draft.currentBody.viewportLeftColumn);
  const additionalDetails = draft.additionalDetails.dirty
    ? draft.additionalDetails
    : field('', draft.additionalDetails.cursorOffset, draft.additionalDetails.viewportTopLine, draft.additionalDetails.viewportLeftColumn);
  return {
    state: 'updated',
    identityChanged: false,
    draft: draftFor(session, currentBody, additionalDetails, additionalDetails.dirty ? 'dirty_unsubmitted' : session.additionalDetailsState),
  };
}

export function updatePromptEnhancementCurrentBodyDraftV1(
  draft: PromptEnhancementLocalDraftStateV1,
  text: string,
  cursorOffset = text.length,
): PromptEnhancementLocalDraftStateV1 {
  if (draft.editabilityState !== 'editable' || text.trim().length === 0) return draft;
  return {
    ...draft,
    currentBody: field(text, cursorOffset, draft.currentBody.viewportTopLine, draft.currentBody.viewportLeftColumn, true),
  };
}

export function updatePromptEnhancementAdditionalDetailsDraftV1(
  draft: PromptEnhancementLocalDraftStateV1,
  text: string,
  cursorOffset = text.length,
): PromptEnhancementLocalDraftStateV1 {
  if (draft.editabilityState !== 'editable') return draft;
  return {
    ...draft,
    additionalDetails: field(text, cursorOffset, draft.additionalDetails.viewportTopLine, draft.additionalDetails.viewportLeftColumn, text.length > 0),
    additionalDetailsState: text.length > 0 ? 'dirty_unsubmitted' : 'empty',
  };
}
