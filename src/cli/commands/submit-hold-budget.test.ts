/**
 * H4 — hold budget.
 *
 * The property under test is the one the dev plan actually demands: a HARD
 * 60–90 s cap on the whole blocking window, self-enforced. Per-segment timeouts
 * cannot deliver that because they sum, so these tests are written against the
 * TOTAL, not against individual calls.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createHoldBudget,
  DEFAULT_HOLD_BUDGET_MS,
  MIN_HOLD_BUDGET_MS,
  MAX_HOLD_BUDGET_MS,
} from './submit-hold-budget.js';

/** Deterministic clock + timer, so no test waits on real time. */
function harness(totalMs?: number) {
  let t = 1_000;
  const timers: Array<{ at: number; fn: () => void }> = [];
  const budget = createHoldBudget({
    totalMs,
    now: () => t,
    setTimeoutFn: (fn, ms) => { const e = { at: t + ms, fn }; timers.push(e); return e; },
    clearTimeoutFn: (h) => { const i = timers.indexOf(h as never); if (i >= 0) timers.splice(i, 1); },
  });
  return {
    budget,
    advance(ms: number) {
      t += ms;
      for (const e of [...timers]) if (e.at <= t) { timers.splice(timers.indexOf(e), 1); e.fn(); }
    },
    pending: () => timers.length,
  };
}

describe('the plan\'s 60–90 s window is enforced, not trusted', () => {
  it('defaults inside the window', () => {
    expect(DEFAULT_HOLD_BUDGET_MS).toBeGreaterThanOrEqual(MIN_HOLD_BUDGET_MS);
    expect(DEFAULT_HOLD_BUDGET_MS).toBeLessThanOrEqual(MAX_HOLD_BUDGET_MS);
  });

  it('clamps a caller who asks for far too long', () => {
    // 600_000 is awaitChild's old default — the exact value that made the hold
    // unbounded in practice. Passing it must not reinstate that.
    expect(harness(600_000).budget.remaining()).toBe(MAX_HOLD_BUDGET_MS);
  });

  it('clamps a caller who asks for too little', () => {
    expect(harness(0).budget.remaining()).toBe(MIN_HOLD_BUDGET_MS);
  });
});

describe('⭐ the budget is SHARED across segments — the property per-call timeouts cannot give', () => {
  it('time spent in one segment is taken from the next', async () => {
    const h = harness(60_000);
    await h.budget.run(() => new Promise<string>((r) => { h.advance(20_000); r('a'); }));
    expect(h.budget.remaining()).toBe(40_000);
    await h.budget.run(() => new Promise<string>((r) => { h.advance(25_000); r('b'); }));
    expect(h.budget.remaining()).toBe(15_000);
  });

  it('three segments cannot together exceed the cap', async () => {
    // MUTATION GUARD: if each run() used the FULL total instead of the
    // remainder, this would allow 180_000ms of hold and still pass everything
    // else. That is precisely the pre-H4 bug.
    const h = harness(60_000);
    for (let i = 0; i < 3; i += 1) {
      await h.budget.run(() => new Promise<void>((r) => { h.advance(25_000); r(); }));
    }
    expect(h.budget.remaining()).toBe(0);
    expect(h.budget.expired()).toBe(true);
  });

  it('does not START work once exhausted', async () => {
    // The last segment always getting to run is how a "bounded" path overshoots.
    const h = harness(60_000);
    await h.budget.run(() => new Promise<void>((r) => { h.advance(60_000); r(); }));
    const work = vi.fn().mockResolvedValue('should not run');
    const res = await h.budget.run(work);
    expect(work).not.toHaveBeenCalled();
    expect(res).toEqual({ timedOut: true });
  });
});

describe('expiry reports timedOut so the caller can fail open (A3)', () => {
  it('times out work that outlives the remaining budget', async () => {
    const h = harness(60_000);
    const p = h.budget.run(() => new Promise<string>(() => {})); // never settles
    h.advance(60_000);
    await expect(p).resolves.toEqual({ timedOut: true });
  });

  it('returns the value when work finishes in time', async () => {
    const h = harness(60_000);
    await expect(h.budget.run(async () => 'ok')).resolves.toEqual({ timedOut: false, value: 'ok' });
  });

  it('a THROWING segment is not reported as a timeout', async () => {
    // Both fail open, but conflating them would misreport the evidence packet:
    // "popup crashed" and "user never answered" are different findings.
    const h = harness(60_000);
    await expect(h.budget.run(async () => { throw new Error('popup died'); }))
      .resolves.toEqual({ timedOut: false, value: undefined });
  });

  it('never rejects, so no caller needs a try/catch around the budget', async () => {
    const h = harness(60_000);
    await expect(h.budget.run(() => Promise.reject(new Error('boom')))).resolves.toBeDefined();
  });
});

describe('timers are cleaned up — a hook must not be kept alive by its own guard', () => {
  it('clears the timer when work finishes first', async () => {
    const h = harness(60_000);
    await h.budget.run(async () => 'done');
    expect(h.pending()).toBe(0);
  });

  it('clears the timer when work throws', async () => {
    const h = harness(60_000);
    await h.budget.run(async () => { throw new Error('x'); });
    expect(h.pending()).toBe(0);
  });

  it('unrefs the real timer so it cannot hold the process open', async () => {
    const unref = vi.fn();
    const b = createHoldBudget({
      totalMs: 60_000,
      setTimeoutFn: () => ({ unref }),
      clearTimeoutFn: () => {},
    });
    void b.run(() => new Promise<void>(() => {}));
    await Promise.resolve();
    expect(unref).toHaveBeenCalled();
  });
});
