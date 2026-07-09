// Decision-session option-list types + builder.
//
// After the B11 cutover, the content-template engine + the per-signal records are the whole
// content layer — the static `DecisionContent` cascade (maps + resolveDecisionContent + selectors)
// was retired. What remains here is the option-list SHAPE the render path consumes: the
// `DecisionContent` / `OptionEntry` types (built at fire time from the engine's generated options)
// and `buildOptionList` / `getLevelSubtitle` / the SHOW_SIMPLER / SKIP_NOW option constants.

import type { WhyHelpEntry } from './why-help.js';

/** One selectable option + its desc-base (the CA-bound explanation). */
export interface OptionEntry {
  option:   string;
  descBase: string;
}

/**
 * The per-fire option content the render path consumes. Built at fire time from the engine's
 * generated options (or a deterministic composition); no longer a static per-signal constant.
 */
export interface DecisionContent {
  /** Per-signal signalType key (register variants share the same base signalType). */
  signalType:    string;
  question:      string;
  pinchFallback: string;
  L1: OptionEntry[];
  L2: OptionEntry[];
  L3: OptionEntry[];
  /**
   * Optional popup why-help entry — discriminated-union shape supporting the register-structure
   * groups per signal class. Resolved per (signal class × register × role) by `composeWhyHelpBlock`.
   */
  whyHelp?:      WhyHelpEntry;
  /** Per-set opt-out for the desc-base rendering pipeline (defaults to true when omitted). */
  descBaseEnabled?: boolean;
  /** Marks a set in scope for the L2 sensitive-action safeguard (defaults to false when omitted). */
  l2SafeguardRequired?: boolean;
  /** Per-set total-length budget bounding the rendered desc-base (defaults to MEDIUM when omitted). */
  lengthBudget?: 'LIGHT' | 'MEDIUM' | 'HEAVY';
}

// ── Option list building ───────────────────────────────────────────────────────

export const SHOW_SIMPLER  = 'Show simpler options →' as const;
export const SKIP_NOW      = 'Skip for now — nexpath optimize will remind me later' as const;

export type SpecialOption  = typeof SHOW_SIMPLER | typeof SKIP_NOW;
export type DecisionOption = string | SpecialOption;

export interface BuiltOptionList {
  /** The selectable options for this level, including "Show simpler options →" and "Skip for now". */
  options: DecisionOption[];
  /** Whether "Show simpler options →" is included (levels 1 and 2 only). */
  hasNextLevel: boolean;
}

/**
 * Build the full option list for a given level:
 *   - the content options for this level
 *   - "Show simpler options →"  (levels 1 and 2 only)
 *   - "Skip for now — nexpath optimize will remind me later"  (always last)
 */
export function buildOptionList(
  content: DecisionContent,
  level:   1 | 2 | 3,
): BuiltOptionList {
  const contentOptions: OptionEntry[] =
    level === 1 ? content.L1 :
    level === 2 ? content.L2 :
                  content.L3;

  const hasNextLevel = level < 3;
  const options: DecisionOption[] = contentOptions.map((e) => e.option);

  if (hasNextLevel) options.push(SHOW_SIMPLER);
  options.push(SKIP_NOW);

  return { options, hasNextLevel };
}

// ── Level subtitle ─────────────────────────────────────────────────────────────

/** Returns the level subtitle shown below the pinch label (research spec). */
export function getLevelSubtitle(level: 1 | 2 | 3): string | null {
  if (level === 1) return null;
  if (level === 2) return '— lighter options';
  return '— minimum viable step';
}
