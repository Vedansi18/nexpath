import { describe, expect, it } from 'vitest';
import { assembleContinuationPackagerInputV1 } from './continuation-packager-input.js';
import { packagePromptEnhancementSequenceContinuationV1 } from './sequence-packager.js';
import type {
  PromptEnhancementSafetySummaryV1,
  PromptEnhancementValidationGraphV1,
} from './contracts.js';
import type { PromptEnhancementSequenceItemV1 } from './sequence-payload.js';

/**
 * The item's own safety verdict. Its shape is the validator's business; the packager only reports it,
 * so a minimal cast fixture is enough here (this is test-only, never production).
 */
const ITEM_SAFETY = {
  sensitiveActionState: 'none_detected',
  validationStatus: 'valid',
} as unknown as PromptEnhancementSafetySummaryV1;

const GRAPH = { safetyState: ITEM_SAFETY } as unknown as PromptEnhancementValidationGraphV1;

/** A first_task at index 0 (already sent at intake — no wording, no graph). */
const firstTask = (): PromptEnhancementSequenceItemV1 => ({
  itemKind: 'first_task',
  originalSliceRef: { start: 0, end: 10 },
  sourcePointRanges: [],
  roleLabel: null,
  dependencyOrder: 0,
  complexity: 'not_complex',
  complexityReason: null,
  generatedWording: null,
  actionRiskKinds: [],
  authorityMode: 'plan_or_review',
  requiresConfirmationFloor: false,
  decompositionGroupId: 'g1',
  itemValidationGraph: null,
  itemSafetyClauseRef: null,
});

/** A servable task item at a given index with the given wording + original slice. */
const taskItem = (
  order: number,
  wording: string,
  originalSliceRef: PromptEnhancementSequenceItemV1['originalSliceRef'],
): PromptEnhancementSequenceItemV1 => ({
  itemKind: 'task',
  originalSliceRef,
  sourcePointRanges: [],
  roleLabel: null,
  dependencyOrder: order,
  complexity: 'not_complex',
  complexityReason: null,
  generatedWording: wording,
  actionRiskKinds: [],
  authorityMode: 'plan_or_review',
  requiresConfirmationFloor: false,
  decompositionGroupId: 'g1',
  itemValidationGraph: GRAPH,
  itemSafetyClauseRef: null,
});

/** A confirmation item — carries no original slice (`originalSliceRef` null). */
const confirmationItem = (
  order: number,
  wording: string,
): PromptEnhancementSequenceItemV1 => ({
  itemKind: 'binary_confirmation',
  originalSliceRef: null,
  sourcePointRanges: [],
  roleLabel: null,
  dependencyOrder: order,
  complexity: null,
  complexityReason: 'confirm before proceeding',
  generatedWording: wording,
  actionRiskKinds: [],
  authorityMode: null,
  requiresConfirmationFloor: false,
  decompositionGroupId: null,
  itemValidationGraph: GRAPH,
  itemSafetyClauseRef: null,
});

describe('assembleContinuationPackagerInputV1 — feeds the real packager', () => {
  it('packages a task item: the wording and the item’s own original slice', () => {
    const items = [firstTask(), taskItem(1, 'The wording of item 1.', { start: 2, end: 5 })];
    const packagerInput = assembleContinuationPackagerInputV1({
      items,
      currentItemIndex: 1,
      itemCount: 2,
      sequenceId: 'seq-1',
      enhancementId: 'enh-1',
      projectRoot: '/project',
      redactedOriginalPromptText: 'ABCDEFGHIJ',
      handoffKind: 'first_prompt_handoff_candidate',
    });

    const result = packagePromptEnhancementSequenceContinuationV1(packagerInput);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.packaged.result.currentBody.renderedPromptBody).toBe('The wording of item 1.');
    expect(result.packaged.result.currentBody.text).toBe('The wording of item 1.');
    // redactedOriginal='ABCDEFGHIJ', slice {2,5} -> 'CDE'
    expect(result.packaged.result.currentBody.originalPromptText).toBe('CDE');
    expect(result.packaged.itemKind).toBe('task');
    // itemCount 2 → item 0 sent at intake, one deliverable item remains: "1 of 1".
    expect(result.packaged.progress).toEqual({ done: 1, total: 1 });
  });

  it('re-points the original slice off the SERVED item, not a neighbour', () => {
    const items = [
      firstTask(),
      taskItem(1, 'Item one wording.', { start: 0, end: 2 }),
      taskItem(2, 'Item two wording.', { start: 5, end: 9 }),
    ];
    const packagerInput = assembleContinuationPackagerInputV1({
      items,
      currentItemIndex: 2,
      itemCount: 3,
      sequenceId: 'seq-1',
      enhancementId: 'enh-1',
      projectRoot: '/project',
      redactedOriginalPromptText: 'ABCDEFGHIJ',
      handoffKind: 'compact_sequence_summary_candidate',
    });

    const result = packagePromptEnhancementSequenceContinuationV1(packagerInput);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.packaged.result.currentBody.renderedPromptBody).toBe('Item two wording.');
    // slice {5,9} of 'ABCDEFGHIJ' -> 'FGHI'
    expect(result.packaged.result.currentBody.originalPromptText).toBe('FGHI');
    expect(result.packaged.itemKind).toBe('task');
  });

  it('packages a confirmation item: no original slice -> empty original text', () => {
    const items = [firstTask(), confirmationItem(1, 'Confirm you want to proceed. PASS/FAIL.')];
    const packagerInput = assembleContinuationPackagerInputV1({
      items,
      currentItemIndex: 1,
      itemCount: 2,
      sequenceId: 'seq-1',
      enhancementId: 'enh-1',
      projectRoot: '/project',
      redactedOriginalPromptText: 'ABCDEFGHIJ',
      handoffKind: 'first_prompt_handoff_candidate',
    });

    const result = packagePromptEnhancementSequenceContinuationV1(packagerInput);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.packaged.result.currentBody.renderedPromptBody).toBe('Confirm you want to proceed. PASS/FAIL.');
    expect(result.packaged.result.currentBody.originalPromptText).toBe('');
    expect(result.packaged.itemKind).toBe('binary_confirmation');
  });

  it('produces a continuable handoff kind the packager accepts (never refuses on kind)', () => {
    const items = [firstTask(), taskItem(1, 'Wording.', { start: 1, end: 4 })];
    const packagerInput = assembleContinuationPackagerInputV1({
      items,
      currentItemIndex: 1,
      itemCount: 2,
      sequenceId: 'seq-1',
      enhancementId: 'enh-1',
      projectRoot: '/project',
      redactedOriginalPromptText: 'ABCDEFGHIJ',
      handoffKind: 'first_prompt_handoff_candidate',
    });
    expect(packagerInput.acceptedResult.handoffMetadata?.handoffKind).toBe('first_prompt_handoff_candidate');
    // The continuation action set the packager keeps is present to survive the filter.
    const actionTypes = packagerInput.acceptedResult.availableActions.map((a) => a.actionType);
    expect(actionTypes).toContain('use_current_body');
    expect(actionTypes).toContain('close');
  });
});
