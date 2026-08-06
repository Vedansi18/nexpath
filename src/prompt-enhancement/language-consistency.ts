import type { PromptEnhancementStructuredComposerOutputV1 } from './compose-enhancement.js';

/**
 * E5 — language-consistency gate (phase 5.3).
 *
 * Prevents silent English drift and enforces the locked v1 coverage. A composed
 * output is language-consistent only when:
 *  1. the composer's self-reported language is a COVERED v1 language (EN / HI / GU,
 *     incl. romanized Hinglish/Gujlish) — the only languages whose destructive-action
 *     safety patterns exist; an uncovered language must fall back to English, and
 *  2. it did not drift to English — if the original prompt is in an Indic script
 *     (Devanagari/Gujarati) but the generated body is Latin-script, that is drift.
 *
 * Deterministic — no LLM. The composer retries an inconsistent output within its
 * budget, then falls back to the deterministic English body.
 */
const COVERED_V1_LANGUAGES: ReadonlySet<string> = new Set(['en', 'hi', 'hi-latn', 'gu', 'gu-latn']);

export function isPromptEnhancementLanguageCoveredV1(selfReport: string | undefined): boolean {
  return selfReport !== undefined && COVERED_V1_LANGUAGES.has(selfReport.trim().toLowerCase());
}

export type PromptEnhancementDominantScript = 'latin' | 'devanagari' | 'gujarati' | 'other' | 'none';

export function detectDominantScriptV1(text: string): PromptEnhancementDominantScript {
  let latin = 0;
  let devanagari = 0;
  let gujarati = 0;
  let otherLetters = 0;
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0;
    if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) latin += 1;
    else if (cp >= 0x0900 && cp <= 0x097f) devanagari += 1;
    else if (cp >= 0x0a80 && cp <= 0x0aff) gujarati += 1;
    else if (/\p{L}/u.test(char)) otherLetters += 1;
  }
  const max = Math.max(latin, devanagari, gujarati, otherLetters);
  if (max === 0) return 'none';
  if (max === devanagari) return 'devanagari';
  if (max === gujarati) return 'gujarati';
  if (max === latin) return 'latin';
  return 'other';
}

export function isPromptEnhancementLanguageConsistentV1(
  originalPromptText: string,
  output: PromptEnhancementStructuredComposerOutputV1,
): boolean {
  if (!isPromptEnhancementLanguageCoveredV1(output.detectedLanguageSelfReport)) return false;

  const originalScript = detectDominantScriptV1(originalPromptText);
  const generatedScript = detectDominantScriptV1(output.sectionDrafts.map((draft) => draft.bodyText).join(' '));
  // English drift: an Indic-script original whose generated body turned Latin.
  if ((originalScript === 'devanagari' || originalScript === 'gujarati') && generatedScript === 'latin') {
    return false;
  }
  return true;
}
