/**
 * Which words in a composed body may be emphasised, and why.
 *
 * Five kinds of phrase earn a mark, and each is a different question: what the body asks the agent
 * to DO, which words are the developer's own, what the work must NOT touch, what must happen
 * FIRST, and the safety sentences the pipeline inserts itself. Everything else stays plain — a
 * body where most of the text is marked has emphasised nothing.
 *
 * ⛔ **This module decides classes and nothing else.** It does not locate a phrase in the rendered
 * text, does not cap how many survive, and does not store anything. Those are the next phase's, and
 * keeping them apart is what lets this one be read as a standard rather than as plumbing.
 *
 * Pure: every input is passed in. Nothing here reads the store, the clock or the environment, and
 * nothing here calls a model.
 */
import { EXECUTION_VERB, ALWAYS_ESCALATE_PATTERN } from './safety-sendability.js';
import { SECRET_IN_TEXT } from '../classifier/mistake-categories.js';
import { collectPromptEnhancementEmphasisUserTermsV1 } from './emphasis-sources.js';

/**
 * 1 action · 2 the developer's own term · 3 a boundary · 4 a condition · 5 a safety line.
 *
 * The numbers are the priority order the cap spends its budget in, which is why they are numbers
 * and not names.
 */
export type PromptEnhancementEmphasisClassV1 = 1 | 2 | 3 | 4 | 5;

export interface PromptEnhancementEmphasisCandidateV1 {
  /**
   * Which of the input's sections this candidate was read from.
   *
   * ⚠️ Optional, and a caller that ignores it gets the older behaviour — the phrase is placed in the
   * first section whose text happens to hold it. That is what produced a blank section on a real
   * popup: a term read from section 5 was placed in section 2, where the same words also appear,
   * and the section that asked for it drew nothing.
   */
  sectionIndex?: number;
  /** The phrase as it reads in the body — the next phase re-finds it there. */
  text: string;
  emphasisClass: PromptEnhancementEmphasisClassV1;
  /**
   * Class 1 only: whether the verb commands a change rather than a look. Writes outrank reads when
   * the cap bites, so the rank has to be decided where the verb is recognised.
   */
  isWriteVerb?: boolean;
}

/** One composed section, as this module needs to see it. */
export interface PromptEnhancementEmphasisSectionInputV1 {
  sectionKind: string;
  /** The section's rendered text. Its heading is NOT part of this, and never gets a mark. */
  sectionText: string;
  groundedFactValues?: readonly string[];
  sourceFactIds?: readonly string[];
  sourceIds?: readonly string[];
  /**
   * The clearance verdict, for a section whose lines carry one of the risky kinds. `not_proposed`
   * means the body was not cleared to propose that action, so class 1 is off **here**.
   *
   * ⚠️ Per section on purpose. The rule is scoped to the risky kinds, and which lines carry one is
   * decided where the risk is classified — not here. A caller that knows a section is not risky
   * leaves this unset, and an absent verdict never suppresses anything.
   */
  clearanceVerdict?: string;
}

export interface PromptEnhancementEmphasisInputV1 {
  originalPromptText: string;
  sections: readonly PromptEnhancementEmphasisSectionInputV1[];
  /**
   * The composer's own report of the language it wrote in. When it is present and not English,
   * class 1 is off: the clause heads below are English, and a verb list without the grammar around
   * it would mark the wrong half of a sentence.
   */
  detectedLanguageSelfReport?: string;
  /** The resolved name inside the confirmation sentence, when one was inserted. */
  sensitiveActionName?: string;
}

/**
 * The two sections whose text is never marked, whatever it contains.
 *
 * Exported for the popup's overlay, which has to answer the same question from the other end: not
 * "may this section produce a phrase" but "may a phrase land here". A phrase taken from the
 * developer's prompt is quoted back verbatim in the first of these, so without the same list the
 * overlay would find it there first and mark their own words at them.
 *
 * ⚠️ **Visibility only.** The set is unchanged, and the overlay's test pins its membership so an
 * edit here cannot pass silently.
 */
