import { describe, it, expect } from 'vitest';
import { AGENT_CAPABILITIES, resolveModeBand } from './agent-capabilities.js';

describe('resolveModeBand', () => {
  it('maps the planning mode to the plan band', () => {
    expect(resolveModeBand('claude-code', 'plan')).toBe('plan');
  });

  it('maps the default mode to the normal band', () => {
    expect(resolveModeBand('claude-code', 'default')).toBe('normal');
  });

  it('maps every autonomous mode to the execute band', () => {
    for (const mode of ['acceptEdits', 'auto', 'dontAsk', 'bypassPermissions']) {
      expect(resolveModeBand('claude-code', mode)).toBe('execute');
    }
  });

  it('returns undefined for an unrecognised mode (open enum, never guessed)', () => {
    expect(resolveModeBand('claude-code', 'some_future_mode')).toBeUndefined();
  });

  it('returns undefined for an unknown agent', () => {
    expect(resolveModeBand('other-agent', 'plan')).toBeUndefined();
  });

  it('returns undefined when no mode is supplied', () => {
    expect(resolveModeBand('claude-code', undefined)).toBeUndefined();
  });
});

describe('AGENT_CAPABILITIES registry', () => {
  it('stamps the integrated agent with a confirmation version and its known modes', () => {
    const cc = AGENT_CAPABILITIES['claude-code'];
    expect(cc).toBeDefined();
    expect(typeof cc!.version).toBe('string');
    expect(Object.keys(cc!.modes).sort()).toEqual(
      ['acceptEdits', 'auto', 'bypassPermissions', 'default', 'dontAsk', 'plan'],
    );
  });

  it('classifies each known mode into a valid band', () => {
    const bands = new Set(['plan', 'normal', 'execute']);
    for (const band of Object.values(AGENT_CAPABILITIES['claude-code']!.modes)) {
      expect(bands.has(band)).toBe(true);
    }
  });
});
