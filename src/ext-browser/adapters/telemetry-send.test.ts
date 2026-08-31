import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildEnvelope, sendRating, sendInstalled, sendAdvisoryFired, sendOptionSelected,
  flushLifecycle,
  POSTHOG_ENDPOINT, POSTHOG_API_KEY, POSTHOG_LIB_NAME, POSTHOG_LIB_VERSION, SURFACE,
  FEEDBACK_EVENT, EVENT_INSTALLED, EVENT_ADVISORY_FIRED, EVENT_OPTION_SELECTED,
  type FetchLike, type TelemetryKeyStore,
} from './telemetry-send.js';
import {
  recordSignal, readSignals, KEY_INSTALLED_AT, KEY_INSTALLED_EVENT_SENT,
  SIGNAL_ADVISORY_FIRED, SIGNAL_OPTION_SELECTED,
} from './lifecycle-signals.js';
import { _resetIdentityInFlight, KEY_INSTALLATION_ID } from './rating-identity.js';

const T0 = 1_700_000_000_000;
const ID = 'fixed-installation-id';

function memStore(seed: Record<string, string> = {}) {
  const data: Record<string, string> = { [KEY_INSTALLATION_ID]: ID, ...seed };
  const store: TelemetryKeyStore = {
    getKey: async (k) => (k in data ? data[k] : null),
    setKey: async (k, v) => { data[k] = v; },
  };
  return { store, data };
}

/** A fetch stand-in that records every call and answers per `decide`. */
function fakeFetch(decide: (body: Record<string, unknown>, n: number) => boolean = () => true) {
  const calls: { url: string; init: Parameters<FetchLike>[1]; body: Record<string, unknown> }[] = [];
  const fetch: FetchLike = async (url, init) => {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    calls.push({ url, init, body });
    const ok = decide(body, calls.length);
    return { ok, status: ok ? 200 : 500 };
  };
  return { fetch, calls, events: () => calls.map((c) => c.body.event as string) };
}

beforeEach(() => { _resetIdentityInFlight(); });

// ── the envelope ─────────────────────────────────────────────────────────────

describe('the envelope', () => {
  it('is the CLI\'s shape, field for field, plus `surface`', async () => {
    const { store } = memStore();
    const { fetch, calls } = fakeFetch();

    await sendRating(store, 3, { fetch, now: T0 });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(POSTHOG_ENDPOINT);
    expect(calls[0].body).toEqual({
      api_key:     POSTHOG_API_KEY,
      event:       'feedback_submitted',
      distinct_id: ID,
      timestamp:   new Date(T0).toISOString(),
      properties: {
        $lib:            'nexpath',
        $lib_version:    POSTHOG_LIB_VERSION,
        surface:         'browser',
        installation_id: ID,
        rating:          3,
        feedback_at:     T0,
      },
    });
  });

  it('posts JSON, and does NOT set a User-Agent (a forbidden fetch header)', async () => {
    const { store } = memStore();
    const { fetch, calls } = fakeFetch();

    await sendRating(store, 1, { fetch, now: T0 });

    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(Object.keys(calls[0].init.headers)).not.toContain('User-Agent');
  });

  it('backdates lifecycle events to when they happened, not to now', () => {
    const envelope = buildEnvelope(EVENT_ADVISORY_FIRED, ID, T0, { advisory_fire_ts: T0 });
    expect(envelope.timestamp).toBe(new Date(T0).toISOString());
  });

  it.each([
    [EVENT_INSTALLED,       'installed_at'],
    [EVENT_ADVISORY_FIRED,  'advisory_fire_ts'],
    [EVENT_OPTION_SELECTED, 'option_select_ts'],
  ])('%s carries only the id, the lib fields, surface and %s', async (event, tsProp) => {
    const { store } = memStore();
    const { fetch, calls } = fakeFetch();
    const senders = {
      [EVENT_INSTALLED]:       sendInstalled,
      [EVENT_ADVISORY_FIRED]:  sendAdvisoryFired,
      [EVENT_OPTION_SELECTED]: sendOptionSelected,
    };

    await senders[event](store, T0, { fetch });

    const props = (calls[0].body.properties as Record<string, unknown>);
    expect(calls[0].body.event).toBe(event);
    expect(Object.keys(props).sort())
      .toEqual(['$lib', '$lib_version', 'installation_id', 'surface', tsProp].sort());
    expect(props[tsProp]).toBe(T0);
  });
});

// ── the privacy claim ────────────────────────────────────────────────────────

