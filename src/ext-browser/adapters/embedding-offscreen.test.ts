import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OffscreenEmbeddingAdapter } from './embedding-offscreen.js';
import type { ClassificationResult } from '../../core/classifier/types.js';

const { sendMessageMock } = vi.hoisted(() => ({ sendMessageMock: vi.fn() }));

vi.mock('webextension-polyfill', () => ({
  default: { runtime: { sendMessage: sendMessageMock } },
}));

describe('OffscreenEmbeddingAdapter', () => {
  beforeEach(() => {
    sendMessageMock.mockReset();
  });

  it('sends a nexpath:embedding-classify message with the text', async () => {
    const result: ClassificationResult = { stage: 'implementation', confidence: 0.5, tier: 3 };
    sendMessageMock.mockResolvedValue({ result });

    const adapter = new OffscreenEmbeddingAdapter();
    await adapter.classify('write some code');

    expect(sendMessageMock).toHaveBeenCalledWith({ type: 'nexpath:embedding-classify', text: 'write some code' });
  });

  it('resolves with the classification result on success', async () => {
    const result: ClassificationResult = { stage: 'planning', confidence: 0.9, tier: 2 };
    sendMessageMock.mockResolvedValue({ result });

    const adapter = new OffscreenEmbeddingAdapter();
    const out = await adapter.classify('plan this feature');

    expect(out).toEqual(result);
  });

  it('throws when the offscreen document replies with an error', async () => {
    sendMessageMock.mockResolvedValue({ error: 'model not loaded' });

    const adapter = new OffscreenEmbeddingAdapter();
    await expect(adapter.classify('x')).rejects.toThrow('model not loaded');
  });
});
