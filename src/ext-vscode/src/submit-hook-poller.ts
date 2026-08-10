/**
 * Submit-time advisory poller (hook milestone H3).
 *
 * WHAT THIS SOLVES. The prompt-submit flow is necessarily **cross-process**: the
 * Windsurf hook is a plain CLI subprocess that blocks the prompt (`exit 2`) and
 * persists its decision, while only the VS Code extension host can actually
 * inject text. Verified in source: `injectViaCascadeAction` needs a real
 * `vscode.commands.executeCommand` (`windsurf-cascade-action.ts:104`, called from
 * `extension.ts:176` and `:491`), and `windsurf-hook.ts` imports no `vscode` at
 * all. So blocking and injecting can never happen in one process.
 *
 * PRIOR ART — deliberately mirrored, not reinvented. This is a sibling of
 * `createPePoller` (`pe-poller.ts`, wired at `extension.ts:534`), which already
 * ships the same store-poll → deliver → inject shape. Two idioms are reused
 * verbatim because they are already proven here:
 *   1. **`now()` + "only rows parked AFTER start()"** — the guard that stops a
 *      stale decision being injected into a LATER turn. Same bug class as P11's
 *      Late-ACK fix; there is no reason to rediscover it.
 *   2. **Full dependency injection** (`setIntervalFn`/`clearIntervalFn`/`now`) —
 *      which is what makes the handoff latency assertable in unit tests instead
 *      of through GUI automation. H1's spike failed twice trying to measure this
 *      through synthetic UI; that is precisely why Q1/Q2 were folded into H3.
 *
 * BACKWARD COMPATIBILITY (`R12`). This module is NEW and is only ever started on
 * the switched-on path. It does not modify `createPePoller` or
 * `createAdvisoryPoller`, both of which are existing shipping consumers. With
 * `NEXPATH_WINDSURF_PROMPTSUBMIT_ADVISORY` unset, nothing here runs and the old
 * flow is byte-identical.
 *
 * FAIL-OPEN (`A3`). This poller never blocks anything — the hook already made
 * that decision and exited. Its only job is delivery. Every failure path is
 * swallowed and reported through `onTiming`/`onOutcome` so a delivery problem can
 * never strand a user's prompt.
 */

/** A decision the hook persisted after blocking the original prompt. */
export interface PendingSubmitDecision {
  /** The text that should replace the blocked prompt. */
  replacementText: string;
  /**
   * When the hook persisted this decision (epoch ms). Rows at or before
   * `start()` are ignored — see the stale-turn guard above.
   */
  createdAt: number;
  /**
   * When the hook DECIDED to block, before it persisted. Stage 1 of the five the
   * dev plan mandates; `createdAt` alone omits the hook's own decision time.
   */
  blockIssuedAt: number;
  /** Opaque id used only for correlating timing records; never rendered. */
  decisionId: string;
}

/** Stages of the cross-process handoff, timestamped so latency is measurable (H1 Q2). */
export type SubmitHandoffStage =
  | 'block_issued'
  | 'decision_persisted'
  | 'extension_observed'
  | 'inject_dispatched'
  | 'submit_dispatched';

/**
 * One timing record per stage. `sinceDecisionMs` is the number the evidence
 * packet needs: how long the user waited between the hook persisting a decision
 * and this stage happening.
 */
export interface SubmitHandoffTiming {
  decisionId: string;
  stage: SubmitHandoffStage;
  at: number;
  sinceDecisionMs: number;
  /**
   * Elapsed since the hook ISSUED the block — the number the evidence packet
   * needs. `sinceDecisionMs` starts at persistence and so omits the hook's own
   * decision time, which under option-A ordering contains auto's LLM call.
   */
  sinceBlockIssuedMs: number;
}

/** What happened to a delivery attempt. Mirrors `pe-poller.ts`'s outcome vocabulary. */
export type SubmitDeliveryOutcome = 'delivered' | 'inject_failed' | 'submit_failed' | 'skipped_stale';

