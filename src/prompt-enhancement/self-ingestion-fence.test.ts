/**
 * T3 — the self-ingestion fence, and the §7.3-B reproduction.
 *
 * §7.3-B was observed live once and never reproduced on demand: a prompt quoting a
 * previous enhanced body had Nexpath's own boilerplate harvested and re-emitted as
 * "these original points". That is worse than losing the points, because the re-emission
 * carries a STRONGER claim than the text ever did — the user never wrote any of it.
 *
 * Done-when, from the phase plan: no input containing a prior Nexpath body, a quoted
 * block, or the canonical `My original request (verbatim)` echo can contribute a
 * "user point".
 */
import { describe, expect, it } from 'vitest';

import {
  extractPromptEnhancementPromptPointsV1,
  type PromptEnhancementPromptReviewOrigin,
} from './original-text-refs.js';

const USER: PromptEnhancementPromptReviewOrigin = 'user_authored_current_prompt';

/** A previous enhanced body, as it would appear pasted into a new prompt. */
const PRIOR_NEXPATH_BODY = [
  'My original request (verbatim): fix the checkout flow',
  '',
  'Context And Constraints',
  '- Preserve the original request, dependencies, and completion checks inside this one prompt body.',
  '- Keep the work tied to reproduction and verification evidence.',
  '',
  'Verification Or Test Plan',
  '- Add a regression test that fails before the fix.',
].join('\n');

describe('T3 §7.3-B reproduction — a quoted prior body yields zero harvested points', () => {
  it('harvests nothing from a prompt that pastes a previous enhanced body', () => {
    const prompt = `here is what nexpath gave me last time, please continue\n\n${PRIOR_NEXPATH_BODY}`;

    // The reproduction: every bullet above is Nexpath's own wording. Before the fence
    // these came back as "these original points", attributed to the user.
    expect(extractPromptEnhancementPromptPointsV1(prompt, USER)).toEqual([]);
  });

  it('harvests nothing when the canonical echo appears anywhere in the prompt', () => {
    const prompt = [
      '- genuinely mine, written before the paste',
      '',
      'My original request (verbatim): something else entirely',
      '- not mine, this is the echo speaking',
    ].join('\n');

    // Fails CLOSED: the user's own first bullet is lost too. That is the deliberate
    // trade — presenting Nexpath's text back as the user's is the defect being fixed,
    // and a partial harvest cannot be told apart from a correct one downstream.
    expect(extractPromptEnhancementPromptPointsV1(prompt, USER)).toEqual([]);
  });

  it('drops markdown-quoted blocks, which are by definition someone else\'s words', () => {
    const prompt = [
      '- add retry handling',
      '> - Preserve the original request and completion checks.',
      '> - Keep the work tied to verification evidence.',
    ].join('\n');

    expect(extractPromptEnhancementPromptPointsV1(prompt, USER)).toEqual(['add retry handling']);
  });

  it('drops fenced blocks, so pasted output cannot contribute points', () => {
    const prompt = [
      '- add retry handling',
      '```',
      '- Preserve the original request, dependencies, and completion checks.',
      '```',
      '- write the migration',
    ].join('\n');

    expect(extractPromptEnhancementPromptPointsV1(prompt, USER))
      .toEqual(['add retry handling', 'write the migration']);
  });
});

describe('T3 — the typed provenance layer', () => {
  it('harvests nothing when the prompt did not come from the user', () => {
    const prompt = ['- add retry handling', '- write the migration'].join('\n');

    // Layer 1. These read exactly like user points; the only thing that says otherwise
    // is the typed origin, which is the machinery built for this purpose.
    const generatedOrigins: readonly PromptEnhancementPromptReviewOrigin[] = [
      'pe_generated_initial_send',
      'pe_action_generated_send',
      'multi_prompt_sequence_generated',
      'old_ds_advisory_injected',
      'unknown_origin',
    ];
    for (const origin of generatedOrigins) {
      expect(extractPromptEnhancementPromptPointsV1(prompt, origin)).toEqual([]);
    }
  });

  it('still harvests a genuine user prompt, so the fence is not just "return nothing"', () => {
    const prompt = [
      'please do these:',
      '- add retry handling to the webhook',
      '2) write a migration for the phone column',
    ].join('\n');

    expect(extractPromptEnhancementPromptPointsV1(prompt, USER))
      .toEqual(['add retry handling to the webhook', 'write a migration for the phone column']);
  });
});
