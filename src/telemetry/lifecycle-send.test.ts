import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openStore, closeStore, type Store } from '../store/db.js';
import { setConfig } from '../store/config.js';
import { getInstallationId } from './identity.js';
import { sendInstalled, sendAdvisoryFired, EVENT_INSTALLED, EVENT_ADVISORY_FIRED } from './lifecycle-send.js';
import type { FetchLike } from './TelemetryClient.js';
import type { PostHogSingleEnvelope } from './types.js';

interface Captured { url?: string; envelope?: PostHogSingleEnvelope; calls: number }

function okFetch(cap: Captured): FetchLike {
  return async (url, init) => {
    cap.calls++; cap.url = url; cap.envelope = JSON.parse(init.body) as PostHogSingleEnvelope;
    return { ok: true, status: 200, headers: { get: () => null } };
  };
}
const failFetch = (cap: Captured): FetchLike =>
  async () => { cap.calls++; return { ok: false, status: 500, headers: { get: () => null } }; };
const throwFetch = (cap: Captured): FetchLike =>
  async () => { cap.calls++; throw new Error('offline'); };

let store: Store;
let cap: Captured;
beforeEach(async () => { store = await openStore(':memory:'); setConfig(store, 'telemetry_sync_api_key', 'phc_test'); cap = { calls: 0 }; });
afterEach(() => closeStore(store));

describe('sendInstalled', () => {
  it('posts the install event even when telemetry.enabled is false (crux)', async () => {
    setConfig(store, 'telemetry.enabled', 'false');
    const ok = await sendInstalled(store, 4242, { fetch: okFetch(cap) });
    expect(ok).toBe(true);
    expect(cap.calls).toBe(1);
    expect(cap.envelope?.event).toBe(EVENT_INSTALLED);
    expect(cap.envelope?.properties.installed_at).toBe(4242);
  });

  it('carries installation id as distinct_id + property (no prompt/option text)', async () => {
    await sendInstalled(store, 100, { fetch: okFetch(cap) });
    const id = getInstallationId(store);
    expect(cap.envelope?.distinct_id).toBe(id);
    expect(cap.envelope?.properties.installation_id).toBe(id);
    expect(cap.envelope?.properties.$lib).toBeDefined();
  });

  it('returns false and does not post when the api key is empty', async () => {
    setConfig(store, 'telemetry_sync_api_key', '');
    const ok = await sendInstalled(store, 1, { fetch: okFetch(cap) });
    expect(ok).toBe(false);
    expect(cap.calls).toBe(0);
  });

  it('returns false on HTTP failure and swallows network errors', async () => {
    expect(await sendInstalled(store, 1, { fetch: failFetch(cap) })).toBe(false);
    expect(await sendInstalled(store, 1, { fetch: throwFetch(cap) })).toBe(false);
  });
});

describe('sendAdvisoryFired', () => {
  it('posts the advisory-fired event even when telemetry.enabled is false (crux)', async () => {
    setConfig(store, 'telemetry.enabled', 'false');
    const ok = await sendAdvisoryFired(store, { fetch: okFetch(cap), now: 9_000 });
    expect(ok).toBe(true);
    expect(cap.envelope?.event).toBe(EVENT_ADVISORY_FIRED);
    expect(cap.envelope?.timestamp).toBe(new Date(9_000).toISOString());
    expect(cap.envelope?.properties.installation_id).toBe(getInstallationId(store));
  });

  it('carries no prompt/option/project text', async () => {
    await sendAdvisoryFired(store, { fetch: okFetch(cap) });
    const props = cap.envelope?.properties ?? {};
    expect(Object.keys(props).sort()).toEqual(['$lib', '$lib_version', 'installation_id']);
  });
});
