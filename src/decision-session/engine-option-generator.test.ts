import { describe, it, expect } from 'vitest';
import type OpenAI from 'openai';
import { SHIPPED_CONTENT_TEMPLATES } from './content-template-tooling.js';
import { shippedRecordLookup } from './content-template-source.js';
import { generateFromEngine, composeDeterministicOptions } from './engine-option-generator.js';
import { CONFIRM_SEEK_RE } from './content-template-grounding.js';
import { REVIEW_TO_RELEASE_RECORD, RELEASE_TO_FEEDBACK_RECORD } from './content-templates/class1-records.js';
import { CLASS8_RECORDS } from './content-templates/class8-records.js';
import { CLASS9_RECORDS } from './content-templates/class9-records.js';
import { CLASS4_RECORDS } from './content-templates/class4-records.js';

// §6.1 items 2/5 — the engine-backed pre-generate path. The LLM seams (grounding weave +
// ladder derive) are exercised via a mock client (no real spend), matching the engine's
// own tests; the live caller always supplies the real client.
function mockClient(reply: string): OpenAI {
  return {
    chat: { completions: { create: async () => ({ choices: [{ message: { content: reply } }] }) } },
  } as unknown as OpenAI;
}
const client = mockClient(JSON.stringify({ option: 'simpler option', whyDesc: 'grounded why-desc' }));

describe('§6.1 items 2/5 — engine-backed pre-generate path', () => {
  const sig = SHIPPED_CONTENT_TEMPLATES[0].signalType;

  it('produces GeneratedOptions (one option per strength tier) for a migrated signal', async () => {
    const gen = await generateFromEngine({ lookup: shippedRecordLookup(sig), level: 3 }, client);
    expect(gen).not.toBeNull();
    expect(gen!.l1).toHaveLength(1);
    expect(gen!.l2).toHaveLength(1);
    expect(gen!.l3).toHaveLength(1);
    expect(gen!.l1[0].length).toBeGreaterThan(0);
    expect(gen!.generatedDescBases).toBeDefined();
    expect(gen!.generatedDescBases!.l1).toHaveLength(1);
  });

  it('returns null for an unknown signal, before any LLM call (caller falls back to static)', async () => {
    // No record → composeAdvisory returns null before touching the client.
    expect(await generateFromEngine({ lookup: shippedRecordLookup('no_such_signal_xyz'), level: 2 })).toBeNull();
  });

  it('serves the level-1 floor when the requested level is unauthored (never blank)', async () => {
    const gen = await generateFromEngine({ lookup: shippedRecordLookup(sig), level: 1 }, client);
    expect(gen).not.toBeNull();
    expect(gen!.l1[0].length).toBeGreaterThan(0);
  });
});

describe('A12 fire-time L2 safeguard — record-level-flagged migrated signals carry it through every tier', () => {
  // The A12 guarantee: serving a record-level-flagged migrated signal via the engine keeps the
  // l2SafeguardLine on EVERY served strength tier — L1 (composeAdvisory auto-source) AND the
  // derived L2/L3 (deriveLadder step-simpler). Use a mock that DROPS the seek in both the weave
  // and the derive (worst case); the engine must re-append it, so the confirm-seek survives.
  const dropsSeek = mockClient(JSON.stringify({ option: 'a simpler option', whyDesc: 'grounded why-desc with no seek' }));
  const FLAGGED = ['ABSENCE_SECRET_IN_PROMPT', 'ABSENCE_NO_SEPARATE_ENVS', 'ABSENCE_NO_AUTOMATED_SECURITY_SCANNING',
    'ABSENCE_DEPENDENCY_ADVENTURE']; // B8 — class 7's 1 sensitive record: safeguard confirmed through the engine

  for (const sig of FLAGGED) {
    it(`${sig}: the confirm-seek survives into the L1/L2/L3 desc-bases`, async () => {
      const gen = await generateFromEngine({ lookup: shippedRecordLookup(sig), level: 5 }, dropsSeek);
      expect(gen, `${sig} resolves`).not.toBeNull();
      const tiers = [gen!.generatedDescBases!.l1[0], gen!.generatedDescBases!.l2[0], gen!.generatedDescBases!.l3[0]];
      for (let i = 0; i < tiers.length; i++) {
        expect(tiers[i], `${sig} L${i + 1} desc-base carries the confirm-seek`).toMatch(CONFIRM_SEEK_RE);
      }
    });
  }
});

