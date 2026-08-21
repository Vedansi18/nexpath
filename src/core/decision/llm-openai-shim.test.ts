import { describe, it, expect, vi } from 'vitest';
import { llmToOpenAIClient } from './llm-openai-shim.js';
import type { LLMPort, LLMChatParams } from '../ports/llm.port.js';

// Minimal typed view of the single SDK path generateOptionList uses.
type SdkCreate = (
  params: {
    model: string;
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
    temperature?: number;
    max_tokens?: number;
    response_format?: { type: 'json_object' | 'text' };
  },
  options?: { timeout?: number },
) => Promise<{ choices: { message: { content: string } }[] }>;

function createOf(client: ReturnType<typeof llmToOpenAIClient>): SdkCreate {
  return (client as unknown as { chat: { completions: { create: SdkCreate } } })
    .chat.completions.create;
}

describe('core/decision/llm-openai-shim — llmToOpenAIClient', () => {
  it('forwards every param to LLMPort.chat and maps { timeout } → timeoutMs', async () => {
    const chat = vi.fn<[LLMChatParams], Promise<string>>().mockResolvedValue('ok');
    const llm: LLMPort = { chat };

    await createOf(llmToOpenAIClient(llm))(
      {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'hi' }],
        temperature: 0,
        max_tokens: 900,
        response_format: { type: 'json_object' },
      },
      { timeout: 12_000 },
    );

    expect(chat).toHaveBeenCalledWith({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0,
      max_tokens: 900,
      response_format: { type: 'json_object' },
      timeoutMs: 12_000,
    });
  });

  it('wraps the returned content string in the SDK { choices: [{ message: { content } }] } shape', async () => {
    const llm: LLMPort = { chat: vi.fn().mockResolvedValue('the model reply') };

    const resp = await createOf(llmToOpenAIClient(llm))(
      { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'x' }] },
    );

    expect(resp.choices[0]?.message?.content).toBe('the model reply');
  });

  it('leaves timeoutMs undefined when no { timeout } option is passed', async () => {
    const chat = vi.fn<[LLMChatParams], Promise<string>>().mockResolvedValue('');
    const llm: LLMPort = { chat };

    await createOf(llmToOpenAIClient(llm))(
      { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'x' }] },
    );

    expect(chat.mock.calls[0]?.[0].timeoutMs).toBeUndefined();
  });
});
