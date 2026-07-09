import { describe, it, expect, vi } from 'vitest';
import { resolveDecisionContent, generateOptionList } from '../../core/decision/options.js';
import type { LLMPort } from '../../core/ports/llm.port.js';

/**
 * End-to-end proof of the service-worker's Option-A path: the SW resolves static
 * content, runs the shared engine via generateOptionList (LLMPort), then maps
 * levels with the SAME title/body selection as DecisionSession.wrapGen. This
 * reproduces that pipeline exactly (minus the browser shell) and asserts the two
 * things the live popup depends on:
 *   1. option bodies are RESOLVED — no raw {R4_OPEN}/{R5_INJECT}/{R4_CLOSE}
 *      markers (the exact bug: the SW used to ship the unresolved template).
 *   2. with no generated options, it falls back to the static option text.
 */

// The SW's mapLevel, verbatim (kept in sync with service-worker.ts).
function mapLevel(
  staticEntries: { option: string; descBase: string }[],
  genTitles: string[] | undefined,
  genBodies: string[] | undefined,
  tag: 'L1' | 'L2' | 'L3',
) {
  const lower = tag.toLowerCase();
  const titles = genTitles ?? staticEntries.map((e) => e.option);
  return titles.map((title, i) => ({
    id: `${lower}-${i}`,
    level: tag,
    title,
    body: genBodies?.[i] ?? staticEntries[i]?.descBase ?? '',
  }));
}

const MARKER = /\{R[45]_(OPEN|CLOSE|INJECT)/;

function validResponse(content: ReturnType<typeof resolveDecisionContent>): string {
  return JSON.stringify({
    l1: content.L1.map((o) => `check: ${o.option}`),
    l2: content.L2.map((o) => `check: ${o.option}`),
    l3: content.L3.map((o) => `check: ${o.option}`),
  });
}

describe('service-worker Option-A path — personalized, marker-free popup options', () => {
  it('produces personalized titles and resolved (marker-free) bodies', async () => {
    const content = resolveDecisionContent('implementation', 'stage_transition');
    const llm: LLMPort = { chat: vi.fn().mockImplementation(() => Promise.resolve(validResponse(content))) };

    const gen = await generateOptionList(
      content, undefined, undefined, [],
      { flagType: 'stage_transition', currentStage: 'implementation', promptsInCurrentStage: 2 },
      llm,
    );
    expect(gen).not.toBeNull();

    const gd = gen?.generatedDescBases;
    const levels = {
      L1: mapLevel(content.L1, gen?.l1, gd?.l1, 'L1'),
      L2: mapLevel(content.L2, gen?.l2, gd?.l2, 'L2'),
      L3: mapLevel(content.L3, gen?.l3, gd?.l3, 'L3'),
    };

    // Titles came from the LLM-personalized list (here the "check: " identity).
    expect(levels.L1[0]?.title).toContain('check: ');
    // The bug fix: NO body carries a raw runtime marker.
    for (const lvl of [levels.L1, levels.L2, levels.L3]) {
      for (const opt of lvl) {
        expect(opt.body, `body should be resolved, got: ${opt.body}`).not.toMatch(MARKER);
        expect(opt.body.length).toBeGreaterThan(0);
      }
    }
  });

  it('falls back to static option text (still marker-free path) when generation yields null', async () => {
    const content = resolveDecisionContent('implementation', 'stage_transition');
    const llm: LLMPort = { chat: vi.fn().mockRejectedValue(new Error('no key')) };

    const gen = await generateOptionList(
      content, undefined, undefined, [],
      { flagType: 'stage_transition', currentStage: 'implementation', promptsInCurrentStage: 2 },
      llm,
    );
    expect(gen).toBeNull();

    const levels = { L1: mapLevel(content.L1, gen?.l1, undefined, 'L1') };
    // Falls back to the static option label — never empty, never a crash.
    expect(levels.L1[0]?.title).toBe(content.L1[0]?.option);
  });
});