describe('⭐ no prompt or option text can reach the wire', () => {
  it('every payload from every sender is ids, timestamps and one number', async () => {
    const { store } = memStore();
    const { fetch, calls } = fakeFetch();

    await sendRating(store, 4, { fetch, now: T0 });
    await sendInstalled(store, T0, { fetch });
    await sendAdvisoryFired(store, T0, { fetch });
    await sendOptionSelected(store, T0, { fetch });

    const ALLOWED = new Set([
      '$lib', '$lib_version', 'surface', 'installation_id',
      'rating', 'feedback_at', 'installed_at', 'advisory_fire_ts', 'option_select_ts',
    ]);
    for (const call of calls) {
      expect(Object.keys(call.body).sort())
        .toEqual(['api_key', 'distinct_id', 'event', 'properties', 'timestamp']);
      for (const [k, v] of Object.entries(call.body.properties as Record<string, unknown>)) {
        expect(ALLOWED.has(k)).toBe(true);
        // Every value is a number, or one of three fixed strings. Nothing that
        // could be a prompt, an option label, a URL or a project root.
        if (typeof v === 'string') {
          expect([POSTHOG_LIB_NAME, POSTHOG_LIB_VERSION, SURFACE, ID]).toContain(v);
        } else {
          expect(typeof v).toBe('number');
        }
      }
    }
  });
});

// ── failure is swallowed ─────────────────────────────────────────────────────

