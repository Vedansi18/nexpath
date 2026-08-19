import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, type Store } from '../store/db.js';
import { upsertProject } from '../store/index.js';
import { setEnvTrajectory } from '../store/env-facts.js';
import { setConfig } from '../store/config.js';
import { appendParamEvent } from '../telemetry/param-events.js';
import {
  recentEnvChangesV1,
  ENV_CHANGE_GROUNDING_WINDOW_MS,
  ENV_CHANGE_GROUNDING_MAX,
} from '../env/env-trajectory.js';
import { buildPromptEnhancementGroundingRefsV1, buildPromptEnhancementRequestForAuto } from '../cli/commands/auto.js';
import { SessionStateManager } from '../classifier/SessionStateManager.js';
import { buildPromptEnhancementGuidanceFactsV1 } from './guidance-facts.js';
import { promptEnhancementFactValueLinesV1 } from './fact-value-render.js';
import { normalizePromptEnhancementTier1FieldsV1 } from './source-mix.js';
import { promptEnhancementSectionKindForFactV1, type PromptEnhancementGuidanceFact } from './templates/section-plan.js';

/**
 * §17.11 — the owner ruled WIRE IT (a1): an env movement gets a sentence in the project-grounding
 * section that already exists, not a section of its own.
 *
 * ⚠️ These fixtures exist because of how §17.11 was nearly decided. The row was measured as
 * "write-only, feeds nothing" by asking who imports `getEnvTrajectory` — and the module's OTHER
 * output, an `env_fact_changed` param event, was already feeding practice-score credit through a
 * string prefix no import graph can see. So the pins here follow the DATA, not the import graph:
 * the event must reach the boundary, the boundary must reach a fact, and the fact must reach a
 * body line a user would actually read.
 */

const DAY = 24 * 60 * 60 * 1000;

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'envchg-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', devDependencies: { vitest: '1.0.0' } }));
  return dir;
}

/** Param events are DISK-backed: `paramEventsPathFor` returns null for `:memory:`. */
async function diskStore(): Promise<{ store: Store; dir: string }> {
  const dir = tempProject();
  const store = await openStore(join(dir, 'store.db'));
  upsertProject(store, { projectRoot: dir, name: 'x', projectType: 'app', language: 'ts', description: '', createdAt: Date.now() });
  return { store, dir };
}

function emitChange(store: Store, dir: string, key: string, direction: string, ts: number): void {
  appendParamEvent(store, {
    projectRoot: dir,
    sessionId: 's1',
    promptIndex: 0,
    signalKey: `env_fact_changed:${key}:${direction}`,
    channel: 'probe',
    stage: 'implementation',
    stageConfidence: 0.9,
    source: 'live',
    ts,
  });
}

