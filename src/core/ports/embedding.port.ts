import type { ClassificationResult } from '../classifier/types.js';

/**
 * EmbeddingPort — abstracts Tier 3 semantic embedding classification.
 *
 * CLI implementation: XenovaEmbeddingAdapter (@xenova/transformers, Node).
 * Browser implementation: OffscreenEmbeddingAdapter (Transformers.js in offscreen document).
 */
export interface EmbeddingPort {
  classify(text: string): Promise<ClassificationResult>;
}
