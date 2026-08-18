import { describe, expect, it } from 'vitest';
import { openStore } from '../store/db.js';
import { upsertProject, getProjectEnvFacts, setProjectEnvFacts } from '../store/index.js';
import { probeProject } from '../env/env-probe.js';
import { resolveModeBand, ACTIVE_AGENT_ID } from '../env/agent-capabilities.js';
import { recordEnvTrajectory } from '../env/env-trajectory.js';
import { buildPromptEnhancementGroundingRefsV1 } from '../cli/commands/auto.js';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * HV-1 (dev-plan §14.2) — the check-1/check-2 measurements for rows 1 and 4, pinned.
 *
 * These are MEASUREMENTS, not fixes: §14.3's frame says a failure here is a bug against the owning
 * group and "H patches nothing". They exist so HV-3's verdict table judges the state that actually
 * shipped, and so the gap cannot quietly change — in either direction — before it is judged.
 *
 * The finding: the auto path PROBES the project every session (`recordEnvTrajectory`), and PE still
 * receives zero env facts, because the probe result is written to the trajectory store while PE
 * reads the env-facts store that only `nexpath env` writes.
 */

function sourceFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) out.push(...sourceFilesUnder(full));
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(full);
  }
  return out;
}
const HV1_HELPER = true;

function projectWithATestRunner(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hv1-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', devDependencies: { vitest: '1.0.0' } }));
  return dir;
}

describe('HV-1 row 1 — env-probe crosses the boundary WITH values, when supplied', () => {
  it('stored env facts reach PE as refs carrying resolved values', async () => {
    // Check-2's prior state in §46.3c was "values dropped — keys only". A3 changed that, and this
    // pins the correction rather than leaving the table describing a boundary that no longer exists.
    const store = await openStore(':memory:');
    const dir = projectWithATestRunner();
    upsertProject(store, { projectRoot: dir, name: 'x', projectType: 'app', language: 'ts', description: '', createdAt: Date.now() });
    setProjectEnvFacts(store, dir, probeProject(dir, Date.now()).facts, Date.now());

    const refs = buildPromptEnhancementGroundingRefsV1(store, dir, []);
    expect(refs.sourceOnlyHardFactRefs.length).toBeGreaterThan(0);

    const firstRef = refs.sourceOnlyHardFactRefs[0]!;
    const evidence = refs.groundingEvidenceByRef[firstRef];
    expect(evidence, 'the ref crossed without its resolved payload').toBeDefined();
    expect(evidence?.key).toBeTruthy();
    expect(evidence?.runtimePath).toBeTruthy();
    expect(evidence?.anchorScope).toBeTruthy();
  });
});

describe('HV-1 rows 1+4 — the supply gap, pinned as measured', () => {
  it('the auto-path probe does NOT populate the store PE reads', async () => {
    // recordEnvTrajectory probes the project (env-trajectory.ts:82) — the same probe row 1 needs —
    // and writes setEnvTrajectory, a different store key from the setProjectEnvFacts PE reads.
    const store = await openStore(':memory:');
    const dir = projectWithATestRunner();
    upsertProject(store, { projectRoot: dir, name: 'x', projectType: 'app', language: 'ts', description: '', createdAt: Date.now() });

    recordEnvTrajectory(store, dir, {
      sessionId: 's', promptIndex: 0, stage: 'implementation', stageConfidence: 0.9,
    });

    expect(
      getProjectEnvFacts(store, dir),
      'if this is non-null the supply gap has been closed — update HV-1 and HV-3 rather than this line',
    ).toBeNull();
    expect(buildPromptEnhancementGroundingRefsV1(store, dir, []).sourceOnlyHardFactRefs).toEqual([]);
  });

  it('the same project WOULD supply ten facts if the probe were stored', async () => {
    // The contrast is the point: nothing is broken in the probe or the boundary. One store write
    // is missing, and this pins that the capability is otherwise whole.
    const dir = projectWithATestRunner();
    expect(Object.keys(probeProject(dir, Date.now()).facts).length).toBeGreaterThanOrEqual(10);
  });
});

