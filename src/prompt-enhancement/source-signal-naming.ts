/**
 * Did the composer NAME the source signal it was given?
 *
 * §17.13's payload fix put the signal's identity in front of the model, and the hardened
 * instruction told it to keep the name. Measured across two sim runs, the model complied on one
 * body and generalised on the other — *"the missing practices indicated"*, *"what signals might be
 * relevant here"*. An instruction is not a mechanism.
 *
 * 🔒 **Owner sanction (Hiren, 2026-08-19), and its bounds:** ONE extra call, for THIS section only,
 * because Source Signal Guidance is the section that matters most. If the name is still missing
 * after that retry, **discard the section** — not the popup. A vague source-signal paragraph is
 * worse than none: it takes a slot, says nothing the reader did not know, and looks like guidance.
 *
 * ⛔ Deliberately NOT solved by splicing the deterministic sentence into the body (owner ruling,
 * same day): the composer must mirror the user's own register, and a bolted-in English sentence
 * breaks that for every non-English user. The model rewrites; we only check its work.
 */

import { promptEnhancementSectionKindForFactV1 } from './templates/section-plan.js';
import type { PromptEnhancementSectionPlanningResult } from './templates/section-plan.js';

export const PROMPT_ENHANCEMENT_SOURCE_SIGNAL_SECTION_KIND_V1 = 'source_signal_guidance';

/**
 * The names the composer was actually given for this section, spaced the way the deterministic
 * renderer spaces them (`test_creation` → `test creation`), because that is the form the model is
 * shown and therefore the form it would echo.
 *
 * ⚠️ Facts with no evidence contribute NOTHING — and that is the safety property, not an oversight:
 * a sensitive signal resolves to no evidence at all, so it is never expected in the text and can
 * never be demanded into it by this check.
 */
export function promptEnhancementExpectedSignalNamesV1(
  planning: PromptEnhancementSectionPlanningResult,
): readonly string[] {
  const names = new Set<string>();
  for (const fact of planning.renderedFacts ?? []) {
    if (promptEnhancementSectionKindForFactV1(fact) !== PROMPT_ENHANCEMENT_SOURCE_SIGNAL_SECTION_KIND_V1) continue;
    const key = fact.evidence?.key?.trim();
    if (key) names.add(key.replaceAll('_', ' ').toLowerCase());
  }
  return [...names];
}

/**
 * Does this draft name at least one of them?
 *
 * ⚠️ ONE, not all. The bound is the owner's single retry: demanding every name would spend it on a
 * draft that named two signals out of three and then discard an otherwise good section. The failure
 * being caught is the CATEGORY sentence that names none — which is what was measured, twice.
 */
export function promptEnhancementDraftNamesItsSignalV1(
  draftText: string,
  expectedNames: readonly string[],
): boolean {
  if (expectedNames.length === 0) return true; // nothing was given, so nothing can be missing
  const haystack = draftText.toLowerCase();
  return expectedNames.some((name) => haystack.includes(name));
}

/** The directive for the one sanctioned retry. Names the signals rather than restating the rule. */
export function promptEnhancementSignalNameDirectiveV1(expectedNames: readonly string[]): string {
  return '\n\nIMPORTANT: your previous reply described the source signal as a category instead of'
    + ' naming it. Rewrite EVERY section keeping your own wording, register and language, and in the'
    + ' source-signal section name the signal explicitly: '
    + expectedNames.map((name) => `"${name}"`).join(', ')
    + '. Do not replace the name with "the missing practices", "the current signal", "this issue" or'
    + ' any other category phrase.';
}
