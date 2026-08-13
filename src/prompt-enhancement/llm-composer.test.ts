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
    const result = await composeStructuredComposerOutputV1(input, client(reply));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.outputId).toBe('pe:req-1:composer-llm');
    expect(result.output.sectionDrafts).toEqual([
      { sectionId: 'sec-verify', bodyText: 'Add a failing test that reproduces the bug, then make it pass.', sourceFactIds: ['fact-a'] },
    ]);
    expect(result.output.composerClaims).toEqual(['claim:fact-a']);
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
    const result = await composeStructuredComposerOutputV1(input, capturing);
    expect(result.ok && result.output.detectedLanguageSelfReport).toBe('hi-Latn');
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
    expect(await composeStructuredComposerOutputV1(input, client(reply))).toEqual({ ok: false, reason: 'invalid_output' });
  });

  it('E8: includes the directional action wording directive in the prompt', async () => {
    const reply = JSON.stringify({ detectedLanguageSelfReport: 'en', sectionDrafts: [{ sectionId: 'sec-verify', bodyText: 'Verify it.', sourceFactIds: ['fact-a'] }], composerClaims: ['claim:fact-a'] });
    let sentUser = '';
    const capturing: PromptEnhancementComposerClientV1 = {
      chat: { completions: { create: async (body) => { sentUser = body.messages.find((m) => m.role === 'user')?.content ?? ''; return { choices: [{ message: { content: reply } }] }; } } },
    };
    await composeStructuredComposerOutputV1({ ...input, action: 'shorter' }, capturing);
    expect(sentUser).toContain('SHORTER');
    await composeStructuredComposerOutputV1({ ...input, action: 'more_thorough' }, capturing);
    expect(sentUser).toContain('MORE THOROUGH');
  });

  it('E8: apply_details embeds the additional details in the directive', async () => {
    const reply = JSON.stringify({ detectedLanguageSelfReport: 'en', sectionDrafts: [{ sectionId: 'sec-verify', bodyText: 'Verify it.', sourceFactIds: ['fact-a'] }], composerClaims: ['claim:fact-a'] });
    let sentUser = '';
    const capturing: PromptEnhancementComposerClientV1 = {
      chat: { completions: { create: async (body) => { sentUser = body.messages.find((m) => m.role === 'user')?.content ?? ''; return { choices: [{ message: { content: reply } }] }; } } },
    };
    await composeStructuredComposerOutputV1({ ...input, action: 'apply_details', additionalDetailsText: 'use postgres, not mysql' }, capturing);
    expect(sentUser).toContain('APPLY DETAILS');
    expect(sentUser).toContain('use postgres, not mysql');
  });

  it('TI-2: reports a thrown provider error as provider_error (deterministic fallback)', async () => {
    expect(await composeStructuredComposerOutputV1(input, client(null, { throws: true }))).toEqual({ ok: false, reason: 'provider_error' });
  });

  it('TI-2: classifies an SDK timeout error (APIConnectionTimeoutError) as timeout', async () => {
    const timeoutClient: PromptEnhancementComposerClientV1 = {
      chat: { completions: { create: async () => { throw Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' }); } } },
    };
    expect(await composeStructuredComposerOutputV1(input, timeoutClient)).toEqual({ ok: false, reason: 'timeout' });
  });

  it('TI-2: classifies a timeout by message shape when the error name is generic', async () => {
    const timeoutClient: PromptEnhancementComposerClientV1 = {
      chat: { completions: { create: async () => { throw new Error('connection timed out after 45000ms'); } } },
    };
    expect(await composeStructuredComposerOutputV1(input, timeoutClient)).toEqual({ ok: false, reason: 'timeout' });
  });

  it('TI-2: reports no_key when no client is injected and no API key exists', async () => {
    const savedKey = process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_API_KEY'];
    try {
      // `new OpenAI()` throws at construction (no key) BEFORE any network access.
      expect(await composeStructuredComposerOutputV1(input)).toEqual({ ok: false, reason: 'no_key' });
    } finally {
      if (savedKey !== undefined) process.env['OPENAI_API_KEY'] = savedKey;
    }
  });

  it('TI-2: reports invalid_output on an empty reply (retries exhausted)', async () => {
    expect(await composeStructuredComposerOutputV1(input, client(null))).toEqual({ ok: false, reason: 'invalid_output' });
  });

  it('TI-2: reports invalid_output on malformed JSON (retries exhausted)', async () => {
    expect(await composeStructuredComposerOutputV1(input, client('not json {'))).toEqual({ ok: false, reason: 'invalid_output' });
  });

  it('TI-2: reports invalid_output when the reply has no usable section drafts', async () => {
    const reply = JSON.stringify({ sectionDrafts: [{ sectionId: '', bodyText: '' }], composerClaims: [] });
    expect(await composeStructuredComposerOutputV1(input, client(reply))).toEqual({ ok: false, reason: 'invalid_output' });
  });

  it('does not call the model when there is no renderable (non-original, ref-backed) section', async () => {
    let called = false;
    const spyClient: PromptEnhancementComposerClientV1 = {
      chat: { completions: { create: async () => { called = true; return { choices: [] }; } } },
    };
    const onlyOriginal = planning([{ sectionId: 'sec-orig', sectionKind: 'original_request_or_goal', structuredContentPartRefs: ['fact-x'] }]);
    const result = await composeStructuredComposerOutputV1({ ...input, planning: onlyOriginal }, spyClient);
    expect(result).toEqual({ ok: false, reason: 'no_eligible_sections' });
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
    const result = await composeStructuredComposerOutputV1(input, flaky);
    expect(result.ok).toBe(true);
    expect(calls).toBe(3);
  });

  it('gives up after the retry budget when every reply is malformed', async () => {
    let calls = 0;
    const alwaysBad: PromptEnhancementComposerClientV1 = {
      chat: { completions: { create: async () => { calls += 1; return { choices: [{ message: { content: 'not json' } }] }; } } },
    };
    expect(await composeStructuredComposerOutputV1(input, alwaysBad)).toEqual({ ok: false, reason: 'invalid_output' });
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
    expect(await composeStructuredComposerOutputV1(devanagariInput, driftingClient)).toEqual({ ok: false, reason: 'invalid_output' });
    expect(calls).toBe(4);
    expect(sawStrongerDirective).toBe(true);
  });

  it('does NOT retry a thrown provider error (fast fallback)', async () => {
    let calls = 0;
    const throwing: PromptEnhancementComposerClientV1 = {
      chat: { completions: { create: async () => { calls += 1; throw new Error('provider down'); } } },
    };
    expect(await composeStructuredComposerOutputV1(input, throwing)).toEqual({ ok: false, reason: 'provider_error' });
    expect(calls).toBe(1);
  });

  it('drops non-string source fact ids while keeping the draft', async () => {
    const reply = JSON.stringify({
      detectedLanguageSelfReport: 'en',
      sectionDrafts: [{ sectionId: 'sec-verify', bodyText: 'Verify it.', sourceFactIds: ['fact-a', 3, null] }],
      composerClaims: ['claim:fact-a'],
    });
    const result = await composeStructuredComposerOutputV1(input, client(reply));
    expect(result.ok && result.output.sectionDrafts[0].sourceFactIds).toEqual(['fact-a']);
  });
});

/**
 * The authority self-report used to be inert: the prompt asked the model to assess "the wording YOU
 * produced", which anchors it to the request rather than the text, so it answered 'plan_or_review' in
 * 8 of 8 live runs — even for wording that plainly instructed a deploy, and the retry it exists to
 * trigger therefore never fired. The repair is prompt-side: classify the TEXT, and quote the most
 * action-oriented sentence before classifying it. These tests pin the contract that repair depends
 * on — the instructions actually reaching the model, and the evidence quote surviving the parse.
 */
describe('composer authority self-report — framing and evidence quote', () => {
  async function capturedSystemPrompt(): Promise<string> {
    let systemPrompt = '';
    const capturing: PromptEnhancementComposerClientV1 = {
      chat: { completions: { create: async (body) => {
        systemPrompt = body.messages.find((m) => m.role === 'system')?.content ?? '';
        return { choices: [{ message: { content: JSON.stringify({
          detectedLanguageSelfReport: 'en',
          authorityEvidence: '',
          authorityModeSelfReport: 'plan_or_review',
          sectionDrafts: [{ sectionId: 'sec-verify', bodyText: 'Check it.', sourceFactIds: ['fact-a'] }],
          composerClaims: ['claim:fact-a'],
        }) } }] };
      } } },
    };
    await composeStructuredComposerOutputV1(input, capturing);
    return systemPrompt;
  }

  it('asks the model to classify the produced TEXT, not what it intended to write', async () => {
    const prompt = await capturedSystemPrompt();
    expect(prompt).toContain('Re-read ONLY the section text you just produced');
    expect(prompt).toContain('classify the TEXT as it now stands');
    // The framing that made the report inert must be gone.
    expect(prompt).not.toContain('Report what you');
    expect(prompt).not.toContain('actually wrote, not what you intended');
  });

  it('requires the evidence quote BEFORE the verdict, and states the criterion explicitly', async () => {
    const prompt = await capturedSystemPrompt();
    expect(prompt).toContain('authorityEvidence');
    expect(prompt.indexOf('authorityEvidence')).toBeLessThan(prompt.indexOf('Then classify THAT sentence'));
    expect(prompt).toContain('irreversible or externally visible');
    // 'execute_requested' must not read as a confession, or the model avoids it to look compliant.
    expect(prompt).toContain('NOT an admission of error');
  });

  it('orders the JSON keys so the authority fields come AFTER sectionDrafts', async () => {
    // Measured regression, not a style preference. With authorityEvidence placed before sectionDrafts
    // in the schema, the model emits the quote before it has written a single section — so it quoted
    // the ORIGINAL REQUEST or returned nothing (quote present in only 2 of 6 live runs). Moving the
    // two authority keys after sectionDrafts took it to 6 of 6, every quote drawn from the produced
    // text. The 'do this LAST' instruction alone does not survive; emission order decides.
    const prompt = await capturedSystemPrompt();
    const schemaLine = prompt.split('\n').find((line) => line.includes('"sectionDrafts"')) ?? '';
    expect(schemaLine).not.toBe('');
    expect(schemaLine.indexOf('"sectionDrafts"')).toBeLessThan(schemaLine.indexOf('"authorityEvidence"'));
    expect(schemaLine.indexOf('"authorityEvidence"')).toBeLessThan(schemaLine.indexOf('"authorityModeSelfReport"'));
    expect(prompt).toContain('The key order is not cosmetic');
  });

  it('tells the model that checking/verifying/listing is plan_or_review, not observe_or_literal', async () => {
    // Also measured: without this, 'observe_or_literal' + an empty quote became an escape hatch (the
    // model read "Check what is included…" as directing nothing), which would leave any later
    // consumer of the self-report with no evidence to act on.
    const prompt = await capturedSystemPrompt();
    expect(prompt).toContain('Checking, verifying, listing, documenting, defining, planning and');
    expect(prompt).toContain('If you quoted a sentence');
  });

  it('parses the evidence quote alongside the verdict', async () => {
    const reply = JSON.stringify({
      detectedLanguageSelfReport: 'en',
      authorityEvidence: 'Deploy the package to production during the scheduled downtime.',
      authorityModeSelfReport: 'execute_requested',
      sectionDrafts: [{ sectionId: 'sec-verify', bodyText: 'Deploy the package to production during the scheduled downtime.', sourceFactIds: ['fact-a'] }],
      composerClaims: ['claim:fact-a'],
    });
    const result = await composeStructuredComposerOutputV1(input, client(reply));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.authorityModeSelfReport).toBe('execute_requested');
    expect(result.output.authorityEvidence).toBe('Deploy the package to production during the scheduled downtime.');
  });

  it('treats a blank, whitespace-only, or non-string quote as absent rather than as an empty finding', async () => {
    for (const evidence of ['', '   ', 42, null]) {
      const reply = JSON.stringify({
        detectedLanguageSelfReport: 'en',
        authorityEvidence: evidence,
        authorityModeSelfReport: 'plan_or_review',
        sectionDrafts: [{ sectionId: 'sec-verify', bodyText: 'List the checks to run.', sourceFactIds: ['fact-a'] }],
        composerClaims: ['claim:fact-a'],
      });
      const result = await composeStructuredComposerOutputV1(input, client(reply));
      expect(result.ok && result.output.authorityEvidence).toBeUndefined();
    }
  });

  it('a reply omitting the quote entirely still parses (the field is optional, never drift)', async () => {
    const reply = JSON.stringify({
      detectedLanguageSelfReport: 'en',
      authorityModeSelfReport: 'plan_or_review',
      sectionDrafts: [{ sectionId: 'sec-verify', bodyText: 'List the checks to run.', sourceFactIds: ['fact-a'] }],
      composerClaims: ['claim:fact-a'],
    });
    const result = await composeStructuredComposerOutputV1(input, client(reply));
    expect(result.ok).toBe(true);
    expect(result.ok && result.output.authorityEvidence).toBeUndefined();
  });

  it('the authority retry directive asks for a fresh quote of the REWRITTEN text', async () => {
    // A plan/review request whose output reports execution -> the gate fires -> retry carries the
    // stronger directive. Without the re-quote instruction the model would carry the stale quote over.
    const planInput = { ...input, originalPromptText: 'Review the migration script and plan the rollout.' };
    const escalating = JSON.stringify({
      detectedLanguageSelfReport: 'en',
      authorityEvidence: 'Deploy the package to production.',
      authorityModeSelfReport: 'execute_requested',
      sectionDrafts: [{ sectionId: 'sec-verify', bodyText: 'Deploy the package to production.', sourceFactIds: ['fact-a'] }],
      composerClaims: ['claim:fact-a'],
    });
    let sawRequote = false;
    const retrying: PromptEnhancementComposerClientV1 = {
      chat: { completions: { create: async (body) => {
        if (body.messages.some((m) => m.content.includes('re-quote the most action-oriented sentence'))) sawRequote = true;
        return { choices: [{ message: { content: escalating } }] };
      } } },
    };
    await composeStructuredComposerOutputV1(planInput, retrying);
    expect(sawRequote).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Key-path reliability: coverage as a retry condition, and the caller-supplied wall-clock ceiling.
// ---------------------------------------------------------------------------------------------

/** Two renderable sections, so a reply can be short without being empty. */
const TWO_SECTIONS = planning([
  { sectionId: 'sec-verify', sectionKind: 'verification_or_test_plan', structuredContentPartRefs: ['fact-a'] },
  { sectionId: 'sec-risk', sectionKind: 'risk_safety_or_confirmation', structuredContentPartRefs: ['fact-b'] },
  { sectionId: 'sec-orig', sectionKind: 'original_request_or_goal', structuredContentPartRefs: ['fact-x'] },
]);

function draft(sectionId: string, factId: string) {
  return { sectionId, bodyText: `Wording for ${sectionId}.`, sourceFactIds: [factId] };
}

function reply(drafts: readonly { sectionId: string; bodyText: string; sourceFactIds: string[] }[]): string {
  return JSON.stringify({ detectedLanguageSelfReport: 'en', sectionDrafts: drafts, composerClaims: ['claim:fact-a'] });
}

/** A client that answers each attempt from a queue and records every user prompt it was sent. */
function scriptedClient(replies: readonly string[]): {
  client: PromptEnhancementComposerClientV1;
  prompts: string[];
} {
  const prompts: string[] = [];
  let call = 0;
  return {
    prompts,
    client: {
      chat: { completions: { create: async (body) => {
        prompts.push(body.messages.map((m) => m.content).join('\n'));
        const content = replies[Math.min(call, replies.length - 1)] ?? null;
        call += 1;
        return { choices: [{ message: { content } }] };
      } } },
    },
  };
}

const twoSectionInput = { enhancementId: 'pe:req-1', originalPromptText: 'Fix the failing test.', planning: TWO_SECTIONS };

describe('coverage as a retry condition', () => {
  it('retries a short draft set and names the missing sectionIds in the directive', async () => {
    const short = reply([draft('sec-verify', 'fact-a')]);
    const full = reply([draft('sec-verify', 'fact-a'), draft('sec-risk', 'fact-b')]);
    const { client: scripted, prompts } = scriptedClient([short, full]);

    const result = await composeStructuredComposerOutputV1(twoSectionInput, scripted);

    expect(result.ok).toBe(true);
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).not.toContain('did not include a draft for every section');
    expect(prompts[1]).toContain('did not include a draft for every section');
    expect(prompts[1]).toContain('sec-risk');
    expect(prompts[1]).not.toContain('sec-verify,');
  });

  it('exits invalid_output when the set stays short — never ok with a partial body', async () => {
    const short = reply([draft('sec-verify', 'fact-a')]);
    const { client: scripted, prompts } = scriptedClient([short]);

    const result = await composeStructuredComposerOutputV1(twoSectionInput, scripted);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid_output');
    expect(prompts).toHaveLength(4); // the existing bound of 3 retries, not a new budget
  });

  it('returns a full draft set on the first attempt with no extra call', async () => {
    const full = reply([draft('sec-verify', 'fact-a'), draft('sec-risk', 'fact-b')]);
    const { client: scripted, prompts } = scriptedClient([full]);

    const result = await composeStructuredComposerOutputV1(twoSectionInput, scripted);

    expect(result.ok).toBe(true);
    expect(prompts).toHaveLength(1);
  });

  it('ignores extra drafts the plan did not ask for — coverage is about what is MISSING', async () => {
    const withExtra = reply([draft('sec-verify', 'fact-a'), draft('sec-risk', 'fact-b'), draft('sec-ghost', 'fact-a')]);
    const { client: scripted, prompts } = scriptedClient([withExtra]);

    const result = await composeStructuredComposerOutputV1(twoSectionInput, scripted);

    expect(result.ok).toBe(true);
    expect(prompts).toHaveLength(1);
  });
});

describe('the caller-supplied wall-clock ceiling', () => {
  const full = reply([draft('sec-verify', 'fact-a'), draft('sec-risk', 'fact-b')]);

  it('behaves byte-identically to today when no deadline is passed', async () => {
    const { client: scripted, prompts } = scriptedClient([full]);
    const result = await composeStructuredComposerOutputV1(twoSectionInput, scripted);
    expect(result.ok).toBe(true);
    expect(prompts).toHaveLength(1);
  });

  it('starts the attempt when a whole further call still fits', async () => {
    const { client: scripted, prompts } = scriptedClient([full]);
    const result = await composeStructuredComposerOutputV1(
      { ...twoSectionInput, deadlineAtMs: 100_000, nowMs: () => 10_000 },
      scripted,
    );
    expect(result.ok).toBe(true);
    expect(prompts).toHaveLength(1);
  });

  it('refuses with deadline_exceeded and makes NO provider call when a whole call does not fit', async () => {
    const { client: scripted, prompts } = scriptedClient([full]);
    const result = await composeStructuredComposerOutputV1(
      { ...twoSectionInput, deadlineAtMs: 50_000, nowMs: () => 40_000 },
      scripted,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('deadline_exceeded');
    expect(prompts).toHaveLength(0);
  });

  it('stops BETWEEN attempts, never mid-call, when the budget runs out during the loop', async () => {
    const short = reply([draft('sec-verify', 'fact-a')]);
    const { client: scripted, prompts } = scriptedClient([short]);
    // Room for the first attempt only; the clock advances past the ceiling once it has run.
    let nowValue = 10_000;
    const result = await composeStructuredComposerOutputV1(
      {
        ...twoSectionInput,
        deadlineAtMs: 60_000,
        nowMs: () => {
          const current = nowValue;
          nowValue = 30_000; // after the first attempt there is no longer room for a whole call
          return current;
        },
      },
      scripted,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('deadline_exceeded');
    expect(prompts).toHaveLength(1); // the in-flight call completed; the SECOND never started
  });
});