describe('B8 — class 7 beginner-override serving through the engine (resolveRegisterForms)', () => {
  it('serves the structurally-divergent beginner override for register=beginner (differs from the base)', async () => {
    const sig = 'ABSENCE_MVP_SCOPE_DISCIPLINE'; // class 7, has a structurally-divergent beginner override
    const base = await generateFromEngine({ lookup: shippedRecordLookup(sig), level: 3, register: 'casual', facts: [], factCap: 0 }, client);
    const beginner = await generateFromEngine({ lookup: shippedRecordLookup(sig), level: 3, register: 'beginner', facts: [], factCap: 0 }, client);
    expect(base, 'base resolves').not.toBeNull();
    expect(beginner, 'beginner resolves').not.toBeNull();
    // The option is served verbatim (composeOption, no LLM); a divergent beginner override yields a
    // different L1 option than the base register — proving the register override is served live.
    expect(beginner!.l1[0]).not.toBe(base!.l1[0]);
    expect(beginner!.l1[0].length).toBeGreaterThan(0);
  });

  it('a beginner-ANCHORED class-7 signal (no override) serves the base cleanly for register=beginner', async () => {
    // 9 of the 20 class-7 signals are already beginner-anchored (no registerOverrides) — register=
    // beginner must resolve the base forms without error, identical to any other register.
    const sig = 'ABSENCE_ERROR_UNDERSTANDING';
    const casual = await generateFromEngine({ lookup: shippedRecordLookup(sig), level: 3, register: 'casual', facts: [], factCap: 0 }, client);
    const beginner = await generateFromEngine({ lookup: shippedRecordLookup(sig), level: 3, register: 'beginner', facts: [], factCap: 0 }, client);
    expect(casual, 'casual resolves').not.toBeNull();
    expect(beginner, 'beginner resolves').not.toBeNull();
    expect(beginner!.l1[0]).toBe(casual!.l1[0]); // no override → same base option for both registers
  });
});

describe('B2 — class 1 sensitive stage-transition records carry their l2SafeguardLine through every tier', () => {
  // The 2 flagged class-1 records (REVIEW→RELEASE, RELEASE→FEEDBACK). The A1 fix threads the record
  // safeguard into deriveLadder, so the EXACT record line is re-appended VERBATIM on every derived
  // tier — surviving L1/L2/L3 regardless of the line's phrasing (not reliant on a CONFIRM_SEEK match).
  // Uses the adversarial drop-the-seek mock (worst case: the LLM drops the safeguard in weave + derive).
  const dropsSeek = mockClient(JSON.stringify({ option: 'a simpler option', whyDesc: 'grounded why-desc with no seek' }));
  const FLAGGED = [REVIEW_TO_RELEASE_RECORD, RELEASE_TO_FEEDBACK_RECORD];

  for (const rec of FLAGGED) {
    it(`${rec.signalType}: the exact record l2SafeguardLine survives into the L1/L2/L3 desc-bases`, async () => {
      const line = rec.l2SafeguardLine!;
      expect(line, `${rec.signalType} is flagged with a safeguard line`).toBeTruthy();
      const gen = await generateFromEngine({ lookup: shippedRecordLookup(rec.signalType), level: 5 }, dropsSeek);
      expect(gen, `${rec.signalType} resolves`).not.toBeNull();
      const tiers = [gen!.generatedDescBases!.l1[0], gen!.generatedDescBases!.l2[0], gen!.generatedDescBases!.l3[0]];
      for (let i = 0; i < tiers.length; i++) {
        expect(tiers[i], `${rec.signalType} L${i + 1} carries the safeguard verbatim`).toContain(line);
      }
    });
  }
});

