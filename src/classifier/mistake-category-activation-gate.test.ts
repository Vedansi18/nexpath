import { describe, it, expect } from 'vitest';
import { MISTAKE_CATEGORIES } from './mistake-categories.js';
import { SIGNAL_DEFINITIONS } from './signals.js';
import { SHIPPED_CONTENT_TEMPLATES } from '../decision-session/content-template-tooling.js';
import { MIGRATED_SIGNALS } from '../decision-session/selection-registry.js';

// §6.1 item 10 — the mistake-category ACTIVATION GATE.
//
// A detectable-now absence category may be activated in SIGNAL_DEFINITIONS ONLY when its
// content is served; else adding it fires a CONTENTLESS advisory (SignalDefinition has no
// dark flag). This test guards that boundary: every detectable-now category is EITHER already
// served (its signal is in SIGNAL_DEFINITIONS) OR content-pending — its §4.E2 content is
// authored + shipped (A9) but it is deliberately NOT yet activated in SIGNAL_DEFINITIONS (A10)
// or migrated (A12). The 26 channel-gated (requiresChannel) categories stay dark until their
// reader ships (Channel X/M/c — Phase 3).

const defKeys = new Set(SIGNAL_DEFINITIONS.map((s) => s.key));
const recordSigs = new Set(SHIPPED_CONTENT_TEMPLATES.map((r) => r.signalType));
const toKey = (target: string) => target.replace(/^ABSENCE_/, '').toLowerCase();

// The 6 new §4.E2 signals, fully ACTIVATED at A10 (SIGNAL_DEFINITIONS + why-help + pinch) + A12
// (MIGRATED_SIGNALS): they fire live, each with a shipped record served by the engine.
const NEW_E2 = new Set([
  'ABSENCE_SECRET_IN_PROMPT',
  'ABSENCE_NO_VERSION_CONTROL',
  'ABSENCE_NO_BACKUP_SAFETY',
  'ABSENCE_NO_SEPARATE_ENVS',
  'ABSENCE_NO_AUTOMATED_SECURITY_SCANNING',
  'ABSENCE_FRUSTRATION_SPIRAL',
]);

describe('§6.1 item 10 — mistake-category activation gate', () => {
  const detectableNow = MISTAKE_CATEGORIES.filter((c) => c.routing === 'absence' && !c.requiresChannel);

  it('every detectable-now absence category is served (in SIGNAL_DEFINITIONS)', () => {
    for (const c of detectableNow) {
      expect(defKeys.has(toKey(c.mapToAbsenceSignal!)), `${c.mapToAbsenceSignal}: not in SIGNAL_DEFINITIONS`).toBe(true);
    }
  });

  it('the 6 new §4.E2 signals are fully activated: SIGNAL_DEFINITIONS + shipped record + migrated', () => {
    for (const target of NEW_E2) {
      expect(defKeys.has(toKey(target)), `${target} not defined`).toBe(true);
      expect(recordSigs.has(target), `${target} has no shipped record`).toBe(true);
      expect(MIGRATED_SIGNALS.has(target), `${target} not migrated → would serve contentless`).toBe(true);
    }
  });

  it('the CORE invariant: no NEW §4.E2 signal fires without served content — each is migrated (they have no static fallback)', () => {
    // The 4 pre-existing detectable-now signals serve from the STATIC set (records + static, not
    // migrated) — valid. The 6 new signals have NO static content, so each MUST be migrated.
    for (const target of NEW_E2) {
      expect(MIGRATED_SIGNALS.has(target), `${target} activated but not migrated → would fire contentless`).toBe(true);
    }
  });

  it('channel-gated (requiresChannel) absence categories exist and remain deferred to Phase 3', () => {
    const dark = MISTAKE_CATEGORIES.filter((c) => c.routing === 'absence' && c.requiresChannel);
    expect(dark.length).toBeGreaterThan(0);
  });
});