export interface SubmitHookPollerDeps {
  /** Candidate project roots — same reasoning as `PePollerDeps.projectRoots`. */
  projectRoots: string[];
  /** Read the latest pending submit decision for a root, or `null`. */
  readPendingDecision: (projectRoot: string) => Promise<PendingSubmitDecision | null>;
  /** Insert the replacement text. Wire to the proven Cascade insert path. */
  onInject: (text: string) => Promise<boolean>;
  /**
   * Submit what was inserted. Separate from `onInject` on purpose: H1 proved
   * NEITHER platform auto-submits, so insert and submit are two distinct steps
   * with two distinct failure modes and must be tested as such.
   */
  onSubmit: () => Promise<boolean>;
  /** Timing sink — this is what produces the measured latency for the evidence packet. */
  onTiming?: (t: SubmitHandoffTiming) => void;
  /** Terminal outcome per decision (redacted — never the replacement text). */
  onOutcome?: (outcome: SubmitDeliveryOutcome) => void;
  /** Poll interval in ms. Default 2000, matching `pe-poller.ts`/`advisory-poller.ts`. */
  intervalMs?: number;
  /** Injectable clock — only decisions created AFTER start() are delivered. */
  now?: () => number;
  setIntervalFn?: (cb: () => void, ms: number) => unknown;
  clearIntervalFn?: (handle: unknown) => void;
}

export interface SubmitHookPoller {
  start: () => void;
  stop: () => void;
  /** Exposed for tests so a tick can be driven deterministically. */
  pollOnce: () => Promise<void>;
}

export function createSubmitHookPoller(deps: SubmitHookPollerDeps): SubmitHookPoller {
  const intervalMs = deps.intervalMs ?? 2000;
  const now = deps.now ?? (() => Date.now());
  const setIntervalFn = deps.setIntervalFn ?? ((cb, ms) => setInterval(cb, ms) as unknown);
  const clearIntervalFn = deps.clearIntervalFn ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));

  let handle: unknown;
  let startedAt = -Infinity;
  let inFlight = false;
  /** Decisions already handled, so a slow poll can never deliver the same one twice. */
  const seen = new Set<string>();

  const record = (d: PendingSubmitDecision, stage: SubmitHandoffStage): void => {
    const at = now();
    deps.onTiming?.({
      decisionId: d.decisionId, stage, at,
      sinceDecisionMs: at - d.createdAt,
      sinceBlockIssuedMs: at - d.blockIssuedAt,
    });
  };

  async function pollOnce(): Promise<void> {
    if (inFlight) return;
    inFlight = true;
    try {
      for (const root of deps.projectRoots) {
        let decision: PendingSubmitDecision | null = null;
        try {
          decision = await deps.readPendingDecision(root);
        } catch {
          continue; // fail-open: a bad read must never stop the loop
        }
        if (!decision || seen.has(decision.decisionId)) continue;

        // Stale-turn guard (the pe-poller idiom): a decision parked at or before
        // start() belongs to an earlier turn and must never be injected now.
        if (decision.createdAt <= startedAt) {
          seen.add(decision.decisionId);
          deps.onOutcome?.('skipped_stale');
          continue;
        }

        seen.add(decision.decisionId);
        record(decision, 'block_issued');
        record(decision, 'decision_persisted');
        record(decision, 'extension_observed');

        let inserted = false;
        try {
          inserted = await deps.onInject(decision.replacementText);
        } catch {
          inserted = false;
        }
        record(decision, 'inject_dispatched');
        if (!inserted) {
          deps.onOutcome?.('inject_failed');
          continue;
        }

        // H1: neither platform auto-submits, so this is a genuinely separate step.
        let submitted = false;
        try {
          submitted = await deps.onSubmit();
        } catch {
          submitted = false;
        }
        record(decision, 'submit_dispatched');
        deps.onOutcome?.(submitted ? 'delivered' : 'submit_failed');
      }
    } finally {
      inFlight = false;
    }
  }

  return {
    start: () => {
      startedAt = now();
      handle = setIntervalFn(() => { void pollOnce(); }, intervalMs);
    },
    stop: () => {
      if (handle !== undefined) clearIntervalFn(handle);
      handle = undefined;
    },
    pollOnce,
  };
}
