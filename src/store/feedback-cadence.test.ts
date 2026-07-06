import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openStore, closeStore, type Store } from './db.js';
import {
  recordActivity,
  isFeedbackEligible,
  markFeedbackShown,
  readCadence,
  USAGE_THRESHOLD_MS,
  MIN_GAP_MS,
  IDLE_CAP_MS,
} from './feedback-cadence.js';

let store: Store;

beforeEach(async () => { store = await openStore(':memory:'); });
afterEach(() => closeStore(store));

describe('readCadence', () => {
  it('defaults to zero / null on a fresh store', () => {
    expect(readCadence(store)).toEqual({ activeMs: 0, lastActivityAt: null, lastFeedbackAt: null });
  });

  it('returns numbers, not the stored strings', () => {
    recordActivity(store, 1000);
    const state = readCadence(store);
    expect(typeof state.activeMs).toBe('number');
    expect(typeof state.lastActivityAt).toBe('number');
  });
});

describe('recordActivity', () => {
  it('starts at zero active time on the first invocation', () => {
    recordActivity(store, 1000);
    const state = readCadence(store);
    expect(state.activeMs).toBe(0);
    expect(state.lastActivityAt).toBe(1000);
  });

  it('adds gaps within the idle cap', () => {
    recordActivity(store, 1000);
    recordActivity(store, 1000 + 60_000);
    expect(readCadence(store).activeMs).toBe(60_000);
  });

  it('does not count gaps longer than the idle cap', () => {
    recordActivity(store, 1000);
    recordActivity(store, 1000 + IDLE_CAP_MS + 1);
    expect(readCadence(store).activeMs).toBe(0);
  });

  it('ignores non-positive gaps (equal or backward clock)', () => {
    recordActivity(store, 1000);
    recordActivity(store, 1000);   // delta 0 → not counted
    recordActivity(store, 500);    // delta negative → not counted
    const state = readCadence(store);
    expect(state.activeMs).toBe(0);
    expect(state.lastActivityAt).toBe(500);
  });

  it('advances last_activity even when the gap is not counted', () => {
    recordActivity(store, 1000);
    recordActivity(store, 1000 + IDLE_CAP_MS + 1);
    expect(readCadence(store).lastActivityAt).toBe(1000 + IDLE_CAP_MS + 1);
  });

  it('accumulates globally regardless of which project drove the activity', () => {
    // No project parameter exists — every call feeds the one global counter.
    recordActivity(store, 0);
    recordActivity(store, IDLE_CAP_MS);       // +cap
    recordActivity(store, 2 * IDLE_CAP_MS);   // +cap
    expect(readCadence(store).activeMs).toBe(2 * IDLE_CAP_MS);
  });
});

describe('isFeedbackEligible', () => {
  it('is false with no usage yet', () => {
    expect(isFeedbackEligible(store, 1000)).toBe(false);
  });

  it('is false below the usage threshold', () => {
    recordActivity(store, 0);
    recordActivity(store, IDLE_CAP_MS);
    expect(isFeedbackEligible(store)).toBe(false);
  });

  it('is true once threshold reached and never shown', () => {
    let t = 0;
    while (readCadence(store).activeMs < USAGE_THRESHOLD_MS) {
      recordActivity(store, t);
      t += IDLE_CAP_MS;
    }
    expect(isFeedbackEligible(store, t)).toBe(true);
  });

  it('is true exactly at the usage threshold boundary', () => {
    expect(USAGE_THRESHOLD_MS % IDLE_CAP_MS).toBe(0);
    const steps = USAGE_THRESHOLD_MS / IDLE_CAP_MS;
    for (let i = 0; i <= steps; i++) recordActivity(store, i * IDLE_CAP_MS);
    expect(readCadence(store).activeMs).toBe(USAGE_THRESHOLD_MS);
    expect(isFeedbackEligible(store, steps * IDLE_CAP_MS)).toBe(true);
  });

  it('respects the minimum gap after being shown', () => {
    let t = 0;
    while (readCadence(store).activeMs < USAGE_THRESHOLD_MS) {
      recordActivity(store, t);
      t += IDLE_CAP_MS;
    }
    const shownAt = t;
    markFeedbackShown(store, shownAt);

    let t2 = shownAt + IDLE_CAP_MS;
    while (readCadence(store).activeMs < USAGE_THRESHOLD_MS) {
      recordActivity(store, t2);
      t2 += IDLE_CAP_MS;
    }
    expect(isFeedbackEligible(store, shownAt + MIN_GAP_MS - 1)).toBe(false);
    expect(isFeedbackEligible(store, shownAt + MIN_GAP_MS)).toBe(true);
  });
});

describe('markFeedbackShown', () => {
  it('resets the accumulator and stamps last-shown', () => {
    recordActivity(store, 1000);
    recordActivity(store, 1000 + 60_000);
    markFeedbackShown(store, 5_000_000);
    const state = readCadence(store);
    expect(state.activeMs).toBe(0);
    expect(state.lastFeedbackAt).toBe(5_000_000);
  });

  it('leaves last_activity intact and resumes accumulation afterwards', () => {
    recordActivity(store, 1000);
    recordActivity(store, 61_000);        // activeMs 60_000, lastActivity 61_000
    markFeedbackShown(store, 61_000);     // reset activeMs, stamp shown
    expect(readCadence(store).lastActivityAt).toBe(61_000);
    recordActivity(store, 61_000 + 30_000); // delta 30_000 within cap
    expect(readCadence(store).activeMs).toBe(30_000);
  });
});

describe('persistence across reopen (real DB file)', () => {
  it('global usage survives close/reopen and keeps accumulating', async () => {
    const dbPath = join(tmpdir(), `nexpath-cadence-${randomUUID()}.db`);
    try {
      let s = await openStore(dbPath);
      recordActivity(s, 1_000_000);         // sets last_activity, activeMs 0
      closeStore(s);

      // Each real Stop hook opens a fresh store — the accumulator must persist.
      s = await openStore(dbPath);
      recordActivity(s, 1_000_000 + 60_000); // delta uses persisted last_activity
      expect(readCadence(s).activeMs).toBe(60_000);
      closeStore(s);
    } finally {
      rmSync(dbPath, { force: true });
      rmSync(`${dbPath}.lock`, { force: true });
    }
  });
});
