/**
 * Rating-popup cadence — the browser port of `src/store/feedback-cadence.ts`.
 *
 * The first group pins the RULES, which belong to the CLI and must not drift:
 * the usage threshold, the idle cap, the minimum gap, first-time eligibility and
 * what `markFeedbackShown` resets. If one of these fails, the port has changed
 * behaviour rather than re-homed it.
 *
 * The second group pins what the port deliberately does DIFFERENTLY, and only
 * because the store is different: a `storage.local` value can be corrupt or
 * unreadable in a way a table the CLI exclusively owns cannot.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  readCadence,
  recordActivity,
  isFeedbackEligible,
  markFeedbackShown,
  USAGE_THRESHOLD_MS,
  MIN_GAP_MS,
  IDLE_CAP_MS,
  KEY_ACTIVE_MS,
  KEY_LAST_ACTIVITY_AT,
  KEY_LAST_SHOWN_AT,
  type RatingCadenceKeyStore,
} from './rating-cadence.js';

/** An in-memory key store with the same contract as ChromeStorageKeyAdapter. */
function makeStore(initial: Record<string, string> = {}): RatingCadenceKeyStore & {
  data: Record<string, string>;
} {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getKey: async (name) => (typeof data[name] === 'string' && data[name].length > 0 ? data[name] : null),
    setKey: async (name, value) => { data[name] = value; },
  };
}

const T0 = 1_700_000_000_000;

describe('the CLI rules, unchanged by the port', () => {
  it('the three thresholds are the CLI values', () => {
    expect(USAGE_THRESHOLD_MS).toBe(2 * 60 * 60 * 1000);   // 2 hours
    expect(MIN_GAP_MS).toBe(2 * 24 * 60 * 60 * 1000);      // 2 days
    expect(IDLE_CAP_MS).toBe(15 * 60 * 1000);              // 15 minutes
  });

  it('the three storage keys are the CLI names — unprefixed, like advisory_frequency and role', () => {
    expect(KEY_ACTIVE_MS).toBe('feedback_active_ms');
    expect(KEY_LAST_ACTIVITY_AT).toBe('feedback_last_activity_at');
    expect(KEY_LAST_SHOWN_AT).toBe('feedback_last_shown_at');
  });

  it('an empty store reads as zero usage and nothing recorded', async () => {
    expect(await readCadence(makeStore())).toEqual({
      activeMs: 0, lastActivityAt: null, lastFeedbackAt: null,
    });
  });

  it('the FIRST invocation banks no time — there is no earlier marker to measure from', async () => {
    const store = makeStore();
    await recordActivity(store, T0);
    expect(await readCadence(store)).toEqual({
      activeMs: 0, lastActivityAt: T0, lastFeedbackAt: null,
    });
  });

  it('a gap WITHIN the idle cap is accumulated', async () => {
    const store = makeStore();
    await recordActivity(store, T0);
    await recordActivity(store, T0 + 5 * 60_000);
    expect((await readCadence(store)).activeMs).toBe(5 * 60_000);
  });

  it('⭐ a gap OVER the idle cap is an idle break — it counts as nothing', async () => {
    const store = makeStore();
    await recordActivity(store, T0);
    await recordActivity(store, T0 + IDLE_CAP_MS + 1);
    const state = await readCadence(store);
    expect(state.activeMs).toBe(0);                       // the break was not banked...
    expect(state.lastActivityAt).toBe(T0 + IDLE_CAP_MS + 1); // ...but the marker still advanced
  });

  it('a gap EXACTLY at the idle cap still counts (the boundary is inclusive)', async () => {
    const store = makeStore();
    await recordActivity(store, T0);
    await recordActivity(store, T0 + IDLE_CAP_MS);
    expect((await readCadence(store)).activeMs).toBe(IDLE_CAP_MS);
  });

  it('accumulates across many invocations', async () => {
    const store = makeStore();
    for (let i = 0; i <= 10; i++) await recordActivity(store, T0 + i * 60_000);
    expect((await readCadence(store)).activeMs).toBe(10 * 60_000);
  });

  it('⭐ not eligible below the usage threshold', async () => {
    const store = makeStore({
      [KEY_ACTIVE_MS]: String(USAGE_THRESHOLD_MS - 60_000),
      [KEY_LAST_ACTIVITY_AT]: String(T0),
    });
    expect(await isFeedbackEligible(store, T0)).toBe(false);
  });

  it('⭐ eligible at the threshold when it has NEVER been shown', async () => {
    const store = makeStore({
      [KEY_ACTIVE_MS]: String(USAGE_THRESHOLD_MS),
      [KEY_LAST_ACTIVITY_AT]: String(T0),
    });
    expect(await isFeedbackEligible(store, T0)).toBe(true);
  });

  it('the live clamp counts the in-progress turn, so the threshold can be crossed in-session', async () => {
    // Banked usage is one minute short; the current turn has been running five.
    const store = makeStore({
      [KEY_ACTIVE_MS]: String(USAGE_THRESHOLD_MS - 60_000),
      [KEY_LAST_ACTIVITY_AT]: String(T0),
    });
    expect(await isFeedbackEligible(store, T0)).toBe(false);
    expect(await isFeedbackEligible(store, T0 + 5 * 60_000)).toBe(true);
  });

  it('the live clamp is itself capped at the idle cap — walking away cannot make it eligible', async () => {
    const store = makeStore({
      [KEY_ACTIVE_MS]: String(USAGE_THRESHOLD_MS - IDLE_CAP_MS - 1),
      [KEY_LAST_ACTIVITY_AT]: String(T0),
    });
    expect(await isFeedbackEligible(store, T0 + 10 * 60 * 60 * 1000)).toBe(false);
  });

  it('⭐ once shown, the minimum gap blocks it even with usage banked', async () => {
    const store = makeStore({
      [KEY_ACTIVE_MS]: String(USAGE_THRESHOLD_MS),
      [KEY_LAST_ACTIVITY_AT]: String(T0),
      [KEY_LAST_SHOWN_AT]: String(T0),
    });
    expect(await isFeedbackEligible(store, T0 + MIN_GAP_MS - 1)).toBe(false);
    expect(await isFeedbackEligible(store, T0 + MIN_GAP_MS)).toBe(true);
  });

  it('⭐ markFeedbackShown resets the accumulator AND the activity marker, and stamps the show', async () => {
    const store = makeStore();
    await recordActivity(store, T0);
    await recordActivity(store, T0 + 10 * 60_000);
    expect((await readCadence(store)).activeMs).toBe(10 * 60_000);

    await markFeedbackShown(store, T0 + 10 * 60_000);

    expect(await readCadence(store)).toEqual({
      activeMs: 0,
      lastActivityAt: T0 + 10 * 60_000,
      lastFeedbackAt: T0 + 10 * 60_000,
    });
  });

  it('resetting the activity marker stops the pre-popup gap leaking into the fresh count', async () => {
    const store = makeStore();
    await recordActivity(store, T0);
    await markFeedbackShown(store, T0);
    // The next heartbeat measures from the RESET marker, not from before the popup.
    await recordActivity(store, T0 + 60_000);
    expect((await readCadence(store)).activeMs).toBe(60_000);
  });
});

