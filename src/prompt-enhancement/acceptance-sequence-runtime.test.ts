/**
 * Acceptance executor — batch 1: the runtime fixtures the body producer alone can drive.
 *
 * Each `it` is a backing test named for the fixture it runs (`test:${fixtureId}`), the reproducible
 * evidence the acceptance register points at. It drives the BUILT-AHEAD runtime end to end and asserts
 * the fixture's mandatory safeguards and its hard-fail focus. It does NOT mark the register fixture as
 * passing: `actualResult` stays `not_run_shape_only`, the owner oracle judges readiness. This produces
 * the evidence that judgment reads.
 */
import { describe, expect, it } from 'vitest';
import { runPromptEnhancementSequenceBodyProducerV1 } from './sequence-body-producer-runtime.js';
import { promptEnhancementSequenceBatchDispositionV1 } from './sequence-batch-composer.js';
import { PROMPT_ENHANCEMENT_SEQUENCE_MAX_ITEM_COUNT_V1 } from './sequence-runtime.js';
import type { PromptEnhancementSequenceItemV1 } from './sequence-payload.js';
import type { PromptEnhancementSequencePlannerClientV1 } from './sequence-planner.js';
import type { PromptEnhancementSafetySummaryV1 } from './contracts.js';

const ORIGINAL = 'Fix the failing payment test, then add a rate limiter to the login endpoint.';
const SLICE_ONE = 'Fix the failing payment test';
const SLICE_TWO = 'add a rate limiter to the login endpoint';

const BASE_SAFETY = {
  validationStatus: 'valid',
  sendPolicy: 'send_current',
  sensitiveActionState: 'none',
  sourceHonestyState: 'valid',
  privacyState: 'valid',
  authorityEscalationState: 'valid',
  noForegroundSafer: true,
  noAutomaticSend: true,
} as const satisfies PromptEnhancementSafetySummaryV1;

function task(index: number, sliceText: string): PromptEnhancementSequenceItemV1 {
  const start = ORIGINAL.indexOf(sliceText);
  return {
    itemKind:                  'task',
    originalSliceRef:          { start, end: start + sliceText.length },
    sourcePointRanges:         [],
    roleLabel:                 'fix',
    dependencyOrder:           index,
    complexity:                'not_complex',
    complexityReason:          null,
    generatedWording:          null,
    actionRiskKinds:           [],
    authorityMode:             'plan_or_review',
    requiresConfirmationFloor: false,
    decompositionGroupId:      'g1',
    itemValidationGraph:       null,
    itemSafetyClauseRef:       null,
  };
}

function firstTask(): PromptEnhancementSequenceItemV1 {
  return { ...task(0, SLICE_ONE), itemKind: 'first_task', originalSliceRef: { start: 0, end: ORIGINAL.length } };
}

function input(plannerItems: readonly PromptEnhancementSequenceItemV1[]) {
  return {
    plannerItems,
    planGenerationId: 'plan-1',
    firstBodyText: 'The first prompt, already written.',
    promptDirectives: [],
    localOriginalText: ORIGINAL,
    baseSafetySummary: BASE_SAFETY,
    providerRuntimeState: 'deterministic' as const,
    optionalCallAvailabilityState: 'deterministic_only' as const,
    sequenceItemIdFor: (order: number) => `seq-1:item-${order}`,
  };
}

const clientReturning = (reply: string): PromptEnhancementSequencePlannerClientV1 => ({
  chat: { completions: { create: async () => ({ choices: [{ message: { content: reply } }] }) } },
} as unknown as PromptEnhancementSequencePlannerClientV1);

const rejectingClient = (error: Error): PromptEnhancementSequencePlannerClientV1 => ({
  chat: { completions: { create: async () => { throw error; } } },
} as unknown as PromptEnhancementSequencePlannerClientV1);

type ConfirmationKind = 'double_confirmation' | 'cross_confirmation' | 'binary_confirmation';

function confirmation(index: number, kind: ConfirmationKind): PromptEnhancementSequenceItemV1 {
  return {
    ...task(index, SLICE_TWO),
    itemKind: kind,
    originalSliceRef: null,
    complexity: null,
    complexityReason: 'why this one',
    authorityMode: null,
    roleLabel: null,
    requiresConfirmationFloor: false,
  };
}

const binaryWording = (question: string): string =>
  `${question}\n\nReply YES or NO only, on its own line with nothing after it, and only if you are`
  + ' clear and sure at ground level. Do not make any assumptions — confirm at ground level by'
  + ' reading the actual source.';

const passFailWording = (question: string): string =>
  `${question}\n\nReply PASS or FAIL only, on its own line with nothing after it, and only if you`
  + ' are clear and sure at ground level. Do not make any assumptions — confirm at ground level by'
  + ' reading the actual source.';

