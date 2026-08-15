import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openStore, closeStore, type Store } from './db.js';
import {
  getInstalledAt,
  setInstalledAtIfMissing,
  isInstalledEventSent,
  markInstalledEventSent,
  recordAdvisoryFired,
  recordOptionSelected,
  readSignals,
  pruneSignalsUpTo,
  readAllSignals,
  pruneAllSignalsUpTo,
  pruneSignalAt,
  pruneSignalsOfKind,
  recordActionSignal,
  readAllActionSignals,
  SIGNAL_ADVISORY_FIRED,
  SIGNAL_OPTION_SELECTED,
} from './feedback-signals.js';

let store: Store;

beforeEach(async () => { store = await openStore(':memory:'); });
afterEach(() => closeStore(store));

describe('recordActionSignal / readAllActionSignals (NF Plan B)', () => {
  it('records content-free per-action signals (kind + ts) and reads them oldest-first', () => {
    recordActionSignal(store, '/proj', 'pe_shorter', 100);
    recordActionSignal(store, '/proj', 'mps_send', 200);
    expect(readAllActionSignals(store)).toEqual([
      { kind: 'pe_shorter', occurredAt: 100 },
      { kind: 'mps_send',   occurredAt: 200 },
    ]);
  });

  it('readAllActionSignals ignores non-action signals (advisory_fired / option_selected)', () => {
    recordAdvisoryFired(store, '/proj', 50);
    recordOptionSelected(store, '/proj', 60);
    recordActionSignal(store, '/proj', 'pe_back', 70);
    expect(readAllActionSignals(store)).toEqual([{ kind: 'pe_back', occurredAt: 70 }]);
  });
});

describe('getInstalledAt', () => {
  it('sets the install timestamp once when missing and returns it stably', () => {
    const first  = getInstalledAt(store);
    const second = getInstalledAt(store);
    expect(first).toBeGreaterThan(0);
    expect(second).toBe(first);
  });

  it('setInstalledAtIfMissing does not overwrite an existing value', () => {
    setInstalledAtIfMissing(store, 1000);
    setInstalledAtIfMissing(store, 9999);
    expect(getInstalledAt(store)).toBe(1000);
  });

  it('returns a number, not the stored string', () => {
    setInstalledAtIfMissing(store, 1234);
    const value = getInstalledAt(store);
    expect(value).toBe(1234);
    expect(typeof value).toBe('number');
  });
});

describe('recording signals', () => {
  it('records advisory-fire and option-select timestamps, oldest first', () => {
    recordAdvisoryFired(store, '/p', 100);
    recordOptionSelected(store, '/p', 150);
    recordAdvisoryFired(store, '/p', 200);

    const signals = readSignals(store, '/p');
    expect(signals.advisoryFireTs).toEqual([100, 200]);
    expect(signals.optionSelectTs).toEqual([150]);
  });

  it('isolates signals per project', () => {
    recordAdvisoryFired(store, '/a', 100);
    recordAdvisoryFired(store, '/b', 200);
    expect(readSignals(store, '/a').advisoryFireTs).toEqual([100]);
    expect(readSignals(store, '/b').advisoryFireTs).toEqual([200]);
  });

  it('returns empty arrays for a project with no signals', () => {
    expect(readSignals(store, '/none')).toEqual({ advisoryFireTs: [], optionSelectTs: [] });
  });

  it('defaults to the current time when no timestamp is given', () => {
    const before = Date.now();
    recordAdvisoryFired(store, '/p');
    recordOptionSelected(store, '/p');
    const after = Date.now();
    const signals = readSignals(store, '/p');
    expect(signals.advisoryFireTs).toHaveLength(1);
    expect(signals.optionSelectTs).toHaveLength(1);
    expect(signals.advisoryFireTs[0]).toBeGreaterThanOrEqual(before);
    expect(signals.advisoryFireTs[0]).toBeLessThanOrEqual(after);
  });
});

describe('content-free storage', () => {
  it('feedback_signals holds only id, project_root, kind, occurred_at (no text/index)', () => {
    const res  = store.db.exec('PRAGMA table_info(feedback_signals)');
    const cols = (res[0]?.values ?? []).map((r) => r[1] as string).sort();
    expect(cols).toEqual(['id', 'kind', 'occurred_at', 'project_root']);
  });
});

describe('pruneSignalsUpTo', () => {
  it('deletes signals at or before the cutoff, keeps newer ones', () => {
    recordAdvisoryFired(store, '/p', 100);
    recordOptionSelected(store, '/p', 150);
    recordAdvisoryFired(store, '/p', 300);

    pruneSignalsUpTo(store, '/p', 150);

    const signals = readSignals(store, '/p');
    expect(signals.advisoryFireTs).toEqual([300]);
    expect(signals.optionSelectTs).toEqual([]);
  });

  it('only prunes the given project', () => {
    recordAdvisoryFired(store, '/a', 100);
    recordAdvisoryFired(store, '/b', 100);
    pruneSignalsUpTo(store, '/a', 100);
    expect(readSignals(store, '/a').advisoryFireTs).toEqual([]);
    expect(readSignals(store, '/b').advisoryFireTs).toEqual([100]);
  });

  it('keeps everything when the cutoff is before all signals', () => {
    recordAdvisoryFired(store, '/p', 100);
    recordOptionSelected(store, '/p', 200);
    pruneSignalsUpTo(store, '/p', 50);
    expect(readSignals(store, '/p')).toEqual({ advisoryFireTs: [100], optionSelectTs: [200] });
  });
});

