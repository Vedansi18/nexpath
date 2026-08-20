import { describe, it, expect } from 'vitest';
import { boltAdapter } from './bolt.js';
import { getAdapter } from '../../registry.js';

describe('boltAdapter', () => {
  it('has the expected BrowserExtensionAdapter shape', () => {
    expect(boltAdapter.id).toBe('bolt');
    expect(boltAdapter.category).toBe('browser-extension');
    expect(boltAdapter.origins).toEqual(['https://bolt.new/*', 'https://*.stackblitz.com/*']);
    expect(boltAdapter.capture).toEqual(['fetch', 'dom-events', 'mutation-observer']);
    expect(boltAdapter.contentScriptModule).toBe('content/agents/bolt.js');
  });

  it('is deliberately not registered in the Node CLI agent registry', () => {
    expect(getAdapter('bolt')).toBeUndefined();
  });

  it('detect() returns false — no meaningful Node-CLI-side detection for a browser agent', () => {
    expect(boltAdapter.detect()).toBe(false);
  });

  it('install() is a no-op that reports skipped with an explanatory note', async () => {
    const result = await boltAdapter.install({ home: '/tmp', cwd: '/tmp', yes: true, dbPath: ':memory:' });
    expect(result.status).toBe('skipped');
    expect(result.notes).toMatch(/browser extension/i);
  });

  it('uninstall() resolves without throwing', async () => {
    await expect(
      boltAdapter.uninstall({ home: '/tmp', cwd: '/tmp', yes: true, dbPath: ':memory:' }),
    ).resolves.toBeUndefined();
  });
});
