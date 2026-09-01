import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, closeStore, type Store } from '../../store/db.js';
import { recordSignalAction } from './record-signal.js';

// The command opens the CLI-owned store, records one content-free signal, and
// closes it. Tests drive a real temp-file DB so the write is observable across
// the open/close boundary (a fresh `:memory:` DB would not persist between calls).

interface Row { project_root: string; kind: string; occurred_at: number }

function readRows(store: Store): Row[] {
  const res = store.db.exec(
    'SELECT project_root, kind, occurred_at FROM feedback_signals ORDER BY occurred_at ASC',
  );
  return (res[0]?.values ?? []).map((r) => ({
    project_root: r[0] as string,
    kind:         r[1] as string,
    occurred_at:  r[2] as number,
  }));
}

describe('record-signal command', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nexpath-recsig-'));
    dbPath = join(dir, 'store.db');
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  async function rows(): Promise<Row[]> {
    const store = await openStore(dbPath);
    try { return readRows(store); } finally { closeStore(store); }
  }

  it('records a valid per-action kind as exactly one content-free row', async () => {
    const code = await recordSignalAction({ kind: 'pe_shorter', project: '/proj', at: '1000', db: dbPath });
    expect(code).toBe(0);
    expect(await rows()).toEqual([{ project_root: '/proj', kind: 'pe_shorter', occurred_at: 1000 }]);
  });

  it('records pe_shown (the shown-popup kind)', async () => {
    const code = await recordSignalAction({ kind: 'pe_shown', project: '/p', at: '7', db: dbPath });
    expect(code).toBe(0);
    expect(await rows()).toEqual([{ project_root: '/p', kind: 'pe_shown', occurred_at: 7 }]);
  });

  it('records the two standalone signals (advisory_fired, option_selected)', async () => {
    expect(await recordSignalAction({ kind: 'advisory_fired',  project: '/p', at: '1', db: dbPath })).toBe(0);
    expect(await recordSignalAction({ kind: 'option_selected', project: '/p', at: '2', db: dbPath })).toBe(0);
    expect((await rows()).map((r) => r.kind)).toEqual(['advisory_fired', 'option_selected']);
  });

  it('rejects an invalid kind with exit 1 and writes nothing', async () => {
    const code = await recordSignalAction({ kind: 'not_a_kind', project: '/p', at: '1', db: dbPath });
    expect(code).toBe(1);
    expect(await rows()).toEqual([]);
  });

  it('rejects a non-numeric --at with exit 1 and writes nothing', async () => {
    const code = await recordSignalAction({ kind: 'pe_close', project: '/p', at: 'abc', db: dbPath });
    expect(code).toBe(1);
    expect(await rows()).toEqual([]);
  });

  it('respects an explicit --at timestamp', async () => {
    await recordSignalAction({ kind: 'pe_use_current', project: '/p', at: '424242', db: dbPath });
    expect((await rows())[0]?.occurred_at).toBe(424242);
  });

  it('defaults --at to now when omitted', async () => {
    const before = Date.now();
    await recordSignalAction({ kind: 'pe_back', project: '/p', db: dbPath });
    const after = Date.now();
    const ts = (await rows())[0]?.occurred_at ?? 0;
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('handles rapid sequential calls without loss or corruption', async () => {
    const kinds = ['pe_shorter', 'pe_more_thorough', 'pe_apply_details', 'pe_close', 'pe_use_original'];
    let at = 100;
    for (const kind of kinds) {
      expect(await recordSignalAction({ kind, project: '/p', at: String(at++), db: dbPath })).toBe(0);
    }
    const r = await rows();
    expect(r.length).toBe(kinds.length);
    expect(r.map((x) => x.kind)).toEqual(kinds);
  });
});
