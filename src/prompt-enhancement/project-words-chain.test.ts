import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The writer's prompt is captured where it leaves the engine: the OpenAI client. The reply is empty,
// so the composer falls back — this file only reads what the writer was GIVEN.
const writerPrompts: string[] = [];
vi.mock('openai', () => ({
  default: class {
    chat = {
      completions: {
        create: vi.fn(async (body: { messages: { role: string; content: string }[] }) => {
          for (const message of body.messages) if (message.role === 'user') writerPrompts.push(message.content);
          return { choices: [{ message: { content: '' } }] };
        }),
      },
    };
  },
}));

import { openStore } from '../store/db.js';
import { upsertProject, setProjectEnvFacts } from '../store/index.js';
import { setPromptDerivedFacts } from '../store/env-facts.js';
import { probeProject } from '../env/env-probe.js';
import { SessionStateManager } from '../classifier/SessionStateManager.js';
import { buildPromptEnhancementRequestForAuto } from '../cli/commands/auto.js';
import { preparePromptEnhancement } from './facade.js';

/**
 * Project words, end to end: a real project on disk → the real probe → the real store → the CLI's own request
 * builder → the real applicability gate, mix, planner and composer prompt. Each case differs from its pair ONLY in
 * what the classifier observed (or what the project has), so a chain that offers nothing, or offers what the gate
 * refused, fails one half.
 */

const PROMPT = 'add a reschedule button to the appointment details page and add a regression test for it';
const FRAMEWORK_WORDS = '[[in the Next.js app]]';
const CI_WORDS = '[[in the CI pipeline]]';

/** A Next.js project with a test runner, version control, a lockfile and a CI workflow — and no backups. */
function testedProject(options: { ci?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'project-words-chain-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', dependencies: { next: '^14.0.0' }, devDependencies: { vitest: '^1.0.0' } }));
  writeFileSync(join(dir, 'package-lock.json'), '{}\n');
  mkdirSync(join(dir, '.git'));
  if (options.ci !== false) {
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(dir, '.github', 'workflows', 'ci.yml'), 'name: ci\n');
  }
  return dir;
}

async function writerPromptFor(
  observed: readonly string[],
  options: { probe?: boolean; mined?: boolean; ci?: boolean; language?: string } = {},
): Promise<string> {
  const dir = testedProject({ ci: options.ci });
  const store = await openStore(':memory:');
  try {
    upsertProject(store, { projectRoot: dir, name: 'x', projectType: 'app', language: 'ts', description: '', createdAt: Date.now() });
    if (options.probe !== false) setProjectEnvFacts(store, dir, probeProject(dir, Date.now()).facts, Date.now());
    if (options.mined) setPromptDerivedFacts(store, dir, [{ key: 'payment_provider', value: 'stripe' }], Date.now(), 25);
    const request = buildPromptEnhancementRequestForAuto({
      auto: { promptText: PROMPT, projectRoot: dir, currentAgentMode: 'default' },
      store,
      session: SessionStateManager.load(store, dir),
      project: null,
      effectiveLanguage: options.language ?? 'en',
      configuredRole: null,
      effectiveFlagType: 'stage_transition',
      firedKey: 'stage_transition:task_breakdown→implementation',
      previousStage: 'task_breakdown',
      trigger: { kind: 'stage_transition' },
      stageResult: {
        classification: { stage: 'implementation', confidence: 0.9, tier: 3, allScores: {} },
        signalsPresent: [], signalsAbsent: [], fireRecommendation: true, selectedSignalKey: '',
        reason: 'project-words-chain', degraded: false, projectFactCandidates: observed,
        primaryIntent: 'feature.fresh_implementation', intentConfidence: 0.9,
      },
      streamBOutputs: [],
    } as never);
    writerPrompts.length = 0;
    await preparePromptEnhancement(request);
    expect(writerPrompts.length, 'the composer was never called — the chain proves nothing').toBeGreaterThan(0);
    return writerPrompts[0] ?? '';
  } finally {
    store.db.close();
  }
}

const count = (prompt: string, words: string): number => prompt.split(words).length - 1;

describe('project words follow the classifier\'s relevance judgement, end to end', () => {
  // The facade calls the composer only when a credential is configured. This one is a FAKE of the right
  // shape and never leaves the process — the OpenAI client above is a mock.
  beforeEach(() => {
    writerPrompts.length = 0;
    vi.stubEnv('OPENAI_API_KEY', `sk-${'test'.repeat(12)}`);
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('the framework judged relevant → ONE section is asked for "in the Next.js app", and nothing else is offered', async () => {
    const prompt = await writerPromptFor(['framework']);
    expect(count(prompt, FRAMEWORK_WORDS)).toBe(1);
    expect(count(prompt, CI_WORDS)).toBe(0);
    expect(prompt).not.toContain('Project facts you may use in any section');
  });

  it('CI judged relevant → still nothing: the CI pipeline offers no words (withdrawn — it primed CI mentions elsewhere)', async () => {
    expect(await writerPromptFor(['ci_pipeline'])).not.toContain('[[');
  });

  it('nothing judged relevant → no project words anywhere', async () => {
    const prompt = await writerPromptFor([]);
    expect(prompt).not.toContain('[[');
  });

  it('the test runner judged relevant → still nothing: a bare "has a test runner" offers no words', async () => {
    expect(await writerPromptFor(['test_runner'])).not.toContain('[[');
  });

  it('a CI pipeline the probe found ABSENT is never offered, even when its category is judged relevant', async () => {
    expect(await writerPromptFor(['ci_pipeline'], { ci: false })).not.toContain('[[');
  });

  it('a fact mined from recent requests is never offered — it stays a possibility in the project-facts section', async () => {
    const prompt = await writerPromptFor(['framework'], { mined: true });
    expect(prompt).not.toContain('[[in the stripe');
    expect(count(prompt, FRAMEWORK_WORDS)).toBe(1);
  });

  it('nothing stored for the project (no probe facts) → nothing offered', async () => {
    expect(await writerPromptFor(['framework', 'ci_pipeline'], { probe: false })).not.toContain('[[');
  });

  it('a developer writing in another language is offered nothing', async () => {
    expect(await writerPromptFor(['framework', 'ci_pipeline'], { language: 'hi' })).not.toContain('[[');
    // CONTROL: the same facts in English are offered.
    const english = await writerPromptFor(['framework', 'ci_pipeline'], { language: 'en' });
    expect(count(english, FRAMEWORK_WORDS)).toBe(1);
    expect(count(english, CI_WORDS)).toBe(0);
  });
});
