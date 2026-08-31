/**
 * The browser's one-shot telemetry sender — the rating, and the lifecycle
 * events, on the CLI's exact envelope.
 *
 * One file for both because the rating and the lifecycle events share an
 * envelope builder and a transport; change-map item #16 says so explicitly
 * ("One file, one name").
 *
 * ── CONSENT ──────────────────────────────────────────────────────────────────
 *
 * The CLI's rule, unchanged (`stop.ts:526`): *"Flush regardless of
 * telemetry.enabled — this explicit action is the consent."* The user clicking
 * a rating IS the consent, and it is the only thing that ever puts a request on
 * the wire from here. Nothing in this module fires on its own.
 *
 * ── WHAT IS ON THE WIRE ──────────────────────────────────────────────────────
 *
 * An installation id (a random UUID), a timestamp, and — for the rating — a
 * number from 1 to 4. There is no parameter on any exported function that could
 * carry prompt text, option text, a URL or a project root, which is the point:
 * the payload is content-free because the API cannot express content.
 *
 * ── WHAT CHANGED IN THE PORT, AND WHY ────────────────────────────────────────
 *
 * 1. **The key and endpoint are constants, not config reads.** The CLI reads
 *    `telemetry_sync_api_key` / `telemetry_sync_endpoint` from its config table
 *    and falls back to the SAME built-in defaults (`store/config.ts:15-16`).
 *    The browser has no equivalent table for these, so it ships the defaults
 *    directly. The key is a PUBLIC PostHog ingest key — it authorises writing
 *    events and nothing else.
 *
 * 2. **No `User-Agent` header.** The CLI's `postEvent` sets one
 *    (`TelemetryClient.ts:58`). `User-Agent` is a forbidden header name for
 *    `fetch` in a browser: setting it is silently dropped, so it is not sent
 *    rather than left to look as though it were.
 *
 * 3. **Every envelope carries `surface: 'browser'`** (§9.7). `$lib` stays
 *    `'nexpath'` so the browser's events sit in the same stream as the CLI's,
 *    and `surface` is what tells them apart. It must ship with the FIRST send —
 *    events sent before it exists cannot be attributed retroactively.
 *
 * 4. **`SendResult` is collapsed to a boolean.** The CLI distinguishes network
 *    from HTTP failure to drive its batched retry/backoff. Nothing here retries:
 *    a signal that fails to send simply stays buffered for the next flush.
 */

import { getInstallationId, type RatingIdentityKeyStore } from './rating-identity.js';
import {
  readSignals,
  pruneSignalAt,
  getInstalledAt,
  isInstalledEventSent,
  markInstalledEventSent,
  isActionKind,
  SIGNAL_ADVISORY_FIRED,
  SIGNAL_OPTION_SELECTED,
  type LifecycleSignalsKeyStore,
} from './lifecycle-signals.js';

/** `store/config.ts:15`. */
export const POSTHOG_ENDPOINT = 'https://us.i.posthog.com/capture/';

/** `store/config.ts:16` — a PUBLIC PostHog ingest key; write-only by design. */
export const POSTHOG_API_KEY = 'phc_mBETUUXjX2MLDCBpHmRoVMqHmRF2dUpnuByqVGw5qej9';

/** `TelemetryBatcher.ts:4-5`. Shared with the CLI on purpose — see `SURFACE`. */
export const POSTHOG_LIB_NAME    = 'nexpath';
export const POSTHOG_LIB_VERSION = '0.1.1';

/** §9.7 — what separates a browser event from a CLI one inside the same `$lib`. */
export const SURFACE = 'browser';

/** `TelemetryClient.ts:5`. */
export const DEFAULT_TIMEOUT_MS = 10_000;

/** `feedback-send.ts:22`. */
export const FEEDBACK_EVENT = 'feedback_submitted';

/** `lifecycle-send.ts:22-24`. */
export const EVENT_INSTALLED       = 'nexpath_installed';
export const EVENT_ADVISORY_FIRED  = 'advisory_fired';
export const EVENT_OPTION_SELECTED = 'option_selected';

/** `TelemetryClient.ts:7-17`, minus the response fields nothing here reads. */
export type FetchLike = (input: string, init: {
  method:  string;
  headers: Record<string, string>;
  body:    string;
  signal:  AbortSignal;
}) => Promise<{ ok: boolean; status: number }>;

/** `telemetry/types.ts` — `PostHogSingleEnvelope`, field for field. */
export interface PostHogSingleEnvelope {
  api_key:     string;
  event:       string;
  distinct_id: string;
  timestamp:   string;
  properties:  Record<string, unknown>;
}

export interface SendOptions {
  fetch?:     FetchLike;
  timeoutMs?: number;
}

/** The store slice both halves of this module need. */
export type TelemetryKeyStore = RatingIdentityKeyStore & LifecycleSignalsKeyStore;

/**
 * Build the envelope. Split out so the tests can assert the exact shape without
 * a network, and so the rating and lifecycle paths cannot drift apart.
 */
export function buildEnvelope(
  event:          string,
  installationId: string,
  occurredAt:     number,
  extraProps:     Record<string, unknown> = {},
): PostHogSingleEnvelope {
  return {
    api_key:     POSTHOG_API_KEY,
    event,
    distinct_id: installationId,
    // Backdated to when the thing HAPPENED, so a deferred flush still lands at
    // the right point on the timeline (`lifecycle-send.ts:6-8`).
    timestamp:   new Date(occurredAt).toISOString(),
    properties: {
      $lib:            POSTHOG_LIB_NAME,
      $lib_version:    POSTHOG_LIB_VERSION,
      surface:         SURFACE,
      installation_id: installationId,
      ...extraProps,
    },
  };
}

