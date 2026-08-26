/**
 * Turning a verdict's replacement text into the request that actually goes out.
 *
 * ── THE PER-SITE STRATEGY SEAM ───────────────────────────────────────────────
 * Two ways to deliver a replacement exist in principle:
 *
 *   'body_rewrite'        — send ONE request, with the prompt field replaced.
 *   'cancel_and_resubmit' — drop the held request and let the composer path
 *                           submit the replacement instead.
 *
 * Which one a site needs depends on whether it optimistically renders the user's
 * bubble at submit: if it does, a body rewrite would show the ORIGINAL text
 * beside a reply to the REPLACEMENT.
 *
 * Live recon on a real Lovable project settled that question for Lovable: no
 * user bubble is rendered at submit, the request can be held with the app
 * showing its normal busy state, and `message` is the single field to rewrite.
 * So Lovable is `body_rewrite` on evidence.
 *
 * Bolt is `body_rewrite` by INFERENCE, not evidence — the same recon session
 * could not test Bolt at all (the account's composer was locked). Its transport
 * shape is the AI-SDK `messages` array, which rewrites cleanly, but whether Bolt
 * paints an optimistic bubble is UNVERIFIED. That is the one open question in
 * this module, and this table is where the answer lands: flipping a site to
 * 'cancel_and_resubmit' is a one-line change here.
 *
 * `cancel_and_resubmit` is deliberately NOT implemented. Implementing an unproven
 * second delivery path would be speculation, and an unimplemented strategy fails
 * open (the caller sends the original), which is the safe direction.
 */

export type SubstitutionStrategy = 'body_rewrite' | 'composer_intercept';

/**
 * Which mechanism delivers the replacement, per site.
 *
 * **Both sites are `composer_intercept` as of 2026-08-26, on live evidence.**
 * The body-rewrite path below is complete, tested, and kept — it is the correct
 * mechanism for any future site that neither renders optimistically nor imposes
 * a client-side chat timeout. Bolt does both, which is why it moved; Lovable
 * moved with it so all three sites share one proven mechanism rather than two,
 * and because Lovable's own success-path render was never actually verified.
 *
 * A site listed as `body_rewrite` is gated in the page's fetch patch. A site
 * listed as `composer_intercept` is gated in the capture-phase composer listener
 * instead, and its fetch is left completely untouched — exactly one of the two
 * may ever gate a given site, or a single submission would be decided twice.
 */
export const SITE_SUBSTITUTION_STRATEGY: Record<string, SubstitutionStrategy> = {
  bolt: 'composer_intercept',
  lovable: 'composer_intercept',
};

/** True when the page's fetch patch owns this site's gating. */
export function fetchGateOwnsSite(agent: string): boolean {
  return SITE_SUBSTITUTION_STRATEGY[agent] === 'body_rewrite';
}

/**
 * Replace the newest `{role:'user'}` message's content in an AI-SDK-style body.
 *
 * Mirrors `extractLastUserMessage` exactly — same backwards walk, same guards —
 * so the field we rewrite is always the field we read the prompt from. Returns
 * null if the shape is not what we expect; the caller then sends the original.
 */
export function rewriteLastUserMessage(bodyText: string, replacement: string): string | null {
  try {
    const parsed = JSON.parse(bodyText) as { messages?: Array<{ role?: unknown; content?: unknown }> };
    if (!Array.isArray(parsed.messages)) return null;
    for (let i = parsed.messages.length - 1; i >= 0; i--) {
      const m = parsed.messages[i];
      if (m && m.role === 'user' && typeof m.content === 'string') {
        m.content = replacement;
        return JSON.stringify(parsed);
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Replace Lovable's flat `message` field. Mirrors `extractLovableMessage`'s
 * strict shape guard (`id` must be a `umsg_…` string) so a lookalike payload is
 * never rewritten.
 */
export function rewriteLovableMessage(bodyText: string, replacement: string): string | null {
  try {
    const parsed = JSON.parse(bodyText) as { id?: unknown; message?: unknown };
    if (typeof parsed.id !== 'string' || !parsed.id.startsWith('umsg_')) return null;
    if (typeof parsed.message !== 'string') return null;
    (parsed as { message: string }).message = replacement;
    return JSON.stringify(parsed);
  } catch {
    return null;
  }
}

/**
 * Rewrite `bodyText` for `agent`, or null when it cannot be done safely —
 * unknown agent, unimplemented strategy, unexpected body shape, or an empty
 * replacement. Null always means "send the original".
 */
export function rewriteBodyForAgent(
  agent: string,
  bodyText: string,
  replacement: string,
): string | null {
  if (replacement.length === 0) return null;
  if (SITE_SUBSTITUTION_STRATEGY[agent] !== 'body_rewrite') return null;
  if (agent === 'bolt') return rewriteLastUserMessage(bodyText, replacement);
  if (agent === 'lovable') return rewriteLovableMessage(bodyText, replacement);
  return null;
}

/**
 * Build the argument pair for the replacement request.
 *
 * Two shapes reach us: a plain `fetch(url, {body})` — the common one on both
 * sites — and a `Request` object. For the latter the original Request is used as
 * the template so method, headers, credentials and mode are preserved, with only
 * the body swapped.
 */
export function withReplacedBody(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  newBody: string,
): [RequestInfo | URL, RequestInit | undefined] {
  if (typeof init?.body === 'string') return [input, { ...init, body: newBody }];
  if (typeof Request !== 'undefined' && input instanceof Request) {
    return [new Request(input, { body: newBody }), init];
  }
  // Nothing we know how to rewrite — the caller checks for this by comparing
  // against the original body and falls back to sending the original.
  return [input, init];
}
