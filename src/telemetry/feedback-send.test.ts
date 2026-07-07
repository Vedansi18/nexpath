import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openStore, closeStore, type Store } from '../store/db.js';
import { setConfig } from '../store/config.js';
import {
  recordAdvisoryFired,
  recordOptionSelected,
  readAllSignals,
} from '../store/feedback-signals.js';
import { getInstallationId } from './identity.js';
import { sendFeedback, FEEDBACK_EVENT } from './feedback-send.js';
import type { FetchLike } from './TelemetryClient.js';
import type { PostHogSingleEnvelope } from './types.js';

interface Captured { url?: string; envelope?: PostHogSingleEnvelope; calls: number }

function okFetch(cap: Captured): FetchLike {
  return async (url, init) => {
    cap.calls++;
    cap.url = url;
    cap.envelope = JSON.parse(init.body) as PostHogSingleEnvelope;
    return { ok: true, status: 200, headers: { get: () => null } };
  };
}
function failFetch(cap: Captured): FetchLike {
  return async () => { cap.calls++; return { ok: false, status: 500, headers: { get: () => null } }; };
}
function rateLimitedFetch(cap: Captured): FetchLike {
  return async () => { cap.calls++; return { ok: false, status: 429, headers: { get: (n) => (n === 'Retry-After' ? '120' : null) } }; };
}
function throwFetch(cap: Captured): FetchLike {
  return async () => { cap.calls++; throw new Error('network down'); };
}

let store: Store;
let cap: Captured;

beforeEach(async () => {
  store = await openStore(':memory:');
  setConfig(store, 'telemetry_sync_api_key', 'phc_test');
  cap = { calls: 0 };
});
afterEach(() => closeStore(store));

describe('sendFeedback', () => {
  it('posts even when telemetry.enabled is false (the crux)', async () => {
    setConfig(store, 'telemetry.enabled', 'false');
    const ok = await sendFeedback(store, 3, { fetch: okFetch(cap) });
    expect(ok).toBe(true);
    expect(cap.calls).toBe(1);
    expect(cap.envelope?.event).toBe(FEEDBACK_EVENT);
    expect(cap.envelope?.properties.rating).toBe(3);
  });

  it('builds the payload: rating + all timestamps + installation id', async () => {
    recordAdvisoryFired(store, '/p', 100);
    recordOptionSelected(store, '/p', 150);
    recordAdvisoryFired(store, '/p', 200);

    await sendFeedback(store, 4, { fetch: okFetch(cap), now: 9_000 });

    const env = cap.envelope!;
    const installId = getInstallationId(store);
    expect(env.distinct_id).toBe(installId);
    expect(env.properties.installation_id).toBe(installId);
    expect(typeof env.properties.installed_at).toBe('number');
    expect(env.properties.advisory_fire_ts).toEqual([100, 200]);
    expect(env.properties.option_select_ts).toEqual([150]);
    expect(env.properties.feedback_at).toBe(9_000);
    expect(env.timestamp).toBe(new Date(9_000).toISOString());
  });

  it('aggregates signals globally across projects', async () => {
    recordAdvisoryFired(store, '/a', 100);
    recordOptionSelected(store, '/b', 150);
    await sendFeedback(store, 2, { fetch: okFetch(cap) });
    expect(cap.envelope?.properties.advisory_fire_ts).toEqual([100]);
    expect(cap.envelope?.properties.option_select_ts).toEqual([150]);
  });

  it('prunes sent signals on success', async () => {
    recordAdvisoryFired(store, '/a', 100);
    recordOptionSelected(store, '/b', 150);
    await sendFeedback(store, 3, { fetch: okFetch(cap), now: 1_000 });
    expect(readAllSignals(store)).toEqual({ advisoryFireTs: [], optionSelectTs: [] });
  });

  it('does not prune and returns false on an HTTP failure', async () => {
    recordAdvisoryFired(store, '/a', 100);
    const ok = await sendFeedback(store, 3, { fetch: failFetch(cap) });
    expect(ok).toBe(false);
    expect(readAllSignals(store).advisoryFireTs).toEqual([100]);
  });

  it('swallows network errors and returns false', async () => {
    recordAdvisoryFired(store, '/a', 100);
    const ok = await sendFeedback(store, 3, { fetch: throwFetch(cap) });
    expect(ok).toBe(false);
    expect(readAllSignals(store).advisoryFireTs).toEqual([100]); // not pruned
  });

  it('returns false and does not post when the api key is empty', async () => {
    setConfig(store, 'telemetry_sync_api_key', '');
    const ok = await sendFeedback(store, 3, { fetch: okFetch(cap) });
    expect(ok).toBe(false);
    expect(cap.calls).toBe(0);
  });

  it('sends with empty timestamp arrays when no signals were recorded', async () => {
    const ok = await sendFeedback(store, 1, { fetch: okFetch(cap) });
    expect(ok).toBe(true);
    expect(cap.envelope?.properties.advisory_fire_ts).toEqual([]);
    expect(cap.envelope?.properties.option_select_ts).toEqual([]);
  });

  it('carries the configured api key and PostHog lib metadata', async () => {
    await sendFeedback(store, 2, { fetch: okFetch(cap) });
    expect(cap.envelope?.api_key).toBe('phc_test');
    expect(cap.envelope?.properties.$lib).toBeDefined();
    expect(cap.envelope?.properties.$lib_version).toBeDefined();
  });

  it('posts to the configured endpoint', async () => {
    setConfig(store, 'telemetry_sync_endpoint', 'https://custom.example/capture/');
    await sendFeedback(store, 2, { fetch: okFetch(cap) });
    expect(cap.url).toBe('https://custom.example/capture/');
  });

  it('returns false and does not prune on a 429 rate-limit', async () => {
    recordAdvisoryFired(store, '/a', 100);
    const ok = await sendFeedback(store, 3, { fetch: rateLimitedFetch(cap) });
    expect(ok).toBe(false);
    expect(readAllSignals(store).advisoryFireTs).toEqual([100]);
  });
});
