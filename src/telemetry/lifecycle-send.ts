/**
 * Direct, one-shot lifecycle events (install, advisory-fired).
 *
 * Like the feedback send, these post a single event directly and are
 * intentionally independent of the telemetry.enabled setting and the batched
 * sync — they carry only an installation id and a timestamp (no prompt, option,
 * or project text). Best-effort: they never throw.
 */

import type { Store } from '../store/db.js';
import { getConfig } from '../store/config.js';
import { getInstallationId } from './identity.js';
import { postEvent, DEFAULT_POSTHOG_ENDPOINT, type FetchLike } from './TelemetryClient.js';
import { POSTHOG_LIB_NAME, POSTHOG_LIB_VERSION } from './TelemetryBatcher.js';
import type { PostHogSingleEnvelope } from './types.js';

export const EVENT_INSTALLED       = 'nexpath_installed';
export const EVENT_ADVISORY_FIRED  = 'advisory_fired';

export interface LifecycleSendOptions {
  fetch?: FetchLike;
  now?:   number;
}

async function sendLifecycle(
  store:      Store,
  event:      string,
  extraProps: Record<string, unknown>,
  opts:       LifecycleSendOptions,
): Promise<boolean> {
  try {
    const apiKey = getConfig(store.db, 'telemetry_sync_api_key');
    if (!apiKey) return false;

    const endpoint = getConfig(store.db, 'telemetry_sync_endpoint') ?? DEFAULT_POSTHOG_ENDPOINT;
    const now      = opts.now ?? Date.now();
    const installationId = getInstallationId(store);

    const envelope: PostHogSingleEnvelope = {
      api_key:     apiKey,
      event,
      distinct_id: installationId,
      timestamp:   new Date(now).toISOString(),
      properties: {
        $lib:            POSTHOG_LIB_NAME,
        $lib_version:    POSTHOG_LIB_VERSION,
        installation_id: installationId,
        ...extraProps,
      },
    };

    const result = await postEvent(endpoint, envelope, opts.fetch ? { fetch: opts.fetch } : {});
    return result.ok;
  } catch {
    return false;   // best-effort — never crash the caller
  }
}

/** Emit a one-time install event (installation id + install timestamp). */
export function sendInstalled(
  store:       Store,
  installedAt: number,
  opts:        LifecycleSendOptions = {},
): Promise<boolean> {
  return sendLifecycle(store, EVENT_INSTALLED, { installed_at: installedAt }, opts);
}

/** Emit an advisory-fired event (installation id + fire timestamp). */
export function sendAdvisoryFired(
  store: Store,
  opts:  LifecycleSendOptions = {},
): Promise<boolean> {
  return sendLifecycle(store, EVENT_ADVISORY_FIRED, {}, opts);
}
