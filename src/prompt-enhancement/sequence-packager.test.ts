import { describe, expect, it } from 'vitest';
import {
  packagePromptEnhancementSequenceContinuationV1,
  type PromptEnhancementSequencePackagerInputV1,
} from './sequence-packager.js';
import { promptEnhancementSequenceTaskRoleLabelsV1 } from './sequence-payload.js';
import { promptEnhancementSequenceBatchExitActionV1 } from './sequence-batch-composer.js';
import type { PromptEnhancementSequenceItemV1 } from './sequence-payload.js';
import type {
  PromptEnhancementPrepareResultV1,
  PromptEnhancementValidationGraphV1,
} from './contracts.js';

/** The verdict the item carries. Its shape is the validator's business; the packager only reports. */
const GRAPH = { safetyState: {} } as unknown as PromptEnhancementValidationGraphV1;

const item = (
  order: number,
  overrides: Partial<PromptEnhancementSequenceItemV1> = {},
): PromptEnhancementSequenceItemV1 => ({
  itemKind: order === 0 ? 'first_task' : 'task',
  originalSliceRef: null,
  sourcePointRanges: [],
  roleLabel: null,
  dependencyOrder: order,
  complexity: 'not_complex',
  complexityReason: null,
  generatedWording: order === 0 ? null : `The wording of item ${order}.`,
  actionRiskKinds: [],
  authorityMode: 'plan_or_review',
  requiresConfirmationFloor: false,
  decompositionGroupId: 'g1',
  itemValidationGraph: order === 0 ? null : GRAPH,
  ...overrides,
});

/**
 * The result the accepted sequence was offered from. Only the fields the packager reads or swaps
 * matter here; everything else is carried through untouched and is not this test's subject.
 */
const ACCEPTED = {
  requestId: 'req-1',
  projectRoot: '/project',
  enhancementId: 'enh-1',
  currentBody: {
    currentBodyId: 'body-0',
    bodyRevision: 0,
    renderedPromptBody: 'The first prompt, already sent.',
    sentPromptOrigin: 'user_authored_original_only',
    nexpathGeneratedPromptRef: 'ref-0',
    originalPromptText: 'the original',
  },
  disposition: 'fallback_to_original',
  validationDecisionId: 'decision-for-the-first-body',
  composerBoundary: {
    composerRunId: 'run-0',
    sentPromptOrigin: 'user_authored_original_only',
    nexpathGeneratedPromptRef: 'ref-0',
  },
  safetySummary: { sensitiveActionState: 'confirmation_required' },
  handoffMetadata: {
    handoffKind: 'first_prompt_handoff_candidate',
    currentBodyId: 'body-0',
    bodyRevision: 0,
    currentBodyValidityState: 'invalid_due_body_revision',
    riskConfirmationState: 'none_detected',
    scope: { requestId: 'req-1', projectRoot: '/project' },
  },
  routeDecision: { routeId: 'route-1' },
  bodyPlan: { planId: 'plan-1' },
  validationGraph: { safetyState: { fromTheFirstBody: true } },
} as unknown as PromptEnhancementPrepareResultV1;

const input = (
  overrides: Partial<PromptEnhancementSequencePackagerInputV1> = {},
): PromptEnhancementSequencePackagerInputV1 => ({
  acceptedResult: ACCEPTED,
  items: [item(0), item(1), item(2), item(3)],
  currentItemIndex: 1,
  itemCount: 4,
  sequenceId: 'seq-1',
  sequenceItemId: 'seq-1:1',
  currentItemRevision: 0,
  bodyRevision: 1,
  currentBodyId: 'body-1',
  nexpathGeneratedPromptRef: 'ref-1',
  validationDecisionId: 'decision-for-item-1',
  composerRunId: 'run-batch',
  ...overrides,
});

