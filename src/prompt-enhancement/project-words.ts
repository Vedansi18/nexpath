import type { PromptEnhancementGuidanceFact } from './templates/section-plan.js';

/**
 * PROJECT WORDS — the project's own facts, as two to five words inside a sentence another section writes anyway.
 *
 * Project grounding. The project-facts section states the probe's facts; every other section used to be
 * written as if the project did not exist. This module lets ONE other section per fact carry it, in the only shape
 * measured to read as grounding rather than as filler:
 *
 *   "Add the reschedule button to the appointment details page in the Next.js app."
 *
 * ── Why it is built this way (measured on the writer itself, 2026-10-10, before any of this was written) ──────────
 *
 *   - Telling the writer "these facts may be used in any section" made it bolt a sentence about the fact onto almost
 *     every section ("Since the project has a CI pipeline, leverage it…"): ~60 of 70 sampled bodies, against 1 of 70
 *     for today's writer. So the writer is never told that. NexPath picks the section — a static list of the section
 *     kinds each fact serves (`HOST_SECTION_KINDS`), one section per fact — and only that section is asked.
 *   - The ask is one line, last in that section's own list, and the words come back marked `[[ ]]`. Stronger or
 *     earlier wording made the writer reshape the whole body (a rollout section collapsed into one "run the tests"
 *     sentence; whole bodies 15–30% shorter), so the line asks for nothing but the words.
 *   - The writer still decides whether and where the words go; NexPath only checks them. A marked phrase is KEPT only
 *     when every check below holds; otherwise it is removed, which is always safe because the phrase is a "in the …"
 *     phrase the sentence was written to read without.
 *   - Only facts whose words change the instruction are offered: today, the framework. A bare "has a test runner" or
 *     "has a lockfile" read as filler in every sampled body ("All tests will be run with the project's test runner.").
 *     "in the CI pipeline" was offered too and withdrawn: the writer kept it in few bodies, and once primed it named
 *     the CI pipeline in other sections ("monitor the CI pipeline for error logs") three times as often as today, and
 *     once echoed this module's own instruction into the body. Those facts stay in the project-facts section exactly
 *     as before. The probe records the test runner and the CI pipeline as present or absent only, so neither has a
 *     name to carry.
 *
 * ── What it never does ──────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   - It never writes a sentence, and never words a fact itself: the phrase is the writer's, inside the writer's own
 *     sentence, or it is gone.
 *   - It never touches the project-facts section's wording (brackets there are dropped, words kept), a section that
 *     was not offered the fact (only `[[ ]]` it was asked for is removed — the writer's own mention stays exactly as
 *     it would today), or any body whose plan offered nothing — there is nothing to resolve, and nothing runs.
 *   - It never lets `[[ ]]` reach a shown body: brackets the writer borrowed for words of its own lose the brackets
 *     and keep the words (a developer whose request uses `[[ ]]` keeps theirs).
 */

export type PromptEnhancementProjectWordKindV1 = 'framework';

export interface PromptEnhancementProjectWordV1 {
  readonly kind: PromptEnhancementProjectWordKindV1;
  /** The exact words, as the host section is asked to write them: "in the Next.js app". */
  readonly phrase: string;
  /** The names the words state, for the no-invention check: a host section that KEEPS the words may name them. */
  readonly namedValues: readonly string[];
}

/**
 * The probe's framework values (`framework-fingerprints.ts`) as a developer writes them. A value missing here is not
 * offered — "in the vite app" is not how anyone describes a project, and an unknown name could be read as invented.
 */
const FRAMEWORK_DISPLAY_NAMES_V1: Readonly<Record<string, string>> = {
  nextjs: 'Next.js',
  nuxtjs: 'Nuxt',
  remix: 'Remix',
  gatsby: 'Gatsby',
  astro: 'Astro',
  sveltekit: 'SvelteKit',
  nestjs: 'NestJS',
  angular: 'Angular',
  expo: 'Expo',
  'react-native': 'React Native',
  react: 'React',
  vue: 'Vue',
  svelte: 'Svelte',
  solidjs: 'SolidJS',
  preact: 'Preact',
  express: 'Express',
  fastify: 'Fastify',
  koa: 'Koa',
  hono: 'Hono',
};

