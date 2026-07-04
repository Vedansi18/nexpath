import { describe, it, expect } from 'vitest';
import { resolveAgentFromHostname } from './agent-hosts.js';

describe('resolveAgentFromHostname', () => {
  it('maps replit.com and its subdomains to replit', () => {
    expect(resolveAgentFromHostname('replit.com')).toBe('replit');
    expect(resolveAgentFromHostname('firewalledreplit.com')).toBe('replit');
  });

  it('maps bolt.new to bolt', () => {
    expect(resolveAgentFromHostname('bolt.new')).toBe('bolt');
  });

  it('maps stackblitz.com subdomains to bolt', () => {
    expect(resolveAgentFromHostname('abc.stackblitz.com')).toBe('bolt');
  });

  it('maps lovable.dev to lovable', () => {
    expect(resolveAgentFromHostname('lovable.dev')).toBe('lovable');
  });

  it('returns unknown for anything else', () => {
    expect(resolveAgentFromHostname('example.com')).toBe('unknown');
    expect(resolveAgentFromHostname('localhost')).toBe('unknown');
  });
});
