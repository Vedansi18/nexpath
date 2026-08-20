import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LLMPort } from '../ports/llm.port.js';
import type { LogPort } from '../ports/log.port.js';
import type { PromptRecord, UserProfile } from './types.js';
import {
  classifyUserProfileLLM,
  validateClassifierResponse,
  buildClassifierPrompt,
  deriveScores,
  buildSafeDefaults,
  MIN_PROFILE_PROMPTS,
  LLM_CLASSIFIER_MODEL,
  LLM_CLASSIFIER_MAX_TOKENS,
  LLM_CLASSIFIER_TEMP,
} from './LLMProfileClassifier.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeRecord(text: string, index = 0): PromptRecord {
  return { index, text, capturedAt: Date.now(), classifiedStage: 'implementation', confidence: 0.8 };
}

function makeHistory(n: number): PromptRecord[] {
  return Array.from({ length: n }, (_, i) => makeRecord(`prompt ${i + 1}`, i));
}

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    nature: 'hardcore_pro', precisionScore: 9, playfulnessScore: 2,
    precisionOrdinal: 'very_high', playfulnessOrdinal: 'low',
    mood: 'focused', depth: 'high', depthScore: 3, computedAt: 10,
    ...overrides,
  };
}

function makeValidRaw(overrides: Record<string, string> = {}): string {
  return JSON.stringify({
    nature: 'hardcore_pro', mood: 'focused', depth: 'high',
    precision: 'very_high', playfulness: 'low',
    ...overrides,
  });
}

function makeLLM(content: string): LLMPort {
  return { chat: vi.fn().mockResolvedValue(content) };
}

function makeErrorLLM(): LLMPort {
  return { chat: vi.fn().mockRejectedValue(new Error('api error')) };
}

// ── Constants ──────────────────────────────────────────────────────────────────

describe('LLMProfileClassifier constants (core)', () => {
  it('MIN_PROFILE_PROMPTS is 4', () => { expect(MIN_PROFILE_PROMPTS).toBe(4); });
  it('LLM_CLASSIFIER_MODEL is gpt-4o-mini', () => { expect(LLM_CLASSIFIER_MODEL).toBe('gpt-4o-mini'); });
  it('LLM_CLASSIFIER_MAX_TOKENS is 80', () => { expect(LLM_CLASSIFIER_MAX_TOKENS).toBe(80); });
  it('LLM_CLASSIFIER_TEMP is 0', () => { expect(LLM_CLASSIFIER_TEMP).toBe(0); });
});

// ── deriveScores ───────────────────────────────────────────────────────────────

describe('deriveScores (core)', () => {
  it('very_high precision → 9.0', () => {
    expect(deriveScores('very_high', 'medium', 'medium').precisionScore).toBe(9.0);
  });
  it('high precision → 7.0', () => {
    expect(deriveScores('high', 'medium', 'medium').precisionScore).toBe(7.0);
  });
  it('medium precision → 5.0', () => {
    expect(deriveScores('medium', 'medium', 'medium').precisionScore).toBe(5.0);
  });
  it('low precision → 2.0', () => {
    expect(deriveScores('low', 'medium', 'medium').precisionScore).toBe(2.0);
  });
  it('depth high → depthScore 3.0', () => {
    expect(deriveScores('medium', 'medium', 'high').depthScore).toBe(3.0);
  });
  it('depth medium → depthScore 1.0', () => {
    expect(deriveScores('medium', 'medium', 'medium').depthScore).toBe(1.0);
  });
  it('depth low → depthScore 0.1', () => {
    expect(deriveScores('medium', 'medium', 'low').depthScore).toBe(0.1);
  });
});

// ── buildSafeDefaults ──────────────────────────────────────────────────────────

describe('buildSafeDefaults (core)', () => {
  it('returns beginner nature', () => { expect(buildSafeDefaults(0).nature).toBe('beginner'); });
  it('returns casual mood', () => { expect(buildSafeDefaults(0).mood).toBe('casual'); });
  it('stamps computedAt', () => { expect(buildSafeDefaults(42).computedAt).toBe(42); });
  it('returns medium precisionOrdinal', () => { expect(buildSafeDefaults(0).precisionOrdinal).toBe('medium'); });
});

// ── validateClassifierResponse ─────────────────────────────────────────────────

describe('validateClassifierResponse (core)', () => {
  it('returns valid UserProfile for correct response', () => {
    const result = validateClassifierResponse(makeValidRaw(), null);
    expect(result).not.toBeNull();
    expect(result!.nature).toBe('hardcore_pro');
    expect(result!.mood).toBe('focused');
  });

  it('returns null for malformed JSON', () => {
    expect(validateClassifierResponse('not json', null)).toBeNull();
  });

  it('strips markdown fencing', () => {
    const fenced = '```json\n' + makeValidRaw() + '\n```';
    expect(validateClassifierResponse(fenced, null)?.nature).toBe('hardcore_pro');
  });

  it('falls back to existing nature on invalid nature field', () => {
    const existing = makeProfile({ nature: 'pro_geek_soul' });
    const result = validateClassifierResponse(makeValidRaw({ nature: 'bad_value' }), existing);
    expect(result!.nature).toBe('pro_geek_soul');
  });

  it('falls back to beginner on invalid nature with no existing', () => {
    expect(validateClassifierResponse(makeValidRaw({ nature: 'bad' }), null)!.nature).toBe('beginner');
  });

  it('calls log.debug on validation field failures when log provided', () => {
    const log: LogPort = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
    validateClassifierResponse(makeValidRaw({ nature: 'bad' }), null, log);
    expect(log.debug).toHaveBeenCalled();
  });
});

