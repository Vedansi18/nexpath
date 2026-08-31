import { describe, it, expect } from 'vitest';
import {
  readSignals, recordSignal, pruneSignalAt,
  getInstalledAt, setInstalledAtIfMissing,
  isInstalledEventSent, markInstalledEventSent,
  SIGNAL_ADVISORY_FIRED, SIGNAL_OPTION_SELECTED,
  KEY_SIGNALS, KEY_INSTALLED_AT, KEY_INSTALLED_EVENT_SENT, MAX_SIGNALS,
  type LifecycleSignalsKeyStore,
} from './lifecycle-signals.js';

function memStore(seed: Record<string, string> = {}) {
  const data = { ...seed };
  const store: LifecycleSignalsKeyStore = {
    getKey: async (k) => (k in data ? data[k] : null),
    setKey: async (k, v) => { data[k] = v; },
  };
  return { store, data };
}

const T0 = 1_700_000_000_000;

describe('the signal buffer', () => {
  it('starts empty', async () => {
    expect(await readSignals(memStore().store)).toEqual([]);
  });

  it('records and reads back oldest first, whatever order they arrive in', async () => {
    const { store } = memStore();

    await recordSignal(store, SIGNAL_OPTION_SELECTED, T0 + 200);
    await recordSignal(store, SIGNAL_ADVISORY_FIRED,  T0);
    await recordSignal(store, SIGNAL_ADVISORY_FIRED,  T0 + 100);

    expect(await readSignals(store)).toEqual([
      { kind: SIGNAL_ADVISORY_FIRED,  occurredAt: T0 },
      { kind: SIGNAL_ADVISORY_FIRED,  occurredAt: T0 + 100 },
      { kind: SIGNAL_OPTION_SELECTED, occurredAt: T0 + 200 },
    ]);
  });

  it('⭐ stores nothing but a kind and a timestamp', async () => {
    // The privacy claim, checked against what is actually on disk rather than
    // against the type: no prompt text, option text, index, URL or root.
    const { store, data } = memStore();
    await recordSignal(store, SIGNAL_ADVISORY_FIRED, T0);

    const stored = JSON.parse(data[KEY_SIGNALS]);
    expect(Object.keys(stored[0]).sort()).toEqual(['kind', 'occurredAt']);
  });

  it('caps at MAX_SIGNALS, dropping the OLDEST', async () => {
    const { store } = memStore({
      [KEY_SIGNALS]: JSON.stringify(
        Array.from({ length: MAX_SIGNALS }, (_, i) => ({ kind: SIGNAL_ADVISORY_FIRED, occurredAt: T0 + i })),
      ),
    });

    await recordSignal(store, SIGNAL_OPTION_SELECTED, T0 + MAX_SIGNALS);

    const list = await readSignals(store);
    expect(list).toHaveLength(MAX_SIGNALS);
    expect(list[0].occurredAt).toBe(T0 + 1);                       // the oldest went
    expect(list[list.length - 1]).toEqual({ kind: SIGNAL_OPTION_SELECTED, occurredAt: T0 + MAX_SIGNALS });
  });

  it('prunes exactly one (kind, occurredAt) and leaves everything else', async () => {
    const { store } = memStore();
    await recordSignal(store, SIGNAL_ADVISORY_FIRED,  T0);
    await recordSignal(store, SIGNAL_OPTION_SELECTED, T0);          // same ts, other kind
    await recordSignal(store, SIGNAL_ADVISORY_FIRED,  T0 + 1);

    await pruneSignalAt(store, SIGNAL_ADVISORY_FIRED, T0);

    expect(await readSignals(store)).toEqual([
      { kind: SIGNAL_OPTION_SELECTED, occurredAt: T0 },
      { kind: SIGNAL_ADVISORY_FIRED,  occurredAt: T0 + 1 },
    ]);
  });

  it('pruning a pair removes its duplicates too, as the CLI DELETE does', async () => {
    const { store } = memStore();
    await recordSignal(store, SIGNAL_ADVISORY_FIRED, T0);
    await recordSignal(store, SIGNAL_ADVISORY_FIRED, T0);

    await pruneSignalAt(store, SIGNAL_ADVISORY_FIRED, T0);

    expect(await readSignals(store)).toEqual([]);
  });

  it('pruning something that is not there changes nothing', async () => {
    const { store } = memStore();
    await recordSignal(store, SIGNAL_ADVISORY_FIRED, T0);

    await pruneSignalAt(store, SIGNAL_OPTION_SELECTED, T0);

    expect(await readSignals(store)).toHaveLength(1);
  });
});

