import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStateManager, SESSION_GAP_MS } from './SessionStateManager.js';
import { openStore, type Store } from '../store/db.js';
import { getUserDepthLevel, upsertUserDepthLevel } from '../store/user-depth-level.js';
import { SCHEMA_VERSION } from '../store/schema.js';
import { appendParamEvents } from '../telemetry/param-events.js';
import { persistSelection, autogenRefreshPending } from '../decision-session/auto-template-generator.js';
import type { PromptRecord } from './types.js';

// The maturity level is read + updated once per session: at a session boundary
// (inactivity gap) the ended session's observation is folded into the graduation
// state via updateProjectMaturity. In an in-memory store the param-event log is
// not written to disk, so the RIGHT&GOOD profile is empty and the level holds —
// but the fold still runs and persists (updatedAt advances to the boundary time),
// which is what these tests assert. The graduation math itself is covered in
// maturity-level.test.ts.
const HISTORY: PromptRecord[] = [
  { index: 0, text: 'implement the feature module with tests', capturedAt: 1, classifiedStage: 'idea', confidence: 0.5 },
];

describe('maturity graduation — live wiring (updated per session)', () => {
  it('folds a maturity observation at a session boundary (load after an inactivity gap)', async () => {
    const store = await openStore(':memory:');
    const t0 = Date.now();
    // Persist a session; bootstrap also seeds the depth row (lastPromptAt ≈ now).
    SessionStateManager.bootstrapFromHistory(store, '/p', HISTORY, 5);
    expect(getUserDepthLevel(store, '/p')).not.toBeNull();

    // Load after a > SESSION_GAP_MS gap → the ended session's observation is folded
    // and persisted at the load's `now`.
    const loadNow = t0 + SESSION_GAP_MS + 10_000;
    SessionStateManager.load(store, '/p', loadNow);
    expect(getUserDepthLevel(store, '/p')?.updatedAt).toBe(loadNow);
    store.db.close();
  });

  it('does not fold (no maturity write) for a brand-new project with no prior session', async () => {
    const store = await openStore(':memory:');
    SessionStateManager.load(store, '/none', Date.now());
    expect(getUserDepthLevel(store, '/none')).toBeNull(); // no ended session → no fold, no row
    store.db.close();
  });
});

describe('maturity graduation → auto-gen refresh flag (only when a selection exists)', () => {
  // Drive a real −1 down-graduation at the session boundary: a single right_good
  // signal (so overall maturity reads LOW) folded against a seeded high level whose
  // hysteresis counter is one observation from tripping. Needs a file-backed store
  // (the param-event log is file-backed; an in-memory store records nothing).
  function seedGraduatingProject(store: Store, now: number): void {
    const base = { projectRoot: '/p', channel: 'keyword' as const, stage: 'implementation' as const, stageConfidence: null, source: 'live' as const };
    appendParamEvents(store, [
      { ...base, sessionId: 's1', promptIndex: 0, signalKey: 'cross_confirming' },
      { ...base, sessionId: 's1', promptIndex: 1, signalKey: 'cross_confirming' },
      { ...base, sessionId: 's2', promptIndex: 0, signalKey: 'cross_confirming' },
    ]);
    // Seat level 5 with the hysteresis counter one observation from a −1 graduation.
    upsertUserDepthLevel(store, { projectRoot: '/p', currentLevel: 5, stabilityCounter: 0, hysteresisCounter: 4, lastGraduationAt: null, schemaVersion: SCHEMA_VERSION, updatedAt: now });
    SessionStateManager.bootstrapFromHistory(store, '/p', HISTORY, 5); // depth row already exists → the seed is a no-op
  }

  it('does NOT flag a refresh when no selection has been computed (avoids a redundant re-rank after bootstrap)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nx-grad-'));
    const store = await openStore(join(dir, 's.db'));
    const t0 = Date.now();
    seedGraduatingProject(store, t0);
    SessionStateManager.load(store, '/p', t0 + SESSION_GAP_MS + 10_000); // fold → down-graduation
    expect(getUserDepthLevel(store, '/p')?.currentLevel).toBe(4);        // the graduation actually fired
    expect(autogenRefreshPending(store, '/p')).toBe(false);              // no selection → no flag
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('flags a refresh when a selection already exists', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nx-grad-'));
    const store = await openStore(join(dir, 's.db'));
    const t0 = Date.now();
    seedGraduatingProject(store, t0);
    persistSelection(store, '/p', [{ signalType: 'ABSENCE_TEST_CREATION', confidence: 0.9 }]);
    SessionStateManager.load(store, '/p', t0 + SESSION_GAP_MS + 10_000); // fold → down-graduation
    expect(getUserDepthLevel(store, '/p')?.currentLevel).toBe(4);
    expect(autogenRefreshPending(store, '/p')).toBe(true);               // selection exists → flag set
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