// ── buildClassifierPrompt ──────────────────────────────────────────────────────

describe('buildClassifierPrompt (core)', () => {
  it('system message mentions developer profile classifier', () => {
    const { system } = buildClassifierPrompt(makeHistory(4));
    expect(system).toContain('developer profile classifier');
  });

  it('user message includes NATURE section', () => {
    const { user } = buildClassifierPrompt(makeHistory(4));
    expect(user).toContain('NATURE');
    expect(user).toContain('hardcore_pro');
  });

  it('user message includes all prompt texts', () => {
    const history = [makeRecord('build REST endpoints', 0), makeRecord('add pagination', 1)];
    const { user } = buildClassifierPrompt(history);
    expect(user).toContain('build REST endpoints');
    expect(user).toContain('add pagination');
  });
});

// ── classifyUserProfileLLM (LLMPort API) ──────────────────────────────────────

describe('classifyUserProfileLLM (LLMPort)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns existing profile without calling LLM when history < MIN_PROFILE_PROMPTS - 1', async () => {
    const existing = makeProfile();
    const llm = makeLLM(makeValidRaw());
    const result = await classifyUserProfileLLM(makeHistory(2), 2, existing, llm);
    expect(result).toBe(existing);
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it('returns safe defaults when history < MIN and existing is null', async () => {
    const llm = makeLLM(makeValidRaw());
    const result = await classifyUserProfileLLM(makeHistory(2), 2, null, llm);
    expect(result.nature).toBe('beginner');
    expect(result.mood).toBe('casual');
  });

  it('calls llm.chat when history.length >= MIN_PROFILE_PROMPTS', async () => {
    const llm = makeLLM(makeValidRaw());
    await classifyUserProfileLLM(makeHistory(4), 4, null, llm);
    expect(llm.chat).toHaveBeenCalledOnce();
  });

  it('passes correct model in llm.chat call', async () => {
    const llm = makeLLM(makeValidRaw());
    await classifyUserProfileLLM(makeHistory(4), 4, null, llm);
    const call = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.model).toBe('gpt-4o-mini');
  });

  it('passes temperature 0 in llm.chat call', async () => {
    const llm = makeLLM(makeValidRaw());
    await classifyUserProfileLLM(makeHistory(4), 4, null, llm);
    const call = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.temperature).toBe(0);
  });

  it('passes json_object response_format in llm.chat call', async () => {
    const llm = makeLLM(makeValidRaw());
    await classifyUserProfileLLM(makeHistory(4), 4, null, llm);
    const call = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.response_format).toEqual({ type: 'json_object' });
  });

  it('sends both system and user messages', async () => {
    const llm = makeLLM(makeValidRaw());
    await classifyUserProfileLLM(makeHistory(4), 4, null, llm);
    const call = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.messages.some((m: { role: string }) => m.role === 'system')).toBe(true);
    expect(call.messages.some((m: { role: string }) => m.role === 'user')).toBe(true);
  });

  it('returns valid profile from LLM response', async () => {
    const llm = makeLLM(makeValidRaw());
    const result = await classifyUserProfileLLM(makeHistory(4), 4, null, llm);
    expect(result.nature).toBe('hardcore_pro');
    expect(result.mood).toBe('focused');
    expect(result.precisionOrdinal).toBe('very_high');
  });

  it('stamps computedAt with promptCount', async () => {
    const llm = makeLLM(makeValidRaw());
    const result = await classifyUserProfileLLM(makeHistory(6), 6, null, llm);
    expect(result.computedAt).toBe(6);
  });

  it('returns existing profile on API error', async () => {
    const existing = makeProfile();
    const result = await classifyUserProfileLLM(makeHistory(4), 4, existing, makeErrorLLM());
    expect(result).toBe(existing);
  });

  it('returns safe defaults on API error when existing is null', async () => {
    const result = await classifyUserProfileLLM(makeHistory(4), 4, null, makeErrorLLM());
    expect(result.nature).toBe('beginner');
  });

  it('returns existing profile when LLM returns malformed JSON', async () => {
    const existing = makeProfile();
    const result = await classifyUserProfileLLM(makeHistory(4), 4, existing, makeLLM('not json'));
    expect(result).toBe(existing);
  });

  it('never throws even on API error', async () => {
    await expect(
      classifyUserProfileLLM(makeHistory(4), 4, null, makeErrorLLM()),
    ).resolves.not.toThrow();
  });

  it('calls log.debug on validation failure when log provided', async () => {
    const log: LogPort = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
    await classifyUserProfileLLM(makeHistory(4), 4, null, makeLLM('bad json'), log);
    expect(log.debug).toHaveBeenCalled();
  });
});
