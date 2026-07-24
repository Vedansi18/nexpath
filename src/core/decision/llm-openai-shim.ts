import type OpenAI from 'openai';
import type { LLMPort } from '../ports/llm.port.js';

/**
 * Adapt an {@link LLMPort} to the minimal OpenAI-SDK surface that
 * `decision-session/OptionGenerator.generateOptionList` calls, namely
 * `client.chat.completions.create(params, { timeout })` returning
 * `{ choices: [{ message: { content } }] }`.
 *
 * Why this exists: `generateOptionList` is a large, battle-tested,
 * SDK-shaped function (2 LLM passes, retries, runtime substitutions) that the
 * CLI drives with a real OpenAI client. Rather than reimplement it for the
 * browser — or churn its ~30 SDK-shaped unit tests — the browser reuses it
 * verbatim through this thin shim, backed by the browser's FetchLLMAdapter.
 * The CLI keeps passing a real OpenAI client and never touches this file.
 *
 * Only the `.chat.completions.create` path is implemented — the sole method
 * `generateOptionList` uses. The result is cast to `OpenAI` because the
 * function's parameter is typed to the SDK; structurally it is exactly the
 * subset invoked at runtime.
 */
export function llmToOpenAIClient(llm: LLMPort): OpenAI {
  const create = async (
    params: {
      model: string;
      messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
      temperature?: number;
      max_tokens?: number;
      response_format?: { type: 'json_object' | 'text' };
    },
    options?: { timeout?: number },
  ): Promise<{ choices: { message: { content: string } }[] }> => {
    const content = await llm.chat({
      model:           params.model,
      messages:        params.messages,
      temperature:     params.temperature,
      max_tokens:      params.max_tokens,
      response_format: params.response_format,
      timeoutMs:       options?.timeout,
    });
    return { choices: [{ message: { content } }] };
  };

  return { chat: { completions: { create } } } as unknown as OpenAI;
}
