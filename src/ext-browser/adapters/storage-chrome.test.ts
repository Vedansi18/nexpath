import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChromeStorageKeyAdapter } from './storage-chrome.js';

// vi.mock is hoisted above imports — vi.hoisted is the supported escape hatch
// for identifiers the factory needs to reference (see src/ext-vscode precedent).
const { mockGet, mockSet } = vi.hoisted(() => ({ mockGet: vi.fn(), mockSet: vi.fn() }));

vi.mock('webextension-polyfill', () => ({
  default: { storage: { local: { get: mockGet, set: mockSet } } },
}));

describe('ChromeStorageKeyAdapter', () => {
  beforeEach(() => {
    mockGet.mockClear();
    mockSet.mockClear();
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

  it('setKey writes the value under the key name via storage.local.set', async () => {
    mockSet.mockResolvedValueOnce(undefined);
    const adapter = new ChromeStorageKeyAdapter();
    await adapter.setKey('nexpath_last_prompt::https://bolt.new', '{"text":"hi","at":1}');
    expect(mockSet).toHaveBeenCalledWith({ 'nexpath_last_prompt::https://bolt.new': '{"text":"hi","at":1}' });
  });
});
