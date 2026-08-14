/**
 * Typed refs from a composed section back to the user's own words.
 *
 * SHAPE: offsets, not copies. An offset cannot drift from the text it indexes, while a
 * copy is a second thing that can disagree with the first. Every emitted ref satisfies
 * `originalPromptText.slice(startOffset, endOffset) === <the quoted text>`, which is the
 * property `resolveOriginalTextRef` checks and the tests assert.
 *
 * REFUSAL, NOT DROPPING: a quote that cannot be located is emitted with
 * `resolution: 'refused'` and a reason. Silently omitting it would make "this section
 * quotes nothing" indistinguishable from "this section's quote could not be found",
 * and the second is a defect while the first is ordinary.
 *
 * WRITTEN ONCE: refs are produced during composition and never recomputed downstream,
 * so there is no second code path that could disagree about what a section quotes.
 */
import type {
  PromptEnhancementOriginalTextRefV1,
  PromptEnhancementPromptPointRefV1,
  PromptEnhancementRefRefusalReason,
  PromptEnhancementTransformReasonCodeV1,
} from './contracts.js';

/**
 * Shorter runs of shared text are noise — "the", "add a", "when the user" appear in
 * composed prose without being quotes of anything. Below this length a candidate is
 * refused as `below_minimum_length` rather than emitted as a quote nobody meant.
 */
export const PROMPT_ENHANCEMENT_ORIGINAL_TEXT_REF_MIN_LENGTH_V1 = 12;

/**
 * Longest run of the original that also appears in the section body, if any.
 *
 * Candidates come from the SECTION BODY, not the original. Both directions find the same
 * shared run, but the body is short and bounded while the original is whatever the user
 * pasted — and a coding tool gets stack traces and whole files pasted routinely. Scanning
 * the original's substrings measured 1.1 s per section at 15 KB and 3.2 s at 25 KB, which
 * across a body's sections and the confirmation re-render reached tens of seconds of pure
 * CPU on the submit path.
 *
 * Candidates are also word-aligned, so a ref names whole words instead of a run that
 * starts mid-word or carries ragged whitespace edges.
 */
function longestSharedRun(originalText: string, sectionBodyText: string): string | undefined {
  if (originalText.length === 0 || sectionBodyText.length === 0) return undefined;
  const originalLower = originalText.toLowerCase();

  const words: { text: string; start: number; end: number }[] = [];
  const wordPattern = /\S+/g;
  let match = wordPattern.exec(sectionBodyText);
  while (match !== null) {
    words.push({ text: match[0], start: match.index, end: match.index + match[0].length });
    match = wordPattern.exec(sectionBodyText);
  }

  let best: string | undefined;
  for (let first = 0; first < words.length; first += 1) {
    // Extend while the original still contains the span. `includes` is monotonic here —
    // once a span is absent, every longer span from the same start is absent too — so the
    // inner loop stops at the first miss instead of trying every end.
    for (let last = first; last < words.length; last += 1) {
      const span = sectionBodyText.slice(words[first]!.start, words[last]!.end);
      const at = originalLower.indexOf(span.toLowerCase());
      if (at < 0) break;
      if (span.length >= PROMPT_ENHANCEMENT_ORIGINAL_TEXT_REF_MIN_LENGTH_V1
        && span.length > (best?.length ?? 0)) {
        // Return the ORIGINAL's own characters: the offsets must index the original, and
        // its casing is what a reader resolving the ref should get back.
        best = originalText.slice(at, at + span.length);
      }
    }
  }
  return best;
}

function refusedOriginalTextRef(
  refId: string,
  sectionId: string,
  refusalReason: PromptEnhancementRefRefusalReason,
): PromptEnhancementOriginalTextRefV1 {
  return { refId, sectionId, startOffset: -1, endOffset: -1, resolution: 'refused', refusalReason };
}

/**
 * Build the original-text ref for one section.
 *
 * `quotedText` is what the section is claimed to quote. When it is omitted the section's
 * body is searched for the longest run it shares with the original.
 */
export function buildPromptEnhancementOriginalTextRefV1(input: {
  sectionId: string;
  originalPromptText: string;
  sectionBodyText: string;
  quotedText?: string;
}): PromptEnhancementOriginalTextRefV1 {
  const refId = `${input.sectionId}:otr:1`;
  const quoted = input.quotedText ?? longestSharedRun(input.originalPromptText, input.sectionBodyText);

  if (quoted === undefined || quoted.length === 0) {
    return refusedOriginalTextRef(refId, input.sectionId, 'not_found_in_original');
  }
  if (quoted.length < PROMPT_ENHANCEMENT_ORIGINAL_TEXT_REF_MIN_LENGTH_V1) {
    return refusedOriginalTextRef(refId, input.sectionId, 'below_minimum_length');
  }

  const startOffset = input.originalPromptText.indexOf(quoted);
  if (startOffset < 0) {
    return refusedOriginalTextRef(refId, input.sectionId, 'not_found_in_original');
  }
  // An ambiguous quote cannot name "the exact characters" the done-when asks for: two
  // occurrences mean two different answers to where it points, so neither is emitted.
  if (input.originalPromptText.indexOf(quoted, startOffset + 1) >= 0) {
    return refusedOriginalTextRef(refId, input.sectionId, 'ambiguous_multiple_matches');
  }

  return {
    refId,
    sectionId: input.sectionId,
    startOffset,
    endOffset: startOffset + quoted.length,
    resolution: 'exact',
  };
}

