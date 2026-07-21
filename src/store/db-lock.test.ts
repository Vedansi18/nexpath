import { describe, it, expect, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openStore, closeStore, releaseStoreLock, reacquireStoreLock } from './db.js';
import { getConfig, setConfig } from './config.js';

const paths: string[] = [];
function tmpDb(): string {
  const p = join(tmpdir(), `nexpath-lock-${randomUUID()}.db`);
  paths.push(p);
  return p;
}
afterEach(() => {
  for (const p of paths.splice(0)) {
    rmSync(p, { force: true });
    rmSync(`${p}.lock`, { force: true });
  }
});

describe('releaseStoreLock / reacquireStoreLock', () => {
  it('lets another session acquire the lock while released, then reloads its write without clobbering', async () => {
    const dbPath = tmpDb();
    const a = await openStore(dbPath);
    setConfig(a, 'k', 'a-value');

    // A releases its lock during a (simulated) blocking operation, keeping its db.
    releaseStoreLock(a);

    // Another session can now open the same DB (lock free) and write.
    const b = await openStore(dbPath);
    setConfig(b, 'k', 'b-value');
    closeStore(b);   // persists + releases B's lock

    // A re-acquires and reloads → sees B's write rather than its stale image.
    await reacquireStoreLock(a);
    expect(getConfig(a.db, 'k')).toBe('b-value');

    // A's own later save must not lose B's change.
    setConfig(a, 'k2', 'a2');
    closeStore(a);

    const c = await openStore(dbPath);
    expect(getConfig(c.db, 'k')).toBe('b-value');   // B's write survived
    expect(getConfig(c.db, 'k2')).toBe('a2');       // A's later write survived
    closeStore(c);
  });

  it('is a no-op for :memory: stores (db kept, still usable)', async () => {
    const s = await openStore(':memory:');
    setConfig(s, 'k', 'v');
    releaseStoreLock(s);
    await reacquireStoreLock(s);
    expect(getConfig(s.db, 'k')).toBe('v');   // preserved, not reopened empty
    closeStore(s);
  });
});
