import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openStore, closeStore, type Store } from '../store/db.js';
import { setConfig } from '../store/config.js';
import { getInstallationId } from './identity.js';
import {
  sendInstalled,
  sendAdvisoryFired,
  EVENT_INSTALLED,
  EVENT_ADVISORY_FIRED,
} from './lifecycle-send.js';
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

describe('sendInstalled', () => {
  it('posts the install event independent of telemetry.enabled', async () => {
    setConfig(store, 'telemetry.enabled', 'false');
    const ok = await sendInstalled(store, 5000, { fetch: okFetch(cap) });
    expect(ok).toBe(true);
    expect(cap.calls).toBe(1);
    expect(cap.envelope?.event).toBe(EVENT_INSTALLED);
  });

  it('builds the payload: installation id + install timestamp, backdated', async () => {
    const ok = await sendInstalled(store, 5000, { fetch: okFetch(cap) });
    expect(ok).toBe(true);
    const env = cap.envelope!;
    const installId = getInstallationId(store);
    expect(env.distinct_id).toBe(installId);
    expect(env.properties.installation_id).toBe(installId);
    expect(env.properties.installed_at).toBe(5000);
    expect(env.timestamp).toBe(new Date(5000).toISOString());
  });

  it('is content-free — only lib metadata, installation id, install timestamp', async () => {
    await sendInstalled(store, 5000, { fetch: okFetch(cap) });
    const keys = Object.keys(cap.envelope!.properties).sort();
    expect(keys).toEqual(['$lib', '$lib_version', 'installation_id', 'installed_at'].sort());
  });

  it('carries the configured api key and PostHog lib metadata', async () => {
    await sendInstalled(store, 1, { fetch: okFetch(cap) });
    expect(cap.envelope?.api_key).toBe('phc_test');
    expect(cap.envelope?.properties.$lib).toBeDefined();
    expect(cap.envelope?.properties.$lib_version).toBeDefined();
  });

  it('returns false and does not post when the api key is empty', async () => {
    setConfig(store, 'telemetry_sync_api_key', '');
    const ok = await sendInstalled(store, 5000, { fetch: okFetch(cap) });
    expect(ok).toBe(false);
    expect(cap.calls).toBe(0);
  });

  it('returns false on an HTTP failure', async () => {
    expect(await sendInstalled(store, 5000, { fetch: failFetch(cap) })).toBe(false);
  });

  it('swallows network errors and returns false', async () => {
    expect(await sendInstalled(store, 5000, { fetch: throwFetch(cap) })).toBe(false);
  });

  it('returns false on a 429 rate-limit', async () => {
    expect(await sendInstalled(store, 5000, { fetch: rateLimitedFetch(cap) })).toBe(false);
  });

  it('posts to the configured endpoint', async () => {
    setConfig(store, 'telemetry_sync_endpoint', 'https://custom.example/capture/');
    await sendInstalled(store, 5000, { fetch: okFetch(cap) });
    expect(cap.url).toBe('https://custom.example/capture/');
  });
});

describe('sendAdvisoryFired', () => {
  it('posts the advisory event independent of telemetry.enabled', async () => {
    setConfig(store, 'telemetry.enabled', 'false');
    const ok = await sendAdvisoryFired(store, 1234, { fetch: okFetch(cap) });
    expect(ok).toBe(true);
    expect(cap.envelope?.event).toBe(EVENT_ADVISORY_FIRED);
  });

  it('builds the payload: installation id + fire timestamp, backdated', async () => {
    await sendAdvisoryFired(store, 1234, { fetch: okFetch(cap) });
    const env = cap.envelope!;
    const installId = getInstallationId(store);
    expect(env.distinct_id).toBe(installId);
    expect(env.properties.installation_id).toBe(installId);
    expect(env.properties.advisory_fire_ts).toBe(1234);
    expect(env.timestamp).toBe(new Date(1234).toISOString());
  });

  it('is content-free — only lib metadata, installation id, fire timestamp', async () => {
    await sendAdvisoryFired(store, 1234, { fetch: okFetch(cap) });
    const keys = Object.keys(cap.envelope!.properties).sort();
    expect(keys).toEqual(['$lib', '$lib_version', 'advisory_fire_ts', 'installation_id'].sort());
  });

  it('returns false and does not post when the api key is empty', async () => {
    setConfig(store, 'telemetry_sync_api_key', '');
    expect(await sendAdvisoryFired(store, 1234, { fetch: okFetch(cap) })).toBe(false);
    expect(cap.calls).toBe(0);
  });

  it('swallows network errors and returns false', async () => {
    expect(await sendAdvisoryFired(store, 1234, { fetch: throwFetch(cap) })).toBe(false);
  });
});
