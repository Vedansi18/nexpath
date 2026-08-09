import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openStore, closeStore, type Store } from '../store/db.js';
import { setConfig } from '../store/config.js';
import {
  recordAdvisoryFired,
  recordOptionSelected,
  recordActionSignal,
  readAllActionSignals,
  setInstalledAtIfMissing,
  isInstalledEventSent,
  markInstalledEventSent,
  readAllSignals,
} from '../store/feedback-signals.js';
import { flushLifecycle, flushIfTelemetryOn } from './lifecycle-flush.js';
import { EVENT_INSTALLED, EVENT_ADVISORY_FIRED, EVENT_OPTION_SELECTED } from './lifecycle-send.js';
import type { FetchLike } from './TelemetryClient.js';
import type { PostHogSingleEnvelope } from './types.js';

interface Sent { event: string; ts: number; timestamp: string }

/** Records every posted event; fails the sends whose (event, ts) are in `failOn`. */
function recordingFetch(sent: Sent[], failOn: Array<[string, number]> = []): FetchLike {
  return async (_url, init) => {
    const env = JSON.parse(init.body) as PostHogSingleEnvelope;
    const tsProp = (env.properties.advisory_fire_ts ?? env.properties.option_select_ts ?? env.properties.action_ts ?? env.properties.installed_at) as number;
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

  it('NF Plan B: flushes each buffered per-action signal as its own event (kind + ts) and prunes it', async () => {
    recordActionSignal(store, '/a', 'pe_shorter', 100);
    recordActionSignal(store, '/a', 'mps_send', 200);

    await flushLifecycle(store, { fetch: recordingFetch(sent) });

    const shorter = sent.filter((s) => s.event === 'pe_shorter');
    const mpsSend = sent.filter((s) => s.event === 'mps_send');
    expect(shorter).toHaveLength(1);
    expect(shorter[0]!.ts).toBe(100);
    expect(shorter[0]!.timestamp).toBe(new Date(100).toISOString());
    expect(mpsSend).toHaveLength(1);
    expect(readAllActionSignals(store)).toEqual([]); // sent + pruned
  });

  it('NF Plan B: a failed action send stays buffered (not pruned) for the next flush', async () => {
    recordActionSignal(store, '/a', 'pe_shorter', 100);
    await flushLifecycle(store, { fetch: recordingFetch(sent, [['pe_shorter', 100]]) });
    expect(sent.filter((s) => s.event === 'pe_shorter')).toHaveLength(0); // send failed
    expect(readAllActionSignals(store)).toEqual([{ kind: 'pe_shorter', occurredAt: 100 }]); // still buffered
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

  it('sends one option_selected event per buffered signal, backdated, then prunes them', async () => {
    markInstalledEventSent(store);
    recordOptionSelected(store, '/a', 150);
    recordOptionSelected(store, '/b', 350);

    await flushLifecycle(store, { fetch: recordingFetch(sent) });

    const opts = sent.filter((s) => s.event === EVENT_OPTION_SELECTED);
    expect(opts.map((s) => s.ts)).toEqual([150, 350]);
    expect(opts.map((s) => s.timestamp)).toEqual([
      new Date(150).toISOString(),
      new Date(350).toISOString(),
    ]);
    expect(readAllSignals(store).optionSelectTs).toEqual([]);   // pruned on success
  });

  it('keeps a failed option_selected signal buffered while pruning the ones that sent', async () => {
    markInstalledEventSent(store);
    recordOptionSelected(store, '/a', 150);
    recordOptionSelected(store, '/a', 250);
    recordOptionSelected(store, '/a', 350);

    // Fail only the 250 send.
    await flushLifecycle(store, { fetch: recordingFetch(sent, [[EVENT_OPTION_SELECTED, 250]]) });

    expect(sent.filter((s) => s.event === EVENT_OPTION_SELECTED).map((s) => s.ts)).toEqual([150, 350]);
    expect(readAllSignals(store).optionSelectTs).toEqual([250]);   // only the failed one remains
  });

  it('does not re-send an option_selected event on a second flush (no-resend)', async () => {
    markInstalledEventSent(store);
    recordOptionSelected(store, '/a', 150);

    await flushLifecycle(store, { fetch: recordingFetch(sent) });
    await flushLifecycle(store, { fetch: recordingFetch(sent) });

    // Sent exactly once across both flushes; pruned after the first send.
    expect(sent.filter((s) => s.event === EVENT_OPTION_SELECTED)).toHaveLength(1);
    expect(readAllSignals(store).optionSelectTs).toEqual([]);
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

  it('sends install, advisories, and option-selected together in one flush', async () => {
    setInstalledAtIfMissing(store, 5000);
    recordAdvisoryFired(store, '/a', 100);
    recordOptionSelected(store, '/a', 150);

    await flushLifecycle(store, { fetch: recordingFetch(sent) });

    expect(sent.filter((s) => s.event === EVENT_INSTALLED)).toHaveLength(1);
    expect(sent.filter((s) => s.event === EVENT_ADVISORY_FIRED)).toHaveLength(1);
    expect(sent.filter((s) => s.event === EVENT_OPTION_SELECTED)).toHaveLength(1);
    expect(readAllSignals(store).optionSelectTs).toEqual([]);   // sent + pruned
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

describe('flushIfTelemetryOn', () => {
  it('flushes immediately when telemetry is on (explicitly enabled)', async () => {
    setConfig(store, 'telemetry.enabled', 'true'); // off by default now (NF Plan A) — enable to test the on-path
    setInstalledAtIfMissing(store, 5000);
    recordAdvisoryFired(store, '/a', 100);

    await flushIfTelemetryOn(store, { fetch: recordingFetch(sent) });

    expect(sent.filter((s) => s.event === EVENT_INSTALLED)).toHaveLength(1);
    expect(sent.filter((s) => s.event === EVENT_ADVISORY_FIRED)).toHaveLength(1);
    expect(readAllSignals(store).advisoryFireTs).toEqual([]);   // sent + pruned
  });

  it('sends nothing and leaves everything buffered when telemetry is off', async () => {
    setConfig(store, 'telemetry.enabled', 'false');
    setInstalledAtIfMissing(store, 5000);
    recordAdvisoryFired(store, '/a', 100);

    await flushIfTelemetryOn(store, { fetch: recordingFetch(sent) });

    expect(sent).toHaveLength(0);
    expect(isInstalledEventSent(store)).toBe(false);           // not sent
    expect(readAllSignals(store).advisoryFireTs).toEqual([100]); // still buffered
  });

  it('leaves option-selected buffered when telemetry is off, then flushes it when on', async () => {
    markInstalledEventSent(store);
    recordOptionSelected(store, '/a', 150);

    setConfig(store, 'telemetry.enabled', 'false');
    await flushIfTelemetryOn(store, { fetch: recordingFetch(sent) });
    expect(sent).toHaveLength(0);
    expect(readAllSignals(store).optionSelectTs).toEqual([150]);   // buffered while off

    setConfig(store, 'telemetry.enabled', 'true');
    await flushIfTelemetryOn(store, { fetch: recordingFetch(sent) });
    expect(sent.filter((s) => s.event === EVENT_OPTION_SELECTED)).toHaveLength(1);
    expect(readAllSignals(store).optionSelectTs).toEqual([]);      // flushed on consent/on
  });
});
