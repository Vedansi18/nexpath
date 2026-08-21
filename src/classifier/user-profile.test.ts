import { describe, it, expect, vi } from 'vitest';
import { isProfileStale, classifyUserProfile, NATURE_DEPTH_RECOMPUTE_INTERVAL } from './UserProfileClassifier.js';
import type { UserProfile, PromptRecord } from './types.js';
import type { LLMPort } from '../core/ports/llm.port.js';

// Fails the test if called — the below-gate cases must never reach the LLM.
const unusedLLM: LLMPort = { chat: vi.fn().mockRejectedValue(new Error('llm.chat should not be called below the gate')) };

function makeSuccessLLM(): LLMPort {
  return {
    chat: vi.fn().mockResolvedValue(JSON.stringify({
      nature: 'hardcore_pro', mood: 'focused', depth: 'high',
      precision: 'very_high', playfulness: 'low',
    })),
  };
}

// ── UserProfileClassifier — isProfileStale ────────────────────────────────────

describe('UserProfileClassifier — isProfileStale', () => {
  function fakeProfile(computedAt: number): UserProfile {
    return {
      nature: 'beginner', precisionScore: 0, playfulnessScore: 0,
      precisionOrdinal: 'low', playfulnessOrdinal: 'low',
      mood: 'casual', depth: 'low', depthScore: 0, computedAt,
    };
  }

  it('returns true for null profile', () => {
    expect(isProfileStale(null, 10)).toBe(true);
  });

  it('returns false when within recompute interval', () => {
    const profile = fakeProfile(0);
    expect(isProfileStale(profile, NATURE_DEPTH_RECOMPUTE_INTERVAL - 1)).toBe(false);
  });

  it('returns true when at recompute interval boundary', () => {
    const profile = fakeProfile(0);
    expect(isProfileStale(profile, NATURE_DEPTH_RECOMPUTE_INTERVAL)).toBe(true);
  });

  it('returns true when well past recompute interval', () => {
    const profile = fakeProfile(0);
    expect(isProfileStale(profile, NATURE_DEPTH_RECOMPUTE_INTERVAL * 3)).toBe(true);
  });

  it('uses computedAt correctly when not starting at 0', () => {
    const profile = fakeProfile(10);
    expect(isProfileStale(profile, 12)).toBe(false); // 12-10=2 < 3
    expect(isProfileStale(profile, 13)).toBe(true);  // 13-10=3 >= 3
  });
});

// ── UserProfileClassifier — classifyUserProfile delegate ──────────────────────

describe('UserProfileClassifier — classifyUserProfile', () => {
  function makeHistory(n: number): PromptRecord[] {
    return Array.from({ length: n }, (_, i) => ({
      index: i, text: `prompt ${i}`, capturedAt: 0,
      classifiedStage: 'implementation' as const, confidence: 0.8,
    }));
  }

  it('returns safe defaults when history is below MIN_PROFILE_PROMPTS - 1 gate', async () => {
    const result = await classifyUserProfile(makeHistory(2), 2, null, unusedLLM);
    expect(result.nature).toBe('beginner');
    expect(result.mood).toBe('casual');
    expect(result.depth).toBe('medium');
  });

  it('returns existing profile unchanged when below gate and existing is non-null', async () => {
    const existing: UserProfile = {
      nature: 'hardcore_pro', precisionScore: 9, playfulnessScore: 2,
      precisionOrdinal: 'very_high', playfulnessOrdinal: 'low',
      mood: 'focused', depth: 'high', depthScore: 3, computedAt: 1,
    };
    const result = await classifyUserProfile(makeHistory(2), 2, existing, unusedLLM);
    expect(result.nature).toBe('hardcore_pro');
    expect(result.computedAt).toBe(1);
  });

  it('delegates through to LLM layer when history meets the gate — real LLM response is classified', async () => {
    // history=4 clears the MIN_PROFILE_PROMPTS gate — classifyUserProfile must forward
    // the llm param through to classifyUserProfileLLM, which then calls llm.chat().
    const llm = makeSuccessLLM();
    const result = await classifyUserProfile(makeHistory(4), 4, null, llm);
    expect(llm.chat).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      nature:             'hardcore_pro',
      mood:               'focused',
      depth:              'high',
      precisionOrdinal:   'very_high',
      playfulnessOrdinal: 'low',
    });
    expect(result.computedAt).toBe(4);
  });
});
