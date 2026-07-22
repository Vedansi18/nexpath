import { describe, it, expect, vi } from 'vitest';
import { generateOptionList } from './options.js';
import { TASK_REVIEW } from './static-content.js';
import type { LLMPort } from '../ports/llm.port.js';

// Identity "adaptation" — structurally valid so the engine's validator accepts it
// on both passes (vocabulary adaptation + feature-noun embedding).
function validResponse(): string {
  return JSON.stringify({
    l1: TASK_REVIEW.L1.map((o) => o.option),
    l2: TASK_REVIEW.L2.map((o) => o.option),
    l3: TASK_REVIEW.L3.map((o) => o.option),
  });
}

describe('core/decision/options — generateOptionList (LLMPort wrapper)', () => {
  it('drives the real engine through the shim and returns GeneratedOptions', async () => {
    const llm: LLMPort = { chat: vi.fn().mockResolvedValue(validResponse()) };

    const result = await generateOptionList(TASK_REVIEW, undefined, undefined, [], undefined, llm);

    expect(result).not.toBeNull();
    expect(result?.l1).toHaveLength(TASK_REVIEW.L1.length);
    expect(result?.l2).toHaveLength(TASK_REVIEW.L2.length);
    expect(result?.l3).toHaveLength(TASK_REVIEW.L3.length);
    // Runtime substitutions ran → resolved desc bodies attached (no raw markers).
    expect(result?.generatedDescBases?.l1).toHaveLength(TASK_REVIEW.L1.length);
  });

  it('forwards the wrapper params into a single LLMPort.chat call shape', async () => {
    const chat = vi.fn().mockResolvedValue(validResponse());
    const llm: LLMPort = { chat };

    await generateOptionList(TASK_REVIEW, undefined, undefined, [], undefined, llm);

    expect(chat).toHaveBeenCalled();
    const firstArg = chat.mock.calls[0]?.[0];
    expect(firstArg.model).toBe('gpt-4o-mini');
    expect(firstArg.response_format).toEqual({ type: 'json_object' });
    expect(firstArg.timeoutMs).toBe(12_000);
  });

  it('returns null (never throws) when the LLMPort fails — caller falls back to static', async () => {
    const llm: LLMPort = { chat: vi.fn().mockRejectedValue(new Error('network error')) };

    const result = await generateOptionList(TASK_REVIEW, undefined, undefined, [], undefined, llm);

    expect(result).toBeNull();
  });
});