describe('sequence packager — it reads, and that is all', () => {
  it('serves the stored wording unchanged', () => {
    const result = packagePromptEnhancementSequenceContinuationV1(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packaged.result.currentBody.renderedPromptBody).toBe('The wording of item 1.');
  });

  it('returns byte-identical text on a second reading, which is what the custom path needs', () => {
    // The user takes the custom-prompt path: the item stays pending and returns after their own
    // prompt and an agent response reach a later Stop. It has to come back unchanged, and it does
    // because there is no path here that could produce different text.
    const first = packagePromptEnhancementSequenceContinuationV1(input());
    const second = packagePromptEnhancementSequenceContinuationV1(input());
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.packaged.result.currentBody.renderedPromptBody)
      .toBe(first.packaged.result.currentBody.renderedPromptBody);
    // And a replayed event is harmless for the same reason: re-reading produces the same result.
    expect(second.packaged).toEqual(first.packaged);
  });

  it('carries the sequence\'s own route and plan through untouched', () => {
    // Route, plan and policy describe the sequence rather than any one item. Rebuilding them here
    // would be deciding them again at a Stop, which is composition under another name.
    const result = packagePromptEnhancementSequenceContinuationV1(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packaged.result.routeDecision).toBe(ACCEPTED.routeDecision);
    expect(result.packaged.result.bodyPlan).toBe(ACCEPTED.bodyPlan);
  });
});

