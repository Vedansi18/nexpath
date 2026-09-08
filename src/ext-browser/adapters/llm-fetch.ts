import type { LLMPort, LLMChatParams } from '../../core/ports/llm.port.js';
import { NEXPATH_CREDIT_EXHAUSTED_AT_KEY } from './llm-credentials.js';
import { attributionHeadersFromEnv } from './llm-attribution.js';

export const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';

type EnvHolder = { process?: { env?: Record<string, string | undefined> } };

/**
 * The chat endpoint honours the polyfilled env's `OPENAI_BASE_URL` — set by
 * `llm-credentials.ts`'s `applyLLMCredentialEnv` in Nexpath-token mode, absent
 * otherwise — mirroring how the real OpenAI SDK (and the CLI's resolver seam)
 * treat that variable. Resolved per call, not at construction, because the
 * credential is runtime-dynamic (options page) while adapters are constructed
 * all over the service worker with just the key.
 */
function chatUrlFromEnv(): string | undefined {
  const base = (globalThis as EnvHolder).process?.env?.['OPENAI_BASE_URL'];
  if (typeof base === 'string' && base.length > 0) {
    return `${base.replace(/\/+$/, '')}/chat/completions`;
  }
  return undefined;
}

export class FetchLLMAdapter implements LLMPort {
  constructor(
    private readonly apiKey: string,
    /** Explicit override for tests; normal construction omits it. */
    private readonly chatUrl?: string,
  ) {}

  async chat(params: LLMChatParams): Promise<string> {
    const body: Record<string, unknown> = {
      model: params.model,
      messages: params.messages,
      temperature: params.temperature,
    };
    if (params.max_tokens !== undefined) body['max_tokens'] = params.max_tokens;
    if (params.response_format !== undefined) body['response_format'] = params.response_format;

    let signal: AbortSignal | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (params.timeoutMs !== undefined) {
      const controller = new AbortController();
      signal = controller.signal;
      timer = setTimeout(() => controller.abort(), params.timeoutMs);
    }

    const serviceUrl = chatUrlFromEnv();
    const url = this.chatUrl ?? serviceUrl ?? OPENAI_CHAT_URL;
    // The attribution labels (client + site — llm-attribution.ts) travel ONLY
    // when the env has routed this call to the Nexpath service. A user's own
    // key goes to api.openai.com, where the worker holds no host permission:
    // a custom header there would turn the call into a CORS preflight OpenAI
    // does not answer for these names, and BYOK would break outright.
    const attribution = serviceUrl !== undefined ? attributionHeadersFromEnv() : {};
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          ...attribution,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      // The engine classifies composer failures by the error's wording
      // (`llm-composer.ts:116-120`: name or message matching timeout/timed out
      // → 'timeout', anything else → 'provider_error'). An aborted fetch
      // throws AbortError/"The operation was aborted", which matches NEITHER —
      // so a browser-side timeout would masquerade as a provider outage. The
      // real OpenAI SDK throws "Request timed out"; present the same.
      if (signal?.aborted) {
        throw new Error(`OpenAI fetch timed out after ${params.timeoutMs}ms`);
      }
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => resp.statusText);
      // 402 is the Nexpath service refusing for lack of credit — the one
      // failure the user can fix and the one the pipeline would otherwise hide.
      // The throw below is unchanged (fail-open: the prompt still goes through
      // untouched); this only leaves a note the settings page can read.
      // Best-effort and never awaited on the throw path: a storage failure must
      // not change what this call reports.
      if (resp.status === 402) void noteCreditExhausted();
      throw new Error(`OpenAI fetch error ${resp.status}: ${text}`);
    }

    const json = await resp.json() as { choices?: { message?: { content?: string } }[] };
    return json.choices?.[0]?.message?.content ?? '';
  }
}

/**
 * Record that the service refused a call for lack of credit. Reads
 * `browser.storage.local` only if it exists (the adapter is also constructed
 * in tests and the options page, where there may be no extension context).
 */
async function noteCreditExhausted(): Promise<void> {
  try {
    const store = (globalThis as { browser?: { storage?: { local?: { set(v: Record<string, unknown>): Promise<void> } } } })
      .browser?.storage?.local;
    if (store) await store.set({ [NEXPATH_CREDIT_EXHAUSTED_AT_KEY]: Date.now() });
  } catch {
    /* best-effort only */
  }
}
