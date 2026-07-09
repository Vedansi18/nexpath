import { describe, it, expect } from 'vitest';
import { SHIPPED_CONTENT_TEMPLATES } from './content-template-tooling.js';
import { hasShippedRecord, shippedRecordLookup, recordSignalTypeForFlag, autogenAwareLookup } from './content-template-source.js';
import { resolveRecord } from './content-template-engine.js';
import type { ContentTemplateRecord } from './content-template-schema.js';
import { openStore } from '../store/db.js';
import { upsertContentTemplate } from '../store/content-templates.js';

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

describe('per-user (autogen) overlay — tier-b per-cell cascade', () => {
  const preset = SHIPPED_CONTENT_TEMPLATES[0];
  const AUTOGEN_L1 = { kind: 'slot-variant' as const, cell: { option: 'MY AUTOGEN OPTION', whyDesc: 'my autogen why-desc' } };
  function autogenRecord(levelForms: ContentTemplateRecord['levelForms']): ContentTemplateRecord {
    return { ...preset, source: 'autogen', levelForms };
  }

  it('no stored record → autogen tier undefined; the raw preset serves', async () => {
    const store = await openStore(':memory:');
    const lookup = autogenAwareLookup(store, '/p', preset.signalType);
    expect(lookup('autogen')).toBeUndefined();
    expect(lookup('shipped')).toBe(preset);
    expect(resolveRecord(lookup)!.source).toBe('shipped');
    store.db.close();
  });

  it('overlays per cell: the autogen cell wins its level, the preset fills the rest', async () => {
    const store = await openStore(':memory:');
    upsertContentTemplate(store, { projectRoot: '/p', signalType: preset.signalType, source: 'autogen', record: autogenRecord({ 1: AUTOGEN_L1 }) });
    const merged = resolveRecord(autogenAwareLookup(store, '/p', preset.signalType))!;
    expect(merged.source).toBe('autogen');
    expect(merged.record.levelForms[1]?.cell.option).toBe('MY AUTOGEN OPTION');
    for (const k of Object.keys(preset.levelForms)) {
      const lvl = Number(k) as 1 | 2 | 3 | 4 | 5;
      expect(merged.record.levelForms[lvl]).toBeDefined();
      if (lvl !== 1) expect(merged.record.levelForms[lvl]).toBe(preset.levelForms[lvl]); // preset cell, unchanged
    }
    store.db.close();
  });

  it('ignores an invalid stored record on read (schema gate) → preset serves', async () => {
    const store = await openStore(':memory:');
    // No level-1 floor → schema-invalid.
    upsertContentTemplate(store, { projectRoot: '/p', signalType: preset.signalType, source: 'autogen', record: { signalType: preset.signalType, source: 'autogen', levelForms: {} } });
    expect(resolveRecord(autogenAwareLookup(store, '/p', preset.signalType))!.source).toBe('shipped');
    store.db.close();
  });

  it('re-sanitizes a leaky stored cell on read', async () => {
    const store = await openStore(':memory:');
    const leaky = { kind: 'slot-variant' as const, cell: { option: 'contact me at bob@evil.com now', whyDesc: 'ok' } };
    upsertContentTemplate(store, { projectRoot: '/p', signalType: preset.signalType, source: 'autogen', record: autogenRecord({ 1: leaky }) });
    const merged = resolveRecord(autogenAwareLookup(store, '/p', preset.signalType))!;
    expect(merged.record.levelForms[1]?.cell.option).not.toContain('bob@evil.com');
  });

  it('preserves the preset sensitive-action safeguard through the overlay', async () => {
    const store = await openStore(':memory:');
    const flagged = SHIPPED_CONTENT_TEMPLATES.find((r) => r.l2SafeguardRequired && r.l2SafeguardLine)!;
    upsertContentTemplate(store, { projectRoot: '/p', signalType: flagged.signalType, source: 'autogen', record: { ...flagged, source: 'autogen', levelForms: { 1: AUTOGEN_L1 } } });
    const merged = resolveRecord(autogenAwareLookup(store, '/p', flagged.signalType))!;
    expect(merged.record.l2SafeguardRequired).toBe(true);
    expect(merged.record.l2SafeguardLine).toBe(flagged.l2SafeguardLine);
    store.db.close();
  });
});
