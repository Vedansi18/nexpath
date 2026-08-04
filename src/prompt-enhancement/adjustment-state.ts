import {
  validatePromptEnhancementPrepareResultV1,
  type PromptEnhancementActionEntryV1,
  type PromptEnhancementActionType,
  type PromptEnhancementPrepareResultV1,
} from './contracts.js';
import type { PromptEnhancementLocalDraftStateV1 } from './local-draft.js';
import type { PromptEnhancementPopupSessionV1 } from './popup-session.js';

export type PromptEnhancementAdjustmentActionType = Extract<
  PromptEnhancementActionType,
  'shorter' | 'more_thorough' | 'more_project_grounded'
>;

const ADJUSTMENT_ACTIONS: readonly PromptEnhancementAdjustmentActionType[] = [
  'shorter',
  'more_thorough',
  'more_project_grounded',
];

export type PromptEnhancementAdjustmentSurfaceV1 = 'main' | 'refinement' | 'terminal';

export interface PromptEnhancementAdjustmentPresentationSnapshotV1 {
  session: PromptEnhancementPopupSessionV1;
  draft: PromptEnhancementLocalDraftStateV1;
  focusedField: 'enhanced_body' | 'additional_details' | null;
  selectedActionId: string;
  additionalDetailsRevision: number;
  mainDraftRevision: number;
}

export interface PromptEnhancementAdjustmentBaseIdentityV1 {
  enhancementId: string;
  currentBodyId: string;
  bodyRevision: number;
  validationDecisionId: string;
  mainDraftRevision: number;
  additionalDetailsRevision: number;
}

export interface PromptEnhancementAdjustmentRequestIdentityV1
  extends PromptEnhancementAdjustmentBaseIdentityV1 {
  requestId: string;
  actionId: string;
  actionType: PromptEnhancementAdjustmentActionType;
  sequence: number;
}

export interface PromptEnhancementAdjustmentCacheEntryV1 {
  actionId: string;
  actionType: PromptEnhancementAdjustmentActionType;
  base: PromptEnhancementAdjustmentBaseIdentityV1;
  requestId: string;
  refinedBodyId: string;
  refinedBodyRevision: number;
  result: PromptEnhancementPrepareResultV1;
  session: PromptEnhancementPopupSessionV1;
  draft: PromptEnhancementLocalDraftStateV1;
  focusedField: 'enhanced_body' | 'additional_details' | null;
  selectedActionId: string;
}

export interface PromptEnhancementAdjustmentInFlightV1 {
  request: PromptEnhancementAdjustmentRequestIdentityV1;
  action: PromptEnhancementActionEntryV1;
}

export interface PromptEnhancementAdjustmentStateV1 {
  surface: PromptEnhancementAdjustmentSurfaceV1;
  mainSnapshot: PromptEnhancementAdjustmentPresentationSnapshotV1;
  refinement?: {
    action: PromptEnhancementActionEntryV1;
    base: PromptEnhancementAdjustmentBaseIdentityV1;
    status: 'loading' | 'ready' | 'failed_keep_previous';
    session?: PromptEnhancementPopupSessionV1;
    draft?: PromptEnhancementLocalDraftStateV1;
    focusedField?: 'enhanced_body' | 'additional_details' | null;
    selectedActionId?: string;
    result?: PromptEnhancementPrepareResultV1;
  };
  inFlight?: PromptEnhancementAdjustmentInFlightV1;
  cache: readonly PromptEnhancementAdjustmentCacheEntryV1[];
  nextRequestSequence: number;
  invalidatedRequestIds: readonly string[];
  reasonCodes: readonly string[];
}

export type PromptEnhancementAdjustmentSelectionResultV1 =
  | {
      state: 'request_required';
      adjustmentState: PromptEnhancementAdjustmentStateV1;
      request: PromptEnhancementAdjustmentRequestIdentityV1;
    }
  | {
      state: 'cached_refinement_restored';
      adjustmentState: PromptEnhancementAdjustmentStateV1;
      cache: PromptEnhancementAdjustmentCacheEntryV1;
    }
  | {
      state: 'no_request';
      adjustmentState: PromptEnhancementAdjustmentStateV1;
      reasonCodes: readonly string[];
    };

export type PromptEnhancementAdjustmentResolutionResultV1 =
  | {
      state: 'accepted_refinement';
      adjustmentState: PromptEnhancementAdjustmentStateV1;
      cache: PromptEnhancementAdjustmentCacheEntryV1;
    }
  | {
      state: 'stale_result_ignored' | 'failed_keep_previous';
      adjustmentState: PromptEnhancementAdjustmentStateV1;
      reasonCodes: readonly string[];
    };

