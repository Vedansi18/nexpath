import { describe, it, expect } from 'vitest';
import { MISTAKE_CATEGORIES } from './mistake-categories.js';
import { SIGNAL_DEFINITIONS } from './signals.js';
import { SHIPPED_CONTENT_TEMPLATES } from '../decision-session/content-template-tooling.js';

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

// The 6 new detectable-now absence signals whose §4.E2 content is authored + SHIPPED (A9,
// build-gate-validated) but NOT yet activated in SIGNAL_DEFINITIONS (A10) — so they cannot fire.
// Staged: content ready, not live. (A12 later flips them from content-pending → served.)
const CONTENT_PENDING = new Set([
  'ABSENCE_SECRET_IN_PROMPT',
  'ABSENCE_NO_VERSION_CONTROL',
  'ABSENCE_NO_BACKUP_SAFETY',
  'ABSENCE_NO_SEPARATE_ENVS',
  'ABSENCE_NO_AUTOMATED_SECURITY_SCANNING',
  'ABSENCE_FRUSTRATION_SPIRAL',
]);

describe('§6.1 item 10 — mistake-category activation gate', () => {
  const detectableNow = MISTAKE_CATEGORIES.filter((c) => c.routing === 'absence' && !c.requiresChannel);

  it('every detectable-now absence category is either served (in SIGNAL_DEFINITIONS) or documented content-pending', () => {
    for (const c of detectableNow) {
      const target = c.mapToAbsenceSignal!;
      const served = defKeys.has(toKey(target));
      const pending = CONTENT_PENDING.has(target);
      expect(served || pending, `${target}: neither served nor documented content-pending`).toBe(true);
    }
  });

  it('no content-pending signal is activated in SIGNAL_DEFINITIONS, but each now has a shipped record (staged after A9)', () => {
    for (const target of CONTENT_PENDING) {
      expect(defKeys.has(toKey(target)), `${target} activated without being migrated`).toBe(false);
      expect(recordSigs.has(target), `${target} should be shipped (A9) but has no record`).toBe(true);
    }
  });

  it('the content-pending set matches the detectable-now signals that are staged (record shipped, not yet in SIGNAL_DEFINITIONS)', () => {
    const staged = detectableNow
      .map((c) => c.mapToAbsenceSignal!)
      .filter((t) => !defKeys.has(toKey(t)) && recordSigs.has(t));
    expect(new Set(staged)).toEqual(CONTENT_PENDING);
  });

  it('channel-gated (requiresChannel) absence categories exist and remain deferred to Phase 3', () => {
    const dark = MISTAKE_CATEGORIES.filter((c) => c.routing === 'absence' && c.requiresChannel);
    expect(dark.length).toBeGreaterThan(0);
  });
});
