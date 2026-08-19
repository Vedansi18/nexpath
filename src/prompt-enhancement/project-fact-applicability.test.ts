import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../store/db.js';
import { upsertProject, setProjectEnvFacts } from '../store/index.js';
import { probeProject } from '../env/env-probe.js';
import { SessionStateManager } from '../classifier/SessionStateManager.js';
import { buildPromptEnhancementRequestForAuto } from '../cli/commands/auto.js';
import { buildPromptEnhancementGuidanceFactsV1 } from './guidance-facts.js';
import { promptEnhancementFactValueLinesV1 } from './fact-value-render.js';
import {
  PROJECT_FACT_CATEGORIES_V1,
  projectFactCategoryForRefV1,
  projectFactRefIsApplicableV1,
} from './project-fact-applicability.js';
import type { PromptEnhancementGuidanceFact } from './templates/section-plan.js';

/**
 * The applicability gate (Hiren's ruling from the sim logs): project grounding reaches a prompt
 * only when THIS prompt calls for it.
 *
 * ⚠️ What these fixtures are really guarding is a NEGATIVE, and a negative is the easy thing to
 * fake: a test that asserts "no grounding" passes just as well when the whole chain is broken. So
 * every case here is paired — the same store, the same facts, the same builder, differing ONLY in
 * the observation — and both halves are asserted. A gate that suppressed everything would fail the
 * positive half; a gate that suppressed nothing would fail the negative half.
 */

function projectWithFacts(): { dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'applic-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', devDependencies: { vitest: '1.0.0' } }));
  return { dir };
}

async function factsFor(
  promptText: string,
  observed: readonly string[] | undefined,
): Promise<{ facts: readonly PromptEnhancementGuidanceFact[]; groundingLines: readonly string[] }> {
  const { dir } = projectWithFacts();
  const store = await openStore(':memory:');
  upsertProject(store, { projectRoot: dir, name: 'x', projectType: 'app', language: 'ts', description: '', createdAt: Date.now() });
  setProjectEnvFacts(store, dir, probeProject(dir, Date.now()).facts, Date.now());

  const request = buildPromptEnhancementRequestForAuto({
    auto: { promptText, projectRoot: dir, currentAgentMode: 'default' },
    store,
    session: SessionStateManager.load(store, dir),
    project: null,
    effectiveLanguage: 'en',
    configuredRole: null,
    effectiveFlagType: 'stage_transition',
    firedKey: 'stage_transition:idea→implementation',
    previousStage: 'idea',
    trigger: { kind: 'stage_transition' },
    stageResult: {
      classification: { stage: 'implementation', confidence: 0.9, tier: 3, allScores: {} },
      signalsPresent: [], signalsAbsent: [], fireRecommendation: true, selectedSignalKey: '',
      reason: 'applicability', degraded: false,
      ...(observed === undefined ? {} : { projectFactCandidates: observed }),
    },
    streamBOutputs: [],
  } as never);

  const facts = buildPromptEnhancementGuidanceFactsV1(request);
  return { facts, groundingLines: promptEnhancementFactValueLinesV1('project_grounding_facts', facts) };
}

/**
 * The project facts that actually reach the user as grounding.
 *
 * ⚠️ `metadata_only` is excluded deliberately, and finding that out is why this helper exists: a
 * fresh project has most capabilities FALSE, and a FALSE capability is safety material — it ships
 * `metadata_only` + a safety hook and is exempt from this gate by prohibition 17. Counting those
 * as "grounding that leaked" would have read as a broken gate and tempted a fix to the wrong thing.
 */
const groundingRefsIn = (facts: readonly PromptEnhancementGuidanceFact[]): string[] =>
  facts.filter((f) => f.renderPolicy === 'render_as_section' && f.priority !== 'suppressed')
    .flatMap((f) => f.sourceIds)
    .filter((id) => projectFactCategoryForRefV1(id) !== undefined);

