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
import { recordPromptEnhancementSequenceOfferDeclined } from '../store/pending-sequences.js';

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

  it('test:acceptance-sequence-persist-before-block-and-exit', async () => {
    const s = await openStore(tmpDb());
    const params = {
      projectRoot: '/tmp/p', sessionId: 's1', sequenceId: 'seq-1', enhancementId: 'enh-1', disposition: 'rejected' as const,
    };

    // state_persisted_before_forced_exit + no_fire_and_forget_write: the write is SYNCHRONOUS and
    // CHECKED — it returns a boolean rather than being fired and forgotten on the exit path.
    expect(recordPromptEnhancementSequenceOfferDeclined(s, params)).toBe(true);

    // state_readable_after_the_exit_reflects_the_decision: the persisted decision is read back — a
    // second identical write is confirmed from the store, and a disagreeing one is refused.
    expect(recordPromptEnhancementSequenceOfferDeclined(s, params)).toBe(true);
    expect(recordPromptEnhancementSequenceOfferDeclined(s, { ...params, disposition: 'not_engaged' })).toBe(false);
    closeStore(s);
  });
});