describe('HV-1 row 1 — check-1 is about RUNNING, not existing', () => {
  // §46.3b: "the capability slots taught us 'exists' != 'runs'". §46.3c lists three consumers for
  // env-probe, and one of them — the DS `auto-template-generator` — holds its probe inside
  // `runAutogenForFire`, which has NO caller in source. The module IS imported by
  // SessionStateManager, for two unrelated functions, so an import-level check would have called
  // this consumer live. Only a CALLER check finds it.
  //
  // Pinned because a caller reappearing would change row 1's measured content, and the row should
  // be re-judged rather than left describing a state that moved.
  it('runAutogenForFire has no production caller — the DS probe consumer is dead', () => {
    const callers = sourceFilesUnder('src')
      .filter((file) => !file.endsWith('auto-template-generator.ts'))
      .filter((file) => readFileSync(file, 'utf8').includes('runAutogenForFire'));
    expect(
      callers,
      'a production caller appeared — row 1 of §17.4 must be re-measured, not this line relaxed',
    ).toEqual([]);
  });

  it('but the module IS imported elsewhere — which is why an import check would have missed it', () => {
    const importers = sourceFilesUnder('src')
      .filter((file) => !file.endsWith('auto-template-generator.ts'))
      .filter((file) => readFileSync(file, 'utf8').includes('auto-template-generator.js'));
    expect(importers.length).toBeGreaterThan(0);
  });
});

describe('HV-1 row 4 — the trajectory state is WRITE-ONLY, and its listed consumer is wrong', () => {
  // Round 3 applied round 2's caller-check to rows 4 and 5. Row 5's listed consumers are genuinely
  // live. Row 4's are not: §46.3c lists `trajectory-credit`, which imports nothing from
  // env-trajectory — its only export takes ParamEvent[] and its one production caller is
  // right-good-aggregator. So the module probes the project every session, writes its state, and
  // NOTHING reads that state.
  //
  // Pinned because HV-3 will judge whether this is a defect or dead weight, and it should judge the
  // state that actually shipped rather than a table entry that was never true.
  it('no production module reads the env-trajectory state', () => {
    const readers = sourceFilesUnder('src')
      // Exclude the two modules that DEFINE the state: env-trajectory writes it, and
      // store/env-facts.ts declares the accessor and the type. A consumer is a third party
      // that READS it — my first version counted the definition and failed on itself.
      .filter((file) => !file.endsWith('env-trajectory.ts') && !file.endsWith('store/env-facts.ts'))
      .filter((file) => {
        const text = readFileSync(file, 'utf8');
        return text.includes('getEnvTrajectory') || text.includes('EnvTrajectoryState');
      });
    expect(
      readers,
      'a reader appeared — row 4 of §17.4 must be re-measured, not this line relaxed',
    ).toEqual([]);
  });

  it('trajectory-credit does not consume env-trajectory — the listed consumer is wrong', () => {
    const text = readFileSync('src/classifier/trajectory-credit.ts', 'utf8');
    expect(text).not.toContain("from './env-trajectory.js'");
    expect(text).not.toContain('../env/env-trajectory.js');
  });
});

