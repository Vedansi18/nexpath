import { describe, expect, it } from 'vitest';
import { composeStructuredComposerOutputV1, type PromptEnhancementComposerClientV1 } from './llm-composer.js';
import type { PromptEnhancementSectionPlanningResult } from './templates/section-plan.js';

function planning(
  sections: readonly { sectionId: string; sectionKind: string; structuredContentPartRefs: readonly string[] }[],
): PromptEnhancementSectionPlanningResult {
  return { sectionPlans: sections } as unknown as PromptEnhancementSectionPlanningResult;
}

const RENDERABLE = planning([
  { sectionId: 'sec-verify', sectionKind: 'verification_or_test_plan', structuredContentPartRefs: ['fact-a'] },
  { sectionId: 'sec-orig', sectionKind: 'original_request_or_goal', structuredContentPartRefs: ['fact-x'] },
]);

/** A mock client whose single completion returns the given content (or throws). */
function client(content: string | null, opts: { throws?: boolean } = {}): PromptEnhancementComposerClientV1 {
  return {
    chat: {
      completions: {
        create: async () => {
          if (opts.throws) throw new Error('provider unavailable');
          return { choices: [{ message: { content } }] };
        },
      },
    },
  };
}

const input = { enhancementId: 'pe:req-1', originalPromptText: 'Fix the failing test.', planning: RENDERABLE };

