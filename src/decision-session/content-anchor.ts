/**
 * Topic-anchor retention gate for per-user (auto-gen) content.
 *
 * A personalized cell may re-voice a topic, but it must keep the topic's anchor — it
 * must not drift into a different topic. The anchor is the topic's own vocabulary:
 *  - for an absence topic, the significant WORDS of its detection keywords (e.g.
 *    `test_creation` → "tests", "coverage", "suite"…), minus the cross-topic action
 *    verbs / stopwords that carry no topic meaning;
 *  - for a keyword-less stage-transition topic, a significant word shared with the
 *    preset cell it was seeded from.
 *
 * A personalized cell that keeps no anchor word falls back to the preset cell (the
 * non-degradation read gate — never serve off-anchor personalized content).
 */

import { SIGNAL_MAP } from '../classifier/signals.js';
import type { TwoChannelCell } from './content-template-schema.js';

/** Words that appear across many topics' detection keywords — not a topic anchor. */
const STOPWORDS: ReadonlySet<string> = new Set([
  // articles / prepositions / pronouns / connectors
  'the', 'a', 'an', 'to', 'of', 'and', 'or', 'is', 'it', 'in', 'on', 'for', 'you', 'your',
  'me', 'my', 'this', 'that', 'with', 'before', 'after', 'are', 'be', 'been', 'have', 'has',
  'not', 'no', 'what', 'when', 'how', 'if', 'so', 'we', 'at', 'by', 'as', 'from', 'into',
  'out', 'up', 'down', 'each', 'any', 'all', 'its', 'them', 'they', 'their', 'about',
  // cross-topic action verbs common in detection keywords (carry no topic meaning)
  'write', 'writing', 'add', 'adding', 'create', 'creating', 'use', 'using', 'run', 'running',
  'make', 'making', 'set', 'setting', 'get', 'getting', 'check', 'checking', 'build', 'building',
  'ensure', 'consider', 'review', 'reviewing', 'define', 'defining', 'apply', 'update',
  'updating', 'fix', 'fixing', 'confirm', 'start', 'starting', 'keep', 'keeping', 'do', 'done',
  'need', 'want', 'should', 'let', 'now', 'first', 'more', 'some',
]);

function significantWords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z-]{2,}/g) ?? []).filter((w) => !STOPWORDS.has(w));
}

/** The topic's detection keyword phrases, via the `ABSENCE_<UPPER(key)>` convention. [] for non-absence. */
export function topicKeywords(signalType: string): string[] {
  if (!signalType.startsWith('ABSENCE_')) return [];
  const key = signalType.slice('ABSENCE_'.length).toLowerCase();
  return SIGNAL_MAP.get(key)?.detectionKeywords ?? [];
}

/** The topic's anchor WORDS — the significant words of its detection keywords. */
export function topicAnchorWords(signalType: string): string[] {
  const words = new Set<string>();
  for (const kw of topicKeywords(signalType)) for (const w of significantWords(kw)) words.add(w);
  return [...words];
}

/**
 * Does the personalized cell retain the topic anchor? A keyword-bearing topic must
 * contain ≥1 of its anchor words; a keyword-less topic must share ≥1 significant word
 * with the preset cell. An empty cell never retains the anchor.
 */
export function retainsTopicAnchor(
  signalType: string,
  personalized: TwoChannelCell,
  presetCell: TwoChannelCell,
): boolean {
  if (personalized.option.trim() === '' || personalized.whyDesc.trim() === '') return false;
  const textWords = new Set(significantWords(`${personalized.option} ${personalized.whyDesc}`));

  const anchors = topicAnchorWords(signalType);
  if (anchors.length > 0) return anchors.some((w) => textWords.has(w));

  // Keyword-less topic (stage transition) → require overlap with the preset's words.
  const presetWords = new Set(significantWords(`${presetCell.option} ${presetCell.whyDesc}`));
  for (const w of textWords) if (presetWords.has(w)) return true;
  return false;
}
