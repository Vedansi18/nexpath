/**
 * Where the user's own load-bearing wording comes from.
 *
 * The popup marks the words a body borrowed from the developer — a path they typed, a tool they
 * named, a fact the project supplied. This module answers only "which words are those", from the
 * sources that already exist plus, since 2026-09-27, the developer's own multi-word terms; nothing
 * here decides where a word sits or whether it survives the cap.
 *
 * ⛔ The corpus is the invention gate's own allowed texts **minus the two id lists** — the prompt
 * and the section's grounded values. Identifiers are how the pipeline refers to evidence, not words
 * the developer wrote, and marking one would put a mark on plumbing.
 *
 * Pure: every input is passed in, nothing is read from the store or the environment.
 */
import { filterFloorExtractForConsumersV1 } from './preservation-floors.js';
import { findKnownToolNamesInTextV1 } from './known-tool-names.js';

/** What one section offers the user-term sources. */
export interface PromptEnhancementEmphasisSourceInputV1 {
  /** The developer's own prompt, verbatim — the first half of the corpus. */
  originalPromptText: string;
  /** The section's rendered text, which is where a phrase has to appear to be worth marking. */
  sectionText: string;
  /** Values a boundary resolved for this section — the second half of the corpus. */
  groundedFactValues?: readonly string[];
  /** Evidence identifiers. Never marked; carried only so a phrase that equals one can be dropped. */
  sourceFactIds?: readonly string[];
  /** The same, for the section's source ids. */
  sourceIds?: readonly string[];
}


/**
 * Words that may not begin or end a term.
 *
 * A term is the thing the developer was talking about, and these carry no subject of their own: a
 * phrase that opens or closes on one is a fragment of a sentence rather than a name for anything.
 * They are allowed in the MIDDLE, because *"the cart drawer"* and *"list of items"* are exactly the
 * shapes a developer writes.
 */
const TERM_EDGE_WORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'this', 'that', 'these', 'those',
  'and', 'or', 'but', 'so', 'if', 'then', 'than', 'as', 'also',
  'of', 'to', 'in', 'on', 'at', 'by', 'for', 'from', 'with', 'into', 'over', 'up', 'out',
  'i', 'me', 'my', 'we', 'us', 'our', 'you', 'your', 'it', 'its', 'they', 'them', 'their',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
  'do', 'does', 'did', 'has', 'have', 'had',
  'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must',
  'what', 'which', 'who', 'when', 'where', 'while', 'how', 'why',
  'not', 'no', 'all', 'any', 'some', 'each', 'every', 'both',
  'lets', 'let', 'please', 'just', 'very', 'more', 'most',
]);

/** A term is at least two words and at most four; shorter is a word, longer is a sentence. */
const TERM_MIN_WORDS = 2 as const;
const TERM_MAX_WORDS = 4 as const;
/** …and at least this many characters, so a pair of very short words is not offered as a name. */
const TERM_MIN_LENGTH = 6 as const;

/**
 * The developer's own terms: the multi-word phrases they wrote in their prompt.
 *
 * ⚠️ **This returns candidates, not marks.** Every one is still filtered by the caller — it must
 * appear in the section being marked, must not be an identifier, and must survive the classifier's
 * secret guard and then the cap. A term the body never used is never returned by
 * {@link collectPromptEnhancementEmphasisUserTermsV1} at all.
 *
 * Two rules decide the shape, and both were measured before they were written (2026-09-27):
 *
 *  - **Two words minimum.** Single words were measured against phrases on the same bodies: they do
 *    not add marks, because the per-section cap is spent either way — they *replace* the phrases a
 *    reader would have picked with fragments of those same phrases.
 *  - **Longest first.** A four-word term is offered before any phrase inside it, so when the cap
 *    binds the fuller reading is the one that survives.
 *
 * Punctuation ends a phrase. Words on either side of a comma are two things the developer listed,
 * not one thing they named, and a phrase spanning the comma names neither.
 */
