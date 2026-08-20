import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, type Store } from '../store/db.js';
import { upsertProject, setProjectEnvFacts } from '../store/index.js';
import {
  getPromptDerivedFacts,
  promptDerivedFactsRefreshDue,
  PROMPT_FACTS_REFRESH_EVERY_N_PROMPTS,
} from '../store/env-facts.js';
import {
  refreshPromptDerivedFactsIfDueV1,
  cachedPromptDerivedFactsV1,
  PROMPT_FACTS_WINDOW,
} from './prompt-derived-facts-refresh.js';
import { SessionStateManager } from '../classifier/SessionStateManager.js';
import { buildPromptEnhancementRequestForAuto } from '../cli/commands/auto.js';
import { probeProject } from '../env/env-probe.js';
import { promptEnhancementFactValueLinesV1 } from './fact-value-render.js';
import { buildPromptEnhancementGuidanceFactsV1 } from './guidance-facts.js';

/** The section kinds a real body asks for; `''` is never one of them. */
const PRODUCTION_KINDS = ['context_and_constraints','approach_or_steps','acceptance_or_output_expectation',
  'verification_or_test_plan','project_grounding_facts','source_signal_guidance','reproduction_or_evidence',
  'risk_safety_or_confirmation','uncertainty_or_clarification','requirement_source_state',
  'behavior_preservation','finding_format'] as const;

/**
 * A3 step 7 under the owner-approved adjustment.
 *
 * The step required the engine's extracted param VALUES to cross into PE; §33.2 had measured the
 * id-only hop as broken. The blocker was never the crossing — it was that the only extractor is an
 * LLM call living inside the decision-session engine, which is disabled outright, while PE runs on
 * EVERY prompt. Wiring it straight through would have made a per-prompt provider call.
 *
 * 🔒 Ruling: reuse the extractor unchanged (step 8), mine over a window, CACHE the result, and
 * refresh only after a threshold of new prompts. These fixtures pin the three things that ruling
 * rests on: the threshold is respected, the read is free, and the values actually cross typed.
 *
 * ⛔ No fixture here reaches a provider — the miner is injected.
 */

async function projectWithPrompts(promptCount: number): Promise<{ store: Store; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'pdf-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', devDependencies: { vitest: '1.0.0' } }));
  const store = await openStore(':memory:');
  upsertProject(store, { projectRoot: dir, name: 'x', projectType: 'app', language: 'ts', description: '', createdAt: Date.now() });
  setProjectEnvFacts(store, dir, probeProject(dir, Date.now()).facts, Date.now());
  return { store, dir };
}

const MINED = [
  { key: 'deploy_target', value: 'vercel' },
  { key: 'package_manager', value: 'pnpm' },
];

describe('A3 step 7 — the cost dial: mine on a threshold, never per prompt', () => {
  it('mines on the first ask, because nothing is cached yet', async () => {
    const { store, dir } = await projectWithPrompts(1);
    let calls = 0;
    const out = await refreshPromptDerivedFactsIfDueV1({
      store, projectRoot: dir, currentPromptCount: 1,
      recentPrompts: ['add stripe checkout', 'deploy to vercel'],
      extract: async () => { calls += 1; return MINED; },
    });
    expect(out.reason).toBe('stored');
    expect(calls, 'the first mine did not happen').toBe(1);
    expect(cachedPromptDerivedFactsV1(store, dir)).toHaveLength(2);
  });

  it('does NOT mine again before the threshold — this is the whole cost argument', async () => {
    const { store, dir } = await projectWithPrompts(1);
    await refreshPromptDerivedFactsIfDueV1({
      store, projectRoot: dir, currentPromptCount: 10,
      recentPrompts: ['a'], extract: async () => MINED,
    });

    let calls = 0;
    // Every prompt from 11 up to just under the threshold must be free.
    for (let n = 11; n < 10 + PROMPT_FACTS_REFRESH_EVERY_N_PROMPTS; n += 1) {
      const out = await refreshPromptDerivedFactsIfDueV1({
        store, projectRoot: dir, currentPromptCount: n,
        recentPrompts: ['a'], extract: async () => { calls += 1; return MINED; },
      });
      expect(out.reason).toBe('not_due');
    }
    expect(
      calls,
      'a provider call happened before the threshold — the per-prompt cost this design exists to avoid',
    ).toBe(0);
  });

  it('mines again exactly when the threshold is crossed', async () => {
    const { store, dir } = await projectWithPrompts(1);
    await refreshPromptDerivedFactsIfDueV1({
      store, projectRoot: dir, currentPromptCount: 10,
      recentPrompts: ['a'], extract: async () => MINED,
    });
    expect(promptDerivedFactsRefreshDue(store, dir, 10 + PROMPT_FACTS_REFRESH_EVERY_N_PROMPTS - 1)).toBe(false);
    expect(promptDerivedFactsRefreshDue(store, dir, 10 + PROMPT_FACTS_REFRESH_EVERY_N_PROMPTS)).toBe(true);
  });

  it('an empty extraction still stamps the attempt, or every later prompt would re-mine', async () => {
    const { store, dir } = await projectWithPrompts(1);
    const out = await refreshPromptDerivedFactsIfDueV1({
      store, projectRoot: dir, currentPromptCount: 5,
      recentPrompts: ['a'], extract: async () => [],
    });
    expect(out.reason).toBe('extractor_empty');
    // The stamp is the point: without it the threshold stays crossed for ever.
    expect(promptDerivedFactsRefreshDue(store, dir, 6)).toBe(false);
  });

  it('a failing miner is swallowed — it must never break prompt capture', async () => {
    const { store, dir } = await projectWithPrompts(1);
    const out = await refreshPromptDerivedFactsIfDueV1({
      store, projectRoot: dir, currentPromptCount: 5,
      recentPrompts: ['a'],
      extract: async () => { throw new Error('provider down'); },
    });
    expect(out.reason).toBe('failed');
    expect(out.refreshed).toBe(false);
  });

  it('reads only the recent window the engine used', async () => {
    const { store, dir } = await projectWithPrompts(1);
    let seen: readonly string[] = [];
    await refreshPromptDerivedFactsIfDueV1({
      store, projectRoot: dir, currentPromptCount: 1,
      recentPrompts: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'],
      extract: async (prompts) => { seen = prompts; return MINED; },
    });
    expect(seen).toHaveLength(PROMPT_FACTS_WINDOW);
    expect(seen[seen.length - 1], 'the window must be the NEWEST prompts').toBe('p7');
  });
});

