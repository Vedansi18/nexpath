/**
 * Acceptance executor — batch 9: the planner-semantic fixtures.
 *
 * These fixtures govern decisions the model makes at plan time (when a confirmation exists, whether an
 * item stands alone) — there is no deterministic runtime to drive, so the enforceable, testable
 * artifact is the instruction the planner/composer ships. Each backing test (`test:${fixtureId}`)
 * asserts the governing rule is present in the built system prompt, as the planner's own unit tests do.
 * Does NOT mark the register fixture as passing — the owner oracle judges readiness.
 */
import { describe, expect, it } from 'vitest';
import { buildPromptEnhancementSequencePlannerSystemPromptV1 } from './sequence-planner-prompt.js';
import { buildPromptEnhancementSequenceBatchSystemPromptV1 } from './sequence-batch-composer-prompt.js';

const plannerPrompt = buildPromptEnhancementSequencePlannerSystemPromptV1();
const composerPrompt = buildPromptEnhancementSequenceBatchSystemPromptV1();

describe('acceptance executor (batch 9) — planner-semantic fixtures', () => {
  it('test:acceptance-sequence-no-confirmation-when-not-complex', () => {
    // an_item_exists_only_on_a_decision_about_that_item: no confirmation is attached as a matter of
    // course, and "this sequence needs confirmation" is never a valid conclusion.
    expect(plannerPrompt).toContain('AN ITEM EXISTS ONLY ON A DECISION ABOUT THAT ITEM');
    expect(plannerPrompt).toContain('"This sequence needs confirmation" is never a valid conclusion');
  });

  it('test:acceptance-sequence-no-risk-no-confirmation', () => {
    // confirmation_turns_on_a_named_trigger: the decision turns on the four weighed triggers, per item.
    expect(plannerPrompt).toContain('AN ITEM EXISTS ONLY ON A DECISION ABOUT THAT ITEM');
    for (const trigger of ['Sensitive', 'Business-logic core', 'Challenging']) {
      expect(plannerPrompt).toContain(trigger);
    }
  });

  it('test:acceptance-sequence-confirmation-volume-uncorrelated', () => {
    // volume_uncorrelated_with_size: triggers are WEIGHED not counted, and length/file-count/vocabulary
    // are explicitly non-signals; uncertainty does not escalate.
    expect(plannerPrompt).toContain('WEIGHED');
    expect(plannerPrompt).toContain('length, file count, vocabulary');
    expect(plannerPrompt).toContain('UNCERTAINTY DOES NOT ESCALATE');
  });

  it('test:acceptance-sequence-readiness-ask-never-emitted', () => {
    // readiness_ask_never_emitted: a hard stop in the instruction.
    expect(plannerPrompt).toContain('A readiness ask is NEVER emitted');
  });

  it('test:acceptance-sequence-item-must-stand-alone', () => {
    // every_item_is_answerable_on_its_own: an item that depends on a later one blocks the offer.
    expect(plannerPrompt).toContain('EVERY ITEM MUST STAND ON ITS OWN');
  });

  it('test:acceptance-sequence-every-confirmation-covers-both-classes', () => {
    // every_confirmation_covers_depth_and_grounding + no_selection_between_the_two_classes: the composer
    // is instructed to cover both classes, never to select one.
    expect(composerPrompt).toContain('cover both classes');
    expect(composerPrompt).toContain('CLASS A');
  });
});
