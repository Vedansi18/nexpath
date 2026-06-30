import type { EmbeddingPort } from '../../core/ports/embedding.port.js';
import type { ClassificationResult } from '../../core/classifier/types.js';

type OffscreenReply = { result: ClassificationResult } | { error: string };

/**
 * EmbeddingPort that delegates to the offscreen document via chrome.runtime messaging.
 * The offscreen document runs Transformers.js (which requires a DOM-capable context).
 */
export class OffscreenEmbeddingAdapter implements EmbeddingPort {
  async classify(text: string): Promise<ClassificationResult> {
    const reply = await chrome.runtime.sendMessage<unknown, OffscreenReply>({
      type: 'nexpath:embedding-classify',
      text,
    });

    if ('error' in reply) {
      throw new Error(`Offscreen embedding error: ${reply.error}`);
    }
    return reply.result;
  }
}
