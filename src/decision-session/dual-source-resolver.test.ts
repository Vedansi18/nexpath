import { describe, it, expect } from 'vitest';
import type { UserProfile } from '../classifier/types.js';
import { MIGRATED_SIGNALS, resolveContentSource, resolveSelection } from './selection-registry.js';
import { SHIPPED_CONTENT_TEMPLATES } from './content-template-tooling.js';
import { shippedRecordLookup, recordSignalTypeForFlag } from './content-template-source.js';
import { resolveRecord } from './content-template-engine.js';
import { getWhyHelpForSignalType } from './why-help-by-signal-type.js';
import { WHY_HELP_PER_CLASS } from './why-help.js';

// §6.1 gate 1 (S2): the dual-source resolver decides, per signalType, whether an
// advisory is served from the static DecisionContent set or the content-template
// engine. The shipped marker is EMPTY (ship-dark) so every signal stays static and
// cascade parity is preserved; per-set migration flips one signal at a time (S8).

describe('§6.1 gate 1 — dual-source resolver + migration marker', () => {
  it('the migration marker holds exactly the 6 new §4.E2 signals (A12) — each resolves to the engine', () => {
    const NEW_E2 = [
      'ABSENCE_SECRET_IN_PROMPT', 'ABSENCE_NO_VERSION_CONTROL', 'ABSENCE_NO_BACKUP_SAFETY',
      'ABSENCE_NO_SEPARATE_ENVS', 'ABSENCE_NO_AUTOMATED_SECURITY_SCANNING', 'ABSENCE_FRUSTRATION_SPIRAL',
    ];
    expect(MIGRATED_SIGNALS.size).toBe(6);
    for (const s of NEW_E2) {
      expect(MIGRATED_SIGNALS.has(s)).toBe(true);
      expect(resolveContentSource(s)).toBe('content-template');
    }
  });

  it('every migrated §4.E2 record carries a non-empty popup question (stop.ts serving relies on it)', () => {
    // A migrated signal has no static DecisionContent, so its own record.question is threaded
    // to the popup via questionOverride. A missing question would silently fall back to a
    // mismatched generic static question — assert each of the 6 supplies its own.
    const NEW_E2 = [
      'ABSENCE_SECRET_IN_PROMPT', 'ABSENCE_NO_VERSION_CONTROL', 'ABSENCE_NO_BACKUP_SAFETY',
      'ABSENCE_NO_SEPARATE_ENVS', 'ABSENCE_NO_AUTOMATED_SECURITY_SCANNING', 'ABSENCE_FRUSTRATION_SPIRAL',
    ];
    for (const s of NEW_E2) {
      const resolved = resolveRecord(shippedRecordLookup(s));
      expect(resolved, `${s} resolves a record`).not.toBeNull();
      expect(typeof resolved!.record.question, `${s} question is a string`).toBe('string');
      expect(resolved!.record.question!.length, `${s} question is non-empty`).toBeGreaterThan(0);
      // Pinch header fallback — served by auto.ts when the pinch LLM call fails.
      expect(typeof resolved!.record.pinchFallback, `${s} pinchFallback is a string`).toBe('string');
      expect(resolved!.record.pinchFallback!.length, `${s} pinchFallback is non-empty`).toBeGreaterThan(0);
    }
  });

  it('resolves every LEGACY signalType to static (only the 6 new signals are engine-served)', () => {
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

describe('stop.ts override-resolution chain — the 6 migrated absence flags resolve every override', () => {
  // This is the exact chain stop.ts walks per migrated advisory: advisory.flagType →
  // recordSignalTypeForFlag → (migrated? record.question / record.pinchFallback /
  // getWhyHelpForSignalType). A break anywhere silently falls the popup back to the generic
  // resolveDecisionContent content — so assert the whole chain end-to-end, per flag.
  const CASES: Array<[flag: string, whyHelpClass: keyof typeof WHY_HELP_PER_CLASS]> = [
    ['absence:secret_in_prompt',               'class_security_safety'],
    ['absence:no_version_control',             'class_security_safety'],
    ['absence:no_backup_safety',               'class_security_safety'],
    ['absence:no_separate_envs',               'class_security_safety'],
    ['absence:no_automated_security_scanning', 'class_security_safety'],
    ['absence:frustration_spiral',             'class_mood_meta'],
  ];

  for (const [flag, whyHelpClass] of CASES) {
    it(`${flag} → record question + pinchFallback + why-help (${whyHelpClass})`, () => {
      const signalType = recordSignalTypeForFlag(flag);
      expect(signalType, `${flag} maps to a signalType`).toBeDefined();
      expect(resolveContentSource(signalType!)).toBe('content-template');
      const rec = resolveRecord(shippedRecordLookup(signalType!))?.record;
      expect(rec, `${signalType} resolves a record`).toBeDefined();
      expect(rec!.question && rec!.question.length).toBeTruthy();          // questionOverride source
      expect(rec!.pinchFallback && rec!.pinchFallback.length).toBeTruthy(); // pinch fallback source
      expect(getWhyHelpForSignalType(signalType!)).toBe(WHY_HELP_PER_CLASS[whyHelpClass]); // whyHelpOverride source
    });
  }
});
