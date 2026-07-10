import browser from 'webextension-polyfill';
import type { EmbeddingPort } from '../../core/ports/embedding.port.js';
import type { ClassificationResult } from '../../core/classifier/types.js';

type OffscreenReply = { result: ClassificationResult } | { error: string };

/**
 * EmbeddingPort that delegates to the offscreen document via runtime messaging
 * (webextension-polyfill — works on Chrome and Firefox from the same call).
 * The offscreen document runs Transformers.js (which requires a DOM-capable context).
 */
/**
 * Hard ceiling on the offscreen round-trip. A created-but-broken offscreen
 * document (partial build, script error, Chrome variant) can leave sendMessage
 * unsettled forever — which hangs the WHOLE submit pipeline right after
 * prompt_submit_received with no error anywhere (the exact "only the received
 * log shows" field symptom, 2026-07-10). classifyPrompt catches the timeout and
 * falls through to the keyword tier, so classification always completes.
 */
const OFFSCREEN_REPLY_TIMEOUT_MS = 8_000;

export class OffscreenEmbeddingAdapter implements EmbeddingPort {
  async classify(text: string): Promise<ClassificationResult> {
    const reply = await Promise.race([
      browser.runtime.sendMessage({ type: 'nexpath:embedding-classify', text }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Offscreen embedding timeout')), OFFSCREEN_REPLY_TIMEOUT_MS)),
    ]) as OffscreenReply | undefined;

    // No listener answered (dead/partial offscreen doc) — polyfill can resolve undefined.
    if (!reply || typeof reply !== 'object') {
      throw new Error('Offscreen embedding: no reply');
    }
    if ('error' in reply) {
      throw new Error(`Offscreen embedding error: ${reply.error}`);
    }
    return reply.result;
  }
}