/**
 * Resolve a ref back to the characters it names. Returns undefined for a refused ref
 * and for one whose offsets no longer match, so a caller cannot mistake a broken ref
 * for a quote.
 */
export function resolvePromptEnhancementOriginalTextRefV1(
  ref: PromptEnhancementOriginalTextRefV1,
  originalPromptText: string,
): string | undefined {
  if (ref.resolution !== 'exact') return undefined;
  if (ref.startOffset < 0 || ref.endOffset > originalPromptText.length) return undefined;
  if (ref.endOffset <= ref.startOffset) return undefined;
  return originalPromptText.slice(ref.startOffset, ref.endOffset);
}

/**
 * Which of the user's own enumerated points this section covers.
 *
 * The points are the bullet/numbered items in the original prompt, so a ref here answers
 * "is this point of mine still covered?" — the question point-coverage exists to answer.
 * An earlier draft populated this from `structuredContentPartRefs`, which carries
 * `guidance_fact:` and `section_kind:` ids: real ids, but not prompt points, so the field
 * promised one thing and delivered another.
 *
 * A point is REFUSED when it cannot be located verbatim in the original. That is
 * reachable rather than theoretical: extraction collapses whitespace, so a point the user
 * wrote with doubled spaces no longer matches the text it came from.
 */
export function buildPromptEnhancementPromptPointRefsV1(input: {
  sectionId: string;
  originalPromptText: string;
  promptPoints: readonly string[];
  sectionBodyText: string;
}): readonly PromptEnhancementPromptPointRefV1[] {
  const body = input.sectionBodyText.toLowerCase();
  const refs: PromptEnhancementPromptPointRefV1[] = [];

  input.promptPoints.forEach((point, index) => {
    // A point the section does not mention is simply not covered by it — that is an
    // ordinary fact about section scope, not a failure, so no ref is emitted.
    if (!body.includes(point.toLowerCase())) return;

    const promptPointId = `prompt_point:${index + 1}`;
    refs.push(input.originalPromptText.includes(point)
      ? { refId: `${input.sectionId}:ppr:${index + 1}`, sectionId: input.sectionId, promptPointId, resolution: 'exact' }
      : {
        refId: `${input.sectionId}:ppr:${index + 1}`,
        sectionId: input.sectionId,
        promptPointId,
        resolution: 'refused',
        refusalReason: 'not_found_in_original',
      });
  });

  return refs;
}

/**
 * The user's enumerated points — the bullet and numbered items of the original prompt.
 *
 * Kept beside the refs that consume it so the two cannot drift. Mirrors the extraction
 * the point-inventory lines already use; Q2 decides that mechanism's future, and whatever
 * replaces it, these refs must still point at PROMPT POINTS.
 */
export function extractPromptEnhancementPromptPointsV1(originalPromptText: string): readonly string[] {
  return originalPromptText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^([-*]|\d+[.)])\s+/.test(line))
    .map((line) => line.replace(/^([-*]|\d+[.)])\s+/, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 12);
}

/** What composition did to this section, derived from state already known at composition. */
export function buildPromptEnhancementTransformReasonCodesV1(input: {
  isOriginalSection: boolean;
  wasComposedByModel: boolean;
  originalTextRef: PromptEnhancementOriginalTextRefV1;
}): readonly PromptEnhancementTransformReasonCodeV1[] {
  const codes: PromptEnhancementTransformReasonCodeV1[] = [];

  if (input.isOriginalSection) codes.push('preserved_verbatim');
  else if (input.wasComposedByModel) codes.push('composed_by_model');
  else codes.push('rendered_deterministically');

  codes.push(input.originalTextRef.resolution === 'exact' ? 'quotes_original_text' : 'no_original_text_quoted');
  return codes;
}

/**
 * Stamp a section as carried forward from an earlier body.
 *
 * APPENDED, not substituted: the existing code says how the text was originally made and
 * stays true of that text, while this one says the body is being served again. Both are
 * facts about the same section, so replacing either would lose information.
 *
 * Idempotent, because a body can be carried forward more than once and a section that
 * accumulated the same code twice would misreport a single carry as several.
 */
export function withPromptEnhancementCarriedFromPreviousBodyV1(
  transformReasonCodes: readonly PromptEnhancementTransformReasonCodeV1[],
): readonly PromptEnhancementTransformReasonCodeV1[] {
  return transformReasonCodes.includes('carried_from_previous_body')
    ? transformReasonCodes
    : [...transformReasonCodes, 'carried_from_previous_body'];
}
