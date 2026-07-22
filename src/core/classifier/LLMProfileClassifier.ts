import type { LLMPort } from '../ports/llm.port.js';
import type { LogPort } from '../ports/log.port.js';
import type { PromptRecord, UserProfile, UserNature, UserMood, SessionDepth, OrdinalAxis } from './types.js';

// ── Constants ──────────────────────────────────────────────────────────────────

export const LLM_CLASSIFIER_MODEL      = 'gpt-4o-mini';
export const LLM_CLASSIFIER_MAX_TOKENS = 80;
export const LLM_CLASSIFIER_TEMP       = 0;
export const LLM_CLASSIFIER_TIMEOUT_MS = 3_000;
export const MIN_PROFILE_PROMPTS       = 4;

// ── Valid enum sets ────────────────────────────────────────────────────────────

const VALID_NATURE:  readonly UserNature[]  = ['hardcore_pro', 'pro_geek_soul', 'cool_geek', 'beginner'];
const VALID_MOOD:    readonly UserMood[]    = ['focused', 'excited', 'frustrated', 'casual', 'rushed', 'methodical'];
const VALID_DEPTH:   readonly SessionDepth[] = ['high', 'medium', 'low'];
const VALID_ORDINAL: readonly OrdinalAxis[] = ['low', 'medium', 'high', 'very_high'];

// ── Safe defaults ──────────────────────────────────────────────────────────────

const DEFAULT_NATURE:  UserNature   = 'beginner';
const DEFAULT_MOOD:    UserMood     = 'casual';
const DEFAULT_DEPTH:   SessionDepth = 'medium';
const DEFAULT_ORDINAL: OrdinalAxis  = 'medium';

const ORDINAL_TO_SCORE: Record<OrdinalAxis, number> = {
  very_high: 9.0,
  high:      7.0,
  medium:    5.0,
  low:       2.0,
};

const DEPTH_TO_SCORE: Record<SessionDepth, number> = {
  high:   3.0,
  medium: 1.0,
  low:    0.1,
};

export function deriveScores(
  precisionOrdinal:   OrdinalAxis,
  playfulnessOrdinal: OrdinalAxis,
  depth:              SessionDepth,
): { precisionScore: number; playfulnessScore: number; depthScore: number } {
  return {
    precisionScore:   ORDINAL_TO_SCORE[precisionOrdinal],
    playfulnessScore: ORDINAL_TO_SCORE[playfulnessOrdinal],
    depthScore:       DEPTH_TO_SCORE[depth],
  };
}

export function buildClassifierPrompt(history: PromptRecord[]): { system: string; user: string } {
  const numbered = history
    .map((r, i) => `${i + 1}. ${r.text}`)
    .join('\n');

  const system = `You are a developer profile classifier for an AI coding assistant.
Given the developer's recent prompts, classify five dimensions of their profile.
Return ONLY valid JSON — no explanation, no markdown.`;

  const user = `[DEVELOPER PROMPTS — last ${history.length} prompts, oldest to newest]
${numbered}

TECHNICAL VOCABULARY defined: specific framework/library names (React, Django, Stripe SDK),
protocol or API terms (REST, GraphQL, JWT, OAuth), infrastructure tools (PostgreSQL, Redis, S3),
or implementation patterns (pagination, foreign keys, CRUD, rate limiting, webhooks).
Words like "dashboard", "login", "button", "invoice", "account", "page", "form" are
product/UI terms — any non-developer would use them. They are NOT technical vocabulary.

NATURE — pick one (evaluate across ALL prompts — look for consistent pattern):
• "hardcore_pro"  — Precise technical commands, specific constraints and technology names,
                    architecture or performance thinking, minimal small talk, no hand-holding.
• "pro_geek_soul" — Same depth as hardcore_pro but expressive. Enthusiasm, "let's", energy,
                    informal phrasing alongside precise technical vocabulary.
• "cool_geek"     — Comfortable with tech, gets things done, but not deeply architectural.
                    Casual, informal, no constraint-explicit phrasing. Uses at least some
                    real technical vocabulary — framework names, tool names, or implementation terms.
• "beginner"      — Zero technical vocabulary across ALL prompts. Describes everything in
                    product/outcome terms. KEY test: would a non-developer say exactly this? If yes → beginner.

MOOD — pick one (focus on the most recent 3–5 prompts):
• "frustrated" | "rushed" | "excited" | "methodical" | "focused" | "casual"

DEPTH — pick one (focus on the most recent 5–10 prompts):
• "high" | "medium" | "low"

PRECISION — how explicitly does the developer specify constraints, edge cases, and implementation details?
• "very_high" | "high" | "medium" | "low"

PLAYFULNESS — how expressive, casual, or enthusiastic is the developer's writing style?
• "very_high" | "high" | "medium" | "low"

Return exactly this JSON and nothing else:
{"nature":"...","mood":"...","depth":"...","precision":"...","playfulness":"..."}`;

  return { system, user };
}

export interface RawLLMResponse {
  nature:      string;
  mood:        string;
  depth:       string;
  precision:   string;
  playfulness: string;
}

