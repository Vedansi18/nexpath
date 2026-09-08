/**
 * The two attribution labels a token-mode call carries to the Nexpath service:
 * which client made it (always this extension) and which supported site it was
 * made on. They exist so the service's per-call usage record can be read by
 * client and by site — the `client` / `surface` columns of its `usage_events`
 * table — and for nothing else.
 *
 * Both are fixed vocabulary. Neither is ever page content, a URL, a page title
 * or a project path: the surface is derived from the project root's hostname
 * and collapsed to one word. The service accepts only its own label shape
 * (`clean_label()`, mirrored below) and stores anything else as NULL, so a
 * malformed value can never become a stored one.
 *
 * Published through the same polyfilled env the credential uses
 * (`llm-credentials.ts`): the fetch adapter is constructed all over the
 * service worker — and inside the engine's SDK shim — with only the key, so a
 * per-call read of the env is the one seam every path shares. The env is
 * global to the worker, so two supported sites submitting in the same instant
 * could label one another's later calls; that is an attribution smudge on a
 * usage record, not a billing or content concern, and it is the same scope the
 * base URL already has.
 *
 * BYOK calls to api.openai.com carry neither header — see `llm-fetch.ts`.
 */

export const NEXPATH_CLIENT_HEADER = 'X-Nexpath-Client';
export const NEXPATH_SURFACE_HEADER = 'X-Nexpath-Surface';

/** What this bundle is, to the service. The CLI/VS Code path sends `cli`. */
export const NEXPATH_CLIENT_LABEL = 'ext';

/** Env slot the service worker publishes the current surface into. */
export const NEXPATH_SURFACE_ENV = 'NEXPATH_SURFACE';

/** The service's `clean_label()` shape — anything else it stores as NULL. */
const LABEL_SHAPE = /^[a-z0-9][a-z0-9._-]{0,31}$/;

type EnvHolder = { process?: { env?: Record<string, string | undefined> } };

function isHost(hostname: string, apex: string): boolean {
  return hostname === apex || hostname.endsWith(`.${apex}`);
}

/**
 * Hostname → surface label. Deliberately NOT `resolveAgentFromHostname`: that
 * folds `*.stackblitz.com` into `bolt` because the same content script serves
 * both, whereas the usage record should say which host the session actually
 * arrived on — nobody has yet measured whether Bolt users reach us via
 * stackblitz at all, and this is the measurement.
 */
export function surfaceLabelForHostname(hostname: string): string | undefined {
  const h = hostname.trim().toLowerCase();
  if (isHost(h, 'replit.com')) return 'replit';
  if (h === 'bolt.new') return 'bolt';
  if (isHost(h, 'stackblitz.com')) return 'stackblitz';
  if (h === 'lovable.dev') return 'lovable';
  return undefined;
}

/** Project root (`https://replit.com/@u/p`, `https://bolt.new/~/slug`, …) → label. */
export function surfaceLabelForProjectRoot(projectRoot: string | null | undefined): string | undefined {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) return undefined;
  try {
    return surfaceLabelForHostname(new URL(projectRoot).hostname);
  } catch {
    return undefined;
  }
}

/**
 * Publish the surface for the pipeline that is about to run, or clear it when
 * the project root does not resolve to a supported site — a stale label from
 * an earlier pipeline must not outlive its own turn.
 */
export function applyLLMAttributionEnv(projectRoot: string | null | undefined): void {
  const holder = globalThis as EnvHolder;
  holder.process ??= {};
  holder.process.env ??= {};
  const surface = surfaceLabelForProjectRoot(projectRoot);
  if (surface !== undefined) holder.process.env[NEXPATH_SURFACE_ENV] = surface;
  else delete holder.process.env[NEXPATH_SURFACE_ENV];
}

/**
 * The headers for a call that is going to the Nexpath service. The client
 * label is unconditional; the surface is included only when a well-formed one
 * is published. Callers must not attach these to a call bound for OpenAI.
 */
export function attributionHeadersFromEnv(): Record<string, string> {
  const headers: Record<string, string> = { [NEXPATH_CLIENT_HEADER]: NEXPATH_CLIENT_LABEL };
  const surface = (globalThis as EnvHolder).process?.env?.[NEXPATH_SURFACE_ENV];
  if (typeof surface === 'string' && LABEL_SHAPE.test(surface)) headers[NEXPATH_SURFACE_HEADER] = surface;
  return headers;
}