describe('§17.11 reader — the movements worth stating', () => {
  it('reads the EVENT for the movement and the BASELINE for what it settled on', async () => {
    const { store, dir } = await diskStore();
    const now = Date.now();
    emitChange(store, dir, 'has_ci_pipeline', 'acquired', now - DAY);
    emitChange(store, dir, 'project_framework', 'changed', now - 2 * DAY);
    setEnvTrajectory(store, dir, {
      baseline: { project_framework: { value: 'nextjs', detectedAt: now } as never },
      pending: {},
    });

    const changes = recentEnvChangesV1(store, dir, now);
    const byKey = new Map(changes.map((c) => [c.key, c]));

    // A boolean capability reads as arriving; the event alone is enough for that.
    expect(byKey.get('has_ci_pipeline')?.phrase).toBe('was acquired');
    // A valued fact needs BOTH outputs: the event says it moved, the baseline says to what.
    // This is the pairing the "write-only" measurement missed.
    expect(byKey.get('project_framework')?.phrase).toBe('changed to nextjs');
  });

  it('names no value it does not have — a movement with no settled baseline stays bare', async () => {
    const { store, dir } = await diskStore();
    const now = Date.now();
    emitChange(store, dir, 'project_framework', 'changed', now - DAY);

    expect(recentEnvChangesV1(store, dir, now)[0]?.phrase).toBe('changed');
  });

  it('drops movements too old to be news, and states where a fact LANDED rather than its history', async () => {
    const { store, dir } = await diskStore();
    const now = Date.now();
    emitChange(store, dir, 'has_test_runner', 'acquired', now - (ENV_CHANGE_GROUNDING_WINDOW_MS + DAY));
    emitChange(store, dir, 'has_ci_pipeline', 'acquired', now - 5 * DAY);
    emitChange(store, dir, 'has_ci_pipeline', 'lost', now - DAY);

    const changes = recentEnvChangesV1(store, dir, now);
    expect(
      changes.map((c) => c.key),
      'a stale movement is not wrong, it is just the project as it stands — the probe already states that',
    ).toEqual(['has_ci_pipeline']);
    expect(changes[0]!.phrase, 'the older movement won — a fact that moved twice must state where it landed').toBe('was removed');
  });

  it('caps the section: grounding is not a changelog', async () => {
    const { store, dir } = await diskStore();
    const now = Date.now();
    for (let i = 0; i < ENV_CHANGE_GROUNDING_MAX + 3; i++) emitChange(store, dir, `fact_${i}`, 'acquired', now - i * 1000);

    expect(recentEnvChangesV1(store, dir, now).length).toBe(ENV_CHANGE_GROUNDING_MAX);
  });

  it('is consent-gated like every other read of probe-derived state', async () => {
    const { store, dir } = await diskStore();
    const now = Date.now();
    emitChange(store, dir, 'has_ci_pipeline', 'acquired', now - DAY);
    expect(recentEnvChangesV1(store, dir, now).length).toBe(1);

    setConfig(store, 'env_probe_enabled', 'false');
    expect(
      recentEnvChangesV1(store, dir, now),
      'consent off must silence the movement lane, not only the probe that feeds it',
    ).toEqual([]);
  });
});

describe('§17.11 wire — the movement crosses, becomes a fact, and reaches a body', () => {
  async function movementChain(): Promise<{
    refs: ReturnType<typeof buildPromptEnhancementGroundingRefsV1>;
    facts: readonly PromptEnhancementGuidanceFact[];
  }> {
    const { store, dir } = await diskStore();
    emitChange(store, dir, 'has_ci_pipeline', 'acquired', Date.now() - DAY);
    const refs = buildPromptEnhancementGroundingRefsV1(store, dir, []);
    // The REAL request builder, not a hand-built stub: the chain being pinned is the live one,
    // and a stub would prove only that the producer works when handed refs by a test.
    const request = buildPromptEnhancementRequestForAuto({
      auto: { promptText: 'upgrade the auth middleware', projectRoot: dir, currentAgentMode: 'default' },
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
        signalsPresent: [],
        signalsAbsent: [],
        fireRecommendation: true,
        selectedSignalKey: '',
        reason: 'env-change',
        degraded: false,
        // The movement is judged under its own category (Hiren, Q4) — an observed CI-pipeline
        // need is what lets an acquired CI pipeline be stated.
        projectFactCandidates: ['ci_pipeline', 'test_runner'],
      },
      streamBOutputs: [],
    } as never);
    return { refs, facts: buildPromptEnhancementGuidanceFactsV1(request) };
  }

  it('crosses the boundary as a TYPED movement, not a bare key', async () => {
    const { refs } = await movementChain();
    const ref = 'env_change:has_ci_pipeline';
    expect(refs.rightGoodWorkStyleEnvRuntimeRefs).toContain(ref);
    // The value is the movement phrase — the whole point of the wire. A bare key here would be
    // the §46.3c "cargo lost at the boundary" defect repeated on a new lane.
    expect(refs.groundingEvidenceByRef?.[ref]).toMatchObject({
      key: 'has_ci_pipeline',
      value: 'was acquired',
      anchorScope: 'project_root',
    });
  });

  it('becomes a fact planned into the EXISTING project-grounding section', async () => {
    const { facts } = await movementChain();
    const movement = facts.find((f) => f.sourceIds[0] === 'env_change:has_ci_pipeline');
    expect(movement, 'the crossing ref produced no fact').toBeDefined();
    expect(
      promptEnhancementSectionKindForFactV1(movement!),
      'the movement landed outside project_grounding_facts — the owner ruled one more line in the section that exists',
    ).toBe('project_grounding_facts');
    expect(movement!.claimVerbPolicy).toBe('must_phrase_as_recent_change');
    expect(movement!.sourceOriginScope).toBe('local_probe_trajectory');
    expect(movement!.sourceEligibilityState).toBe('support_only_not_triggering');
  });

  it('renders as a sentence about what MOVED, in the section a user already reads', async () => {
    const { facts } = await movementChain();
    const lines = promptEnhancementFactValueLinesV1('project_grounding_facts', facts);
    const movementLine = lines.find((l) => l.includes('has ci pipeline') || l.includes('ci pipeline'));
    expect(movementLine, 'the movement never reached a body — check-4 for the new lane').toBeDefined();
    expect(movementLine).toContain('was acquired');
    expect(movementLine).toContain('since the last session');
    // ⛔ A movement worded as a standing fact is a claim about the present the evidence does not
    // support: "ci pipeline IS true" says nothing about when, and the whole lane exists for when.
    expect(movementLine).not.toContain('Known project fact');
  });

  it('can never be promoted into practice wording, whatever a producer asks for', () => {
    // The ceiling is the reason this rung exists rather than reusing a project-knowledge one. A
    // movement is ONE local probe pair — never behaviour-corroborated — so no downstream mixing
    // may lift it, and no producer may hand it a stronger policy by mistake.
    const asked = normalizePromptEnhancementTier1FieldsV1({
      factId: 'f1',
      sourceType: 'hard_fact',
      sourceIds: ['env_change:has_ci_pipeline'],
      guidanceKind: 'project_grounding',
      suggestedActionKind: 'ground_in_project_fact',
      targetFamily: 'family_agnostic',
      targetSectionKind: '',
      sourceEvidenceState: 'partial',
      sourceOriginScope: 'local_probe_trajectory',
      claimVerbPolicy: 'must_phrase_as_recent_change',
      priority: 'low',
      renderPolicy: 'render_as_section',
      riskLevel: 'none',
      privacyClass: 'local_private',
      sanitizationState: 'not_applicable',
      evidence: { key: 'has_ci_pipeline', value: 'was acquired' },
      sourceAnchorScope: 'project_root',
    } as never);
    expect(asked.claimVerbPolicy).toBe('must_phrase_as_recent_change');
  });
});

