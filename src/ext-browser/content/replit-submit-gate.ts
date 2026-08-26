/**
 * Replit's gated submit — the DOM equivalent of the fetch hold.
 *
 * Replit's chat is MessagePack over a WebSocket, so there is no request to
 * withhold: a fetch patch is confirmed non-viable, and the network-level
 * alternative is ruled out on terms-of-service grounds and must not be
 * revisited. The seam is the capture-phase composer listener, which already
 * fires before Replit's own handler and today only reads text. Under the switch
 * it cancels the submission, holds, and then either submits a replacement or
 * re-issues the original.
 *
 * ── THE ASYMMETRY THAT MAKES THIS THE RISKIEST PHASE ─────────────────────────
 * On Bolt and Lovable, "allow" means calling a fetch we are already holding —
 * the original request object is intact and sending it is certain. Here, "allow"
 * means RE-ISSUING A SUBMIT WE ALREADY CANCELLED. If that re-issue silently
 * fails, the user's prompt is simply gone: worse than any popup bug, and exactly
 * the failure mode the milestone's inverted-risk rule warns about.
 *
 * ── WHY THIS IS NOT ARMED YET ────────────────────────────────────────────────
 * `REPLIT_INTERCEPT_READY` is false. The re-issue path cannot be proven by unit
 * tests — only a live cycle on a real Replit project can show that a cancelled
 * submit actually re-sends, and that verification has not been done. Shipping an
 * unverified re-issue would risk eating real prompts. Everything below is
 * complete and tested; arming it is a one-line change AFTER a live allow-path
 * cycle passes, which is the acceptance this phase was given.
 *
 * ── RE-ENTRANCY ──────────────────────────────────────────────────────────────
 * Both the replacement submit and the re-issued original travel back through the
 * very listener that intercepted them. Without a guard that is an infinite loop,
 * the same class of bug as the fetch path's echo check.
 */
import { createHoldBudget, type HoldBudget, type HoldBudgetDeps } from '../adapters/submit-hold-budget.js';

/**
 * Live-verification gate. Flip to true ONLY after a full cycle on a real Replit
 * project shows: (a) a blocked submit sends the replacement, and (b) an allowed
 * submit re-sends the original and the agent answers it.
 */
export const REPLIT_INTERCEPT_READY = false;

export type ReplitDecision =
  | { kind: 'allow' }
  | { kind: 'block'; replacement: string };

export interface ReplitSubmitGateDeps {
  /** Ask the service worker for a verdict. Bounded by the budget; may hang. */
  decide: (ctx: { prompt: string; submitId: string }) => Promise<ReplitDecision>;
  /** Put text in the composer and submit it. Resolves true when it landed. */
  deliverReplacement: (text: string) => Promise<boolean>;
  /** Re-issue the submission we cancelled. Resolves true when it went out. */
  reissueOriginal: () => Promise<boolean>;
  /** Read the composer's current text (used to verify the re-issue). */
  readComposerText: () => string;
  emit?: (event: string, data?: Record<string, unknown>) => void;
  budget?: HoldBudgetDeps;
  makeBudget?: (deps?: HoldBudgetDeps) => HoldBudget;
  /** Whether the switch is armed for this page. Read per event, never cached. */
  isArmed: () => boolean;
  /** Overrides the readiness constant in tests. */
  ready?: boolean;
}

export interface ReplitSubmitGate {
  /**
   * Called from the capture-phase listener. Returns true when this gate has
   * TAKEN OVER the submission (the caller must stop); false means "not mine,
   * carry on exactly as before".
   */
  maybeIntercept(ev: Event, prompt: string): boolean;
  /** True while a re-issued/replacement submit is travelling back through. */
  isReentrant(): boolean;
}

/** How long to wait for the composer to clear before calling a send unverified. */
const SEND_VERIFY_TIMEOUT_MS = 2_000;
const SEND_VERIFY_POLL_MS = 100;

function submitIdFor(prompt: string): string {
  let h = 5381;
  for (let i = 0; i < prompt.length; i++) h = ((h << 5) + h + prompt.charCodeAt(i)) | 0;
  return `r${(h >>> 0).toString(36)}:${prompt.length}`;
}

