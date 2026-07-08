/**
 * Flush buffered lifecycle events to PostHog.
 *
 * Sends the one-time install event (guarded so it fires only once) and every
 * buffered advisory-fired signal, backdated to when each occurred. A signal is
 * pruned only after its own send succeeds, so a failed send stays buffered for
 * the next flush and is never lost or double-counted. Best-effort: a send
 * failure never throws.
 *
 * The caller decides how often to flush: immediately at each occurrence when
 * telemetry is on, or once on the feedback consent when telemetry is off.
 * Option-selected signals are intentionally not emitted.
 */

import type { Store } from '../store/db.js';
import {
  getInstalledAt,
  isInstalledEventSent,
  markInstalledEventSent,
  readAllSignals,
  pruneSignalAt,
  SIGNAL_ADVISORY_FIRED,
} from '../store/feedback-signals.js';
import { sendInstalled, sendAdvisoryFired, type SendLifecycleOptions } from './lifecycle-send.js';
import { isTelemetryEnabled } from './telemetry-enabled.js';

export async function flushLifecycle(
  store: Store,
  opts:  SendLifecycleOptions = {},
): Promise<void> {
  // Install event — once. Only mark it sent after a successful post so a failed
  // send is retried on the next flush.
  if (!isInstalledEventSent(store)) {
    const installedAt = getInstalledAt(store);
    if (await sendInstalled(store, installedAt, opts)) {
      markInstalledEventSent(store);
    }
  }

  // Buffered advisory-fired signals — one event each, oldest first. Prune a
  // signal only when its own send succeeds.
  const { advisoryFireTs } = readAllSignals(store);
  for (const ts of advisoryFireTs) {
    if (await sendAdvisoryFired(store, ts, opts)) {
      pruneSignalAt(store, SIGNAL_ADVISORY_FIRED, ts);
    }
  }
}

/**
 * Flush now only when telemetry is on. When it is off the events are left
 * buffered locally for the feedback-consent flush. Used at the occurrence
 * points (install, advisory fire) so on-mode users get immediate sends.
 */
export async function flushIfTelemetryOn(
  store: Store,
  opts:  SendLifecycleOptions = {},
): Promise<void> {
  if (isTelemetryEnabled(store)) {
    await flushLifecycle(store, opts);
  }
}