export const NEVER_MARKED_SECTION_KINDS: ReadonlySet<string> = new Set([
  // The developer's own words, quoted back. Marking them would emphasise their own prompt at them.
  'original_request_or_goal',
  // Its lines propose practices by design, so the loudest mark would land on the one section that
  // is nexpath's suggestion rather than the developer's ask.
  'source_signal_guidance',
]);

/**
 * The clause heads a class-1 verb must follow, in full.
 *
 * A verb anywhere else — mid-sentence, inside the developer's restated prompt, inside a sentence
 * the pipeline inserted — is not an instruction to the agent; it is the body talking about
 * something. The first-person heads are here because the composer writes as the agent.
 */
const CLASS_1_CLAUSE_HEADS: readonly string[] = [
  'you must',
  'i need you to',
  'make sure to',
  "i'll",
  'i will',
  'i need to',
  'i should',
  'i can',
  "let's",
  // Sequencing words. They put the steps in order; they are not someone doing something, so a verb
  // behind one still opens its clause — the same reading a list marker gets. The composer writes
  // step lists this way almost every time: `First, … Next, … Then, … Finally, …`.
  'first,',
  'next,',
  'then,',
  'after that,',
  'finally,',
  'lastly,',
];

/**
 * The read verbs that are instructions too.
 *
 * *Find the bug*, *make a report*, *read the logs* — each is work the body is telling the agent to
 * do, and a developer scanning the popup needs to see it as plainly as a write. The list is the
 * approved starting set; it can still be edited.
 *
 * ⏪ **Widened 2026-09-27** by `cover`, `document`, `gather`, `define`, `specify` — counted, not
 * chosen. Across 35 recorded bodies, 273 clause openings outside the never-marked sections were
 * censused and only **14** matched any shipped list; these five are the verbs that turned up and that
 * name WORK.
 *
 * ⏪ **Widened again 2026-09-28** by `design`, `implement`, `embed`, `calculate`, `display` — the
 * verbs a step list uses. They were worth nothing on their own and are only worth something beside
 * the sentence scan in {@link classOneOfLine}: a step list is written as one line, and until that
 * line was read sentence by sentence none of its verbs could open a clause. Measured together:
 * sections drawing 43 → 44, marks 96 → 98, densest body and section unmoved.
 *
 * ⛔ **The widening stopped there, and both further steps were declined on measurement.**
 * `make`, `include`, `name`, `add` added **no marks at all** — risk with no benefit.
 * `ensure`, `start`, `calculate`, `display`, `implement` traded two actions for two conditions, a
 * net change of nothing, using the ordinary planning vocabulary that no verification or acceptance
 * section can avoid — the same reason the escalation verbs were narrowed in the safety module.
 *
 * ⛔ **This list, and only this list.** `EXECUTION_VERB` and `ALWAYS_ESCALATE_PATTERN` are imported
 * from the safety module and drive authority classification there; widening one of those would change
 * what the pipeline generates rather than what the popup emphasises.
 *
 * ⚠️ They rank BELOW writes when the cap bites, which is what {@link
 * PromptEnhancementEmphasisCandidateV1.isWriteVerb} carries.
 */
const READ_VERB = /\b(?:check|compare|look at|inspect|report|confirm|find|read|review|verify|test|investigate|identify|list|cover|document|gather|define|specify|design|implement|embed|calculate|display)\b/i;

/** Words that end a phrase: the next clause has started, so the object has finished. */
const CLAUSE_BOUNDARY = /[,.;:!?]|\bbefore\b|\bafter\b|\bonce\b|\bunless\b|\buntil\b|\bonly if\b|\brather than\b/i;

