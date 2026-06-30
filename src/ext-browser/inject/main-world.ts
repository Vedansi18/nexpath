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
  window.postMessage(msg, '*');
}

/** Emit a response-stopped event to the ISOLATED content script world. */
export function emitResponseStopped(agent: string): void {
  const msg: ResponseStoppedMsg = { type: 'nexpath:response-stopped', agent };
  window.postMessage(msg, '*');
}

// ── Stub fetch patcher (B3/B4/B5 fill in per-agent logic) ────────────────────

const _nativeFetch = window.fetch.bind(window);

window.fetch = async function patchedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  // Per-agent interception hooks will be registered here in B3/B4/B5.
  // For B2 (skeleton), pass through untouched.
  return _nativeFetch(input, init);
};

// Expose helpers so per-agent modules (loaded separately) can call them.
(globalThis as Record<string, unknown>)['__nexpath_emit_prompt__'] = emitPromptCaptured;
(globalThis as Record<string, unknown>)['__nexpath_emit_stopped__'] = emitResponseStopped;
(globalThis as Record<string, unknown>)['__nexpath_native_fetch__'] = _nativeFetch;
