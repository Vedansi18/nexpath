import { describe, it, expect, vi } from 'vitest';
import { OpenAILLMAdapter } from './llm.adapter.js';

// ── Mock OpenAI client ────────────────────────────────────────────────────────

function makeOpenAI(content: string) {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content } }],
        }),
      },
    },
  };
}

function makeErrorOpenAI() {
  return {
    chat: {
      completions: {
        create: vi.fn().mockRejectedValue(new Error('openai api error')),
      },
    },
  };
}

// ── OpenAILLMAdapter ──────────────────────────────────────────────────────────

describe('OpenAILLMAdapter.chat', () => {
  it('returns the content string from the API response', async () => {
    const client = makeOpenAI('hello world');
    const adapter = new OpenAILLMAdapter(client as never);
    const result = await adapter.chat({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'test' }] });
    expect(result).toBe('hello world');
  });

  it('returns empty string when choices[0].message.content is null', async () => {
    const client = { chat: { completions: { create: vi.fn().mockResolvedValue({ choices: [{ message: { content: null } }] }) } } };
    const adapter = new OpenAILLMAdapter(client as never);
    const result = await adapter.chat({ model: 'gpt-4o-mini', messages: [] });
    expect(result).toBe('');
  });

  it('returns empty string when choices array is empty', async () => {
    const client = { chat: { completions: { create: vi.fn().mockResolvedValue({ choices: [] }) } } };
    const adapter = new OpenAILLMAdapter(client as never);
    const result = await adapter.chat({ model: 'gpt-4o-mini', messages: [] });
    expect(result).toBe('');
  });

  it('passes model to the OpenAI API call', async () => {
    const client = makeOpenAI('ok');
    const adapter = new OpenAILLMAdapter(client as never);
    await adapter.chat({ model: 'gpt-4o-mini', messages: [] });
    expect(client.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o-mini' }),
      undefined,
    );
  });

  it('passes messages to the OpenAI API call', async () => {
    const client = makeOpenAI('ok');
    const adapter = new OpenAILLMAdapter(client as never);
    const messages = [{ role: 'user' as const, content: 'hello' }];
    await adapter.chat({ model: 'gpt-4o-mini', messages });
    expect(client.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({ messages }),
      undefined,
    );
  });

  it('passes temperature when provided', async () => {
    const client = makeOpenAI('ok');
    const adapter = new OpenAILLMAdapter(client as never);
    await adapter.chat({ model: 'gpt-4o-mini', messages: [], temperature: 0 });
    expect(client.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0 }),
      undefined,
    );
  });

  it('passes max_tokens when provided', async () => {
    const client = makeOpenAI('ok');
    const adapter = new OpenAILLMAdapter(client as never);
    await adapter.chat({ model: 'gpt-4o-mini', messages: [], max_tokens: 80 });
    expect(client.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 80 }),
      undefined,
    );
  });

  it('passes response_format when provided', async () => {
    const client = makeOpenAI('ok');
    const adapter = new OpenAILLMAdapter(client as never);
    await adapter.chat({ model: 'gpt-4o-mini', messages: [], response_format: { type: 'json_object' } });
    expect(client.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({ response_format: { type: 'json_object' } }),
      undefined,
    );
  });

  it('passes timeout option when timeoutMs is provided', async () => {
    const client = makeOpenAI('ok');
    const adapter = new OpenAILLMAdapter(client as never);
    await adapter.chat({ model: 'gpt-4o-mini', messages: [], timeoutMs: 5_000 });
    expect(client.chat.completions.create).toHaveBeenCalledWith(
      expect.any(Object),
      { timeout: 5_000 },
    );
  });

  it('does not pass timeout option when timeoutMs is undefined', async () => {
    const client = makeOpenAI('ok');
    const adapter = new OpenAILLMAdapter(client as never);
    await adapter.chat({ model: 'gpt-4o-mini', messages: [] }); // no timeoutMs
    expect(client.chat.completions.create).toHaveBeenCalledWith(
      expect.any(Object),
      undefined,
    );
  });

  it('propagates API errors', async () => {
    const adapter = new OpenAILLMAdapter(makeErrorOpenAI() as never);
    await expect(
      adapter.chat({ model: 'gpt-4o-mini', messages: [] }),
    ).rejects.toThrow('openai api error');
  });
});
