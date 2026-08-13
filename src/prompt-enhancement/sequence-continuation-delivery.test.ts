import { describe, expect, it } from 'vitest';
import {
  prepareSequenceContinuationOfferV1,
  deliverSequenceContinuationOutcomeV1,
  packageSequenceContinuationOfferV1,
  buildContinuationPopupFromPackageV1,
  checkContinuationSendEditV1,
} from './sequence-continuation-delivery.js';
import type { PromptEnhancementSequenceRuntimeStateV1 } from './sequence-runtime.js';
import { packagePromptEnhancementSequenceContinuationV1, type PromptEnhancementSequencePackagerInputV1 } from './sequence-packager.js';
import { buildPromptEnhancementMpsContinuationPopupV1 } from './continuation-popup.js';
import type { PromptEnhancementSequenceItemV1 } from './sequence-payload.js';
import type {
  PromptEnhancementPrepareResultV1,
  PromptEnhancementSafetySummaryV1,
  PromptEnhancementValidationGraphV1,
} from './contracts.js';

function state(
  overrides: Partial<PromptEnhancementSequenceRuntimeStateV1> = {},
): PromptEnhancementSequenceRuntimeStateV1 {
  return {
    sequenceId: 'seq-1', enhancementId: 'enh-1', projectRoot: '/tmp/p', sessionId: 's1',
    itemCount: 3, currentItemIndex: 0, status: 'awaiting_response', lastActionId: null,
    ...overrides,
  };
}

describe('continuation offer step', () => {
  it('awaiting_response advances to OFFER the next item (never sends)', () => {
    const offer = prepareSequenceContinuationOfferV1(state(), 'offer-1');
    expect(offer.state).toBe('offer');
    if (offer.state !== 'offer') return;
    expect(offer.advanced).toBe(true);
    expect(offer.itemIndex).toBe(1);
    expect(offer.offeredState).toMatchObject({ currentItemIndex: 1, status: 'item_pending', lastActionId: 'offer-1' });
  });

  it('item_pending re-offers the SAME item without a state change (post-interruption)', () => {
    const pending = state({ status: 'item_pending', currentItemIndex: 1, lastActionId: 'prev' });
    const offer = prepareSequenceContinuationOfferV1(pending, 'offer-2');
    expect(offer).toEqual({ state: 'offer', itemIndex: 1, offeredState: pending, advanced: false });
  });

  it('advancing past the last item completes the sequence (no offer, terminal)', () => {
    const last = state({ status: 'awaiting_response', currentItemIndex: 2, itemCount: 3 });
    const offer = prepareSequenceContinuationOfferV1(last, 'offer-3');
    expect(offer.state).toBe('sequence_complete');
    if (offer.state !== 'sequence_complete') return;
    expect(offer.terminalState.status).toBe('completed');
  });

  it('a terminal / non-offerable status yields no offer', () => {
    expect(prepareSequenceContinuationOfferV1(state({ status: 'completed' }), 'o').state).toBe('no_offer');
    expect(prepareSequenceContinuationOfferV1(state({ status: 'cancelled' }), 'o').state).toBe('no_offer');
  });
});

describe('continuation outcome delivery', () => {
  const offered = state({ status: 'item_pending', currentItemIndex: 1 });

  it('send → inject the body + mark the item in flight', () => {
    const out = deliverSequenceContinuationOutcomeV1(offered, { state: 'send', bodyText: 'the item body' }, 'act-1');
    expect(out.kind).toBe('inject');
    if (out.kind !== 'inject') return;
    expect(out.bodyText).toBe('the item body');
    expect(out.nextState).toMatchObject({ status: 'awaiting_response', currentItemIndex: 1, lastActionId: 'act-1' });
  });

  it('interruption → keep the SAME item pending (pointer unchanged)', () => {
    const out = deliverSequenceContinuationOutcomeV1(offered, { state: 'interruption' }, 'act-2');
    expect(out.kind).toBe('keep');
    if (out.kind !== 'keep') return;
    expect(out.nextState).toMatchObject({ status: 'item_pending', currentItemIndex: 1 });
  });

  it('declined → terminal cancel (MPS-2 6.2: Escape ends the whole sequence, like the Cancel button)', () => {
    const out = deliverSequenceContinuationOutcomeV1(offered, { state: 'declined' }, 'act-3');
    expect(out.kind).toBe('cancel');
    if (out.kind !== 'cancel') return;
    expect(out.nextState.status).toBe('cancelled');
  });

  it('cancelled → terminal cancel', () => {
    const out = deliverSequenceContinuationOutcomeV1(offered, { state: 'cancelled' }, 'act-4');
    expect(out.kind).toBe('cancel');
    if (out.kind !== 'cancel') return;
    expect(out.nextState.status).toBe('cancelled');
  });

  it('a rejected transition surfaces as reject, not a throw (e.g. send on a non-pending state)', () => {
    const wrongStatus = state({ status: 'awaiting_response', currentItemIndex: 1 });
    const out = deliverSequenceContinuationOutcomeV1(wrongStatus, { state: 'send', bodyText: 'x' }, 'act-5');
    expect(out).toEqual({ kind: 'reject', reasonCode: 'invalid_status_for_action' });
  });
});

