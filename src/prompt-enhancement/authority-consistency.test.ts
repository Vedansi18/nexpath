import { describe, expect, it } from 'vitest';
import {
  isPromptEnhancementAuthorityConsistentV1,
  isPromptEnhancementAuthoritySelfReportV1,
} from './authority-consistency.js';
import type { PromptEnhancementStructuredComposerOutputV1 } from './compose-enhancement.js';
import { promptEnhancementAuthorityModeForTextV1 } from './safety-sendability.js';

function output(
  authorityModeSelfReport?: PromptEnhancementStructuredComposerOutputV1['authorityModeSelfReport'],
): PromptEnhancementStructuredComposerOutputV1 {
  return {
    outputId: 'out-1',
    sectionDrafts: [{ sectionId: 's1', bodyText: 'body', sourceFactIds: ['f1'] }],
    composerClaims: ['claim:f1'],
    authorityModeSelfReport,
  };
}

const PLAN_PROMPT = 'Break down the work to upgrade the database driver, and plan the rollback.';
const DO_PROMPT = 'Delete the stale rows and deploy the fix.';

describe('composer authority self-report gate', () => {
  it('accepts only the three valid self-report values', () => {
    expect(isPromptEnhancementAuthoritySelfReportV1('plan_or_review')).toBe(true);
    expect(isPromptEnhancementAuthoritySelfReportV1('execute_requested')).toBe(true);
    expect(isPromptEnhancementAuthoritySelfReportV1('observe_or_literal')).toBe(true);
    expect(isPromptEnhancementAuthoritySelfReportV1('whatever')).toBe(false);
    expect(isPromptEnhancementAuthoritySelfReportV1(undefined)).toBe(false);
  });

  it('flags drift when a plan/review request produced execution wording', () => {
    expect(isPromptEnhancementAuthorityConsistentV1(PLAN_PROMPT, output('execute_requested'))).toBe(false);
  });

  it('accepts a plan/review request that stayed in plan mode', () => {
    expect(isPromptEnhancementAuthorityConsistentV1(PLAN_PROMPT, output('plan_or_review'))).toBe(true);
    expect(isPromptEnhancementAuthorityConsistentV1(PLAN_PROMPT, output('observe_or_literal'))).toBe(true);
  });

  it('does NOT flag execution wording when the user already asked for execution', () => {
    expect(isPromptEnhancementAuthorityConsistentV1(DO_PROMPT, output('execute_requested'))).toBe(true);
  });

  // A missing field must not burn the retry budget — the deterministic gate still runs regardless.
  it('treats a missing self-report as consistent', () => {
    expect(isPromptEnhancementAuthorityConsistentV1(PLAN_PROMPT, output(undefined))).toBe(true);
  });

  /**
   * The gate used to decide "was this a plan/review request?" from a word list alone — the same
   * fragile mechanism that misfires on the generated body, one layer up. A request with no listed
   * planning verb read as `observe_or_literal`, and the gate then skipped itself entirely.
   *
   * That was survivable only while a broad deterministic rule caught the drift downstream. With that
   * rule narrowed to a floor, the miss would go uncaught — so the model's own reading of the request
   * is accepted as an alternative source.
   */
  describe('either source can establish that the request was plan-shaped', () => {
    // Plainly a request to review/understand, but it carries no listed planning verb.
    const MISREAD_PLAN_PROMPT = 'Walk me through how the refunds flow behaves today.';

    it('confirms the premise: the word list does NOT read this request as plan/review', () => {
      expect(promptEnhancementAuthorityModeForTextV1(MISREAD_PLAN_PROMPT)).not.toBe('plan_or_review');
    });

    it('without the model reading, the gate skips itself — the hole', () => {
      expect(isPromptEnhancementAuthorityConsistentV1(MISREAD_PLAN_PROMPT, output('execute_requested'))).toBe(true);
    });

    it('with the model reading, the drift is caught', () => {
      expect(isPromptEnhancementAuthorityConsistentV1(
        MISREAD_PLAN_PROMPT,
        { ...output('execute_requested'), requestModeSelfReport: 'plan_or_review' },
      )).toBe(false);
    });

    it('the model reading cannot ACQUIT a request the word list already flagged', () => {
      // Model says the request was execution; the word list says plan. The gate must still fire.
      expect(isPromptEnhancementAuthorityConsistentV1(
        PLAN_PROMPT,
        { ...output('execute_requested'), requestModeSelfReport: 'execute_requested' },
      )).toBe(false);
    });

    it('a genuine execution request is still not flagged by either source', () => {
      expect(isPromptEnhancementAuthorityConsistentV1(
        DO_PROMPT,
        { ...output('execute_requested'), requestModeSelfReport: 'execute_requested' },
      )).toBe(true);
    });
  });
});
