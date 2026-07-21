import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, type Store } from '../store/db.js';
import { upsertProject } from '../store/projects.js';
import { setConfig } from '../store/config.js';
import { getEnvTrajectory, setEnvTrajectory, ENV_PROBE_ENABLED_KEY } from '../store/env-facts.js';
import type { FactMap, FactValue } from './types.js';
import { confirmedEnvChanges, recordEnvTrajectory } from './env-trajectory.js';

function fm(obj: Record<string, FactValue>): FactMap {
  const out: FactMap = {};
  for (const [k, value] of Object.entries(obj)) out[k] = { value, tier: 'C', confidence: 'high', detectedAt: 0 };
  return out;
}

// ── S4 flap-damping core (pure) ──────────────────────────────────────────────

describe('confirmedEnvChanges — S4 flap damping', () => {
  it('skips a first observation (no prior baseline value)', () => {
    expect(confirmedEnvChanges(fm({ has_version_control: true }), fm({}), fm({}))).toEqual([]);
  });

  it('skips an unchanged fact', () => {
    const cur = fm({ has_version_control: true });
    expect(confirmedEnvChanges(cur, fm({ has_version_control: true }), cur)).toEqual([]);
  });

  it('does NOT confirm a change that is not yet stable across two probes', () => {
    // baseline=false, previous probe=false, current=true → only one probe shows the new value
    expect(confirmedEnvChanges(
      fm({ has_version_control: true }),
      fm({ has_version_control: false }),
      fm({ has_version_control: false }),
    )).toEqual([]);
  });

  it('confirms a change once stable across two consecutive probes (acquired)', () => {
    const changes = confirmedEnvChanges(
      fm({ has_version_control: true }),
      fm({ has_version_control: false }),
      fm({ has_version_control: true }), // previous probe already showed true
    );
    expect(changes).toEqual([{ key: 'has_version_control', old: false, new: true, direction: 'acquired' }]);
  });

  it('labels a lost boolean and a changed nominal value', () => {
    expect(confirmedEnvChanges(fm({ has_ci_pipeline: false }), fm({ has_ci_pipeline: true }), fm({ has_ci_pipeline: false })))
      .toEqual([{ key: 'has_ci_pipeline', old: true, new: false, direction: 'lost' }]);
    expect(confirmedEnvChanges(fm({ project_framework: 'remix' }), fm({ project_framework: 'nextjs' }), fm({ project_framework: 'remix' })))
      .toEqual([{ key: 'project_framework', old: 'nextjs', new: 'remix', direction: 'changed' }]);
  });

  it('never treats a move to UNKNOWN (null) as a change', () => {
    expect(confirmedEnvChanges(fm({ has_version_control: null }), fm({ has_version_control: true }), fm({ has_version_control: null }))).toEqual([]);
  });
});

// ── Store round-trip + consent gate ──────────────────────────────────────────

const ROOT = '/test/traj';
async function storeWithProject(): Promise<Store> {
  const store = await openStore(':memory:');
  upsertProject(store, { projectRoot: ROOT, name: 'proj' });
  return store;
}

describe('env-trajectory — storage', () => {
  it('round-trips the trajectory state and is consent-gated on read', async () => {
    const store = await storeWithProject();
    const state = { baseline: fm({ has_version_control: false }), pending: fm({ has_version_control: true }) };
    setEnvTrajectory(store, ROOT, state);
    expect(getEnvTrajectory(store, ROOT)).toEqual(state);
    setConfig(store, ENV_PROBE_ENABLED_KEY, 'false');
    expect(getEnvTrajectory(store, ROOT)).toBeNull(); // read gated off while consent disabled
    store.db.close();
  });

  it('recordEnvTrajectory is a no-op when consent is off', async () => {
    const store = await storeWithProject();
    setConfig(store, ENV_PROBE_ENABLED_KEY, 'false');
    const changes = recordEnvTrajectory(store, ROOT, { sessionId: 's', promptIndex: 0, stage: 'idea', stageConfidence: 0 });
    expect(changes).toEqual([]);
    expect(getEnvTrajectory(store, ROOT)).toBeNull();
    store.db.close();
  });
});

// ── End-to-end via a real probe: acquire version control across sessions ─────

describe('recordEnvTrajectory — end-to-end (S4 over real probes)', () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

  it('confirms an "acquired" change only after the new value is stable across two probes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nexpath-traj-'));
    dirs.push(root);
    const store = await openStore(':memory:');
    upsertProject(store, { projectRoot: root, name: 'proj' });
    const session = { sessionId: 's', promptIndex: 0, stage: 'idea' as const, stageConfidence: 0.8 };

    // Session 1 — no version control yet: pure initialization, no event.
    expect(recordEnvTrajectory(store, root, session)).toEqual([]);

    // Version control is added.
    mkdirSync(join(root, '.git'), { recursive: true });

    // Session 2 — first probe showing the new value: not yet stable, no event.
    expect(recordEnvTrajectory(store, root, session)).toEqual([]);

    // Session 3 — stable across two probes: the acquisition is confirmed.
    const changes = recordEnvTrajectory(store, root, session);
    expect(changes.some((c) => c.key === 'has_version_control' && c.direction === 'acquired')).toBe(true);

    // And it does not re-fire once the baseline has caught up.
    expect(recordEnvTrajectory(store, root, session).some((c) => c.key === 'has_version_control')).toBe(false);
    store.db.close();
  });
});
