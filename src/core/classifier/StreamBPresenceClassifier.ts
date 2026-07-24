import type { LLMPort } from '../ports/llm.port.js';
import type { LogPort } from '../ports/log.port.js';

export const STREAM_B_MODEL             = 'gpt-4o-mini';
export const STREAM_B_MAX_OUTPUT_TOKENS = 60;
export const STREAM_B_TIMEOUT_MS        = 5_000;

export interface StreamBPresenceResult {
  feature_scope_before_build: boolean;
  implementation_checkpoint:  boolean;
  spec_before_code:           boolean;
}

const STREAM_B_SYSTEM_PROMPT = `You are a developer behaviour classifier. For the developer prompt provided, determine whether each of these three behaviours is genuinely present:

1. feature_scope_before_build: The developer is explicitly defining what the feature should do, writing acceptance criteria, or deciding what "done" looks like — before building it. NOT: vague questions about existing code while already building.

2. implementation_checkpoint: The developer is deliberately pausing to verify correctness — running tests, smoke-testing a specific step, checking a specific invariant before continuing. NOT: casual "does this work?" during continuous coding.

3. spec_before_code: The developer is writing or requiring a behaviour spec, expected output, or test-first definition before writing the implementation code itself. NOT: reviewing or discussing code that already exists.

Reply with compact JSON only. No explanation.
{"feature_scope_before_build":true|false,"implementation_checkpoint":true|false,"spec_before_code":true|false}`;

/**
 * Parse raw LLM response text into a StreamBPresenceResult.
 * Strips markdown fences, parses JSON, validates that all three fields are boolean.
 * Returns null on any parse or validation failure — caller substitutes all-false.
 */
export function parseStreamBResponse(raw: string): StreamBPresenceResult | null {
  try {
    const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed   = JSON.parse(stripped) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const o = parsed as Record<string, unknown>;
    if (
      typeof o['feature_scope_before_build'] !== 'boolean' ||
      typeof o['implementation_checkpoint']  !== 'boolean' ||
      typeof o['spec_before_code']           !== 'boolean'
    ) return null;
    return {
      feature_scope_before_build: o['feature_scope_before_build'] as boolean,
      implementation_checkpoint:  o['implementation_checkpoint']  as boolean,
      spec_before_code:           o['spec_before_code']           as boolean,
    };
  } catch {
    return null;
  }
}

/**
 * Classify whether each Stream B signal is genuinely present in the developer prompt.
 *
 * Makes a single gpt-4o-mini call via LLMPort — CLI uses OpenAILLMAdapter; browser uses FetchLLMAdapter.
 * Returns all-false on parse or validation failure.
 * Throws on API-level errors — callers must handle via .catch().
 *
 * @param promptText  The raw developer prompt text.
 * @param llm         LLMPort implementation.
 * @param log         Optional LogPort for debug output.
 */
export async function classifyStreamBPresence(
  promptText: string,
  llm:        LLMPort,
  log?:       LogPort,
): Promise<StreamBPresenceResult> {
  const raw = await llm.chat({
    model:           STREAM_B_MODEL,
    messages:        [
      { role: 'system', content: STREAM_B_SYSTEM_PROMPT },
      { role: 'user',   content: promptText             },
    ],
    temperature:     0,
    max_tokens:      STREAM_B_MAX_OUTPUT_TOKENS,
    response_format: { type: 'json_object' },
    timeoutMs:       STREAM_B_TIMEOUT_MS,
  });

  const result = parseStreamBResponse(raw);

  if (!result) {
    log?.debug('stream_b_presence_validation_fail', { raw: raw.slice(0, 100) });
    return { feature_scope_before_build: false, implementation_checkpoint: false, spec_before_code: false };
  }

  return result;
}
