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
  PromptEnhancementSafetySummaryV1,
  PromptEnhancementValidationGraphV1,
} from './contracts.js';

/** The item's own safety verdict, deliberately different from the first body's. */
const ITEM_SAFETY = {
  sensitiveActionState: 'none_detected',
  validationStatus: 'valid',
} as unknown as PromptEnhancementSafetySummaryV1;

/** The verdict the item carries. Its shape is the validator's business; the packager only reports. */
const GRAPH = {
  safetyState: ITEM_SAFETY,
} as unknown as PromptEnhancementValidationGraphV1;

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
  itemSafetyClauseRef: null,
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
    text: 'The first prompt, already sent.',
    sentPromptOrigin: 'user_authored_original_only',
    nexpathGeneratedPromptRef: 'ref-0',
    originalPromptText: 'the original',
    generatedOriginState: 'user_original',
    userDirtyState: 'dirty_user_edited',
    generatedSafeStatus: 'invalid_non_sendable',
  },
  disposition: 'fallback_to_original',
  validationDecisionId: 'decision-for-the-first-body',
  composerBoundary: {
    composerRunId: 'run-0',
    sentPromptOrigin: 'user_authored_original_only',
    nexpathGeneratedPromptRef: 'ref-0',
    renderedPromptBody: 'The first prompt, already sent.',
  },
  safetySummary: { sensitiveActionState: 'confirmation_required' },
  handoffMetadata: {
    handoffDecisionId: 'enh-1:handoff',
    compactFirstPopupSequenceSummary: {
      summaryId: 'body-0:summary', currentBodyId: 'body-0', bodyRevision: 0,
      publicSafeText: 'planned as 4 prompts',
    },
    handoffKind: 'first_prompt_handoff_candidate',
    currentBodyId: 'body-0',
    bodyRevision: 0,
    currentBodyValidityState: 'invalid_due_body_revision',
    riskConfirmationState: 'none_detected',
    scope: { requestId: 'req-1', projectRoot: '/project' },
  },
  availableActions: [
    { actionType: 'use_current_body', label: 'Use this prompt', currentBodyId: 'body-0', bodyRevision: 0 },
    { actionType: 'shorter', label: 'Shorter', currentBodyId: 'body-0', bodyRevision: 0 },
    { actionType: 'apply_details', label: 'Apply details', currentBodyId: 'body-0', bodyRevision: 0 },
    { actionType: 'more_thorough', label: 'More thorough', currentBodyId: 'body-0', bodyRevision: 0 },
    { actionType: 'use_original', label: 'Use original', currentBodyId: 'body-0', bodyRevision: 0 },
    { actionType: 'close', label: 'Close', currentBodyId: 'body-0', bodyRevision: 0 },
  ],
  generatedOrigin: {
    generatedOriginId: 'origin-0',
    generatedOriginState: 'user_original',
    bodyId: 'body-0',
    bodyRevision: 0,
    sourceUseIds: ['body-0:use'],
    echoRecursionGuard: {
      sourcePromptEchoState: 'not_echo',
      lastInjectedPromptIsAuthority: false,
      bodyFingerprintRef: 'body-0:fingerprint',
    },
  },
  uiView: {
    body: {
      text: 'The first prompt, already sent.',
      currentBodyId: 'body-0',
      bodyRevision: 0,
      generatedOriginState: 'user_original',
      dirtyState: 'dirty_user_edited',
    },
    actions: [
      { actionType: 'use_current_body', currentBodyId: 'body-0', bodyRevision: 0 },
      { actionType: 'shorter', currentBodyId: 'body-0', bodyRevision: 0 },
      { actionType: 'apply_details', currentBodyId: 'body-0', bodyRevision: 0 },
      { actionType: 'close', currentBodyId: 'body-0', bodyRevision: 0 },
    ],
    actionInputContract: { currentBodyId: 'body-0', bodyRevision: 0, actionId: 'act-0' },
    handoffAndSequenceSummary: { currentBodyId: 'body-0' },
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
  handoffDecisionId: 'handoff-for-item-1',
  itemBodyFingerprintRef: 'body-1:fingerprint',
  itemSourceUseIds: ['body-1:use'],
  compactSummaryId: 'body-1:summary',
  ...overrides,
});

