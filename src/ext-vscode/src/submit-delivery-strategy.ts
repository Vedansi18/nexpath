/**
 * Delivery strategy for the submit-time advisory (hook milestone H4).
 *
 * ── THE RULE THIS ENCODES (owner, 2026-08-10) ────────────────────────────────
 * The modified prompt **MUST land in the agent's chat**. Direct injection is the
 * PRIMARY path — the same mechanism the old VS Code flow already used — not a
 * fallback. The clipboard is reached **only** when direct injection has been
 * tried and our own post-inject check says it did not land.
 *
 * ── THE BUG THIS FIXES ───────────────────────────────────────────────────────
 * `extension.ts` wired the submit poller's `onInject` straight to the CLIPBOARD
 * delivery, so `chatInputInject` — the real command-based injector — was never
 * called on the submit path at all. The fallback had become the only path. That
 * is the opposite of the required behaviour: the user's turn was cancelled and
 * then delivered by a paste keystroke rather than actually injected.
 *
 * The clipboard path was built first on purpose (`G-POLICY`: it carries no
 * reverse-engineering exposure, so the milestone cannot be stranded). Building it
 * first was correct; wiring it as primary was not.
 *
 * ── WHY THE FALLBACK STILL EXISTS ────────────────────────────────────────────
 * The hook has already exited 2 by this point, so the ORIGINAL prompt is gone.
 * If injection fails and we do nothing, the user's turn vanishes and they must
 * retype it. The clipboard + an explicit notification is what makes a lost turn
 * impossible — it is a last resort, reached only after direct injection failed,
 * never a shortcut.
 */

export interface SubmitDeliveryStrategyDeps {
  /**
   * Direct, command-based injection into the agent's chat — the PRIMARY path.
   * Resolves true only when a real host command accepted the text.
   */
  injectDirect: (text: string) => Promise<boolean>;
  /**
   * Optional post-inject verification. When supplied, a `false` result means the
   * text did not actually land even though the command reported success, and the
   * fallback is used. Absent ⇒ the command's own result is trusted.
   */
  verifyLanded?: (text: string) => Promise<boolean>;
  /** Last resort: clipboard + paste keystroke. */
  fallbackClipboard: (text: string) => Promise<boolean>;
  /** Shown ONLY when the fallback was used, so the user knows to paste. */
  notify?: (message: string) => void;
  log?: (message: string) => void;
}

export type SubmitDeliveryOutcome =
  /** Landed in the chat by direct injection — the expected outcome. */
  | 'injected'
  /** Direct injection failed; text is on the clipboard and the user was told. */
  | 'clipboard_fallback'
  /** Nothing worked. The caller must surface this — the turn is already cancelled. */
  | 'failed';

export interface SubmitDeliveryResult {
  outcome: SubmitDeliveryOutcome;
  /** True only for `injected` — the caller may auto-submit only in that case. */
  landed: boolean;
}

/**
 * Shown when BOTH delivery paths failed.
 *
 * The hook has already exited 2, so the original prompt is gone. Staying silent
 * here would make the user's turn vanish with no explanation at all — the single
 * worst outcome this milestone can produce, and worse than the clipboard case
 * because there is nothing for them to paste either.
 */
export const DELIVERY_FAILED_NOTICE =
  'nexpath: your prompt was cancelled for refinement but the refined text could not be '
  + 'delivered. Nothing was sent — please re-enter your prompt.';

/** Message shown when, and only when, the clipboard fallback was used. */
export const CLIPBOARD_FALLBACK_NOTICE =
  'nexpath: your refined prompt could not be inserted automatically. '
  + 'It is on your clipboard — paste it (Ctrl/Cmd+V) and press Enter.';

/**
 * Deliver the replacement, direct injection first.
 *
 * Order is the whole point: `injectDirect` is always attempted, and
 * `fallbackClipboard` is only reached after it has failed (or verification says
 * the text did not land). A notification fires **only** on the fallback branch —
 * on the normal path the user sees nothing but their refined prompt appearing.
 */
export async function deliverSubmitReplacement(
  text: string,
  deps: SubmitDeliveryStrategyDeps,
): Promise<SubmitDeliveryResult> {
  const log = deps.log ?? (() => {});

  if (typeof text !== 'string' || text.length === 0) {
    // Mirrors the record validator: inserting "" would clear the composer and
    // silently lose the turn.
    log('[nexpath] submit-delivery: refused an empty replacement');
    return { outcome: 'failed', landed: false };
  }

  // ── PRIMARY: direct injection into the agent's chat ────────────────────────
  let injected = false;
  try {
    injected = await deps.injectDirect(text);
  } catch {
    injected = false;
  }

  if (injected && deps.verifyLanded) {
    // The command reported success, but "accepted" is not "landed". Only a
    // failed check sends us to the fallback.
    let landed = false;
    try {
      landed = await deps.verifyLanded(text);
    } catch {
      landed = false;
    }
    if (!landed) {
      log('[nexpath] submit-delivery: inject reported success but did not land');
      injected = false;
    }
  }

  if (injected) {
    log('[nexpath] submit-delivery: injected directly');
    return { outcome: 'injected', landed: true };
  }

  // ── LAST RESORT ONLY ──────────────────────────────────────────────────────
  // Reached only because direct injection failed. The original prompt is already
  // cancelled, so doing nothing here would lose the user's turn outright.
  log('[nexpath] submit-delivery: direct injection failed — falling back to clipboard');
  let copied = false;
  try {
    copied = await deps.fallbackClipboard(text);
  } catch {
    copied = false;
  }

  if (copied) {
    // The notification is what stops a silent loss: without it the user sees a
    // cancelled prompt and no explanation.
    deps.notify?.(CLIPBOARD_FALLBACK_NOTICE);
    return { outcome: 'clipboard_fallback', landed: false };
  }

  // Both paths failed and the original is already cancelled: tell the user
  // rather than let the turn disappear without a trace.
  deps.notify?.(DELIVERY_FAILED_NOTICE);
  return { outcome: 'failed', landed: false };
}