describe('B9 — class 8 sensitive role-cluster records carry their l2SafeguardLine through every tier', () => {
  // The 4 flagged class-8 records (publish launch / post publicly / contact stakeholder / notify team).
  // Derived from CLASS8_RECORDS (drift-proof), each verified to keep its exact safeguard line on every
  // served strength tier via the A1 record-safeguard thread, under the adversarial drop-the-seek mock.
  const dropsSeek = mockClient(JSON.stringify({ option: 'a simpler option', whyDesc: 'grounded why-desc with no seek' }));
  const FLAGGED = CLASS8_RECORDS.filter((r) => r.l2SafeguardRequired);

  it('exactly the 4 intrinsically-sensitive class-8 records are flagged', () => {
    expect(FLAGGED.map((r) => r.signalType).sort()).toEqual([
      'ABSENCE_BUILD_IN_PUBLIC_OPPORTUNITY', 'ABSENCE_CROSS_TEAM_IMPACT_CHECK',
      'ABSENCE_LAUNCH_STRATEGY_ABSENCE', 'ABSENCE_STAKEHOLDER_ALIGNMENT_CHECK',
    ]);
  });

  for (const rec of FLAGGED) {
    it(`${rec.signalType}: the exact record l2SafeguardLine survives into the L1/L2/L3 desc-bases`, async () => {
      const line = rec.l2SafeguardLine!;
      expect(line, `${rec.signalType} is flagged with a safeguard line`).toBeTruthy();
      const gen = await generateFromEngine({ lookup: shippedRecordLookup(rec.signalType), level: 5 }, dropsSeek);
      expect(gen, `${rec.signalType} resolves`).not.toBeNull();
      const tiers = [gen!.generatedDescBases!.l1[0], gen!.generatedDescBases!.l2[0], gen!.generatedDescBases!.l3[0]];
      for (let i = 0; i < tiers.length; i++) {
        expect(tiers[i], `${rec.signalType} L${i + 1} carries the safeguard verbatim`).toContain(line);
      }
    });
  }
});

describe('B10 — class 9 sensitive academic/hardcore records carry their l2SafeguardLine through every tier', () => {
  // The 6 flagged class-9 records (delete/restructure code, instrument across files, stability pattern,
  // security control, schema migration, trigger deployment). Derived from CLASS9_RECORDS (drift-proof),
  // each verified to keep its exact safeguard line on every served strength tier via the A1 thread,
  // under the adversarial drop-the-seek mock. Class 9 is the highest-sensitive existing set (6 of 12).
  const dropsSeek = mockClient(JSON.stringify({ option: 'a simpler option', whyDesc: 'grounded why-desc with no seek' }));
  const FLAGGED = CLASS9_RECORDS.filter((r) => r.l2SafeguardRequired);

  it('exactly the 6 intrinsically-sensitive class-9 records are flagged', () => {
    expect(FLAGGED.map((r) => r.signalType).sort()).toEqual([
      'ABSENCE_DATABASE_MIGRATION_SAFETY', 'ABSENCE_DEPLOYMENT_STRATEGY_ABSENCE',
      'ABSENCE_FAILURE_MODE_ANALYSIS', 'ABSENCE_OBSERVABILITY_FIRST',
      'ABSENCE_OVER_ENGINEERING_CHECK', 'ABSENCE_SECURITY_THREAT_MODELING',
    ]);
  });

  for (const rec of FLAGGED) {
    it(`${rec.signalType}: the exact record l2SafeguardLine survives into the L1/L2/L3 desc-bases`, async () => {
      const line = rec.l2SafeguardLine!;
      expect(line, `${rec.signalType} is flagged with a safeguard line`).toBeTruthy();
      const gen = await generateFromEngine({ lookup: shippedRecordLookup(rec.signalType), level: 5 }, dropsSeek);
      expect(gen, `${rec.signalType} resolves`).not.toBeNull();
      const tiers = [gen!.generatedDescBases!.l1[0], gen!.generatedDescBases!.l2[0], gen!.generatedDescBases!.l3[0]];
      for (let i = 0; i < tiers.length; i++) {
        expect(tiers[i], `${rec.signalType} L${i + 1} carries the safeguard verbatim`).toContain(line);
      }
    });
  }
});

