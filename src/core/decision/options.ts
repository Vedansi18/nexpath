// Re-export bridge — keeps src/decision-session/options.ts in place (10k+ lines, zero regression risk).
// Core and browser callers import types + resolver from here; the static content stays in its original file.
export type { OptionEntry, DecisionContent } from '../../decision-session/options.js';
export { resolveDecisionContent, SHOW_SIMPLER, SKIP_NOW } from '../../decision-session/options.js';