function isAdjustmentAction(actionType: PromptEnhancementActionType): actionType is PromptEnhancementAdjustmentActionType {
  return ADJUSTMENT_ACTIONS.includes(actionType as PromptEnhancementAdjustmentActionType);
}

function validNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function baseIdentityFor(
  snapshot: PromptEnhancementAdjustmentPresentationSnapshotV1,
): PromptEnhancementAdjustmentBaseIdentityV1 {
  return {
    enhancementId: snapshot.session.enhancementId,
    currentBodyId: snapshot.session.currentBodyId,
    bodyRevision: snapshot.session.bodyRevision,
    validationDecisionId: snapshot.session.validationDecisionId,
    mainDraftRevision: snapshot.mainDraftRevision,
    additionalDetailsRevision: snapshot.additionalDetailsRevision,
  };
}

function sameBase(
  left: PromptEnhancementAdjustmentBaseIdentityV1,
  right: PromptEnhancementAdjustmentBaseIdentityV1,
): boolean {
  return left.enhancementId === right.enhancementId
    && left.currentBodyId === right.currentBodyId
    && left.bodyRevision === right.bodyRevision
    && left.validationDecisionId === right.validationDecisionId
    && left.mainDraftRevision === right.mainDraftRevision
    && left.additionalDetailsRevision === right.additionalDetailsRevision;
}

function requestIdFor(
  snapshot: PromptEnhancementAdjustmentPresentationSnapshotV1,
  action: PromptEnhancementActionEntryV1,
  sequence: number,
): string {
  return `${snapshot.session.enhancementId}:adjustment:${action.actionId}:${sequence}`;
}

function withReason(
  state: PromptEnhancementAdjustmentStateV1,
  reasonCodes: readonly string[],
): PromptEnhancementAdjustmentStateV1 {
  return { ...state, reasonCodes: [...new Set(reasonCodes)] };
}

function isValidSnapshot(snapshot: PromptEnhancementAdjustmentPresentationSnapshotV1): boolean {
  return snapshot.session.enhancementId.trim().length > 0
    && snapshot.session.currentBodyId.trim().length > 0
    && snapshot.session.validationDecisionId.trim().length > 0
    && snapshot.draft.identity.enhancementId === snapshot.session.enhancementId
    && snapshot.draft.identity.currentBodyId === snapshot.session.currentBodyId
    && snapshot.draft.identity.bodyRevision === snapshot.session.bodyRevision
    && snapshot.draft.identity.validationDecisionId === snapshot.session.validationDecisionId
    && validNonNegativeInteger(snapshot.mainDraftRevision)
    && validNonNegativeInteger(snapshot.additionalDetailsRevision);
}

export function buildPromptEnhancementAdjustmentStateV1(
  snapshot: PromptEnhancementAdjustmentPresentationSnapshotV1,
): PromptEnhancementAdjustmentStateV1 {
  if (!isValidSnapshot(snapshot)) {
    throw new Error('invalid B1.3a main snapshot identity');
  }
  return {
    surface: 'main',
    mainSnapshot: snapshot,
    cache: [],
    nextRequestSequence: 1,
    invalidatedRequestIds: [],
    reasonCodes: [],
  };
}

