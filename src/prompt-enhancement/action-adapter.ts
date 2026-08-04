import {
  validatePromptEnhancementActionRequestV1,
  validatePromptEnhancementPrepareResultV1,
  type PromptEnhancementActionEntryV1,
  type PromptEnhancementActionFacadeV1,
  type PromptEnhancementActionRequestV1,
  type PromptEnhancementPrepareRequestV1,
  type PromptEnhancementPrepareResultV1,
} from './contracts.js';
import type { PromptEnhancementPopupSessionV1 } from './popup-session.js';

const PERMITTED_ACTIONS = new Set([
  'use_current_body',
  'use_original',
  'shorter',
  'more_thorough',
  'more_project_grounded',
  'apply_details',
  'feedback',
  'close',
]);

export interface PromptEnhancementActionRequestTokenV1 {
  tokenId: string;
  enhancementId: string;
  actionId: string;
  currentBodyId: string;
  bodyRevision: number;
  requestId: string;
}

export type PromptEnhancementActionAdapterStatusV1 =
  | 'idle'
  | 'action_loading'
  | 'merge_loading'
  | 'failed_keep_previous'
  | 'stale_result_ignored';

export interface PromptEnhancementActionAdapterStateV1 {
  status: PromptEnhancementActionAdapterStatusV1;
  session: PromptEnhancementPopupSessionV1;
  inFlight?: PromptEnhancementActionRequestTokenV1;
  reasonCodes: readonly string[];
}

export type PromptEnhancementActionBeginResultV1 =
  | {
      state: 'request_ready';
      adapterState: PromptEnhancementActionAdapterStateV1;
      request: PromptEnhancementActionRequestV1;
      token: PromptEnhancementActionRequestTokenV1;
    }
  | {
      state: 'no_request';
      adapterState: PromptEnhancementActionAdapterStateV1;
      reasonCodes: readonly string[];
    };

export type PromptEnhancementActionResolveResultV1 =
  | {
      state: 'accepted_result';
      adapterState: PromptEnhancementActionAdapterStateV1;
      result: PromptEnhancementPrepareResultV1;
    }
  | {
      state: 'failed_keep_previous' | 'stale_result_ignored';
      adapterState: PromptEnhancementActionAdapterStateV1;
      reasonCodes: readonly string[];
    };

export type PromptEnhancementActionExecutionResultV1 =
  | ({ state: 'no_request'; adapterState: PromptEnhancementActionAdapterStateV1; reasonCodes: readonly string[] })
  | ({ state: 'accepted_result'; adapterState: PromptEnhancementActionAdapterStateV1; result: PromptEnhancementPrepareResultV1 } & {
      request: PromptEnhancementActionRequestV1;
      token: PromptEnhancementActionRequestTokenV1;
    })
  | ({ state: 'failed_keep_previous' | 'stale_result_ignored'; adapterState: PromptEnhancementActionAdapterStateV1; reasonCodes: readonly string[] } & {
      request: PromptEnhancementActionRequestV1;
      token: PromptEnhancementActionRequestTokenV1;
    });

export function buildPromptEnhancementActionAdapterStateV1(
  session: PromptEnhancementPopupSessionV1,
): PromptEnhancementActionAdapterStateV1 {
  return { status: 'idle', session, reasonCodes: [] };
}

function actionIsPermitted(action: PromptEnhancementActionEntryV1): boolean {
  return PERMITTED_ACTIONS.has(action.actionType as string);
}

function actionRequestType(action: PromptEnhancementActionEntryV1): PromptEnhancementActionRequestV1['userPreferenceContext']['actionRequest'] {
  if (action.actionType === 'shorter' || action.actionType === 'more_thorough' || action.actionType === 'more_project_grounded' || action.actionType === 'apply_details') {
    return action.actionType;
  }
  return undefined;
}

