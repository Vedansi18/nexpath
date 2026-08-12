import { describe, expect, it } from 'vitest';
import {
  PROMPT_ENHANCEMENT_CONTRACT_VERSION,
  type PromptEnhancementPrepareRequestV1,
  type PromptEnhancementSourceRefV1,
} from './contracts.js';
import { buildPromptEnhancementHandoffMetadataV1 } from './handoff-metadata.js';
import { preparePromptEnhancement } from './facade.js';
import { buildPromptEnhancementCostVisibilityMetadataV1 } from './cost-observability.js';
import { getPromptStartStopSourceSnapshot } from './source-reality.js';
import { buildPromptEnhancementMpsContinuationPopupV1 } from './continuation-popup.js';
import { packagePromptEnhancementSequenceContinuationV1 } from './sequence-packager.js';
import type { PromptEnhancementSequenceItemV1 } from './sequence-payload.js';

/**
 * The packager, checked by the thing that checks it.
 *
 * Every other test in the packager's own file asserts one field on a hand-built fixture, which is
 * how six separate stale fields were found one at a time by reading. This one takes a REAL prepare
 * result and REAL handoff metadata, packages an item from a stored list, and hands the output to
 * the popup builder — the component that enforces the twelve acceptance conditions. If any of them
 * fails, the popup refuses with a typed reason and this test says which.
 */

function request(): PromptEnhancementPrepareRequestV1 {
  const sourceRef: PromptEnhancementSourceRefV1 = {
    sourceRefId: 'b32-source-1', sourceKind: 'source_a_user_prompt', sourceId: 'prompt:b32',
    sourceAuthorization: 'source_fact_only', evidenceStatus: 'present', freshness: 'current',
    confidence: 'high', privacyClass: 'public_safe',
  };
  const boundaries = getPromptStartStopSourceSnapshot();
  return {
    schemaVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION, requestId: 'b32-request', projectRoot: '/tmp/b32-project',
    hostSurface: 'cli_stop_bridge',
    sourcePrompt: { text: 'Review this continuation item and explain the verification.', origin: 'user', capturedAt: 1, promptIndex: 1, generatedOriginPolicy: 'ordinary_source_a' },
    reviewMomentContext: {
      reviewMoment: 'UserPromptSubmit_preparation', currentAgentMode: 'workspace-write', projectId: 'b32-project',
      sessionId: 'b32-session', detectedLanguage: 'en', stageCandidate: 'implementation', promptCount: 1,
      recentPromptMetadataRefs: [], triggerProvenance: {
        currentStage: 'implementation', prevStage: 'task_breakdown', triggerKind: 'stage_transition',
        classifierState: 'fire_recommended', degradedNoActionState: 'none', promptStartBoundary: boundaries.hookBoundary,
        deliveryBoundary: boundaries.deliveryBoundary, promptStartCanReplaceSameTurn: false,
      },
    },
    sourceSignals: {
      sourceAOriginalPromptRef: sourceRef, sourceRefs: [sourceRef], normalizedStageAbsenceSignalRefs: [],
      contentTemplateRecordFactRefs: [], popupQuestionSourceRefs: [], whyHelpSourceRefs: [], profileRoleModeRefs: [],
      rightGoodWorkStyleEnvRuntimeRefs: [], missingMemoryCandidateRefs: [],
      sourceLabels: [{ sourceRefId: sourceRef.sourceRefId, label: 'original_prompt', evidenceStatus: 'present' }],
      promptStartStop: { hookBoundary: boundaries.hookBoundary, deliveryBoundary: boundaries.deliveryBoundary,
        runAutoCanHoldOrReplaceSubmittedPrompt: false, sharedSignalCount: boundaries.sharedSignalCount,
        classifierDegradedNoFireReasons: boundaries.classifierDegradedNoFireReasons },
      store: { schemaVersion: 1, missingPromptEnhancementTables: [], cleanupGaps: [] }, transcriptPathState: 'not_authority',
      streamBOutputs: [], paramEventChannels: [], servedVariantIdentityRefs: [], deliveryGateRefs: [], sourceOnlyHardFactRefs: [],
    },
    userPreferenceContext: { levelState: 'default', scopedFeedbackEvidenceRefs: [] },
    configSnapshot: { sequenceEnabledState: 'not_enabled_v1', validatedEffectiveConfigState: 'valid', arbitraryConfigRowsAreAuthority: false },
    callVisibilityState: buildPromptEnhancementCostVisibilityMetadataV1('baseline_pe_composer', { callVisibilityMode: 'deterministic', plannedCallCount: 0, usedCallCount: 0 }),
    privacyAndStoragePolicy: { sensitivityClass: 'normal', localStorageEligibility: 'ids_and_categories_only', telemetryEligibility: 'allowlisted_counts_only', llmSharingEligibility: 'allowed_minimal', generatedBodyStoragePolicy: 'do_not_store_raw_by_default' },
  };
}

/** A stored item list: the first prompt already sent, then three continuations with their wording. */
const storedItems = (): readonly PromptEnhancementSequenceItemV1[] =>
  [0, 1, 2, 3].map((order) => ({
    itemKind: order === 0 ? 'first_task' : 'task',
    originalSliceRef: null,
    sourcePointRanges: [],
    roleLabel: null,
    dependencyOrder: order,
    complexity: 'not_complex',
    complexityReason: null,
    generatedWording: order === 0 ? null : `Stored wording for item ${order}.`,
    actionRiskKinds: [],
    authorityMode: 'plan_or_review',
    requiresConfirmationFloor: false,
    decompositionGroupId: 'g1',
    // Filled in per run from the real result: a per-item verdict is a real graph, and an empty
    // object here would fail the popup for the fixture's reason rather than the packager's.
    itemValidationGraph: null,
  })) as readonly PromptEnhancementSequenceItemV1[];