export function selectPromptEnhancementAdjustmentV1(
  state: PromptEnhancementAdjustmentStateV1,
  action: PromptEnhancementActionEntryV1,
): PromptEnhancementAdjustmentSelectionResultV1 {
  if (state.surface !== 'main') {
    return { state: 'no_request', adjustmentState: state, reasonCodes: ['main_popup_not_visible'] };
  }
  if (!isAdjustmentAction(action.actionType)) {
    return { state: 'no_request', adjustmentState: state, reasonCodes: ['not_an_adjustment_action'] };
  }
  if (action.availability !== 'available') {
    return { state: 'no_request', adjustmentState: state, reasonCodes: ['adjustment_action_not_available'] };
  }
  if (
    action.currentBodyId !== state.mainSnapshot.session.currentBodyId
    || action.bodyRevision !== state.mainSnapshot.session.bodyRevision
  ) {
    return { state: 'no_request', adjustmentState: state, reasonCodes: ['stale_adjustment_action'] };
  }

  const base = baseIdentityFor(state.mainSnapshot);
  const cached = state.cache.find((entry) => entry.actionId === action.actionId
    && entry.actionType === action.actionType
    && sameBase(entry.base, base));
  if (cached) {
    const adjustmentState: PromptEnhancementAdjustmentStateV1 = {
      ...state,
      surface: 'refinement',
      refinement: {
        action,
        base,
        status: 'ready',
        session: cached.session,
        draft: cached.draft,
        focusedField: cached.focusedField,
        selectedActionId: cached.selectedActionId,
        result: cached.result,
      },
      inFlight: undefined,
      reasonCodes: [],
    };
    return { state: 'cached_refinement_restored', adjustmentState, cache: cached };
  }

  const sequence = state.nextRequestSequence;
  const request: PromptEnhancementAdjustmentRequestIdentityV1 = {
    ...base,
    requestId: requestIdFor(state.mainSnapshot, action, sequence),
    actionId: action.actionId,
    actionType: action.actionType,
    sequence,
  };
  const adjustmentState: PromptEnhancementAdjustmentStateV1 = {
    ...state,
    surface: 'refinement',
    refinement: { action, base, status: 'loading' },
    inFlight: { request, action },
    nextRequestSequence: sequence + 1,
    reasonCodes: [],
  };
  return { state: 'request_required', adjustmentState, request };
}

export function goBackPromptEnhancementAdjustmentV1(
  state: PromptEnhancementAdjustmentStateV1,
): PromptEnhancementAdjustmentStateV1 {
  if (state.surface !== 'refinement') return state;
  const obsoleteRequestId = state.inFlight?.request.requestId;
  return {
    ...state,
    surface: 'main',
    refinement: undefined,
    inFlight: undefined,
    invalidatedRequestIds: obsoleteRequestId
      ? [...state.invalidatedRequestIds, obsoleteRequestId]
      : state.invalidatedRequestIds,
    reasonCodes: [],
  };
}

/** Detach an unavailable/failed refinement while retaining the saved main snapshot. */
export function failPromptEnhancementAdjustmentV1(
  state: PromptEnhancementAdjustmentStateV1,
  reasonCode = 'adjustment_unavailable_keep_previous',
): PromptEnhancementAdjustmentStateV1 {
  if (state.surface !== 'refinement' || !state.inFlight) return withReason(state, [reasonCode]);
  return {
    ...state,
    inFlight: undefined,
    refinement: state.refinement
      ? { ...state.refinement, status: 'failed_keep_previous' }
      : state.refinement,
    reasonCodes: [reasonCode],
  };
}

export function updatePromptEnhancementAdjustmentMainSnapshotV1(
  state: PromptEnhancementAdjustmentStateV1,
  input: {
    draft: PromptEnhancementLocalDraftStateV1;
    focusedField: 'enhanced_body' | 'additional_details' | null;
    selectedActionId: string;
    additionalDetailsRevision: number;
  },
): PromptEnhancementAdjustmentStateV1 {
  if (state.surface !== 'main') return withReason(state, ['main_snapshot_not_editable_while_refinement_visible']);
  if (!validNonNegativeInteger(input.additionalDetailsRevision)) {
    return withReason(state, ['invalid_additional_details_revision']);
  }
  const changed = input.draft.currentBody.text !== state.mainSnapshot.draft.currentBody.text
    || input.draft.additionalDetails.text !== state.mainSnapshot.draft.additionalDetails.text
    || input.additionalDetailsRevision !== state.mainSnapshot.additionalDetailsRevision;
  const mainDraftRevision = changed
    ? state.mainSnapshot.mainDraftRevision + 1
    : state.mainSnapshot.mainDraftRevision;
  const snapshot = {
    ...state.mainSnapshot,
    ...input,
    mainDraftRevision,
  };
  return {
    ...state,
    mainSnapshot: snapshot,
    cache: changed ? [] : state.cache,
    reasonCodes: [],
  };
}