export function buildPromptEnhancementActionRequestV1(input: {
  baseRequest: PromptEnhancementPrepareRequestV1;
  session: PromptEnhancementPopupSessionV1;
  action: PromptEnhancementActionEntryV1;
  editedBodyText: string;
  additionalDetailsText?: string;
  timestampMs: number;
  sectionSpanEditEvents?: PromptEnhancementActionRequestV1['currentBodyBinding']['sectionSpanEditEvents'];
}): { state: 'request_ready'; request: PromptEnhancementActionRequestV1 } | { state: 'no_request'; reasonCodes: readonly string[] } {
  const { baseRequest, session, action } = input;
  const reasonCodes: string[] = [];
  if (!actionIsPermitted(action)) reasonCodes.push('unknown_action_type');
  if (action.currentBodyId !== session.currentBodyId || action.bodyRevision !== session.bodyRevision) {
    reasonCodes.push('stale_or_mismatched_action_body_binding');
  }
  if (action.availability !== 'available') reasonCodes.push('action_not_available');
  if (!Number.isFinite(input.timestampMs) || input.timestampMs < 0) reasonCodes.push('invalid_action_timestamp');
  if (input.editedBodyText.trim().length === 0 && action.actionType === 'use_current_body') {
    reasonCodes.push('missing_edited_body_text');
  }
  if (action.actionType === 'use_current_body' && session.additionalDetailsState === 'dirty_unsubmitted') {
    reasonCodes.push('dirty_additional_details_requires_apply_or_clear_before_send');
  }
  if (reasonCodes.length > 0) return { state: 'no_request', reasonCodes };

  const actionRequestTypeValue = actionRequestType(action);
  const additionalDetails = action.actionType === 'apply_details'
    ? {
        text: input.additionalDetailsText ?? '',
        targetBodyId: session.currentBodyId,
        targetBodyRevision: session.bodyRevision,
      }
    : undefined;
  const userPreferenceContext: PromptEnhancementPrepareRequestV1['userPreferenceContext'] = {
    ...baseRequest.userPreferenceContext,
    actionRequest: actionRequestTypeValue,
    additionalDetails,
  };
  const request: PromptEnhancementActionRequestV1 = {
    ...baseRequest,
    userPreferenceContext,
    action,
    currentBodyBinding: {
      currentBodyId: session.currentBodyId,
      bodyRevision: session.bodyRevision,
      validationDecisionId: session.validationDecisionId,
      editedBodyText: input.editedBodyText,
      actionSubmittedAtMs: input.timestampMs,
      realUserInitiated: true,
      sectionSpanEditEvents: input.sectionSpanEditEvents ?? [],
    },
  };
  const validation = validatePromptEnhancementActionRequestV1(request);
  if (!validation.ok) return { state: 'no_request', reasonCodes: validation.reasonCodes };
  return { state: 'request_ready', request };
}

export function beginPromptEnhancementActionV1(input: {
  adapterState: PromptEnhancementActionAdapterStateV1;
  baseRequest: PromptEnhancementPrepareRequestV1;
  action: PromptEnhancementActionEntryV1;
  editedBodyText: string;
  additionalDetailsText?: string;
  timestampMs: number;
  sectionSpanEditEvents?: PromptEnhancementActionRequestV1['currentBodyBinding']['sectionSpanEditEvents'];
}): PromptEnhancementActionBeginResultV1 {
  if (input.adapterState.inFlight) {
    return {
      state: 'no_request',
      adapterState: input.adapterState,
      reasonCodes: ['duplicate_action_while_in_flight'],
    };
  }
  const built = buildPromptEnhancementActionRequestV1({
    ...input,
    session: input.adapterState.session,
  });
  if (built.state === 'no_request') {
    return { state: 'no_request', adapterState: input.adapterState, reasonCodes: built.reasonCodes };
  }
  const token: PromptEnhancementActionRequestTokenV1 = {
    tokenId: `${input.adapterState.session.enhancementId}:${built.request.action.actionId}:${input.timestampMs}`,
    enhancementId: input.adapterState.session.enhancementId,
    actionId: built.request.action.actionId,
    currentBodyId: built.request.currentBodyBinding.currentBodyId,
    bodyRevision: built.request.currentBodyBinding.bodyRevision,
    requestId: built.request.requestId,
  };
  const adapterState: PromptEnhancementActionAdapterStateV1 = {
    ...input.adapterState,
    status: built.request.action.actionType === 'apply_details' ? 'merge_loading' : 'action_loading',
    inFlight: token,
    reasonCodes: [],
  };
  return { state: 'request_ready', adapterState, request: built.request, token };
}

