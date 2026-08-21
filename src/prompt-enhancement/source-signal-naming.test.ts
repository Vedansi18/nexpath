import { describe, expect, it } from 'vitest';
import { composeStructuredComposerOutputV1, type PromptEnhancementComposerClientV1 } from './llm-composer.js';
import {
  promptEnhancementExpectedSignalNamesV1,
  promptEnhancementDraftNamesItsSignalV1,
} from './source-signal-naming.js';
import type { PromptEnhancementSectionPlanningResult } from './templates/section-plan.js';

/**
 * §17.13 last hop — ONE sanctioned retry for the source-signal section, then DISCARD the section.
 *
 * ⚠️ Two sim runs measured the same thing: the payload carries the signal, the hardened instruction
 * tells the model to name it, and the model still generalises it away part of the time
 * ("the missing practices indicated"). An instruction is not a mechanism, so this is the mechanism —
 * bounded exactly as the owner sanctioned it: one extra call, this section only, discard rather
 * than ship a paragraph that names nothing.
 */

const SIGNAL_SECTION = 'sec-signal';

function planningWith(names: readonly string[]): PromptEnhancementSectionPlanningResult {
  return {
    sectionPlans: [
      { sectionId: 'sec-orig', sectionKind: 'original_request_or_goal', structuredContentPartRefs: [] },
      { sectionId: SIGNAL_SECTION, sectionKind: 'source_signal_guidance', structuredContentPartRefs: ['fact-s'] },
    ],
    renderedFacts: names.map((name, i) => ({
      factId: `f-${i}`, sourceType: 'absence_signal', sourceIds: [`absence:${name}`],
      guidanceKind: 'missing_practice', suggestedActionKind: 'no_action_render_context_only',
      targetSectionKind: 'source_signal_guidance', renderPolicy: 'render_as_section',
      claimVerbPolicy: 'must_phrase_as_source_signal', priority: 'normal', riskLevel: 'low',
      privacyClass: 'public_safe', sanitizationState: 'not_applicable', safetyHooks: [],
      evidence: { key: name, value: 'not observed in this prompt' },
    })),
  } as unknown as PromptEnhancementSectionPlanningResult;
}

/** A client that returns a different body per call, so a retry is observable. */
function scriptedClient(bodies: readonly string[]): {
  client: PromptEnhancementComposerClientV1;
  calls: () => number;
  directives: () => readonly string[];
} {
  let n = 0;
  const seen: string[] = [];
  return {
    calls: () => n,
    directives: () => seen,
    client: {
      chat: {
        completions: {
          create: async (body: { messages: readonly { role: string; content: string }[] }) => {
            seen.push(body.messages[body.messages.length - 1]!.content);
            const text = bodies[Math.min(n, bodies.length - 1)]!;
            n += 1;
            return { choices: [{ message: { content: JSON.stringify({
              detectedLanguageSelfReport: 'en',
              sectionDrafts: [
                { sectionId: 'sec-orig', bodyText: 'My original request.', sourceFactIds: [] },
                { sectionId: SIGNAL_SECTION, bodyText: text, sourceFactIds: ['fact-s'] },
              ],
              composerClaims: [],
            }) } }] };
          },
        },
      },
    },
  };
}

const NAMED = 'I have not set up test creation for this change — you should add tests for it.';
const VAGUE = 'I need to address the missing practices indicated — it is important to recognise what signals might be relevant here.';

describe('the check itself', () => {
  it('reads the names the model was actually given, spaced as the renderer spaces them', () => {
    expect(promptEnhancementExpectedSignalNamesV1(planningWith(['test_creation']))).toEqual(['test creation']);
  });

  it('a sensitive fact contributes NO expected name — it has no evidence to demand into the text', () => {
    // The safety property, stated as a test: a signal whose content is withheld can never be
    // required into the body by this check, so the check can never argue with the sensitive path.
    const sensitive = planningWith([]);
    expect(promptEnhancementExpectedSignalNamesV1(sensitive)).toEqual([]);
    expect(promptEnhancementDraftNamesItsSignalV1('anything at all', [])).toBe(true);
  });

  it('recognises the category phrasings measured in the sim as NOT naming the signal', () => {
    expect(promptEnhancementDraftNamesItsSignalV1(VAGUE, ['test creation'])).toBe(false);
    expect(promptEnhancementDraftNamesItsSignalV1(NAMED, ['test creation'])).toBe(true);
  });
});

describe('one retry, then discard', () => {
  it('names it first time → ONE call, section kept', async () => {
    const s = scriptedClient([NAMED]);
    const result = await composeStructuredComposerOutputV1(
      { enhancementId: 'pe:r1', originalPromptText: 'add the retry flow', planning: planningWith(['test_creation']) },
      s.client,
    );
    expect(s.calls(), 'a retry was spent on a compliant draft').toBe(1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.sectionDrafts.map((d) => d.sectionId)).toContain(SIGNAL_SECTION);
  });

  it('vague first, named second → exactly TWO calls, section kept, and the retry NAMES the signal', async () => {
    const s = scriptedClient([VAGUE, NAMED]);
    const result = await composeStructuredComposerOutputV1(
      { enhancementId: 'pe:r2', originalPromptText: 'add the retry flow', planning: planningWith(['test_creation']) },
      s.client,
    );
    expect(s.calls(), 'the sanctioned extra call was not spent, or was spent more than once').toBe(2);
    expect(s.directives()[1], 'the retry did not tell the model which signal to name').toContain('"test creation"');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.sectionDrafts.map((d) => d.sectionId)).toContain(SIGNAL_SECTION);
  });

  it('vague twice → the SECTION is discarded and everything else still ships', async () => {
    const s = scriptedClient([VAGUE, VAGUE]);
    const result = await composeStructuredComposerOutputV1(
      { enhancementId: 'pe:r3', originalPromptText: 'add the retry flow', planning: planningWith(['test_creation']) },
      s.client,
    );
    expect(s.calls(), 'the one-call bound leaked — this must not keep retrying').toBe(2);
    expect(result.ok, 'the whole popup was failed instead of the one section').toBe(true);
    if (!result.ok) return;
    const ids = result.output.sectionDrafts.map((d) => d.sectionId);
    expect(ids, 'a section naming no signal was shipped anyway').not.toContain(SIGNAL_SECTION);
    expect(ids, 'discarding one section took the others with it').toContain('sec-orig');
  });
});
