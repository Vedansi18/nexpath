import { describe, expect, it } from 'vitest';
import { decidePromptEnhancementRouteViaLlmV1 } from './llm-route-decision.js';
import type { PromptEnhancementComposerClientV1 } from './llm-composer.js';

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

const input = {
  promptText: 'fix this',
  deterministicFamilyId: 'quick_improvement' as const,
  deterministicPrimaryIntent: 'quick_improvement.small_change' as any,
};

describe('decidePromptEnhancementRouteViaLlmV1 (E6 / 6.1)', () => {
  it('parses a valid in-enum route decision', async () => {
    const reply = JSON.stringify({
      familyId: 'issue_debug',
      primaryIntent: 'issue_debug.new_bug_report',
      capabilities: ['capability.reproduction_or_evidence_needed', 'capability.verification_required'],
      ambiguityState: 'ambiguous_surface_prompt',
    });
    const decision = await decidePromptEnhancementRouteViaLlmV1(input, client(reply));
    expect(decision).toEqual({
      familyId: 'issue_debug',
      primaryIntent: 'issue_debug.new_bug_report',
      capabilities: ['capability.reproduction_or_evidence_needed', 'capability.verification_required'],
      ambiguityState: 'ambiguous_surface_prompt',
    });
  });

  it('accepts an empty capabilities list', async () => {
    const reply = JSON.stringify({ familyId: 'planning_spec', primaryIntent: 'planning.task_breakdown', capabilities: [], ambiguityState: 'clear' });
    const decision = await decidePromptEnhancementRouteViaLlmV1(input, client(reply));
    expect(decision?.capabilities).toEqual([]);
  });

  it('rejects an out-of-enum familyId (retries then falls back to undefined)', async () => {
    const reply = JSON.stringify({ familyId: 'not_a_family', primaryIntent: 'issue_debug.new_bug_report', capabilities: [], ambiguityState: 'clear' });
    expect(await decidePromptEnhancementRouteViaLlmV1(input, client(reply))).toBeUndefined();
  });

  it('rejects an out-of-enum primaryIntent', async () => {
    const reply = JSON.stringify({ familyId: 'issue_debug', primaryIntent: 'issue_debug.not_real', capabilities: [], ambiguityState: 'clear' });
    expect(await decidePromptEnhancementRouteViaLlmV1(input, client(reply))).toBeUndefined();
  });

  it('rejects when any capability is out-of-enum (no silent drop)', async () => {
    const reply = JSON.stringify({ familyId: 'issue_debug', primaryIntent: 'issue_debug.new_bug_report', capabilities: ['capability.verification_required', 'capability.made_up'], ambiguityState: 'clear' });
    expect(await decidePromptEnhancementRouteViaLlmV1(input, client(reply))).toBeUndefined();
  });

  it('rejects an out-of-enum ambiguityState', async () => {
    const reply = JSON.stringify({ familyId: 'issue_debug', primaryIntent: 'issue_debug.new_bug_report', capabilities: [], ambiguityState: 'super_ambiguous' });
    expect(await decidePromptEnhancementRouteViaLlmV1(input, client(reply))).toBeUndefined();
  });

  it('returns undefined on malformed JSON', async () => {
    expect(await decidePromptEnhancementRouteViaLlmV1(input, client('not json'))).toBeUndefined();
  });

  it('does NOT retry a thrown provider error (fast fallback)', async () => {
    let calls = 0;
    const throwing: PromptEnhancementComposerClientV1 = {
      chat: { completions: { create: async () => { calls += 1; throw new Error('down'); } } },
    };
    expect(await decidePromptEnhancementRouteViaLlmV1(input, throwing)).toBeUndefined();
    expect(calls).toBe(1);
  });

  it('retries a malformed reply then succeeds on a valid one', async () => {
    const good = JSON.stringify({ familyId: 'issue_debug', primaryIntent: 'issue_debug.new_bug_report', capabilities: [], ambiguityState: 'clear' });
    let calls = 0;
    const flaky: PromptEnhancementComposerClientV1 = {
      chat: { completions: { create: async () => { calls += 1; return { choices: [{ message: { content: calls < 3 ? 'nope' : good } }] }; } } },
    };
    const decision = await decidePromptEnhancementRouteViaLlmV1(input, flaky);
    expect(decision?.familyId).toBe('issue_debug');
    expect(calls).toBe(3);
  });
});
