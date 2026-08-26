/**
 * The gated composer submit — one mechanism, all three sites.
 *
 * The user presses Enter (or clicks send). We cancel that submission before the
 * site ever sees it, hold, show the popup, and then send exactly one prompt:
 * the modified one if the user accepted it, otherwise the original.
 *
 * ── WHY THIS REPLACED THE REQUEST-BODY REWRITE ON BOLT/LOVABLE ───────────────
 * Rewriting the outgoing `fetch` body looked cleaner on paper and is fully
 * implemented (see inject/submit-substitution.ts). Live testing on a real Bolt
 * project killed it, for two independent reasons:
 *
 *   1. **Bolt renders the user's bubble optimistically at submit**, from its own
 *      local state, before `fetch` is ever called. A perfect body rewrite still
 *      left the ORIGINAL text on screen next to a reply to the replacement.
 *   2. **Bolt's client gives up on a chat after 30 s and retries**
 *      (`Chat start timed out after 30000ms` → `chat.start.retry_succeeded`).
 *      A hold long enough for a human to read and edit a prompt always blows
 *      that ceiling, and the retry re-sent the original.
 *
 * Cancelling at the composer fixes both at once and by construction: the site
 * never renders a bubble, and never starts a chat, so there is no timer to beat
 * and no stale bubble to reconcile. Whatever we submit IS what the user sees.
 *
 * ── `stopImmediatePropagation` IS LOAD-BEARING ───────────────────────────────
 * Plain `stopPropagation()` is NOT enough and was proven insufficient live: Bolt
 * submitted anyway, because it has a document-level listener registered before
 * ours, and only the immediate form stops listeners on the SAME node. Downgrading
 * this call silently re-breaks every site.
 *
 * ── RE-ENTRANCY ──────────────────────────────────────────────────────────────
 * The prompt we submit travels back through the very listener that intercepted
 * the original. Without the guard that is an infinite loop.
 *
 * ── FAIL-OPEN ────────────────────────────────────────────────────────────────
 * Today a failure means "no popup". Here it would mean "the prompt never sends",
 * which is worse. Every branch ends in exactly one submitted prompt, and the
 * hold budget bounds the wait even if the decision never arrives.
 */
import { createHoldBudget, type HoldBudget, type HoldBudgetDeps } from '../adapters/submit-hold-budget.js';

export type ComposerDecision =
  | { kind: 'allow' }
  | { kind: 'block'; replacement: string };

export interface ComposerSubmitGateDeps {
  /** Agent id, used only for logging. */
  agent: string;
  /** Whether the switch is armed for this page. Read per event, never cached. */
  isArmed: () => boolean;
  /** Ask the service worker for a verdict. Bounded by the budget; may hang. */
  decide: (ctx: { prompt: string; submitId: string }) => Promise<ComposerDecision>;
  /** Put text in the composer and submit it. Resolves true when it went out. */
  deliverReplacement: (text: string) => Promise<boolean>;
  /** Re-submit what is already in the composer (the cancelled original). */
  reissueOriginal: () => Promise<boolean>;
  /** Read the composer's current text — used to verify a send actually happened. */
  readComposerText: () => string;
  emit?: (event: string, data?: Record<string, unknown>) => void;
  budget?: HoldBudgetDeps;
  makeBudget?: (deps?: HoldBudgetDeps) => HoldBudget;
}

export interface ComposerSubmitGate {
  /**
   * Called from the capture-phase listener. Returns true when this gate has
   * TAKEN OVER the submission (the caller must stop); false means "not mine,
   * carry on exactly as before".
   */
  maybeIntercept(ev: Event, prompt: string): boolean;
  /** True while our own submit is travelling back through the listener. */
  isReentrant(): boolean;
}

/** How long to wait for the composer to clear before calling a send unverified. */
const SEND_VERIFY_TIMEOUT_MS = 3_000;
const SEND_VERIFY_POLL_MS = 100;