export function resolvePromptEnhancementAdjustmentV1(
  state: PromptEnhancementAdjustmentStateV1,
  input: {
    requestId?: string;
    result: unknown;
    session: PromptEnhancementPopupSessionV1;
    draft: PromptEnhancementLocalDraftStateV1;
    focusedField?: 'enhanced_body' | 'additional_details' | null;
    selectedActionId?: string;
  },
): PromptEnhancementAdjustmentResolutionResultV1 {
  const inFlight = state.inFlight;
  if (!inFlight || state.surface !== 'refinement') {
    const reasonCodes = ['no_matching_adjustment_request'];
    return {
      state: 'stale_result_ignored',
      adjustmentState: withReason(state, reasonCodes),
      reasonCodes,
    };
  }
  if (input.requestId !== undefined && input.requestId !== inFlight.request.requestId) {
    const reasonCodes = ['stale_or_superseded_adjustment_result'];
    return { state: 'stale_result_ignored', adjustmentState: withReason(state, reasonCodes), reasonCodes };
  }
  if (state.invalidatedRequestIds.includes(inFlight.request.requestId)) {
    return {
      state: 'stale_result_ignored',
      adjustmentState: withReason(state, ['stale_or_superseded_adjustment_result']),
      reasonCodes: ['stale_or_superseded_adjustment_result'],
    };
  }
  const validation = validatePromptEnhancementPrepareResultV1(input.result);
  if (!validation.ok) {
    const adjustmentState = {
      ...state,
      inFlight: undefined,
      refinement: state.refinement ? { ...state.refinement, status: 'failed_keep_previous' as const } : state.refinement,
      reasonCodes: ['invalid_adjustment_result', ...validation.reasonCodes],
    };
    return { state: 'failed_keep_previous', adjustmentState, reasonCodes: adjustmentState.reasonCodes };
  }
  const result = input.result as PromptEnhancementPrepareResultV1;
  if (
    input.session.enhancementId !== result.enhancementId
    || input.session.currentBodyId !== result.uiView.body.currentBodyId
    || input.session.bodyRevision !== result.uiView.body.bodyRevision
    || input.draft.identity.enhancementId !== result.enhancementId
    || input.draft.identity.currentBodyId !== result.uiView.body.currentBodyId
    || input.draft.identity.bodyRevision !== result.uiView.body.bodyRevision
    || input.draft.identity.validationDecisionId !== result.validationDecisionId
  ) {
    const reasonCodes = ['stale_or_superseded_adjustment_result'];
    return {
      state: 'stale_result_ignored',
      adjustmentState: { ...state, reasonCodes },
      reasonCodes,
    };
  }
  if (result.disposition === 'no_popup_not_applicable' || result.disposition === 'blocked_no_send') {
    const reasonCodes = [`adjustment_result_${result.disposition}`];
    const adjustmentState = {
      ...state,
      inFlight: undefined,
      refinement: state.refinement ? { ...state.refinement, status: 'failed_keep_previous' as const } : state.refinement,
      reasonCodes,
    };
    return { state: 'failed_keep_previous', adjustmentState, reasonCodes };
  }
  const refinement = state.refinement;
  if (!refinement) {
    const reasonCodes = ['missing_refinement_state'];
    return { state: 'stale_result_ignored', adjustmentState: withReason(state, reasonCodes), reasonCodes };
  }
  const cache: PromptEnhancementAdjustmentCacheEntryV1 = {
    actionId: refinement.action.actionId,
    actionType: refinement.action.actionType as PromptEnhancementAdjustmentActionType,
    base: refinement.base,
    requestId: inFlight.request.requestId,
    refinedBodyId: result.uiView.body.currentBodyId,
    refinedBodyRevision: result.uiView.body.bodyRevision,
    result,
    session: input.session,
    draft: input.draft,
    focusedField: input.focusedField ?? 'enhanced_body',
    selectedActionId: input.selectedActionId ?? refinement.action.actionId,
  };
  const adjustmentState: PromptEnhancementAdjustmentStateV1 = {
    ...state,
    refinement: {
      ...refinement,
      status: 'ready',
      session: input.session,
      draft: input.draft,
      focusedField: cache.focusedField,
      selectedActionId: cache.selectedActionId,
      result,
    },
    inFlight: undefined,
    cache: [...state.cache.filter((entry) => !(entry.actionId === cache.actionId && sameBase(entry.base, cache.base))), cache],
    reasonCodes: [],
  };
  return { state: 'accepted_refinement', adjustmentState, cache };
}

export function finalizePromptEnhancementAdjustmentSessionV1(
  state: PromptEnhancementAdjustmentStateV1,
  actionType: 'use_current_body' | 'use_original',
): PromptEnhancementAdjustmentStateV1 {
  if (state.surface === 'terminal') return state;
  return {
    ...state,
    surface: 'terminal',
    refinement: undefined,
    inFlight: undefined,
    cache: [],
    reasonCodes: [`terminal_${actionType}_selected`],
  };
}

