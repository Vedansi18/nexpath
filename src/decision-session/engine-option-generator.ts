/**
 * Engine-backed pre-generate path (§6.1 items 2/3/4/5) — the content-template analogue
 * of `generateOptionList`. For a MIGRATED signalType it composes the maturity-column
 * headline via the §4.E0 engine (`composeAdvisory` — grounded why-desc + the sensitive-
 * action safeguard auto-sourced from the record, engine-side), then derives the strength
 * ladder (`deriveLadder` — L2/L3 one notch simpler each). Returns `GeneratedOptions` (one
 * option per strength tier — the §5.10.5 "author only L1, derive the rest" model) or null
 * (no record → the caller falls back to the static set).
 *
 * The `{R...}`→F7 after-pass (item 3) is a no-op for content-template cells (they carry no
 * runtime `{R...}` tokens — the grounding + safeguard are composed engine-side, items 6/9),
 * so the engine output is served directly. Only reached for a signalType in
 * `MIGRATED_SIGNALS` (the 6 §4.E2 signals + the Group-B classes migrated so far; empty = ship-dark).
 */

import type OpenAI from 'openai';
import type { GeneratedOptions } from './OptionGenerator.js';
import type { OptionEntry } from './options.js';
import type { MaturityLevel } from './content-template-schema.js';
import type { Store } from '../store/db.js';
import type { PromptRecord } from '../classifier/types.js';
import {
  composeAdvisory,
  deriveLadder,
  retrieveGroundingFacts,
  type RecordCandidateLookup,
  type GroundingFact,
} from './content-template-engine.js';
import { loadRightGoodProfile } from '../classifier/right-good-aggregator.js';
import { loadWorkStyleProfile } from '../classifier/work-style-traits.js';
import { probeProject } from '../env/env-probe.js';

export interface EngineGenerateInput {
  /** Source-cascade record lookup for the migrated signalType (dual-source). */
  lookup: RecordCandidateLookup;
  /** The user's maturity level (AR-5) to resolve the column for. */
  level: MaturityLevel;
  /** Target register (structurally-divergent override selection; else base). */
  register?: string;
  /** Grounding facts for the why-desc weave (AR-10 dev-env / AR-9 workflow / AR-3 work-style / prompt-derived). */
  facts?: readonly GroundingFact[];
  /** Grounding-line budget for the why-desc. */
  factCap?: number;
}

/**
 * Produce `GeneratedOptions` for a migrated signal from the content-template engine.
 * Returns null when no record resolves (caller falls back to the static generate path).
 */
export async function generateFromEngine(
  input: EngineGenerateInput,
  client?: OpenAI,
): Promise<GeneratedOptions | null> {
  const advisory = await composeAdvisory(
    { lookup: input.lookup, level: input.level, register: input.register, facts: input.facts, factCap: input.factCap },
    client,
  );
  if (!advisory) return null;

  // The composed headline is the L1 strength tier; derive L2/L3 one notch simpler each.
  const l1: OptionEntry[] = [{ option: advisory.option, descBase: advisory.whyDesc }];
  const ladder = await deriveLadder(l1, {}, client);

  return {
    l1: ladder.l1.map((e) => e.option),
    l2: ladder.l2.map((e) => e.option),
    l3: ladder.l3.map((e) => e.option),
    generatedDescBases: {
      l1: ladder.l1.map((e) => e.descBase),
      l2: ladder.l2.map((e) => e.descBase),
      l3: ladder.l3.map((e) => e.descBase),
    },
  };
}

/**
 * §6.1 item 4 — assemble grounding facts from the AR param SOURCES at fire time, via the
 * live store: AR-10 dev-env (`probeProject`), AR-9 workflow (`loadRightGoodProfile`),
 * AR-3 work-style (`loadWorkStyleProfile`), and the recent prompts (prompt-derived, LLM).
 * The engine maps + ranks/caps them; this is the store-load wiring.
 */
export async function buildEngineGrounding(
  store: Store,
  root: string,
  history: readonly PromptRecord[],
  client?: OpenAI,
): Promise<GroundingFact[]> {
  const env = probeProject(root).facts;
  const rightGood = loadRightGoodProfile(store, root);
  const workStyle = loadWorkStyleProfile(store, root);
  const prompts = history.slice(-5).map((p) => p.text);
  return retrieveGroundingFacts({ env, rightGood, workStyle, prompts }, client);
}
