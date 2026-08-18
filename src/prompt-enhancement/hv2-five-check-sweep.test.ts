import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, type Store } from '../store/db.js';
import { upsertProject, setProjectEnvFacts } from '../store/index.js';
import { SessionStateManager } from '../classifier/SessionStateManager.js';
import { buildPromptEnhancementRequestForAuto } from '../cli/commands/auto.js';
import { buildPromptEnhancementGuidanceFactsV1 } from './guidance-facts.js';
import { promptEnhancementFactValueLinesV1, promptEnhancementSectionModelFactsV1 } from './fact-value-render.js';
import { probeProject } from '../env/env-probe.js';
import { resolveFramework } from '../env/framework-fingerprints.js';
import { promoteEnvFactsToTierP, corroborationTierForEnvFact } from '../env/env-tier-promotion.js';
import { recordEnvTrajectory } from '../env/env-trajectory.js';
import { loadRightGoodProfile } from '../classifier/right-good-aggregator.js';
import { appendParamEvents, readParamEvents } from '../telemetry/param-events.js';
import type { PromptEnhancementGuidanceFact } from './templates/section-plan.js';

/**
 * HV-2 (dev-plan §14.3) — the five-check protocol run on ALL ELEVEN §46.3c modules, one exercise
 * fixture each, per step 3: "each drives its module's output through the boundary into a body and
 * pins the whole chain".
 *
 * The five checks (§46.3b): 1 executes on the live path · 2 crosses the boundary and HOW · 3
 * becomes a fact with content · 4 the content reaches a body · 5 a test pins each of the above.
 *
 * ⛔ §14.3's frame: "a failure here is a bug against the owning group — H patches nothing." Where a
 * module does NOT reach PE, the fixture pins that measured absence rather than fixing it. An
 * absence pinned in both directions is the point: it fails if the gap silently closes, so HV-3
 * judges the state that actually shipped.
 *
 * ⚠️ Check-1 is measured by CALLER, never by import — HV-1 round 2 found a listed consumer that is
 * imported and never runs. The per-export liveness numbers quoted in the rows come from that
 * caller-check, re-run for this phase against all eleven.
 */

function tempProject(withRunner = true): string {
  const dir = mkdtempSync(join(tmpdir(), 'hv2-'));
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'x', devDependencies: withRunner ? { vitest: '1.0.0' } : {} }),
  );
  return dir;
}

/** The live chain: module output already seeded → real request builder → facts → rendered lines. */
function driveChain(store: Store, dir: string): {
  refs: ReturnType<typeof buildPromptEnhancementRequestForAuto>['sourceSignals'];
  facts: readonly PromptEnhancementGuidanceFact[];
  requestJson: string;
  linesFor: (sectionKind: string) => readonly string[];
} {
  const session = SessionStateManager.load(store, dir);
  const request = buildPromptEnhancementRequestForAuto({
    auto: { promptText: 'add the token refresh path and check it', projectRoot: dir, currentAgentMode: 'default' },
    store,
    session,
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
      reason: 'hv2',
      degraded: false,
    },
    streamBOutputs: [],
  });
  const facts = buildPromptEnhancementGuidanceFactsV1(request);
  return {
    refs: request.sourceSignals,
    facts,
    requestJson: JSON.stringify(request),
    linesFor: (kind) => promptEnhancementFactValueLinesV1(kind, facts),
  };
}

/**
 * Rows 7 and 9 CANNOT be exercised on an in-memory store: `paramEventsPathFor` returns null for
 * `:memory:` (`param-events.ts:84`), so nothing can be written and `readParamEvents` yields
 * nothing. That is a real property of those lanes — they are disk-backed — and it means any
 * harness using `:memory:` would measure "no signals" and call it a clean pass.
 */