/** Execute one approved action request through Hiren's typed facade boundary. */
export async function executePromptEnhancementActionV1(input: {
  adapterState: PromptEnhancementActionAdapterStateV1;
  baseRequest: PromptEnhancementPrepareRequestV1;
  action: PromptEnhancementActionEntryV1;
  editedBodyText: string;
  additionalDetailsText?: string;
  timestampMs: number;
  sectionSpanEditEvents?: PromptEnhancementActionRequestV1['currentBodyBinding']['sectionSpanEditEvents'];
  facade: PromptEnhancementActionFacadeV1;
}): Promise<PromptEnhancementActionExecutionResultV1> {
  const started = beginPromptEnhancementActionV1(input);
  if (started.state === 'no_request') return started;

  try {
    const result = await input.facade(started.request);
    const resolved = resolvePromptEnhancementActionV1(started.adapterState, result);
    return { ...resolved, request: started.request, token: started.token };
  } catch {
    const failed = failPromptEnhancementActionV1(started.adapterState, 'facade_error');
    return { ...failed, request: started.request, token: started.token };
  }
}

export function resolvePromptEnhancementActionV1(
  adapterState: PromptEnhancementActionAdapterStateV1,
  result: unknown,
): PromptEnhancementActionResolveResultV1 {
  const token = adapterState.inFlight;
  if (!token) {
    return {
      state: 'stale_result_ignored',
      adapterState: { ...adapterState, status: 'stale_result_ignored', reasonCodes: ['no_matching_action_request'] },
      reasonCodes: ['no_matching_action_request'],
    };
  }
  const validation = validatePromptEnhancementPrepareResultV1(result);
  if (!validation.ok) {
    return {
      state: 'failed_keep_previous',
      adapterState: { ...adapterState, status: 'failed_keep_previous', inFlight: undefined, reasonCodes: ['invalid_action_result', ...validation.reasonCodes] },
      reasonCodes: ['invalid_action_result', ...validation.reasonCodes],
    };
  }
  const typedResult = result as PromptEnhancementPrepareResultV1;
  if (
    typedResult.requestId !== token.requestId
    || typedResult.enhancementId !== token.enhancementId
    || typedResult.uiView.body.currentBodyId !== token.currentBodyId
    || typedResult.uiView.body.bodyRevision < token.bodyRevision
  ) {
    return {
      state: 'stale_result_ignored',
      adapterState: { ...adapterState, status: 'stale_result_ignored', reasonCodes: ['stale_or_superseded_action_result'] },
      reasonCodes: ['stale_or_superseded_action_result'],
    };
  }
  return {
    state: 'accepted_result',
    adapterState: { ...adapterState, status: 'idle', inFlight: undefined, reasonCodes: [] },
    result: typedResult,
  };
}

export function failPromptEnhancementActionV1(
  adapterState: PromptEnhancementActionAdapterStateV1,
  reasonCode: string,
): PromptEnhancementActionResolveResultV1 {
  return {
    state: 'failed_keep_previous',
    adapterState: { ...adapterState, status: 'failed_keep_previous', inFlight: undefined, reasonCodes: [reasonCode] },
    reasonCodes: [reasonCode],
  };
}
