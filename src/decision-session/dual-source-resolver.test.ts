import { describe, it, expect } from 'vitest';
import { MIGRATED_SIGNALS, resolveContentSource } from './selection-registry.js';

// §6.1 gate 1 (S2): the dual-source resolver decides, per signalType, whether an
// advisory is served from the static DecisionContent set or the content-template
// engine. The shipped marker is EMPTY (ship-dark) so every signal stays static and
// cascade parity is preserved; per-set migration flips one signal at a time (S8).

describe('§6.1 gate 1 — dual-source resolver + migration marker', () => {
  it('ships dark — the migration marker is empty (nothing migrated)', () => {
    expect(MIGRATED_SIGNALS.size).toBe(0);
  });

  it('resolves EVERY signalType to static while the marker is empty (parity preserved)', () => {
    for (const s of ['test_creation', 'context_loss', 'session_length_checkpoint', 'contract_testing_gap', 'x_unknown']) {
      expect(resolveContentSource(s)).toBe('static');
    }
  });

  it('resolves a migrated signalType to content-template, others to static (dispatch)', () => {
    const marker: ReadonlySet<string> = new Set(['test_creation']);
    expect(resolveContentSource('test_creation', marker)).toBe('content-template');
    expect(resolveContentSource('context_loss', marker)).toBe('static');
  });

  it('is a pure function of the marker — coexistence: static + migrated resolve side by side', () => {
    const marker: ReadonlySet<string> = new Set(['a_migrated']);
    expect(resolveContentSource('a_migrated', marker)).toBe('content-template');
    expect(resolveContentSource('a_static', marker)).toBe('static');
  });
});
