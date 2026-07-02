import browser from 'webextension-polyfill';
import type { ClassificationResult } from '../../core/classifier/types.js';

/**
 * Offscreen document — runs Transformers.js in a DOM-capable context.
 *
 * Chrome terminates offscreen documents when idle; the SW creates one on-demand
 * before sending embedding-classify requests.
 *
 * B2 ships a stub: classify() returns a neutral result without loading the model.
 * B5 wires in the real @xenova/transformers pipeline.
 */

type EmbeddingClassifyRequest = {
  type: 'nexpath:embedding-classify';
  text: string;
};

const NEUTRAL_RESULT: ClassificationResult = {
  stage: 'implementation',
  confidence: 0.0,
  tier: 3 as const,
};

browser.runtime.onMessage.addListener(
  (msg: unknown, _sender, sendResponse: (r: unknown) => void) => {
    const req = msg as Partial<EmbeddingClassifyRequest>;
    if (req.type !== 'nexpath:embedding-classify') return false;

    // Stub: return neutral so the rest of the pipeline can proceed.
    // Real Transformers.js pipeline is wired in B5.
    sendResponse({ result: NEUTRAL_RESULT as ClassificationResult });
    return false;
  },
);
