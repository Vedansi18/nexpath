/**
 * Detect when the coding agent's current operating mode clashes with what the current
 * development stage calls for. Two distinct, opposite situations, each its own signal:
 *
 *  - executing while planning: an autonomous execute mode while the work is still in a
 *    planning stage (the "barreling ahead" case), and
 *  - restricted while building: a read-only/plan mode during hands-on implementation, where
 *    the agent is blocked from acting.
 *
 * Both surface immediately on first detection (there is no accumulation to wash out a
 * misclassified stage), so they apply a stricter stage-confidence bar than signals that
 * accumulate. An unknown mode or an unmapped stage is left neutral, never guessed.
 */

import type { Confidence, RuntimeContext } from './mistake-categories.js';
import { recommendedModeBandForStage } from './task-mode-fit.js';
import { ACTIVE_AGENT_ID, resolveModeBand, type ModeBand } from '../env/agent-capabilities.js';

/**
 * Minimum stage confidence before a mode-mismatch may surface. Higher than the baseline
 * stage-confirmation floor because these patterns fire on first detection — they cannot rely
 * on repetition to average out a wrongly-classified stage, so they need a stricter bar.
 */
export const AGENT_MODE_MISMATCH_MIN_CONFIDENCE = 0.6;

/**
 * The (actual, recommended) band pair when the mode and stage are confidently comparable;
 * null when the mode is unknown, the stage is absent or has no recommended band, or the
 * stage classification is not confident enough.
 */
function resolveBands(ctx: RuntimeContext): { actual: ModeBand; recommended: ModeBand } | null {
  const { currentAgentMode, stage, stageConfidence } = ctx;
  if (currentAgentMode === undefined || stage === undefined) return null;
  if ((stageConfidence ?? 0) < AGENT_MODE_MISMATCH_MIN_CONFIDENCE) return null;
  const actual = resolveModeBand(ACTIVE_AGENT_ID, currentAgentMode);
  const recommended = recommendedModeBandForStage(stage);
  if (actual === undefined || recommended === undefined) return null;
  return { actual, recommended };
}

/** An autonomous execute mode while the stage calls for planning/read-only. */
export function detectExecuteDuringPlanning(ctx: RuntimeContext): Confidence {
  const b = resolveBands(ctx);
  return b && b.actual === 'execute' && b.recommended === 'plan' ? 1 : 0;
}

/** A read-only/plan mode while the stage calls for hands-on building. */
export function detectRestrictedDuringBuild(ctx: RuntimeContext): Confidence {
  const b = resolveBands(ctx);
  return b && b.actual === 'plan' && b.recommended === 'execute' ? 1 : 0;
}
