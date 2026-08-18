import { describe, expect, it } from 'vitest';
import { openStore } from '../store/db.js';
import { upsertProject, getProjectEnvFacts, setProjectEnvFacts } from '../store/index.js';
import { probeProject } from '../env/env-probe.js';
import { recordEnvTrajectory } from '../env/env-trajectory.js';
import { buildPromptEnhancementGroundingRefsV1 } from '../cli/commands/auto.js';
import { mkdtempSync, writeFileSync } from 'node:fs';
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