function submitIdFor(prompt: string): string {
  let h = 5381;
  for (let i = 0; i < prompt.length; i++) h = ((h << 5) + h + prompt.charCodeAt(i)) | 0;
  return `c${(h >>> 0).toString(36)}:${prompt.length}`;
}

export function createComposerSubmitGate(deps: ComposerSubmitGateDeps): ComposerSubmitGate {
  const makeBudget = deps.makeBudget ?? createHoldBudget;
  const now = deps.budget?.now ?? (() => Date.now());
  const emit = (event: string, data?: Record<string, unknown>): void => {
    try { deps.emit?.(event, { agent: deps.agent, ...data }); } catch { /* diagnostics only */ }
  };

  let reentrant = false;
  const inFlight = new Set<string>();

  /**
   * A send is only real once the composer has emptied. A mechanism that reports
   * success without delivering is worse than none.
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

  /** Submit the original we cancelled. Always the fallback, never the goal. */
  const releaseOriginal = async (event: string, submitId: string, heldMs: number): Promise<void> => {
    emit(event, { submitId, heldMs });
    reentrant = true;
    try {
      const sent = await deps.reissueOriginal();
      if (!sent || !await verifySent()) {
        // Loud on purpose: this is the one branch that can lose a prompt.
        emit('submit_reissue_unverified', { submitId });
      }
    } catch {
      emit('submit_reissue_failed', { submitId });
    } finally {
      reentrant = false;
    }
  };

  const runHold = async (prompt: string, submitId: string): Promise<void> => {
    const budget = makeBudget(deps.budget);
    const startedAt = now();
    emit('submit_hold_started', { submitId, budgetMs: budget.remaining() });

    let outcome: { timedOut: boolean; value?: ComposerDecision };
    try {
      outcome = await budget.run(() => deps.decide({ prompt, submitId }));
    } catch {
      outcome = { timedOut: false, value: undefined };
    }

    if (outcome.timedOut) { await releaseOriginal('submit_hold_expired', submitId, now() - startedAt); return; }
    const decision = outcome.value;
    if (decision === undefined) { await releaseOriginal('submit_hold_released_error', submitId, now() - startedAt); return; }
    if (decision.kind !== 'block' || decision.replacement.length === 0) {
      await releaseOriginal('submit_hold_released_allow', submitId, now() - startedAt);
      return;
    }

    emit('submit_hold_blocked', { submitId, heldMs: now() - startedAt, chars: decision.replacement.length });
    reentrant = true;
    let delivered = false;
    try {
      delivered = await deps.deliverReplacement(decision.replacement);
      if (delivered) delivered = await verifySent();
    } catch {
      delivered = false;
    } finally {
      reentrant = false;
    }
    if (delivered) {
      emit('submit_replacement_sent', { submitId, chars: decision.replacement.length });
      return;
    }
    // The replacement never landed. Rather than swallow the user's turn, put the
    // original back on the wire and say so.
    emit('submit_hold_substitution_failed', { submitId });
    await releaseOriginal('submit_hold_released_after_failed_substitution', submitId, now() - startedAt);
  };

  return {
    isReentrant: () => reentrant,

    maybeIntercept(ev: Event, prompt: string): boolean {
      if (reentrant) return false;          // our own submit travelling back
      if (!deps.isArmed()) return false;    // switch off ⇒ today's behaviour
      if (prompt.trim().length === 0) return false;

      const submitId = submitIdFor(prompt);

      // Enter and click can both fire for one submission, and the site may
      // dispatch more than one event per press. One hold, not N — but every
      // duplicate must STILL be cancelled, or the site sends the original out
      // from under us.
      const duplicate = inFlight.has(submitId);

      // LOAD-BEARING: the immediate form. Plain stopPropagation was proven
      // insufficient on Bolt — see this module's header.
      ev.preventDefault();
      ev.stopImmediatePropagation();

      if (duplicate) {
        emit('submit_hold_claim_duplicate', { submitId });
        return true;
      }
      inFlight.add(submitId);
      void runHold(prompt, submitId).finally(() => { inFlight.delete(submitId); });
      return true;
    },
  };
}
