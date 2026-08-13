/**
 * Acceptance executor — batch 6: the store-invariant fixtures the lock helper drives.
 *
 * Backing test named for the fixture (`test:${fixtureId}`), exercising the real store helper the
 * runtime waits behind. Does NOT mark the register fixture as passing — the owner oracle judges
 * readiness. Mirrors store/db-lock.test.ts, the proven shape for driving the lock helper.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openStore, closeStore, withReleasedStoreLockV1 } from '../store/db.js';
import { getConfig, setConfig } from '../store/config.js';

const paths: string[] = [];
function tmpDb(): string {
  const p = join(tmpdir(), `nexpath-accept-lock-${randomUUID()}.db`);
  paths.push(p);
  return p;
}
afterEach(() => {
  for (const p of paths.splice(0)) {
    rmSync(p, { force: true });
    rmSync(`${p}.lock`, { force: true });
  }
});

describe('acceptance executor (batch 6) — store-invariant fixtures', () => {
  it('test:acceptance-sequence-store-lock-not-held-across-wait', async () => {
    const dbPath = tmpDb();
    const a = await openStore(dbPath);
    setConfig(a, 'k', 'a-value');

    // store_lock_not_held_across_a_wait: while the runtime waits, the lock is released, so another
    // session can open the same DB and write — the wait never blocks a second holder.
    const returned = await withReleasedStoreLockV1(a, async () => {
      const b = await openStore(dbPath);
      setConfig(b, 'k', 'b-value');
      closeStore(b);
      return 'waited';
    });

    // reacquire_and_reload: the value the other session wrote is seen, not A's stale image, and A's
    // later write does not clobber it.
    expect(returned).toBe('waited');
    expect(getConfig(a.db, 'k')).toBe('b-value');
    setConfig(a, 'k2', 'a2');
    closeStore(a);

    const c = await openStore(dbPath);
    expect(getConfig(c.db, 'k')).toBe('b-value');
    expect(getConfig(c.db, 'k2')).toBe('a2');
    closeStore(c);
  });
});
