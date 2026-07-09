/**
 * Per-user content-template producer (the `autogen` cascade tier).
 *
 * Topic SELECTION: once at install, a single LLM ranking call picks the topics
 * where the user's own conventions are distinctive enough to personalize — the
 * rest keep the shipped preset. The ranker sees a COMPACT behavioural summary
 * (the aggregated right/good + work-style + env signals), never raw prompt text.
 *
 * Candidates are pre-filtered before the model sees them:
 *  - a topic where the user reliably does the RIGHT thing → eligible (absorb it);
 *  - a topic that maps to a mistake the advisories exist to CORRECT → never
 *    eligible (we must not personalize toward a bad habit — a safety invariant);
 *  - a neutral topic → eligible UNLESS it overlaps a known anti-pattern.
 *
 * The whole pass is a no-op with no history (a brand-new project): nothing is
 * eligible, so nothing is personalized until behaviour accrues.
 */

import OpenAI from 'openai';
import type { RightGoodProfile } from '../classifier/right-good-aggregator.js';
import { ANTI_PATTERN_KEYS } from '../classifier/maturity-level.js';
import { SHIPPED_CONTENT_TEMPLATES } from './content-template-tooling.js';

/** The full set of personalizable topics — every shipped record's signalType. */
export function topicUniverse(): string[] {
  return SHIPPED_CONTENT_TEMPLATES.map((r) => r.signalType);
}

/**
 * The signal key behind a topic, or null. Absence topics follow the
 * `ABSENCE_<UPPER(key)>` convention; non-absence topics (stage transitions) have
 * no discipline-signal key, so they carry no right/good state.
 */
export function signalKeyForTopic(signalType: string): string | null {
  return signalType.startsWith('ABSENCE_')
    ? signalType.slice('ABSENCE_'.length).toLowerCase()
    : null;
}

export type TopicPolarity = 'good' | 'in_between' | 'bad';

/** Classify a topic from the user's longitudinal right/good profile. */
export function classifyTopicPolarity(signalType: string, rightGood: RightGoodProfile): TopicPolarity {
  const key = signalKeyForTopic(signalType);
  if (key === null) return 'in_between'; // non-absence topic — no right/good signal
  const state = rightGood[key]?.state ?? 'neutral';
  if (state === 'right_good') return 'good';
  if (state === 'mistake') return 'bad';
  return 'in_between';
}

/** A neutral topic overlaps a known mistake when its signal is a (−) anti-pattern. */
export function overlapsKnownMistake(signalType: string): boolean {
  const key = signalKeyForTopic(signalType);
  return key !== null && ANTI_PATTERN_KEYS.has(key);
}

/**
 * The absorb filter: keep RIGHT-done topics, drop mistake-mapped topics entirely,
 * keep neutral topics unless they overlap a known anti-pattern.
 */
export function filterEligibleTopics(universe: readonly string[], rightGood: RightGoodProfile): string[] {
  return universe.filter((st) => {
    const polarity = classifyTopicPolarity(st, rightGood);
    if (polarity === 'bad') return false;
    if (polarity === 'in_between' && overlapsKnownMistake(st)) return false;
    return true;
  });
}

/** One ranked topic + the model's confidence that the user's convention is distinctive. */
export interface RankedTopic {
  signalType: string;
  confidence: number;
}

export interface SelectionInput {
  /** The longitudinal right/good profile (drives the absorb filter). */
  rightGood: RightGoodProfile;
  /** A compact behavioural summary the ranker reasons over — never raw prompt text. */
  patternSummary: string;
}

/** Default confidence bar a ranked topic must clear to be personalized. */
export const DEFAULT_CONFIDENCE_BAR = 0.6;
/** The coverage target reached AS history accrues — never forced on thin history. */
export const COVERAGE_TARGET = 12;

export const SELECTION_MODEL = 'gpt-4o-mini';

/** One JSON chat round-trip. Fail-open: any error / malformed reply → empty string. */
async function chat(client: OpenAI, prompt: string): Promise<string> {
  try {
    const response = await client.chat.completions.create({
      model: SELECTION_MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0,
    });
    return response.choices[0]?.message?.content ?? '';
  } catch {
    return '';
  }
}

export function buildSelectionPrompt(summary: string, eligible: readonly string[]): string {
  return [
    'You rank which of a developer\'s workflow topics are worth personalizing to their own conventions.',
    'Given a compact behavioural summary and a list of candidate topics, return the topics whose',
    'conventions are DISTINCTIVE and STABLE enough to be worth tailoring — with a 0..1 confidence each.',
    '',
    'Behavioural summary:',
    summary,
    '',
    'Candidate topics (choose only from these):',
    eligible.join(', '),
    '',
    'Return strict JSON: {"topics":[{"signalType":"<one of the candidates>","confidence":<0..1>}, ...]}.',
    'Omit topics that are not distinctive. Do not invent topics outside the candidate list.',
  ].join('\n');
}

/** Parse the ranker reply → ranked topics restricted to the eligible set, clamped. */
function parseRanked(raw: string, eligible: ReadonlySet<string>): RankedTopic[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const rows = (parsed as { topics?: unknown }).topics;
  if (!Array.isArray(rows)) return [];
  const out: RankedTopic[] = [];
  for (const row of rows) {
    const st = (row as { signalType?: unknown }).signalType;
    const conf = (row as { confidence?: unknown }).confidence;
    if (typeof st !== 'string' || !eligible.has(st)) continue;
    const confidence = typeof conf === 'number' && Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0;
    out.push({ signalType: st, confidence });
  }
  return out;
}

/**
 * Rank the distinctive topics for a user via one bootstrap LLM call. Returns []
 * when nothing is eligible (a no-history project), so no call is made.
 */
export async function selectDistinctiveTopics(input: SelectionInput, client?: OpenAI): Promise<RankedTopic[]> {
  const eligible = filterEligibleTopics(topicUniverse(), input.rightGood);
  if (eligible.length === 0) return [];
  const openai = client ?? new OpenAI();
  const raw = await chat(openai, buildSelectionPrompt(input.patternSummary, eligible));
  return parseRanked(raw, new Set(eligible));
}

/**
 * Coverage: keep the topics that clear the confidence bar, most-confident first.
 * The target is reached as history accrues — thin history is NOT padded with
 * below-bar topics to hit it. A no-history project personalizes nothing.
 */
export function applyCoverageFloor(
  ranked: readonly RankedTopic[],
  hasHistory: boolean,
  confidenceBar: number = DEFAULT_CONFIDENCE_BAR,
): RankedTopic[] {
  if (!hasHistory) return [];
  return ranked
    .filter((t) => t.confidence >= confidenceBar)
    .sort((a, b) => b.confidence - a.confidence);
}