/**
 * The longest a boundary or a condition may run and still be a mark.
 *
 * Both classes take the word plus the clause it governs, and a clause can be a whole sentence: the
 * longest measured was twenty-two words. Emphasis works by contrast, and a sentence in bold is a
 * paragraph a reader skips rather than a phrase they catch (owner, 2026-09-27).
 *
 * ⛔ Eight, and the number was found rather than picked. Seven was tried first, from a reading that
 * kept `do not affect unrelated files or behaviors` (7 words) — and a test then caught
 * `Do not delete the audit log while refactoring` (8 words) being dropped. Those are the SAME shape,
 * and splitting them on one word is arbitrary; worse, the section holding the second went entirely
 * blank, because its boundary went to the ceiling and its lone remaining condition then went to the
 * "a condition alone is dropped" rule below.
 *
 * Measured: of the class 3 and 4 marks that survive, 55 of 62 are two to five words and only four
 * are seven. Nothing crowds this line, so where it sits decides very little except whether one
 * shape is cut in half.
 *
 * ⛔ **Classes 1, 2 and 5 are deliberately outside this.** Class 2 has never produced a mark over
 * four words and class 5 never over four, so a ceiling there has nothing to do. Class 1 is the
 * instruction — the mark a reader most needs — and it builds `verb + clause` where class 2 builds a
 * noun phrase, so every ceiling measured took nearly all of them away. Shortening class 1 is a
 * change to how its phrase is BUILT, and it is a separate question.
 */
const CLASS_3_AND_4_MAX_WORDS_V1 = 8 as const;

/** A hard negation or scope limiter. */
const CLASS_3_BOUNDARY_WORDS: readonly string[] = ['do not', 'must not', 'never', 'without', 'only', 'not'];

/** The last entry above, which is the only one that needs the governor test below. */
const BARE_NOT = 'not' as const;

/**
 * What a bare `not` must be negating to count as a limit.
 *
 * `not` is a negator: it needs a verb to negate. `do not`, `must not` and `never` carry their own
 * verb and are matched whole, so a BARE `not` only ever reaches here when neither did — and there
 * it is doing one of two very different jobs:
 *
 *   `you should not send the request`   — a limit. `should` is what it negates.
 *   `practices like not sharing keys`   — a practice being NAMED. It negates nothing; the phrase
 *                                         is a noun, and marking it emphasises a description
 *                                         rather than a constraint.
 *
 * ⚠️ Class 1 already refuses the same shape for the same reason — *"only a verb that opens the
 * clause counts; one buried further in is the body describing something, not instructing"*. Class 3
 * had no equivalent test, which is the asymmetry this closes, not a special case.
 *
 * The test is on the word BEFORE, not on where the word sits: a limiter is a limiter wherever it
 * falls in a sentence, and what makes this one a limiter is that it has something to negate.
 */
const NEGATION_GOVERNOR =
  /\b(?:do|does|did|must|shall|should|will|would|can|could|may|might|is|are|was|were|be|been|being|am|has|have|had|need|dare)$/i;

/** Whether the bare `not` at this offset is negating a verb rather than sitting inside a phrase. */
function bareNotIsGoverned(line: string, at: number): boolean {
  return NEGATION_GOVERNOR.test(line.slice(0, at).trimEnd());
}

/** A precondition that gates the work. */
const CLASS_4_CONDITION_WORDS: readonly string[] = ['only if', 'before', 'after', 'once', 'unless', 'until'];

/** The stance sentence's own marked span (A18) — the rest of the sentence stays plain. */
const POSTURE_STANCE_SPAN_V1 = 'rather than carrying it out' as const;

/** The confirmation's second scope unit. A boundary, not a safety line — classes 5 and 3. */
const CONFIRMATION_BOUNDARY_SPAN_V1 = 'Do not assume' as const;

/** The naming the history-lane safeguard always carries. */
const GENERIC_SAFETY_NAMING_V1 = 'sensitive action' as const;

/**
 * Cut a candidate before any secret-shaped token.
 *
 * The popup and the floors see the RAW prompt — redaction runs on the stored copy — so a value
 * that looks like a key can genuinely reach a rendered body. A mark is the loudest thing on the
 * screen, and it must never be the thing that points at one.
 */
function cutBeforeSecret(phrase: string): string {
  const match = SECRET_IN_TEXT.exec(phrase);
  return match === null ? phrase : phrase.slice(0, match.index).trim();
}