async function packagedPopup(currentItemIndex: number) {
  const accepted = await preparePromptEnhancement(request());
  const handoff = buildPromptEnhancementHandoffMetadataV1({
    handoffDecisionId: `${accepted.enhancementId}:mps-handoff`,
    requestId: accepted.requestId,
    projectRoot: accepted.projectRoot,
    currentBody: accepted.currentBody,
    safetySummary: accepted.safetySummary,
    handoffKind: 'first_prompt_handoff_candidate',
    summary: {
      summaryId: `${accepted.enhancementId}:summary`,
      publicSafeText: 'Metadata only.',
      remainingTaskCount: 3,
      taskRoleLabels: ['verification'],
    },
  });

  const items = storedItems().map((entry) => (entry.dependencyOrder === 0
    ? entry
    : { ...entry, itemValidationGraph: accepted.validationGraph }));

  const packaged = packagePromptEnhancementSequenceContinuationV1({
    acceptedResult: { ...accepted, handoffMetadata: handoff },
    items,
    currentItemIndex,
    itemCount: 4,
    sequenceId: 'sequence-1',
    sequenceItemId: `item-${currentItemIndex}`,
    currentItemRevision: currentItemIndex,
    bodyRevision: accepted.currentBody.bodyRevision + currentItemIndex,
    currentBodyId: `${accepted.currentBody.currentBodyId}:item-${currentItemIndex}`,
    nexpathGeneratedPromptRef: `${accepted.currentBody.nexpathGeneratedPromptRef}:item-${currentItemIndex}`,
    validationDecisionId: `${accepted.validationDecisionId}:item-${currentItemIndex}`,
    composerRunId: `${accepted.currentBody.composerRunId}:batch`,
    itemSafetySummary: accepted.safetySummary,
    itemValidationSummary: accepted.validationSummary,
    handoffDecisionId: `${accepted.enhancementId}:handoff:item-${currentItemIndex}`,
  });
  if (!packaged.ok) throw new Error(`packager refused: ${packaged.refusal}`);

  return {
    packaged: packaged.packaged,
    built: buildPromptEnhancementMpsContinuationPopupV1({
      result: packaged.packaged.result,
      handoffMetadata: packaged.packaged.handoffMetadata,
      event: packaged.packaged.event,
      additionalDetails: { text: '', revision: 0 },
      cancel: { state: 'available', disposition: 'blocked_no_send' },
    }),
  };
}

describe('sequence packager — checked by the thing that checks it', () => {
  it('produces a continuation the popup accepts, showing the stored wording', async () => {
    // The twelve acceptance conditions are enforced here rather than restated by me. A field left
    // pointing at the previous body fails one of them, and the reason code says which.
    const { built } = await packagedPopup(1);
    if (built.state !== 'ready') {
      throw new Error(`popup refused: ${built.reasonCodes.join(', ')}`);
    }
    expect(built.model.body.text).toBe('Stored wording for item 1.');
    expect(built.model.identity.sequenceId).toBe('sequence-1');
    expect(built.model.identity.sequenceItemId).toBe('item-1');
  });

  it('accepts every continuation index, not only the first', async () => {
    for (const index of [2, 3]) {
      const { built } = await packagedPopup(index);
      if (built.state !== 'ready') {
        throw new Error(`popup refused at item ${index}: ${built.reasonCodes.join(', ')}`);
      }
      expect(built.model.body.text).toBe(`Stored wording for item ${index}.`);
    }
  });

  it('carries the progress the contract had nowhere for', async () => {
    const { packaged } = await packagedPopup(2);
    expect(packaged.progress).toEqual({ done: 2, total: 4 });
  });

  it('serves the same item unchanged when it comes back, at the surface the user sees', async () => {
    // The custom-prompt path holds the item: the user types directly in the agent, and the same
    // prompt returns after their own prompt and a response reach a later Stop. Two carried fixtures
    // pin this and they are not duplicates - that it returns, and that it returns unchanged.
    //
    // Asserted on the whole MODEL rather than the body text. A re-serve would drift in the identity
    // block or the actions long before it drifted in the wording, and the wording is the half that
    // was already provably stable.
    const first = await packagedPopup(2);
    const second = await packagedPopup(2);
    if (first.built.state !== 'ready' || second.built.state !== 'ready') {
      throw new Error('fixture did not render');
    }
    expect(second.built.model.body.text).toBe('Stored wording for item 2.');
    expect(second.built.model).toEqual(first.built.model);
  });

  it('re-serves on a replayed event, because that is harmless when the text cannot change', async () => {
    // The packager grows no dedupe layer. A duplicate event makes it re-read and re-package, which
    // the user cannot tell from the first time; what must not happen twice is the pointer
    // advancing, and that is guarded one layer down where the transition is visible.
    const served = await Promise.all([packagedPopup(3), packagedPopup(3)]);
    for (const { built } of served) {
      if (built.state !== 'ready') throw new Error(`popup refused: ${built.reasonCodes.join(', ')}`);
    }
    const [a, b] = served;
    expect(a?.built.state === 'ready' && b?.built.state === 'ready').toBe(true);
    if (a?.built.state !== 'ready' || b?.built.state !== 'ready') return;
    expect(b.built.model).toEqual(a.built.model);
  });
});
