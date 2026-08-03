import type { ClassificationResult } from './types.js';
import { matchKeywords } from './KeywordMatcher.js';
import type { EmbeddingClassifier } from './EmbeddingClassifier.js';

/**
 * Three-tier cascade classifier.
 *
 * Tier 1 (keyword match, <1ms):
 *   If the keyword matcher returns confidence ≥ 0.65, accept it.
 *
 * Tier 2 (TF-IDF, <5ms, optional):
 *   CLI injects classifyWithTFIDF via opts.tidfClassifier.
 *   Browser skips Tier 2 (no Node-compatible TF-IDF library) and falls through to Tier 3.
 *   If confidence ≥ 0.40, accept it.
 *
 * Tier 3 (MiniLM embedding, <30ms, optional):
 *   If Tier 1/2 both produce confidence < 0.40 AND an EmbeddingClassifier is available,
 *   try it. Accept whatever confidence it returns.
 *
 * Final fallback:
 *   Return best result available.
 */

export const TIER1_CONFIDENCE_THRESHOLD = 0.65;
export const TIER2_CONFIDENCE_THRESHOLD = 0.40;

export type TidfFn = (text: string) => ClassificationResult;

export interface ClassifierOptions {
  embeddingClassifier?: EmbeddingClassifier | null;
  /** CLI provides classifyWithTFIDF from TFIDFClassifier (Node-only). Browser omits this → Tier 2 skipped. */
  tidfClassifier?: TidfFn | null;
}

export async function classifyPrompt(
  text: string,
  opts: ClassifierOptions = {},
): Promise<ClassificationResult> {
  // ── Tier 1 ────────────────────────────────────────────────────────────────
  const t1 = matchKeywords(text);
  if (t1 && t1.confidence >= TIER1_CONFIDENCE_THRESHOLD) {
    return t1;
  }

  // ── Tier 2 (CLI only — TFIDFClassifier uses Node's createRequire/natural) ──
  let t2: ClassificationResult | null = null;
  if (opts.tidfClassifier) {
    t2 = opts.tidfClassifier(text);
    if (t2.confidence >= TIER2_CONFIDENCE_THRESHOLD) {
      return t2;
    }
  }

  // ── Tier 3 ────────────────────────────────────────────────────────────────
  const emb = opts.embeddingClassifier;
  if (emb) {
    try {
      const t3 = await emb.classify(text);
      return t3;
    } catch {
      // fall through to best available
    }
  }

  // Return best guess from whichever tiers ran
  if (t2 !== null) {
    if (t1 && t1.confidence > t2.confidence) return t1;
    return t2;
  }
  return t1 ?? { stage: 'implementation', confidence: 0, tier: 1, allScores: {} };
}
