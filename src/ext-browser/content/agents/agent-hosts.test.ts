import { describe, it, expect } from 'vitest';
import { resolveAgentFromHostname, resolveProjectRootFromLocation } from './agent-hosts.js';

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

describe('resolveProjectRootFromLocation (per-project session roots — CLI parity)', () => {
  it('bolt project page → origin + /~/<slug>', () => {
    expect(resolveProjectRootFromLocation('bolt.new', '/~/sb1-acwdroy6', 'https://bolt.new'))
      .toBe('https://bolt.new/~/sb1-acwdroy6');
  });

  it('bolt project sub-path still resolves to the project slug only', () => {
    expect(resolveProjectRootFromLocation('bolt.new', '/~/sb1-acwdroy6/settings', 'https://bolt.new'))
      .toBe('https://bolt.new/~/sb1-acwdroy6');
  });

  it('bolt.new landing page → null (capture must be skipped; the prompt re-arrives on the project page)', () => {
    expect(resolveProjectRootFromLocation('bolt.new', '/', 'https://bolt.new')).toBeNull();
  });

  it('stackblitz subdomain uses the same /~/<slug> shape', () => {
    expect(resolveProjectRootFromLocation('abc.stackblitz.com', '/~/xyz', 'https://abc.stackblitz.com'))
      .toBe('https://abc.stackblitz.com/~/xyz');
  });

  it('replit project page → origin + /@user/project', () => {
    expect(resolveProjectRootFromLocation('replit.com', '/@vedansi18/Hello-World', 'https://replit.com'))
      .toBe('https://replit.com/@vedansi18/Hello-World');
  });

  it('replit non-project pages → null', () => {
    expect(resolveProjectRootFromLocation('replit.com', '/~', 'https://replit.com')).toBeNull();
    expect(resolveProjectRootFromLocation('replit.com', '/', 'https://replit.com')).toBeNull();
  });

  it('lovable → null until the B5 recon confirms its project URL shape', () => {
    expect(resolveProjectRootFromLocation('lovable.dev', '/projects/my-app', 'https://lovable.dev')).toBeNull();
  });

  it('unknown hosts → null', () => {
    expect(resolveProjectRootFromLocation('example.com', '/anything', 'https://example.com')).toBeNull();
  });
});
