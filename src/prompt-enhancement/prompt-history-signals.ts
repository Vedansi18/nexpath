/**
 * Recent-prompt-history signals for the enhanced prompt.
 *
 * 🔑 **What this exists to fix.** Of the eleven section kinds the planner can produce, only two ever
 * received a fact — the rest had no producer at all, so they were structurally incapable of being
 * grounded. The natural source for the others is the developer's own recent prompts, and that
 * history WAS already processed properly: the masking, dedup, vocabulary and sensitive-action
 * layers all exist and are tested. They were built for the option-generation engine, and every one
 * of their consumers lives in that engine, which is switched off. So the analysis runs nowhere.
 *
 * 🔒 **Owner ruling (2026-08-20): deterministic ONLY where it is certain to deliver.** *"grounding
 * the important facts from recent history is critically important and I dont want to take
 * unnecessary and unreliable chances, with the deterministic layers. so deterministic layers only
 * where you are 100% sure it will work and for the rest the LLM api call pass."*
 *
 * ⚠️ **So this module carries the sensitive-action lane and nothing else.** Two other deterministic
 * layers were available and were deliberately NOT ported:
 *   - `extractVocab` returns the top tokens of the recent prompts. A bag of words is not a fact —
 *     `cutoff, messages, chrome` grounds nothing, and rendering it would be noise wearing the shape
 *     of evidence.
 *   - `computeRepetitionCounts` reports that a token appeared in two or more prompts. That a word
 *     repeated is not what the word MEANT, and no section is honestly served by the count.
 * Both would have produced sections that looked grounded and said nothing. The remaining sections
 * are fed by the LLM pass instead, hosted on a call that already happens.
 *
 * 🔑 Why the sensitive-action lane IS certain: it is a CURATED list of trigger patterns, which is
 * the one shape a regex answers exactly. It is also the mechanism already shipped for this same
 * question elsewhere, so this is a reuse rather than a second detector.
 */

import { detectL2TriggersInText } from '../decision-session/r5-injection.js';

/**
 * One sensitive-action category observed across the recent prompts.
 *
 * ⛔ **There is deliberately no field for the matched text.** The detector returns the literal words
 * from the developer's prompt that satisfied the trigger, and the owner reversed an
 * include-the-literal-word preference once already, on leakage grounds. The category is what the
 * body needs in order to ask for confirmation; the literal wording adds nothing and carries the
 * whole risk, so it stops here and is never returned.
 */
export interface PromptHistorySensitiveSignalV1 {
  /** The trigger category, e.g. `destructive-fs`, `deployment`. Never user text. */
  readonly category: string;
  /** How many of the recent prompts carried this category. */
  readonly promptCount: number;
}

/**
 * How many recent prompts are read. Matches the window the miner already uses, so both lanes
 * describe the SAME stretch of history and cannot disagree about what "recent" means.
 */
export const PROMPT_HISTORY_SIGNAL_WINDOW_V1 = 5;

/**
 * The sensitive-action categories present in the recent prompts, most-repeated first.
 *
 * ⚠️ Counts DISTINCT PROMPTS, not matches: a single prompt saying "force push" three times is one
 * prompt that mentioned it, and letting the repetition inflate the count would make an emphatic
 * developer look like a persistent pattern.
 */
export function promptHistorySensitiveActionSignalsV1(
  recentPrompts: readonly string[],
): readonly PromptHistorySensitiveSignalV1[] {
  const window = recentPrompts.slice(-PROMPT_HISTORY_SIGNAL_WINDOW_V1).filter((text) => text.trim() !== '');
  const promptCountByCategory = new Map<string, number>();
  for (const text of window) {
    // One count per category per prompt — the detector can return several matches from one prompt.
    const categories = new Set(detectL2TriggersInText(text).map((match) => match.name));
    for (const category of categories) {
      promptCountByCategory.set(category, (promptCountByCategory.get(category) ?? 0) + 1);
    }
  }
  return [...promptCountByCategory.entries()]
    .map(([category, promptCount]) => ({ category, promptCount }))
    // Stable: count first, then category name, so the same history always yields the same order.
    .sort((a, b) => (b.promptCount - a.promptCount) || a.category.localeCompare(b.category));
}
