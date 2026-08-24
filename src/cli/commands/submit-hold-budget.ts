/**
 * Hold budget for the gated `pre_user_prompt` path (hook milestone H4).
 *
 * ── WHY A SHARED BUDGET, NOT PER-CALL TIMEOUTS ───────────────────────────────
 * The dev plan requires a **hard hold timeout of 60–90 s, self-enforced inside
 * our own hook** — never relying on the host to reap us (`R2`: Cursor orphans
 * timed-out hooks, so a host-enforced bound is not a bound at all).
 *
 * The blocking window has several segments in sequence:
 *
 *   read stdin → handle() spawns `auto` → await the child → popup → decide
 *
 * Giving each its own timeout does NOT produce a total cap: independent bounds
 * **sum**. Before H4 the real worst case was 2 s + 600 s (`awaitChild`'s default)
 * + an **unbounded** popup, because the TTY selector waits for a human who may
 * simply have walked away. That is not 60–90 s by any reading.
 *
 * So the budget is created once when the gated path starts and every segment
 * draws from the SAME remaining time. Whatever a segment does not use is left
 * for the next one, and the total can never exceed the cap.
 *
 * ── WHY EXPIRY MEANS "ALLOW" ─────────────────────────────────────────────────
 * Amendment `A3`: a failure while HOLDING the user's prompt is strictly worse
 * than today's "no advisory appears". Expiry therefore releases the original
 * prompt unmodified — it never blocks and never injects.
 *
 * ── CLOCK ────────────────────────────────────────────────────────────────────
 * `now()` is injected so the whole budget is testable deterministically, the
 * same idiom `pe-poller.ts` uses for its stale-turn guard.
 */

/** The plan's window is 60–90 s. 75 s sits in the middle, leaving headroom under
 *  Cursor's 60 s host limit to be handled explicitly by the caller if needed. */
export const DEFAULT_HOLD_BUDGET_MS = 75_000;

/** Plan-mandated bounds; a caller may not silently pick something outside them. */
export const MIN_HOLD_BUDGET_MS = 60_000;
export const MAX_HOLD_BUDGET_MS = 90_000;

export interface HoldBudget {
  /** Milliseconds left, never negative. */
  remaining: () => number;
  /** True once the budget is exhausted. */
  expired: () => boolean;
  /**
   * Run `work` against the remaining budget.
   *
   * Resolves to `{ timedOut: false, value }` if it finishes in time, or
   * `{ timedOut: true }` if the budget ran out first. **It never rejects** — a
   * throwing `work` resolves as `timedOut: false` with `value: undefined`, so
   * every caller can treat the result as "fail open" without a try/catch around
   * the budget itself.
   */
  run: <T>(work: () => Promise<T>) => Promise<{ timedOut: boolean; value?: T }>;
}

export interface HoldBudgetDeps {
  now?: () => number;
  totalMs?: number;
  /** Injected in tests; real timers are unref'd so they never keep the hook alive. */
  setTimeoutFn?: (fn: () => void, ms: number) => { unref?: () => void };
  clearTimeoutFn?: (handle: unknown) => void;
}

/**
 * Create a hold budget.
 *
 * `totalMs` is clamped into the plan's 60–90 s window rather than trusted: a
 * caller passing 0 or 10 minutes would silently defeat the guarantee this module
 * exists to provide, and a clamp fails safe where a throw would break the hook.
 */
export function createHoldBudget(deps: HoldBudgetDeps = {}): HoldBudget {
  const now = deps.now ?? (() => Date.now());
  const setT = deps.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = deps.clearTimeoutFn ?? ((h) => clearTimeout(h as NodeJS.Timeout));

  const requested = deps.totalMs ?? DEFAULT_HOLD_BUDGET_MS;
  const totalMs = Math.min(MAX_HOLD_BUDGET_MS, Math.max(MIN_HOLD_BUDGET_MS, requested));

  const startedAt = now();
  const remaining = (): number => Math.max(0, totalMs - (now() - startedAt));

  return {
    remaining,
    expired: () => remaining() <= 0,
    async run<T>(work: () => Promise<T>): Promise<{ timedOut: boolean; value?: T }> {
      const left = remaining();
      // Already exhausted — do not even start the work. Starting it would be how
      // a "bounded" path quietly overshoots: the last segment always got to run.
      if (left <= 0) return { timedOut: true };

      let handle: unknown;
      const timeout = new Promise<{ timedOut: true }>((resolve) => {
        handle = setT(() => resolve({ timedOut: true }), left);
        const h = handle as { unref?: () => void };
        if (typeof h?.unref === 'function') h.unref();
      });

      try {
        const done = work().then(
          (value) => ({ timedOut: false as const, value }),
          // A throwing segment is a failure, not a timeout — the caller fails
          // open on both, but conflating them would misreport the evidence.
          () => ({ timedOut: false as const, value: undefined }),
        );
        return await Promise.race([done, timeout]);
      } finally {
        if (handle !== undefined) clearT(handle);
      }
    },
  };
}