/**
 * Blank out the text the pipeline wrote itself, so the line scan cannot mark it.
 *
 * Two kinds of text are in a body but not *of* it. The safety sentences are code-inserted and
 * already have their own fixed marks — scanning them again would mark the scaffolding of a
 * sentence whose only load-bearing words were chosen deliberately. And an expectation line's
 * framing (*"— confirm before relying on it"*) is the pipeline hedging about a fact; the
 * developer's half is the value, which class 2 has already taken.
 *
 * Replaced with spaces rather than removed, so every other phrase keeps the line it sits on.
 *
 * Exported for the optional model pass, which must not be shown those sentences either: a phrase
 * it cannot see is a phrase it cannot propose, which is stronger than asking it not to. Its reply
 * is filtered again on the way back, so this is the first of two guards and not the only one.
 *
 * ⚠️ **Visibility only.** The behaviour is unchanged, and the classes it feeds are pinned by their
 * own tests — an edit here has to come past them.
 */
export function maskInsertedText(sectionText: string, sensitiveActionName?: string): string {
  const blank = (text: string, span: string): string =>
    span.length === 0 ? text : text.split(span).join(' '.repeat(span.length));

  let masked = sectionText;
  const named = sensitiveActionName?.trim();
  for (const naming of [named, GENERIC_SAFETY_NAMING_V1]) {
    if (naming === undefined || naming.length === 0) continue;
    const at = masked.indexOf(`before you do this ${naming}`);
    if (at < 0) continue;
    // The carried sentence runs to the end of its second scope unit; "Do not assume" is claimed
    // separately, so everything up to it goes.
    const end = masked.indexOf(CONFIRMATION_BOUNDARY_SPAN_V1, at);
    masked = blank(masked, masked.slice(at, end < 0 ? masked.length : end));
  }
  masked = blank(masked, POSTURE_STANCE_SPAN_V1);
  for (const match of sectionText.matchAll(/ — confirm before relying on it\./g)) {
    masked = blank(masked, match[0]);
  }
  return masked;
}

/**
 * Where a second thought begins. A class-1 mark stops here.
 *
 * The instruction is the verb and the thing it acts on; everything after one of these is the body
 * explaining, qualifying or adding — *"List out the exact steps **that lead to** hitting this null
 * error"*. Keeping the explanation makes the mark a sentence, and a sentence in bold is a paragraph
 * a reader skips.
 */
const CLASS_1_SECOND_THOUGHT: readonly string[] = [
  'that', 'which', 'so', 'to', 'for', 'while', 'when', 'after', 'before', 'and', 'because', 'since', 'if', 'whether',
];

/**
 * The fewest words a shortened instruction may keep: a verb and something to act on.
 *
 * ⚠️ Load-bearing, and the reason the rule is not simply "stop at the first one of those". `that`
 * can introduce the object itself — *"Check **that** the app's home page will respect…"* — and
 * stopping there leaves `Check` alone, which tells a reader nothing. Below this, the search goes on
 * to the next one.
 */
const CLASS_1_MIN_WORDS = 3 as const;

/**
 * An instruction cut back to the verb and its object.
 *
 * Measured over every class-1 mark the recorded bodies produce, plus a real popup's: median 13 → 7
 * words, longest 21 → 10, none left under three, and none cut mid-phrase — the stop is always a word
 * boundary the language itself provides.
 *
 * ⛔ A hard word ceiling was measured beside this and rejected: it produced `gather proof of what the
 * payments module currently` and `Check what specific diff files or changes are` — shorter, and
 * broken. A whole phrase reads better than a truncated one.
 */
function instructionObjectOnly(phrase: string): string {
  const words = phrase.trim().split(/\s+/);
  for (let index = CLASS_1_MIN_WORDS; index < words.length; index++) {
    if (CLASS_1_SECOND_THOUGHT.includes(words[index]!.toLowerCase())) return words.slice(0, index).join(' ');
  }
  return phrase;
}

/** The clause a word governs: the word, plus what follows it up to the clause's end. */
function clauseFrom(line: string, startIndex: number, wordLength: number): string {
  const rest = line.slice(startIndex + wordLength);
  const boundary = CLAUSE_BOUNDARY.exec(rest);
  const tail = boundary === null ? rest : rest.slice(0, boundary.index);
  return `${line.slice(startIndex, startIndex + wordLength)}${tail}`.trimEnd();
}