describe('A3 step 7 — the values CROSS the boundary typed (the id-only hop, closed)', () => {
  it('cached prompt-derived values reach the request as typed key/value evidence', async () => {
    const { store, dir } = await projectWithPrompts(1);
    await refreshPromptDerivedFactsIfDueV1({
      store, projectRoot: dir, currentPromptCount: 1,
      recentPrompts: ['deploy to vercel'], extract: async () => MINED,
    });

    const session = SessionStateManager.load(store, dir);
    const request = buildPromptEnhancementRequestForAuto({
      auto: { promptText: 'add the billing page', projectRoot: dir, currentAgentMode: 'default' },
      store, session, project: null, effectiveLanguage: 'en', configuredRole: null,
      effectiveFlagType: 'stage_transition', firedKey: 'k', previousStage: 'idea',
      trigger: { kind: 'stage_transition' },
      stageResult: {
        classification: { stage: 'implementation', confidence: 0.9, tier: 3, allScores: {} },
        signalsPresent: [], signalsAbsent: [], fireRecommendation: true,
        selectedSignalKey: '', reason: 't', degraded: false,
      },
      streamBOutputs: [],
    });

    const refs = request.sourceSignals;
    const ref = 'prompt_fact:deploy_target';
    expect(
      refs.rightGoodWorkStyleEnvRuntimeRefs,
      'the mined value never reached the boundary — the id-only hop is back',
    ).toContain(ref);

    const evidence = refs.groundingEvidenceByRef?.[ref];
    expect(evidence?.key).toBe('deploy_target');
    expect(evidence?.value, 'crossed as an id with no value — exactly what step 7 forbids').toBe('vercel');

    // L4990: prompt-mined evidence is uncorroborated by construction and must never claim practice.
    expect(refs.groundingTierByRef?.[ref]).toBe('uncorroborated');
  });

  it('and the mined value REACHES A BODY, not just the fact set', async () => {
    // HV-3 measured the gap this closes: the ref crossed, the fact was built carrying its value,
    // the claim policy was already `must_phrase_as_possibility` exactly as step 7 asks — and the
    // value still never reached a body, because `prompt_fact:` refs had no branch of their own and
    // inherited the work-style branch's `metadata_only`. Inherited suppression, not a decision.
    const { store, dir } = await projectWithPrompts(1);
    await refreshPromptDerivedFactsIfDueV1({
      store, projectRoot: dir, currentPromptCount: 1,
      recentPrompts: ['deploy to vercel'], extract: async () => MINED,
    });
    const session = SessionStateManager.load(store, dir);
    const request = buildPromptEnhancementRequestForAuto({
      auto: { promptText: 'add the billing page', projectRoot: dir, currentAgentMode: 'default' },
      store, session, project: null, effectiveLanguage: 'en', configuredRole: null,
      effectiveFlagType: 'stage_transition', firedKey: 'k', previousStage: 'idea',
      trigger: { kind: 'stage_transition' },
      stageResult: {
        classification: { stage: 'implementation', confidence: 0.9, tier: 3, allScores: {} },
        signalsPresent: [], signalsAbsent: [], fireRecommendation: true,
        selectedSignalKey: '', reason: 't', degraded: false,
      },
      streamBOutputs: [],
    });
    const facts = buildPromptEnhancementGuidanceFactsV1(request);
    const mined = facts.filter((f) => f.sourceIds.some((i) => i.startsWith('prompt_fact:')));
    expect(mined.length, 'no fact was built from the mined ref').toBeGreaterThan(0);
    expect(mined[0]!.renderPolicy, 'suppressed again — the work-style treatment came back').not.toBe('metadata_only');
    expect(mined[0]!.claimVerbPolicy, 'prompt-mined material must stay at possibility strength')
      .toBe('must_phrase_as_possibility');

    const body = PRODUCTION_KINDS.flatMap((k) => promptEnhancementFactValueLinesV1(k, facts)).join(' | ');
    expect(body, 'the mined value stops short of the body again').toContain('vercel');
  });

  it('and nothing crosses when the cache is empty — the read is free and silent', async () => {
    const { store, dir } = await projectWithPrompts(1);
    expect(getPromptDerivedFacts(store, dir)).toBeNull();
    expect(cachedPromptDerivedFactsV1(store, dir)).toEqual([]);
  });
});