describe('readAllSignals (global)', () => {
  it('aggregates across all projects, oldest first, split by kind', () => {
    recordAdvisoryFired(store, '/a', 300);
    recordAdvisoryFired(store, '/b', 100);
    recordOptionSelected(store, '/a', 200);
    recordOptionSelected(store, '/b', 50);

    const all = readAllSignals(store);
    expect(all.advisoryFireTs).toEqual([100, 300]);
    expect(all.optionSelectTs).toEqual([50, 200]);
  });

  it('returns empty arrays when nothing is recorded', () => {
    expect(readAllSignals(store)).toEqual({ advisoryFireTs: [], optionSelectTs: [] });
  });
});

describe('pruneAllSignalsUpTo (global)', () => {
  it('deletes signals across every project at or before the cutoff', () => {
    recordAdvisoryFired(store, '/a', 100);
    recordAdvisoryFired(store, '/b', 150);
    recordOptionSelected(store, '/a', 400);

    pruneAllSignalsUpTo(store, 150);

    expect(readAllSignals(store)).toEqual({ advisoryFireTs: [], optionSelectTs: [400] });
  });
});

describe('installed-event-sent flag', () => {
  it('defaults to false before the install event is sent', () => {
    expect(isInstalledEventSent(store)).toBe(false);
  });

  it('is true after markInstalledEventSent', () => {
    markInstalledEventSent(store);
    expect(isInstalledEventSent(store)).toBe(true);
  });

  it('stays true when marked again (idempotent)', () => {
    markInstalledEventSent(store);
    markInstalledEventSent(store);
    expect(isInstalledEventSent(store)).toBe(true);
  });
});

describe('pruneSignalAt (precise)', () => {
  it('deletes only the exact (kind, ts) pair, leaving other kinds at the same ts', () => {
    recordAdvisoryFired(store, '/p', 100);
    recordOptionSelected(store, '/p', 100);

    pruneSignalAt(store, SIGNAL_ADVISORY_FIRED, 100);

    expect(readAllSignals(store)).toEqual({ advisoryFireTs: [], optionSelectTs: [100] });
  });

  it('leaves other timestamps of the same kind untouched', () => {
    recordAdvisoryFired(store, '/p', 100);
    recordAdvisoryFired(store, '/p', 200);

    pruneSignalAt(store, SIGNAL_ADVISORY_FIRED, 100);

    expect(readAllSignals(store).advisoryFireTs).toEqual([200]);
  });

  it('is a no-op when nothing matches', () => {
    recordAdvisoryFired(store, '/p', 100);
    pruneSignalAt(store, SIGNAL_OPTION_SELECTED, 100);
    expect(readAllSignals(store).advisoryFireTs).toEqual([100]);
  });
});

describe('pruneSignalsOfKind', () => {
  it('deletes every signal of the given kind, leaving other kinds untouched', () => {
    recordOptionSelected(store, '/a', 100);
    recordOptionSelected(store, '/b', 200);
    recordAdvisoryFired(store, '/a', 150);

    pruneSignalsOfKind(store, SIGNAL_OPTION_SELECTED);

    expect(readAllSignals(store)).toEqual({ advisoryFireTs: [150], optionSelectTs: [] });
  });

  it('is a no-op when no signal of that kind exists', () => {
    recordAdvisoryFired(store, '/a', 100);
    pruneSignalsOfKind(store, SIGNAL_OPTION_SELECTED);
    expect(readAllSignals(store).advisoryFireTs).toEqual([100]);
  });
});

describe('persistence across reopen (real DB file)', () => {
  it('install timestamp and signals survive a close/reopen on an existing DB', async () => {
    const dbPath = join(tmpdir(), `nexpath-feedback-signals-${randomUUID()}.db`);
    try {
      let s = await openStore(dbPath);
      setInstalledAtIfMissing(s, 4242);
      recordAdvisoryFired(s, '/proj', 100);
      recordOptionSelected(s, '/proj', 200);
      closeStore(s);

      // Reopen: migrate() must find/keep the tables on an already-created file.
      s = await openStore(dbPath);
      expect(getInstalledAt(s)).toBe(4242);
      expect(readSignals(s, '/proj')).toEqual({ advisoryFireTs: [100], optionSelectTs: [200] });
      closeStore(s);
    } finally {
      rmSync(dbPath, { force: true });
      rmSync(`${dbPath}.lock`, { force: true });
    }
  });
});