/** Find a whole-word occurrence of `word`, case-insensitively, or -1. */
function indexOfWord(line: string, word: string): number {
  const pattern = new RegExp(`(?:^|[^A-Za-z])(${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![A-Za-z])`, 'i');
  const match = pattern.exec(line);
  if (match === null) return -1;
  return match.index + match[0].length - (match[1] ?? '').length;
}

/** Is this body English enough for the class-1 grammar to apply? */
function classOneApplies(input: PromptEnhancementEmphasisInputV1): boolean {
  const language = input.detectedLanguageSelfReport?.trim().toLowerCase();
  if (language === undefined || language.length === 0) return true;
  return language === 'en' || language.startsWith('en-');
}

/** The class-1 candidates of one line: an instruction, with an object that traces. */
function classOneOfLine(line: string, userTerms: readonly string[]): PromptEnhancementEmphasisCandidateV1[] {
  // A list marker is punctuation, not a word, so a verb behind one still OPENS its clause. The
  // composer writes almost every instruction as `- Check that …`, and without this the marker sat in
  // front of every verb and the "only a verb that opens the clause counts" test below refused all of
  // them: measured on a real body, three verbs fire without the marker and none with it.
  //
  // The offsets the marks are placed at are found again in the FULL text later, so trimming here
  // costs nothing downstream — it only decides what the phrase is.
  line = line.replace(/^\s*[-•*]\s+/, '');

  // A composed line usually holds SEVERAL sentences, and each one is its own instruction. Judged as
  // one line, the first execution verb anywhere in it decides the fate of all of them: on a real
  // body, `- First, design the layout … Then, embed functionality that lets users update quantities
  // and delete items.` was refused whole, because `delete` sits in the third sentence with words in
  // front of it. Five instructions, none of them ever looked at.
  //
  // The offsets are found again in the FULL text later, so splitting costs nothing downstream — it
  // only decides which words are weighed against "does a verb open this clause".
  const sentences = line.split(/(?<=[.;!?])\s+/).filter((part) => part.trim().length > 0);
  if (sentences.length > 1) return sentences.flatMap((sentence) => classOneOfLine(sentence, userTerms));

  const lower = line.toLowerCase();
  // The verb has to head a clause — sentence-initial, or straight after one of the known heads.
  const heads: number[] = [0];
  for (const head of CLASS_1_CLAUSE_HEADS) {
    const at = lower.indexOf(head);
    if (at >= 0) heads.push(at + head.length);
  }

  const found: PromptEnhancementEmphasisCandidateV1[] = [];
  for (const head of heads) {
    const rest = line.slice(head);
    // Writes, the shapes that are dangerous on sight, and the reads that are still instructions.
    const verb = EXECUTION_VERB.exec(rest) ?? ALWAYS_ESCALATE_PATTERN.exec(rest) ?? READ_VERB.exec(rest);
    if (verb === null) continue;
    // Only a verb that opens the clause counts; one buried further in is the body describing
    // something, not instructing.
    const beforeVerb = rest.slice(0, verb.index).trim();
    if (beforeVerb.length > 0) continue;

    // The WHOLE clause, which is what the gate below reads: whether this instruction concerns
    // something the developer named is a property of the instruction, not of how much of it is
    // drawn. ⚠️ Asking the gate about the shortened form instead cost four of six instructions —
    // measured — because a term living in the clause's tail could no longer be seen.
    const clause = cutBeforeSecret(clauseFrom(rest, verb.index, verb[0].length));
    if (clause.length === 0) continue;
    // …and the mark itself, cut back to the verb and its object.
    const phrase = instructionObjectOnly(clause);
    if (phrase.length === 0) continue;
    // The object has to trace to something the developer or the project supplied. A verb with an
    // object nobody named is the body inventing work.
    const object = clause.slice(verb[0].length).trim();
    if (object.length === 0) continue;
    if (!userTerms.some((term) => object.toLowerCase().includes(term.toLowerCase()))) continue;

    found.push({ text: phrase, emphasisClass: 1, isWriteVerb: EXECUTION_VERB.test(verb[0]) });
  }
  return found;
}