// Drive the body producer over a task + a confirmation, the confirmation worded as given.
const withConfirmation = (wording: string, kind: ConfirmationKind = 'binary_confirmation') =>
  runPromptEnhancementSequenceBodyProducerV1(
    input([firstTask(), task(1, SLICE_ONE), confirmation(2, kind)]),
    clientReturning(JSON.stringify({ items: [
      { dependencyOrder: 1, wording: `${SLICE_ONE}\n\nDo the first half.` },
      { dependencyOrder: 2, wording },
    ] })),
  );

describe('acceptance executor (batch 1) — body-producer runtime fixtures', () => {
  it('test:acceptance-sequence-provider-failure-no-generated-content', async () => {
    const result = await runPromptEnhancementSequenceBodyProducerV1(
      input([firstTask(), task(1, SLICE_TWO)]),
      rejectingClient(new Error('network down')),
    );
    // A call that could not be made is a fault the waiting user is told about.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe('batch');
    expect(['no_key', 'provider_error', 'timeout']).toContain(result.reason);
    // no_generated_sequence_content + not_the_validation_retry_path: it routes to a public-safe error
    // popup with no content, never the repair loop.
    expect(promptEnhancementSequenceBatchDispositionV1(result.reason)).toBe('error_popup_no_generated_content');
  });

  it('test:acceptance-sequence-max-item-count-complete-batch', async () => {
    // item_count cap is the shipping constant, never a literal in the register.
    expect(PROMPT_ENHANCEMENT_SEQUENCE_MAX_ITEM_COUNT_V1).toBe(30);

    // every_planned_item_has_wording: a complete reply words every non-first item.
    const complete = await runPromptEnhancementSequenceBodyProducerV1(
      input([firstTask(), task(1, SLICE_ONE), task(2, SLICE_TWO)]),
      clientReturning(JSON.stringify({ items: [
        { dependencyOrder: 1, wording: `${SLICE_ONE}\n\nDo the first half, and keep the change small.` },
        { dependencyOrder: 2, wording: `${SLICE_TWO}\n\nDo the second half at the edge.` },
      ] })),
    );
    expect(complete.ok).toBe(true);
    if (complete.ok) {
      expect(complete.items.slice(1).every((item) => (item.generatedWording ?? '').length > 0)).toBe(true);
    }

    // truncated_batch_is_invalid_not_degraded: a reply missing an item is rejected, not accepted as a
    // shorter sequence.
    const truncated = await runPromptEnhancementSequenceBodyProducerV1(
      input([firstTask(), task(1, SLICE_ONE), task(2, SLICE_TWO)]),
      clientReturning(JSON.stringify({ items: [
        { dependencyOrder: 1, wording: `${SLICE_ONE}\n\nDo the first half.` },
      ] })),
    );
    expect(truncated.ok).toBe(false);
    if (!truncated.ok) expect(truncated.stage).toBe('batch');
  });
});

describe('acceptance executor (batch 3) — composer confirmation-format fixtures', () => {
  it('test:acceptance-sequence-binary-confirmation-token-set', async () => {
    // token_set_is_a_total_function_of_the_item_kind: a binary_confirmation carries YES/NO.
    expect((await withConfirmation(binaryWording('Does the limiter reject the 61st request?'), 'binary_confirmation')).ok)
      .toBe(true);
    // The wrong token set for the kind is refused, not reformatted.
    const wrongToken = await withConfirmation(passFailWording('Does the limiter reject the 61st request?'), 'binary_confirmation');
    expect(wrongToken.ok).toBe(false);
    if (!wrongToken.ok) expect(wrongToken.reason).toBe('confirmation_format_wrong_for_kind');
    // And the binary token set is wrong for a double_confirmation, which carries PASS/FAIL.
    const wrongKind = await withConfirmation(binaryWording('Was it checked?'), 'double_confirmation');
    expect(wrongKind.ok).toBe(false);
    if (!wrongKind.ok) expect(wrongKind.reason).toBe('confirmation_format_wrong_for_kind');
  });

  it('test:acceptance-sequence-confirmation-three-mandatory-parts', async () => {
    // A confirmation carrying all three mandatory parts in its kind's format is accepted.
    expect((await withConfirmation(binaryWording('Does the limiter reject the 61st request?'))).ok).toBe(true);
    // One that never demands the answer stand alone is refused — a mandatory part is missing.
    const noDemand = 'Does the limiter reject the 61st request?\n\nReply YES or NO only. Give the'
      + ' answer and nothing else, and only if you are clear and sure at ground level. Do not make any'
      + ' assumptions — confirm at ground level by reading the actual source.';
    const missing = await withConfirmation(noDemand);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toBe('confirmation_missing_answer_alone_demand');
  });
});
