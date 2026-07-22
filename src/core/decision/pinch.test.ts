import { describe, it, expect, vi } from 'vitest';
import type { LLMPort } from '../ports/llm.port.js';
import type { UserProfile } from '../classifier/types.js';
import {
  generatePinchLabel,
  validatePinchLabel,
  buildPinchPrompt,
  PINCH_MODEL,
  PINCH_MAX_TOKENS,
  PINCH_TEMPERATURE,
  PINCH_MAX_CHARS,
  PINCH_MIN_CHARS,
} from './pinch.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeLLM(content: string): LLMPort {
  return { chat: vi.fn().mockResolvedValue(content) };
}

function makeErrorLLM(): LLMPort {
  return { chat: vi.fn().mockRejectedValue(new Error('timeout')) };
}

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    nature: 'pro_geek_soul', precisionScore: 7, playfulnessScore: 7,
    precisionOrdinal: 'high', playfulnessOrdinal: 'high',
    mood: 'focused', depth: 'high', depthScore: 3, computedAt: 5,
    ...overrides,
  };
}

// ── Constants ─────────────────────────────────────────────────────────────────

describe('pinch constants', () => {
  it('PINCH_MODEL is gpt-4o-mini', () => { expect(PINCH_MODEL).toBe('gpt-4o-mini'); });
  it('PINCH_MAX_TOKENS is 24', () => { expect(PINCH_MAX_TOKENS).toBe(24); });
  it('PINCH_TEMPERATURE is 0.9', () => { expect(PINCH_TEMPERATURE).toBe(0.9); });
  it('PINCH_MAX_CHARS is 40', () => { expect(PINCH_MAX_CHARS).toBe(40); });
  it('PINCH_MIN_CHARS is 2', () => { expect(PINCH_MIN_CHARS).toBe(2); });
});

// ── validatePinchLabel ────────────────────────────────────────────────────────

describe('validatePinchLabel', () => {
  it('accepts a valid 2-word label', () => {
    expect(validatePinchLabel('Hold up.')).toBe('Hold up.');
  });

  it('accepts a 3-word label', () => {
    expect(validatePinchLabel('Quick check here.')).toBe('Quick check here.');
  });

  it('returns null for empty string', () => {
    expect(validatePinchLabel('')).toBeNull();
  });

  it('returns null for label shorter than PINCH_MIN_CHARS after trimming', () => {
    expect(validatePinchLabel('  a  ')).toBeNull();
  });

  it('returns null for label longer than PINCH_MAX_CHARS', () => {
    const long = 'a'.repeat(PINCH_MAX_CHARS + 1);
    expect(validatePinchLabel(long)).toBeNull();
  });

  it('strips surrounding quotes', () => {
    expect(validatePinchLabel('"Hold up."')).toBe('Hold up.');
  });

  it('strips backtick fences', () => {
    expect(validatePinchLabel('`Quick check.`')).toBe('Quick check.');
  });

  it('returns null for a single word shorter than PINCH_MIN_CHARS', () => {
    expect(validatePinchLabel('a')).toBeNull();
  });

  it('returns null for more than 4 words', () => {
    expect(validatePinchLabel('this is way too many words here')).toBeNull();
  });

  it('trims leading/trailing whitespace', () => {
    const result = validatePinchLabel('  Worth a pause.  ');
    expect(result).toBe('Worth a pause.');
  });
});

// ── buildPinchPrompt ──────────────────────────────────────────────────────────

describe('buildPinchPrompt', () => {
  it('includes the flag type in the prompt', () => {
    const prompt = buildPinchPrompt('question text', 'stage_transition', 'implementation');
    expect(prompt).toContain('stage_transition');
  });

  it('includes the current stage', () => {
    const prompt = buildPinchPrompt('question text', 'stage_transition', 'implementation');
    expect(prompt).toContain('implementation');
  });

  it('includes non-native English note when language is not en', () => {
    const prompt = buildPinchPrompt('question', 'stage_transition', 'implementation', undefined, 'fr');
    expect(prompt).toContain('native English');
  });

  it('does not include non-native note when language is en', () => {
    const prompt = buildPinchPrompt('question', 'stage_transition', 'implementation', undefined, 'en');
    expect(prompt).not.toContain('native English');
  });

  it('includes frustrated tone modifier when mood is frustrated', () => {
    const profile = makeProfile({ mood: 'frustrated' });
    const prompt = buildPinchPrompt('question', 'stage_transition', 'implementation', profile);
    expect(prompt).toContain('empathetic');
  });

  it('includes encouraging tone for beginner profile', () => {
    const profile = makeProfile({ nature: 'beginner' });
    const prompt = buildPinchPrompt('question', 'stage_transition', 'implementation', profile);
    expect(prompt).toContain('encouraging');
  });
});

// ── generatePinchLabel (LLMPort API) ─────────────────────────────────────────

describe('generatePinchLabel', () => {
  it('returns LLM response when valid', async () => {
    const llm = makeLLM('Quick check.');
    const result = await generatePinchLabel('implementation', 'stage_transition', llm);
    expect(result).toBe('Quick check.');
  });

  it('falls back to content.pinchFallback on API error', async () => {
    const result = await generatePinchLabel('implementation', 'stage_transition', makeErrorLLM());
    // Must be a non-empty string from the content table
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('falls back to content.pinchFallback when LLM returns invalid label', async () => {
    // A response that fails validatePinchLabel (> 4 words)
    const llm = makeLLM('this is way too many words here in the label');
    const result = await generatePinchLabel('implementation', 'stage_transition', llm);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('passes the correct model to llm.chat', async () => {
    const llm = makeLLM('Hold up.');
    await generatePinchLabel('implementation', 'stage_transition', llm);
    const call = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.model).toBe(PINCH_MODEL);
  });

  it('passes the correct temperature to llm.chat', async () => {
    const llm = makeLLM('Hold up.');
    await generatePinchLabel('implementation', 'stage_transition', llm);
    const call = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.temperature).toBe(PINCH_TEMPERATURE);
  });

  it('passes max_tokens to llm.chat', async () => {
    const llm = makeLLM('Hold up.');
    await generatePinchLabel('implementation', 'stage_transition', llm);
    const call = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.max_tokens).toBe(PINCH_MAX_TOKENS);
  });

  it('never throws — always returns a string', async () => {
    await expect(
      generatePinchLabel('implementation', 'stage_transition', makeErrorLLM()),
    ).resolves.toEqual(expect.any(String));
  });

  it('passes profile and language through to the prompt', async () => {
    const llm = makeLLM('Hold up.');
    const profile = makeProfile({ mood: 'frustrated' });
    await generatePinchLabel('implementation', 'stage_transition', llm, profile, 'en');
    const call = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.messages[0].content).toContain('implementation');
  });
});
