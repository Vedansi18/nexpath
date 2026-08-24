/**
 * ⭐ RC50/RC56 — duplicate hook registrations must not double-run the flow,
 * and the claim must be ATOMIC (exclusive create): the measured 2–100 ms
 * invocation stagger made a read-modify-write registry a coin-flip.
 */
import { describe, it, expect } from 'vitest';
import { checkAndRecordCursorInvocation, cursorInvocationMarkerName } from './invocation-guard.js';

function memFs() {
  const files = new Set<string>();
  const mtimes = new Map<string, number>();
  return {
    files, mtimes,
    deps: (now: number) => ({
      now: () => now,
      mkdirFn: () => {},
      writeExclusiveFn: (p: string) => {
        if (files.has(p)) throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
        files.add(p); mtimes.set(p, now);
      },
      readdirFn: () => [...files].map((p) => p.split('/').pop()!),
      mtimeMsFn: (p: string) => mtimes.get(p) ?? [...mtimes.values()][0] ?? now,
      removeFn: (p: string) => { for (const f of [...files]) if (f.endsWith(p.split('/').pop()!)) { files.delete(f); mtimes.delete(f); } },
    }),
  };
}

describe('⭐ RC50/RC56 — atomic duplicate-invocation claim', () => {
  it('⭐ first claim wins (false); the SAME key is a duplicate (true) — arbitration is the create itself', () => {
    const fs = memFs();
    expect(checkAndRecordCursorInvocation('/p', 'beforeSubmitPrompt', 'gen-1', fs.deps(1000))).toBe(false);
    expect(checkAndRecordCursorInvocation('/p', 'beforeSubmitPrompt', 'gen-1', fs.deps(1002))).toBe(true);
  });

  it('a different generation is not a duplicate', () => {
    const fs = memFs();
    checkAndRecordCursorInvocation('/p', 'beforeSubmitPrompt', 'gen-1', fs.deps(1000));
    expect(checkAndRecordCursorInvocation('/p', 'beforeSubmitPrompt', 'gen-2', fs.deps(1001))).toBe(false);
  });

  it('⭐ no generation id ⇒ never a duplicate (fail-open)', () => {
    expect(checkAndRecordCursorInvocation('/p', 'e', undefined, memFs().deps(1000))).toBe(false);
  });

  it('non-EEXIST fs errors ⇒ fail-open (run the flow)', () => {
    expect(checkAndRecordCursorInvocation('/p', 'e', 'gen-1', {
      mkdirFn: () => {}, writeExclusiveFn: () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); },
    })).toBe(false);
  });

  it('stale markers are pruned by the winner', () => {
    const fs = memFs();
    checkAndRecordCursorInvocation('/p', 'e', 'old', fs.deps(1000));
    checkAndRecordCursorInvocation('/p', 'e', 'new', fs.deps(1000 + 10 * 60_000 + 1));
    const names = [...fs.files].map((p) => p.split('/').pop()!);
    expect(names).not.toContain(cursorInvocationMarkerName('e', 'old'));
    expect(names).toContain(cursorInvocationMarkerName('e', 'new'));
  });

  it('marker names are fs-safe', () => {
    expect(cursorInvocationMarkerName('beforeSubmitPrompt', 'a/b:c*d')).toBe('beforeSubmitPrompt-a_b_c_d');
  });
});