describe('continuation full walk (offer → deliver, offer → deliver, …)', () => {
  it('drives a 3-item sequence: offer→send, offer→interruption, re-offer→send, offer→complete', () => {
    let s = state({ itemCount: 3, currentItemIndex: 0, status: 'awaiting_response' });

    // Stop 1: offer item 1, user sends it.
    let offer = prepareSequenceContinuationOfferV1(s, 'o1');
    expect(offer.state).toBe('offer');
    if (offer.state !== 'offer') return;
    let deliver = deliverSequenceContinuationOutcomeV1(offer.offeredState, { state: 'send', bodyText: 'item 1' }, 'd1');
    expect(deliver.kind).toBe('inject');
    if (deliver.kind !== 'inject') return;
    s = deliver.nextState; // awaiting_response(1)

    // Stop 2: offer item 2, user interrupts — item 2 stays pending.
    offer = prepareSequenceContinuationOfferV1(s, 'o2');
    expect(offer.state).toBe('offer');
    if (offer.state !== 'offer') return;
    expect(offer.itemIndex).toBe(2);
    deliver = deliverSequenceContinuationOutcomeV1(offer.offeredState, { state: 'interruption' }, 'd2');
    expect(deliver.kind).toBe('keep');
    if (deliver.kind !== 'keep') return;
    s = deliver.nextState; // item_pending(2)

    // Stop 3: re-offer the SAME item 2 (no advance), user sends it.
    offer = prepareSequenceContinuationOfferV1(s, 'o3');
    expect(offer.state).toBe('offer');
    if (offer.state !== 'offer') return;
    expect(offer.itemIndex).toBe(2);
    expect(offer.advanced).toBe(false);
    deliver = deliverSequenceContinuationOutcomeV1(offer.offeredState, { state: 'send', bodyText: 'item 2' }, 'd3');
    expect(deliver.kind).toBe('inject');
    if (deliver.kind !== 'inject') return;
    s = deliver.nextState; // awaiting_response(2)

    // Stop 4: advancing past the last item completes the sequence.
    offer = prepareSequenceContinuationOfferV1(s, 'o4');
    expect(offer.state).toBe('sequence_complete');
  });
});

// MPS-14 sub-phase 2.1 — the packaging read-point. A valid input yields a package fed verbatim to the
// popup builder (2.2); a refusal yields NO popup (ordinary flow), never an empty/skipped/composed body.
// The fixture below is a known-valid packager input (mirrors the packager's own test) — the packager
// itself is tested separately; here we only assert the adapter's package-or-no-popup mapping.

/** The item's own safety verdict, deliberately different from the first body's. */
const ITEM_SAFETY = {
  sensitiveActionState: 'none_detected',
  validationStatus: 'valid',
} as unknown as PromptEnhancementSafetySummaryV1;

const GRAPH = { safetyState: ITEM_SAFETY } as unknown as PromptEnhancementValidationGraphV1;

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

