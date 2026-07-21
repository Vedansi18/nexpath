/**
 * Which operating band a development stage calls for — a coarse mapping, not a strict
 * rule. Early, exploratory stages (idea, spec, architecture, task breakdown) suit a
 * planning/read-only band; known-scope build and review stages suit autonomous execution.
 *
 * Stages with no clear recommendation (e.g. release, feedback) return `undefined`, so no
 * comparison asserts a preferred band for them. The band boundaries are deliberately
 * coarse and may be tuned.
 */

import type { Stage } from './types.js';
import type { ModeBand } from '../env/agent-capabilities.js';

const STAGE_RECOMMENDED_BAND: Partial<Record<Stage, ModeBand>> = {
  idea:           'plan',
  prd:            'plan',
  architecture:   'plan',
  task_breakdown: 'plan',
  implementation: 'execute',
  review_testing: 'execute',
  // release / feedback_loop: no coarse-band recommendation — left neutral.
};

/** The operating band recommended for a stage, or `undefined` when there is no clear fit. */
export function recommendedModeBandForStage(stage: Stage): ModeBand | undefined {
  return STAGE_RECOMMENDED_BAND[stage];
}
