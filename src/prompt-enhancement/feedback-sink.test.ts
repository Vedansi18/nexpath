import { describe, expect, it } from 'vitest';
import { closeStore, openStore } from '../store/db.js';
import { getPromptEnhancementFeedbackSummary } from '../store/prompt-enhancement.js';
import { recordPromptEnhancementFeedbackV1 } from './feedback-sink.js';
import type { PromptEnhancementPopupEventV1 } from './popup-session.js';

function event(overrides: Partial<PromptEnhancementPopupEventV1> = {}): PromptEnhancementPopupEventV1 {
  return {
    eventVersion: 1,
    eventType: 'explicit_feedback',
    enhancementId: 'pe:req-1',
    actionId: 'feedback:1',
    feedbackCategory: 'not_relevant_enough',
    currentBodyId: 'body-1',
    bodyRevision: 1,
    sendPolicy: 'no_send',
    editedBodyPolicy: 'not_applicable',
    additionalDetailsPolicy: 'not_applicable',
    feedbackPolicy: 'typed_scoped_feedback_only',
    firstPopupSequenceDispositionState: 'not_applicable',
    productFeedbackBoundaryState: 'separate_product_health_rating_not_pe_feedback',
    promptSubmitProcessingPolicy: 'normal_full_processing',
    closeDisposition: 'not_applicable',
    reasonCodes: ['typed_feedback_category'],
    staleOrMismatched: false,
    realUserInitiated: true,
    timestampMs: 100,
    ...overrides,
  };
}

describe('DEP-TEST-01 B1.4 feedback sink acceptance', () => {
  it('DEP-TEST-01-B1.4-01 records a typed scoped event without raw custom text', async () => {
    const store = await openStore(':memory:');
    try {
      const acknowledgement = recordPromptEnhancementFeedbackV1({
        store,
        event: event(),
        policy: {
          projectRoot: '/repo/a',
          feedbackScopeKey: 'body-1:feedback-1',
          learningEligibility: 'not_eligible',
          safetyImpactState: 'none',
        },
      });
      expect(acknowledgement.status).toBe('accepted');
      expect(getPromptEnhancementFeedbackSummary(store, '/repo/a', 'body-1:feedback-1')).toMatchObject({
        categoryCounts: [{ feedbackCategory: 'not_relevant_enough', count: 1 }],
      });
    } finally {
      closeStore(store);
    }
  });

  it('DEP-TEST-01-B1.4-02 rejects duplicate identities and invalid feedback events', async () => {
    const store = await openStore(':memory:');
    try {
      const input = {
        store,
        event: event(),
        policy: {
          projectRoot: '/repo/a',
          feedbackScopeKey: 'body-1:feedback-1',
          learningEligibility: 'not_eligible' as const,
          safetyImpactState: 'none' as const,
        },
      };
      expect(recordPromptEnhancementFeedbackV1(input).status).toBe('accepted');
      expect(recordPromptEnhancementFeedbackV1(input)).toMatchObject({
        status: 'rejected',
        reasonCodes: ['duplicate_feedback_event'],
      });
      expect(recordPromptEnhancementFeedbackV1({
        ...input,
        event: event({ sendPolicy: 'send_current' }),
      })).toMatchObject({ status: 'rejected', reasonCodes: ['feedback_no_send_policy_required'] });
    } finally {
      closeStore(store);
    }
  });
});
