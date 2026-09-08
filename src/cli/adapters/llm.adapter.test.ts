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

// ── Attribution headers ride on the default client ───────────────────────────
// The one CLI construction site this side owns (the 17-site map, 2026-09-08).
// Read back from the SDK's own options rather than assumed, the way the helper's
// author verified his sites.
describe('OpenAILLMAdapter — default client attribution headers', () => {
  const TOKEN = 'npk_abcdefghijklmnopqrstuvwxyz012345';
  const saved = { key: process.env['OPENAI_API_KEY'], agent: process.env['NEXPATH_AGENT'] };
  const restore = () => {
    if (saved.key === undefined) delete process.env['OPENAI_API_KEY']; else process.env['OPENAI_API_KEY'] = saved.key;
    if (saved.agent === undefined) delete process.env['NEXPATH_AGENT']; else process.env['NEXPATH_AGENT'] = saved.agent;
  };
  const headersOf = (adapter: OpenAILLMAdapter) =>
    (adapter as unknown as { client: { _options: { defaultHeaders?: unknown } } }).client._options.defaultHeaders;

  it('a Nexpath token + a named surface ⇒ both headers on the constructed client', () => {
    process.env['OPENAI_API_KEY'] = TOKEN;
    process.env['NEXPATH_AGENT'] = 'cursor';
    try {
      expect(headersOf(new OpenAILLMAdapter())).toEqual({ 'X-Nexpath-Client': 'cli', 'X-Nexpath-Surface': 'cursor' });
    } finally { restore(); }
  });

  it('a Nexpath token with no surface named ⇒ the agreed default, claude-code', () => {
    process.env['OPENAI_API_KEY'] = TOKEN;
    delete process.env['NEXPATH_AGENT'];
    try {
      expect(headersOf(new OpenAILLMAdapter())).toEqual({ 'X-Nexpath-Client': 'cli', 'X-Nexpath-Surface': 'claude-code' });
    } finally { restore(); }
  });

  it("the user's own OpenAI key ⇒ no headers at all (undefined, not an empty object)", () => {
    process.env['OPENAI_API_KEY'] = 'sk-abcdefghijklmnopqrstuvwxyz012345';
    process.env['NEXPATH_AGENT'] = 'cursor';
    try {
      expect(headersOf(new OpenAILLMAdapter())).toBeUndefined();
    } finally { restore(); }
  });

  it('an injected client is used as given — no headers are forced onto it', () => {
    const client = makeOpenAI('ok');
    const adapter = new OpenAILLMAdapter(client as never);
    expect((adapter as unknown as { client: unknown }).client).toBe(client);
  });
});

