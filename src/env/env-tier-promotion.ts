/**
 * Tier-P promotion. A dev-environment CAPABILITY fact (the project HAS the thing — tier 'C')
 * is promoted to a PRACTICE fact (tier 'P' — the user reliably DOES it) only when a matching
 * behavioural signal corroborates it: e.g. `has_test_runner` becomes practice-grade when the
 * user's `test_creation` signal reads RIGHT&GOOD. Without corroboration a fact stays tier 'C'
 * (grounds capability-aware wording only, never a discipline/practice claim).
 *
 * Corroboration source here is the behavioural-signal presence in the RIGHT&GOOD profile (Layer-K
 * events). The strongest corroborator — the transcript (Channel X) — is not shipped yet; it would
 * extend this map's evidence, not replace it.
 */

import type { FactMap } from './types.js';
import { getRightGoodState, type RightGoodProfile } from '../classifier/right-good-aggregator.js';

/** Env capability fact → the behavioural signal whose RIGHT&GOOD state corroborates the practice. */
export const ENV_FACT_CORROBORATOR: Readonly<Record<string, string>> = {
  has_test_runner:      'test_creation',
  has_security_scanner: 'security_check',
  has_ci_pipeline:      'ci_pipeline',
};

/**
 * Promote each corroborated capability fact to tier 'P'. A fact qualifies only when it is present
 * (`value === true`), has a known corroborator, and that corroborator reads `right_good`.
 * Every other fact is returned unchanged (tier 'C'). Pure — no probe, no store.
 */
export function promoteEnvFactsToTierP(facts: FactMap, rightGood: RightGoodProfile): FactMap {
  const out: FactMap = {};
  for (const [key, f] of Object.entries(facts)) {
    const corroborator = ENV_FACT_CORROBORATOR[key];
    const promote =
      f.value === true &&
      corroborator !== undefined &&
      getRightGoodState(rightGood, corroborator) === 'right_good';
    out[key] = promote ? { ...f, tier: 'P' } : f;
  }
  return out;
}
