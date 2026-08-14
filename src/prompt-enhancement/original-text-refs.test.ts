/**
 * T2 carriers — the three tests the phase plan names:
 *   - a ref resolves to the expected span
 *   - a ref that cannot resolve is REFUSED rather than silently dropped
 *   - the refs survive the composer's own validation path
 *
 * Each assertion is written so that removing the behaviour it covers makes it fail.
 * Tests that pass for the wrong reason have bitten this build repeatedly, so the
 * refusal cases assert the REASON, not merely that something was returned.
 */
import { describe, expect, it } from 'vitest';

import {
  PROMPT_ENHANCEMENT_ORIGINAL_TEXT_REF_MIN_LENGTH_V1,
  buildPromptEnhancementOriginalTextRefV1,
  buildPromptEnhancementPromptPointRefsV1,
  buildPromptEnhancementTransformReasonCodesV1,
  resolvePromptEnhancementOriginalTextRefV1,
  withPromptEnhancementCarriedFromPreviousBodyV1,
} from './original-text-refs.js';

describe('T2 carriers — a ref resolves to the exact characters it names', () => {
  it('resolves to the expected span of the original, character for character', () => {
    const originalPromptText = 'please add retry handling to the payment webhook before friday';
    const ref = buildPromptEnhancementOriginalTextRefV1({
      sectionId: 'sec-1',
      originalPromptText,
      sectionBodyText: 'Cover retry handling to the payment webhook with concrete steps.',
    });

    expect(ref.resolution).toBe('exact');
    // The done-when: a reader can resolve any ref to the exact characters it names.
    const resolved = resolvePromptEnhancementOriginalTextRefV1(ref, originalPromptText);
    expect(resolved).toBe(originalPromptText.slice(ref.startOffset, ref.endOffset));
    expect(resolved).toContain('retry handling to the payment webhook');
  });

  it('states the original section span rather than searching for it', () => {
    const originalPromptText = 'rename the column and backfill it';
    const ref = buildPromptEnhancementOriginalTextRefV1({
      sectionId: 'sec-original',
      originalPromptText,
      sectionBodyText: originalPromptText,
      quotedText: originalPromptText,
    });

    expect(ref.resolution).toBe('exact');
    expect(ref.startOffset).toBe(0);
    expect(ref.endOffset).toBe(originalPromptText.length);
    expect(resolvePromptEnhancementOriginalTextRefV1(ref, originalPromptText)).toBe(originalPromptText);
  });
});

describe('T2 carriers — an unresolvable ref is REFUSED, not dropped', () => {
  it('refuses with a reason when the section quotes nothing from the original', () => {
    const ref = buildPromptEnhancementOriginalTextRefV1({
      sectionId: 'sec-2',
      originalPromptText: 'add a nullable phone_number column',
      sectionBodyText: 'Use a reliable queue system such as RabbitMQ or AWS SQS.',
    });

    // Refused, and still PRESENT — a dropped ref would make this case
    // indistinguishable from a section that had nothing to quote.
    expect(ref.resolution).toBe('refused');
    expect(ref.refusalReason).toBe('not_found_in_original');
    expect(resolvePromptEnhancementOriginalTextRefV1(ref, 'add a nullable phone_number column')).toBeUndefined();
  });

  it('refuses an ambiguous quote rather than picking the first match', () => {
    // 'deploy the service' occurs twice, so no single span is "the exact characters".
    const originalPromptText = 'deploy the service then verify, and if it fails deploy the service again';
    const ref = buildPromptEnhancementOriginalTextRefV1({
      sectionId: 'sec-3',
      originalPromptText,
      sectionBodyText: 'You asked to deploy the service.',
      quotedText: 'deploy the service',
    });

    expect(ref.resolution).toBe('refused');
    expect(ref.refusalReason).toBe('ambiguous_multiple_matches');
  });

  it('refuses a shared run too short to be a real quote', () => {
    const shortQuote = 'x'.repeat(PROMPT_ENHANCEMENT_ORIGINAL_TEXT_REF_MIN_LENGTH_V1 - 1);
    const ref = buildPromptEnhancementOriginalTextRefV1({
      sectionId: 'sec-4',
      originalPromptText: `${shortQuote} and more text besides`,
      sectionBodyText: `something ${shortQuote} something`,
      quotedText: shortQuote,
    });

    expect(ref.resolution).toBe('refused');
    expect(ref.refusalReason).toBe('below_minimum_length');
  });

  it('does not resolve a ref whose offsets no longer match the original', () => {
    const originalPromptText = 'rotate the production database credentials';
    const ref = buildPromptEnhancementOriginalTextRefV1({
      sectionId: 'sec-5',
      originalPromptText,
      sectionBodyText: 'Rotate the production database credentials carefully.',
    });
    expect(ref.resolution).toBe('exact');

    // The original changed underneath the ref: offsets now run past its end.
    expect(resolvePromptEnhancementOriginalTextRefV1(ref, 'rotate')).toBeUndefined();
  });

  it('refuses to resolve a refused ref that still carries usable offsets', () => {
    // Builder-made refusals carry -1, so the offset guard alone would catch them. This is
    // the shape a HAND-WRITTEN fixture or a deserialized ref can have — refused, but with
    // offsets left on. continuation-packager-input.ts already hand-writes section fixtures,
    // so the resolution flag has to be authoritative on its own.
    const originalPromptText = 'restore the deleted migration file';
    const resolved = resolvePromptEnhancementOriginalTextRefV1(
      {
        refId: 'sec-8:otr:1',
        sectionId: 'sec-8',
        startOffset: 0,
        endOffset: 12,
        resolution: 'refused',
        refusalReason: 'ambiguous_multiple_matches',
      },
      originalPromptText,
    );

    expect(resolved).toBeUndefined();
  });

  it('refuses an empty prompt-point id instead of emitting a ref to nothing', () => {
    const refs = buildPromptEnhancementPromptPointRefsV1({
      sectionId: 'sec-6',
      promptPointIds: ['point-a', '   '],
    });

    expect(refs).toHaveLength(2);
    expect(refs[0]?.resolution).toBe('exact');
    expect(refs[1]?.resolution).toBe('refused');
    expect(refs[1]?.refusalReason).toBe('not_found_in_original');
  });
});