describe('sequence packager — what it must never invent', () => {
  it('reports the item\'s own verdict rather than the first body\'s', () => {
    const result = packagePromptEnhancementSequenceContinuationV1(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packaged.result.validationGraph).toBe(GRAPH);
    expect(result.packaged.result.validationGraph).not.toBe(ACCEPTED.validationGraph);
  });

  it('refuses an item with no verdict rather than filling one in', () => {
    // Filling it in would assert a safety verdict nobody computed, on a body the user is one
    // keystroke from sending. That is worse than producing no popup.
    const items = [item(0), item(1, { itemValidationGraph: null }), item(2), item(3)];
    expect(packagePromptEnhancementSequenceContinuationV1(input({ items })))
      .toEqual({ ok: false, refusal: 'item_safety_verdict_missing' });
  });

  it('refuses an item with no wording rather than compensating for it', () => {
    // The row should already have been scrubbed. The packager must not answer that state by
    // composing, by skipping to the next item, or by serving an empty body.
    const items = [item(0), item(1, { generatedWording: null }), item(2), item(3)];
    expect(packagePromptEnhancementSequenceContinuationV1(input({ items })))
      .toEqual({ ok: false, refusal: 'item_wording_missing' });

    const blank = [item(0), item(1, { generatedWording: '   ' }), item(2), item(3)];
    expect(packagePromptEnhancementSequenceContinuationV1(input({ items: blank })))
      .toEqual({ ok: false, refusal: 'item_wording_missing' });
  });

  it('moves the identity that names THIS body with the body', () => {
    // The decision id is bound to the body id and the revision as a triple. Swapping two and
    // keeping the third leaves the result naming a decision the first prompt was cleared under.
    const result = packagePromptEnhancementSequenceContinuationV1(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packaged.result.validationDecisionId).toBe('decision-for-item-1');
    expect(result.packaged.result.validationDecisionId).not.toBe(ACCEPTED.validationDecisionId);
    // The batch produced this text; the accepted result's run wrote the first prompt.
    expect(result.packaged.result.currentBody.composerRunId).toBe('run-batch');
    expect(result.packaged.result.composerBoundary.composerRunId).toBe('run-batch');
  });

  it('keeps the two copies of the origin saying the same thing', () => {
    // It exists on the body and on the composer boundary. One updated and the other not is worse
    // than neither: whichever a reader consults decides whether a continuation re-enters the
    // planner, and nothing says which wins.
    const result = packagePromptEnhancementSequenceContinuationV1(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { currentBody, composerBoundary } = result.packaged.result;
    expect(composerBoundary.sentPromptOrigin).toBe(currentBody.sentPromptOrigin);
    expect(composerBoundary.sentPromptOrigin).toBe('sequence_handoff_owned_body');
    expect(composerBoundary.nexpathGeneratedPromptRef).toBe(currentBody.nexpathGeneratedPromptRef);
  });

  it('marks the body as sequence-owned, never as the user\'s', () => {
    // The one bit that says Nexpath wrote this. Marked as the user's, a continuation re-enters the
    // planner and plans a sequence out of our own writing.
    const result = packagePromptEnhancementSequenceContinuationV1(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packaged.result.currentBody.sentPromptOrigin).toBe('sequence_handoff_owned_body');
    expect(result.packaged.result.currentBody.nexpathGeneratedPromptRef).toBe('ref-1');
  });
});

describe('sequence packager — the index convention', () => {
  it('refuses index 0, which is the prompt already sent', () => {
    expect(packagePromptEnhancementSequenceContinuationV1(input({ currentItemIndex: 0 })))
      .toEqual({ ok: false, refusal: 'index_is_the_first_item' });
  });

  it('refuses an index past the end, and a count that disagrees with the list', () => {
    expect(packagePromptEnhancementSequenceContinuationV1(input({ currentItemIndex: 4 })))
      .toEqual({ ok: false, refusal: 'index_out_of_range' });
    expect(packagePromptEnhancementSequenceContinuationV1(input({ itemCount: 5 })))
      .toEqual({ ok: false, refusal: 'item_count_disagrees_with_items' });
  });

  it('serves the last item', () => {
    const result = packagePromptEnhancementSequenceContinuationV1(input({
      currentItemIndex: 3,
      sequenceItemId: 'seq-1:3',
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packaged.result.currentBody.renderedPromptBody).toBe('The wording of item 3.');
  });
});

describe('sequence packager — the progress the contract never carried', () => {
  it('reports items behind the current one, against the whole total', () => {
    // "done" is the index itself: 0-based, and index 0 was already sent at intake, so the count of
    // items already dealt with IS the index.
    for (const [index, done] of [[1, 1], [2, 2], [3, 3]] as const) {
      const result = packagePromptEnhancementSequenceContinuationV1(input({ currentItemIndex: index }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.packaged.progress).toEqual({ done, total: 4 });
    }
  });

  it('uses the whole item count, not the first popup\'s remaining figure', () => {
    // The remaining count is fixed at items.length - 1 on the first popup. Giving it a second,
    // live meaning here is the overload that produced the item-count defect.
    const result = packagePromptEnhancementSequenceContinuationV1(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packaged.progress.total).toBe(4);
    expect(result.packaged.progress.total).not.toBe(3);
  });
});

describe('sequence packager — the event it emits', () => {
  it('agrees with the body it is shown beside, and scopes to the same request', () => {
    const result = packagePromptEnhancementSequenceContinuationV1(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { event, result: packagedResult } = result.packaged;
    // The popup refuses unless the revisions match and the scope agrees.
    expect(event.bodyRevision).toBe(packagedResult.currentBody.bodyRevision);
    expect(event.requestId).toBe(packagedResult.requestId);
    expect(event.projectScope).toBe(packagedResult.projectRoot);
    expect(event.sequenceId).toBe('seq-1');
    expect(event.sequenceItemId).toBe('seq-1:1');
    expect(event.currentItemIndex).toBe(1);
    expect(event.contractVersion).toBe(1);
  });

  it('says a Stop is a decision point and not proof the item finished', () => {
    // Nothing in the system can supply that proof, which is why the value name carries the
    // disclaimer rather than the assumption.
    const result = packagePromptEnhancementSequenceContinuationV1(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packaged.event.stopEventState).toBe('stop_fired_non_proof');
    expect(result.packaged.event.stateFreshness).toBe('current');
    expect(result.packaged.event.continuationActionState).toBe('continue_current_item');
    expect(result.packaged.event.terminalTransitionState).toBe('none');
  });
});

describe('sequence role labels — one derivation, two readers', () => {
  it('is the set the items carry, in first-appearance order', () => {
    // The closure used to be structural: the old producer could only pick from a fixed table. A
    // model producing them removes that, and the shipped type is readonly string[] — it never
    // protected anything. Deriving both lists from the items is what keeps one check covering both.
    expect(promptEnhancementSequenceTaskRoleLabelsV1([
      { roleLabel: 'fix' },
      { roleLabel: null },
      { roleLabel: 'review' },
      { roleLabel: 'fix' },
    ])).toEqual(['fix', 'review']);
    expect(promptEnhancementSequenceTaskRoleLabelsV1([{ roleLabel: null }])).toEqual([]);
  });
});

describe('sequence packager — the handoff metadata it must produce', () => {
  it('re-points the two fields it is validated against', async () => {
    // It is checked AGAINST the current body — id and revision compared — and the packager swaps
    // both. Carrying the accepted sequence's own metadata across therefore mismatches by
    // construction, however much it looks like the cheap option.
    const result = packagePromptEnhancementSequenceContinuationV1(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { handoffMetadata, result: packaged } = result.packaged;
    expect(handoffMetadata.currentBodyId).toBe(packaged.currentBody.currentBodyId);
    expect(handoffMetadata.bodyRevision).toBe(packaged.currentBody.bodyRevision);
    // The accepted one would not have matched, which is the whole reason this exists.
    expect(ACCEPTED.handoffMetadata?.currentBodyId).not.toBe(packaged.currentBody.currentBodyId);
    // Valid because those two lines just made it so, for this revision.
    expect(handoffMetadata.currentBodyValidityState).toBe('valid_for_current_body_revision');
    // A carry, not a computation: the risk state comes from the safety summary it accompanies.
    expect(handoffMetadata.riskConfirmationState).toBe('confirmation_required');
  });

  it('refuses a sequence it cannot continue rather than emitting metadata the popup rejects', () => {
    const noMetadata = { ...ACCEPTED, handoffMetadata: undefined } as PromptEnhancementPrepareResultV1;
    expect(packagePromptEnhancementSequenceContinuationV1(input({ acceptedResult: noMetadata })))
      .toEqual({ ok: false, refusal: 'accepted_result_has_no_handoff_metadata' });

    const wrongKind = {
      ...ACCEPTED,
      handoffMetadata: { ...ACCEPTED.handoffMetadata, handoffKind: 'metadata_only' },
    } as unknown as PromptEnhancementPrepareResultV1;
    expect(packagePromptEnhancementSequenceContinuationV1(input({ acceptedResult: wrongKind })))
      .toEqual({ ok: false, refusal: 'handoff_kind_not_continuable' });
  });

  it('says the result is showing the current body', () => {
    // The accepted result's disposition was a decision about a different body; left as it was,
    // every continuation is refused at the popup boundary.
    const result = packagePromptEnhancementSequenceContinuationV1(input());
    expect(ACCEPTED.disposition).not.toBe('show_current_body');
    expect(result.ok && result.packaged.result.disposition).toBe('show_current_body');
  });
});

describe('sequence batch — what happens to it when the popup is left', () => {
  it('awaits on send and discards on every way out', () => {
    // On send the wording is about to be persisted and the exit path force-exits after the write,
    // so an un-awaited batch is killed silently. On a close nothing is stored but the disposition
    // stub, and awaiting anyway turns Escape at second three into a twenty-second hang.
    expect(promptEnhancementSequenceBatchExitActionV1('user_sends')).toBe('await_batch_before_exit');
    for (const exit of ['popup_closed', 'escape', 'use_original'] as const) {
      expect(promptEnhancementSequenceBatchExitActionV1(exit)).toBe('discard_batch');
    }
  });
});
