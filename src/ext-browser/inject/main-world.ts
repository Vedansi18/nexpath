/**
 * Runs in the MAIN world (injected via <script> tag from main-world-injector.ts).
 *
 * Responsibilities:
 *   - Patch window.fetch to detect when the agent's prompt submission endpoint
 *     is called, extract the prompt text, and emit postMessage to the content script.
 *
 * NOTE: Actual fetch-interception patterns per agent site (Replit/Bolt/Lovable)
 * are implemented in B3/B4/B5. This file establishes the MAIN-world entry point
 * and the postMessage emit helper only.
 */

import { resolveAgentFromHostname } from '../content/agents/agent-hosts.js';

type PromptCapturedMsg = {
  type: 'nexpath:prompt-captured';
  promptText: string;
  agent: string;
};

type ResponseStoppedMsg = {
  type: 'nexpath:response-stopped';
  agent: string;
};

/** Emit a captured prompt to the ISOLATED content script world. */
export function emitPromptCaptured(promptText: string, agent: string): void {
  const msg: PromptCapturedMsg = { type: 'nexpath:prompt-captured', promptText, agent };
  // Use location.origin (not '*') so the message is only delivered to this page.
  window.postMessage(msg, window.location.origin);
}

/** Emit a response-stopped event to the ISOLATED content script world. */
export function emitResponseStopped(agent: string): void {
  const msg: ResponseStoppedMsg = { type: 'nexpath:response-stopped', agent };
  window.postMessage(msg, window.location.origin);
}

// ── Fetch-interception rules (per agent, recon-confirmed transports only) ─────
//
// B4 (Bolt) is the first real consumer: recon confirmed the prompt travels in a
// page-context `POST /api/chat/v2` whose JSON body carries the full `messages`
// history with the newest entry `{role:'user', content:'<prompt string>'}` — see
// internal recon. Replit deliberately has NO rule here (its
// chat is binary MessagePack over WS — fetch confirmed non-viable in B3 recon).
//
// The extracted prompt is posted as `nexpath:fetch-prompt` — a DISTINCT message
// type that main-world-injector.ts does NOT forward. Only the agent's capture kit
// listens for it (capture-kit.ts observeFetchPrompts) and routes the text through
// its single emitIfNewText funnel, so this channel can never double-emit a prompt
// the composer/observer channels also saw.

export interface FetchCaptureRule {
  agent: string;
  /** Substring the request URL must contain (matched only for POSTs on this agent's host). */
  urlIncludes: string;
  /**
   * Optional exact-path guard: the URL's pathname must END with this string.
   * B4's lesson made concrete — a bare substring matched Bolt's project-persist
   * endpoint and replayed historical prompts; when an agent's API has sibling
   * endpoints (Lovable: `/projects/<id>/chat` vs other `/projects/<id>/…` calls),
   * pin the pathname tail instead of widening the substring.
   */
  pathEndsWith?: string;
  /** Extract the newest user prompt from the raw request body, or null to ignore. */
  extractPrompt(bodyText: string): string | null;
}

/**
 * Extract the newest `{role:'user'}` message's string content from an AI-SDK-style
 * `{messages: [...]}` JSON body. Walks backwards so trailing non-user entries
 * (assistant placeholders, tool results) never shadow the real prompt.
 */
export function extractLastUserMessage(bodyText: string): string | null {
  try {
    const parsed = JSON.parse(bodyText) as { messages?: Array<{ role?: unknown; content?: unknown }> };
    if (!Array.isArray(parsed.messages)) return null;
    for (let i = parsed.messages.length - 1; i >= 0; i--) {
      const m = parsed.messages[i];
      if (m && m.role === 'user' && typeof m.content === 'string') {
        const text = m.content.trim();
        return text.length > 0 ? text : null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extract the prompt from Lovable's chat POST body. Strict shape guard (B4
 * lesson): `{"id":"umsg_…","message":"<prompt>", …}` — both conditions must hold
 * so any lookalike endpoint or non-user payload yields null instead of a capture.
 * Confirmed live 2026-07-06 (internal recon).
 */
export function extractLovableMessage(bodyText: string): string | null {
  try {
    const parsed = JSON.parse(bodyText) as { id?: unknown; message?: unknown };
    if (typeof parsed.id !== 'string' || !parsed.id.startsWith('umsg_')) return null;
    if (typeof parsed.message !== 'string') return null;
    const text = parsed.message.trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

export const FETCH_CAPTURE_RULES: FetchCaptureRule[] = [
  // '/api/chat/v2' exactly — NOT the broader '/api/chat' substring. Bolt also POSTs
  // its project-persist payload to /api/chats/<id> (matches the substring, carries
  // the full messages history); on a page load with unsaved state that persist call
  // re-captures the LAST HISTORICAL user prompt and fires a spurious advisory with
  // zero user action (observed live 2026-07-06). Only the generation endpoint
  // carries a prompt the user just submitted.
  { agent: 'bolt', urlIncludes: '/api/chat/v2', extractPrompt: extractLastUserMessage },
  // Lovable: POST https://api.lovable.dev/projects/<uuid>/chat — pathname tail
  // pinned exactly (§ pathEndsWith doc above), body shape guarded in the extractor.
  { agent: 'lovable', urlIncludes: 'api.lovable.dev/projects/', pathEndsWith: '/chat', extractPrompt: extractLovableMessage },
];

export function emitFetchPrompt(promptText: string, agent: string): void {
  window.postMessage(
    { type: 'nexpath:fetch-prompt', promptText, agent },
    window.location.origin,
  );
}

async function maybeCaptureFetch(input: RequestInfo | URL, init?: RequestInit): Promise<void> {
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const method = (
    init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')
  ).toUpperCase();
  if (method !== 'POST') return;
  const agent = resolveAgentFromHostname(window.location.hostname);
  const rule = FETCH_CAPTURE_RULES.find((r) => {
    if (r.agent !== agent || !url.includes(r.urlIncludes)) return false;
    if (r.pathEndsWith !== undefined) {
      try {
        if (!new URL(url, window.location.origin).pathname.endsWith(r.pathEndsWith)) return false;
      } catch {
        return false;
      }
    }
    return true;
  });
  if (!rule) return;
  let bodyText: string | null = typeof init?.body === 'string' ? init.body : null;
  if (bodyText === null && input instanceof Request) {
    // clone() lets us read the body without consuming the page's own copy.
    try {
      bodyText = await input.clone().text();
    } catch {
      return;
    }
  }
  if (!bodyText) return;
  const prompt = rule.extractPrompt(bodyText);
  if (prompt) emitFetchPrompt(prompt, agent);
}

const _nativeFetch = window.fetch.bind(window);

window.fetch = function patchedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  // Fire-and-forget: capture must never delay, alter, or break the page's own
  // request — the native call goes out immediately regardless of what the
  // capture path does, and any capture error is swallowed after being isolated.
  void maybeCaptureFetch(input, init).catch(() => {});
  return _nativeFetch(input, init);
};

// Expose helpers so per-agent modules (loaded separately) can call them.
(globalThis as Record<string, unknown>)['__nexpath_emit_prompt__'] = emitPromptCaptured;
(globalThis as Record<string, unknown>)['__nexpath_emit_stopped__'] = emitResponseStopped;
(globalThis as Record<string, unknown>)['__nexpath_native_fetch__'] = _nativeFetch;