describe('composeStructuredComposerOutputV1 (E4 / 4.1)', () => {
  it('parses a well-formed model reply into a structured composer output', async () => {
    const reply = JSON.stringify({
      detectedLanguageSelfReport: 'en',
      sectionDrafts: [{ sectionId: 'sec-verify', bodyText: 'Add a failing test that reproduces the bug, then make it pass.', sourceFactIds: ['fact-a'] }],
      composerClaims: ['claim:fact-a'],
    });
    const output = await composeStructuredComposerOutputV1(input, client(reply));
    expect(output).toBeDefined();
    expect(output!.outputId).toBe('pe:req-1:composer-llm');
    expect(output!.sectionDrafts).toEqual([
      { sectionId: 'sec-verify', bodyText: 'Add a failing test that reproduces the bug, then make it pass.', sourceFactIds: ['fact-a'] },
    ]);
    expect(output!.composerClaims).toEqual(['claim:fact-a']);
  });

  it('parses the E5 detectedLanguageSelfReport and passes the mirror-language instruction', async () => {
    const reply = JSON.stringify({
      detectedLanguageSelfReport: 'hi-Latn',
      sectionDrafts: [{ sectionId: 'sec-verify', bodyText: 'Ek failing test likho jo bug reproduce kare.', sourceFactIds: ['fact-a'] }],
      composerClaims: ['claim:fact-a'],
    });
    let sentSystemPrompt = '';
    const capturing: PromptEnhancementComposerClientV1 = {
      chat: { completions: { create: async (body) => { sentSystemPrompt = body.messages.find((m) => m.role === 'system')?.content ?? ''; return { choices: [{ message: { content: reply } }] }; } } },
    };
    const output = await composeStructuredComposerOutputV1(input, capturing);
    expect(output!.detectedLanguageSelfReport).toBe('hi-Latn');
    expect(sentSystemPrompt).toContain('SAME language');
    expect(sentSystemPrompt).toContain('detectedLanguageSelfReport');
  });

  it('rejects a reply that omits the self-report (uncovered -> English fallback)', async () => {
    // No detectedLanguageSelfReport -> not a covered v1 language -> gate rejects ->
    // retries exhaust -> undefined (deterministic English fallback).
    const reply = JSON.stringify({
      sectionDrafts: [{ sectionId: 'sec-verify', bodyText: 'Verify it.', sourceFactIds: ['fact-a'] }],
      composerClaims: ['claim:fact-a'],
    });
    expect(await composeStructuredComposerOutputV1(input, client(reply))).toBeUndefined();
  });

  it('returns undefined on a provider error (deterministic fallback)', async () => {
    expect(await composeStructuredComposerOutputV1(input, client(null, { throws: true }))).toBeUndefined();
  });

  it('returns undefined on an empty reply', async () => {
    expect(await composeStructuredComposerOutputV1(input, client(null))).toBeUndefined();
  });

  it('returns undefined on malformed JSON', async () => {
    expect(await composeStructuredComposerOutputV1(input, client('not json {'))).toBeUndefined();
  });

  it('returns undefined when the reply has no usable section drafts', async () => {
    const reply = JSON.stringify({ sectionDrafts: [{ sectionId: '', bodyText: '' }], composerClaims: [] });
    expect(await composeStructuredComposerOutputV1(input, client(reply))).toBeUndefined();
  });

  it('does not call the model when there is no renderable (non-original, ref-backed) section', async () => {
    let called = false;
    const spyClient: PromptEnhancementComposerClientV1 = {
      chat: { completions: { create: async () => { called = true; return { choices: [] }; } } },
    };
    const onlyOriginal = planning([{ sectionId: 'sec-orig', sectionKind: 'original_request_or_goal', structuredContentPartRefs: ['fact-x'] }]);
    const output = await composeStructuredComposerOutputV1({ ...input, planning: onlyOriginal }, spyClient);
    expect(output).toBeUndefined();
    expect(called).toBe(false);
  });

  it('retries a malformed reply and succeeds on a later valid one (§4d retry 3)', async () => {
    const good = JSON.stringify({
      detectedLanguageSelfReport: 'en',
      sectionDrafts: [{ sectionId: 'sec-verify', bodyText: 'Verify it.', sourceFactIds: ['fact-a'] }],
      composerClaims: ['claim:fact-a'],
    });
    let calls = 0;
    const flaky: PromptEnhancementComposerClientV1 = {
      chat: { completions: { create: async () => { calls += 1; return { choices: [{ message: { content: calls < 3 ? 'not json' : good } }] }; } } },
    };
    const output = await composeStructuredComposerOutputV1(input, flaky);
    expect(output).toBeDefined();
    expect(calls).toBe(3);
  });

  it('gives up after the retry budget when every reply is malformed', async () => {
    let calls = 0;
    const alwaysBad: PromptEnhancementComposerClientV1 = {
      chat: { completions: { create: async () => { calls += 1; return { choices: [{ message: { content: 'not json' } }] }; } } },
    };
    expect(await composeStructuredComposerOutputV1(input, alwaysBad)).toBeUndefined();
    expect(calls).toBe(4); // 1 initial + 3 retries
  });

  it('retries a language-drifted reply with a stronger directive, then falls back if it persists', async () => {
    // Original is Devanagari; the model keeps replying in Latin -> drift -> retries
    // exhaust -> undefined (English fallback). The retry carries the stronger directive.
    const devanagariInput = { ...input, originalPromptText: 'लॉगिन बग ठीक करो' };
    const drifted = JSON.stringify({
      detectedLanguageSelfReport: 'hi',
      sectionDrafts: [{ sectionId: 'sec-verify', bodyText: 'Write a failing test first.', sourceFactIds: ['fact-a'] }],
      composerClaims: ['claim:fact-a'],
    });
    let calls = 0;
    let sawStrongerDirective = false;
    const driftingClient: PromptEnhancementComposerClientV1 = {
      chat: { completions: { create: async (body) => {
        calls += 1;
        if (body.messages.some((m) => m.content.includes('drifted from the original language'))) sawStrongerDirective = true;
        return { choices: [{ message: { content: drifted } }] };
      } } },
    };
    expect(await composeStructuredComposerOutputV1(devanagariInput, driftingClient)).toBeUndefined();
    expect(calls).toBe(4);
    expect(sawStrongerDirective).toBe(true);
  });

  it('does NOT retry a thrown provider error (fast fallback)', async () => {
    let calls = 0;
    const throwing: PromptEnhancementComposerClientV1 = {
      chat: { completions: { create: async () => { calls += 1; throw new Error('provider down'); } } },
    };
    expect(await composeStructuredComposerOutputV1(input, throwing)).toBeUndefined();
    expect(calls).toBe(1);
  });

  it('drops non-string source fact ids while keeping the draft', async () => {
    const reply = JSON.stringify({
      detectedLanguageSelfReport: 'en',
      sectionDrafts: [{ sectionId: 'sec-verify', bodyText: 'Verify it.', sourceFactIds: ['fact-a', 3, null] }],
      composerClaims: ['claim:fact-a'],
    });
    const output = await composeStructuredComposerOutputV1(input, client(reply));
    expect(output!.sectionDrafts[0].sourceFactIds).toEqual(['fact-a']);
  });
});
