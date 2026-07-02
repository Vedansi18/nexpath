import browser from 'webextension-polyfill';
import type { EmbeddingPort } from '../../core/ports/embedding.port.js';
import type { ClassificationResult } from '../../core/classifier/types.js';

type OffscreenReply = { result: ClassificationResult } | { error: string };

/**
 * EmbeddingPort that delegates to the offscreen document via runtime messaging
 * (webextension-polyfill — works on Chrome and Firefox from the same call).
 * The offscreen document runs Transformers.js (which requires a DOM-capable context).
 */
export class OffscreenEmbeddingAdapter implements EmbeddingPort {
  async classify(text: string): Promise<ClassificationResult> {
    const reply = await browser.runtime.sendMessage({
      type: 'nexpath:embedding-classify',
      text,
    }) as OffscreenReply;

    if ('error' in reply) {
      throw new Error(`Offscreen embedding error: ${reply.error}`);
    }
    return reply.result;
  }
}