/** The words a fact may be named by in another section, or undefined when the fact offers none. */
export function promptEnhancementProjectWordForFactV1(
  fact: Pick<PromptEnhancementGuidanceFact, 'evidence'>,
): PromptEnhancementProjectWordV1 | undefined {
  const key = fact.evidence?.key;
  const value = (fact.evidence?.value ?? '').trim();
  if (key === 'project_framework') {
    const name = FRAMEWORK_DISPLAY_NAMES_V1[value];
    if (name !== undefined) return { kind: 'framework', phrase: `in the ${name} app`, namedValues: [name] };
  }
  return undefined;
}

/**
 * The section kinds each word may be offered to, best first — the sections whose own job is the code being written:
 * where a page, route, component or endpoint is added, the framework is where it goes.
 */
const HOST_SECTION_KINDS_V1: Readonly<Record<PromptEnhancementProjectWordKindV1, readonly string[]>> = {
  framework: [
    'approach_or_steps', 'incremental_steps', 'interfaces_modules', 'affected_surface', 'narrow_fix_boundary',
    'code_diff_target', 'target_artifact', 'suggested_changes', 'suggested_fixes', 'desired_extension',
  ],
};

export function promptEnhancementProjectWordHostKindsV1(kind: PromptEnhancementProjectWordKindV1): readonly string[] {
  return HOST_SECTION_KINDS_V1[kind];
}

/**
 * Is the body's language one the checks below can read? They judge English words, so a body the developer writes in
 * another language is offered nothing — its sections are worded exactly as before. An unknown language is offered the
 * words: the writer's own report decides afterwards, and a non-English reply keeps none of them.
 */
export function promptEnhancementProjectWordsLanguageAllowedV1(language: string | undefined): boolean {
  const code = (language ?? '').trim().toLowerCase();
  return code === '' || code === 'unknown' || code === 'en' || code.startsWith('en-');
}

/** The one line a host section's "this section must" list ends with. */
export function promptEnhancementProjectWordDirectiveV1(word: PromptEnhancementProjectWordV1): string {
  return `If a sentence here tells the agent to add or change a route, page, component, endpoint or API handler, add [[${word.phrase}]] right after the thing being added.`;
}

/** What the words right before the phrase must be about, by kind. */
const ANCHOR_WORDS_V1: Readonly<Record<PromptEnhancementProjectWordKindV1, ReadonlySet<string>>> = {
  framework: new Set([
    'route', 'routes', 'routing', 'page', 'pages', 'component', 'components', 'endpoint', 'endpoints', 'api', 'handler',
    'handlers', 'layout', 'layouts', 'middleware', 'view', 'views', 'screen', 'screens', 'action', 'actions', 'hook',
    'hooks', 'service', 'services', 'button', 'form', 'modal',
  ]),
};

/** Words that end a clause: the phrase must attach to what comes after the last of them, not to an earlier clause. */
const CLAUSE_JOINERS_V1: ReadonlySet<string> = new Set(
  ['and', 'or', 'then', 'but', 'so', 'while', 'before', 'after', 'once', 'when', 'if', 'until'],
);

/**
 * Words too common to show that a sentence is about THIS request. A sentence that, without the phrase, names nothing
 * from the developer's request beyond these ("These tests need to run.") was written to hold the phrase.
 */
