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

/**
 * NF Plan B — content-free per-action signal kinds captured in the SAME feedback_signals table
 * (project_root, kind, occurred_at). The kind is a fixed UI-action enum; NO prompt/option text or index
 * is ever stored. Buffered locally always; flushed to PostHog only on the feedback-consent click.
 */
export const ACTION_SIGNAL_KINDS = [
  'pe_use_current', 'pe_use_original', 'pe_shorter', 'pe_more_thorough',
  'pe_more_project_grounded', 'pe_apply_details', 'pe_back', 'pe_close',
  'mps_send', 'mps_cancel', 'mps_decline', 'mps_interruption', 'mps_apply_details',
] as const;
export type PromptActionSignalKind = typeof ACTION_SIGNAL_KINDS[number];

const INSTALLED_AT_KEY = 'installed_at';
const INSTALLED_EVENT_SENT_KEY = 'installed_event_sent';

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

/** True once the install event has been successfully sent (so it fires only once). */
export function isInstalledEventSent(store: Store): boolean {
  return getConfig(store.db, INSTALLED_EVENT_SENT_KEY) === 'true';
}

/** Mark the install event as sent so it is not emitted again. */
export function markInstalledEventSent(store: Store): void {
  setConfig(store, INSTALLED_EVENT_SENT_KEY, 'true');
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

/**
 * NF Plan B — record a content-free per-action signal (kind + timestamp only) in the shared
 * feedback_signals table. Writes are unconditional (storing locally is not sending).
 */
export function recordActionSignal(
  store: Store,
  projectRoot: string,
  kind: PromptActionSignalKind,
  occurredAt: number = Date.now(),
): void {
  recordSignal(store, projectRoot, kind, occurredAt);
}

/** Read all buffered per-action signals across every project (kind + timestamp), oldest first. */
export function readAllActionSignals(store: Store): { kind: string; occurredAt: number }[] {
  const actionKinds = new Set<string>(ACTION_SIGNAL_KINDS);
  const result = store.db.exec(
    'SELECT kind, occurred_at FROM feedback_signals ORDER BY occurred_at ASC',
  );
  const out: { kind: string; occurredAt: number }[] = [];
  for (const row of result[0]?.values ?? []) {
    const kind = row[0] as string;
    if (actionKinds.has(kind)) out.push({ kind, occurredAt: row[1] as number });
  }
  return out;
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

/**
 * Delete only the signals matching an exact (kind, occurred_at) pair. Used to
 * remove a single signal after it has been successfully sent, without touching
 * any other buffered — possibly unsent — signals.
 */
export function pruneSignalAt(store: Store, kind: string, occurredAt: number): void {
  store.db.run(
    'DELETE FROM feedback_signals WHERE kind = ? AND occurred_at = ?',
    [kind, occurredAt],
  );
  saveStore(store);
}

/** Delete every signal of a given kind across all projects. */
export function pruneSignalsOfKind(store: Store, kind: string): void {
  store.db.run('DELETE FROM feedback_signals WHERE kind = ?', [kind]);
  saveStore(store);
}
