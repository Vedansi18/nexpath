/**
 * H8 G-ARBITRATION Finding 1 — the DS bridge must not double-inject a
 * submit-flow replacement, and must keep delivering genuine popup selections.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  isSubmitFlowReplacement,
  isSubmitFlowReplacementWithinGrace,
  SUBMIT_REPLACEMENT_GRACE_MS,
} from './submit-replacement-guard.js';

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

/**
 * RC28 — the Windows/Devin race: the bridge sees the popup selection BEFORE the
 * submit hook has written its decision, so both single-shot checks are correctly
 * false and a replacement gets injected into a still-running turn.
 *
 * Timings below are the tester's measured ones (2026-08-20 log):
 *   bridge visible 13:25:01.001 · decision minted 13:25:01.045 · block +1941ms
 */
describe('⭐ RC28 — a decision that has not been written YET', () => {
  /** Fake clock + sleep so the grace costs no real time. */
  const clock = () => {
    let t = 0;
    return {
      now: () => t,
      sleep: async (ms: number) => { t += ms; },
      advanceTo: (ms: number) => { t = ms; },
      get t() { return t; },
    };
  };

  it('⭐ THE BUG: single-shot says "not a replacement" while the decision is still 2s away', async () => {
    // Exactly the tester's moment — nothing on disk, nothing delivered yet.
    await expect(isSubmitFlowReplacement('replacement', deps())).resolves.toBe(false);
  });

  it('⭐ THE FIX: the grace form waits for that same decision and suppresses the bridge', async () => {
    const c = clock();
    // The hook persists at ~2000ms, mirroring block_issued +1941ms.
    const peekPendingDecision = async () =>
      (c.t >= 2000 ? { replacementText: 'replacement' } : null);
    await expect(isSubmitFlowReplacementWithinGrace('replacement', deps({
      peekPendingDecision, now: c.now, sleep: c.sleep,
    }))).resolves.toBe(true);
  });

  it('exits EARLY when the decision lands — does not burn the whole grace', async () => {
    const c = clock();
    const peekPendingDecision = async () =>
      (c.t >= 2000 ? { replacementText: 'replacement' } : null);
    await isSubmitFlowReplacementWithinGrace('replacement', deps({
      peekPendingDecision, now: c.now, sleep: c.sleep,
    }));
    // Suppressed shortly after the decision appeared, not at the 8s deadline.
    expect(c.t).toBeLessThan(3000);
  });

  it('⭐ NO REGRESSION: a genuine PE popup selection still bridges (deferred, never dropped)', async () => {
    // `stop`'s ladder still reaches feedback/PE under the switch, so these MUST
    // keep delivering — this is why a blanket "never bridge while armed" is wrong.
    const c = clock();
    await expect(isSubmitFlowReplacementWithinGrace('user picked this', deps({
      now: c.now, sleep: c.sleep,
    }))).resolves.toBe(false);
  });

  it('the grace is bounded — a never-arriving decision cannot hang the bridge', async () => {
    const c = clock();
    await isSubmitFlowReplacementWithinGrace('never claimed', deps({ now: c.now, sleep: c.sleep }));
    expect(c.t).toBeGreaterThanOrEqual(SUBMIT_REPLACEMENT_GRACE_MS);
    expect(c.t).toBeLessThan(SUBMIT_REPLACEMENT_GRACE_MS + 1000);
  });

  it('the grace exceeds the measured Windows window with real margin', () => {
    expect(SUBMIT_REPLACEMENT_GRACE_MS).toBeGreaterThan(1941 * 2);
  });

  it('a throwing peek inside the grace still degrades to "not a replacement"', async () => {
    const c = clock();
    await expect(isSubmitFlowReplacementWithinGrace('t', deps({
      peekPendingDecision: async () => { throw new Error('fs gone'); },
      now: c.now, sleep: c.sleep,
    }))).resolves.toBe(false);
  });

  it('also catches the in-memory record appearing mid-grace (submit poller won the race)', async () => {
    const c = clock();
    await expect(isSubmitFlowReplacementWithinGrace('replacement', deps({
      isRecentSubmitDelivery: (_r: string, t: string) => c.t >= 1500 && t === 'replacement',
      now: c.now, sleep: c.sleep,
    }))).resolves.toBe(true);
  });
});
