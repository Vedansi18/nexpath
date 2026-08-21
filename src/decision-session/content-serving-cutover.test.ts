// Cutover sweep — the holistic guarantee that the content-template engine is the SOLE
// serving source after the static decision-content layer was removed:
//
//   (1) Cross-class sensitive-action safeguard survival — every intrinsically-sensitive
//       record carries its EXACT l2SafeguardLine through every served strength tier via
//       BOTH the grounded engine path AND the deterministic (no-LLM) fallback. This is the
//       holistic backstop for the per-class record safeguard tests.
//   (2) context_loss role-tailored serving — founder / indie_hacker / pm each receive their
//       own variant through the engine (record roleOverrides), distinct from the base.
//   (3) Completeness — every shipped record is engine-served (marker == shipped == 144).
//
// The single-dispatch source invariant (no static content map / resolver symbol survives)
// lives in single-dispatch-lint.test.ts.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type OpenAI from 'openai';
import { SHIPPED_CONTENT_TEMPLATES } from './content-template-tooling.js';
import { generateFromEngine, composeDeterministicOptions } from './engine-option-generator.js';
import { shippedRecordLookup } from './content-template-source.js';
import { MIGRATED_SIGNALS, resolveContentSource } from './selection-registry.js';
import type { MaturityLevel } from './content-template-schema.js';

/** A fake LLM client for the grounded path — no real spend; the safeguard is appended
 *  engine-side AFTER any weave, so its survival is independent of the mock's output. */
function mockClient(reply: string): OpenAI {
  return { chat: { completions: { create: async () => ({ choices: [{ message: { content: reply } }] }) } } } as unknown as OpenAI;
}
const client = mockClient(JSON.stringify({ whyDesc: 'grounded weave line' }));

/** The intrinsically-sensitive records across the migrated classes — class 1:2 + 7:1 + 8:4 +
 *  9:6 + 4:8 = 21. Enumerated so a dropped/added flag is caught (non-vacuous). */
const EXPECTED_FLAGGED = [
  'REVIEW_TO_RELEASE', 'RELEASE_TO_FEEDBACK',                                         // class 1 (2)
  'ABSENCE_DEPENDENCY_ADVENTURE',                                                     // class 7 (1)
  'ABSENCE_LAUNCH_STRATEGY_ABSENCE', 'ABSENCE_BUILD_IN_PUBLIC_OPPORTUNITY',
  'ABSENCE_STAKEHOLDER_ALIGNMENT_CHECK', 'ABSENCE_CROSS_TEAM_IMPACT_CHECK',           // class 8 (4)
  'ABSENCE_OVER_ENGINEERING_CHECK', 'ABSENCE_OBSERVABILITY_FIRST',
  'ABSENCE_FAILURE_MODE_ANALYSIS', 'ABSENCE_SECURITY_THREAT_MODELING',
  'ABSENCE_DATABASE_MIGRATION_SAFETY', 'ABSENCE_DEPLOYMENT_STRATEGY_ABSENCE',         // class 9 (6)
  'ABSENCE_OBSERVABILITY', 'ABSENCE_ROLLBACK_PLANNING', 'ABSENCE_DEPLOYMENT_PLANNING',
  'ABSENCE_DEPENDENCY_MGMT', 'ABSENCE_ENV_AND_SECRETS', 'ABSENCE_CI_PIPELINE',
  'ABSENCE_RATE_LIMITING', 'ABSENCE_DEPENDENCY_AUDIT_GAP',                            // class 4 (8)
];

const flaggedWithLine = SHIPPED_CONTENT_TEMPLATES.filter((r) => r.l2SafeguardRequired && r.l2SafeguardLine);

