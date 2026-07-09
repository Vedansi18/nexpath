import { describe, it, expect } from 'vitest';
import { MIGRATED_SIGNALS, resolveContentSource } from './selection-registry.js';
import { SHIPPED_CONTENT_TEMPLATES } from './content-template-tooling.js';
import { shippedRecordLookup, recordSignalTypeForFlag } from './content-template-source.js';
import { resolveRecord } from './content-template-engine.js';
import { getWhyHelpForSignalType } from './why-help-by-signal-type.js';
import { WHY_HELP_PER_CLASS } from './why-help.js';
import { CLASS1_RECORDS } from './content-templates/class1-records.js';
import { CLASS2_RECORDS } from './content-templates/class2-records.js';
import { CLASS3_RECORDS } from './content-templates/class3-records.js';
import { CLASS5_RECORDS } from './content-templates/class5-records.js';
import { CLASS6_RECORDS } from './content-templates/class6-records.js';
import { CLASS7_RECORDS } from './content-templates/class7-records.js';
import { CLASS8_RECORDS } from './content-templates/class8-records.js';
import { CLASS9_RECORDS } from './content-templates/class9-records.js';
import { CLASS4_RECORDS } from './content-templates/class4-records.js';

// §6.1 gate 1 (S2): the dual-source resolver decides, per signalType, whether an
// advisory is served from the static DecisionContent set or the content-template
// engine. The marker holds the migrated signalTypes (the 6 §4.E2 signals + the
// Group-B classes migrated so far); every un-migrated signal stays static and
// cascade parity is preserved. Per-set migration flips one signal at a time (S8).

describe('§6.1 gate 1 — dual-source resolver + migration marker', () => {
  const NEW_E2 = [
    'ABSENCE_SECRET_IN_PROMPT', 'ABSENCE_NO_VERSION_CONTROL', 'ABSENCE_NO_BACKUP_SAFETY',
    'ABSENCE_NO_SEPARATE_ENVS', 'ABSENCE_NO_AUTOMATED_SECURITY_SCANNING', 'ABSENCE_FRUSTRATION_SPIRAL',
  ];
  // The migrated Group-B classes, derived from their records (B3: cls 2, B4: cls 3, B6: cls 5, B7: cls 6,
  // B8: cls 7, B2: cls 1 stage transitions, B9: cls 8 role-cluster, B10: cls 9 academic/hardcore, B5: cls 4
  // release/observability/infra). With B5 (class 4) migrated, ALL 9 classes (136 canonical signals) are engine-served.
  const MIGRATED_CLASS_RECORDS = [...CLASS2_RECORDS, ...CLASS3_RECORDS, ...CLASS5_RECORDS, ...CLASS6_RECORDS, ...CLASS7_RECORDS, ...CLASS1_RECORDS, ...CLASS8_RECORDS, ...CLASS9_RECORDS, ...CLASS4_RECORDS];

  it('the migration marker holds the 6 new §4.E2 signals (A12) + ALL 9 migrated Group-B classes (B3/B4/B6/B7/B8/B2/B9/B10/B5: cls 2/3/5/6/7/1/8/9/4)', () => {
    const migratedClassSignals = MIGRATED_CLASS_RECORDS.map((r) => r.signalType);
    expect(MIGRATED_SIGNALS.size).toBe(NEW_E2.length + migratedClassSignals.length); // 6 + 21 + 11 + 8 + 14 + 20 + 7 + 35 + 12 + 8 = 142
    for (const s of [...NEW_E2, ...migratedClassSignals]) {
      expect(MIGRATED_SIGNALS.has(s)).toBe(true);
      expect(resolveContentSource(s)).toBe('content-template');
    }
  });

  it('every migrated Group-B class record is migrated + resolves a shipped record', () => {
    // Derived from the AUTHORITATIVE records source (not a hardcoded list), so a drifted or
    // typo'd MIGRATED_SIGNALS entry — or a missed / renamed record — is caught here.
    expect(CLASS1_RECORDS.length).toBe(7);
    expect(CLASS8_RECORDS.length).toBe(35);
    expect(CLASS9_RECORDS.length).toBe(12);
    expect(CLASS4_RECORDS.length).toBe(8);
    expect(CLASS2_RECORDS.length).toBe(21);
    expect(CLASS3_RECORDS.length).toBe(11);
    expect(CLASS5_RECORDS.length).toBe(8);
    expect(CLASS6_RECORDS.length).toBe(14);
    expect(CLASS7_RECORDS.length).toBe(20);
    for (const rec of MIGRATED_CLASS_RECORDS) {
      expect(MIGRATED_SIGNALS.has(rec.signalType), `${rec.signalType} in MIGRATED_SIGNALS`).toBe(true);
      expect(resolveContentSource(rec.signalType)).toBe('content-template');
      expect(resolveRecord(shippedRecordLookup(rec.signalType)), `${rec.signalType} resolves a record`).not.toBeNull();
    }
  });

  it('B5 completes the migration — EVERY shipped content-template record is now migrated (shipped ⊆ migrated)', () => {
    // With class 4 migrated, the marker must cover the ENTIRE shipped set (142 = 136 canonical + 6 §4.E2).
    // This is the reverse of the invariant below (migrated ⊆ shipped); together they prove marker == shipped,
    // so no shipped record is left on the static path. Catches any shipped record that was never migrated.
    for (const rec of SHIPPED_CONTENT_TEMPLATES) {
      expect(MIGRATED_SIGNALS.has(rec.signalType), `${rec.signalType} is shipped but NOT migrated`).toBe(true);
    }
    expect(MIGRATED_SIGNALS.size).toBe(SHIPPED_CONTENT_TEMPLATES.length); // marker == shipped == 142
  });

  it('every migrated signalType resolves a shipped content-template record (no contentless migration)', () => {
    // Group-B invariant: a signalType in the marker with no shipped record would serve nothing
    // (or silently fall through) — never migrate a signal that has no engine content.
    for (const s of MIGRATED_SIGNALS) {
      expect(resolveContentSource(s)).toBe('content-template');
      expect(resolveRecord(shippedRecordLookup(s)), `${s} has a shipped record`).not.toBeNull();
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

  it('resolves an UNKNOWN signalType to static (the default branch — all shipped signals are now migrated at B5)', () => {
    // With B5 (class 4) migrated, every shipped signalType (136 canonical + 6 §4.E2 = 142) resolves to
    // content-template — the earlier canary signals (OBSERVABILITY/CI_PIPELINE/ROLLBACK_PLANNING each sat
    // here until B5). The static branch now serves ONLY signals absent from the marker: unknown / never-authored.
    for (const s of ['x_unknown', 'not_a_real_signal', 'ABSENCE_NONEXISTENT_XYZ']) {
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

describe('§6.1 gate 1 — content-template resolution via the registry', () => {
  const migrated = SHIPPED_CONTENT_TEMPLATES[0].signalType;
  const marker: ReadonlySet<string> = new Set([migrated]);

  it('a migrated signal resolves a valid record from the content-template source', () => {
    expect(resolveContentSource(migrated, marker)).toBe('content-template');
    const resolved = resolveRecord(shippedRecordLookup(migrated));
    expect(resolved).not.toBeNull();
    expect(resolved!.source).toBe('shipped');
    expect(resolved!.record.signalType).toBe(migrated);
  });

  it('an unknown signal takes the non-content-template default branch (nothing serves static after the cutover)', () => {
    // The registry still has a 'static' default label for signals absent from the marker, but
    // the static DecisionContent layer is gone — every shipped signal is migrated (marker == shipped).
    expect(resolveContentSource('a_static', marker)).toBe('static');
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
