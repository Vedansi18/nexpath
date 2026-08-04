import { createHash } from 'node:crypto';
import {
  recordPromptEnhancementFeedbackEvent,
  type PromptEnhancementFeedbackCategory,
  type PromptEnhancementFeedbackInput,
} from '../store/prompt-enhancement.js';
import type { Store } from '../store/db.js';
import type { PromptEnhancementPopupEventV1 } from './popup-session.js';

/**
 * Hiren-owned policy inputs which must be supplied by the application/store
 * boundary.  The popup adapter deliberately does not guess learning or safety
 * semantics from a visible label or from the custom-feedback draft.
 */
export interface PromptEnhancementFeedbackSinkPolicyV1 {
  projectRoot: string;
  feedbackScopeKey: string;
  learningEligibility: PromptEnhancementFeedbackInput['learningEligibility'];
  safetyImpactState: PromptEnhancementFeedbackInput['safetyImpactState'];
  memoryEvidence?: boolean;
}

export interface PromptEnhancementFeedbackSinkInputV1 {
  store: Store;
  event: PromptEnhancementPopupEventV1;
  policy: PromptEnhancementFeedbackSinkPolicyV1;
}

export interface PromptEnhancementFeedbackSinkAcknowledgementV1 {
  stableEventIdentity: string;
  status: 'accepted' | 'rejected' | 'unavailable';
  reasonCodes: readonly string[];
}

/**
 * Persist one already-validated, typed PE feedback event through the focused
 * store port.  This is intentionally not a UI-owned learning implementation:
 * scope, eligibility, safety impact, and memory evidence remain explicit
 * Hiren/store policy inputs.
 */
export function recordPromptEnhancementFeedbackV1(
  input: PromptEnhancementFeedbackSinkInputV1,
): PromptEnhancementFeedbackSinkAcknowledgementV1 {
  const stableEventIdentity = feedbackEventIdentity(input.event);
  const invalidReason = validateEvent(input.event);
  if (invalidReason) {
    return { stableEventIdentity, status: 'rejected', reasonCodes: [invalidReason] };
  }

  const feedbackCategory = input.event.feedbackCategory as PromptEnhancementFeedbackCategory;
  const storeInput: PromptEnhancementFeedbackInput = {
    feedbackEventId: stableEventIdentity,
    projectRoot: input.policy.projectRoot,
    enhancementId: input.event.enhancementId,
    bodyId: input.event.currentBodyId,
    bodyRevision: input.event.bodyRevision,
    feedbackCategory,
    feedbackScopeKey: input.policy.feedbackScopeKey,
    learningEligibility: input.policy.learningEligibility,
    safetyImpactState: input.policy.safetyImpactState,
    memoryEvidence: input.policy.memoryEvidence,
    reasonCodes: input.event.reasonCodes,
    now: input.event.timestampMs,
  };

  try {
    const inserted = recordPromptEnhancementFeedbackEvent(input.store, storeInput);
    return {
      stableEventIdentity,
      status: inserted ? 'accepted' : 'rejected',
      reasonCodes: inserted ? [] : ['duplicate_feedback_event'],
    };
  } catch {
    return {
      stableEventIdentity,
      status: 'unavailable',
      reasonCodes: ['feedback_sink_unavailable'],
    };
  }
}

export function feedbackEventIdentity(event: Pick<PromptEnhancementPopupEventV1, 'enhancementId' | 'actionId' | 'currentBodyId' | 'bodyRevision' | 'timestampMs'>): string {
  const canonicalIdentity = [
    event.enhancementId,
    event.actionId,
    event.currentBodyId,
    String(event.bodyRevision),
    String(event.timestampMs),
  ].join('\u001f');
  return `pe-feedback:${createHash('sha256').update(canonicalIdentity).digest('hex')}`;
}

function validateEvent(event: PromptEnhancementPopupEventV1): string | undefined {
  if (event.eventType !== 'explicit_feedback') return 'feedback_event_type_required';
  if (!event.feedbackCategory) return 'feedback_category_required';
  if (event.feedbackPolicy !== 'typed_scoped_feedback_only') return 'typed_feedback_policy_required';
  if (event.sendPolicy !== 'no_send') return 'feedback_no_send_policy_required';
  if (event.staleOrMismatched) return 'stale_feedback_event';
  if (event.realUserInitiated !== true) return 'real_user_feedback_required';
  if (!Number.isFinite(event.timestampMs) || event.timestampMs < 0) return 'invalid_feedback_timestamp';
  return undefined;
}