describe('a damaged buffer reads as empty, never as junk', () => {
  it.each([
    ['malformed JSON',   '{not json'],
    ['a JSON non-array', '{"kind":"advisory_fired"}'],
    ['a JSON scalar',    '42'],
  ])('%s', async (_label, raw) => {
    expect(await readSignals(memStore({ [KEY_SIGNALS]: raw }).store)).toEqual([]);
  });

  it('⭐ drops entries that are not well-formed signals', async () => {
    // Otherwise a junk `kind` reaches the flush and is posted as an event NAME.
    const { store } = memStore({
      [KEY_SIGNALS]: JSON.stringify([
        { kind: SIGNAL_ADVISORY_FIRED, occurredAt: T0 },
        { kind: 'drop_table_users',    occurredAt: T0 + 1 },   // unknown kind
        { kind: SIGNAL_ADVISORY_FIRED, occurredAt: 'soon' },   // bad timestamp
        { kind: SIGNAL_ADVISORY_FIRED },                       // no timestamp
        null,
        'a string',
      ]),
    });

    expect(await readSignals(store)).toEqual([{ kind: SIGNAL_ADVISORY_FIRED, occurredAt: T0 }]);
  });

  it('an unreadable store reads as empty', async () => {
    const store: LifecycleSignalsKeyStore = {
      getKey: async () => { throw new Error('gone'); },
      setKey: async () => {},
    };
    expect(await readSignals(store)).toEqual([]);
  });

  it('an unwritable store does not throw out of recordSignal', async () => {
    const store: LifecycleSignalsKeyStore = {
      getKey: async () => null,
      setKey: async () => { throw new Error('quota'); },
    };
    await expect(recordSignal(store, SIGNAL_ADVISORY_FIRED, T0)).resolves.toBeUndefined();
  });
});

describe('the install stamp', () => {
  it('setInstalledAtIfMissing writes once and never overwrites', async () => {
    const { store, data } = memStore();

    await setInstalledAtIfMissing(store, T0);
    await setInstalledAtIfMissing(store, T0 + 99_999);

    expect(data[KEY_INSTALLED_AT]).toBe(String(T0));
  });

  it('getInstalledAt backfills a missing stamp once, then reads it back', async () => {
    const { store, data } = memStore();

    expect(await getInstalledAt(store, T0)).toBe(T0);
    expect(data[KEY_INSTALLED_AT]).toBe(String(T0));
    expect(await getInstalledAt(store, T0 + 5_000)).toBe(T0);       // not re-stamped
  });

  it('a corrupt stamp is treated as absent and re-stamped', async () => {
    const { store } = memStore({ [KEY_INSTALLED_AT]: 'yesterday' });

    expect(await getInstalledAt(store, T0)).toBe(T0);
  });
});

describe('the install-event sent flag', () => {
  it('is false until marked, true after', async () => {
    const { store, data } = memStore();

    expect(await isInstalledEventSent(store)).toBe(false);
    await markInstalledEventSent(store);
    expect(await isInstalledEventSent(store)).toBe(true);
    expect(data[KEY_INSTALLED_EVENT_SENT]).toBe('true');
  });

  it('⭐ an unreadable flag reads as NOT sent', async () => {
    // Fails toward a duplicate install event rather than toward losing the
    // denominator entirely.
    const store: LifecycleSignalsKeyStore = {
      getKey: async () => { throw new Error('gone'); },
      setKey: async () => {},
    };
    expect(await isInstalledEventSent(store)).toBe(false);
  });

  it('anything other than the exact string "true" is not sent', async () => {
    const { store } = memStore({ [KEY_INSTALLED_EVENT_SENT]: 'TRUE' });
    expect(await isInstalledEventSent(store)).toBe(false);
  });
});
