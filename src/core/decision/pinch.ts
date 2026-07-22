import type { LLMPort } from '../ports/llm.port.js';
import type { Stage, UserProfile } from '../classifier/types.js';
import type { FlagType } from '../stage2.js';
import { resolveDecisionContent } from './static-content.js';

/**
 * Pinch word generator (per decision-session-ux-research.md Part 4).
 *
 * Makes a separate gpt-4o-mini call to produce a 2-3 word "pinch label" —
 * a bold bright-cyan header line that opens the decision session.
 *
 * Fallback: if the API call fails, times out, or returns unusable output,
 * a static label is used from the content table (pinchFallback field).
 */

// ── Constants ──────────────────────────────────────────────────────────────────

export const PINCH_MODEL       = 'gpt-4o-mini';
export const PINCH_MAX_TOKENS  = 24;   // 2-3 words — generous budget
export const PINCH_TEMPERATURE = 0.9;  // creative variation
/** Maximum characters for a valid pinch label (2-3 short words). */
export const PINCH_MAX_CHARS   = 40;
/** Minimum characters — must be at least 2 chars (not empty). */
export const PINCH_MIN_CHARS   = 2;

// ── CO-STAR prompt ─────────────────────────────────────────────────────────────

function buildToneHint(profile: UserProfile): string {
  const modifiers: string[] = [];
  if (profile.mood === 'frustrated') modifiers.push('especially empathetic and patient');
  if (profile.mood === 'rushed')     modifiers.push('ultra-concise, no filler');
  if (profile.mood === 'excited')    modifiers.push('energetic and encouraging');
  if (profile.depth === 'high')      modifiers.push('peer-level technical, no hand-holding');
  if (profile.nature === 'beginner') modifiers.push('encouraging, jargon-free');
  return modifiers.length > 0
    ? `Motivating and friendly. Additional tone: ${modifiers.join('; ')}.`
    : 'Motivating and friendly, not judgmental. Like a trusted colleague tapping them on the shoulder.';
}

export function buildPinchPrompt(
  question:     string,
  flagType:     FlagType,
  currentStage: Stage,
  profile?:     UserProfile,
  language?:    string,
): string {
  const tone = profile
    ? buildToneHint(profile)
    : 'Motivating and friendly, not judgmental. Like a trusted colleague tapping them on the shoulder.';

  const isKnownEnglish = language === 'en';
  const plainEnglishNote = !isKnownEnglish
    ? '\n\nStyle note: Use plain, jargon-free English — no idioms or cultural references. The developer may not be a native English speaker.'
    : '';

  return `Context: A developer is using an AI coding agent. The system has detected that the developer may benefit from a quick check-in. The situation: ${question}

Objective: Generate a 2-3 word label that opens a short advisory popup. The label appears in bold at the top of the popup, above the question "${question}".

Style: Ultra-concise. Punchy. Memorable. Think of it as a chapter title or a traffic sign — not a sentence.

Tone: ${tone}

Audience: A developer who is moving fast with an AI coding agent. They may be mid-flow. The label should feel like a natural pause, not an interruption.

Response format: Output ONLY the 2-3 word label. No punctuation at the end. No quotes. No explanation. Examples of the right style: "Hold up.", "Quick check.", "Before coding.", "Worth a pause."

Flag type context: ${flagType}
Current stage: ${currentStage}${plainEnglishNote}

Output the label now:`;
}

// ── Validation ─────────────────────────────────────────────────────────────────

export function validatePinchLabel(raw: string): string | null {
  const cleaned = raw
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();

  if (!cleaned || cleaned.length < PINCH_MIN_CHARS) return null;
  if (cleaned.length > PINCH_MAX_CHARS) return null;

  const wordCount = cleaned.split(/\s+/).length;
  if (wordCount < 1 || wordCount > 4) return null;

  return cleaned;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Generate a 2-3 word pinch label for the decision session header.
 *
 * Tries the gpt-4o-mini API call first via LLMPort — CLI: OpenAILLMAdapter; browser: FetchLLMAdapter.
 * Falls back to the static label from the content table on any failure.
 *
 * Never throws — always returns a usable string.
 */
export async function generatePinchLabel(
  stage:     Stage,
  flagType:  FlagType,
  llm:       LLMPort,
  profile?:  UserProfile,
  language?: string,
): Promise<string> {
  const content  = resolveDecisionContent(stage, flagType);
  const fallback = content.pinchFallback;

  try {
    const prompt = buildPinchPrompt(content.question, flagType, stage, profile, language);

    const raw = await llm.chat({
      model:       PINCH_MODEL,
      messages:    [{ role: 'user', content: prompt }],
      temperature: PINCH_TEMPERATURE,
      max_tokens:  PINCH_MAX_TOKENS,
      timeoutMs:   10_000,
    });

    const label = validatePinchLabel(raw);
    return label ?? fallback;
  } catch {
    return fallback;
  }
}
