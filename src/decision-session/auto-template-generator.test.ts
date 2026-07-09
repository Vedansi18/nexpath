import { describe, it, expect } from 'vitest';
import type OpenAI from 'openai';
import type { RightGoodProfile, RightGoodSignal, RightGoodState } from '../classifier/right-good-aggregator.js';
import {
  topicUniverse,
  signalKeyForTopic,
  classifyTopicPolarity,
  overlapsKnownMistake,
  filterEligibleTopics,
  selectDistinctiveTopics,
  applyCoverageFloor,
  generatePerUserRecord,
  generateAndStoreAutogenRecord,
} from './auto-template-generator.js';
import { validateContentTemplateRecord } from './content-template-schema.js';
import { openStore } from '../store/db.js';
import { getContentTemplate } from '../store/content-templates.js';

function rg(state: RightGoodState): RightGoodSignal {
  return { score: 0.5, state, stability: { sessions: 2, occurrences: 5, stable: true }, lastUpdated: 1 };
}
function mockClient(reply: string): OpenAI {
  return { chat: { completions: { create: async () => ({ choices: [{ message: { content: reply } }] }) } } } as unknown as OpenAI;
}

describe('auto-template-generator — topic mapping', () => {
  it('the topic universe is every shipped signalType (non-empty)', () => {
    const u = topicUniverse();
    expect(u.length).toBeGreaterThan(100);
    expect(u).toContain('ABSENCE_TEST_CREATION');
    expect(u).toContain('IDEA_TO_PRD');
  });

  it('maps an absence topic to its signal key; non-absence topics have none', () => {
    expect(signalKeyForTopic('ABSENCE_TEST_CREATION')).toBe('test_creation');
    expect(signalKeyForTopic('IDEA_TO_PRD')).toBeNull();
  });
});

describe('auto-template-generator — polarity + eligibility (AG-6 + overlap)', () => {
  const profile: RightGoodProfile = {
    test_creation: rg('right_good'),
    documentation: rg('mistake'),
    decision_fatigue_pattern: rg('neutral'),
  };

  it('classifies right/good, mistake, neutral, and non-absence topics', () => {
    expect(classifyTopicPolarity('ABSENCE_TEST_CREATION', profile)).toBe('good');
    expect(classifyTopicPolarity('ABSENCE_DOCUMENTATION', profile)).toBe('bad');
    expect(classifyTopicPolarity('ABSENCE_DECISION_FATIGUE_PATTERN', profile)).toBe('in_between');
    expect(classifyTopicPolarity('ABSENCE_UNSEEN_TOPIC', profile)).toBe('in_between'); // absent from profile → neutral
    expect(classifyTopicPolarity('IDEA_TO_PRD', profile)).toBe('in_between'); // non-absence
  });

  it('flags a neutral topic that overlaps a (−) anti-pattern', () => {
    expect(overlapsKnownMistake('ABSENCE_DECISION_FATIGUE_PATTERN')).toBe(true);
    expect(overlapsKnownMistake('ABSENCE_TEST_CREATION')).toBe(false);
    expect(overlapsKnownMistake('IDEA_TO_PRD')).toBe(false);
  });

  it('keeps good + safe-neutral topics, drops mistake-mapped and anti-pattern-overlapping ones', () => {
    const universe = ['ABSENCE_TEST_CREATION', 'ABSENCE_DOCUMENTATION', 'ABSENCE_DECISION_FATIGUE_PATTERN', 'IDEA_TO_PRD'];
    expect(filterEligibleTopics(universe, profile)).toEqual(['ABSENCE_TEST_CREATION', 'IDEA_TO_PRD']);
  });

  it('drops every topic when all map to mistakes (nothing eligible)', () => {
    const universe = ['ABSENCE_TEST_CREATION', 'ABSENCE_DOCUMENTATION'];
    const allBad: RightGoodProfile = { test_creation: rg('mistake'), documentation: rg('mistake') };
    expect(filterEligibleTopics(universe, allBad)).toEqual([]);
  });
});

