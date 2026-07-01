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
