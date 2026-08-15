/**
 * Direct, one-shot lifecycle events (install, advisory-fired, option-selected).
 *
 * Each posts a single PostHog event carrying only an installation id and a
 * timestamp — no prompt, option, or project text. The event timestamp is the
 * moment the thing actually happened (backdated), so a deferred send still lands
 * at the correct point on the timeline. Best-effort: a send never throws.
 *
 * Whether and when these fire is the caller's decision (immediately when
 * telemetry is on, or buffered and flushed on the feedback consent when off);
 * this module only performs the post.
 */

import type { Store } from '../store/db.js';
import { getConfig } from '../store/config.js';
import { getInstallationId } from './identity.js';
import { postEvent, DEFAULT_POSTHOG_ENDPOINT, type FetchLike } from './TelemetryClient.js';
import { POSTHOG_LIB_NAME, POSTHOG_LIB_VERSION } from './TelemetryBatcher.js';
import type { PostHogSingleEnvelope } from './types.js';

export const EVENT_INSTALLED       = 'nexpath_installed';
export const EVENT_ADVISORY_FIRED  = 'advisory_fired';
export const EVENT_OPTION_SELECTED = 'option_selected';

export interface SendLifecycleOptions {
  fetch?: FetchLike;
}

/**
 * Post a single lifecycle event backdated to `occurredAt`. Returns true on a
 * successful post, false otherwise. Never throws.
 */
async function sendLifecycle(
  store:      Store,
  event:      string,
  occurredAt: number,
  extraProps: Record<string, unknown>,
  opts:       SendLifecycleOptions,
): Promise<boolean> {
  try {
    const apiKey = getConfig(store.db, 'telemetry_sync_api_key');
    if (!apiKey) return false;   // nothing to authenticate the post with

    const endpoint       = getConfig(store.db, 'telemetry_sync_endpoint') ?? DEFAULT_POSTHOG_ENDPOINT;
    const installationId = getInstallationId(store);

    const envelope: PostHogSingleEnvelope = {
      api_key:     apiKey,
      event,
      distinct_id: installationId,
      timestamp:   new Date(occurredAt).toISOString(),
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
    // Best-effort — a send failure must never crash the caller.
    return false;
  }
}

/** Emit a one-time install event (installation id + install timestamp). */
export function sendInstalled(
  store:       Store,
  installedAt: number,
  opts:        SendLifecycleOptions = {},
): Promise<boolean> {
  return sendLifecycle(store, EVENT_INSTALLED, installedAt, { installed_at: installedAt }, opts);
}

/** Emit an advisory-fired event (installation id + fire timestamp). */
export function sendAdvisoryFired(
  store:      Store,
  occurredAt: number,
  opts:       SendLifecycleOptions = {},
): Promise<boolean> {
  return sendLifecycle(store, EVENT_ADVISORY_FIRED, occurredAt, { advisory_fire_ts: occurredAt }, opts);
}

/** Emit an option-selected event (installation id + selection timestamp). */
export function sendOptionSelected(
  store:      Store,
  occurredAt: number,
  opts:       SendLifecycleOptions = {},
): Promise<boolean> {
  return sendLifecycle(store, EVENT_OPTION_SELECTED, occurredAt, { option_select_ts: occurredAt }, opts);
}

/**
 * NF Plan B — emit ONE per-action event: the event name IS the action kind (e.g. `pe_shorter`,
 * `mps_send`), backdated to when it occurred. Carries only the installation id + timestamp — no prompt
 * or option text. Best-effort; never throws.
 */
export function sendActionEvent(
  store:      Store,
  kind:       string,
  occurredAt: number,
  opts:       SendLifecycleOptions = {},
): Promise<boolean> {
  return sendLifecycle(store, kind, occurredAt, { action_ts: occurredAt }, opts);
}