const ACCEPTED = {
  requestId: 'req-1',
  projectRoot: '/project',
  enhancementId: 'enh-1',
  currentBody: {
    currentBodyId: 'body-0', bodyRevision: 0,
    renderedPromptBody: 'The first prompt, already sent.', text: 'The first prompt, already sent.',
    sentPromptOrigin: 'user_authored_original_only', nexpathGeneratedPromptRef: 'ref-0',
    originalPromptText: 'the original', generatedOriginState: 'user_original',
    userDirtyState: 'dirty_user_edited', generatedSafeStatus: 'invalid_non_sendable',
  },
  disposition: 'fallback_to_original',
  validationDecisionId: 'decision-for-the-first-body',
  composerBoundary: {
    composerRunId: 'run-0', sentPromptOrigin: 'user_authored_original_only',
    nexpathGeneratedPromptRef: 'ref-0', renderedPromptBody: 'The first prompt, already sent.',
  },
  safetySummary: { sensitiveActionState: 'confirmation_required' },
  handoffMetadata: {
    handoffDecisionId: 'enh-1:handoff',
    compactFirstPopupSequenceSummary: {
      summaryId: 'body-0:summary', currentBodyId: 'body-0', bodyRevision: 0, publicSafeText: 'planned as 4 prompts',
    },
    handoffKind: 'first_prompt_handoff_candidate',
    currentBodyId: 'body-0', bodyRevision: 0,
    currentBodyValidityState: 'invalid_due_body_revision', riskConfirmationState: 'none_detected',
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
    generatedOriginId: 'origin-0', generatedOriginState: 'user_original', bodyId: 'body-0', bodyRevision: 0,
    sourceUseIds: ['body-0:use'],
    echoRecursionGuard: {
      sourcePromptEchoState: 'not_echo', lastInjectedPromptIsAuthority: false, bodyFingerprintRef: 'body-0:fingerprint',
    },
  },
  uiView: {
    body: {
      text: 'The first prompt, already sent.', currentBodyId: 'body-0', bodyRevision: 0,
      generatedOriginState: 'user_original', dirtyState: 'dirty_user_edited',
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

describe('continuation packaging step (2.1)', () => {
  it('a valid input yields a package carrying the five packaged fields, forwarded verbatim', () => {
    const out = packageSequenceContinuationOfferV1(input());
    expect(out.kind).toBe('package');
    if (out.kind !== 'package') return;
    // The five fields the popup builder (2.2) and the send check (2.3) consume are present.
    expect(out.packaged).toEqual(
      expect.objectContaining({
        result: expect.anything(),
        handoffMetadata: expect.anything(),
        event: expect.anything(),
        progress: expect.anything(),
      }),
    );
    expect(out.packaged).toHaveProperty('safetyClauseRef'); // present (may be null when the item carried none)
    // Forwarded verbatim: identical to the raw packager's own output, no mapping/mutation applied.
    const raw = packagePromptEnhancementSequenceContinuationV1(input());
    expect(raw.ok).toBe(true);
    if (!raw.ok) return;
    expect(out.packaged).toEqual(raw.packaged);
  });

  it('a refusal yields no popup and its refusal code — never an empty/skipped/composed body', () => {
    // item_count disagreeing with the item list is a refusal (a state that should be impossible).
    expect(packageSequenceContinuationOfferV1(input({ itemCount: 5 })))
      .toEqual({ kind: 'no_popup', refusal: 'item_count_disagrees_with_items' });
    // Index 0 is the already-sent first prompt — offering it again is not a continuation.
    expect(packageSequenceContinuationOfferV1(input({ currentItemIndex: 0 })))
      .toEqual({ kind: 'no_popup', refusal: 'index_is_the_first_item' });
  });
});

describe('feed the packaged continuation into the popup builder (2.2)', () => {
  // The fix plan's 2.2 test is "the adapter passes the packager's result/handoffMetadata/event VERBATIM
  // into the builder — same names, no mapping layer." We assert that by comparing the adapter's output to
  // a direct builder call fed those exact fields (plus the locked blocked_no_send cancel row); if anyone
  // later inserts a mapping/rename, the two diverge. (A genuinely builder-valid PrepareResult only comes
  // from the async facade — see continuation-popup.test.ts:validContinuation — which is that builder's own
  // integration concern, not this pure adapter's.)
  it('feeds result/handoffMetadata/event verbatim + the locked cancel row (no mapping layer)', () => {
    const pkg = packageSequenceContinuationOfferV1(input());
    expect(pkg.kind).toBe('package');
    if (pkg.kind !== 'package') return;
    const direct = buildPromptEnhancementMpsContinuationPopupV1({
      result: pkg.packaged.result,
      handoffMetadata: pkg.packaged.handoffMetadata,
      event: pkg.packaged.event,
      additionalDetails: undefined,
      cancel: { state: 'available', disposition: 'blocked_no_send' },
    });
    // Identical outcome (state + reasonCodes/model) — the adapter adds nothing but the fixed cancel row,
    // and forwards the builder's verdict as-is (it decides nothing the builder does not).
    expect(buildContinuationPopupFromPackageV1(pkg.packaged)).toEqual(direct);
  });

  it('forwards the popup typed-details state to the builder when supplied', () => {
    const pkg = packageSequenceContinuationOfferV1(input());
    expect(pkg.kind).toBe('package');
    if (pkg.kind !== 'package') return;
    const details = { text: 'typed so far', revision: 1 };
    const direct = buildPromptEnhancementMpsContinuationPopupV1({
      result: pkg.packaged.result,
      handoffMetadata: pkg.packaged.handoffMetadata,
      event: pkg.packaged.event,
      additionalDetails: details,
      cancel: { state: 'available', disposition: 'blocked_no_send' },
    });
    expect(buildContinuationPopupFromPackageV1(pkg.packaged, details)).toEqual(direct);
  });
});

describe('send-time edit check (2.3)', () => {
  // A package whose served item (item 1) carries a safety clause at offsets [4,11) of its wording
  // "The wording of item 1." → the clause text is "wording".
  const packageWithSafetyClause = () => {
    const pkg = packageSequenceContinuationOfferV1(input({
      items: [item(0), item(1, { itemSafetyClauseRef: { start: 4, end: 11 } }), item(2), item(3)],
    }));
    if (pkg.kind !== 'package') throw new Error('fixture did not package');
    return pkg.packaged;
  };

  // The three copies of the handoff the package carries — all must move together (packager invariant).
  const allThreeValidity = (p: ReturnType<typeof packageWithSafetyClause>) => [
    p.handoffMetadata.currentBodyValidityState,
    p.result.handoffMetadata?.currentBodyValidityState,
    p.result.uiView.handoffAndSequenceSummary?.currentBodyValidityState,
  ];

  it('an ordinary edit that keeps the clause → valid, no failures, verdict written into all three copies', () => {
    const packaged = packageWithSafetyClause();
    // Sanity: the packager left the always-valid placeholder in all three copies before the check.
    expect(allThreeValidity(packaged)).toEqual(Array(3).fill('valid_for_current_body_revision'));
    // The user edits around the clause but keeps the word "wording".
    const res = checkContinuationSendEditV1(packaged, 'The wording of item 1, now edited.');
    expect(res.validityState).toBe('valid_for_current_body_revision');
    expect(res.failures).toEqual([]);
    // Written over (not left as an untouched placeholder), and identical across all three copies.
    expect(allThreeValidity(res.packaged)).toEqual(Array(3).fill('valid_for_current_body_revision'));
  });

  it('an edit that removes the safety clause → invalid + blocking failure, overwritten in all three copies', () => {
    const packaged = packageWithSafetyClause();
    expect(allThreeValidity(packaged)).toEqual(Array(3).fill('valid_for_current_body_revision'));
    // The sent body no longer contains "wording" — the safety clause was removed by the edit.
    const res = checkContinuationSendEditV1(packaged, 'The stuff of item 1.');
    expect(res.validityState).toBe('invalid_due_user_edit_or_safety_removal');
    expect(res.failures.length).toBeGreaterThan(0);
    // The always-valid placeholder is written OVER by the send-time verdict in ALL THREE copies — none
    // left stale, so a consumer reading the result can never see 'valid' where the verdict is 'invalid'.
    expect(allThreeValidity(res.packaged)).toEqual(Array(3).fill('invalid_due_user_edit_or_safety_removal'));
    // The input package is not mutated — the reconciliation is on the returned package only.
    expect(allThreeValidity(packaged)).toEqual(Array(3).fill('valid_for_current_body_revision'));
  });

  it('a served item with no safety clause is always valid (safetyClauseRef null, off the package)', () => {
    const pkg = packageSequenceContinuationOfferV1(input()); // default items carry itemSafetyClauseRef: null
    if (pkg.kind !== 'package') { expect(pkg.kind).toBe('package'); return; }
    expect(pkg.packaged.safetyClauseRef).toBeNull(); // sourced off the package, not re-indexed from items
    const res = checkContinuationSendEditV1(pkg.packaged, 'anything the user typed');
    expect(res.validityState).toBe('valid_for_current_body_revision');
    expect(res.failures).toEqual([]);
    expect(allThreeValidity(res.packaged)).toEqual(Array(3).fill('valid_for_current_body_revision'));
  });
});