describe('what the port does differently, and only because the store is different', () => {
  it('⭐ a corrupt value reads as ABSENT, not as NaN', async () => {
    // NaN would poison the arithmetic: `NaN + tail < THRESHOLD` is false, so a
    // damaged store would report "eligible" — the opposite of fail-closed.
    const store = makeStore({ [KEY_ACTIVE_MS]: 'not-a-number' });
    expect((await readCadence(store)).activeMs).toBe(0);
    expect(await isFeedbackEligible(store, T0)).toBe(false);
  });

  it('a corrupt last-shown stamp does not unlock the popup', async () => {
    const store = makeStore({
      [KEY_ACTIVE_MS]: String(USAGE_THRESHOLD_MS),
      [KEY_LAST_ACTIVITY_AT]: String(T0),
      [KEY_LAST_SHOWN_AT]: 'garbage',
    });
    // Absent last-shown means "never shown", which is the CLI's own rule.
    expect(await isFeedbackEligible(store, T0)).toBe(true);
  });

  it('a clock that moves BACKWARDS banks nothing and cannot go negative', async () => {
    const store = makeStore();
    await recordActivity(store, T0);
    await recordActivity(store, T0 - 60_000);
    expect((await readCadence(store)).activeMs).toBe(0);
  });

  it('a backwards clock cannot make the live clamp negative either', async () => {
    const store = makeStore({
      [KEY_ACTIVE_MS]: String(USAGE_THRESHOLD_MS),
      [KEY_LAST_ACTIVITY_AT]: String(T0 + 60_000),   // marker in the future
    });
    expect(await isFeedbackEligible(store, T0)).toBe(true);   // clamped to 0, not subtracted
  });

  it('⭐ an unreadable store never throws — the pipeline it measures must not break', async () => {
    const broken: RatingCadenceKeyStore = {
      getKey: async () => { throw new Error('storage gone'); },
      setKey: async () => { throw new Error('storage gone'); },
    };
    await expect(recordActivity(broken, T0)).resolves.toBeUndefined();
    await expect(markFeedbackShown(broken, T0)).resolves.toBeUndefined();
    await expect(readCadence(broken)).resolves.toEqual({
      activeMs: 0, lastActivityAt: null, lastFeedbackAt: null,
    });
  });

  it('⭐ an unreadable store fails CLOSED — no popup, rather than a popup on no evidence', async () => {
    const broken: RatingCadenceKeyStore = {
      getKey: async () => { throw new Error('storage gone'); },
      setKey: async () => {},
    };
    expect(await isFeedbackEligible(broken, T0)).toBe(false);
  });

  it('a failed marker write leaves the older marker, which over-counts rather than losing the gap', async () => {
    const data: Record<string, string> = {};
    let failNext = false;
    const store: RatingCadenceKeyStore = {
      getKey: async (n) => (typeof data[n] === 'string' ? data[n] : null),
      setKey: async (n, v) => {
        if (failNext && n === KEY_LAST_ACTIVITY_AT) throw new Error('write failed');
        data[n] = v;
      },
    };
    await recordActivity(store, T0);
    failNext = true;
    await recordActivity(store, T0 + 60_000);     // banks 60s, marker write fails
    failNext = false;
    await recordActivity(store, T0 + 120_000);    // re-measures from T0: banks 120s

    // 60 + 120 — the gap is counted twice. Deliberate: losing the marker would
    // leave every later gap measured from nothing at all.
    expect((await readCadence(store)).activeMs).toBe(180_000);
  });

  it('defaults `now` to the real clock when the caller does not pass one', async () => {
    const store = makeStore();
    vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      await recordActivity(store);
      expect((await readCadence(store)).lastActivityAt).toBe(T0);
    } finally {
      vi.restoreAllMocks();
    }
  });
});
