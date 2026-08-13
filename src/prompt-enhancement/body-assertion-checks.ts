/**
 * The mechanical half of the enhancement-body assertion, as pure functions.
 *
 * The assertion itself needs a live model and so runs from `scripts/pe-body-assertion.ts`, outside
 * the test suite. These checks are what it applies, split out so they can be proven deterministically:
 * a checker nobody has tested is a checker that can pass while measuring nothing.
 *
 * Neither check scores quality. There is no agreed scorer for "is this good advice", and a made-up
 * threshold would be worse than none.
 */

/**
 * The invariant half of the fall-through sentence's long arm, as built in `compose-enhancement.ts`
 * for any section kind with no entry in the content map. The heading is interpolated ahead of it,
 * so only this tail is stable.
 */
export const PROMPT_ENHANCEMENT_FALLTHROUGH_LONG_V1 =
  'for this request with concrete, source-backed specifics';

/** The short arm, used when a directional action asks for brevity: `Cover <heading> concretely.` */
export const PROMPT_ENHANCEMENT_FALLTHROUGH_SHORT_PREFIX_V1 = 'Cover ';
export const PROMPT_ENHANCEMENT_FALLTHROUGH_SHORT_SUFFIX_V1 = ' concretely.';

/**
 * Is this checker still looking for text that exists?
 *
 * The sentence is built inline in the renderer, so a rewording there would leave the checker hunting
 * for a string that is gone — and it would then pass every run while checking nothing. Pass the
 * renderer's source; false means the constants above are stale and no pass should be trusted.
 */
export function isPromptEnhancementBodyAssertionCheckerCurrentV1(rendererSource: string): boolean {
  return rendererSource.includes(PROMPT_ENHANCEMENT_FALLTHROUGH_LONG_V1)
    && rendererSource.includes(PROMPT_ENHANCEMENT_FALLTHROUGH_SHORT_SUFFIX_V1);
}

/**
 * Everything after the verbatim-original section — the part the model is supposed to write.
 *
 * The body opens with the original heading, the user's text, then a blank line. Splitting there
 * leaves the guidance alone, which is what distinctness compares: two prompts sharing guidance are
 * generic even when the verbatim halves differ.
 *
 * No blank line means there is no section after the original, so there is no guidance — return
 * empty. Returning the remaining lines instead would fold the user's own prompt into the value
 * being compared, and since that text differs per prompt, two identical guidance halves would stop
 * looking identical. The check would then never fire, which is worse than not running it.
 */
export function promptEnhancementGuidanceHalfV1(bodyText: string): string {
  const lines = bodyText.split('\n');
  const firstBlank = lines.findIndex((line, index) => index > 1 && line.trim() === '');
  if (firstBlank === -1) return '';
  return lines.slice(firstBlank + 1).join('\n').trim();
}

/**
 * How many fall-through sentences the body carries. Any occurrence means the model did not word
 * that section and the deterministic renderer filled it with the heading pasted into one fixed line.
 */
export function countPromptEnhancementFallThroughSentencesV1(bodyText: string): number {
  let count = bodyText.split(PROMPT_ENHANCEMENT_FALLTHROUGH_LONG_V1).length - 1;
  for (const line of bodyText.split('\n')) {
    const trimmed = line.replace(/^[-*]\s*/, '').trim();
    if (
      trimmed.startsWith(PROMPT_ENHANCEMENT_FALLTHROUGH_SHORT_PREFIX_V1)
      && trimmed.endsWith(PROMPT_ENHANCEMENT_FALLTHROUGH_SHORT_SUFFIX_V1)
    ) {
      count++;
    }
  }
  return count;
}

/**
 * Prompts whose guidance text is byte-identical to an earlier prompt's.
 *
 * This is the defect stated directly: a body whose section SET varies by intent while its section
 * TEXT never varies is generic however well it reads on its own, and reading one body cannot catch
 * it. Empty guidance is not compared — that is a different failure and belongs to the caller.
 */
export function findPromptEnhancementDuplicateGuidanceV1(
  bodies: readonly { prompt: string; bodyText: string }[],
): readonly { prompt: string; matches: string }[] {
  const seen = new Map<string, string>();
  const duplicates: { prompt: string; matches: string }[] = [];
  for (const { prompt, bodyText } of bodies) {
    const guidance = promptEnhancementGuidanceHalfV1(bodyText);
    if (guidance.length === 0) continue;
    const earlier = seen.get(guidance);
    if (earlier !== undefined) duplicates.push({ prompt, matches: earlier });
    else seen.set(guidance, prompt);
  }
  return duplicates;
}
