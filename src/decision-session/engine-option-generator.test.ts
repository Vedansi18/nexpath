import { describe, it, expect } from 'vitest';
import type OpenAI from 'openai';
import { SHIPPED_CONTENT_TEMPLATES } from './content-template-tooling.js';
import { shippedRecordLookup } from './content-template-source.js';
import { generateFromEngine } from './engine-option-generator.js';
import { CONFIRM_SEEK_RE } from './content-template-grounding.js';

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
});
