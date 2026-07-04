import { describe, it, expect } from 'vitest';
import { replitAdapter } from './replit.js';
import { getAdapter } from '../../registry.js';

describe('replitAdapter', () => {
  it('has the expected BrowserExtensionAdapter shape', () => {
    expect(replitAdapter.id).toBe('replit');
    expect(replitAdapter.category).toBe('browser-extension');
    expect(replitAdapter.origins).toEqual(['https://*.replit.com/*']);
    expect(replitAdapter.capture).toEqual(['mutation-observer', 'dom-events']);
    expect(replitAdapter.contentScriptModule).toBe('content/agents/replit.js');
  });

  it('is deliberately not registered in the Node CLI agent registry', () => {
    expect(getAdapter('replit')).toBeUndefined();
  });

  it('detect() returns false — no meaningful Node-CLI-side detection for a browser agent', () => {
    expect(replitAdapter.detect()).toBe(false);
  });

  it('install() is a no-op that reports skipped with an explanatory note', async () => {
    const result = await replitAdapter.install({ home: '/tmp', cwd: '/tmp', yes: true, dbPath: ':memory:' });
    expect(result.status).toBe('skipped');
    expect(result.notes).toMatch(/browser extension/i);
  });

  it('uninstall() resolves without throwing', async () => {
    await expect(
      replitAdapter.uninstall({ home: '/tmp', cwd: '/tmp', yes: true, dbPath: ':memory:' }),
    ).resolves.toBeUndefined();
  });
});
