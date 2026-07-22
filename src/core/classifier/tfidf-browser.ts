// Browser-safe Tier-2 TF-IDF classifier — behaviourally identical to the CLI's
// `classifyWithTFIDF` (src/classifier/TFIDFClassifier.ts), but with ZERO Node
// dependencies so it runs in the extension service worker.
//
// The CLI classifier leans on `natural` (node:module/createRequire + fs). We
// cannot bundle that into a browser. Instead the per-stage TF-IDF weights are
// precomputed FROM `natural` (tfidf-model.generated.ts) and this module only
// reproduces the two pure-JS steps the CLI does around it:
//
//   1. Query tokenization — the exact `text.toLowerCase().split(/[\s,.'";:!?()]+/)`
//      split classifyWithTFIDF uses, then `natural`'s WordTokenizer re-split of
//      each token (`/[^A-Za-zА-Яа-я0-9_]+/`, empties discarded) which happens
//      inside natural's `tfidf()`.
//   2. Per-token, per-stage summation of tf*idf, then argmax + confidence,
//      mirroring classifyWithTFIDF line-for-line (including summation ORDER, so
//      floating-point results match bit-for-bit).
//
// tfidf-browser.test.ts proves the parity differentially against the real
// `natural`-backed classifier over a large prompt battery.

import type { ClassificationResult, Stage } from './types.js';
import { STAGES } from './types.js';
import { TFIDF_WEIGHTS } from './tfidf-model.generated.js';

/** classifyWithTFIDF's query pre-split (punctuation set is intentionally identical). */
const QUERY_SPLIT = /[\s,.'";:!?()]+/;
/** natural WordTokenizer gap pattern (regexp_tokenizer.js WordTokenizer._pattern). */
const WORD_SPLIT = /[^A-Za-zА-Яа-я0-9_]+/;

/**
 * natural's WordTokenizer.tokenize: split on the gap pattern, discard '' and ' '
 * (discardEmpty is always true — `options.discardEmpty || true`). Input is already
 * lower-cased by the caller, matching natural's `terms.toString().toLowerCase()`.
 */
function wordTokenize(token: string): string[] {
  return token.split(WORD_SPLIT).filter((t) => t !== '' && t !== ' ');
}

/**
 * Tier 2 — TF-IDF classification, browser edition. Same contract and same output
 * as classifyWithTFIDF: always returns a result (low confidence for foreign
 * vocabulary), tier === 2.
 */
export function classifyWithTFIDFBrowser(text: string): ClassificationResult {
  const tokens = text.toLowerCase().split(QUERY_SPLIT).filter(Boolean);
  const sums = new Array<number>(STAGES.length).fill(0);

  // Mirror classifyWithTFIDF exactly: for each query token, natural computes
  // tfidf(token, i) = Σ_subtoken tf(subtoken, doc_i) * idf(subtoken) and adds that
  // single measure to sums[i]. We accumulate the subtoken weights into a per-token
  // measure first (same reduce order) before adding to sums[i], so the float math
  // is identical to the reference.
  for (const token of tokens) {
    const subTokens = wordTokenize(token);
    for (let i = 0; i < STAGES.length; i++) {
      const stageWeights = TFIDF_WEIGHTS[STAGES[i]];
      let measure = 0;
      for (const sub of subTokens) {
        const w = stageWeights[sub];
        if (w !== undefined) measure += w; // absent term ⇒ tf=0 ⇒ contributes 0
      }
      sums[i] += measure;
    }
  }

  const total = sums.reduce((a, b) => a + b, 0);

  let topIdx = 0;
  for (let i = 1; i < sums.length; i++) {
    if (sums[i] > sums[topIdx]) topIdx = i; // strict > ⇒ first max wins (parity)
  }

  const confidence = total > 0 ? sums[topIdx] / total : 0;

  const allScores: Partial<Record<Stage, number>> = {};
  for (let i = 0; i < STAGES.length; i++) {
    if (total > 0) allScores[STAGES[i]] = sums[i] / total;
  }

  return {
    stage: STAGES[topIdx],
    confidence,
    tier: 2,
    allScores,
  };
}