export function validateClassifierResponse(
  raw:      string,
  existing: UserProfile | null,
  log?:     LogPort,
): UserProfile | null {
  const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    log?.debug('llm_classifier_json_parse_fail', { raw: raw.slice(0, 200) });
    return null;
  }

  const p = parsed as Record<string, unknown>;

  const nature = VALID_NATURE.includes(p.nature as UserNature)
    ? (p.nature as UserNature)
    : (() => { log?.debug('llm_classifier_invalid_field', { field: 'nature', value: p.nature }); return null; })();

  const mood = VALID_MOOD.includes(p.mood as UserMood)
    ? (p.mood as UserMood)
    : (() => { log?.debug('llm_classifier_invalid_field', { field: 'mood', value: p.mood }); return null; })();

  const depth = VALID_DEPTH.includes(p.depth as SessionDepth)
    ? (p.depth as SessionDepth)
    : (() => { log?.debug('llm_classifier_invalid_field', { field: 'depth', value: p.depth }); return null; })();

  const precisionOrdinal = VALID_ORDINAL.includes(p.precision as OrdinalAxis)
    ? (p.precision as OrdinalAxis)
    : (() => { log?.debug('llm_classifier_invalid_field', { field: 'precision', value: p.precision }); return null; })();

  const playfulnessOrdinal = VALID_ORDINAL.includes(p.playfulness as OrdinalAxis)
    ? (p.playfulness as OrdinalAxis)
    : (() => { log?.debug('llm_classifier_invalid_field', { field: 'playfulness', value: p.playfulness }); return null; })();

  const resolvedNature             = nature            ?? (existing?.nature            ?? DEFAULT_NATURE);
  const resolvedMood               = mood              ?? (existing?.mood              ?? DEFAULT_MOOD);
  const resolvedDepth              = depth             ?? (existing?.depth             ?? DEFAULT_DEPTH);
  const resolvedPrecisionOrdinal   = precisionOrdinal  ?? (existing?.precisionOrdinal  ?? DEFAULT_ORDINAL);
  const resolvedPlayfulnessOrdinal = playfulnessOrdinal ?? (existing?.playfulnessOrdinal ?? DEFAULT_ORDINAL);

  const { precisionScore, playfulnessScore, depthScore } = deriveScores(
    resolvedPrecisionOrdinal,
    resolvedPlayfulnessOrdinal,
    resolvedDepth,
  );

  return {
    nature:             resolvedNature,
    precisionScore,
    playfulnessScore,
    precisionOrdinal:   resolvedPrecisionOrdinal,
    playfulnessOrdinal: resolvedPlayfulnessOrdinal,
    mood:               resolvedMood,
    depth:              resolvedDepth,
    depthScore,
    computedAt:         existing?.computedAt ?? 0,
  };
}

export function buildSafeDefaults(computedAt: number): UserProfile {
  const { precisionScore, playfulnessScore, depthScore } = deriveScores(
    DEFAULT_ORDINAL,
    DEFAULT_ORDINAL,
    DEFAULT_DEPTH,
  );
  return {
    nature:             DEFAULT_NATURE,
    precisionScore,
    playfulnessScore,
    precisionOrdinal:   DEFAULT_ORDINAL,
    playfulnessOrdinal: DEFAULT_ORDINAL,
    mood:               DEFAULT_MOOD,
    depth:              DEFAULT_DEPTH,
    depthScore,
    computedAt,
  };
}

/**
 * Classifies the developer profile via a single async LLM call.
 *
 * Returns the existing profile unchanged on any failure. Never throws.
 *
 * @param llm   LLMPort implementation — CLI: OpenAILLMAdapter; browser: FetchLLMAdapter.
 * @param log   Optional LogPort for debug output.
 */
export async function classifyUserProfileLLM(
  history:     PromptRecord[],
  promptCount: number,
  existing:    UserProfile | null,
  llm:         LLMPort,
  log?:        LogPort,
): Promise<UserProfile> {
  if (history.length < MIN_PROFILE_PROMPTS - 1) {
    return existing ?? buildSafeDefaults(promptCount);
  }

  try {
    const { system, user } = buildClassifierPrompt(history);

    const raw = await llm.chat({
      model:           LLM_CLASSIFIER_MODEL,
      messages:        [
        { role: 'system', content: system },
        { role: 'user',   content: user   },
      ],
      temperature:     LLM_CLASSIFIER_TEMP,
      max_tokens:      LLM_CLASSIFIER_MAX_TOKENS,
      response_format: { type: 'json_object' },
      timeoutMs:       LLM_CLASSIFIER_TIMEOUT_MS,
    });

    const validated = validateClassifierResponse(raw, existing, log);

    if (!validated) {
      log?.debug('llm_classifier_validation_fail', { raw: raw.slice(0, 200) });
      return existing ?? buildSafeDefaults(promptCount);
    }

    return { ...validated, computedAt: promptCount };
  } catch (err) {
    log?.debug('llm_classifier_error', { error: String(err) });
    return existing ?? buildSafeDefaults(promptCount);
  }
}