describe('auto-template-generator — selection call (mocked)', () => {
  const profile: RightGoodProfile = { test_creation: rg('right_good') };

  it('returns ranked eligible topics; drops unknown topics and clamps confidence', async () => {
    const client = mockClient(JSON.stringify({
      topics: [
        { signalType: 'ABSENCE_TEST_CREATION', confidence: 0.9 },
        { signalType: 'TOTALLY_NOT_A_TOPIC', confidence: 0.8 }, // not in the universe → dropped
        { signalType: 'IDEA_TO_PRD', confidence: 1.5 },         // clamped to 1
      ],
    }));
    const out = await selectDistinctiveTopics({ rightGood: profile, patternSummary: 'summary' }, client);
    const byType = Object.fromEntries(out.map((t) => [t.signalType, t.confidence]));
    expect(byType['ABSENCE_TEST_CREATION']).toBe(0.9);
    expect(byType['IDEA_TO_PRD']).toBe(1);
    expect(byType['TOTALLY_NOT_A_TOPIC']).toBeUndefined();
  });

  it('returns [] on a malformed model reply (fail-open)', async () => {
    const out = await selectDistinctiveTopics({ rightGood: profile, patternSummary: 'x' }, mockClient('not json'));
    expect(out).toEqual([]);
  });

  it('returns [] when the model selects no topics', async () => {
    const out = await selectDistinctiveTopics({ rightGood: profile, patternSummary: 'x' }, mockClient(JSON.stringify({ topics: [] })));
    expect(out).toEqual([]);
  });
});

describe('auto-template-generator — coverage floor (scale-to-confident)', () => {
  const ranked = [
    { signalType: 'A', confidence: 0.9 },
    { signalType: 'B', confidence: 0.5 },
    { signalType: 'C', confidence: 0.7 },
  ];

  it('keeps topics clearing the bar, most-confident first', () => {
    expect(applyCoverageFloor(ranked, true, 0.6)).toEqual([
      { signalType: 'A', confidence: 0.9 },
      { signalType: 'C', confidence: 0.7 },
    ]);
  });

  it('personalizes nothing for a no-history project (Case A)', () => {
    expect(applyCoverageFloor(ranked, false, 0.6)).toEqual([]);
  });

  it('does not pad below-bar topics to reach the target', () => {
    expect(applyCoverageFloor([{ signalType: 'X', confidence: 0.3 }], true, 0.6)).toEqual([]);
  });
});

describe('auto-template-generator — per-topic generation (Stage C)', () => {
  const okClient = mockClient(JSON.stringify({ option: 'my rewritten option', whyDesc: 'my rewritten why-desc' }));

  it('produces a schema-valid, preset-seeded sparse record with source=autogen', async () => {
    const rec = await generatePerUserRecord('ABSENCE_TEST_CREATION', 3, 'summary', okClient);
    expect(rec).not.toBeNull();
    expect(rec!.source).toBe('autogen');
    expect(rec!.levelForms[1]).toBeDefined();                       // mandatory floor inherited from the preset
    expect(rec!.levelForms[3]?.cell.option).toBe('my rewritten option'); // current column personalized
    expect(validateContentTemplateRecord(rec!).ok).toBe(true);
  });

  it('at level 1 the personalized cell IS the floor (single-entry map)', async () => {
    const rec = await generatePerUserRecord('ABSENCE_TEST_CREATION', 1, 'x', okClient);
    expect(Object.keys(rec!.levelForms)).toEqual(['1']);
    expect(rec!.levelForms[1]?.cell.whyDesc).toBe('my rewritten why-desc');
  });

  it('inherits the sensitive-action safeguard from the preset (a sensitive topic stays guarded)', async () => {
    const rec = await generatePerUserRecord('REVIEW_TO_RELEASE', 3, 'x', okClient);
    expect(rec!.l2SafeguardRequired).toBe(true);
    expect(typeof rec!.l2SafeguardLine).toBe('string');
    expect(rec!.l2SafeguardLine!.length).toBeGreaterThan(0);
  });

  it('sanitizes prompt-derived leakage out of the generated cell (C4 gate)', async () => {
    const leaky = mockClient(JSON.stringify({ option: 'ping me at alice@corp.com about it', whyDesc: 'ok' }));
    const rec = await generatePerUserRecord('ABSENCE_TEST_CREATION', 1, 'x', leaky);
    expect(rec!.levelForms[1]?.cell.option).not.toContain('alice@corp.com');
    expect(rec!.levelForms[1]?.cell.option).toMatch(/redacted/i);
  });

  it('returns null for a missing preset, a malformed reply, or an empty cell', async () => {
    expect(await generatePerUserRecord('NOT_A_REAL_TOPIC', 1, 'x', okClient)).toBeNull();
    expect(await generatePerUserRecord('ABSENCE_TEST_CREATION', 1, 'x', mockClient('not json'))).toBeNull();
    expect(await generatePerUserRecord('ABSENCE_TEST_CREATION', 1, 'x', mockClient(JSON.stringify({ option: '', whyDesc: '' })))).toBeNull();
  });

  it('persists the generated record under source=autogen', async () => {
    const store = await openStore(':memory:');
    const stored = await generateAndStoreAutogenRecord(store, '/p', 'ABSENCE_TEST_CREATION', 2, 'x', okClient);
    expect(stored).toBe(true);
    expect(getContentTemplate(store.db, '/p', 'ABSENCE_TEST_CREATION', 'autogen')).not.toBeNull();
    store.db.close();
  });
});
