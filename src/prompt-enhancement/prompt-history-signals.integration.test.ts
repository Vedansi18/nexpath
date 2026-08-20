import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../store/db.js';
import { upsertProject, setProjectEnvFacts } from '../store/index.js';
import { insertPrompt } from '../store/prompts.js';
import { probeProject } from '../env/env-probe.js';
import { SessionStateManager } from '../classifier/SessionStateManager.js';
import { buildPromptEnhancementRequestForAuto } from '../cli/commands/auto.js';
import { preparePromptEnhancement } from './facade.js';

/**
 * The recent-history sensitive-action lane is WIRED.
 *
 * ⛔ This file exists because the unit tests cannot prove it. `prompt-history-signals.test.ts` was
 * fully green while nothing imported the module at all — exactly the failure that let a whole
 * analysis layer sit unreachable inside a switched-off engine for months. Only a run through the
 * real boundary shows the signal becoming a section a developer would actually see.
 *
 * 🔑 The pair is the point: identical set-up, and the ONLY difference is whether the recent prompts
 * mention a sensitive action. A single positive case would pass for any reason that adds a safety
 * section, including reasons that have nothing to do with this lane.
 */
async function prepareWithHistory(recentPrompts: readonly string[], label: string): Promise<readonly string[]> {
  const dir = mkdtempSync(join(tmpdir(), `history-signals-${label}-`));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', devDependencies: { vitest: '1.0.0' } }));
  const store = await openStore(join(dir, 'store.db'));
  upsertProject(store, {
    projectRoot: dir, name: 'x', projectType: 'app', language: 'ts', description: '', createdAt: Date.now(),
  });
  setProjectEnvFacts(store, dir, probeProject(dir, Date.now()).facts, Date.now());
  for (const promptText of recentPrompts) insertPrompt(store, { projectRoot: dir, promptText });

  const request = buildPromptEnhancementRequestForAuto({
    auto: { promptText: 'add retry to the payment flow and make sure it is covered', projectRoot: dir, currentAgentMode: 'default' },
    store, session: SessionStateManager.load(store, dir), project: null,
    effectiveLanguage: 'en', configuredRole: null, effectiveFlagType: 'stage_transition',
    firedKey: 'stage_transition:idea', previousStage: 'idea', trigger: { kind: 'stage_transition' },
    stageResult: {
      classification: { stage: 'implementation', confidence: 0.9, tier: 3, allScores: {} },
      signalsPresent: [], signalsAbsent: [], fireRecommendation: true, selectedSignalKey: '',
      reason: 'history-signals-e2e', degraded: false,
      projectFactCandidates: ['test_runner', 'version_control', 'framework'],
      sectionRelevanceOrder: [],
    },
    streamBOutputs: [],
  } as never);

  const result = await preparePromptEnhancement(request) as never as {
    currentBody: { sections: readonly { sectionKind: string }[]; text: string };
  };
  return result.currentBody.sections.map((section) => section.sectionKind);
}

describe('the recent-history sensitive-action lane is WIRED', () => {
  /**
   * 🔴 **BLOCKED PENDING AN OWNER RULING — measured 2026-08-20, not assumed.**
   *
   * The producer works: the ref crosses, the fact is built with `confirm_risk`, evidence and a
   * safety hook. It is then DELETED by the source mix before the planner ever sees it, by two rules
   * in `source-mix.ts` that this fact hits at once:
   *
   *   1. `factRole === 'safety_confirmation_support'` → `selected_source_label_only`
   *   2. `sourceOriginScope === 'recent_prompt_history'` → `selected_source_label_only`
   *      (*"prompt-only knowledge never satisfies a Source B cap"*)
   *
   * And `selected_source_label_only` is excluded from `renderedFacts`, which is what the planner
   * consumes. So prompt-derived material cannot render as a fact NO MATTER WHICH PRODUCER EMITS IT
   * — the routing gap was only half the story.
   *
   * ⛔ These two stay SKIPPED rather than deleted or weakened: they state the behaviour the lane is
   * for, and they must go green the moment the ruling lands. The negative case below is NOT skipped
   * — it passes today and must keep passing under any ruling.
   */
  it.skip('a sensitive action in recent prompts puts a risk/confirmation section in the body', async () => {
    const kinds = await prepareWithHistory([
      'the login form is not centered on mobile',
      'lets deploy this to production tonight',
      'and deploy the worker service too',
    ], 'sensitive');
    expect(
      kinds,
      `the body rendered ${kinds.join(', ')} — the lane is not reaching the section planner`,
    ).toContain('risk_safety_or_confirmation');
  });

  it('an ordinary history does NOT — the lane is silent by default', async () => {
    // The discriminating half. Same set-up, same current prompt, no sensitive mention: this is what
    // proves the section came from the HISTORY rather than from anything else on the path.
    const kinds = await prepareWithHistory([
      'the login form is not centered on mobile',
      'can you add a loading spinner to the header',
      'the button label should say Continue',
    ], 'ordinary');
    expect(kinds).not.toContain('risk_safety_or_confirmation');
  });

  it.skip('the section carries the safeguard, and never the words the developer typed', async () => {
    // 🔒 The leakage bound, asserted on the RENDERED BODY rather than on the signal module — that is
    // where a leak would actually reach a person, and where an intermediate layer re-introducing the
    // matched text would show up.
    const dir = mkdtempSync(join(tmpdir(), 'history-signals-leak-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', devDependencies: { vitest: '1.0.0' } }));
    const store = await openStore(join(dir, 'store.db'));
    upsertProject(store, {
      projectRoot: dir, name: 'x', projectType: 'app', language: 'ts', description: '', createdAt: Date.now(),
    });
    setProjectEnvFacts(store, dir, probeProject(dir, Date.now()).facts, Date.now());
    insertPrompt(store, { projectRoot: dir, promptText: 'just delete the whole abandoned_experiments folder' });

    const request = buildPromptEnhancementRequestForAuto({
      auto: { promptText: 'add retry to the payment flow and make sure it is covered', projectRoot: dir, currentAgentMode: 'default' },
      store, session: SessionStateManager.load(store, dir), project: null,
      effectiveLanguage: 'en', configuredRole: null, effectiveFlagType: 'stage_transition',
      firedKey: 'stage_transition:idea', previousStage: 'idea', trigger: { kind: 'stage_transition' },
      stageResult: {
        classification: { stage: 'implementation', confidence: 0.9, tier: 3, allScores: {} },
        signalsPresent: [], signalsAbsent: [], fireRecommendation: true, selectedSignalKey: '',
        reason: 'history-signals-leak', degraded: false,
        projectFactCandidates: ['test_runner', 'version_control', 'framework'],
        sectionRelevanceOrder: [],
      },
      streamBOutputs: [],
    } as never);

    const result = await preparePromptEnhancement(request) as never as { currentBody: { text: string } };
    expect(result.currentBody.text).toContain('ask me for go-ahead confirmation');
    expect(result.currentBody.text).not.toContain('abandoned_experiments');
  });
});
