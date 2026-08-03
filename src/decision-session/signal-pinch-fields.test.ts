import { describe, it, expect } from 'vitest';
import { SIGNAL_PINCH_FIELDS, resolvePinchFields } from './signal-pinch-fields.js';
import { SHIPPED_CONTENT_TEMPLATES } from './content-template-tooling.js';

describe('signal-pinch-fields (B11) — register-keyed question/pinch map', () => {
  it('covers EVERY shipped signal with a non-empty base question + pinchFallback (142)', () => {
    for (const rec of SHIPPED_CONTENT_TEMPLATES) {
      const e = SIGNAL_PINCH_FIELDS[rec.signalType];
      expect(e, `${rec.signalType} present in the pinch-fields map`).toBeDefined();
      expect(e!.base.question.length, `${rec.signalType} base question non-empty`).toBeGreaterThan(0);
      expect(e!.base.pinchFallback.length, `${rec.signalType} base pinchFallback non-empty`).toBeGreaterThan(0);
    }
    expect(Object.keys(SIGNAL_PINCH_FIELDS).length).toBe(SHIPPED_CONTENT_TEMPLATES.length);
  });

  it('resolves with precedence beginner → casual → base', () => {
    const sig = Object.keys(SIGNAL_PINCH_FIELDS).find((s) => SIGNAL_PINCH_FIELDS[s]!.casual && SIGNAL_PINCH_FIELDS[s]!.beginner)!;
    const e = SIGNAL_PINCH_FIELDS[sig]!;
    expect(resolvePinchFields(sig, 'beginner')).toBe(e.beginner);
    expect(resolvePinchFields(sig, 'casual')).toBe(e.casual);
    expect(resolvePinchFields(sig, 'formal')).toBe(e.base);
    expect(resolvePinchFields(sig, undefined)).toBe(e.base);
  });

  it('a signal with no casual override serves the base for casual (register falls through)', () => {
    const sig = Object.keys(SIGNAL_PINCH_FIELDS).find((s) => !SIGNAL_PINCH_FIELDS[s]!.casual)!;
    expect(resolvePinchFields(sig, 'casual')).toBe(SIGNAL_PINCH_FIELDS[sig]!.base);
  });

  it('returns undefined for an unknown signalType', () => {
    expect(resolvePinchFields('NOT_A_REAL_SIGNAL', 'formal')).toBeUndefined();
    expect(resolvePinchFields('', undefined)).toBeUndefined();
  });
});