describe('HV-1 row 1 — the consumer list is wrong in BOTH directions', () => {
  // Round 2 applied the caller-check downward and found a LISTED consumer that is dead
  // (`runAutogenForFire`). Round 4 applies it upward: is the list COMPLETE? It is not.
  // §46.3c names three consumers for env-probe (runtime-context · cli/env · DS autogen).
  // `engine-option-generator` is a fourth, it is live, and it is the one that matters most:
  // it feeds `promoteEnvFactsToTierP` — row 3's tier-promotion machinery, the plan's own
  // "🔴 standout". HV-2 writes row 3's row, and it should start from the true consumer set
  // rather than from a list that was never complete.
  it('engine-option-generator consumes env-probe and feeds the row-3 promotion', () => {
    const text = readFileSync('src/decision-session/engine-option-generator.ts', 'utf8');
    expect(text).toContain("from '../env/env-probe.js'");
    expect(text, 'the probe no longer feeds tier promotion — re-measure rows 1 and 3').toContain(
      'promoteEnvFactsToTierP(probeProject(',
    );
  });

  it('and it is reachable — composeDeterministicOptions has a production caller', () => {
    const callers = sourceFilesUnder('src')
      .filter((file) => !file.endsWith('engine-option-generator.ts'))
      .filter((file) => /composeDeterministicOptions\s*\(/.test(readFileSync(file, 'utf8')));
    expect(callers, 'this consumer went dead — row 1 must be re-measured').not.toEqual([]);
  });
});

describe('HV-1 row 5 — the two agent-self fields are ONE upstream signal', () => {
  // My round-1 row-5 cell cited `currentAgentMode` (auto.ts:440) and `permissionMode`
  // (auto.ts:513) as the evidence that PE already receives agent-about-itself context. Both are
  // assigned from the same expression, and that expression is itself the hook's `permission_mode`
  // (auto.ts:629). So PE receives one signal under two names, not two signals.
  //
  // The surfaced decision is unaffected — if anything the "new category" reading is stronger,
  // because capability facts (bands, registry, versions) would be the FIRST genuinely distinct
  // agent-self input. Pinned so the row's evidence line cannot silently become true or falser.
  it('both PE-facing fields are fed from the same auto input', () => {
    const text = readFileSync('src/cli/commands/auto.ts', 'utf8');
    expect(text).toContain("currentAgentMode: input.auto.currentAgentMode ?? 'unknown'");
    expect(text).toContain("permissionMode: input.auto.currentAgentMode ?? 'unknown'");
  });

  it('and that input is the hook permission_mode, so resolveModeBand is correctly fed', () => {
    const text = readFileSync('src/cli/commands/auto.ts', 'utf8');
    expect(text).toContain('typeof payload.permission_mode === \'string\' ? payload.permission_mode');
    // The registry keys ARE Claude Code's permission_mode values, which is why the naming
    // mismatch is not a behavioural defect: the band lookup resolves.
    expect(resolveModeBand(ACTIVE_AGENT_ID, 'plan')).toBe('plan');
    expect(resolveModeBand(ACTIVE_AGENT_ID, 'bypassPermissions')).toBe('execute');
    expect(resolveModeBand(ACTIVE_AGENT_ID, 'not_a_real_mode')).toBeUndefined();
  });
});

describe('HV-1 row 4 — step 2 asked WHICH auto path, and the answer is the PE one', () => {
  // §14.2 step 2: "measure WHICH `auto.ts` path consumes it". A line number is not a path, and
  // auto.ts has fifteen top-level exports. The consuming path is `runAuto` — and `runAuto` is the
  // SAME function that builds the PE request. So it is not two unrelated paths that happen to
  // miss each other: ONE function probes the project TWICE (buildRuntimeContext for row 1,
  // recordEnvTrajectory for row 4) and PE still receives zero env facts, because neither probe
  // lands in the store PE reads.
  function bodyOfRunAuto(): string {
    const text = readFileSync('src/cli/commands/auto.ts', 'utf8');
    const start = text.indexOf('export async function runAuto(');
    expect(start, 'runAuto was renamed — row 4 names it as the consuming path').toBeGreaterThan(-1);
    const next = text.indexOf('\nexport ', start + 1);
    return text.slice(start, next === -1 ? undefined : next);
  }

  it('runAuto is the auto path that consumes env-trajectory', () => {
    expect(bodyOfRunAuto()).toContain('recordEnvTrajectory(store, input.projectRoot,');
  });

  it('and the same path probes again for PE and builds the PE request', () => {
    const body = bodyOfRunAuto();
    expect(body, 'row 1 probe left runAuto — re-measure which path probes').toContain('buildRuntimeContext(');
    expect(body, 'the PE request left runAuto — the double-probe finding must be re-measured').toContain(
      'buildPromptEnhancementRequestForAuto({',
    );
  });
});

describe('HV-1 row 5 — task-mode-fit consumes the TYPE, not the runtime', () => {
  // My row-5 cell said resolveModeBand runs "in agent-mode-mismatch / task-mode-fit". It does not
  // run in task-mode-fit: that module imports only the ModeBand TYPE (erased at runtime) and
  // resolves its own band from a static per-stage table. agent-capabilities has exactly ONE
  // runtime consumer. The two meet inside agent-mode-mismatch, which calls both.
  it('task-mode-fit never calls resolveModeBand and imports the type only', () => {
    const text = readFileSync('src/classifier/task-mode-fit.ts', 'utf8');
    expect(text).not.toContain('resolveModeBand');
    expect(text).toContain("import type { ModeBand } from '../env/agent-capabilities.js'");
  });

  it('resolveModeBand has exactly one production caller', () => {
    const callers = sourceFilesUnder('src')
      .filter((file) => !file.endsWith('agent-capabilities.ts'))
      .filter((file) => /resolveModeBand\s*\(/.test(readFileSync(file, 'utf8')));
    expect(callers).toEqual(['src/classifier/agent-mode-mismatch.ts']);
  });

  it('and that caller is where the runtime band and the static band meet', () => {
    const text = readFileSync('src/classifier/agent-mode-mismatch.ts', 'utf8');
    expect(text).toContain('resolveModeBand(ACTIVE_AGENT_ID');
    expect(text).toContain('recommendedModeBandForStage(stage)');
  });
});

describe('HV-1 row 1 — the recorded COUNT and the word "each", pinned exactly', () => {
  // Row 1's cell says the boundary emits "10 refs each carrying {key,value,runtimePath,anchorScope}".
  // The round-1 fixture only asserted `length > 0` and inspected refs[0] — it could not have caught
  // a wrong count, nor a payload that most refs lack. Rounds 4 and 5 found two of my own recorded
  // claims wrong by checking them literally; this checks the quantitative one the same way.
  it('every ref carries a complete payload, and the count is the recorded one', async () => {
    const store = await openStore(':memory:');
    const dir = projectWithATestRunner();
    upsertProject(store, { projectRoot: dir, name: 'x', projectType: 'app', language: 'ts', description: '', createdAt: Date.now() });
    setProjectEnvFacts(store, dir, probeProject(dir, Date.now()).facts, Date.now());

    const refs = buildPromptEnhancementGroundingRefsV1(store, dir, []);
    const withoutPayload = refs.sourceOnlyHardFactRefs.filter((ref) => {
      const e = refs.groundingEvidenceByRef[ref];
      return !e || !e.key || !e.runtimePath || !e.anchorScope;
    });
    expect(withoutPayload, 'a ref crossed without its resolved payload — "each carrying" is false').toEqual([]);
    expect(
      refs.sourceOnlyHardFactRefs.length,
      'the ref count moved off the recorded 10 — update row 1 rather than this number',
    ).toBe(10);
  });
});

describe('HV-1 row 5 — what "partially live" means, measured per export', () => {
  // §14.2 step 3 says to measure the partially-live claim. Per export: ACTIVE_AGENT_ID is live in
  // two places, resolveModeBand in one, and AGENT_CAPABILITIES is read ONLY from inside
  // resolveModeBand — no external production consumer, and its `version` field is read nowhere.
  // So the capability DATA the wire decision is about is reachable today through exactly one band
  // lookup. That is the precise sense in which the module is partially live, and it is why wiring
  // capability facts would expose something PE has no access to at all today.
  it('AGENT_CAPABILITIES has no production consumer outside its own module', () => {
    const consumers = sourceFilesUnder('src')
      .filter((file) => !file.endsWith('agent-capabilities.ts'))
      .filter((file) => readFileSync(file, 'utf8').includes('AGENT_CAPABILITIES'));
    expect(consumers).toEqual([]);
  });

  it('the registry version field is read nowhere in production', () => {
    const readers = sourceFilesUnder('src').filter((file) => {
      const text = readFileSync(file, 'utf8');
      return /AGENT_CAPABILITIES\[[^\]]*\]\??\.version|capabilities\.version/.test(text);
    });
    expect(readers, 'a version reader appeared — row 5 must be re-measured').toEqual([]);
  });

  it('ACTIVE_AGENT_ID is live in exactly the two measured places', () => {
    const consumers = sourceFilesUnder('src')
      .filter((file) => !file.endsWith('agent-capabilities.ts'))
      .filter((file) => readFileSync(file, 'utf8').includes('ACTIVE_AGENT_ID'));
    expect(consumers.sort()).toEqual([
      'src/classifier/agent-mode-mismatch.ts',
      'src/cli/commands/auto.ts',
    ]);
  });
});

describe('HV-1 round 7 — two production files are invisible to text grep', () => {
  // Found while re-checking row 4's claims: `grep` reports right-good-aggregator.ts as a BINARY
  // file. Both it and telemetry/variant-effect.ts embed a RAW NUL byte as a composite-key
  // separator (`${sessionId}\x00${promptIndex}`) instead of the `\u0000` escape. Runtime-identical,
  // but grep/rg skip such files by default — and THIS PHASE'S ENTIRE METHOD is consumer sweeps by
  // grep. Every shell sweep in rounds 2-6 had a two-file blind spot.
  //
  // Re-run NUL-safe, none of the phase's symbols appear in either file, so no phase-32 conclusion
  // changes. It matters for HV-2: `right-good-aggregator` is ROW 7 of the eleven modules HV-2 must
  // sweep, so a grep-based sweep there would silently under-report its own row.
  //
  // These fixtures read with readFileSync, which is NUL-safe — which is why the fixtures were sound
  // while the shell reasoning was not. ⛔ Not patched: §14.3 says H patches nothing, and the escape
  // change is another group's source.
  function filesContainingNul(): string[] {
    return sourceFilesUnder('src').filter((file) => readFileSync(file, 'utf8').includes('\u0000'));
  }

  it('the NUL-carrying set is exactly the two known files', () => {
    expect(
      filesContainingNul().sort(),
      'the grep-invisible set changed — HV-2 must re-check which modules its sweep can see',
    ).toEqual([
      'src/classifier/right-good-aggregator.ts',
      'src/telemetry/variant-effect.ts',
    ]);
  });

  it('and none of this phase\'s symbols live in them, so the measurements stand', () => {
    const SYMBOLS = [
      'getEnvTrajectory', 'EnvTrajectoryState', 'runAutogenForFire', 'probeProject',
      'setProjectEnvFacts', 'resolveModeBand', 'ACTIVE_AGENT_ID', 'AGENT_CAPABILITIES',
      'composeDeterministicOptions', 'recordEnvTrajectory',
    ];
    const found = filesContainingNul().flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return SYMBOLS.filter((sym) => text.includes(sym)).map((sym) => `${file}:${sym}`);
    });
    expect(found, 'a phase-32 symbol hides in a grep-invisible file — re-measure that row').toEqual([]);
  });
});

describe('HV-1 row 4 — trajectory-credit has FOUR exports, not one', () => {
  // Round 3 recorded "its only export takes ParamEvent[]" as the reason it cannot consume
  // env-trajectory. The conclusion holds, but the stated fact does not: there are four exports.
  // The argument that survives is the one this pins — none of them touches env-trajectory.
  it('all four exports are present and none references env-trajectory', () => {
    const text = readFileSync('src/classifier/trajectory-credit.ts', 'utf8');
    for (const name of ['MOVEMENT_CREDIT', 'MOVEMENT_CREDIT_MAP', 'MovementExtraction', 'extractMovementCredits']) {
      expect(text, `export ${name} disappeared — re-measure row 4`).toContain(name);
    }
    expect(text).not.toContain('EnvTrajectory');
    expect(text).not.toContain('recordEnvTrajectory');
  });

  it('extractMovementCredits is called from right-good-aggregator, read NUL-safely', () => {
    // The caller lives in one of the grep-invisible files, so this must be read, not grepped.
    const text = readFileSync('src/classifier/right-good-aggregator.ts', 'utf8');
    expect(text).toContain('extractMovementCredits(applyWindow(events, opts))');
  });
});
