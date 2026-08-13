import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PROMPT_ENHANCEMENT_FALLTHROUGH_LONG_V1,
  collectPromptEnhancementBodyAssertionFailuresV1,
  countPromptEnhancementFallThroughSentencesV1,
  findPromptEnhancementDuplicateGuidanceV1,
  isPromptEnhancementBodyAssertionCheckerCurrentV1,
  promptEnhancementGuidanceHalfV1,
} from './body-assertion-checks.js';

const COMPOSED_BODY = [
  'My original request (verbatim):',
  'The invoice PDF shows a null address for customers created after the migration. Fix it.',
  '',
  'Problem Statement:',
  '- The invoice PDF is showing a null address for customers created after the migration ran.',
  '',
  'Verification Or Test Plan:',
  '- Generate invoices for several post-migration customers and check the address field.',
].join('\n');

const FALLTHROUGH_BODY = [
  'My original request (verbatim):',
  'Fix it.',
  '',
  'Problem Statement:',
  `- Cover Problem Statement ${PROMPT_ENHANCEMENT_FALLTHROUGH_LONG_V1} — state what is required, how to implement it, and how to verify it.`,
  '',
  'Expected Actual State:',
  `- Cover Expected Actual State ${PROMPT_ENHANCEMENT_FALLTHROUGH_LONG_V1} — state what is required, how to implement it, and how to verify it.`,
].join('\n');

describe('body assertion — the mechanical checks', () => {
  it('counts zero fall-through sentences in a body the model actually wrote', () => {
    expect(countPromptEnhancementFallThroughSentencesV1(COMPOSED_BODY)).toBe(0);
  });

  it('counts every fall-through sentence, not just the first', () => {
    expect(countPromptEnhancementFallThroughSentencesV1(FALLTHROUGH_BODY)).toBe(2);
  });

  it('catches the short arm too — the wording a brevity action produces', () => {
    const short = ['Heading:', '- Cover Risk Safety Or Confirmation concretely.'].join('\n');
    expect(countPromptEnhancementFallThroughSentencesV1(short)).toBe(1);
  });

  it('does not mistake ordinary prose that merely starts with "Cover"', () => {
    const prose = ['Heading:', '- Cover the migration path in the runbook before deploying.'].join('\n');
    expect(countPromptEnhancementFallThroughSentencesV1(prose)).toBe(0);
  });

  it('drops the verbatim original so distinctness compares only the guidance', () => {
    const guidance = promptEnhancementGuidanceHalfV1(COMPOSED_BODY);
    expect(guidance).not.toContain('My original request (verbatim)');
    expect(guidance).not.toContain('The invoice PDF shows a null address');
    expect(guidance).toContain('Problem Statement:');
  });

  it('flags two prompts whose guidance is identical even when the originals differ', () => {
    const shared = ['', '', 'Problem Statement:', '- Identical guidance for both.'].join('\n');
    const duplicates = findPromptEnhancementDuplicateGuidanceV1([
      { prompt: 'first prompt', bodyText: `My original request (verbatim):\nfirst prompt${shared}` },
      { prompt: 'second prompt', bodyText: `My original request (verbatim):\nsecond prompt${shared}` },
    ]);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]).toEqual({ prompt: 'second prompt', matches: 'first prompt' });
  });

  // Regression guard for a real weakness the tests above exposed. When no blank line separates the
  // verbatim original from the guidance, an earlier version returned the remaining lines — which
  // folded the user's own prompt into the compared value. Because that text differs per prompt, two
  // genuinely identical guidance halves stopped looking identical and the check silently never
  // fired. Empty is the honest answer: no separator means no guidance section.
  it('returns empty guidance rather than folding the user prompt in when no section follows', () => {
    const noSections = 'My original request (verbatim):\njust the original, nothing after it';
    expect(promptEnhancementGuidanceHalfV1(noSections)).toBe('');

    const duplicates = findPromptEnhancementDuplicateGuidanceV1([
      { prompt: 'a', bodyText: 'My original request (verbatim):\na' },
      { prompt: 'b', bodyText: 'My original request (verbatim):\nb' },
    ]);
    expect(duplicates).toHaveLength(0);
  });

  it('does not flag prompts whose guidance genuinely differs', () => {
    const duplicates = findPromptEnhancementDuplicateGuidanceV1([
      { prompt: 'a', bodyText: 'My original request (verbatim):\na\n\nProblem Statement:\n- One.' },
      { prompt: 'b', bodyText: 'My original request (verbatim):\nb\n\nProblem Statement:\n- Two.' },
    ]);
    expect(duplicates).toHaveLength(0);
  });

  // The staleness guard, asserted against the SHIPPING renderer rather than a fixture. This is what
  // stops the live script from passing forever against a sentence that no longer exists.
  it('is current against the real renderer source', () => {
    const rendererSource = readFileSync(
      join(process.cwd(), 'src', 'prompt-enhancement', 'compose-enhancement.ts'),
      'utf8',
    );
    expect(isPromptEnhancementBodyAssertionCheckerCurrentV1(rendererSource)).toBe(true);
  });

  it('reports itself stale when the renderer no longer carries the sentence', () => {
    expect(isPromptEnhancementBodyAssertionCheckerCurrentV1('nothing relevant here')).toBe(false);
  });
});

describe('body assertion — the run-level collector', () => {
  it('passes a run where every body was composed and none repeats', () => {
    expect(collectPromptEnhancementBodyAssertionFailuresV1([
      { prompt: 'a', bodyText: COMPOSED_BODY, composed: true },
      { prompt: 'b', bodyText: 'My original request (verbatim):\nb\n\nHeading:\n- Different guidance.', composed: true },
    ])).toEqual([]);
  });

  // The hole this collector exists to close. A body the deterministic renderer produced from the
  // MAPPED section kinds carries no fall-through sentence — those twelve emit their own fixed
  // strings, which are different text — and two such bodies differ from each other because their
  // section SETS differ. So both content checks pass on wall-to-wall boilerplate. Only "did the
  // model run" catches it.
  it('fails a deterministic body that carries no fall-through sentence at all', () => {
    const allMappedConstants = [
      'My original request (verbatim):',
      'Fix the thing.',
      '',
      'Verification Or Test Plan:',
      '- Include the verification command, focused scenario, or regression check that should prove the change.',
      '',
      'Risk Safety Or Confirmation:',
      '- Name risky or irreversible actions, ask for required confirmation, and include rollback or recovery checks.',
    ].join('\n');

    expect(countPromptEnhancementFallThroughSentencesV1(allMappedConstants)).toBe(0);

    const failures = collectPromptEnhancementBodyAssertionFailuresV1([
      { prompt: 'Fix the thing.', bodyText: allMappedConstants, composed: false },
    ]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('not composed by the model');
  });

  it('reports the fall-through count and the duplicate together when both occur', () => {
    const failures = collectPromptEnhancementBodyAssertionFailuresV1([
      { prompt: 'a', bodyText: FALLTHROUGH_BODY, composed: true },
      { prompt: 'b', bodyText: FALLTHROUGH_BODY, composed: true },
    ]);
    expect(failures.filter((f) => f.includes('fall-through'))).toHaveLength(2);
    expect(failures.filter((f) => f.includes('identical guidance'))).toHaveLength(1);
  });
});
