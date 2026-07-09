import { describe, it, expect } from 'vitest';
import { SessionStateManager, SESSION_GAP_MS } from './SessionStateManager.js';
import { openStore } from '../store/db.js';
import { getUserDepthLevel } from '../store/user-depth-level.js';
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
