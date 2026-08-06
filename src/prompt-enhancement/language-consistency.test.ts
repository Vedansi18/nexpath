import { describe, expect, it } from 'vitest';
import {
  detectDominantScriptV1,
  isPromptEnhancementLanguageCoveredV1,
  isPromptEnhancementLanguageConsistentV1,
} from './language-consistency.js';
import type { PromptEnhancementStructuredComposerOutputV1 } from './compose-enhancement.js';

function output(
  detectedLanguageSelfReport: string | undefined,
  bodyText: string,
): PromptEnhancementStructuredComposerOutputV1 {
  return { outputId: 'o', sectionDrafts: [{ sectionId: 's', bodyText, sourceFactIds: ['f'] }], composerClaims: ['claim:f'], detectedLanguageSelfReport };
}

describe('E5 language-consistency (5.3)', () => {
  it('covers only the v1 languages EN/HI/GU (incl. romanized), not others', () => {
    for (const covered of ['en', 'hi', 'gu', 'hi-Latn', 'GU-LATN']) {
      expect(isPromptEnhancementLanguageCoveredV1(covered)).toBe(true);
    }
    for (const uncovered of ['sw', 'yo', 'es', 'pt', undefined]) {
      expect(isPromptEnhancementLanguageCoveredV1(uncovered)).toBe(false);
    }
  });

  it('detects the dominant script', () => {
    expect(detectDominantScriptV1('Fix the failing test')).toBe('latin');
    expect(detectDominantScriptV1('लॉगिन बग ठीक करो')).toBe('devanagari');
    expect(detectDominantScriptV1('લોગિન બગ ઠીક કરો')).toBe('gujarati');
    expect(detectDominantScriptV1('12345 ...')).toBe('none');
  });

  it('an English prompt with an English body is consistent', () => {
    expect(isPromptEnhancementLanguageConsistentV1('Fix the login bug.', output('en', 'Add a failing test first.'))).toBe(true);
  });

  it('Hinglish (Latin) stays consistent when reported hi-Latn', () => {
    expect(isPromptEnhancementLanguageConsistentV1('login bug fix karo', output('hi-Latn', 'Pehle ek failing test likho.'))).toBe(true);
  });

  it('an uncovered self-report is inconsistent (forces English fallback)', () => {
    expect(isPromptEnhancementLanguageConsistentV1('rekebisha hitilafu', output('sw', 'Andika jaribio.'))).toBe(false);
  });

  it('English drift is caught: a Devanagari original with a Latin body is inconsistent', () => {
    expect(isPromptEnhancementLanguageConsistentV1('लॉगिन बग ठीक करो', output('hi', 'Write a failing test first.'))).toBe(false);
  });

  it('a Devanagari original with a Devanagari body is consistent', () => {
    expect(isPromptEnhancementLanguageConsistentV1('लॉगिन बग ठीक करो', output('hi', 'पहले एक फेलिंग टेस्ट लिखो।'))).toBe(true);
  });
});
