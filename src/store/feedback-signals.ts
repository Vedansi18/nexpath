/**
 * Content-free records that back the nexpath feedback popup.
 *
 * Stores only timestamps — the install time, when advisories fired, and when
 * an option was selected. No option text, prompt text, or index is ever
 * recorded here. Writes are unconditional (storing locally is not sending).
 */

import type { Store } from './db.js';
import { saveStore } from './db.js';
import { getConfig, setConfig } from './config.js';

/** Signal kinds stored in the feedback_signals table. */
export const SIGNAL_ADVISORY_FIRED  = 'advisory_fired';
export const SIGNAL_OPTION_SELECTED = 'option_selected';

const INSTALLED_AT_KEY = 'installed_at';

export interface FeedbackSignals {
  /** Timestamps (epoch ms) at which advisories fired, oldest first. */
  advisoryFireTs: number[];
  /** Timestamps (epoch ms) at which an option was selected, oldest first. */
  optionSelectTs: number[];
}

/**
 * Return the install timestamp (epoch ms). If none has been recorded yet
 * (e.g. an install that predates this field), set it to now once and return
 * that value, so the field is never missing going forward.
 */
export function getInstalledAt(store: Store): number {
  const stored = getConfig(store.db, INSTALLED_AT_KEY);
  if (stored !== undefined) return Number(stored);
  const now = Date.now();
  setConfig(store, INSTALLED_AT_KEY, String(now));
  return now;
}

/** Record the install timestamp, but only if one is not already set. */
export function setInstalledAtIfMissing(store: Store, now: number = Date.now()): void {
  if (getConfig(store.db, INSTALLED_AT_KEY) === undefined) {
    setConfig(store, INSTALLED_AT_KEY, String(now));
  }
}

function recordSignal(store: Store, projectRoot: string, kind: string, occurredAt: number): void {
  store.db.run(
    'INSERT INTO feedback_signals (project_root, kind, occurred_at) VALUES (?, ?, ?)',
    [projectRoot, kind, occurredAt],
  );
  saveStore(store);
}

/** Record that an advisory fired for a project. */
export function recordAdvisoryFired(
  store: Store,
  projectRoot: string,
  occurredAt: number = Date.now(),
): void {
  recordSignal(store, projectRoot, SIGNAL_ADVISORY_FIRED, occurredAt);
}

/** Record that an option was selected for a project (timestamp only). */
export function recordOptionSelected(
  store: Store,
  projectRoot: string,
  occurredAt: number = Date.now(),
): void {
  recordSignal(store, projectRoot, SIGNAL_OPTION_SELECTED, occurredAt);
}

/** Read all recorded signals for a project, split by kind, oldest first. */
export function readSignals(store: Store, projectRoot: string): FeedbackSignals {
  const result = store.db.exec(
    `SELECT kind, occurred_at FROM feedback_signals
     WHERE project_root = ?
     ORDER BY occurred_at ASC`,
    [projectRoot],
  );
  const advisoryFireTs: number[] = [];
  const optionSelectTs: number[] = [];
  for (const row of result[0]?.values ?? []) {
    const kind = row[0] as string;
    const ts   = row[1] as number;
    if (kind === SIGNAL_ADVISORY_FIRED)  advisoryFireTs.push(ts);
    else if (kind === SIGNAL_OPTION_SELECTED) optionSelectTs.push(ts);
  }
  return { advisoryFireTs, optionSelectTs };
}

/**
 * Delete a project's signals recorded at or before `ts`. Called after a
 * successful send so the same timestamps are not reported twice.
 */
export function pruneSignalsUpTo(store: Store, projectRoot: string, ts: number): void {
  store.db.run(
    'DELETE FROM feedback_signals WHERE project_root = ? AND occurred_at <= ?',
    [projectRoot, ts],
  );
  saveStore(store);
}

/** Read all recorded signals across every project, split by kind, oldest first. */
export function readAllSignals(store: Store): FeedbackSignals {
  const result = store.db.exec(
    'SELECT kind, occurred_at FROM feedback_signals ORDER BY occurred_at ASC',
  );
  const advisoryFireTs: number[] = [];
  const optionSelectTs: number[] = [];
  for (const row of result[0]?.values ?? []) {
    const kind = row[0] as string;
    const ts   = row[1] as number;
    if (kind === SIGNAL_ADVISORY_FIRED)  advisoryFireTs.push(ts);
    else if (kind === SIGNAL_OPTION_SELECTED) optionSelectTs.push(ts);
  }
  return { advisoryFireTs, optionSelectTs };
}

/** Delete signals across all projects recorded at or before `ts` (after a send). */
export function pruneAllSignalsUpTo(store: Store, ts: number): void {
  store.db.run('DELETE FROM feedback_signals WHERE occurred_at <= ?', [ts]);
  saveStore(store);
}
