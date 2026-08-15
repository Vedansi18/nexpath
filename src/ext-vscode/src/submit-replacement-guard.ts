/**
 * DS-bridge suppression of submit-flow replacements (H8, `G-ARBITRATION`
 * Finding 1 — Windsurf only).
 *
 * ── THE COLLISION THIS PREVENTS ──────────────────────────────────────────────
 * `session_states.lastInjectedPrompt` carries TWO meanings:
 *   - everywhere: the echo guard `auto.ts:706` reads-and-clears so an injected
 *     turn is never re-classified (the hook's VED-PE-10 fix writes it for
 *     exactly that reason);
 *   - on Windsurf ONLY: it is also the DS advisory-poller's delivery-bridge
 *     signal — "a popup selection appeared; inject it into Cascade."
 *
 * With the submit-advisory switch ON, a blocked turn therefore makes the DS
 * poller deliver the replacement a SECOND time, alongside the submit poller's
 * own decision-file delivery. Both paths are correct in isolation; the
 * collision only exists on Windsurf with the switch on — so this guard is only
 * consulted there, and the shipped DS bridge is untouched when the switch is
 * off (the guard is simply never constructed).
 *
 * ── WHY TWO CHECKS, NOT ONE ──────────────────────────────────────────────────
 * Tick order between the two 2s pollers is non-deterministic:
 *   - DS poller first ⇒ the decision file still exists ⇒ the non-consuming
 *     PEEK identifies the text;
 *   - submit poller first ⇒ the file is consumed (one-shot) ⇒ the in-memory
 *     recent-delivery record identifies it.
 * Either alone leaves a losing order; together they cover both.
 *
 * A genuine old-flow popup selection (the user picked in the post-response
 * popup) matches NEITHER check — no decision file ever existed for it and the
 * submit poller never delivered it — so the DS bridge keeps working exactly as
 * shipped even while the switch is on.
 */

export interface SubmitReplacementGuardDeps {
  /** Candidate project roots (the same list both pollers watch). */
  roots: readonly string[];
  /** In-memory record of texts the submit poller has delivered (per root). */
  isRecentSubmitDelivery: (root: string, text: string) => boolean;
  /** Non-consuming peek at the pending decision file for a root. */
  peekPendingDecision: (root: string) => Promise<{ replacementText: string } | null>;
}

/**
 * True when `text` is a submit-flow replacement and the DS bridge must NOT
 * inject it. Never throws — a guard failure must never break the shipped
 * bridge, so any error means "not a replacement" (the DS bridge proceeds;
 * worst case is today's double injection, never a lost selection).
 */
export async function isSubmitFlowReplacement(
  text: string,
  deps: SubmitReplacementGuardDeps,
): Promise<boolean> {
  try {
    for (const root of deps.roots) {
      if (deps.isRecentSubmitDelivery(root, text)) return true;
    }
    for (const root of deps.roots) {
      let peeked: { replacementText: string } | null = null;
      try {
        peeked = await deps.peekPendingDecision(root);
      } catch {
        peeked = null;
      }
      if (peeked && peeked.replacementText === text) return true;
    }
    return false;
  } catch {
    return false;
  }
}