describe('B5 — class 4 (release/observability/infra) is ALL-sensitive; every record carries its safeguard through every tier', () => {
  // Class 4 is the all-sensitive set: every one of the 8 ops records is l2SafeguardRequired (logging sweep,
  // rollback, deploy/infra, dependency install/upgrade, credential move, CI config, throttling, dependency
  // adoption). Derived from CLASS4_RECORDS (drift-proof), each verified to keep its exact safeguard line on
  // every served strength tier via the A1 thread, under the adversarial drop-the-seek mock. Migrated last.
  const dropsSeek = mockClient(JSON.stringify({ option: 'a simpler option', whyDesc: 'grounded why-desc with no seek' }));
  const FLAGGED = CLASS4_RECORDS.filter((r) => r.l2SafeguardRequired);

  it('ALL 8 class-4 records are flagged sensitive (no unguarded ops record)', () => {
    expect(CLASS4_RECORDS.length).toBe(8);
    expect(FLAGGED.length).toBe(8); // every record, not a subset
    expect(FLAGGED.map((r) => r.signalType).sort()).toEqual([
      'ABSENCE_CI_PIPELINE', 'ABSENCE_DEPENDENCY_AUDIT_GAP', 'ABSENCE_DEPENDENCY_MGMT',
      'ABSENCE_DEPLOYMENT_PLANNING', 'ABSENCE_ENV_AND_SECRETS', 'ABSENCE_OBSERVABILITY',
      'ABSENCE_RATE_LIMITING', 'ABSENCE_ROLLBACK_PLANNING',
    ]);
  });

  for (const rec of FLAGGED) {
    it(`${rec.signalType}: the exact record l2SafeguardLine survives into the L1/L2/L3 desc-bases`, async () => {
      const line = rec.l2SafeguardLine!;
      expect(line, `${rec.signalType} is flagged with a safeguard line`).toBeTruthy();
      const gen = await generateFromEngine({ lookup: shippedRecordLookup(rec.signalType), level: 5 }, dropsSeek);
      expect(gen, `${rec.signalType} resolves`).not.toBeNull();
      const tiers = [gen!.generatedDescBases!.l1[0], gen!.generatedDescBases!.l2[0], gen!.generatedDescBases!.l3[0]];
      for (let i = 0; i < tiers.length; i++) {
        expect(tiers[i], `${rec.signalType} L${i + 1} carries the safeguard verbatim`).toContain(line);
      }
    });
  }
});

describe('composeDeterministicOptions (B11 iii) — no-LLM fallback from the record', () => {
  it('composes options + safeguard-carrying desc-bases with NO client (all three tiers)', () => {
    const rec = CLASS4_RECORDS.find((r) => r.l2SafeguardRequired)!; // class 4 = all-sensitive
    const gen = composeDeterministicOptions({ lookup: shippedRecordLookup(rec.signalType), level: 5 });
    expect(gen, 'resolves').not.toBeNull();
    expect(gen!.l1[0].length).toBeGreaterThan(0);
    expect(gen!.l2[0].length).toBeGreaterThan(0);
    expect(gen!.l3[0].length).toBeGreaterThan(0);
    for (const d of [gen!.generatedDescBases!.l1[0], gen!.generatedDescBases!.l2[0], gen!.generatedDescBases!.l3[0]]) {
      expect(d).toContain(rec.l2SafeguardLine!); // deterministic why-desc still carries the safeguard on every tier
    }
  });

  it('serves the role override deterministically (context_loss founder differs from base)', () => {
    const founder = composeDeterministicOptions({ lookup: shippedRecordLookup('ABSENCE_CONTEXT_LOSS'), level: 3, role: 'founder' });
    const base    = composeDeterministicOptions({ lookup: shippedRecordLookup('ABSENCE_CONTEXT_LOSS'), level: 3 });
    expect(founder, 'founder resolves').not.toBeNull();
    expect(founder!.l1[0]).not.toBe(base!.l1[0]);
  });

  it('returns null for an unknown signal (caller falls through)', () => {
    expect(composeDeterministicOptions({ lookup: shippedRecordLookup('no_such_signal_xyz'), level: 3 })).toBeNull();
  });
});