export function createReplitSubmitGate(deps: ReplitSubmitGateDeps): ReplitSubmitGate {
  const makeBudget = deps.makeBudget ?? createHoldBudget;
  const now = deps.budget?.now ?? (() => Date.now());
  const emit = (event: string, data?: Record<string, unknown>): void => {
    try { deps.emit?.(event, data); } catch { /* diagnostics only */ }
  };

  let reentrant = false;
  const claimed = new Set<string>();

  /**
   * Wait for the composer to empty, which is how we know a submit actually went
   * out. A mechanism that reports success without delivering is worse than none.
   */
  const verifySent = async (): Promise<boolean> => {
    const deadline = now() + SEND_VERIFY_TIMEOUT_MS;
    for (;;) {
      let text = '';
      try { text = deps.readComposerText(); } catch { return false; }
      if (text.trim().length === 0) return true;
      if (now() >= deadline) return false;
      await new Promise((r) => setTimeout(r, SEND_VERIFY_POLL_MS));
    }
  };

  const runHold = async (prompt: string, submitId: string): Promise<void> => {
    const budget = makeBudget(deps.budget);
    const startedAt = now();
    emit('submit_hold_started', { submitId, budgetMs: budget.remaining(), surface: 'replit' });

    let outcome: { timedOut: boolean; value?: ReplitDecision };
    try {
      outcome = await budget.run(() => deps.decide({ prompt, submitId }));
    } catch {
      outcome = { timedOut: false, value: undefined };
    }

    const releaseOriginal = async (event: string): Promise<void> => {
      emit(event, { submitId, heldMs: now() - startedAt, surface: 'replit' });
      reentrant = true;
      try {
        const sent = await deps.reissueOriginal();
        const verified = sent ? await verifySent() : false;
        if (!verified) {
          // Loud on purpose: this is the one branch that can lose a prompt, and
          // it must never be silent.
          emit('submit_reissue_unverified', { submitId, surface: 'replit' });
        }
      } catch {
        emit('submit_reissue_failed', { submitId, surface: 'replit' });
      } finally {
        reentrant = false;
      }
    };

    if (outcome.timedOut) { await releaseOriginal('submit_hold_expired'); return; }
    const decision = outcome.value;
    if (decision === undefined) { await releaseOriginal('submit_hold_released_error'); return; }
    if (decision.kind !== 'block' || decision.replacement.length === 0) {
      await releaseOriginal('submit_hold_released_allow');
      return;
    }

    emit('submit_hold_blocked', { submitId, heldMs: now() - startedAt, surface: 'replit' });
    reentrant = true;
    let delivered = false;
    try {
      delivered = await deps.deliverReplacement(decision.replacement);
    } catch {
      delivered = false;
    } finally {
      reentrant = false;
    }
    if (!delivered) {
      // The replacement never landed, so the user is left with nothing sent —
      // put the original back on the wire rather than swallowing the turn.
      emit('submit_hold_substitution_failed', { submitId, surface: 'replit' });
      await releaseOriginal('submit_hold_released_after_failed_substitution');
    }
  };

  return {
    isReentrant: () => reentrant,

    maybeIntercept(ev: Event, prompt: string): boolean {
      const ready = deps.ready ?? REPLIT_INTERCEPT_READY;
      if (!ready) return false;
      if (reentrant) return false;          // our own submit travelling back
      if (!deps.isArmed()) return false;    // switch off ⇒ today's behaviour
      if (prompt.trim().length === 0) return false;

      const submitId = submitIdFor(prompt);
      if (claimed.has(submitId)) {
        // Enter and click can both fire for one submission; one hold, not two.
        emit('submit_hold_claim_duplicate', { submitId, surface: 'replit' });
        ev.preventDefault();
        ev.stopPropagation();
        return true;
      }
      claimed.add(submitId);

      ev.preventDefault();
      ev.stopPropagation();
      void runHold(prompt, submitId).finally(() => { claimed.delete(submitId); });
      return true;
    },
  };
}
