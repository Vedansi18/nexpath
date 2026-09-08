import OpenAI from 'openai';
import { nexpathClientHeaders } from '../../config/nexpath-client-headers.js';
import type { LLMPort, LLMChatParams } from '../../core/ports/llm.port.js';

/**
 * OpenAILLMAdapter — wires LLMPort to the openai SDK.
 *
 * A single OpenAI instance is created at construction time and reused across calls.
 * The `timeoutMs` param in LLMChatParams is passed to the SDK's per-request timeout option.
 */
export class OpenAILLMAdapter implements LLMPort {
  private readonly client: OpenAI;

  constructor(client?: OpenAI) {
    // On a Nexpath token the client carries X-Nexpath-Client / X-Nexpath-Surface on
    // every request it makes (config/nexpath-client-headers.ts); on the user's own
    // OpenAI key the helper returns undefined, which the SDK treats as "no headers",
    // so those requests are byte-identical to before.
    this.client = client ?? new OpenAI({ defaultHeaders: nexpathClientHeaders() });
  }

  async chat(params: LLMChatParams): Promise<string> {
    const { timeoutMs, ...rest } = params;

    const response = await this.client.chat.completions.create(
      {
        model:           rest.model,
        messages:        rest.messages,
        temperature:     rest.temperature,
        max_tokens:      rest.max_tokens,
        response_format: rest.response_format,
      },
      timeoutMs !== undefined ? { timeout: timeoutMs } : undefined,
    );

    return response.choices[0]?.message?.content ?? '';
  }
}