/**
 * POST one envelope. True only on a 2xx. Never throws — a send failure must
 * never reach the caller, which is a UI click handler.
 */
async function postEnvelope(envelope: PostHogSingleEnvelope, opts: SendOptions): Promise<boolean> {
  const fetchImpl = opts.fetch ?? (globalThis.fetch as unknown as FetchLike | undefined);
  if (!fetchImpl) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetchImpl(POSTHOG_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(envelope),
      signal:  controller.signal,
    });
    return res.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function send(
  store:      TelemetryKeyStore,
  event:      string,
  occurredAt: number,
  extraProps: Record<string, unknown>,
  opts:       SendOptions,
): Promise<boolean> {
  try {
    const installationId = await getInstallationId(store);
    return await postEnvelope(buildEnvelope(event, installationId, occurredAt, extraProps), opts);
  } catch {
    return false;
  }
}

/**
 * Post the rating. `feedback-send.ts:33-67`, with `surface` added.
 *
 * The payload is the rating, a feedback timestamp and the installation id —
 * install and advisory context are their own lifecycle events, not properties
 * here.
 */
export function sendRating(
  store:  TelemetryKeyStore,
  rating: number,
  opts:   SendOptions & { now?: number } = {},
): Promise<boolean> {
  const now = opts.now ?? Date.now();
  return send(store, FEEDBACK_EVENT, now, { rating, feedback_at: now }, opts);
}

/** `lifecycle-send.ts:69` — the one-time install event. */
export function sendInstalled(
  store:       TelemetryKeyStore,
  installedAt: number,
  opts:        SendOptions = {},
): Promise<boolean> {
  return send(store, EVENT_INSTALLED, installedAt, { installed_at: installedAt }, opts);
}

/** `lifecycle-send.ts:78`. */
export function sendAdvisoryFired(
  store:      TelemetryKeyStore,
  occurredAt: number,
  opts:       SendOptions = {},
): Promise<boolean> {
  return send(store, EVENT_ADVISORY_FIRED, occurredAt, { advisory_fire_ts: occurredAt }, opts);
}

/** `lifecycle-send.ts:87`. */
export function sendOptionSelected(
  store:      TelemetryKeyStore,
  occurredAt: number,
  opts:       SendOptions = {},
): Promise<boolean> {
  return send(store, EVENT_OPTION_SELECTED, occurredAt, { option_select_ts: occurredAt }, opts);
}

/**
 * `lifecycle-send.ts:100` — ONE per-action event, where the event NAME is the
 * action kind (`pe_shorter`, `mps_send`, …), backdated to when it occurred.
 *
 * These are the events the CLI actually produces; `advisory_fired` and
 * `option_selected` are dead on both sides. See `lifecycle-signals.ts`.
 */
export function sendActionEvent(
  store:      TelemetryKeyStore,
  kind:       string,
  occurredAt: number,
  opts:       SendOptions = {},
): Promise<boolean> {
  return send(store, kind, occurredAt, { action_ts: occurredAt }, opts);
}

/**
 * Release the buffer — `telemetry/lifecycle-flush.ts`.
 *
 * Called on the rating click and BEFORE the rating itself (§4.2), so the
 * denominator lands with the number it is a denominator for.
 *
 * Two rules carried over exactly:
 *   - the install event is guarded to fire ONCE, and is marked sent only after a
 *     successful post, so a failed one is retried on the next flush;
 *   - a buffered signal is pruned only after ITS OWN send succeeds, so nothing
 *     is lost and nothing is counted twice.
 *
 * Sequential rather than parallel, like the CLI's loops: prune-after-success is
 * a read-modify-write on one storage key, and overlapping flushes would drop
 * each other's edits.
 */
export async function flushLifecycle(
  store: TelemetryKeyStore,
  opts:  SendOptions & { now?: number } = {},
): Promise<void> {
  try {
    if (!await isInstalledEventSent(store)) {
      const installedAt = await getInstalledAt(store, opts.now ?? Date.now());
      if (await sendInstalled(store, installedAt, opts)) {
        await markInstalledEventSent(store);
      }
    }

    // Read once, oldest first. The CLI reads its two kinds separately; one pass
    // over a single ordered list is the same set in the same order.
    for (const signal of await readSignals(store)) {
      // Three senders, one per kind family, exactly as the CLI's three loops do:
      // an action kind posts under its OWN name, the other two under theirs.
      let ok: boolean;
      if (isActionKind(signal.kind))                      ok = await sendActionEvent(store, signal.kind, signal.occurredAt, opts);
      else if (signal.kind === SIGNAL_ADVISORY_FIRED)     ok = await sendAdvisoryFired(store, signal.occurredAt, opts);
      else                                                ok = await sendOptionSelected(store, signal.occurredAt, opts);
      if (ok) await pruneSignalAt(store, signal.kind, signal.occurredAt);
    }
  } catch {
    // Best-effort in full: a flush that fails half way leaves the rest buffered.
  }
}

/** Re-exported so callers wire one import; the kinds are the buffer's, not ours. */
export { SIGNAL_ADVISORY_FIRED, SIGNAL_OPTION_SELECTED };
