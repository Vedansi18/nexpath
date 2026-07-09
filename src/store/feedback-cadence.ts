/**
 * Global (machine-wide) usage tracking that gates the nexpath feedback popup.
 *
 * "Active usage" is accumulated from the gaps between successive hook
 * invocations across ALL projects and platforms sharing this store. A gap
 * longer than IDLE_CAP_MS is treated as an idle break and does not count, so
 * the total reflects time the coding agent was actually working rather than
 * wall-clock elapsed time.
 *
 * The popup cadence is global: once shown (on any project or platform), the
 * accumulator resets and the gap timer restarts, so it will not reappear
 * elsewhere until the next usage + gap window is met.
 */

import type { Store } from './db.js';
import { saveStore } from './db.js';
import { getConfig } from './config.js';

/** Active usage that must accumulate before the popup is eligible again. */
export const USAGE_THRESHOLD_MS = 2 * 60 * 60 * 1000;   // 2 hours

/** Minimum time that must pass after the popup was last shown before it can reappear. */
export const MIN_GAP_MS = 2 * 24 * 60 * 60 * 1000;      // 2 days

/** Session idle window: a gap between hook invocations longer than this is treated as an idle break (not counted). */
export const IDLE_CAP_MS = 15 * 60 * 1000;              // 15 minutes

const KEY_ACTIVE_MS        = 'feedback_active_ms';
const KEY_LAST_ACTIVITY_AT = 'feedback_last_activity_at';
const KEY_LAST_SHOWN_AT    = 'feedback_last_shown_at';

export interface CadenceState {
  activeMs:       number;
  lastActivityAt: number | null;
  lastFeedbackAt: number | null;
}

function readNum(store: Store, key: string): number | null {
  const v = getConfig(store.db, key);
  return v === undefined ? null : Number(v);
}

function writeNum(store: Store, key: string, value: number): void {
  store.db.run(
    'INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, String(value)],
  );
}

/** Read the current global cadence state. */
export function readCadence(store: Store): CadenceState {
  return {
    activeMs:       readNum(store, KEY_ACTIVE_MS) ?? 0,
    lastActivityAt: readNum(store, KEY_LAST_ACTIVITY_AT),
    lastFeedbackAt: readNum(store, KEY_LAST_SHOWN_AT),
  };
}

/**
 * Record a hook invocation at `now`. Adds the gap since the previous activity
 * to the global accumulator when that gap is within IDLE_CAP_MS, then advances
 * the last-activity marker.
 */
export function recordActivity(store: Store, now: number = Date.now()): void {
  const state = readCadence(store);
  const delta = state.lastActivityAt !== null ? now - state.lastActivityAt : null;
  const add   = delta !== null && delta > 0 && delta <= IDLE_CAP_MS ? delta : 0;

  writeNum(store, KEY_ACTIVE_MS, state.activeMs + add);
  writeNum(store, KEY_LAST_ACTIVITY_AT, now);
  saveStore(store);
}

/**
 * True when enough global active usage has accumulated AND enough time has
 * passed since the popup was last shown. If it has never been shown, only the
 * usage threshold applies.
 */
export function isFeedbackEligible(store: Store, now: number = Date.now()): boolean {
  const state = readCadence(store);
  // Live clamp: count the in-progress turn (gap since last activity, capped) so the
  // popup can become eligible in the same session that crosses the threshold. Null-safe.
  const tail = state.lastActivityAt === null ? 0 : Math.min(now - state.lastActivityAt, IDLE_CAP_MS);
  if (state.activeMs + tail < USAGE_THRESHOLD_MS) return false;
  if (state.lastFeedbackAt === null) return true;
  return now - state.lastFeedbackAt >= MIN_GAP_MS;
}

/**
 * Mark the popup as shown: reset the global accumulator and the last-activity
 * marker, and stamp the last-shown time so the next cycle needs a fresh usage +
 * gap window. Resetting last-activity prevents the pre-popup gap from leaking
 * into the fresh accumulator on the next heartbeat.
 */
export function markFeedbackShown(store: Store, now: number = Date.now()): void {
  writeNum(store, KEY_ACTIVE_MS, 0);
  writeNum(store, KEY_LAST_ACTIVITY_AT, now);
  writeNum(store, KEY_LAST_SHOWN_AT, now);
  saveStore(store);
}

/**
 * Dev seam (used by `nexpath feedback-test`): prime the cadence so the popup is
 * eligible on the next Stop, without waiting for the real usage window. Sets
 * active usage to the threshold, stamps last-activity to now, and clears the
 * last-shown time so the repeat gate does not block. Not part of the normal flow.
 */
export function primeFeedbackEligible(store: Store, now: number = Date.now()): void {
  writeNum(store, KEY_ACTIVE_MS, USAGE_THRESHOLD_MS);
  writeNum(store, KEY_LAST_ACTIVITY_AT, now);
  store.db.run('DELETE FROM config WHERE key = ?', [KEY_LAST_SHOWN_AT]);
  saveStore(store);
}