/** The class-3 and class-4 candidates of one line: a limiter or a condition, with its clause. */
function boundaryAndConditionOfLine(line: string): PromptEnhancementEmphasisCandidateV1[] {
  const found: PromptEnhancementEmphasisCandidateV1[] = [];
  const claimed: string[] = [];

  const scan = (words: readonly string[], emphasisClass: 3 | 4): void => {
    for (const word of words) {
      const at = indexOfWord(line, word);
      if (at < 0) continue;
      // A longer limiter wins: "do not" is not also a bare "not".
      if (claimed.some((taken) => taken.toLowerCase().includes(word.toLowerCase()))) continue;
      // …and a bare "not" that negates nothing is a word in a phrase, not a limit.
      if (word === BARE_NOT && !bareNotIsGoverned(line, at)) continue;
      const phrase = cutBeforeSecret(clauseFrom(line, at, word.length));
      if (phrase.length === 0) continue;
      // Claimed whether or not it is drawn, so the "a longer limiter wins" test above keeps
      // working: `do not` must still stop a bare `not` marking the same words, even on a clause
      // too long to show.
      claimed.push(phrase);
      if (phrase.trim().split(/\s+/).length > CLASS_3_AND_4_MAX_WORDS_V1) continue;
      found.push({ text: phrase, emphasisClass });
    }
  };

  scan(CLASS_3_BOUNDARY_WORDS, 3);
  scan(CLASS_4_CONDITION_WORDS, 4);
  return found;
}

/** The class-5 candidates: the pipeline's own sentences, each marked only where it carries weight. */
function safetyLinesOf(
  sectionText: string,
  sensitiveActionName?: string,
): PromptEnhancementEmphasisCandidateV1[] {
  const found: PromptEnhancementEmphasisCandidateV1[] = [];
  // The confirmation: only its named action. Its second scope unit is a boundary, added below.
  const named = sensitiveActionName?.trim();
  if (named !== undefined && named.length > 0 && sectionText.includes(`before you do this ${named}`)) {
    found.push({ text: named, emphasisClass: 5 });
  }
  // The history-lane safeguard always carries the generic naming.
  if (sectionText.includes(`before you do this ${GENERIC_SAFETY_NAMING_V1}`)) {
    found.push({ text: GENERIC_SAFETY_NAMING_V1, emphasisClass: 5 });
  }
  // The stance: only the half that says what to do instead.
  if (sectionText.includes(POSTURE_STANCE_SPAN_V1)) {
    found.push({ text: POSTURE_STANCE_SPAN_V1, emphasisClass: 5 });
  }
  return found;
}

/**
 * Every phrase in this body that may be emphasised, with the class that earned it.
 *
 * Returned in body order, deduplicated by text and class. Nothing is located, capped or stored —
 * a candidate here has earned a mark, not been given one.
 */