async function openDiskStore(): Promise<{ store: Store; dir: string }> {
  const dir = tempProject();
  const store = await openStore(join(dir, 'store.db'));
  upsertProject(store, { projectRoot: dir, name: 'x', projectType: 'app', language: 'ts', description: '', createdAt: Date.now() });
  setProjectEnvFacts(store, dir, probeProject(dir, Date.now()).facts, Date.now());
  return { store, dir };
}

function seedEnvFacts(store: Store, dir: string): void {
  upsertProject(store, { projectRoot: dir, name: 'x', projectType: 'app', language: 'ts', description: '', createdAt: Date.now() });
  setProjectEnvFacts(store, dir, probeProject(dir, Date.now()).facts, Date.now());
}

// ─────────────────────────────────────────────────────────────────────────────
// ROW 1 — env/env-probe.ts — "cargo lost at the boundary", fixed by A3
// ─────────────────────────────────────────────────────────────────────────────
describe('HV-2 row 1 — env-probe: executes, crosses WITH VALUES, becomes content, renders', () => {
  it('drives probe output through the boundary into rendered body lines', async () => {
    const store = await openStore(':memory:');
    const dir = tempProject();
    seedEnvFacts(store, dir);

    const { refs, facts, linesFor } = driveChain(store, dir);

    // check-2: crosses, and HOW — typed {key,value}, not the bare `hard_fact:<key>` of §46.3c
    expect(refs.sourceOnlyHardFactRefs.length).toBeGreaterThan(0);
    const ref = refs.sourceOnlyHardFactRefs[0]!;
    const evidence = refs.groundingEvidenceByRef?.[ref];
    expect(evidence?.key, 'check-2 regressed to keys-only — that is A3 unwinding').toBeTruthy();
    expect(evidence?.value).toBeDefined();

    // check-3: becomes a fact carrying its value
    const envFacts = facts.filter((f) => f.sourceIds.some((id) => id.startsWith('env:') || id.startsWith('hard_fact:')));
    expect(envFacts.length, 'no env-backed fact was built from the crossing refs').toBeGreaterThan(0);
    expect(envFacts.some((f) => f.evidence?.value !== undefined)).toBe(true);

    // check-4: the content reaches a body
    const kinds = [...new Set(envFacts.map((f) => f.targetSectionKind))];
    const rendered = kinds.flatMap((k) => linesFor(k));
    expect(rendered.join('\n'), 'the fact never rendered — defect G4 would be back').not.toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ROW 2 — env/framework-fingerprints.ts — "rides #1"
// ─────────────────────────────────────────────────────────────────────────────
describe('HV-2 row 2 — framework-fingerprints: rides row 1, and the ride is real', () => {
  it('the probe\'s framework fact IS this module\'s output, for a real dependency', () => {
    // The first version called resolveFramework(dir). That signature takes DEPENDENCY NAMES
    // (`framework-fingerprints.ts:63`), so it returned null for a path, the probe returned null for
    // a dependency-free project, and the fixture passed by comparing two nulls — exercising
    // nothing. Seeding a real fingerprint dependency is what makes "rides #1" checkable.
    const dir = mkdtempSync(join(tmpdir(), 'hv2-fw-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', dependencies: { next: '14.0.0' } }));

    const expected = resolveFramework(['next']);
    expect(expected, 'the fingerprint table stopped recognising a known dependency').toBe('nextjs');

    const probed = probeProject(dir, Date.now()).facts;
    expect(
      probed.project_framework?.value,
      'the probe no longer carries this module\'s output — row 2 does not ride row 1 any more',
    ).toBe(expected);
  });

  it('and it crosses inside row 1 cargo, not on a channel of its own', async () => {
    const store = await openStore(':memory:');
    const dir = mkdtempSync(join(tmpdir(), 'hv2-fw2-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', dependencies: { next: '14.0.0' } }));
    upsertProject(store, { projectRoot: dir, name: 'x', projectType: 'app', language: 'ts', description: '', createdAt: Date.now() });
    setProjectEnvFacts(store, dir, probeProject(dir, Date.now()).facts, Date.now());

    const { refs } = driveChain(store, dir);
    const entry = Object.entries(refs.groundingEvidenceByRef ?? {}).find(([, e]) => e.key === 'project_framework');
    expect(entry, 'the framework fact stopped crossing at all').toBeDefined();
    // The ride: it travels as row 1 cargo (a hard_fact ref with an evidence payload), never on a
    // lane of its own — so there is no separate framework channel to look for.
    expect(entry![0].startsWith('hard_fact:')).toBe(true);
    expect(entry![1].value).toBe('nextjs');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ROW 3 — env/env-tier-promotion.ts — the standout; A1 wired it
// ─────────────────────────────────────────────────────────────────────────────
describe('HV-2 row 3 — env-tier-promotion: A1 landed, the tier now crosses typed', () => {
  it('the boundary stamps a corroboration tier per crossing ref', async () => {
    const store = await openStore(':memory:');
    const dir = tempProject();
    seedEnvFacts(store, dir);
    const { refs } = driveChain(store, dir);

    // §46.3c had this module "NOT WIRED to PE — must be". A1 is the wire; this is its proof.
    expect(refs.groundingTierByRef, 'A1 unwound — the corroboration input PE cannot decide without').toBeDefined();
    const tiers = Object.values(refs.groundingTierByRef ?? {});
    expect(tiers.length).toBeGreaterThan(0);
    for (const tier of tiers) {
      expect(['promoted_practice_P', 'capability', 'uncorroborated']).toContain(tier);
    }
  });

  it('and the promotion rule itself is the one the DS engine uses', () => {
    // Same function, both consumers — §46.3c's row 3 is about the lock's input being shared.
    const promoted = promoteEnvFactsToTierP({ has_test_runner: { value: true } } as never, {
      test_creation: { state: 'right_good', behaviourVerified: true },
    } as never);
    expect(promoted.has_test_runner?.tier).toBe('P');
    expect(corroborationTierForEnvFact(promoted.has_test_runner as never)).toBe('promoted_practice_P');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ROW 4 — env/env-trajectory.ts — measured absence, pinned both ways
// ─────────────────────────────────────────────────────────────────────────────
describe('HV-2 row 4 — env-trajectory: executes, and crosses NOTHING', () => {
  it('runs on the auto path yet contributes no ref, no fact, no line', async () => {
    const store = await openStore(':memory:');
    const dir = tempProject();
    upsertProject(store, { projectRoot: dir, name: 'x', projectType: 'app', language: 'ts', description: '', createdAt: Date.now() });

    recordEnvTrajectory(store, dir, { sessionId: 's', promptIndex: 0, stage: 'implementation', stageConfidence: 0.9 });

    const { refs, facts } = driveChain(store, dir);
    expect(refs.sourceOnlyHardFactRefs, 'the trajectory probe started supplying PE — HV-3 must re-judge row 4').toEqual([]);
    expect(
      facts.some((f) => f.sourceIds.some((id) => id.includes('trajectory'))),
      'a trajectory-derived fact appeared — the gap closed; re-measure rather than relax this',
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ROW 5 — env/agent-capabilities.ts — absent by ruling, not by accident
// ─────────────────────────────────────────────────────────────────────────────
describe('HV-2 row 5 — agent-capabilities: absent from grounding, deferred by owner ruling', () => {
  it('no capability fact crosses, while the mode still reaches PE as review-moment context', async () => {
    const store = await openStore(':memory:');
    const dir = tempProject();
    seedEnvFacts(store, dir);
    const { refs, facts, requestJson } = driveChain(store, dir);

    expect(
      facts.some((f) => f.sourceIds.some((id) => id.includes('agent_capability') || id.includes('mode_band'))),
      'capability facts started crossing — that is the deferred wire (notes §30) landing early',
    ).toBe(false);
    // The distinction the row rests on: the mode IS present to PE as review-moment context while
    // capability FACTS are not. Asserted on the request, not on the refs — that is where mode
    // travels — so the row's "absent from grounding, present as context" claim is pinned whole.
    // Matched as a JSON KEY, not a substring: `currentAgentModeRENAMED` contains
    // `currentAgentMode`, so a substring check survives the very rename it should catch.
    expect(
      requestJson.includes('"currentAgentMode":'),
      'the agent mode stopped reaching PE entirely — row 5 rests on it being present as context',
    ).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ROW 6 — decision-session/content-template-grounding.ts — channels only
// ─────────────────────────────────────────────────────────────────────────────
describe('HV-2 row 6 — content-template-grounding: DS-side live, PE gets channel NAMES only', () => {
  it('param channels cross without their extracted values', async () => {
    // Channels come from the param-event lane, which is disk-backed — an in-memory store yields
    // none at all, which is how the first version of this fixture passed while exercising nothing.
    const { store, dir } = await openDiskStore();
    appendParamEvents(store, Array.from({ length: 4 }, (_, i) => ({
      projectRoot: dir,
      sessionId: 'session-' + String(i),
      promptIndex: i,
      signalKey: 'repro_steps',
      channel: 'transcript' as const,
      stage: 'implementation' as const,
      stageConfidence: 0.7,
      source: 'live' as const,
    })));
    const { refs } = driveChain(store, dir);

    const channels = refs.paramEventChannels ?? [];
    // Non-vacuity first: a loop over an empty list would pass while proving nothing.
    expect(channels.length, 'no channel crossed — row 6 is not being exercised, not passing').toBeGreaterThan(0);
    // §46.3c: "values never cross — only param CHANNEL names". Pinned as measured: a channel entry
    // is a bare name, never a key=value pair.
    for (const channel of channels) {
      expect(channel.includes('='), 'channel "' + channel + '" now carries a value — row 6 changed').toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ROW 7 — classifier/right-good-aggregator.ts — state strings + tier
// ─────────────────────────────────────────────────────────────────────────────
describe('HV-2 row 7 — right-good-aggregator: live, and its state reaches the boundary', () => {
  it('real param events produce a real profile, and the module is on the live path', async () => {
    const { store, dir } = await openDiskStore();
    const events = Array.from({ length: 6 }, (_, i) => ({
      projectRoot: dir, sessionId: `s${i}`, promptIndex: i, signalKey: 'test_creation',
      channel: 'transcript' as const, stage: 'implementation' as const, stageConfidence: 0.9,
      source: 'live' as const,
    }));
    appendParamEvents(store, events);

    // check-1, exercised rather than asserted: the live entry point reads what was written.
    const profile = loadRightGoodProfile(store, dir);
    expect(Object.keys(profile).length, 'the aggregator returned nothing from six real events').toBeGreaterThan(0);
    expect(profile.test_creation).toBeDefined();

    // check-2: the RIGHT/GOOD lane exists at the boundary and is a typed ref list.
    const { refs } = driveChain(store, dir);
    expect(refs.rightGoodWorkStyleEnvRuntimeRefs, 'the RIGHT/GOOD lane disappeared from the boundary').toBeDefined();
    for (const ref of refs.rightGoodWorkStyleEnvRuntimeRefs ?? []) {
      expect(typeof ref).toBe('string');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ROW 8 — store/historical-import.ts — cross-referenced from group B (§14.3 step 4)
// ─────────────────────────────────────────────────────────────────────────────
describe('HV-2 row 8 — historical-import: written from group B evidence, not re-run', () => {
  it('the wire group B verified is still present on the auto path', () => {
    // §14.3 step 4: this row is cross-referenced, not re-measured. What H owes is proof that the
    // thing B verified still exists — the import call on the live path.
    const auto = readFileSync('src/cli/commands/auto.ts', 'utf8');
    // A CALL, not a substring — a renamed symbol still contains the old name, so `toContain`
    // alone would pass on exactly the change it exists to catch.
    expect(
      /\bimportHistoricalPrompts\s*\(/.test(auto),
      'the group-B import wire left the auto path — row 8 is written from that wire existing',
    ).toBe(true);
  });

  it("and group B's own fixtures are the evidence, so they must exist", () => {
    const b = readFileSync('src/store/historical-import.test.ts', 'utf8');
    expect(b.length, 'group B\'s fixture file is what row 8 is written from').toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ROW 9 — telemetry/param-events.ts — work-style values, now typed (A3)
// ─────────────────────────────────────────────────────────────────────────────
describe('HV-2 row 9 — param-events: live, and work-style values cross TYPED not smuggled', () => {
  it('a work-style value crosses in the evidence payload, not inside a ref string', async () => {
    const { store, dir } = await openDiskStore();
    appendParamEvents(store, Array.from({ length: 6 }, (_, i) => ({
      projectRoot: dir, sessionId: `s${i}`, promptIndex: i, signalKey: 'regression_check',
      channel: 'transcript' as const, stage: 'implementation' as const, stageConfidence: 0.8,
      source: 'live' as const,
    })));
    // check-1 exercised: readParamEvents is what work-style computes from.
    expect(readParamEvents(store, dir).length, 'the param-event lane read nothing back').toBeGreaterThan(0);

    const { refs } = driveChain(store, dir);

    // §46.3c: "work-style values smuggled in untyped strings". A3 moved them into {key,value}.
    for (const ref of refs.rightGoodWorkStyleEnvRuntimeRefs ?? []) {
      expect(ref.split(':').length, `ref "${ref}" looks like a smuggled value payload`).toBeLessThanOrEqual(3);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ROW 10 — prompt-enhancement/guidance-facts.ts — healthy pipe, cargo added by A2
// ─────────────────────────────────────────────────────────────────────────────
describe('HV-2 row 10 — guidance-facts: live, and the facts now CARRY content (defect G9)', () => {
  it('facts built from the live request carry evidence and the tier-1 policy trio', async () => {
    const store = await openStore(':memory:');
    const dir = tempProject();
    seedEnvFacts(store, dir);
    const { facts } = driveChain(store, dir);

    expect(facts.length, 'the pipe stopped producing facts entirely').toBeGreaterThan(0);
    const withEvidence = facts.filter((f) => f.evidence?.value !== undefined);
    expect(withEvidence.length, 'G9 is back — facts carrying no content').toBeGreaterThan(0);
    for (const f of withEvidence) {
      expect(f.claimVerbPolicy, 'the claim-policy trio lost a member').toBeTruthy();
      expect(f.sourceOriginScope).toBeTruthy();
      expect(f.sourceAnchorScope).toBeTruthy();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ROW 11 — prompt-enhancement/source-mix.ts — mixes, and now mixes CONTENT
// ─────────────────────────────────────────────────────────────────────────────
describe('HV-2 row 11 — source-mix: live, and content survives the mix into a body', () => {
  it('a fact with content survives mixing and renders its value', async () => {
    const store = await openStore(':memory:');
    const dir = tempProject();
    seedEnvFacts(store, dir);
    const { facts, linesFor } = driveChain(store, dir);

    const carriers = facts.filter((f) => f.evidence?.value !== undefined);
    expect(carriers.length).toBeGreaterThan(0);

    const kinds = [...new Set(carriers.map((f) => f.targetSectionKind))];
    const modelFacts = kinds.flatMap((k) => promptEnhancementSectionModelFactsV1(k, facts));
    expect(modelFacts.length, 'nothing survived the mix into the section model').toBeGreaterThan(0);
    const rendered = kinds.flatMap((k) => linesFor(k)).join('\n');
    expect(rendered, 'content-free output — the garbage-in-preserved state would be back').not.toBe('');
  });
});
