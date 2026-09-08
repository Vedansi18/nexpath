import { isValidNexpathToken } from './credential-shape.js';

/**
 * Attribution headers for calls made on a NEXPATH TOKEN.
 *
 * The service bills and attributes token traffic, and it cannot tell which surface a call came from
 * unless the client says so. These two headers say it:
 *
 *   X-Nexpath-Client:  'cli'          — this package, as opposed to any other client
 *   X-Nexpath-Surface: '<agent id>'   — the hook that invoked it: cursor, windsurf, vscode, claude-code
 *
 * ── WHY THIS IS NOT IN `credential-shape.ts` ─────────────────────────────────
 * That file states its own rule at the top: "WHY THIS IS A LEAF MODULE (no imports, and it must stay
 * that way)". It has zero imports so it can be bundled into the browser extension, where
 * `ApiKeyResolver` and `NexpathTokenStore` cannot go. A `process.env` reader belongs nowhere near it.
 *
 * ⚠️ A claim worth correcting for whoever reads this next, because it will otherwise be repeated: it
 * was reported that a `NodeJS.ProcessEnv` signature in `credential-shape.ts` would break
 * `npm run typecheck:ext`. Measured — it does not. `tsconfig.ext-browser.json` includes only
 * `src/core/**` and `src/ext-browser/**`, and nothing under either imports `credential-shape.ts`, so
 * it is not in that graph at all. The separation below is right for the LEAF rule, not because the
 * type-check would have caught it. Do not rely on the type-check to enforce this.
 *
 * ── WHY THE TOKEN CHECK IS SYNCHRONOUS ───────────────────────────────────────
 * `resolveOpenAIKey` writes the resolved credential into `OPENAI_API_KEY` verbatim, tokens included
 * (`ApiKeyResolver.ts:63`). So "are we on a token?" is a regex test on a string already in memory —
 * no keychain read, no file I/O, no await. That matters: this runs once per provider construction,
 * and provider constructions happen per prompt on the hook path.
 */

/** Value of `X-Nexpath-Client` for every call this package makes. */
export const NEXPATH_CLIENT_ID = 'cli' as const;

/**
 * Surface id used when nothing named the agent.
 *
 * Windsurf (`windsurf-hook.ts:902`), Cursor (`cursor-hook.ts`) and the VS Code extension
 * (`ext-vscode/src/extension.ts:332`) each set `NEXPATH_AGENT` in the process that spawns
 * `nexpath auto`/`stop`, and the child inherits it (`windsurf-hook/spawn.ts:62` passes
 * `env: process.env`). So an ABSENT value means the Claude Code hooks — or someone running
 * `nexpath auto` by hand.
 *
 * Both are labelled `claude-code`, agreed with Vedansi 2026-09-08: a hand-run is one of us testing
 * rather than a user, `X-Nexpath-Client: cli` already says it came from this package, and telling the
 * two apart would need a TTY check inside `auto.ts` — a file this side does not own, for a
 * distinction nobody has asked for yet. If that ever changes it is a manual label there, and nothing
 * here moves.
 */
export const NEXPATH_DEFAULT_SURFACE = 'claude-code' as const;

/**
 * Surface ids the service will store. Anything else it records as NULL, so a value failing this is
 * not merely useless — sending it costs a header and buys a null column. Better to send nothing and
 * leave the absence honest.
 */
export const NEXPATH_SURFACE_REGEX = /^[a-z0-9][a-z0-9._-]{0,31}$/;

export interface NexpathClientHeadersV1 {
  'X-Nexpath-Client': string;
  /**
   * Omitted when the resolved surface fails {@link NEXPATH_SURFACE_REGEX}.
   *
   * ⚠️ Omit rather than substitute the default. Falling back to `claude-code` for a malformed id
   * would attribute, say, a Cursor call to Claude Code — a wrong row is worse than a null one,
   * because a null is visibly missing and a wrong value is not. The Client header still goes: that a
   * call came from this package is worth recording even when the surface is unknown.
   */
  'X-Nexpath-Surface'?: string;
  /**
   * Index signature so this satisfies the OpenAI SDK's `HeadersLike`
   * (`Record<string, HeaderValue | readonly HeaderValue[]>`) and can be handed straight to
   * `defaultHeaders` without a cast. The two named keys above are the whole contract — this only
   * makes the shape assignable, and nothing should add a third key without deciding it belongs.
   */
  [header: string]: string | undefined;
}

/**
 * Headers for a provider client, or `undefined` when none should be sent.
 *
 * `undefined` for an OWN OPENAI KEY is the contract, not an oversight: the user's own key is their
 * relationship with OpenAI, and this package has nothing to attribute. Passing `undefined` to the
 * SDK's `defaultHeaders` is the same as passing nothing, so an own-key user's requests are
 * byte-identical to before this existed.
 *
 * Usage at a construction site:
 *
 *     const openai = client ?? new OpenAI({ defaultHeaders: nexpathClientHeaders() });
 *
 * @param env Environment to read; injectable so tests need not mutate `process.env`.
 */
export function nexpathClientHeaders(
  env: NodeJS.ProcessEnv = process.env,
): NexpathClientHeadersV1 | undefined {
  // Not a token ⇒ the user's own key (or nothing resolved at all) ⇒ send nothing.
  if (!isValidNexpathToken(env['OPENAI_API_KEY'] ?? '')) return undefined;

  // Absent (or whitespace-only) means the Claude Code hooks or a hand-run — see
  // NEXPATH_DEFAULT_SURFACE. A value that IS present is used as given and judged on its own; it is
  // never quietly replaced by the default.
  const surface = env['NEXPATH_AGENT']?.trim() || NEXPATH_DEFAULT_SURFACE;

  return NEXPATH_SURFACE_REGEX.test(surface)
    ? { 'X-Nexpath-Client': NEXPATH_CLIENT_ID, 'X-Nexpath-Surface': surface }
    : { 'X-Nexpath-Client': NEXPATH_CLIENT_ID };
}
