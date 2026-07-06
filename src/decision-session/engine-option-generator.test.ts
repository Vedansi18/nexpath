import { describe, it, expect } from 'vitest';
import type OpenAI from 'openai';
import { SHIPPED_CONTENT_TEMPLATES } from './content-template-tooling.js';
import { shippedRecordLookup } from './content-template-source.js';
import { generateFromEngine } from './engine-option-generator.js';

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
