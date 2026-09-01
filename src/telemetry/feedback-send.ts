/**
 * User-initiated one-shot send of a feedback popup rating.
 *
 * This runs only when the user explicitly picks a rating and sends it. That
 * click is its own consent, so this send is intentionally independent of the
 * telemetry.enabled setting and of the batched telemetry sync — it posts the
 * single event directly. Best-effort: it never throws.
 *
 * The payload is lean: the rating, a feedback timestamp, and the installation
 * id. Install and advisory context are their own lifecycle events (see
 * lifecycle-send / lifecycle-flush), not properties here. No option text or
 * prompt text is ever included.
 */

import type { Store } from '../store/db.js';
import { getConfig } from '../store/config.js';
import { getInstallationId } from './identity.js';
import { postEvent, DEFAULT_POSTHOG_ENDPOINT, type FetchLike } from './TelemetryClient.js';
import { POSTHOG_LIB_NAME, POSTHOG_LIB_VERSION } from './TelemetryBatcher.js';
import type { PostHogSingleEnvelope } from './types.js';

export const FEEDBACK_EVENT = 'feedback_submitted';

/**
 * The popup was shown and the user closed it without answering.
 *
 * Without this, "asked and declined" and "never asked" are the same absence in
 * the data, so the rating has no denominator of its own — `nexpath_installed`
 * cannot say how often the prompt actually appeared.
 *
 * It carries the installation id and a timestamp, and nothing else: there is no
 * rating to report, and a dismissal is not consent to release anything that was
 * buffered. The caller must NOT flush the lifecycle buffer for it.
 */
export const FEEDBACK_DISMISSED_EVENT = 'feedback_dismissed';

export interface SendFeedbackOptions {
  fetch?: FetchLike;
  now?:   number;
}

/**
 * Post the feedback rating + timestamp payload once. Returns true on a
 * successful post, false otherwise. Never throws.
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

    const envelope: PostHogSingleEnvelope = {
      api_key:     apiKey,
      event:       FEEDBACK_EVENT,
      distinct_id: installationId,
      timestamp:   new Date(now).toISOString(),
      properties: {
        $lib:            POSTHOG_LIB_NAME,
        $lib_version:    POSTHOG_LIB_VERSION,
        rating,
        installation_id: installationId,
        feedback_at:     now,
      },
    };

    const result = await postEvent(endpoint, envelope, opts.fetch ? { fetch: opts.fetch } : {});
    return result.ok;
  } catch {
    // Best-effort — a send failure must never crash the caller.
    return false;
  }
}

/**
 * Post the dismissal. Same envelope as the rating with the rating left out —
 * there isn't one.
 *
 * Deliberately does NOT flush the lifecycle buffer, and the caller must not
 * either: the rating click is the consent that releases what was buffered
 * (`stop.ts:526`), and closing the popup is the opposite of that click.
 * Best-effort: never throws.
 */
export async function sendFeedbackDismissed(
  store: Store,
  opts:  SendFeedbackOptions = {},
): Promise<boolean> {
  try {
    const apiKey = getConfig(store.db, 'telemetry_sync_api_key');
    if (!apiKey) return false;   // nothing to authenticate the post with

    const endpoint = getConfig(store.db, 'telemetry_sync_endpoint') ?? DEFAULT_POSTHOG_ENDPOINT;
    const now      = opts.now ?? Date.now();

    const installationId = getInstallationId(store);

    const envelope: PostHogSingleEnvelope = {
      api_key:     apiKey,
      event:       FEEDBACK_DISMISSED_EVENT,
      distinct_id: installationId,
      timestamp:   new Date(now).toISOString(),
      properties: {
        $lib:            POSTHOG_LIB_NAME,
        $lib_version:    POSTHOG_LIB_VERSION,
        installation_id: installationId,
        dismissed_at:    now,
      },
    };

    const result = await postEvent(endpoint, envelope, opts.fetch ? { fetch: opts.fetch } : {});
    return result.ok;
  } catch {
    return false;
  }
}
