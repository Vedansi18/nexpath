/**
 * H8 G-ARBITRATION Finding 1 — the DS bridge must not double-inject a
 * submit-flow replacement, and must keep delivering genuine popup selections.
 */
import { describe, it, expect, vi } from 'vitest';
import { isSubmitFlowReplacement } from './submit-replacement-guard.js';

const deps = (over: Record<string, unknown> = {}) => ({
  roots: ['/proj', '/proj-canon'],
  isRecentSubmitDelivery: () => false,
  peekPendingDecision: async () => null,
  ...over,
}) as never;

describe('both poller orderings are covered', () => {
  it('submit poller delivered FIRST ⇒ recognised via the in-memory record', async () => {
    // The decision file is already consumed (one-shot), so only the record knows.
    await expect(isSubmitFlowReplacement('replacement', deps({
      isRecentSubmitDelivery: (_r: string, t: string) => t === 'replacement',
    }))).resolves.toBe(true);
  });

  it('DS poller ticked FIRST ⇒ recognised via the non-consuming peek', async () => {
    // The submit poller has not consumed the file yet; the record is empty.
    await expect(isSubmitFlowReplacement('replacement', deps({
      peekPendingDecision: async () => ({ replacementText: 'replacement' }),
    }))).resolves.toBe(true);
  });
});

describe('⭐ a genuine old-flow popup selection flows through unchanged', () => {
  it('matches neither check ⇒ not a replacement ⇒ the DS bridge proceeds', async () => {
    // A post-response popup selection never had a decision file and was never
    // delivered by the submit poller — suppressing it would break the SHIPPED
    // Windsurf bridge, which is the regression this suite exists to prevent.
    await expect(isSubmitFlowReplacement('user picked this in the popup', deps({
      isRecentSubmitDelivery: (_r: string, t: string) => t === 'something else',
      peekPendingDecision: async () => ({ replacementText: 'a different replacement' }),
    }))).resolves.toBe(false);
  });
});

describe('fail-open — a guard failure must never break the shipped bridge', () => {
  it('a throwing peek is treated as "not a replacement"', async () => {
    await expect(isSubmitFlowReplacement('text', deps({
      peekPendingDecision: async () => { throw new Error('fs gone'); },
    }))).resolves.toBe(false);
  });

  it('a throwing record check is treated as "not a replacement"', async () => {
    await expect(isSubmitFlowReplacement('text', deps({
      isRecentSubmitDelivery: () => { throw new Error('boom'); },
    }))).resolves.toBe(false);
  });

  it('checks every root, not just the first', async () => {
    // The poller watches both the canonicalised and raw workspace paths; the
    // submit flow may have recorded under either.
    const seen: string[] = [];
    await isSubmitFlowReplacement('t', deps({
      isRecentSubmitDelivery: (r: string) => { seen.push(r); return false; },
    }));
    expect(seen).toEqual(['/proj', '/proj-canon']);
  });
});
