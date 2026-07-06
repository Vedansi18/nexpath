import { describe, it, expect } from 'vitest';
import { SHIPPED_CONTENT_TEMPLATES } from './content-template-tooling.js';
import { hasShippedRecord, shippedRecordLookup, recordSignalTypeForFlag } from './content-template-source.js';
import { resolveRecord } from './content-template-engine.js';

describe('§6.1 — content-template source lookup by signalType', () => {
  const sample = SHIPPED_CONTENT_TEMPLATES[0];

  it('the shipped tier yields the signal record; other tiers yield undefined', () => {
    const lookup = shippedRecordLookup(sample.signalType);
    expect(lookup('shipped')).toBe(sample);
    expect(lookup('uploaded')).toBeUndefined();
    expect(lookup('autogen')).toBeUndefined();
    expect(lookup('default')).toBeUndefined();
  });

  it('feeds the engine source-cascade: resolveRecord returns the schema-valid shipped record', () => {
    const resolved = resolveRecord(shippedRecordLookup(sample.signalType));
    expect(resolved).not.toBeNull();
    expect(resolved!.record.signalType).toBe(sample.signalType);
    expect(resolved!.source).toBe('shipped');
  });

  it('unknown signalType → resolveRecord null (caller falls back to static, no blank)', () => {
    expect(resolveRecord(shippedRecordLookup('no_such_signal_xyz'))).toBeNull();
    expect(hasShippedRecord('no_such_signal_xyz')).toBe(false);
  });

  it('hasShippedRecord is true for every shipped signalType', () => {
    for (const r of SHIPPED_CONTENT_TEMPLATES) expect(hasShippedRecord(r.signalType)).toBe(true);
  });

  it('recordSignalTypeForFlag maps absence:<key> → ABSENCE_<UPPER>, undefined otherwise', () => {
    expect(recordSignalTypeForFlag('absence:context_loss')).toBe('ABSENCE_CONTEXT_LOSS');
    expect(recordSignalTypeForFlag('absence:test_creation')).toBe('ABSENCE_TEST_CREATION');
    expect(recordSignalTypeForFlag('stage_transition')).toBeUndefined();
  });
});
