/**
 * Acceptance executor — batch 2: the runtime fixtures the packager alone can drive.
 *
 * Each `it` is a backing test named for the fixture it runs (`test:${fixtureId}`). It drives the
 * built-ahead packager and asserts the fixture's mandatory safeguards. It does NOT mark the register
 * fixture as passing — the owner oracle judges readiness; this produces the evidence it reads.
 *
 * Fixtures mirror sequence-packager.test.ts, the proven shape for driving the packager.
 */
import { describe, expect, it } from 'vitest';
import {
  packagePromptEnhancementSequenceContinuationV1,
  type PromptEnhancementSequencePackagerInputV1,
} from './sequence-packager.js';
import type { PromptEnhancementSequenceItemV1 } from './sequence-payload.js';
import type {
  PromptEnhancementPrepareResultV1,
  PromptEnhancementSafetySummaryV1,
  PromptEnhancementValidationGraphV1,
} from './contracts.js';

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
    currentBodyId: 'body-0',
    bodyRevision: 0,
    renderedPromptBody: 'The first prompt, already sent.',
    text: 'The first prompt, already sent.',
    sentPromptOrigin: 'user_authored_original_only',
    nexpathGeneratedPromptRef: 'ref-0',
    originalPromptText: 'ABCDEFGHIJ',
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
    actions: [{ actionType: 'use_current_body', currentBodyId: 'body-0', bodyRevision: 0 }],
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

describe('acceptance executor (batch 2) — packager runtime fixtures', () => {
  it('test:acceptance-sequence-continuation-body-is-sequence-owned', () => {
    const result = packagePromptEnhancementSequenceContinuationV1(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // continuation_body_is_the_item's_own: the served body + verdict + decision id are the item's,
    // never the accepted first body's.
    expect(result.packaged.result.currentBody.renderedPromptBody).toBe('The wording of item 1.');
    expect(result.packaged.result.currentBody.renderedPromptBody).not.toBe('The first prompt, already sent.');
    expect(result.packaged.result.validationGraph).toBe(GRAPH);
    expect(result.packaged.result.validationGraph).not.toBe(ACCEPTED.validationGraph);
    expect(result.packaged.result.validationDecisionId).toBe('decision-for-item-1');
  });

  it('test:acceptance-sequence-confirmation-carries-no-original-text', () => {
    // A confirmation kind carries no slice, so no original text — and the item KIND drives it, not
    // an inference from empty text.
    const confirmation = packagePromptEnhancementSequenceContinuationV1(input({
      items: [
        item(0),
        item(1, { itemKind: 'binary_confirmation', originalSliceRef: null, generatedWording: 'YES/NO — does it hold?' }),
        item(2), item(3),
      ],
    }));
    expect(confirmation.ok).toBe(true);
    if (!confirmation.ok) return;
    expect(confirmation.packaged.itemKind).toBe('binary_confirmation');
    expect(confirmation.packaged.result.currentBody.originalPromptText).toBe('');

    // Contrast: a TASK item with a slice DOES carry its original slice, so the empty above is the
    // kind's doing, not the packager dropping everything.
    const taskItem = packagePromptEnhancementSequenceContinuationV1(input({
      items: [item(0), item(1, { originalSliceRef: { start: 2, end: 5 } }), item(2), item(3)],
    }));
    if (!taskItem.ok) return;
    expect(taskItem.packaged.result.currentBody.originalPromptText).toBe('CDE');
  });

  it('test:acceptance-sequence-same-item-returns-identical', () => {
    // duplicate_event_re_serves_the_same_body: re-reading frozen text is byte-identical, so a
    // replayed event serves the same body with no dedup.
    const first = packagePromptEnhancementSequenceContinuationV1(input());
    const second = packagePromptEnhancementSequenceContinuationV1(input());
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.packaged).toEqual(first.packaged);
  });
});