describe('a failed post is swallowed', () => {
  it('a non-2xx returns false and does not throw', async () => {
    const { store } = memStore();
    const { fetch } = fakeFetch(() => false);

    await expect(sendRating(store, 2, { fetch, now: T0 })).resolves.toBe(false);
  });

  it('a fetch that throws returns false and does not throw', async () => {
    const { store } = memStore();
    const fetch: FetchLike = async () => { throw new Error('offline'); };

    await expect(sendRating(store, 2, { fetch, now: T0 })).resolves.toBe(false);
  });

  it('a store that can be neither read nor written still sends, with a fresh id', async () => {
    // Deliberate, and documented in rating-identity.ts: a broken store must not
    // silence the one thing the user explicitly asked to send. The id cannot be
    // persisted, so continuity across sends is lost — that is the lesser harm.
    const store: TelemetryKeyStore = {
      getKey: async () => { throw new Error('gone'); },
      setKey: async () => { throw new Error('gone'); },
    };
    const { fetch, calls } = fakeFetch();

    await expect(sendRating(store, 2, { fetch, now: T0 })).resolves.toBe(true);
    expect(calls[0].body.distinct_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('with no fetch available at all, it returns false rather than throwing', async () => {
    // globalThis.fetch is REMOVED for this one case, not left in place with a
    // short timeout: `opts.fetch ?? globalThis.fetch` would otherwise reach the
    // real one and fire a live request at PostHog from the test suite.
    const { store } = memStore();
    const saved = globalThis.fetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = undefined;
    try {
      await expect(sendRating(store, 2, { now: T0 })).resolves.toBe(false);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).fetch = saved;
    }
  });

  it('⭐ no test in this file can reach the network', async () => {
    // The guard for the mistake above: every send here must go through an
    // injected fetch. If one ever forgets, this fails instead of quietly
    // posting a test event into production analytics.
    const { store } = memStore();
    const saved = globalThis.fetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = () => { throw new Error('live network reached from a test'); };
    try {
      const { fetch, calls } = fakeFetch();
      await sendRating(store, 1, { fetch, now: T0 });
      await flushLifecycle(store, { fetch });
      expect(calls.length).toBeGreaterThan(0);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).fetch = saved;
    }
  });
});

// ── the flush ────────────────────────────────────────────────────────────────

describe('flushLifecycle', () => {
  it('sends the install event, then the buffer oldest first', async () => {
    const { store } = memStore({ [KEY_INSTALLED_AT]: String(T0) });
    await recordSignal(store, SIGNAL_OPTION_SELECTED, T0 + 20);
    await recordSignal(store, SIGNAL_ADVISORY_FIRED,  T0 + 10);
    const { fetch, events } = fakeFetch();

    await flushLifecycle(store, { fetch });

    expect(events()).toEqual([EVENT_INSTALLED, EVENT_ADVISORY_FIRED, EVENT_OPTION_SELECTED]);
    expect(await readSignals(store)).toEqual([]);          // all pruned on success
  });

  it('⭐ the install event fires ONCE, and only after a successful post', async () => {
    const { store, data } = memStore({ [KEY_INSTALLED_AT]: String(T0) });

    // First flush: the post fails, so the flag must NOT be set.
    const failing = fakeFetch(() => false);
    await flushLifecycle(store, { fetch: failing.fetch });
    expect(failing.events()).toEqual([EVENT_INSTALLED]);
    expect(data[KEY_INSTALLED_EVENT_SENT]).toBeUndefined();

    // Second flush: it succeeds, so the flag is set...
    const ok = fakeFetch();
    await flushLifecycle(store, { fetch: ok.fetch });
    expect(ok.events()).toEqual([EVENT_INSTALLED]);
    expect(data[KEY_INSTALLED_EVENT_SENT]).toBe('true');

    // ...and it never fires again.
    const third = fakeFetch();
    await flushLifecycle(store, { fetch: third.fetch });
    expect(third.events()).toEqual([]);
  });

  it('⭐ a buffered signal survives a failed send and is not double-counted', async () => {
    const { store } = memStore({
      [KEY_INSTALLED_AT]: String(T0),
      [KEY_INSTALLED_EVENT_SENT]: 'true',
    });
    await recordSignal(store, SIGNAL_ADVISORY_FIRED,  T0 + 1);
    await recordSignal(store, SIGNAL_OPTION_SELECTED, T0 + 2);

    // Only the advisory one succeeds this round.
    const round1 = fakeFetch((body) => body.event === EVENT_ADVISORY_FIRED);
    await flushLifecycle(store, { fetch: round1.fetch });

    expect(round1.events()).toEqual([EVENT_ADVISORY_FIRED, EVENT_OPTION_SELECTED]);
    expect(await readSignals(store))
      .toEqual([{ kind: SIGNAL_OPTION_SELECTED, occurredAt: T0 + 2 }]);   // the failure stayed

    // Next round sends ONLY the survivor — the delivered one is gone for good.
    const round2 = fakeFetch();
    await flushLifecycle(store, { fetch: round2.fetch });

    expect(round2.events()).toEqual([EVENT_OPTION_SELECTED]);
    expect(await readSignals(store)).toEqual([]);
  });

  it('an empty buffer with the install already sent posts nothing at all', async () => {
    const { store } = memStore({
      [KEY_INSTALLED_AT]: String(T0),
      [KEY_INSTALLED_EVENT_SENT]: 'true',
    });
    const { fetch, calls } = fakeFetch();

    await flushLifecycle(store, { fetch });

    expect(calls).toEqual([]);
  });

  it('never throws, even when everything fails', async () => {
    const store: TelemetryKeyStore = {
      getKey: async () => { throw new Error('gone'); },
      setKey: async () => { throw new Error('gone'); },
    };
    const fetch: FetchLike = async () => { throw new Error('offline'); };

    await expect(flushLifecycle(store, { fetch })).resolves.toBeUndefined();
  });
});

// ── contract with the CLI ────────────────────────────────────────────────────

/**
 * Same discipline as `rating-cadence.test.ts` and `fixtures/rating.test.ts`:
 * read the shipped CLI modules as text and pin what this copy mirrors.
 */
describe('contract with the shipped CLI telemetry (the two must not drift)', () => {
  const cwd = process.cwd();
  const config    = readFileSync(join(cwd, 'src', 'store', 'config.ts'), 'utf8');
  const batcher   = readFileSync(join(cwd, 'src', 'telemetry', 'TelemetryBatcher.ts'), 'utf8');
  const feedback  = readFileSync(join(cwd, 'src', 'telemetry', 'feedback-send.ts'), 'utf8');
  const lifecycle = readFileSync(join(cwd, 'src', 'telemetry', 'lifecycle-send.ts'), 'utf8');
  const flush     = readFileSync(join(cwd, 'src', 'telemetry', 'lifecycle-flush.ts'), 'utf8');

  it('the endpoint and api key are the CLI\'s built-in defaults', () => {
    expect(config).toContain(`telemetry_sync_endpoint: '${POSTHOG_ENDPOINT}'`);
    expect(config).toContain(`telemetry_sync_api_key:  '${POSTHOG_API_KEY}'`);
  });

  it('the $lib name and version are the CLI\'s', () => {
    expect(batcher).toContain(`export const POSTHOG_LIB_NAME    = '${POSTHOG_LIB_NAME}';`);
    expect(batcher).toContain(`export const POSTHOG_LIB_VERSION = '${POSTHOG_LIB_VERSION}';`);
  });

  it('the four event names are the CLI\'s', () => {
    expect(feedback).toContain(`export const FEEDBACK_EVENT = '${FEEDBACK_EVENT}';`);
    expect(lifecycle).toContain(`export const EVENT_INSTALLED       = '${EVENT_INSTALLED}';`);
    expect(lifecycle).toContain(`export const EVENT_ADVISORY_FIRED  = '${EVENT_ADVISORY_FIRED}';`);
    expect(lifecycle).toContain(`export const EVENT_OPTION_SELECTED = '${EVENT_OPTION_SELECTED}';`);
  });

  it('the CLI still names the same envelope properties', () => {
    const flat = feedback.replace(/\s+/g, ' ');
    expect(flat).toContain('$lib: POSTHOG_LIB_NAME');
    expect(flat).toContain('$lib_version: POSTHOG_LIB_VERSION');
    expect(flat).toContain('installation_id: installationId');
    expect(flat).toContain('feedback_at: now');
  });

  it('the CLI still marks the install event sent only after a successful post', () => {
    const flat = flush.replace(/\s+/g, ' ');
    expect(flat).toContain('if (await sendInstalled(store, installedAt, opts)) { markInstalledEventSent(store); }');
  });

  it('the CLI still prunes a signal only after its own send succeeds', () => {
    const flat = flush.replace(/\s+/g, ' ');
    expect(flat).toContain('if (await sendAdvisoryFired(store, ts, opts)) { pruneSignalAt(store, SIGNAL_ADVISORY_FIRED, ts); }');
    expect(flat).toContain('if (await sendOptionSelected(store, ts, opts)) { pruneSignalAt(store, SIGNAL_OPTION_SELECTED, ts); }');
  });
});
