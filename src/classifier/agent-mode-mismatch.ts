/**
 * Detect that the coding agent's current operating mode clashes with what the current
 * development stage calls for — e.g. an autonomous execute mode while the work is still in
 * a planning stage, or a read-only plan mode during hands-on implementation.
 *
 * This pattern surfaces immediately on first detection (there is no accumulation to wash
 * out a misclassified stage), so it applies a stricter stage-confidence bar than signals
 * that accumulate, and it only fires on a genuine clash — opposite ends of the
 * plan↔execute axis. An unknown mode or an unmapped stage is left neutral, never guessed.
 */

import type { Confidence, RuntimeContext } from './mistake-categories.js';
import { recommendedModeBandForStage } from './task-mode-fit.js';
import { ACTIVE_AGENT_ID, resolveModeBand, type ModeBand } from '../env/agent-capabilities.js';

/**
 * Minimum stage confidence before a mode-mismatch may surface. Higher than the baseline
 * stage-confirmation floor because this pattern fires on first detection — it cannot rely
 * on repetition to average out a wrongly-classified stage, so it needs a stricter bar.
 */
export const AGENT_MODE_MISMATCH_MIN_CONFIDENCE = 0.6;

/** True when two bands sit at opposite ends of the plan↔execute axis (a genuine clash). */
function bandsClash(a: ModeBand, b: ModeBand): boolean {
  return (a === 'plan' && b === 'execute') || (a === 'execute' && b === 'plan');
}

/**
 * Returns 1 only when ALL hold: the current mode is known and resolves to a band, the
 * stage recommends a band, the stage classification is confident enough, and the two
 * bands clash on the plan↔execute axis. Otherwise 0.
 */
export function detectAgentModeMismatch(ctx: RuntimeContext): Confidence {
  const { currentAgentMode, stage, stageConfidence } = ctx;
  if (currentAgentMode === undefined || stage === undefined) return 0;
  if ((stageConfidence ?? 0) < AGENT_MODE_MISMATCH_MIN_CONFIDENCE) return 0;
  const actual = resolveModeBand(ACTIVE_AGENT_ID, currentAgentMode);
  const recommended = recommendedModeBandForStage(stage);
  if (actual === undefined || recommended === undefined) return 0;
  return bandsClash(actual, recommended) ? 1 : 0;
}
