import { describe, it, expect } from 'vitest';
import { topicKeywords, topicAnchorWords, retainsTopicAnchor } from './content-anchor.js';

const cell = (option: string, whyDesc: string) => ({ option, whyDesc });

describe('content-anchor — topic anchor retention', () => {
  it('an absence topic has detection keywords + anchor words; a stage transition has neither', () => {
    expect(topicKeywords('ABSENCE_TEST_CREATION').length).toBeGreaterThan(0);
    expect(topicAnchorWords('ABSENCE_TEST_CREATION')).toContain('test');
    expect(topicKeywords('IDEA_TO_PRD')).toEqual([]);
    expect(topicAnchorWords('IDEA_TO_PRD')).toEqual([]);
  });

  it('anchor words drop the cross-topic action verbs/stopwords', () => {
    const anchors = topicAnchorWords('ABSENCE_TEST_CREATION');
    expect(anchors).not.toContain('write'); // verb — filtered
    expect(anchors).not.toContain('add');
    expect(anchors).not.toContain('the');
  });

  it('keyword-bearing topic: served iff the cell keeps an anchor word', () => {
    const preset = cell('write tests for this module', 'add test coverage');
    expect(retainsTopicAnchor('ABSENCE_TEST_CREATION', cell('personalized test option', 'covers the tests'), preset)).toBe(true);
    expect(retainsTopicAnchor('ABSENCE_TEST_CREATION', cell('unrelated wording only', 'off subject entirely'), preset)).toBe(false);
    expect(retainsTopicAnchor('ABSENCE_TEST_CREATION', cell('', ''), preset)).toBe(false); // empty never retains
  });

  it('keyword-less topic: served iff the cell overlaps the preset words', () => {
    const preset = cell('before proceeding, is the plan written?', 'sketch the plan first');
    expect(retainsTopicAnchor('IDEA_TO_PRD', cell('my personalized plan option', 'the plan matters here'), preset)).toBe(true); // shares "plan"
    expect(retainsTopicAnchor('IDEA_TO_PRD', cell('xyzzy frobozz plugh', 'zork grue lantern'), preset)).toBe(false);
  });
});
