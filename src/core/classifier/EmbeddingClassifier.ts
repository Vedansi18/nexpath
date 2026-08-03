import type { Stage, ClassificationResult } from './types.js';
import { STAGES } from './types.js';

/**
 * Tier 3 — MiniLM embedding similarity (optional).
 *
 * Uses all-MiniLM-L6-v2 via an injectable EmbeddingFn so that:
 *   - Tests inject a deterministic mock without network access.
 *   - CLI: EmbeddingFn is provided by XenovaEmbeddingAdapter (@xenova/transformers).
 *   - Browser: EmbeddingFn is provided by OffscreenEmbeddingAdapter (Transformers.js in offscreen doc).
 *   - If loading fails, the factory returns null → Tier 3 is silently skipped.
 *
 * createXenovaEmbedder (Node-specific) lives in src/cli/adapters/embedding.adapter.ts.
 */

export type EmbeddingFn = (texts: string[]) => Promise<number[][]>;

const STAGE_REPRESENTATIVES: Record<Stage, string> = {
  idea:           'exploring a new product concept or feature idea brainstorm',
  prd:            'writing product requirements spec document user stories acceptance criteria',
  architecture:   'system architecture design data model schema component dependencies',
  task_breakdown: 'break down tasks backlog tickets subtasks sprint checklist',
  implementation: 'implement build code function endpoint component handler refactor',
  review_testing: 'unit test regression coverage review audit verify edge case',
  release:        'deploy ship release production publish ci cd changelog',
  feedback_loop:  'bug report user feedback hotfix incident post-launch production issue',
};

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

export interface EmbeddingClassifier {
  classify(text: string): Promise<ClassificationResult>;
}

export async function createEmbeddingClassifier(
  embedFn: EmbeddingFn,
): Promise<EmbeddingClassifier | null> {
  try {
    const reps = STAGES.map((s) => STAGE_REPRESENTATIVES[s]);
    const centroids = await embedFn(reps);

    return {
      async classify(text: string): Promise<ClassificationResult> {
        const [queryVec] = await embedFn([text]);
        const allScores: Partial<Record<Stage, number>> = {};
        let topStage: Stage = STAGES[0];
        let topSim = -Infinity;

        for (let i = 0; i < STAGES.length; i++) {
          const sim = cosineSimilarity(queryVec, centroids[i]);
          allScores[STAGES[i]] = sim;
          if (sim > topSim) { topSim = sim; topStage = STAGES[i]; }
        }

        const sims = Object.values(allScores) as number[];
        const minSim = Math.min(...sims);
        const range = topSim - minSim;
        const confidence = range > 0 ? (topSim - minSim) / (range + 0.001) : 0.5;

        return {
          stage: topStage,
          confidence: Math.min(confidence, 1.0),
          tier: 3,
          allScores,
        };
      },
    };
  } catch {
    return null;
  }
}