describe('T2 carriers — a carried-forward section says so, without losing its origin', () => {
  it('appends the carry code rather than replacing how the text was made', () => {
    const carried = withPromptEnhancementCarriedFromPreviousBodyV1(['composed_by_model', 'quotes_original_text']);

    expect(carried).toContain('carried_from_previous_body');
    // Substituting would lose the fact that this text was model-composed, which is
    // still true of the text and is a different fact from "it is being served again".
    expect(carried).toContain('composed_by_model');
    expect(carried).toContain('quotes_original_text');
  });

  it('is idempotent, so a body carried twice does not report two carries', () => {
    const once = withPromptEnhancementCarriedFromPreviousBodyV1(['preserved_verbatim']);
    const twice = withPromptEnhancementCarriedFromPreviousBodyV1(once);

    expect(twice.filter((code) => code === 'carried_from_previous_body')).toHaveLength(1);
    expect(twice).toEqual(once);
  });
});

describe('T2 carriers — transform reason codes report what composition actually did', () => {
  it('marks the original section preserved and reports that it quotes the original', () => {
    const originalPromptText = 'increase the worker pool size';
    const codes = buildPromptEnhancementTransformReasonCodesV1({
      isOriginalSection: true,
      wasComposedByModel: false,
      originalTextRef: buildPromptEnhancementOriginalTextRefV1({
        sectionId: 'sec-original',
        originalPromptText,
        sectionBodyText: originalPromptText,
        quotedText: originalPromptText,
      }),
    });

    expect(codes).toContain('preserved_verbatim');
    expect(codes).toContain('quotes_original_text');
    expect(codes).not.toContain('composed_by_model');
  });

  it('distinguishes a model-composed section from a deterministically rendered one', () => {
    const refusedRef = buildPromptEnhancementOriginalTextRefV1({
      sectionId: 'sec-7',
      originalPromptText: 'ship it',
      sectionBodyText: 'Nothing in common here whatsoever.',
    });

    const composed = buildPromptEnhancementTransformReasonCodesV1({
      isOriginalSection: false,
      wasComposedByModel: true,
      originalTextRef: refusedRef,
    });
    const deterministic = buildPromptEnhancementTransformReasonCodesV1({
      isOriginalSection: false,
      wasComposedByModel: false,
      originalTextRef: refusedRef,
    });

    expect(composed).toContain('composed_by_model');
    expect(deterministic).toContain('rendered_deterministically');
    // A section that quotes nothing says so, rather than staying silent about it.
    expect(composed).toContain('no_original_text_quoted');
  });
});
