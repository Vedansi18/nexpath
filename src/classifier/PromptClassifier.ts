import type { ClassificationResult } from './types.js';
import { matchKeywords } from './KeywordMatcher.js';
import { classifyWithTFIDF } from './TFIDFClassifier.js';

/**
 * Two-tier keyword → TF-IDF classifier — the local, no-network stage classifier.
 *
 * Tier 1 (keyword match, <1ms):
 *   If the keyword matcher returns confidence ≥ 0.65, accept it.
 *
 * Tier 2 (TF-IDF, <5ms):
 *   Otherwise run TF-IDF; if its confidence ≥ 0.40, accept it.
 *
 * Final fallback:
 *   Return the higher-confidence of the two (best guess).
 *
 * This is the fallback the single-LLM stage classifier degrades to when the model
 * is unavailable (offline / no API key / API error).
 */

export const TIER1_CONFIDENCE_THRESHOLD = 0.65;
export const TIER2_CONFIDENCE_THRESHOLD = 0.40;

export async function classifyPrompt(text: string): Promise<ClassificationResult> {
  // ── Tier 1 ────────────────────────────────────────────────────────────────
  const t1 = matchKeywords(text);
  if (t1 && t1.confidence >= TIER1_CONFIDENCE_THRESHOLD) {
    return t1;
  }

  // ── Tier 2 ────────────────────────────────────────────────────────────────
  const t2 = classifyWithTFIDF(text);
  if (t2.confidence >= TIER2_CONFIDENCE_THRESHOLD) {
    return t2;
  }

  // Best guess from whichever tier got furthest
  if (t1 && t1.confidence > t2.confidence) return t1;
  return t2;
}