describe('§17.11 cost — the movement lane must not re-read the event log it was handed', () => {
  // PE runs on EVERY prompt, and the boundary already reads the append-only param-event log TWICE
  // before it reaches this lane (`loadRightGoodProfile`, then the work-style profile). A third full
  // read and JSON.parse, for a lane that yields at most three lines, is a per-prompt cost with
  // nothing to show for it.
  //
  // Pinned as BEHAVIOUR, not as a comment: the reader is handed a window for a project whose log
  // does not exist on disk. If it ignores the window and re-reads, it finds nothing and returns
  // nothing -- so this test fails the moment the saving is reverted.
  it('uses the supplied window instead of the disk, and returns what only the window contains', async () => {
    const { store, dir } = await diskStore();
    const now = Date.now();
    const windowOnly = [{
      schemaVersion: 1, ts: now - DAY, projectRoot: dir, sessionId: 's1', promptIndex: 0,
      signalKey: 'env_fact_changed:has_ci_pipeline:acquired', channel: 'probe',
      stage: 'implementation', stageConfidence: 0.9, source: 'live',
    }] as never;

    // Nothing was ever appended for this project, so the disk has no such event.
    expect(recentEnvChangesV1(store, dir, now)).toEqual([]);

    expect(
      recentEnvChangesV1(store, dir, now, windowOnly).map((c) => c.key),
      'the supplied window was ignored -- the lane is re-reading the log a third time per prompt',
    ).toEqual(['has_ci_pipeline']);
  });

  it('and the live boundary actually hands its window over', () => {
    // The saving only exists if the caller takes it. Asserted at the call site because that is
    // where it can be lost -- the function above would keep passing on its own.
    const auto = readFileSync('src/cli/commands/auto.ts', 'utf8');
    expect(
      /recentEnvChangesV1\([^;]*paramEvents\)/.test(auto),
      'the boundary stopped passing its already-read window -- the third read per prompt is back',
    ).toBe(true);
  });
});
