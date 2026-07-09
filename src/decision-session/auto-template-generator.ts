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
import type { ContentTemplateRecord, LevelForm, MaturityLevel, TwoChannelCell } from './content-template-schema.js';
import { validateContentTemplateRecord, resolveLevelForm } from './content-template-schema.js';
import { sanitizePromptDerivedValue } from './content-template-grounding.js';
import { SCHEMA_VERSION } from '../store/schema.js';
import { upsertContentTemplate } from '../store/content-templates.js';
import { getConfig, isConfigSet, setConfig } from '../store/config.js';
import type { Store } from '../store/db.js';

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

/**
 * A compact behavioural summary the ranking / generation stages reason over —
 * NEVER raw prompt text. Lists the practices the user reliably does well plus
 * their maturity level.
 */
export function buildPatternSummary(rightGood: RightGoodProfile, maturityLevel: MaturityLevel): string {
  const strong = Object.entries(rightGood)
    .filter(([, s]) => s.state === 'right_good')
    .sort((a, b) => b[1].score - a[1].score)
    .map(([key]) => key);
  return [
    `Maturity level: ${maturityLevel} of 5.`,
    strong.length
      ? `Consistently good practices: ${strong.join(', ')}.`
      : 'No consistently distinctive good practices yet.',
  ].join('\n');
}

// ── Selection persistence (one ranking per project; the lazy trigger reads it) ──

const selectionKey = (projectRoot: string): string => `autogen_selection:${projectRoot}`;

/** Persist the ranked selection — records that the ranking has run, even if empty. */
export function persistSelection(store: Store, projectRoot: string, ranked: readonly RankedTopic[]): void {
  setConfig(store, selectionKey(projectRoot), JSON.stringify(ranked));
}

/** The persisted selection, or null if the ranking has not run for this project. */
export function readSelection(store: Store, projectRoot: string): RankedTopic[] | null {
  const raw = getConfig(store.db, selectionKey(projectRoot));
  if (raw === undefined) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RankedTopic[]) : [];
  } catch {
    return [];
  }
}

/** Whether the one-time ranking has already run for this project. */
export function selectionComputed(store: Store, projectRoot: string): boolean {
  return isConfigSet(store.db, selectionKey(projectRoot));
}

/** Whether a topic is in the persisted selection. */
export function isTopicSelected(store: Store, projectRoot: string, signalType: string): boolean {
  const sel = readSelection(store, projectRoot);
  return !!sel && sel.some((t) => t.signalType === signalType);
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

// ── Per-topic generation (lazy first-fire) ─────────────────────────────────────

function presetRecord(signalType: string): ContentTemplateRecord | undefined {
  return SHIPPED_CONTENT_TEMPLATES.find((r) => r.signalType === signalType);
}

/**
 * The generation prompt — inherit the topic keyword + skeleton, personalize wording
 * only, and carry the no-echo safety rules inline (defence in depth behind the
 * deterministic sanitize gate below).
 */
export function buildGenerationPrompt(presetCell: TwoChannelCell, summary: string): string {
  return [
    "Personalize a coding-agent advisory to a developer's OWN stable conventions, keeping its meaning.",
    'Rewrite the option (the message the developer sends to the agent) and the why-desc (the explanation',
    'the agent reads) to speak in the developer’s conventions — same intent, same topic keyword,',
    'wording and style only.',
    '',
    'STRICT SAFETY: never include secrets, API keys, tokens, credentials, file paths, URLs, emails, or any',
    'personal / identifying data, and never copy raw prompt text. Use only stable, general conventions.',
    '',
    `Baseline option: ${presetCell.option}`,
    `Baseline why-desc: ${presetCell.whyDesc}`,
    '',
    "Developer's conventions (summary):",
    summary,
    '',
    'Return strict JSON: {"option":"<rewritten option>","whyDesc":"<rewritten why-desc>"}.',
  ].join('\n');
}

/** Generate one personalized cell, then run the sanitize gate. Null on any failure. */
async function generateCell(client: OpenAI, prompt: string): Promise<TwoChannelCell | null> {
  const raw = await chat(client, prompt);
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const option = (parsed as { option?: unknown }).option;
  const whyDesc = (parsed as { whyDesc?: unknown }).whyDesc;
  if (typeof option !== 'string' || typeof whyDesc !== 'string') return null;
  // Sanitize gate on generate — a prompt-derived value must never reach CA-bound content.
  const cell: TwoChannelCell = {
    option:  sanitizePromptDerivedValue(option),
    whyDesc: sanitizePromptDerivedValue(whyDesc),
  };
  if (cell.option === '' || cell.whyDesc === '') return null;
  return cell;
}

/**
 * Generate a per-user record for one topic, seeded by its shipped preset. SPARSE —
 * the mandatory level-1 floor (inherited from the preset) plus the user's current
 * maturity column, personalized. The sensitive-action safeguard fields and the
 * slot / param-axis structure are inherited from the preset unchanged, so a
 * sensitive topic stays guarded. Returns null on a missing preset, a generation
 * failure, or a record that fails schema validation (never store an invalid record —
 * the read side then serves the preset).
 */
export async function generatePerUserRecord(
  signalType:     string,
  currentLevel:   MaturityLevel,
  patternSummary: string,
  client?: OpenAI,
): Promise<ContentTemplateRecord | null> {
  const preset = presetRecord(signalType);
  if (!preset) return null;
  const atLevel = resolveLevelForm(preset.levelForms, currentLevel);
  const floor   = resolveLevelForm(preset.levelForms, 1 as MaturityLevel);
  if (!atLevel || !floor) return null;

  const openai = client ?? new OpenAI();
  const cell = await generateCell(openai, buildGenerationPrompt(atLevel.form.cell, patternSummary));
  if (!cell) return null;

  const personalized: LevelForm = { kind: atLevel.form.kind, cell };
  const levelForms: Partial<Record<MaturityLevel, LevelForm>> =
    currentLevel === 1
      ? { 1: personalized }
      : { 1: floor.form, [currentLevel]: personalized };

  const record: ContentTemplateRecord = {
    signalType,
    source:              'autogen',
    schemaVersion:       SCHEMA_VERSION,
    question:            preset.question,
    pinchFallback:       preset.pinchFallback,
    levelForms,
    slots:               preset.slots,
    paramAxes:           preset.paramAxes,
    spine:               preset.spine,
    l2SafeguardRequired: preset.l2SafeguardRequired,
    l2SafeguardLine:     preset.l2SafeguardLine,
  };
  return validateContentTemplateRecord(record).ok ? record : null;
}

/** Generate + persist a per-user record (`source='autogen'`). Returns whether one was stored. */
export async function generateAndStoreAutogenRecord(
  store:          Store,
  projectRoot:    string,
  signalType:     string,
  currentLevel:   MaturityLevel,
  patternSummary: string,
  client?: OpenAI,
): Promise<boolean> {
  const record = await generatePerUserRecord(signalType, currentLevel, patternSummary, client);
  if (!record) return false;
  upsertContentTemplate(store, { projectRoot, signalType, source: 'autogen', record });
  return true;
}
