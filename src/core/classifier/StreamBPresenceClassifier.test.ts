import { describe, it, expect, vi } from 'vitest';
import type { LLMPort } from '../ports/llm.port.js';
import type { LogPort } from '../ports/log.port.js';
import {
  classifyStreamBPresence,
  parseStreamBResponse,
  STREAM_B_MODEL,
  STREAM_B_MAX_OUTPUT_TOKENS,
  STREAM_B_TIMEOUT_MS,
} from './StreamBPresenceClassifier.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeLLM(content: string): LLMPort {
  return { chat: vi.fn().mockResolvedValue(content) };
}

function makeErrorLLM(): LLMPort {
  return { chat: vi.fn().mockRejectedValue(new Error('network error')) };
}

function makeValidRaw(overrides: Partial<{
  feature_scope_before_build: boolean;
  implementation_checkpoint:  boolean;
  spec_before_code:           boolean;
}> = {}): string {
  return JSON.stringify({
    feature_scope_before_build: false,
    implementation_checkpoint:  false,
    spec_before_code:           false,
    ...overrides,
  });
}

// ── Constants ─────────────────────────────────────────────────────────────────

describe('StreamBPresenceClassifier constants (core)', () => {
  it('STREAM_B_MODEL is gpt-4o-mini', () => { expect(STREAM_B_MODEL).toBe('gpt-4o-mini'); });
  it('STREAM_B_MAX_OUTPUT_TOKENS is 60', () => { expect(STREAM_B_MAX_OUTPUT_TOKENS).toBe(60); });
  it('STREAM_B_TIMEOUT_MS is 5000', () => { expect(STREAM_B_TIMEOUT_MS).toBe(5_000); });
});

// ── parseStreamBResponse ──────────────────────────────────────────────────────

describe('parseStreamBResponse (core)', () => {
  it('returns correct booleans for a valid JSON response', () => {
    expect(parseStreamBResponse(makeValidRaw({ feature_scope_before_build: true }))).toEqual({
      feature_scope_before_build: true,
      implementation_checkpoint:  false,
      spec_before_code:           false,
    });
  });

  it('returns null for malformed JSON', () => {
    expect(parseStreamBResponse('not json')).toBeNull();
    expect(parseStreamBResponse('')).toBeNull();
  });

  it('returns null when required fields are missing', () => {
    expect(parseStreamBResponse(JSON.stringify({ feature_scope_before_build: true }))).toBeNull();
  });

  it('returns null when field values are not boolean', () => {
    const bad = JSON.stringify({ feature_scope_before_build: 'yes', implementation_checkpoint: 1, spec_before_code: null });
    expect(parseStreamBResponse(bad)).toBeNull();
  });

  it('strips ```json fences before parsing', () => {
    const fenced = '```json\n' + makeValidRaw({ spec_before_code: true }) + '\n```';
    const result = parseStreamBResponse(fenced);
    expect(result?.spec_before_code).toBe(true);
  });

  it('strips plain ``` fences', () => {
    const fenced = '```\n' + makeValidRaw({ implementation_checkpoint: true }) + '\n```';
    expect(parseStreamBResponse(fenced)?.implementation_checkpoint).toBe(true);
  });

  it('returns null when parsed value is not an object', () => {
    expect(parseStreamBResponse('"just a string"')).toBeNull();
    expect(parseStreamBResponse('null')).toBeNull();
  });
});

// ── classifyStreamBPresence (LLMPort API) ─────────────────────────────────────

describe('classifyStreamBPresence (LLMPort)', () => {
  it('calls llm.chat with the prompt text as user message', async () => {
    const llm = makeLLM(makeValidRaw());
    await classifyStreamBPresence('define acceptance criteria before building', llm);
    const call = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const userMsg = call.messages.find((m: { role: string }) => m.role === 'user');
    expect(userMsg.content).toBe('define acceptance criteria before building');
  });

  it('passes the correct model', async () => {
    const llm = makeLLM(makeValidRaw());
    await classifyStreamBPresence('test prompt', llm);
    const call = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.model).toBe(STREAM_B_MODEL);
  });

  it('passes temperature 0', async () => {
    const llm = makeLLM(makeValidRaw());
    await classifyStreamBPresence('test', llm);
    expect((llm.chat as ReturnType<typeof vi.fn>).mock.calls[0][0].temperature).toBe(0);
  });

  it('passes timeoutMs in the call', async () => {
    const llm = makeLLM(makeValidRaw());
    await classifyStreamBPresence('test', llm);
    expect((llm.chat as ReturnType<typeof vi.fn>).mock.calls[0][0].timeoutMs).toBe(STREAM_B_TIMEOUT_MS);
  });

  it('passes json_object response_format', async () => {
    const llm = makeLLM(makeValidRaw());
    await classifyStreamBPresence('test', llm);
    expect((llm.chat as ReturnType<typeof vi.fn>).mock.calls[0][0].response_format).toEqual({ type: 'json_object' });
  });

  it('sends a system message and user message', async () => {
    const llm = makeLLM(makeValidRaw());
    await classifyStreamBPresence('test', llm);
    const messages = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[0][0].messages;
    expect(messages.some((m: { role: string }) => m.role === 'system')).toBe(true);
    expect(messages.some((m: { role: string }) => m.role === 'user')).toBe(true);
  });

  it('returns parsed result when LLM returns valid JSON', async () => {
    const raw = makeValidRaw({ feature_scope_before_build: true, spec_before_code: true });
    const result = await classifyStreamBPresence('define what done looks like before coding', makeLLM(raw));
    expect(result.feature_scope_before_build).toBe(true);
    expect(result.spec_before_code).toBe(true);
    expect(result.implementation_checkpoint).toBe(false);
  });

  it('returns all-false when LLM returns unparseable response', async () => {
    const result = await classifyStreamBPresence('test', makeLLM('bad json'));
    expect(result).toEqual({ feature_scope_before_build: false, implementation_checkpoint: false, spec_before_code: false });
  });

  it('returns all-false when LLM returns valid JSON with wrong field types', async () => {
    const bad = JSON.stringify({ feature_scope_before_build: 'yes', implementation_checkpoint: 0, spec_before_code: null });
    const result = await classifyStreamBPresence('test', makeLLM(bad));
    expect(result).toEqual({ feature_scope_before_build: false, implementation_checkpoint: false, spec_before_code: false });
  });

  it('throws when API call fails', async () => {
    await expect(classifyStreamBPresence('test', makeErrorLLM())).rejects.toThrow('network error');
  });

  it('calls log.debug on parse failure when log is provided', async () => {
    const log: LogPort = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
    await classifyStreamBPresence('test', makeLLM('bad json'), log);
    expect(log.debug).toHaveBeenCalledWith('stream_b_presence_validation_fail', expect.any(Object));
  });
});
