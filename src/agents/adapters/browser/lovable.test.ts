import { describe, it, expect } from 'vitest';
import { lovableAdapter } from './lovable.js';
import { getAdapter } from '../../registry.js';

describe('lovableAdapter', () => {
  it('has the expected BrowserExtensionAdapter shape', () => {
    expect(lovableAdapter.id).toBe('lovable');
    expect(lovableAdapter.category).toBe('browser-extension');
    expect(lovableAdapter.origins).toEqual(['https://lovable.dev/*']);
    expect(lovableAdapter.capture).toEqual(['fetch', 'dom-events', 'mutation-observer']);
    expect(lovableAdapter.contentScriptModule).toBe('content/agents/lovable.js');
  });

  it('is deliberately not registered in the Node CLI agent registry', () => {
    expect(getAdapter('lovable')).toBeUndefined();
  });

  it('detect() returns false — no meaningful Node-CLI-side detection for a browser agent', () => {
    expect(lovableAdapter.detect()).toBe(false);
  });

  it('install() is a no-op that reports skipped with an explanatory note', async () => {
    const result = await lovableAdapter.install({ home: '/tmp', cwd: '/tmp', yes: true, dbPath: ':memory:' });
    expect(result.status).toBe('skipped');
    expect(result.notes).toMatch(/browser extension/i);
  });

  it('uninstall() resolves without throwing', async () => {
    await expect(
      lovableAdapter.uninstall({ home: '/tmp', cwd: '/tmp', yes: true, dbPath: ':memory:' }),
    ).resolves.toBeUndefined();
  });
});
