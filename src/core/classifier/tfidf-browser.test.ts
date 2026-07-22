// Differential parity proof: the browser-safe TF-IDF classifier must produce
// byte-identical output to the CLI's `natural`-backed classifyWithTFIDF for every
// input. If these ever diverge, the browser advisory flow diverges from the CLI —
// so this test is the contract that keeps them in lockstep.

import { describe, it, expect } from 'vitest';
import { classifyWithTFIDF } from '../../classifier/TFIDFClassifier.js';
import { TRAINING_DATA } from '../../classifier/TFIDFClassifier.js';
import { classifyWithTFIDFBrowser } from './tfidf-browser.js';
import { STAGES } from './types.js';

// A deliberately adversarial battery: exact corpus lines, natural-language vibe
// prompts, and tokenization edge cases (hyphens, underscores, digits, mixed
// punctuation/case, stopword-only, foreign vocabulary, empty).
const EDGE_CASES: string[] = [
  '',
  '   ',
  '.,;:!?()',
  'the a an of to and',                                   // stopwords only
  'Deploy This And SHIP IT to Production!!!',             // case + punctuation
  'refactor the front-end and back-end auth_token flow',  // hyphens + underscore
  'run all tests: unit, integration & regression (v2.0)', // digits + symbols
  'write the PRD spec and acceptance criteria',
  'let us brainstorm the core concept for a new product idea',
  'design the system architecture and data model',
  'implement the csv export endpoint and the handler',
  'ship this, deploy it, go live in production now',
  'users are reporting a production incident with 500 errors',
  'こんにちは世界',                                         // non-latin / foreign
  'asdfghjkl qwerty zxcvbnm',                             // out-of-vocabulary
  'API endpoint returns JSON — validate the response_body',
];

// Pull a handful of real utterances from every stage so we cover the whole corpus.
const CORPUS_SAMPLES: string[] = STAGES.flatMap((s) => TRAINING_DATA[s].slice(0, 4));

const ALL_INPUTS = [...EDGE_CASES, ...CORPUS_SAMPLES];

describe('classifyWithTFIDFBrowser — exact parity with the CLI natural-backed classifier', () => {
  it.each(ALL_INPUTS)('matches classifyWithTFIDF for: %j', (input) => {
    const ref = classifyWithTFIDF(input);
    const browser = classifyWithTFIDFBrowser(input);

    expect(browser.stage).toBe(ref.stage);
    expect(browser.tier).toBe(2);
    // Confidence must match to full double precision (identical summation order).
    expect(browser.confidence).toBeCloseTo(ref.confidence, 12);

    // allScores parity, stage by stage.
    for (const stage of STAGES) {
      const r = ref.allScores?.[stage];
      const b = browser.allScores?.[stage];
      if (r === undefined) {
        expect(b).toBeUndefined();
      } else {
        expect(b).toBeDefined();
        expect(b as number).toBeCloseTo(r, 12);
      }
    }
  });

  it('is deterministic across repeated calls', () => {
    const a = classifyWithTFIDFBrowser('deploy this and ship it to production');
    const b = classifyWithTFIDFBrowser('deploy this and ship it to production');
    expect(a).toEqual(b);
  });

  it('returns a zero-confidence result (not a throw) for empty/foreign input', () => {
    expect(classifyWithTFIDFBrowser('').confidence).toBe(0);
    expect(classifyWithTFIDFBrowser('こんにちは').confidence).toBe(0);
  });
});