export function classifyPromptEnhancementEmphasisCandidatesV1(
  input: PromptEnhancementEmphasisInputV1,
): readonly PromptEnhancementEmphasisCandidateV1[] {
  const candidates: PromptEnhancementEmphasisCandidateV1[] = [];
  /**
   * What has already been kept in this BODY.
   *
   * ⏪ Made per-section on 2026-09-27 and put back the same day. A phrase is marked where it FIRST
   * appears, and that is a ruling rather than an accident — `emphasis-locate.test.ts` states its
   * reason: *"a body that repeated the same six words in five sections would spend four and stop,
   * which is right."* Per-section dedupe reverses it, and a body that says `home page` in every
   * section would spend the whole budget on those two words.
   */
  const seen = new Set<string>();
  /** The section being read, stamped on every candidate it produces. */
  let currentSectionIndex = 0;
  const keep = (candidate: PromptEnhancementEmphasisCandidateV1): void => {
    const text = cutBeforeSecret(candidate.text).trim();
    if (text.length === 0) return;
    const key = `${candidate.emphasisClass}:${text.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ ...candidate, text, sectionIndex: currentSectionIndex });
  };

  const classOneOn = classOneApplies(input);

  for (const [sectionIndex, section] of input.sections.entries()) {
    if (NEVER_MARKED_SECTION_KINDS.has(section.sectionKind)) continue;
    const sectionStartedAt = candidates.length;
    currentSectionIndex = sectionIndex;

    const userTerms = collectPromptEnhancementEmphasisUserTermsV1({
      originalPromptText: input.originalPromptText,
      sectionText: section.sectionText,
      ...(section.groundedFactValues ? { groundedFactValues: section.groundedFactValues } : {}),
      ...(section.sourceFactIds ? { sourceFactIds: section.sourceFactIds } : {}),
      ...(section.sourceIds ? { sourceIds: section.sourceIds } : {}),
    });

    // A section the body was not cleared to propose an action in marks no instruction. The rule is
    // scoped to the risky kinds, and which lines carry one is decided where the risk is classified
    // — so an unset verdict never suppresses anything here.
    const classOneHere = classOneOn && section.clearanceVerdict !== 'not_proposed';

    for (const term of userTerms) keep({ text: term, emphasisClass: 2 });
    for (const safety of safetyLinesOf(section.sectionText, input.sensitiveActionName)) keep(safety);
    // The confirmation's second unit — a boundary, and the one place a fixed span is claimed
    // before the line scan, so "Do not assume, and do not rely…" is not taken as one long clause.
    if (section.sectionText.includes(CONFIRMATION_BOUNDARY_SPAN_V1)) {
      keep({ text: CONFIRMATION_BOUNDARY_SPAN_V1, emphasisClass: 3 });
    }

    // The line scan never sees what the pipeline wrote itself — those spans have their own marks.
    for (const line of maskInsertedText(section.sectionText, input.sensitiveActionName).split('\n')) {
      if (line.trim().length === 0) continue;
      if (classOneHere) for (const action of classOneOfLine(line, userTerms)) keep(action);
      for (const bound of boundaryAndConditionOfLine(line)) keep(bound);
    }

    // ⚠️ **A condition qualifies something, so it is not marked where nothing it qualifies is.**
    //
    // "before wrapping up" with no marked action, term or limit beside it says nothing on its own
    // — and measuring it over ten recorded popups showed what that costs: conditions were 16 of
    // 23 marks and 5 of the 6 that landed on a line the standard rejects. A connective turns up on
    // good lines and bad alike, so a class that fires on connectives alone spends the reader's
    // attention wherever the composer happened to put one.
    //
    // The standard's own worked example already reads this way: its "before reporting done" is
    // kept because it sits in the same section as "run the project's test suite", which is the
    // thing it qualifies.
    // A term the developer supplied that sits wholly inside an instruction IN THIS SECTION is
    // already marked by it. Two nested marks read as one ragged one, and they would spend this
    // section's cap twice for a single span.
    //
    // ⚠️ **In this section, and no further.** The test ran over the whole body until 2026-09-27, and
    // both halves of its reason are about ONE span: marks in different sections are not ragged and
    // are capped separately. Measured on a real popup, `home page` in section 5 was dropped because
    // an instruction in section 2 contained those words, and section 5 drew nothing at all.
    const actionsHere = candidates.slice(sectionStartedAt).filter((candidate) => candidate.emphasisClass === 1);
    if (actionsHere.length > 0) {
      const kept = candidates.slice(sectionStartedAt).filter((candidate) => {
        if (candidate.emphasisClass !== 2) return true;
        const nested = actionsHere.some((action) => action.text.toLowerCase().includes(candidate.text.toLowerCase()));
        // The key goes back with it, so a later section may still mark the same words.
        if (nested) seen.delete(`${candidate.emphasisClass}:${candidate.text.toLowerCase()}`);
        return !nested;
      });
      candidates.length = sectionStartedAt;
      candidates.push(...kept);
    }

    const fromThisSection = candidates.slice(sectionStartedAt);
    if (fromThisSection.length > 0 && fromThisSection.every((candidate) => candidate.emphasisClass === 4)) {
      // The dedupe keys go back too, so the same words can still be marked in a later section
      // that does give them something to qualify.
      for (const dropped of fromThisSection) seen.delete(`${dropped.emphasisClass}:${dropped.text.toLowerCase()}`);
      candidates.length = sectionStartedAt;
    }
  }

  return candidates;
}
