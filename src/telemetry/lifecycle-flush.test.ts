import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openStore, closeStore, type Store } from '../store/db.js';
import { setConfig } from '../store/config.js';
import {
  recordAdvisoryFired,
  recordOptionSelected,
  setInstalledAtIfMissing,
  isInstalledEventSent,
  markInstalledEventSent,
  readAllSignals,
} from '../store/feedback-signals.js';
import { flushLifecycle } from './lifecycle-flush.js';
import { EVENT_INSTALLED, EVENT_ADVISORY_FIRED } from './lifecycle-send.js';
import type { FetchLike } from './TelemetryClient.js';
import type { PostHogSingleEnvelope } from './types.js';

interface Sent { event: string; ts: number; timestamp: string }

/** Records every posted event; fails the sends whose (event, ts) are in `failOn`. */
function recordingFetch(sent: Sent[], failOn: Array<[string, number]> = []): FetchLike {
  return async (_url, init) => {
    const env = JSON.parse(init.body) as PostHogSingleEnvelope;
    const tsProp = (env.properties.advisory_fire_ts ?? env.properties.installed_at) as number;
    const fail = failOn.some(([e, t]) => e === env.event && t === tsProp);
    if (!fail) sent.push({ event: env.event, ts: tsProp, timestamp: env.timestamp });
    return { ok: !fail, status: fail ? 500 : 200, headers: { get: () => null } };
  };
}

let store: Store;
let sent: Sent[];

beforeEach(async () => {
  store = await openStore(':memory:');
  setConfig(store, 'telemetry_sync_api_key', 'phc_test');
  sent = [];
});
afterEach(() => closeStore(store));

describe('flushLifecycle', () => {
  it('sends the install event once and marks it sent', async () => {
    setInstalledAtIfMissing(store, 5000);
    await flushLifecycle(store, { fetch: recordingFetch(sent) });

    const installs = sent.filter((s) => s.event === EVENT_INSTALLED);
    expect(installs).toHaveLength(1);
    expect(installs[0]!.ts).toBe(5000);
    expect(installs[0]!.timestamp).toBe(new Date(5000).toISOString());
    expect(isInstalledEventSent(store)).toBe(true);
  });

  it('does not re-send the install event once already sent', async () => {
    markInstalledEventSent(store);
    await flushLifecycle(store, { fetch: recordingFetch(sent) });
    expect(sent.filter((s) => s.event === EVENT_INSTALLED)).toHaveLength(0);
  });

  it('sends one advisory_fired event per buffered signal, backdated, then prunes them', async () => {
    markInstalledEventSent(store);              // isolate advisory behaviour
    recordAdvisoryFired(store, '/a', 100);
    recordAdvisoryFired(store, '/b', 300);

    await flushLifecycle(store, { fetch: recordingFetch(sent) });

    const advisories = sent.filter((s) => s.event === EVENT_ADVISORY_FIRED);
    expect(advisories.map((s) => s.ts)).toEqual([100, 300]);
    expect(advisories.map((s) => s.timestamp)).toEqual([
      new Date(100).toISOString(),
      new Date(300).toISOString(),
    ]);
    expect(readAllSignals(store).advisoryFireTs).toEqual([]);   // pruned on success
  });

  it('does not send or prune option-selected signals', async () => {
    markInstalledEventSent(store);
    recordOptionSelected(store, '/a', 150);

    await flushLifecycle(store, { fetch: recordingFetch(sent) });

    expect(sent).toHaveLength(0);
    expect(readAllSignals(store).optionSelectTs).toEqual([150]);  // left buffered
  });

  it('keeps a failed advisory signal buffered while pruning the ones that sent', async () => {
    markInstalledEventSent(store);
    recordAdvisoryFired(store, '/a', 100);
    recordAdvisoryFired(store, '/a', 200);
    recordAdvisoryFired(store, '/a', 300);

    // Fail only the 200 send.
    await flushLifecycle(store, { fetch: recordingFetch(sent, [[EVENT_ADVISORY_FIRED, 200]]) });

    expect(sent.filter((s) => s.event === EVENT_ADVISORY_FIRED).map((s) => s.ts)).toEqual([100, 300]);
    expect(readAllSignals(store).advisoryFireTs).toEqual([200]);   // only the failed one remains
  });

  it('does not mark install sent when the install send fails, but still sends advisories', async () => {
    setInstalledAtIfMissing(store, 5000);
    recordAdvisoryFired(store, '/a', 100);

    await flushLifecycle(store, { fetch: recordingFetch(sent, [[EVENT_INSTALLED, 5000]]) });

    expect(isInstalledEventSent(store)).toBe(false);              // not marked — retried next flush
    expect(sent.filter((s) => s.event === EVENT_ADVISORY_FIRED).map((s) => s.ts)).toEqual([100]);
    expect(readAllSignals(store).advisoryFireTs).toEqual([]);
  });

  it('is idempotent — a second flush sends nothing new', async () => {
    setInstalledAtIfMissing(store, 5000);
    recordAdvisoryFired(store, '/a', 100);

    await flushLifecycle(store, { fetch: recordingFetch(sent) });
    const afterFirst = sent.length;
    await flushLifecycle(store, { fetch: recordingFetch(sent) });

    expect(sent.length).toBe(afterFirst);                        // nothing added on the 2nd flush
  });

  it('sends install + advisories together in one flush', async () => {
    setInstalledAtIfMissing(store, 5000);
    recordAdvisoryFired(store, '/a', 100);
    recordAdvisoryFired(store, '/a', 200);

    await flushLifecycle(store, { fetch: recordingFetch(sent) });

    expect(sent.filter((s) => s.event === EVENT_INSTALLED)).toHaveLength(1);
    expect(sent.filter((s) => s.event === EVENT_ADVISORY_FIRED)).toHaveLength(2);
  });

  it('never throws and marks/prunes nothing when the api key is empty', async () => {
    setConfig(store, 'telemetry_sync_api_key', '');
    setInstalledAtIfMissing(store, 5000);
    recordAdvisoryFired(store, '/a', 100);

    await expect(flushLifecycle(store, { fetch: recordingFetch(sent) })).resolves.toBeUndefined();
    expect(isInstalledEventSent(store)).toBe(false);
    expect(readAllSignals(store).advisoryFireTs).toEqual([100]);
  });
});