export function promptEnhancementDeveloperTermsV1(originalPromptText: string): readonly string[] {
  const terms: string[] = [];
  const seen = new Set<string>();

  for (const segment of originalPromptText.split(/[^\p{L}\p{N}\s'\u2019-]+/u)) {
    const words = segment.split(/\s+/).filter((word) => word.length > 0);
    for (let size = TERM_MAX_WORDS; size >= TERM_MIN_WORDS; size--) {
      for (let start = 0; start + size <= words.length; start++) {
        const span = words.slice(start, start + size);
        if (TERM_EDGE_WORDS.has(span[0]!.toLowerCase())) continue;
        if (TERM_EDGE_WORDS.has(span[span.length - 1]!.toLowerCase())) continue;
        const phrase = span.join(' ');
        if (phrase.length < TERM_MIN_LENGTH) continue;
        const key = phrase.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        terms.push(phrase);
      }
    }
  }
  return terms;
}

/**
 * The corpus a user term may come from: the gate's allowed texts, minus the identifiers.
 *
 * Kept as its own function because the *definition* is what must not drift from the gate's — a
 * phrase is the developer's only if it is in one of these two places.
 */
export function buildPromptEnhancementEmphasisCorpusV1(
  input: Pick<PromptEnhancementEmphasisSourceInputV1, 'originalPromptText' | 'groundedFactValues'>,
): readonly string[] {
  return [input.originalPromptText, ...(input.groundedFactValues ?? [])].filter((text) => text.trim().length > 0);
}

/**
 * The value half of an expectation line, without the framing that surrounds it.
 *
 * The line reads `<key> appears to be <value> (recency) — confirm before relying on it.` Only the
 * value is the developer's; the rest is the pipeline hedging about it, and marking the hedge would
 * emphasise nexpath's own caution rather than their words. A value rendered in quotes is taken
 * without them: the quotation marks are punctuation the renderer added, not part of what was said.
 */
export function extractPromptEnhancementExpectationValuesV1(sectionText: string): readonly string[] {
  const values: string[] = [];
  const pattern = /appears to be ([\s\S]+?)(?: \([^)]*\))* — confirm before relying on it\./g;
  for (const match of sectionText.matchAll(pattern)) {
    const raw = (match[1] ?? '').trim();
    const unquoted = /^"([\s\S]+)"$/.exec(raw);
    const value = (unquoted?.[1] ?? raw).trim();
    if (value.length > 0) values.push(value);
  }
  return values;
}

/** Case-insensitive membership, so a phrase is not marked twice for differing in casing alone. */
const has = (haystack: readonly string[], needle: string): boolean =>
  haystack.some((entry) => entry.toLowerCase() === needle.toLowerCase());

/**
 * Every phrase in this section that is the developer's own wording.
 *
 * Four sources, each already shipped and each answering a different question: the item floors say
 * what the developer named, the curated list says which of those are known tools, the expectation
 * line says what they told us earlier, and the grounded values say what the project supplied. A
 * phrase has to appear in the section to be returned — a term the developer used and the body
 * dropped has nothing to mark.
 */
export function collectPromptEnhancementEmphasisUserTermsV1(
  input: PromptEnhancementEmphasisSourceInputV1,
): readonly string[] {
  const identifiers = [...(input.sourceFactIds ?? []), ...(input.sourceIds ?? [])];
  const sectionLower = input.sectionText.toLowerCase();
  const found: string[] = [];

  const offer = (phrase: string): void => {
    const value = phrase.trim();
    if (value.length === 0) return;
    // Never an identifier: those name evidence, they are not words anyone wrote (A14).
    if (has(identifiers, value)) return;
    // It has to be on screen to be worth marking.
    if (!sectionLower.includes(value.toLowerCase())) return;
    if (has(found, value)) return;
    // A term already inside a term this section offered is the same thing named twice, and it costs
    // a mark of the section's four. `food delivery app`, `food delivery` and `delivery app` were
    // three marks on seventeen characters, and between them they pushed `price range` and
    // `delivery time` out of the frame (owner, 2026-09-27).
    //
    // ⚠️ Only WITHIN this list. A term sitting inside a boundary or a condition is two marks the
    // standard asks for, and those are different classes decided elsewhere — nothing here can or
    // should reach them.
    //
    // The sources arrive longest-first, so the fuller reading is the one already here.
    if (found.some((kept) => kept.toLowerCase().includes(value.toLowerCase()))) return;
    found.push(value);
  };

  // 1. The item-shaped floors, read off the developer's own prompt — through the shared consumer
  //    filter, which is the same one the invention gate uses, so the two cannot drift.
  for (const item of filterFloorExtractForConsumersV1(input.originalPromptText)) offer(item);

  // 2. The curated tool names the prompt mentions — coverage the shape patterns cannot give.
  for (const name of findKnownToolNamesInTextV1(input.originalPromptText)) offer(name);

  // 3. What the developer told us earlier, as the expectation line renders it.
  for (const value of extractPromptEnhancementExpectationValuesV1(input.sectionText)) offer(value);

  // 4. What the project supplied for this section.
  for (const value of input.groundedFactValues ?? []) offer(value);

  // 5. The developer's own multi-word terms, where the body kept them.
  //
  //    LAST on purpose. `offer` keeps the first arrival, so every source above decides before this
  //    one does and nothing already shipped changes its answer because this exists.
  //
  //    Measured 2026-09-27: without it the corpus is EMPTY for an ordinary English prompt — all four
  //    sources above returned nothing on a prompt whose own words (`cart drawer`, `delivery fee`)
  //    were sitting in the composed body verbatim. An empty corpus is not only class 2's problem:
  //    class 1's object must trace to a term, and a section left with only conditions has them
  //    dropped — so three of the five classes were dark for one reason.
  for (const term of promptEnhancementDeveloperTermsV1(input.originalPromptText)) offer(term);

  return found;
}