const GENERIC_WORDS_V1: ReadonlySet<string> = new Set([
  'test', 'tests', 'testing', 'check', 'checks', 'checking', 'change', 'changes', 'code', 'feature', 'features',
  'functionality', 'function', 'functions', 'work', 'works', 'working', 'issue', 'issues', 'error', 'errors', 'step',
  'steps', 'process', 'project', 'application', 'data', 'user', 'users', 'system', 'update', 'updates', 'verify',
  'ensure', 'make', 'sure', 'correctly', 'properly', 'expected', 'behavior', 'behaviour', 'write', 'written', 'with',
  'that', 'this', 'these', 'those', 'will', 'should', 'must', 'have', 'from', 'into', 'them', 'they', 'when', 'then',
  'before', 'after', 'each', 'every', 'also', 'need', 'needs', 'want', 'able', 'just', 'like', 'some', 'what', 'which',
  'there', 'their', 'here', 'only', 'more', 'most', 'other', 'such', 'than', 'very', 'about', 'over', 'your', 'unit',
  'units', 'suite', 'pipeline', 'runs', 'running', 'pass', 'passes', 'passing', 'confirm', 'validate', 'validation',
  'implement', 'implementation', 'create', 'build', 'added', 'adding', 'next', 'app',
]);

/** The longest a sentence written only to hold the phrase is measured to be, without it. */
const HOLDING_SENTENCE_MAX_WORDS_V1 = 8;

const MARKED_SPAN_V1 = /\s?\[\[([^[\]\n]{1,80})\]\]/g;

