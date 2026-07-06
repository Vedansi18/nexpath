import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openStore, closeStore, type Store } from './db.js';
import {
  recordActivity,
  isFeedbackEligible,
  markFeedbackShown,
  readProjectUsage,
  USAGE_THRESHOLD_MS,
  MIN_GAP_MS,
  IDLE_CAP_MS,
} from './project-usage.js';

let store: Store;

beforeEach(async () => { store = await openStore(':memory:'); });
afterEach(() => closeStore(store));

describe('recordActivity', () => {
  it('starts at zero active time on the first invocation', () => {
    recordActivity(store, '/p', 1000);
    const usage = readProjectUsage(store, '/p');
    expect(usage?.activeMs).toBe(0);
    expect(usage?.lastActivityAt).toBe(1000);
  });

  it('adds gaps within the idle cap', () => {
    recordActivity(store, '/p', 1000);
    recordActivity(store, '/p', 1000 + 60_000);
    expect(readProjectUsage(store, '/p')?.activeMs).toBe(60_000);
  });

  it('does not count gaps longer than the idle cap', () => {
    recordActivity(store, '/p', 1000);
    recordActivity(store, '/p', 1000 + IDLE_CAP_MS + 1);
    expect(readProjectUsage(store, '/p')?.activeMs).toBe(0);
  });

  it('tracks projects independently', () => {
    recordActivity(store, '/a', 1000);
    recordActivity(store, '/a', 1000 + 60_000);
    recordActivity(store, '/b', 5000);
    expect(readProjectUsage(store, '/a')?.activeMs).toBe(60_000);
    expect(readProjectUsage(store, '/b')?.activeMs).toBe(0);
  });

  it('ignores non-positive gaps (equal or backward clock)', () => {
    recordActivity(store, '/p', 1000);
    recordActivity(store, '/p', 1000);   // delta 0 → not counted
    recordActivity(store, '/p', 500);    // delta negative → not counted
    const usage = readProjectUsage(store, '/p');
    expect(usage?.activeMs).toBe(0);
    expect(usage?.lastActivityAt).toBe(500);
  });

  it('advances last_activity_at even when the gap is not counted', () => {
    recordActivity(store, '/p', 1000);
    recordActivity(store, '/p', 1000 + IDLE_CAP_MS + 1);
    expect(readProjectUsage(store, '/p')?.lastActivityAt).toBe(1000 + IDLE_CAP_MS + 1);
  });
});

describe('isFeedbackEligible', () => {
  it('is false with no usage row', () => {
    expect(isFeedbackEligible(store, '/p', 1000)).toBe(false);
  });

  it('is false below the usage threshold', () => {
    recordActivity(store, '/p', 0);
    recordActivity(store, '/p', USAGE_THRESHOLD_MS - IDLE_CAP_MS); // gap too large to count fully
    expect(isFeedbackEligible(store, '/p')).toBe(false);
  });

  it('is true once threshold reached and never shown', () => {
    // Accumulate the threshold in idle-cap-sized steps.
    let t = 0;
    while ((readProjectUsage(store, '/p')?.activeMs ?? 0) < USAGE_THRESHOLD_MS) {
      recordActivity(store, '/p', t);
      t += IDLE_CAP_MS;
    }
    expect(isFeedbackEligible(store, '/p', t)).toBe(true);
  });

  it('is true exactly at the usage threshold boundary', () => {
    // THRESHOLD is an exact multiple of IDLE_CAP → land on it precisely.
    expect(USAGE_THRESHOLD_MS % IDLE_CAP_MS).toBe(0);
    const steps = USAGE_THRESHOLD_MS / IDLE_CAP_MS;
    for (let i = 0; i <= steps; i++) recordActivity(store, '/p', i * IDLE_CAP_MS);
    expect(readProjectUsage(store, '/p')?.activeMs).toBe(USAGE_THRESHOLD_MS);
    expect(isFeedbackEligible(store, '/p', steps * IDLE_CAP_MS)).toBe(true);
  });

  it('respects the minimum gap after being shown', () => {
    // Reach threshold, then mark shown at time T.
    let t = 0;
    while ((readProjectUsage(store, '/p')?.activeMs ?? 0) < USAGE_THRESHOLD_MS) {
      recordActivity(store, '/p', t);
      t += IDLE_CAP_MS;
    }
    const shownAt = t;
    markFeedbackShown(store, '/p', shownAt);

    // Re-accumulate usage past the threshold.
    let t2 = shownAt + IDLE_CAP_MS;
    while ((readProjectUsage(store, '/p')?.activeMs ?? 0) < USAGE_THRESHOLD_MS) {
      recordActivity(store, '/p', t2);
      t2 += IDLE_CAP_MS;
    }

    // Usage is back, but not enough calendar time has passed → still ineligible.
    expect(isFeedbackEligible(store, '/p', shownAt + MIN_GAP_MS - 1)).toBe(false);
    // Once the gap elapses → eligible again.
    expect(isFeedbackEligible(store, '/p', shownAt + MIN_GAP_MS)).toBe(true);
  });
});

describe('markFeedbackShown', () => {
  it('resets the accumulator and stamps last_feedback_at', () => {
    recordActivity(store, '/p', 1000);
    recordActivity(store, '/p', 1000 + 60_000);
    markFeedbackShown(store, '/p', 5_000_000);
    const usage = readProjectUsage(store, '/p');
    expect(usage?.activeMs).toBe(0);
    expect(usage?.lastFeedbackAt).toBe(5_000_000);
  });

  it('preserves last_activity_at when a row already exists', () => {
    recordActivity(store, '/p', 1000);
    recordActivity(store, '/p', 1000 + 60_000);
    markFeedbackShown(store, '/p', 5_000_000);
    expect(readProjectUsage(store, '/p')?.lastActivityAt).toBe(1000 + 60_000);
  });

  it('creates a row when the project has no prior usage', () => {
    markFeedbackShown(store, '/fresh', 777);
    const usage = readProjectUsage(store, '/fresh');
    expect(usage).not.toBeNull();
    expect(usage?.activeMs).toBe(0);
    expect(usage?.lastActivityAt).toBeNull();
    expect(usage?.lastFeedbackAt).toBe(777);
  });
});
