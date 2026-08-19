import type { Store } from '../store/db.js';
import {
  getPromptDerivedFacts,
  promptDerivedFactsRefreshDue,
  setPromptDerivedFacts,
  PROMPT_FACTS_REFRESH_EVERY_N_PROMPTS,
  type PromptDerivedFact,
} from '../store/env-facts.js';
import { extractParamsFromPrompts } from '../decision-session/content-template-grounding.js';
import { logger } from '../logger.js';

/**
 * A3 step 7, under the owner-approved adjustment.
 *
 * **The problem the adjustment solves.** Step 7 requires the engine's own `ExtractedParam` output
 * to cross into PE, and step 8 forbids building a second extractor. But that extractor is an LLM
 * call which lived inside the decision-session engine: it ran occasionally, over a 5-prompt window
 * (`engine-option-generator.ts:135`), and that engine is now disabled outright (`stop.ts`, MPS-7)
 * and slated for removal. PE runs on EVERY prompt. Wiring the extractor straight into the boundary
 * would therefore have converted an occasional call into a per-prompt one — for every user.
 *
 * 🔒 **Owner ruling:** mine over a window and CACHE the result, refreshing only after a threshold
 * of new prompts. The existing extractor is reused unchanged, honouring step 8.
 *
 * ⛔ **Cost, stated plainly:** at most ONE LLM call per project per
 * {@link PROMPT_FACTS_REFRESH_EVERY_N_PROMPTS} prompts. At the owner-set 25 that is four calls per
 * hundred prompts, against a hundred for the naive wiring. Every other prompt reads the cache and
 * makes no call at all.
 */

/** How many recent prompts the miner reads — the window the DS engine used (`history.slice(-5)`). */
export const PROMPT_FACTS_WINDOW = 5;

export interface PromptFactsRefreshOutcome {
  readonly refreshed: boolean;
  readonly reason: 'not_due' | 'no_prompts' | 'extractor_empty' | 'stored' | 'store_rejected' | 'failed';
  readonly factCount: number;
}

/**
 * Refresh the cached prompt-derived facts IF the threshold has been crossed.
 *
 * ⚠️ Best-effort by construction, like every other side task on the auto path: a failure is logged
 * and swallowed. A miner that can break prompt capture would be worse than one that occasionally
 * has nothing to say.
 */
export async function refreshPromptDerivedFactsIfDueV1(input: {
  store: Store;
  projectRoot: string;
  currentPromptCount: number;
  /** Most recent prompt texts, newest last. Only the last {@link PROMPT_FACTS_WINDOW} are read. */
  recentPrompts: readonly string[];
  /** Injected in tests so no provider call happens; production passes nothing. */
  extract?: (prompts: readonly string[]) => Promise<readonly PromptDerivedFact[]>;
}): Promise<PromptFactsRefreshOutcome> {
  const { store, projectRoot, currentPromptCount, recentPrompts } = input;

  if (!promptDerivedFactsRefreshDue(store, projectRoot, currentPromptCount)) {
    return { refreshed: false, reason: 'not_due', factCount: 0 };
  }

  const window = recentPrompts.slice(-PROMPT_FACTS_WINDOW).filter((p) => p.trim() !== '');
  if (window.length === 0) {
    return { refreshed: false, reason: 'no_prompts', factCount: 0 };
  }

  try {
    const extract = input.extract ?? ((prompts) => extractParamsFromPrompts(prompts));
    const mined = await extract(window);
    if (mined.length === 0) {
      // Stamp the attempt anyway: without this an empty extraction would leave the threshold
      // permanently crossed, and every subsequent prompt would re-mine — the per-prompt cost the
      // whole adjustment exists to avoid.
      setPromptDerivedFacts(store, projectRoot, [], Date.now(), currentPromptCount);
      return { refreshed: false, reason: 'extractor_empty', factCount: 0 };
    }
    const stored = setPromptDerivedFacts(store, projectRoot, mined, Date.now(), currentPromptCount);
    return {
      refreshed: stored,
      reason: stored ? 'stored' : 'store_rejected',
      factCount: mined.length,
    };
  } catch (err) {
    logger.debug('prompt_derived_facts_refresh_error', { error: String(err) });
    return { refreshed: false, reason: 'failed', factCount: 0 };
  }
}

/** Read the cache for the boundary. Empty when never mined — never triggers a call. */
export function cachedPromptDerivedFactsV1(store: Store, projectRoot: string): readonly PromptDerivedFact[] {
  return getPromptDerivedFacts(store, projectRoot)?.facts ?? [];
}
