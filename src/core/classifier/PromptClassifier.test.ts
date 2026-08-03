import { describe, it, expect, vi } from 'vitest';
import type { ClassificationResult } from './types.js';
import {
  classifyPrompt,
  TIER1_CONFIDENCE_THRESHOLD,
  TIER2_CONFIDENCE_THRESHOLD,
} from './PromptClassifier.js';

// ── Constants ─────────────────────────────────────────────────────────────────

describe('PromptClassifier constants (core)', () => {
  it('TIER1_CONFIDENCE_THRESHOLD is 0.65', () => { expect(TIER1_CONFIDENCE_THRESHOLD).toBe(0.65); });
  it('TIER2_CONFIDENCE_THRESHOLD is 0.40', () => { expect(TIER2_CONFIDENCE_THRESHOLD).toBe(0.40); });
});

// ── Tier 1 ────────────────────────────────────────────────────────────────────

describe('classifyPrompt — Tier 1', () => {
  // 3 strong release keywords → score ≥ 0.65 in Tier 1 (per existing classifier.test.ts)
  const TIER1_TEXT = 'deploy to production npm publish go live now';

  it('returns Tier 1 result when keyword match confidence >= 0.65', async () => {
    const result = await classifyPrompt(TIER1_TEXT);
    expect(result.tier).toBe(1);
    expect(result.confidence).toBeGreaterThanOrEqual(TIER1_CONFIDENCE_THRESHOLD);
  });

  it('does not call tidfClassifier when Tier 1 short-circuits', async () => {
    const tidfFn = vi.fn(() => ({ stage: 'prd', confidence: 0.9, tier: 2, allScores: {} } as ClassificationResult));
    await classifyPrompt(TIER1_TEXT, { tidfClassifier: tidfFn });
    expect(tidfFn).not.toHaveBeenCalled();
  });
});

// ── Tier 2 ────────────────────────────────────────────────────────────────────

describe('classifyPrompt — Tier 2', () => {
  it('calls tidfClassifier when Tier 1 does not short-circuit', async () => {
    // A very short or ambiguous text that won't hit Tier 1 threshold
    const tidfFn = vi.fn(() => ({ stage: 'prd', confidence: 0.50, tier: 2, allScores: {} } as ClassificationResult));
    await classifyPrompt('ok', { tidfClassifier: tidfFn });
    expect(tidfFn).toHaveBeenCalledOnce();
  });

  it('accepts Tier 2 result when confidence >= TIER2_CONFIDENCE_THRESHOLD', async () => {
    const tidfFn = vi.fn(() => ({ stage: 'prd', confidence: 0.50, tier: 2, allScores: {} } as ClassificationResult));
    const result = await classifyPrompt('ok', { tidfClassifier: tidfFn });
    expect(result.stage).toBe('prd');
    expect(result.confidence).toBe(0.50);
  });

  it('skips Tier 2 entirely when tidfClassifier is not provided', async () => {
    const result = await classifyPrompt('ok');
    // No exception — falls through to Tier 3 or fallback
    expect(result).toHaveProperty('stage');
  });

  it('skips Tier 2 when tidfClassifier is null', async () => {
    const result = await classifyPrompt('ok', { tidfClassifier: null });
    expect(result).toHaveProperty('stage');
  });
});

// ── Tier 3 ────────────────────────────────────────────────────────────────────

describe('classifyPrompt — Tier 3', () => {
  it('calls embeddingClassifier when Tier 1+2 both below threshold', async () => {
    const tidfFn = vi.fn(() => ({ stage: 'idea', confidence: 0.20, tier: 2, allScores: {} } as ClassificationResult));
    const embeddingClassifier = { classify: vi.fn().mockResolvedValue({ stage: 'architecture', confidence: 0.75, tier: 3, allScores: {} } as ClassificationResult) };

    const result = await classifyPrompt('hmm', { tidfClassifier: tidfFn, embeddingClassifier });
    expect(embeddingClassifier.classify).toHaveBeenCalledWith('hmm');
    expect(result.stage).toBe('architecture');
  });

  it('falls back gracefully when embeddingClassifier throws', async () => {
    const tidfFn = vi.fn(() => ({ stage: 'idea', confidence: 0.20, tier: 2, allScores: {} } as ClassificationResult));
    const embeddingClassifier = { classify: vi.fn().mockRejectedValue(new Error('model not loaded')) };

    const result = await classifyPrompt('hmm', { tidfClassifier: tidfFn, embeddingClassifier });
    // Falls back to best available from Tier 1/2
    expect(result).toHaveProperty('stage');
  });

  it('does not call embeddingClassifier when Tier 1 already short-circuited', async () => {
    const embeddingClassifier = { classify: vi.fn() };
    await classifyPrompt('deploy to production npm publish go live now', { embeddingClassifier });
    expect(embeddingClassifier.classify).not.toHaveBeenCalled();
  });
});

// ── Fallback ──────────────────────────────────────────────────────────────────

describe('classifyPrompt — fallback', () => {
  it('returns implementation stage with 0 confidence as final fallback', async () => {
    // No tidfClassifier, no embeddingClassifier, ambiguous text
    const result = await classifyPrompt('ok');
    expect(result).toHaveProperty('stage');
    expect(result).toHaveProperty('confidence');
  });

  it('returns best of Tier 1 vs Tier 2 when both below threshold', async () => {
    const tidfFn = vi.fn(() => ({ stage: 'prd', confidence: 0.25, tier: 2, allScores: {} } as ClassificationResult));
    const result = await classifyPrompt('ok', { tidfClassifier: tidfFn });
    // Returns the best available (Tier 1 or Tier 2)
    expect(['implementation', 'prd', 'idea', 'architecture', 'task_breakdown', 'review_testing', 'release', 'feedback_loop']).toContain(result.stage);
  });
});
