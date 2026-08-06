import { describe, expect, it } from 'vitest';
import { closeStore, openStore } from '../store/db.js';
import { getPromptEnhancementFeedbackSummary, queryRelevantPromptEnhancementMemory } from '../store/prompt-enhancement.js';
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

describe('DEP-TEST-01 stage-1-4 feedback sink acceptance', () => {
  it('DEP-TEST-01-stage-1-4-01 records a typed scoped event without raw custom text', async () => {
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

  it('DEP-TEST-01-stage-1-4-02 rejects duplicate identities and invalid feedback events', async () => {
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

  it('P8-G2: eligible feedback through the sink becomes missing-signal memory evidence', async () => {
    const store = await openStore(':memory:');
    try {
      const acknowledgement = recordPromptEnhancementFeedbackV1({
        store,
        event: event({ feedbackCategory: 'user_deleted_generated_section' }),
        policy: {
          projectRoot: '/repo/a',
          feedbackScopeKey: 'sig-verification',
          learningEligibility: 'eligible_scoped',
          safetyImpactState: 'none',
          memoryEvidence: true,
        },
      });
      expect(acknowledgement.status).toBe('accepted');
      // The event-only writer never wrote memory; the bridge now does.
      const memory = queryRelevantPromptEnhancementMemory(store, '/repo/a', ['sig-verification']);
      expect(memory).toHaveLength(1);
      expect(memory[0].signalKey).toBe('sig-verification');
      expect(memory[0].currentEvidenceState).toBe('feedback_derived');
      expect(memory[0].negativeCount).toBe(1);
    } finally {
      closeStore(store);
    }
  });

  it('P8-G2: non-eligible / safety-impacting feedback records the event but NOT memory evidence', async () => {
    const store = await openStore(':memory:');
    try {
      // eligible category + memoryEvidence, but safety floor touched -> must not learn.
      recordPromptEnhancementFeedbackV1({
        store,
        event: event({ feedbackCategory: 'user_deleted_generated_section' }),
        policy: {
          projectRoot: '/repo/a',
          feedbackScopeKey: 'sig-safety',
          learningEligibility: 'eligible_scoped',
          safetyImpactState: 'safety_floor_touched',
          memoryEvidence: true,
        },
      });
      expect(queryRelevantPromptEnhancementMemory(store, '/repo/a', ['sig-safety'])).toEqual([]);
      // the event itself is still recorded
      expect(getPromptEnhancementFeedbackSummary(store, '/repo/a', 'sig-safety')).toMatchObject({
        categoryCounts: [{ feedbackCategory: 'user_deleted_generated_section', count: 1 }],
      });
    } finally {
      closeStore(store);
    }
  });
});
