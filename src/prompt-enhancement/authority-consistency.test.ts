import { describe, expect, it } from 'vitest';
import {
  isPromptEnhancementAuthorityConsistentV1,
  isPromptEnhancementAuthoritySelfReportV1,
} from './authority-consistency.js';
import type { PromptEnhancementStructuredComposerOutputV1 } from './compose-enhancement.js';

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
});