describe('the vocabulary both sides share', () => {
  it('every category the model is offered maps back from a stored fact', () => {
    // A category the model can name but no fact belongs to would be un-actionable advice, and a
    // fact with no category would silently bypass the gate. The two lists must be one list.
    const reachable = new Set(
      PROJECT_FACT_CATEGORIES_V1.map((c) => c.id)
        .filter((id) => ['project_framework', 'has_test_runner', 'has_version_control', 'has_ci_pipeline',
          'has_deploy_config', 'has_env_separation', 'has_backups', 'has_lockfile',
          'has_security_scanner', 'has_persistent_context_file']
          .some((key) => projectFactCategoryForRefV1(`hard_fact:${key}`) === id)),
    );
    expect([...reachable].sort()).toEqual(PROJECT_FACT_CATEGORIES_V1.map((c) => c.id).sort());
  });

  it('a movement is judged under the same category as the fact that moved', () => {
    // Hiren, Q4. Without this the movement lane would be a second, ungated way in.
    expect(projectFactCategoryForRefV1('env_change:has_ci_pipeline'))
      .toBe(projectFactCategoryForRefV1('hard_fact:has_ci_pipeline'));
  });

  it('a ref that is not a project fact is none of the gate\'s business', () => {
    expect(projectFactRefIsApplicableV1('work_style:terse', [])).toBe(true);
    expect(projectFactRefIsApplicableV1('mistake:test_creation', [])).toBe(true);
    expect(projectFactRefIsApplicableV1('prompt_fact:deploy_target', [])).toBe(true);
  });
});

describe('the gate — same project, same facts, different prompt', () => {
  it('a prompt that calls for the test runner gets it, and gets ONLY it', async () => {
    const { facts, groundingLines } = await factsFor('add tests for the auth module', ['test_runner']);

    expect(groundingRefsIn(facts)).toEqual(['hard_fact:has_test_runner']);
    expect(groundingLines.join('\n')).toContain('test runner');
    // The nine other facts were in the store and did not travel. That is the whole fix.
    expect(groundingLines.join('\n')).not.toContain('lockfile');
    expect(groundingLines.join('\n')).not.toContain('version control');
  });

  it('a prompt that calls for nothing gets NO grounding section', async () => {
    const { facts, groundingLines } = await factsFor('rename the variable userId to accountId', []);

    expect(groundingRefsIn(facts)).toEqual([]);
    expect(groundingLines).toEqual([]);
    // ⚠️ The SECTION-level consequence — factless ⇒ no section at all, not a generic instruction —
    // is pinned where the section planner is already exercised with a real route
    // (`fact-value-render.test.ts`, "with no stated fact there is no section at all"). Rebuilding a
    // route stub here to assert it twice would be a second, thinner copy of that fixture.
  });

  it('and the SAME prompt with an observation does get the section — the negative is not a broken chain', async () => {
    const { facts, groundingLines } = await factsFor('rename the variable userId to accountId', ['framework']);
    expect(groundingRefsIn(facts)).toEqual(['hard_fact:project_framework']);
    expect(groundingLines.length, 'the chain itself is broken — the negative above proves nothing').toBeGreaterThan(0);
  });
});

describe('fail-closed, and the one thing that is never gated', () => {
  it('no observation channel at all ⇒ no project grounding', async () => {
    // No key, a classifier failure, a degraded route. The old behaviour was to send all ten facts,
    // so falling back to it would restore the defect on exactly the runs nobody watches.
    const { facts, groundingLines } = await factsFor('add tests for the auth module', undefined);
    expect(groundingRefsIn(facts)).toEqual([]);
    expect(groundingLines).toEqual([]);
  });

  it('a FALSE capability is NEVER gated — it is safety material, not grounding', async () => {
    // 🔒 Prohibition 17: safety is never faded, and relevance is not an exception. A temp project
    // has no backups and no CI, and those FALSE facts carry `safety_negative_capability`. The
    // prompt below names none of it — which is exactly the prompt an applicability judgement calls
    // irrelevant, and exactly the prompt where "this project has no backups" earns its place.
    const { facts } = await factsFor('drop the legacy accounts table and rebuild it', []);
    const negatives = facts.filter((f) => (f.safetyHooks ?? []).includes('safety_negative_capability'));

    expect(negatives.length, 'no false capability was produced — this fixture is not exercising the carve-out').toBeGreaterThan(0);
    for (const fact of negatives) {
      expect(
        fact.selectionState,
        `${fact.sourceIds[0]} was suppressed by relevance — the gate is fading a safety fact`,
      ).not.toBe('suppressed_by_relevance');
      expect(fact.priority).not.toBe('suppressed');
    }
  });

  it('a suppressed fact still says WHY it was dropped', async () => {
    const { facts } = await factsFor('rename the variable userId to accountId', []);
    const dropped = facts.filter((f) => f.selectionState === 'suppressed_by_relevance');
    expect(dropped.length, 'the facts vanished instead of being recorded as dropped').toBeGreaterThan(0);
    expect(dropped[0]!.selectionReasonCodes).toContain('project_fact_not_applicable_to_prompt');
    // Still carries its evidence: suppression is a decision about relevance, not a redaction.
    expect(dropped.some((f) => f.evidence?.value !== undefined)).toBe(true);
  });
});


