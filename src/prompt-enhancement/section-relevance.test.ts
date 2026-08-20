import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  promptEnhancementRelevanceSectionKindsV1,
  promptEnhancementRelevanceMenuLinesV1,
  normalizePromptEnhancementRelevanceOrderV1,
} from './section-relevance.js';
import { PROMPT_ENHANCEMENT_PLANNABLE_SECTION_KINDS_V1 } from './templates/section-plan.js';
import { parseStageClassifierReply, STAGE_CLASSIFIER_SYSTEM_PROMPT } from '../classifier/stage-classifier.js';

/**
 * I1 (§15.2) — the relevance observation rides the C1 section.
 *
 * ⛔ What this phase is NOT: a pruner. §15.2 step 3 is *"model observes, registry decides"*, and the
 * deciding happens in I2 under the locked drop-criteria — where EVIDENCE is tested before relevance
 * is consulted at all. These fixtures therefore pin the observation's shape and its refusal to
 * decide, and nothing about what survives.
 */

describe('the vocabulary offered to the model', () => {
  it('is DERIVED from the planner, not a second list beside it', () => {
    // A hand-kept copy would drift the first time a section kind is added, and the model would be
    // ranking a menu the planner no longer produces — prohibition 15, one map one meaning.
    expect(promptEnhancementRelevanceSectionKindsV1())
      .toEqual(PROMPT_ENHANCEMENT_PLANNABLE_SECTION_KINDS_V1);
  });

  it('every kind reaches the prompt with a purpose a model can rank on', () => {
    const lines = promptEnhancementRelevanceMenuLinesV1();
    expect(lines).toHaveLength(promptEnhancementRelevanceSectionKindsV1().length);
    // An id with no purpose text still ships (the id alone is honest), but none should be missing
    // today — a new kind arriving without one is worth noticing here rather than in a body.
    const withoutPurpose = lines.filter((line) => !line.includes(' — '));
    expect(withoutPurpose, 'a section kind is offered with no explanation of what it is for').toEqual([]);
  });
});

describe('normalising what comes back', () => {
  it('keeps the ORDER, which is the entire content of the observation', () => {
    expect(normalizePromptEnhancementRelevanceOrderV1([
      'verification_or_test_plan', 'project_grounding_facts', 'context_and_constraints',
    ])).toEqual(['verification_or_test_plan', 'project_grounding_facts', 'context_and_constraints']);
  });

  it('drops an invented kind instead of trusting it', () => {
    expect(normalizePromptEnhancementRelevanceOrderV1(['made_up_kind', 'verification_or_test_plan']))
      .toEqual(['verification_or_test_plan']);
  });

  it('drops a repeat but keeps the ranking — a formatting slip is not a reason to lose the reply', () => {
    expect(normalizePromptEnhancementRelevanceOrderV1([
      'context_and_constraints', 'verification_or_test_plan', 'context_and_constraints',
    ])).toEqual(['context_and_constraints', 'verification_or_test_plan']);
  });

  it('a missing or malformed field is an EMPTY ordering, never a thrown reply', () => {
    // Soft parsing, like every other observation on this call: an old or partial reply must still
    // classify. I2 treats an empty ordering as "no relevance signal", not as "rank everything last".
    for (const raw of [undefined, null, 'not-an-array', 42, {}]) {
      expect(normalizePromptEnhancementRelevanceOrderV1(raw)).toEqual([]);
    }
  });
});

describe('the observation rides the C1 section and decides nothing', () => {
  const classifierSource = (): string => readFileSync('src/classifier/stage-classifier.ts', 'utf8');

  it('the block is IN the assembled system prompt, not merely defined beside it', () => {
    // ⚠️ Asserted on the ASSEMBLED prompt, because the first version read the source file and a
    // mutation proved it worthless: removing the block from the prompt array left every assertion
    // green — the text still existed in the file, just no longer in anything sent to a model.
    // Declared-but-inert is the exact failure this milestone keeps finding.
    expect(STAGE_CLASSIFIER_SYSTEM_PROMPT).toContain('SECTION RELEVANCE OBSERVATION');
    expect(
      STAGE_CLASSIFIER_SYSTEM_PROMPT.includes('This is an ORDERING, not a selection'),
      'the model is not told to rank rather than choose',
    ).toBe(true);
    expect(
      STAGE_CLASSIFIER_SYSTEM_PROMPT.includes('that decision is not yours'),
      'nothing tells the model it is not the one choosing — prohibition 4 lives in this sentence',
    ).toBe(true);
  });

  it('and every kind in the vocabulary is actually offered in that prompt', () => {
    for (const kind of promptEnhancementRelevanceSectionKindsV1()) {
      expect(STAGE_CLASSIFIER_SYSTEM_PROMPT, `${kind} is rankable but never shown to the model`)
        .toContain(kind);
    }
  });

  it('no new call was added — it rides the parked one', () => {
    // §47.1: the decider rides the SAME parked classifier call. One create() call in this module,
    // and that is the whole of prohibition 3 at this seam.
    const calls = classifierSource().split('chat.completions.create(').length - 1;
    expect(calls, 'a second model call appeared in the classifier').toBe(1);
  });

  it('the reply parses the ordering, and an absent one degrades quietly', () => {
    const withOrder = parseStageClassifierReply(JSON.stringify({
      stage: 'Implementation', stage_confidence: 0.9, signals_present: [], signals_absent: [],
      fire_decision_session: false, selected_signal_key: '', reason: 'x',
      section_relevance_order: ['verification_or_test_plan', 'nope', 'context_and_constraints'],
    }));
    expect(withOrder.sectionRelevanceOrder).toEqual(['verification_or_test_plan', 'context_and_constraints']);

    const without = parseStageClassifierReply(JSON.stringify({
      stage: 'Implementation', stage_confidence: 0.9, signals_present: [], signals_absent: [],
      fire_decision_session: false, selected_signal_key: '', reason: 'x',
    }));
    expect(without.sectionRelevanceOrder, 'an old reply stopped classifying').toEqual([]);
  });
});
