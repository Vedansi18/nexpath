import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChromeStorageKeyAdapter } from './storage-chrome.js';

const mockGet = vi.fn();

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: mockGet,
    },
  },
});

describe('ChromeStorageKeyAdapter', () => {
  beforeEach(() => {
    mockGet.mockClear();
  });

  it('returns the key value when present in storage', async () => {
    mockGet.mockResolvedValueOnce({ openai_api_key: 'sk-abc123' });
    const adapter = new ChromeStorageKeyAdapter();
    const result = await adapter.getKey('openai_api_key');
    expect(result).toBe('sk-abc123');
  });

  it('returns null when key is not in storage', async () => {
    mockGet.mockResolvedValueOnce({});
    const adapter = new ChromeStorageKeyAdapter();
    const result = await adapter.getKey('openai_api_key');
    expect(result).toBeNull();
  });

  it('returns null when value is empty string', async () => {
    mockGet.mockResolvedValueOnce({ openai_api_key: '' });
    const adapter = new ChromeStorageKeyAdapter();
    const result = await adapter.getKey('openai_api_key');
    expect(result).toBeNull();
  });

  it('returns null when value is not a string', async () => {
    mockGet.mockResolvedValueOnce({ openai_api_key: 42 });
    const adapter = new ChromeStorageKeyAdapter();
    const result = await adapter.getKey('openai_api_key');
    expect(result).toBeNull();
  });

  it('calls chrome.storage.local.get with the key name', async () => {
    mockGet.mockResolvedValueOnce({ some_key: 'val' });
    const adapter = new ChromeStorageKeyAdapter();
    await adapter.getKey('some_key');
    expect(mockGet).toHaveBeenCalledWith('some_key');
  });
});
