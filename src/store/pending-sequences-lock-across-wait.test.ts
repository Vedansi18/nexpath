import { describe, it, expect, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openStore, closeStore, saveStore, withReleasedStoreLockV1 } from './db.js';
import { upsertPendingPromptSequence, updatePendingPromptSequenceState, getActivePendingPromptSequence } from './pending-sequences.js';
import { emptyPromptEnhancementSequencePayloadV1 } from '../prompt-enhancement/sequence-payload.js';
import type { PromptEnhancementSequenceRuntimeStateV1 } from '../prompt-enhancement/sequence-runtime.js';

// MPS shell Stage D (fixture acceptance-sequence-store-lock-not-held-across-wait), file-backed. db-lock.test.ts
// proves the generic mechanism; this proves the MPS row specifically: a sequence row left open across the
// continuation-popup wait is NOT held, and a concurrent session's advance SURVIVES the re-acquire (the db is
// reloaded from disk), with `updated_at` moving — which is exactly the signal stop.ts's reload-before-write
// uses to make a stale offer a silent no-op instead of clobbering the concurrent write. (`:memory:` can't
// show this — its lock is a no-op — so this test is deliberately file-backed.)

const paths: string[] = [];
function tmpDb(): string { const p = join(tmpdir(), `nexpath-mps-lock-${randomUUID()}.db`); paths.push(p); return p; }
afterEach(() => { for (const p of paths.splice(0)) { try { rmSync(p, { force: true }); rmSync(p + '.lock', { force: true, recursive: true }); } catch { /* noop */ } } });

const PROJECT = '/tmp/mps-lock';
function seedState(over: Partial<PromptEnhancementSequenceRuntimeStateV1> = {}): PromptEnhancementSequenceRuntimeStateV1 {
  return { sequenceId: 'seq-lock', enhancementId: 'enh-lock', projectRoot: PROJECT, sessionId: 's1', itemCount: 3, currentItemIndex: 1, status: 'item_pending', lastActionId: 'a0', ...over };
}

describe('MPS continuation store lock — not held across the popup wait, concurrent advance survives (Stage D)', () => {
  it('a concurrent session advances the row during the wait, and the re-acquire reloads it (updated_at moves)', async () => {
    const dbPath = tmpDb();
    const a = await openStore(dbPath);
    upsertPendingPromptSequence(a, seedState(), emptyPromptEnhancementSequencePayloadV1(50));
    saveStore(a); // flush to disk so the concurrent session reads the seeded row
    const before = getActivePendingPromptSequence(a, PROJECT, 's1');
    expect(before?.currentItemIndex).toBe(1);

    // The user leaves the continuation popup open; meanwhile ANOTHER session advances the sequence.
    await withReleasedStoreLockV1(a, async () => {
      const b = await openStore(dbPath); // acquires the lock `a` released — proves it was NOT held
      const row = getActivePendingPromptSequence(b, PROJECT, 's1');
      expect(row).not.toBeNull();
      updatePendingPromptSequenceState(b, row!.id, seedState({ currentItemIndex: 2, status: 'awaiting_response', lastActionId: 'a1' }));
      closeStore(b); // flush + release the lock
    });

    // `a` re-acquired AND reloaded from disk → it sees `b`'s advance, not its own stale image.
    const after = getActivePendingPromptSequence(a, PROJECT, 's1');
    expect(after?.currentItemIndex).toBe(2);           // the concurrent write survived (not clobbered)
    expect(after?.status).toBe('awaiting_response');
    expect(after?.updatedAt).not.toBe(before?.updatedAt); // updated_at moved → stop.ts's reload check no-ops a stale offer
    closeStore(a);
  });

  it('an unchanged row keeps the same updated_at across the wait — the offer stays valid (no false no-op)', async () => {
    const dbPath = tmpDb();
    const a = await openStore(dbPath);
    upsertPendingPromptSequence(a, seedState(), emptyPromptEnhancementSequencePayloadV1(50));
    saveStore(a);
    const before = getActivePendingPromptSequence(a, PROJECT, 's1');

    await withReleasedStoreLockV1(a, async () => { /* no concurrent writer this time */ });

    const after = getActivePendingPromptSequence(a, PROJECT, 's1');
    expect(after?.updatedAt).toBe(before?.updatedAt); // no concurrent write → stop.ts proceeds with the offer
    closeStore(a);
  });
});