describe('sequence packager — it reads, and that is all', () => {
  it('serves the stored wording unchanged', () => {
    const result = packagePromptEnhancementSequenceContinuationV1(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packaged.result.currentBody.renderedPromptBody).toBe('The wording of item 1.');
  });

  it('MPS-12: re-points originalPromptText to the item\'s original SLICE, not the whole prompt', () => {
    const accepted = { ...ACCEPTED, currentBody: { ...ACCEPTED.currentBody, originalPromptText: 'ABCDEFGHIJ' } };
    const sliced = packagePromptEnhancementSequenceContinuationV1(input({
      acceptedResult: accepted,
      items: [item(0), item(1, { originalSliceRef: { start: 2, end: 5 } }), item(2), item(3)],
    }));
    expect(sliced.ok).toBe(true);
    if (!sliced.ok) return;
    // The item's slice (chars 2..5 of the whole), NOT the whole 'ABCDEFGHIJ'.
    expect(sliced.packaged.result.currentBody.originalPromptText).toBe('CDE');
    expect(sliced.packaged.itemKind).toBe('task');
    // A missing sliceRef (default item) → empty original, never the whole prompt.
    const empty = packagePromptEnhancementSequenceContinuationV1(input({ acceptedResult: accepted }));
    if (!empty.ok) return;
    expect(empty.packaged.result.currentBody.originalPromptText).toBe('');
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
  it('reports the item position against the deliverable-item count', () => {
    // "done" is currentItemIndex: 0-based, and index 0 was already sent at intake, so the count of
    // items already dealt with IS the index — which is also its 1-based position among the
    // deliverable (continuation) items. "total" is the deliverable count (itemCount - 1), so the
    // last item reads "N of N" (owner decision 2026-08-17).
    for (const [index, done] of [[1, 1], [2, 2], [3, 3]] as const) {
      const result = packagePromptEnhancementSequenceContinuationV1(input({ currentItemIndex: index }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.packaged.progress).toEqual({ done, total: 3 });
    }
  });

  it('counts the deliverable items only (itemCount - 1), not the whole item count', () => {
    // Item 0 was already sent at intake, so the continuation surface excludes it: total is the
    // deliverable count (itemCount - 1 = 3 here), matching the first popup's "Total" figure. It
    // is derived straight from itemCount, never from the summary's fixed remaining variable — the
    // overload that produced the earlier item-count defect (owner decision 2026-08-17).
    const result = packagePromptEnhancementSequenceContinuationV1(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packaged.progress.total).toBe(3);
    expect(result.packaged.progress.total).not.toBe(4);
  });
});

describe('sequence packager — the floor position travels with the body', () => {
  const REF = { start: 4, end: 11 };

  it('emits the served item\'s position, not another item\'s', () => {
    // The check that reads it resolves it against the body this call served. Left for the caller to
    // fetch, it would be fetched by an index that is 0-based with item 0 excluded — the one offset
    // this function exists to apply — and one off resolves a plausible span over unrelated text.
    const items = [
      item(0),
      item(1, { requiresConfirmationFloor: true, itemSafetyClauseRef: REF }),
      item(2),
      item(3),
    ];
    const served = packagePromptEnhancementSequenceContinuationV1(input({ items, currentItemIndex: 1 }));
    expect(served.ok).toBe(true);
    if (!served.ok) return;
    expect(served.packaged.safetyClauseRef).toEqual(REF);
    // And the neighbour, packaged from the same list, carries its own answer rather than that one.
    const other = packagePromptEnhancementSequenceContinuationV1(input({ items, currentItemIndex: 2 }));
    expect(other.ok && other.packaged.safetyClauseRef).toBeNull();
  });

  it('resolves against the body it is emitted with', () => {
    // The two come off the same item, so this holds by construction — which is the point of
    // emitting them together rather than leaving them to be matched up later.
    const items = [item(0), item(1, { requiresConfirmationFloor: true, itemSafetyClauseRef: REF }), item(2), item(3)];
    const result = packagePromptEnhancementSequenceContinuationV1(input({ items, currentItemIndex: 1 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ref = result.packaged.safetyClauseRef;
    expect(ref).not.toBeNull();
    expect(result.packaged.result.currentBody.text.slice(ref?.start ?? 0, ref?.end ?? 0))
      .toBe('wording');
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
    // A carry, not a computation — and from the item's own summary, since the metadata describes
    // the item's body. The first body's verdict is a different body's answer.
    expect(handoffMetadata.riskConfirmationState).toBe('none_detected');
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

describe('sequence packager — the actions a continuation actually has', () => {
  it('drops the re-plan actions rather than carrying the first popup list', () => {
    // Two of them are full re-plans, and a continuation is past activation where an item is never
    // regenerated. Carried, the result advertises on a frozen sequence the two actions whose whole
    // effect is to unfreeze it.
    expect(ACCEPTED.availableActions.map((a) => a.actionType))
      .toContain('shorter');
    const result = packagePromptEnhancementSequenceContinuationV1(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packaged.result.availableActions.map((action) => action.actionType))
      .toEqual(['use_current_body', 'close']);
  });

  it('re-points the entries it keeps at the body they now belong to', () => {
    // Each entry carries the body id and revision it was built for, so a carried entry points at
    // the previous body even when its type is still offered.
    const result = packagePromptEnhancementSequenceContinuationV1(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const action of result.packaged.result.availableActions) {
      expect(action.currentBodyId).toBe('body-1');
      expect(action.bodyRevision).toBe(1);
    }
  });
});

describe('sequence packager — one verdict, one metadata', () => {
  it('reports the item safety verdict in all three fields, never a mix', () => {
    // The graph alone, set beside the first body summaries, gives a result whose graph describes
    // one body and whose summaries describe another - a safety claim nobody made about this body,
    // arrived at by mixing rather than by inventing.
    const result = packagePromptEnhancementSequenceContinuationV1(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const packaged = result.packaged.result;
    expect(packaged.validationGraph).toBe(GRAPH);
    expect(packaged.safetySummary).toBe(ITEM_SAFETY);
    expect(packaged.validationSummary).toBe(ITEM_SAFETY);
    expect(packaged.safetySummary).not.toBe(ACCEPTED.safetySummary);
    // And the handoff risk state comes from the item verdict, not the first body one.
    expect(result.packaged.handoffMetadata.riskConfirmationState).toBe('none_detected');
    expect(ACCEPTED.safetySummary.sensitiveActionState).toBe('confirmation_required');
  });

  it('puts the same metadata object on the result as it returns beside it', () => {
    // Two copies pointing at different bodies is the failure this pass kept finding: the popup
    // validates the separate one and passes, while anything reading the result gets the old one.
    const result = packagePromptEnhancementSequenceContinuationV1(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packaged.result.handoffMetadata).toBe(result.packaged.handoffMetadata);
    expect(result.packaged.result.handoffMetadata?.currentBodyId).toBe('body-1');
  });
});

describe('sequence packager — the origin row has three entries', () => {
  it('re-points the generated-origin metadata with the body and the echo guard', () => {
    // The two string fields on the body and the boundary were done first; this is the third entry
    // in the same row, and the one carrying the echo guard - a body Nexpath wrote, still described
    // as the first prompt origin, is the same bit read from a different place and answered
    // differently.
    const result = packagePromptEnhancementSequenceContinuationV1(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { generatedOrigin, currentBody } = result.packaged.result;
    expect(generatedOrigin.bodyId).toBe(currentBody.currentBodyId);
    expect(generatedOrigin.bodyRevision).toBe(currentBody.bodyRevision);
    expect(generatedOrigin.generatedOriginState).toBe('pe_generated_body');
    expect(generatedOrigin.echoRecursionGuard.sourcePromptEchoState).toBe('pe_generated_echo');
    // The accepted result said the opposite of all four, which is what makes this test mean something.
    expect(ACCEPTED.generatedOrigin.generatedOriginState).toBe('user_original');
    expect(ACCEPTED.generatedOrigin.echoRecursionGuard.sourcePromptEchoState).toBe('not_echo');
  });

  it('agrees with the other two entries in that row', () => {
    const result = packagePromptEnhancementSequenceContinuationV1(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { generatedOrigin, currentBody, composerBoundary } = result.packaged.result;
    // Three places, one answer: this body was written by Nexpath, as part of a sequence.
    expect(currentBody.sentPromptOrigin).toBe('sequence_handoff_owned_body');
    expect(composerBoundary.sentPromptOrigin).toBe('sequence_handoff_owned_body');
    expect(generatedOrigin.generatedOriginState).toBe('pe_generated_body');
  });
});

describe('sequence packager — the handoff metadata is about THIS body too', () => {
  it('takes the handoff decision for this body rather than the first popup one', () => {
    // One decision is made once, about the body the sequence was offered from. Carried onto every
    // continuation it becomes this item evidence: four references to a decision made about none of
    // them.
    const result = packagePromptEnhancementSequenceContinuationV1(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packaged.handoffMetadata.handoffDecisionId).toBe('handoff-for-item-1');
    expect(ACCEPTED.handoffMetadata?.handoffDecisionId).toBe('enh-1:handoff');
  });

  it('re-points the compact summary rather than dropping it', () => {
    // I dropped it once, on the strength of its name and the fact that only the first popup reads
    // it. The contract requires it for exactly the two handoff kinds a continuation carries, so
    // dropping it failed the metadata outright — and the end-to-end popup test is what said so.
    // It is bound metadata; what that surface renders is the progress pair, which is separate.
    const result = packagePromptEnhancementSequenceContinuationV1(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const summary = result.packaged.handoffMetadata.compactFirstPopupSequenceSummary;
    expect(summary?.currentBodyId).toBe('body-1');
    expect(summary?.bodyRevision).toBe(1);
    expect(ACCEPTED.handoffMetadata?.compactFirstPopupSequenceSummary?.currentBodyId).toBe('body-0');
    // What that surface actually shows is the progress pair.
    expect(result.packaged.progress).toEqual({ done: 1, total: 3 });
  });

  it('sets all THREE copies of the body text, which sit in two objects', () => {
    // The body carries its text twice and the composer boundary keeps a third. The first two are
    // required to be equal, so missing one served the wrong prompt outright; the third is invisible
    // to the popup and wrong quietly — the record of what the composer produced describing a
    // different prompt, under a run id pointing at the batch.
    const result = packagePromptEnhancementSequenceContinuationV1(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { currentBody, composerBoundary } = result.packaged.result;
    expect(currentBody.renderedPromptBody).toBe('The wording of item 1.');
    expect(currentBody.text).toBe(currentBody.renderedPromptBody);
    expect(composerBoundary.renderedPromptBody).toBe(currentBody.renderedPromptBody);
  });

});

describe('sequence packager — the origin bit lives in four places', () => {
  it('says the same thing in all four, and does not inherit the other two beside it', () => {
    // Nothing type-checks the difference: the completeness check asks only that each is a string,
    // so three states describing the wrong body pass every check the popup runs.
    const result = packagePromptEnhancementSequenceContinuationV1(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { currentBody, composerBoundary, generatedOrigin } = result.packaged.result;
    expect(currentBody.sentPromptOrigin).toBe('sequence_handoff_owned_body');
    expect(composerBoundary.sentPromptOrigin).toBe('sequence_handoff_owned_body');
    expect(generatedOrigin.generatedOriginState).toBe('pe_generated_body');
    expect(currentBody.generatedOriginState).toBe('pe_generated_body');

    // Nobody has touched this body: it has not been shown yet. Inherited, it claims the user
    // edited a prompt they have not seen - on the field the never-interfere ruling turns on.
    expect(ACCEPTED.currentBody.userDirtyState).toBe('dirty_user_edited');
    expect(currentBody.userDirtyState).toBe('clean');

    // And the status this body was cleared under, not the one the first prompt was.
    // Read out of THIS item's verdict rather than supplied beside it, so a body cannot be served
    // under a status that belongs to some other run.
    expect(ACCEPTED.currentBody.generatedSafeStatus).toBe('invalid_non_sendable');
    expect(currentBody.generatedSafeStatus).toBe('valid');
    expect(currentBody.generatedSafeStatus).toBe(GRAPH.safetyState.validationStatus);
  });
});

describe('sequence packager — the view a UI actually renders from', () => {
  it('shows this item, not the prompt already sent', () => {
    // A fifth copy of the body text, and the one a renderer is meant to trust. The continuation
    // popup escapes it only by taking its text from the body instead.
    const result = packagePromptEnhancementSequenceContinuationV1(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { uiView, currentBody } = result.packaged.result;
    expect(uiView.body.text).toBe(currentBody.renderedPromptBody);
    expect(uiView.body.currentBodyId).toBe('body-1');
    expect(uiView.body.bodyRevision).toBe(1);
    expect(uiView.body.generatedOriginState).toBe('pe_generated_body');
    expect(uiView.body.dirtyState).toBe('clean');
  });

  it('offers the continuation actions here too, not the first popup ones', () => {
    // I filtered one list and left its twin, in the copy that would actually reach a user.
    const result = packagePromptEnhancementSequenceContinuationV1(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { uiView, availableActions } = result.packaged.result;
    expect(uiView.actions.map((action) => action.actionType)).toEqual(['use_current_body', 'close']);
    expect(uiView.actions).toEqual(availableActions);
    expect(uiView.actionInputContract.currentBodyId).toBe('body-1');
  });

  it('carries one handoff metadata in all three places it appears', () => {
    const result = packagePromptEnhancementSequenceContinuationV1(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { handoffMetadata } = result.packaged;
    expect(result.packaged.result.handoffMetadata).toBe(handoffMetadata);
    expect(result.packaged.result.uiView.handoffAndSequenceSummary).toBe(handoffMetadata);
  });
});