describe('cutover sweep — cross-class sensitive-action safeguard survival', () => {
  it('the flagged-record inventory covers the 21 documented class records; none is flagged without a line', () => {
    const flaggedSigs = new Set(flaggedWithLine.map((r) => r.signalType));
    for (const sig of EXPECTED_FLAGGED) {
      expect(flaggedSigs.has(sig), `${sig} is flagged AND carries an l2SafeguardLine`).toBe(true);
    }
    expect(EXPECTED_FLAGGED).toHaveLength(21);
    // A flagged record MUST carry a line — the engine needs one to append per tier.
    const flaggedNoLine = SHIPPED_CONTENT_TEMPLATES.filter((r) => r.l2SafeguardRequired && !r.l2SafeguardLine);
    expect(flaggedNoLine.map((r) => r.signalType)).toEqual([]);
  });

  for (const rec of flaggedWithLine) {
    const line = rec.l2SafeguardLine!;
    describe(rec.signalType, () => {
      it('the grounded engine path carries the exact safeguard line through every served tier', async () => {
        const gen = await generateFromEngine({ lookup: shippedRecordLookup(rec.signalType), level: 3 as MaturityLevel }, client);
        expect(gen, `${rec.signalType} composes via the engine`).not.toBeNull();
        const tiers = [gen!.generatedDescBases!.l1, gen!.generatedDescBases!.l2, gen!.generatedDescBases!.l3];
        for (const tier of tiers) {
          for (const db of tier) expect(db.includes(line), `grounded ${rec.signalType} tier keeps the safeguard`).toBe(true);
        }
      });

      it('the deterministic fallback carries the exact safeguard line through every served tier', () => {
        const gen = composeDeterministicOptions({ lookup: shippedRecordLookup(rec.signalType), level: 3 as MaturityLevel });
        expect(gen, `${rec.signalType} composes deterministically`).not.toBeNull();
        const tiers = [gen!.generatedDescBases!.l1, gen!.generatedDescBases!.l2, gen!.generatedDescBases!.l3];
        for (const tier of tiers) {
          for (const db of tier) expect(db.includes(line), `deterministic ${rec.signalType} tier keeps the safeguard`).toBe(true);
        }
      });
    });
  }
});

describe('cutover sweep — context_loss role-tailored serving through the engine', () => {
  const CTX = 'ABSENCE_CONTEXT_LOSS';
  const rec = SHIPPED_CONTENT_TEMPLATES.find((r) => r.signalType === CTX)!;

  it('the record carries role overrides for founder / indie_hacker / pm', () => {
    expect(rec).toBeDefined();
    expect(Object.keys(rec.roleOverrides ?? {}).sort()).toEqual(['founder', 'indie_hacker', 'pm']);
  });

  const base = composeDeterministicOptions({ lookup: shippedRecordLookup(CTX), level: 3 as MaturityLevel });

  for (const role of ['founder', 'indie_hacker', 'pm'] as const) {
    it(`serves the ${role} variant (distinct from the base) through the engine composition`, () => {
      const gen = composeDeterministicOptions({ lookup: shippedRecordLookup(CTX), level: 3 as MaturityLevel, role });
      expect(gen, `${role} composes`).not.toBeNull();
      // The role override serves its OWN option, not the base register's.
      expect(gen!.l1[0]).not.toBe(base!.l1[0]);
    });
  }

  it('the three role variants are distinct from one another', () => {
    const opts = (['founder', 'indie_hacker', 'pm'] as const).map(
      (role) => composeDeterministicOptions({ lookup: shippedRecordLookup(CTX), level: 3 as MaturityLevel, role })!.l1[0],
    );
    expect(new Set(opts).size).toBe(3);
  });
});

describe('cutover sweep — completeness (the engine is the sole content source)', () => {
  it('every shipped record is engine-served — marker == shipped == 144', () => {
    expect(SHIPPED_CONTENT_TEMPLATES.length).toBe(144);
    expect(MIGRATED_SIGNALS.size).toBe(SHIPPED_CONTENT_TEMPLATES.length);
    for (const rec of SHIPPED_CONTENT_TEMPLATES) {
      expect(resolveContentSource(rec.signalType), `${rec.signalType} is engine-served`).toBe('content-template');
    }
  });
});

describe('cutover sweep — no static DecisionContent data survives in the content source', () => {
  // The §1052 grep-invariant, source-side: no production file declares a static
  // DecisionContent map (`Record<..., DecisionContent>`) or a per-signal `const X:
  // DecisionContent = {...}` cascade any more. Module-level only — the DecisionContent
  // TYPE stays, and DecisionSession builds an `effective: DecisionContent` at runtime
  // (indented, inside a function), which is NOT a stored static map.
  const HERE = dirname(fileURLToPath(import.meta.url));
  const STATIC_MAP_OR_CONST = /^(?:export\s+)?const\s+\w+\s*:\s*(?:DecisionContent\b|Record<[^=]*DecisionContent)/m;

  function nonTestSources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      if (e.isDirectory()) return nonTestSources(p);
      return e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') ? [p] : [];
    });
  }

  it('no production file under decision-session declares a static DecisionContent map or per-signal const', () => {
    const sources = nonTestSources(HERE);
    expect(sources.length).toBeGreaterThan(20); // not vacuous — the layer is scanned
    const offenders = sources.filter((f) => STATIC_MAP_OR_CONST.test(readFileSync(f, 'utf-8')));
    expect(offenders.map((f) => f.slice(HERE.length + 1))).toEqual([]);
  });
});
