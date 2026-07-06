/**
 * Per-project active-usage tracking that gates the nexpath feedback popup.
 *
 * "Active usage" is accumulated from the gaps between successive hook
 * invocations for a project. A gap longer than IDLE_CAP_MS is treated as an
 * idle break and does not count, so the total reflects time the coding agent
 * was actually working on the project rather than wall-clock elapsed time.
 */

import type { Store } from './db.js';
import { saveStore } from './db.js';

/** Active usage a project must accumulate before the popup is eligible again. */
export const USAGE_THRESHOLD_MS = 2 * 60 * 60 * 1000;   // 2 hours

/** Minimum time that must pass after the popup was last shown before it can reappear. */
export const MIN_GAP_MS = 2 * 24 * 60 * 60 * 1000;      // 2 days

/** Gaps between hook invocations longer than this are treated as idle (not counted). */
export const IDLE_CAP_MS = 5 * 60 * 1000;               // 5 minutes

export interface ProjectUsage {
  activeMs:       number;
  lastActivityAt: number | null;
  lastFeedbackAt: number | null;
}

/** Read a project's usage row, or null if the project has none yet. */
export function readProjectUsage(store: Store, projectRoot: string): ProjectUsage | null {
  const result = store.db.exec(
    'SELECT active_ms, last_activity_at, last_feedback_at FROM project_usage WHERE project_root = ?',
    [projectRoot],
  );
  const row = result[0]?.values[0];
  if (!row) return null;
  return {
    activeMs:       row[0] as number,
    lastActivityAt: (row[1] as number | null) ?? null,
    lastFeedbackAt: (row[2] as number | null) ?? null,
  };
}

/**
 * Record a hook invocation for a project at `now`. Adds the gap since the
 * previous activity to the accumulator when that gap is within IDLE_CAP_MS,
 * then advances last_activity_at. last_feedback_at is preserved.
 */
export function recordActivity(store: Store, projectRoot: string, now: number = Date.now()): void {
  const existing = readProjectUsage(store, projectRoot);
  const prevActivity = existing?.lastActivityAt ?? null;
  const delta = prevActivity !== null ? now - prevActivity : null;
  const add   = delta !== null && delta > 0 && delta <= IDLE_CAP_MS ? delta : 0;
  const newActiveMs = (existing?.activeMs ?? 0) + add;

  store.db.run(
    `INSERT INTO project_usage (project_root, active_ms, last_activity_at, last_feedback_at)
     VALUES (?, ?, ?, NULL)
     ON CONFLICT(project_root) DO UPDATE SET
       active_ms        = excluded.active_ms,
       last_activity_at = excluded.last_activity_at`,
    [projectRoot, newActiveMs, now],
  );
  saveStore(store);
}

/**
 * True when a project has accumulated enough active usage AND enough time has
 * passed since the popup was last shown. A project that has never shown the
 * popup passes the gap condition automatically.
 */
export function isFeedbackEligible(store: Store, projectRoot: string, now: number = Date.now()): boolean {
  const usage = readProjectUsage(store, projectRoot);
  if (!usage) return false;
  if (usage.activeMs < USAGE_THRESHOLD_MS) return false;
  if (usage.lastFeedbackAt === null) return true;
  return now - usage.lastFeedbackAt >= MIN_GAP_MS;
}

/**
 * Mark the popup as shown for a project: reset the usage accumulator and stamp
 * last_feedback_at so the next cycle needs a fresh usage + gap window.
 */
export function markFeedbackShown(store: Store, projectRoot: string, now: number = Date.now()): void {
  store.db.run(
    `INSERT INTO project_usage (project_root, active_ms, last_activity_at, last_feedback_at)
     VALUES (?, 0, NULL, ?)
     ON CONFLICT(project_root) DO UPDATE SET
       active_ms        = 0,
       last_feedback_at = excluded.last_feedback_at`,
    [projectRoot, now],
  );
  saveStore(store);
}
