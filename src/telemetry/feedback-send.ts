/**
 * User-initiated one-shot send of a feedback popup rating.
 *
 * This runs only when the user explicitly picks a rating and sends it. That
 * click is its own consent, so this send is intentionally independent of the
 * telemetry.enabled setting and of the batched telemetry sync — it posts the
 * single event directly. Best-effort: it never throws.
 *
 * The payload carries timestamps only (install time, advisory-fire times,
 * option-select times) plus the rating and installation id. No option text or
 * prompt text is ever included.
 */

import type { Store } from '../store/db.js';
import { getConfig } from '../store/config.js';
import { getInstallationId } from './identity.js';
import { getInstalledAt, readAllSignals, pruneAllSignalsUpTo } from '../store/feedback-signals.js';
import { postEvent, DEFAULT_POSTHOG_ENDPOINT, type FetchLike } from './TelemetryClient.js';
import { POSTHOG_LIB_NAME, POSTHOG_LIB_VERSION } from './TelemetryBatcher.js';
import type { PostHogSingleEnvelope } from './types.js';

export const FEEDBACK_EVENT = 'feedback_submitted';

export interface SendFeedbackOptions {
  fetch?: FetchLike;
  now?:   number;
}

/**
 * Post the feedback rating + timestamp-only payload once. Returns true on a
 * successful post (after which the sent signals are pruned), false otherwise.
 * Never throws.
 */
export async function sendFeedback(
  store:  Store,
  rating: number,
  opts:   SendFeedbackOptions = {},
): Promise<boolean> {
  try {
    const apiKey = getConfig(store.db, 'telemetry_sync_api_key');
    if (!apiKey) return false;   // nothing to authenticate the post with

    const endpoint = getConfig(store.db, 'telemetry_sync_endpoint') ?? DEFAULT_POSTHOG_ENDPOINT;
    const now      = opts.now ?? Date.now();

    const installationId = getInstallationId(store);
    const installedAt    = getInstalledAt(store);
    const { advisoryFireTs, optionSelectTs } = readAllSignals(store);

    const envelope: PostHogSingleEnvelope = {
      api_key:     apiKey,
      event:       FEEDBACK_EVENT,
      distinct_id: installationId,
      timestamp:   new Date(now).toISOString(),
      properties: {
        $lib:             POSTHOG_LIB_NAME,
        $lib_version:     POSTHOG_LIB_VERSION,
        rating,
        installation_id:  installationId,
        installed_at:     installedAt,
        advisory_fire_ts: advisoryFireTs,
        option_select_ts: optionSelectTs,
        feedback_at:      now,
      },
    };

    const result = await postEvent(endpoint, envelope, opts.fetch ? { fetch: opts.fetch } : {});
    if (result.ok) {
      pruneAllSignalsUpTo(store, now);
      return true;
    }
    return false;
  } catch {
    // Best-effort — a send failure must never crash the caller.
    return false;
  }
}
