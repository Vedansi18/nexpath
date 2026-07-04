import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * main-world.ts patches window.fetch and emits postMessage events.
 * We test the emit helpers in isolation using mocked globals.
 */

describe('main-world emit helpers', () => {
  const postMessageSpy = vi.fn();

  beforeEach(() => {
    postMessageSpy.mockClear();
    vi.stubGlobal('window', {
      postMessage: postMessageSpy,
      fetch: vi.fn(),
      location: { origin: 'https://replit.com' },
    });
    vi.resetModules();
  });

  it('emitPromptCaptured posts to location.origin (not *)', async () => {
    const { emitPromptCaptured } = await import('./main-world.js');
    emitPromptCaptured('write some code', 'replit');
    expect(postMessageSpy).toHaveBeenCalledWith(
      { type: 'nexpath:prompt-captured', promptText: 'write some code', agent: 'replit' },
      'https://replit.com',
    );
  });

  it('emitResponseStopped posts to location.origin (not *)', async () => {
    const { emitResponseStopped } = await import('./main-world.js');
    emitResponseStopped('bolt');
    expect(postMessageSpy).toHaveBeenCalledWith(
      { type: 'nexpath:response-stopped', agent: 'bolt' },
      'https://replit.com',
    );
  });

  it('exposes __nexpath_emit_prompt__ on globalThis', async () => {
    await import('./main-world.js');
    expect(typeof (globalThis as Record<string, unknown>)['__nexpath_emit_prompt__']).toBe('function');
  });

  it('exposes __nexpath_emit_stopped__ on globalThis', async () => {
    await import('./main-world.js');
    expect(typeof (globalThis as Record<string, unknown>)['__nexpath_emit_stopped__']).toBe('function');
  });

  it('exposes __nexpath_native_fetch__ on globalThis', async () => {
    await import('./main-world.js');
    expect(typeof (globalThis as Record<string, unknown>)['__nexpath_native_fetch__']).toBe('function');
  });

  it('patches window.fetch', async () => {
    const originalFetch = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal('window', {
      postMessage: postMessageSpy,
      fetch: originalFetch,
      location: { origin: 'https://replit.com' },
    });
    vi.resetModules();

    await import('./main-world.js');
    // After patching, window.fetch should be a different function (the patchedFetch wrapper)
    // but still callable — it should pass through to the native fetch
    expect(window.fetch).not.toBe(originalFetch);
    expect(typeof window.fetch).toBe('function');
  });
});

describe('fetch capture rules (B4 — Bolt transport, recon-confirmed)', () => {
  const postMessageSpy = vi.fn();
  const nativeFetch = vi.fn().mockResolvedValue({ ok: true } as unknown as Response);

  function stubWindow(hostname: string): void {
    vi.stubGlobal('window', {
      postMessage: postMessageSpy,
      fetch: nativeFetch,
      location: { origin: `https://${hostname}`, hostname },
    });
  }

  function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  beforeEach(() => {
    postMessageSpy.mockClear();
    nativeFetch.mockClear();
    vi.resetModules();
  });

  describe('extractLastUserMessage', () => {
    it('extracts the newest user message content from an AI-SDK messages body', async () => {
      stubWindow('bolt.new');
      const { extractLastUserMessage } = await import('./main-world.js');
      const body = JSON.stringify({
        messages: [
          { role: 'user', content: 'older prompt' },
          { role: 'assistant', content: 'reply' },
          { role: 'user', content: 'what is supervised learning exactly' },
        ],
        projectId: '123',
      });
      expect(extractLastUserMessage(body)).toBe('what is supervised learning exactly');
    });

    it('walks backwards past trailing non-user entries', async () => {
      stubWindow('bolt.new');
      const { extractLastUserMessage } = await import('./main-world.js');
      const body = JSON.stringify({
        messages: [
          { role: 'user', content: 'the real prompt' },
          { role: 'assistant', content: 'streaming placeholder' },
        ],
      });
      expect(extractLastUserMessage(body)).toBe('the real prompt');
    });

    it('returns null for non-string content, missing messages, whitespace-only, and invalid JSON', async () => {
      stubWindow('bolt.new');
      const { extractLastUserMessage } = await import('./main-world.js');
      expect(extractLastUserMessage(JSON.stringify({ messages: [{ role: 'user', content: [{ type: 'text' }] }] }))).toBeNull();
      expect(extractLastUserMessage(JSON.stringify({ notMessages: true }))).toBeNull();
      expect(extractLastUserMessage(JSON.stringify({ messages: [{ role: 'user', content: '   ' }] }))).toBeNull();
      expect(extractLastUserMessage('not json at all')).toBeNull();
    });
  });

  it('declares a bolt rule for /api/chat', async () => {
    stubWindow('bolt.new');
    const { FETCH_CAPTURE_RULES } = await import('./main-world.js');
    const bolt = FETCH_CAPTURE_RULES.find((r) => r.agent === 'bolt');
    expect(bolt).toBeDefined();
    expect(bolt!.urlIncludes).toBe('/api/chat');
  });

  it('a POST to /api/chat/v2 on bolt.new posts a nexpath:fetch-prompt message', async () => {
    stubWindow('bolt.new');
    await import('./main-world.js');

    void window.fetch('https://bolt.new/api/chat/v2', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'build a nav bar' }] }),
    });
    await flush();

    expect(nativeFetch).toHaveBeenCalled();
    expect(postMessageSpy).toHaveBeenCalledWith(
      { type: 'nexpath:fetch-prompt', promptText: 'build a nav bar', agent: 'bolt' },
      'https://bolt.new',
    );
  });

  it('supports Request-object inputs by cloning the body', async () => {
    stubWindow('bolt.new');
    await import('./main-world.js');

    const req = new Request('https://bolt.new/api/chat/v2', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'via request object' }] }),
    });
    void window.fetch(req);
    await flush();

    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'nexpath:fetch-prompt', promptText: 'via request object' }),
      'https://bolt.new',
    );
  });

  it('ignores GETs, non-matching URLs, and hosts without a rule (replit)', async () => {
    stubWindow('bolt.new');
    await import('./main-world.js');

    void window.fetch('https://bolt.new/api/chat/v2', { method: 'GET' });
    void window.fetch('https://bolt.new/api/token-stats', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'not a chat call' }] }),
    });
    await flush();
    expect(postMessageSpy).not.toHaveBeenCalled();

    // Replit deliberately has no fetch rule (binary MessagePack WS — recon B3).
    vi.resetModules();
    stubWindow('replit.com');
    await import('./main-world.js');
    void window.fetch('https://replit.com/api/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'should not capture' }] }),
    });
    await flush();
    expect(postMessageSpy).not.toHaveBeenCalled();
  });

  it('never delays or breaks the page request when the body is unparseable', async () => {
    stubWindow('bolt.new');
    await import('./main-world.js');

    void window.fetch('https://bolt.new/api/chat/v2', { method: 'POST', body: 'garbage{{{' });
    await flush();

    expect(nativeFetch).toHaveBeenCalled();
    expect(postMessageSpy).not.toHaveBeenCalled();
  });
});