const normalizeV1 = (text: string): string => text.replace(/\s+/g, ' ').trim();
const escapeRegExpV1 = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const bareWordV1 = (word: string): string =>
  word.toLowerCase().replace(/^[("'“‘]+|[)"'”’,;:!?]+$/g, '').replace(/\.$/, '');

function contentWordsV1(text: string): ReadonlySet<string> {
  return new Set((text.toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g) ?? []).filter((word) => !GENERIC_WORDS_V1.has(word)));
}

/** Does the sentence name something from the developer's own request? */
function namesSomethingFromRequestV1(sentence: string, originalPromptText: string): boolean {
  const requestWords = contentWordsV1(originalPromptText);
  for (const word of contentWordsV1(sentence)) if (requestWords.has(word)) return true;
  return false;
}

/** The last words before `offset`, inside the same clause. */
function leadWordsV1(textBefore: string): readonly string[] {
  const clause = textBefore.split(/[,;:.!?\n]\s*/).pop() ?? '';
  const words = normalizeV1(clause).split(' ').filter((word) => word.length > 0).map(bareWordV1);
  let start = words.length - 1;
  while (start >= 0 && !CLAUSE_JOINERS_V1.has(words[start]!)) start--;
  return words.slice(start + 1).slice(-5);
}

/** The sentence around `[start, end)` in `text`, with every marked span taken out. */
function sentenceAroundV1(text: string, start: number, end: number): string {
  const before = text.slice(0, start);
  const sentenceStart = Math.max(before.lastIndexOf('. '), before.lastIndexOf('? '), before.lastIndexOf('! '), before.lastIndexOf('\n'));
  const after = text.slice(end);
  const stop = after.search(/[.!?](\s|$)|\n/);
  const raw = `${before.slice(sentenceStart + 1)}${stop < 0 ? after : after.slice(0, stop + 1)}`;
  return normalizeV1(raw.replace(MARKED_SPAN_V1, ''));
}

export interface PromptEnhancementProjectWordResolutionV1 {
  /** The section's text with every one of OUR spans resolved: kept words unmarked, everything else removed. */
  readonly text: string;
  /** The phrase this section kept, when it kept one. */
  readonly keptPhrase?: string;
}

/**
 * Resolve the project words in ONE section's text.
 *
 * `bodyPhrases` are every phrase offered anywhere in this body; `hostWord` is the one THIS section was offered, if
 * any. With `keep: false` every span of ours is treated as refused — that is the body the words are compared against,
 * so the two can differ in nothing but the kept words.
 *
 * A span counts as ours when it is marked `[[ ]]` and is one of `bodyPhrases`, or — in the host section only — when the
 * writer wrote the host's phrase without the marks. Anything else, marked or not, is left exactly as written.
 */
export function resolvePromptEnhancementProjectWordsV1(input: {
  readonly text: string;
  readonly sectionKind: string;
  readonly hostWord?: PromptEnhancementProjectWordV1;
  readonly bodyPhrases: readonly string[];
  readonly originalPromptText: string;
  readonly keep: boolean;
}): PromptEnhancementProjectWordResolutionV1 {
  const ours = (span: string): boolean =>
    input.bodyPhrases.some((phrase) => phrase.toLowerCase() === normalizeV1(span).toLowerCase());
  // Our [[ ]] notation never reaches a shown body. Asked to mark the project words, the writer now and then borrows it
  // for words of its own ("[[from the current signals]]" — measured 2026-10-10: 3 of ~280 replies that were asked for
  // the framework words, 0 of 604 that were not; one reached a shown body). Those keep their words and lose the
  // brackets. A developer whose own request uses [[ ]] keeps theirs.
  const unbracketed = (text: string): string =>
    input.originalPromptText.includes('[[') ? text : text.replace(/\[\[|\]\]/g, '');
  if (!input.text.includes('[[') && !input.text.includes(']]')
    && (input.hostWord === undefined || !new RegExp(escapeRegExpV1(input.hostWord.phrase), 'i').test(input.text))) {
    return { text: input.text };
  }
  if (input.sectionKind === 'project_grounding_facts' || input.sectionKind === 'original_request_or_goal') {
    // This section states its own facts as it always has: only our marks go, the words stay.
    return { text: unbracketed(input.text.replace(/\[\[([^[\]\n]{1,80})\]\]/g, (whole, inner: string) => (ours(inner) ? inner : whole))) };
  }
  let text = input.text;
  // In the host section the writer sometimes forgets the marks; its own phrase is then judged exactly as if marked.
  if (input.hostWord !== undefined) {
    const bare = new RegExp(`(?<!\\[\\[)\\b${escapeRegExpV1(input.hostWord.phrase)}\\b(?!\\]\\])`, 'gi');
    text = text.replace(bare, (match) => `[[${match}]]`);
  }
  let keptPhrase: string | undefined;
  const holdingSentences: string[] = [];
  text = text.replace(MARKED_SPAN_V1, (whole: string, inner: string, offset: number, all: string) => {
    if (!ours(inner)) return whole;
    const phrase = normalizeV1(inner);
    const sentence = sentenceAroundV1(all, offset, offset + whole.length);
    const namesRequest = namesSomethingFromRequestV1(sentence, input.originalPromptText);
    const keepIt = input.keep
      && keptPhrase === undefined
      && input.hostWord !== undefined
      && input.hostWord.phrase.toLowerCase() === phrase.toLowerCase()
      && leadWordsV1(all.slice(0, offset)).some((word) => ANCHOR_WORDS_V1[input.hostWord!.kind].has(word))
      && !/(?:^|\s)(?:in|inside|within)\s+(?:(?:the|your|our|this|my)\s+)?(?:project|app|application|codebase|repo|repository)$/i
        .test(leadWordsV1(all.slice(0, offset)).slice(-4).join(' '))
      && namesRequest;
    if (keepIt) {
      keptPhrase = input.hostWord!.phrase;
      return `${whole.startsWith(' ') ? ' ' : ''}${inner}`;
    }
    // In the section that was ASKED for the words, a short sentence that names nothing from the request was written to
    // hold them: it goes with them, so the section is not left with a stray "These tests need to run." Same rule
    // whether or not the words could be kept. Anywhere else only the words go — a sentence there is the writer's own.
    if (input.hostWord !== undefined && !namesRequest && sentence.split(' ').length <= HOLDING_SENTENCE_MAX_WORDS_V1) {
      holdingSentences.push(sentence);
    }
    return '';
  });
  let withoutHolding = text;
  for (const sentence of holdingSentences) {
    const at = withoutHolding.indexOf(sentence);
    if (at >= 0) withoutHolding = `${withoutHolding.slice(0, at)}${withoutHolding.slice(at + sentence.length)}`.replace(/ {2,}/g, ' ').trim();
  }
  // Never empty a section: a draft that was nothing but such a sentence keeps it, without the words, rather than
  // turning into a section the writer's reply does not cover.
  if (withoutHolding.length > 0) text = withoutHolding;
  text = unbracketed(text);
  return keptPhrase === undefined ? { text } : { text, keptPhrase };
}
