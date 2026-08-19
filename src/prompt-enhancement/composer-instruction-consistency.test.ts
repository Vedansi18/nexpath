import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PROMPT_ENHANCEMENT_DISALLOWED_COMPOSER_PHRASES_V1 } from './compose-enhancement.js';

/**
 * The composer's INSTRUCTIONS must never order wording its own VALIDATOR rejects.
 *
 * 🔴 This exists because that happened, and the failure was silent and total. §17.13's voice rule
 * shipped a worked example — *"…you should add tests for this change."* — and `you should` is on the
 * disallowed-phrase list. Every draft that followed the example was rejected, and a section whose
 * draft is rejected is not re-rendered deterministically: `renderableSectionPlans` drops it. So the
 * Source Signal Guidance section disappeared from every body in a sim run, with nothing anywhere
 * saying why. Measured across four runs: present, present, present, then gone the moment the
 * example landed.
 *
 * ⚠️ The bug was not the phrase. It was that two halves of one system could disagree about the same
 * wording and nothing compared them — so this test compares them.
 */

const COMPOSER_SOURCE = 'src/prompt-enhancement/llm-composer.ts';

/** Lines that TELL the model what not to do — a banned phrase named there is the point, not a bug. */
function isProhibitionLine(line: string): boolean {
  return ['⛔', '❌', 'Never', 'Not:', 'FAILURES', 'Do NOT', 'Do not'].some((marker) => line.includes(marker));
}

/** The quoted worked examples in the instruction text — what the model is shown to imitate. */
function positiveExamplesFromComposerPrompt(): readonly string[] {
  const lines = readFileSync(COMPOSER_SOURCE, 'utf8').split('\n');
  const examples: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    // Only instruction strings (the prompt is an array of quoted lines), never code or comments.
    if (!trimmed.startsWith("'") && !trimmed.startsWith('"')) continue;
    if (isProhibitionLine(trimmed)) continue;
    for (const match of trimmed.matchAll(/"([^"]{12,})"/g)) examples.push(match[1]!);
  }
  return examples;
}

describe('the composer may not be told to write what the composer refuses', () => {
  it('no positive worked example contains a disallowed phrase', () => {
    const offenders: string[] = [];
    for (const example of positiveExamplesFromComposerPrompt()) {
      for (const phrase of PROMPT_ENHANCEMENT_DISALLOWED_COMPOSER_PHRASES_V1) {
        if (new RegExp(`\\b${phrase}\\b`, 'i').test(example)) offenders.push(`"${example}" contains "${phrase}"`);
      }
    }
    expect(
      offenders,
      'the composer prompt shows the model wording its own validator rejects — every draft that '
      + 'obeys is dropped, and a dropped draft takes its whole section out of the body silently',
    ).toEqual([]);
  });

  it('and the check is looking at real examples, not at nothing', () => {
    // A guard that quietly stops finding examples would pass forever. Pin that it still sees them.
    const examples = positiveExamplesFromComposerPrompt();
    expect(examples.length, 'no instruction text was found — the extraction has drifted').toBeGreaterThan(3);
    // Anchored on the prompt's opening line rather than on any one worked example, so removing or
    // rewording an example never silently turns this guard into a no-op.
    expect(
      examples.some((e) => e.includes("Nexpath's prompt-enhancement composer")),
      'the extractor stopped seeing the system prompt itself',
    ).toBe(true);
  });
});
