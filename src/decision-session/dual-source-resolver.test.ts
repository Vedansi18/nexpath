import { describe, it, expect } from 'vitest';
import type { UserProfile } from '../classifier/types.js';
import { MIGRATED_SIGNALS, resolveContentSource, resolveSelection } from './selection-registry.js';
import { SHIPPED_CONTENT_TEMPLATES } from './content-template-tooling.js';
import { shippedRecordLookup } from './content-template-source.js';
import { resolveRecord } from './content-template-engine.js';

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

describe('§6.1 gate 1 — dual-source coexistence (both sources resolve via the registry)', () => {
  const migrated = SHIPPED_CONTENT_TEMPLATES[0].signalType;
  const marker: ReadonlySet<string> = new Set([migrated]);

  it('a migrated signal resolves a valid record from the content-template source', () => {
    expect(resolveContentSource(migrated, marker)).toBe('content-template');
    const resolved = resolveRecord(shippedRecordLookup(migrated));
    expect(resolved).not.toBeNull();
    expect(resolved!.source).toBe('shipped');
    expect(resolved!.record.signalType).toBe(migrated);
  });

  it('an un-migrated signal resolves non-null DecisionContent from the static set, side by side', () => {
    expect(resolveContentSource('context_loss', marker)).toBe('static');
    const content = resolveSelection('implementation', 'absence:context_loss', { nature: 'hardcore_pro' } as unknown as UserProfile);
    expect(content).toBeTruthy();
    expect(content.signalType).toBe('ABSENCE_CONTEXT_LOSS');
  });
});
