import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  NON_NEGOTIABLE_PLAN_LOCKS,
  PLAN_LOCK_SOURCE_BASIS,
  evaluateSourceSyncAndPlanLock,
  readSourceSyncFileFacts,
  type SourceSyncFacts,
} from './plan-lock.js';

function lockedFacts(overrides: Partial<SourceSyncFacts> = {}): SourceSyncFacts {
  return {
    branch: PLAN_LOCK_SOURCE_BASIS.branch,
    currentHead: PLAN_LOCK_SOURCE_BASIS.currentHead,
    sourceImpactRange: PLAN_LOCK_SOURCE_BASIS.sourceImpactRange,
    containedCommits: [PLAN_LOCK_SOURCE_BASIS.containedUpstreamCommit],
    gitignoreText: [
      'dist/',
      PLAN_LOCK_SOURCE_BASIS.ignoredPromptEnhancementPath,
      PLAN_LOCK_SOURCE_BASIS.ignoredExtVscodePrebuildsPath,
    ].join('\n'),
    trackedFiles: ['src/cli/index.ts', 'src/decision-session/content-template-engine.ts'],
    promptEnhancementPathExists: true,
    promptEnhancementNestedGitExists: true,
    activeInstructionTexts: [
      'Use 144 content-template records, 137 shared signals, prompt-start preparation, and Stop bridge delivery.',
    ],
    unreconciledActiveRows: [],
    nonNegotiableLocks: NON_NEGOTIABLE_PLAN_LOCKS,
    ...overrides,
  };
}

describe('Phase 0 source sync and plan lock', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('locks when the current source basis and executable source counts match the dev plan', () => {
    const evaluation = evaluateSourceSyncAndPlanLock(lockedFacts());

    expect(evaluation.locked).toBe(true);
    expect(evaluation.checks.filter((item) => !item.ok)).toEqual([]);
    expect(evaluation.promptStartStop.hookBoundary).toBe('UserPromptSubmit -> runAuto');
    expect(evaluation.promptStartStop.deliveryBoundary).toBe('Stop -> runStop');
    expect(evaluation.promptStartStop.sharedSignalCount).toBe(137);
    expect(evaluation.store.schemaVersion).toBe(1);
  });

  it('blocks stale active implementation wording instead of treating it as current truth', () => {
    const evaluation = evaluateSourceSyncAndPlanLock(lockedFacts({
      activeInstructionTexts: [
        [
          'Build against the partial content-template and dark engine.',
          'Use the 142 count and 129 count.',
          'Assume pre-send same-turn replacement.',
          'Use old static DS maps and a PE-only classifier.',
          'Treat public tracked PE source as ready.',
        ].join(' '),
      ],
    }));

    expect(evaluation.locked).toBe(false);
    const stale = evaluation.checks.find((item) => item.id === 'stale-active-instructions');
    expect(stale?.ok).toBe(false);
    expect(stale?.actual).toContain('142 count');
    expect(stale?.actual).toContain('129 count');
    expect(stale?.actual).toContain('pre-send same-turn replacement');
    expect(stale?.actual).toContain('old static DS maps');
    expect(stale?.actual).toContain('PE-only classifier');
    expect(stale?.actual).toContain('public tracked PE source');
  });

  it('blocks source-basis drift until the replacement source basis is explicitly verified', () => {
    const evaluation = evaluateSourceSyncAndPlanLock(lockedFacts({
      currentHead: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    }));

    expect(evaluation.locked).toBe(false);
    expect(evaluation.checks.find((item) => item.id === 'head')).toMatchObject({
      ok: false,
      expected: PLAN_LOCK_SOURCE_BASIS.currentHead,
      actual: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
  });

  it('blocks when the requested upstream commit is not recorded as contained', () => {
    const evaluation = evaluateSourceSyncAndPlanLock(lockedFacts({
      containedCommits: ['4dc2ac1000000000000000000000000000000000'],
    }));

    expect(evaluation.locked).toBe(false);
    expect(evaluation.checks.find((item) => item.id === 'contained-upstream')).toMatchObject({
      ok: false,
      expected: PLAN_LOCK_SOURCE_BASIS.containedUpstreamCommit,
    });
  });

  it('blocks missing ignore boundaries and public tracked PE/prebuild source assumptions', () => {
    const evaluation = evaluateSourceSyncAndPlanLock(lockedFacts({
      gitignoreText: 'dist/\n',
      trackedFiles: [
        'src/prompt-enhancement/contracts.ts',
        'src/ext-vscode/prebuilds/native.node',
      ],
    }));

    expect(evaluation.locked).toBe(false);
    expect(evaluation.checks.find((item) => item.id === 'gitignore-prompt-enhancement')?.ok).toBe(false);
    expect(evaluation.checks.find((item) => item.id === 'gitignore-ext-vscode-prebuilds')?.ok).toBe(false);
    expect(evaluation.checks.find((item) => item.id === 'public-tracked-prompt-enhancement')).toMatchObject({
      ok: false,
      actual: '1',
    });
    expect(evaluation.checks.find((item) => item.id === 'public-tracked-ext-vscode-prebuilds')).toMatchObject({
      ok: false,
      actual: '1',
    });
  });

  it('blocks missing non-negotiable locks', () => {
    const evaluation = evaluateSourceSyncAndPlanLock(lockedFacts({
      nonNegotiableLocks: ['local_first_cli'],
    }));

    expect(evaluation.locked).toBe(false);
    const locks = evaluation.checks.find((item) => item.id === 'non-negotiable-locks');
    expect(locks?.ok).toBe(false);
    expect(locks?.actual).toContain('no_backend_service');
    expect(locks?.actual).toContain('existing_ds_advisory_backward_compatible');
    expect(locks?.actual).toContain('public_launch_gated');
  });

  it('blocks unreconciled active pending rows before coding', () => {
    const evaluation = evaluateSourceSyncAndPlanLock(lockedFacts({
      unreconciledActiveRows: ['PE-AR-7 PENDING from stale top-level handoff row'],
    }));

    expect(evaluation.locked).toBe(false);
    expect(evaluation.checks.find((item) => item.id === 'g0-active-row-reconciliation')).toMatchObject({
      ok: false,
      actual: '1',
    });
  });

  it('reads filesystem launch-boundary facts without shelling out to git', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'nexpath-plan-lock-'));
    tempDirs.push(projectRoot);
    mkdirSync(join(projectRoot, 'src/prompt-enhancement/.git'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.gitignore'),
      [
        PLAN_LOCK_SOURCE_BASIS.ignoredPromptEnhancementPath,
        PLAN_LOCK_SOURCE_BASIS.ignoredExtVscodePrebuildsPath,
      ].join('\n'),
      'utf8',
    );

    const facts = readSourceSyncFileFacts({
      projectRoot,
      branch: PLAN_LOCK_SOURCE_BASIS.branch,
      currentHead: PLAN_LOCK_SOURCE_BASIS.currentHead,
      sourceImpactRange: PLAN_LOCK_SOURCE_BASIS.sourceImpactRange,
      containedCommits: [PLAN_LOCK_SOURCE_BASIS.containedUpstreamCommit],
      trackedFiles: [],
    });

    expect(facts.promptEnhancementPathExists).toBe(true);
    expect(facts.promptEnhancementNestedGitExists).toBe(true);
    expect(facts.gitignoreText).toContain(PLAN_LOCK_SOURCE_BASIS.ignoredPromptEnhancementPath);
    expect(evaluateSourceSyncAndPlanLock(facts).locked).toBe(true);
  });
});
