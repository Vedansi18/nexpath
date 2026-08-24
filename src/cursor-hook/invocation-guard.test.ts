/** ⭐ RC50 — duplicate hook registrations must not double-run the flow. */
import { describe, it, expect } from 'vitest';
import { checkAndRecordCursorInvocation, CURSOR_INVOCATION_MAX_AGE_MS } from './invocation-guard.js';

function mem() {
  const files = new Map<string, string>();
  return {
    readFileFn: (p: string) => { const v = files.get(p); if (v === undefined) throw new Error('ENOENT'); return v; },
    writeFileFn: (p: string, d: string) => { files.set(p, d); },
  };
}

describe('⭐ RC50 — checkAndRecordCursorInvocation', () => {
  it('⭐ first sight records and returns false; the SAME key returns true', () => {
    const fs = mem();
    expect(checkAndRecordCursorInvocation('/p', 'beforeSubmitPrompt', 'gen-1', { ...fs, now: () => 1000 })).toBe(false);
    expect(checkAndRecordCursorInvocation('/p', 'beforeSubmitPrompt', 'gen-1', { ...fs, now: () => 1500 })).toBe(true);
  });
  it('a different generation is not a duplicate', () => {
    const fs = mem();
    checkAndRecordCursorInvocation('/p', 'beforeSubmitPrompt', 'gen-1', { ...fs, now: () => 1000 });
    expect(checkAndRecordCursorInvocation('/p', 'beforeSubmitPrompt', 'gen-2', { ...fs, now: () => 1001 })).toBe(false);
  });
  it('expired entries no longer count', () => {
    const fs = mem();
    checkAndRecordCursorInvocation('/p', 'e', 'gen-1', { ...fs, now: () => 1000 });
    expect(checkAndRecordCursorInvocation('/p', 'e', 'gen-1', { ...fs, now: () => 1000 + CURSOR_INVOCATION_MAX_AGE_MS + 1 })).toBe(false);
  });
  it('⭐ no generation id ⇒ never a duplicate (fail-open)', () => {
    expect(checkAndRecordCursorInvocation('/p', 'e', undefined, mem())).toBe(false);
  });
  it('fs errors ⇒ never a duplicate (fail-open)', () => {
    expect(checkAndRecordCursorInvocation('/p', 'e', 'gen-1', {
      readFileFn: () => { throw new Error('boom'); },
      writeFileFn: () => { throw new Error('disk full'); },
    })).toBe(false);
  });
});
