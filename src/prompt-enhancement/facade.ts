import {
  PROMPT_ENHANCEMENT_CONTRACT_VERSION,
  validatePromptEnhancementPrepareRequestV1,
  type PromptEnhancementActionFacadeV1,
  type PromptEnhancementActionRequestV1,
  type PromptEnhancementCurrentBodyV1,
  type PromptEnhancementDeliveryMetadataV1,
  type PromptEnhancementGeneratedOriginMetadataV1,
  type PromptEnhancementPrepareFacadeV1,
  type PromptEnhancementPrepareRequestV1,
  type PromptEnhancementPrepareResultV1,
  type PromptEnhancementPublicDiagnosticV1,
  type PromptEnhancementPublicTrustCueV1,
  type PromptEnhancementSectionFeedbackViewV1,
  type PromptEnhancementUiViewPayloadV1,
  type PromptEnhancementWhyHelpV1,
} from './contracts.js';
import {
  composePromptEnhancementBody,
  type PromptEnhancementComposeResult,
  type PromptEnhancementComposerRuntimeState,
  type PromptEnhancementStructuredComposerOutputV1,
} from './compose-enhancement.js';
import { composeStructuredComposerOutputV1 } from './llm-composer.js';
import { isPromptEnhancementNlpHeavyCaseV1 } from './composer-gate.js';
import { decidePromptEnhancementRouteViaLlmV1, type PromptEnhancementLlmRouteDecisionV1 } from './llm-route-decision.js';
import { isValidApiKey } from '../config/ApiKeyResolver.js';
import { planPromptEnhancementSections } from './templates/section-plan.js';
import { routePromptEnhancement, type PromptEnhancementCapabilityId, type PromptEnhancementRouteInput } from './routing-taxonomy.js';
import { buildPromptEnhancementGuidanceFactsV1 } from './guidance-facts.js';
import { resolvePromptEnhancementSourceConflictsV1 } from './conflict-resolution.js';
import { applyPromptEnhancementSourceMixV1 } from './source-mix.js';
import { applyPromptEnhancementGuidanceGateV1 } from './guidance-gate.js';
import { buildPromptEnhancementPinchLabelV1, buildPromptEnhancementWhyHelpV1 } from './pe-header-copy.js';
import { buildPromptEnhancementHandoffMetadataV1, validatePromptEnhancementHandoffMetadataV1 } from './handoff-metadata.js';
import {
  validatePromptEnhancementSafety,
  type PromptEnhancementSafetyValidationResult,
} from './safety-sendability.js';

/**
 * The single PE content-engine entry point.
 *
 * This is intentionally a small orchestration layer. Routing, section planning,
 * composition, and safety remain independently testable modules; application
 * code must call this facade rather than reaching into those modules directly.
 */
export const preparePromptEnhancement: PromptEnhancementPrepareFacadeV1 = async (request) => {
  assertPrepareRequest(request);
  return prepare(request);
};

/** Apply a bounded directional/details action against the current body contract. */
export const applyPromptEnhancementAction: PromptEnhancementActionFacadeV1 = async (request) => {
  assertPrepareRequest(request);
  const base = await prepare(
    request,
    request.action.actionType === 'use_original' ? undefined : request.action.actionType,
    request,
  );
  if (request.action.actionType === 'use_current_body') {
    const editedBodyText = request.currentBodyBinding.editedBodyText;
    const safety = validatePromptEnhancementSafety({
      currentBody: base.currentBody,
      editedBodyText,
      actionType: 'use_current_body',
      callVisibilityMode: base.callAndVisibilityMetadata.callVisibilityMode,
    });
    return rebuildWithEditedBodySafety(request, base, editedBodyText, safety);
  }
  if (request.action.actionType !== 'use_original') return base;

  const originalSafety = validatePromptEnhancementSafety({
    currentBody: base.currentBody,
    editedBodyText: request.currentBodyBinding.editedBodyText,
    actionType: 'use_original',
    callVisibilityMode: 'fallback_no_llm',
  });
  return rebuildWithSafety(base, originalSafety, 'fallback_to_original');
};

// E6: soft deterministic-route skips an LLM route decision may rescue (the keyword
// router gave up because the prompt has no explicit intent / is weak-ambiguous).
// Hard-guard skips (degraded classifier, old/generated origin, first-trigger gate) are
// deliberately excluded.
const LLM_ROUTE_RESCUABLE_SKIP_REASONS: ReadonlySet<string> = new Set([
  'source_b_only_cannot_open_popup',
  'ambiguous_weak_evidence_skip_no_popup',
]);

async function prepare(
  request: PromptEnhancementPrepareRequestV1,
  action?: PromptEnhancementActionRequestV1['action']['actionType'],
  actionRequest?: PromptEnhancementActionRequestV1,
): Promise<PromptEnhancementPrepareResultV1> {
  const enhancementId = `pe:${request.requestId}`;
  const routeInput: PromptEnhancementRouteInput = {
    routeDecisionId: `${enhancementId}:route`,
    promptText: request.sourcePrompt.text,
    currentStage: request.reviewMomentContext.triggerProvenance.currentStage,
    prevStage: request.reviewMomentContext.triggerProvenance.prevStage,
    triggerKind: request.reviewMomentContext.triggerProvenance.triggerKind,
    firedKey: request.reviewMomentContext.triggerProvenance.firedKey,
    effectiveFiredSource: request.reviewMomentContext.triggerProvenance.effectiveFiredSource,
    selectedQualifyingAbsence: request.reviewMomentContext.triggerProvenance.selectedQualifyingAbsence,
    absenceGateReason: request.reviewMomentContext.triggerProvenance.absenceGateReason,
    classifierState: request.reviewMomentContext.triggerProvenance.classifierState,
    degradedNoActionState: request.reviewMomentContext.triggerProvenance.degradedNoActionState,
    sourceSnapshot: request.sourceSignals,
    sourceFactRefs: request.sourceSignals.sourceRefs.map((source) => source.sourceRefId),
    contentTemplateFactRefs: request.sourceSignals.contentTemplateRecordFactRefs,
    recentPromptEvidenceRefs: request.reviewMomentContext.recentPromptMetadataRefs,
    memoryFeedbackRefs: request.userPreferenceContext.scopedFeedbackEvidenceRefs,
    permissionMode: request.sourceSignals.permissionMode,
    transcriptPathState: request.sourceSignals.transcriptPathState,
    streamBOutputRefs: request.sourceSignals.streamBOutputs,
    paramEventChannels: request.sourceSignals.paramEventChannels,
    runtimeEnvFactRefs: request.sourceSignals.rightGoodWorkStyleEnvRuntimeRefs,
    rightGoodWorkStyleRefs: request.sourceSignals.rightGoodWorkStyleEnvRuntimeRefs,
    stage2SelectionState: request.reviewMomentContext.triggerProvenance.triggerKind === 'absence'
      ? 'selected'
      : 'supplementary_present',
    generatedOriginState: request.sourcePrompt.origin === 'pe_generated_echo'
      ? 'pe_generated'
      : 'ordinary_user_prompt',
    oldDecisionSessionPayloadPresent: false,
  };
  let route = routePromptEnhancement(routeInput);

  // E6: for a baseline prepare where the deterministic keyword router SOFT-skipped an
  // NL-heavy prompt it could not route (no explicit intent / weak-ambiguous), ask the
  // bounded LLM to decide the real route and re-route with it. Gated on a valid key so
  // the suite (no key) keeps the deterministic route; any LLM failure -> keep the
  // deterministic skip (the mandatory fallback). Hard-guard skips (old/generated
  // origin, degraded classifier, first-trigger gate) are NOT rescued. The LLM may
  // still legitimately decide skip_no_useful_guidance.
  if (
    action === undefined &&
    route.noPopup &&
    route.reasonCodes.some((reason) => LLM_ROUTE_RESCUABLE_SKIP_REASONS.has(reason)) &&
    isValidApiKey(process.env['OPENAI_API_KEY'] ?? '')
  ) {
    const llmRouteDecision = await decidePromptEnhancementRouteViaLlmV1({
      promptText: request.sourcePrompt.text,
      deterministicFamilyId: route.familyId,
      deterministicPrimaryIntent: route.primaryIntent,
    });
    if (llmRouteDecision) {
      route = routePromptEnhancement(routeInput, llmRouteDecision);
    }
  }

  // F1b (send-block fix 2026-08-07): an ACTION re-prepare re-routes with the SAME decision its
  // popup was prepared with (carried from result.routeDecision). Without this, a prompt that
  // routed only via the prepare-only E6 rescue above soft-skips again here and the action
  // manufactures a no-popup-shaped result — the popup's own Enter/adjustments then fail (live
  // Windows report). Deterministic re-application of an already-made decision; never an LLM call.
  if (
    actionRequest?.routeCarryover !== undefined &&
    route.noPopup &&
    route.reasonCodes.some((reason) => LLM_ROUTE_RESCUABLE_SKIP_REASONS.has(reason))
  ) {
    route = routePromptEnhancement(routeInput, {
      familyId: actionRequest.routeCarryover.familyId,
      primaryIntent: actionRequest.routeCarryover.primaryIntent,
      capabilities: [],
      ambiguityState: 'clear',
    } as PromptEnhancementLlmRouteDecisionV1);
  }

  // E2 guidance pipeline: source signals -> typed facts -> cross-lane conflict
  // resolution -> transform-rule-2 dual-lane source mix -> DR2-G1 gate. The mix's rendered
  // facts feed section planning; the gate can force skip_no_popup when there is no
  // useful Source-A survivor (never a filler body).
  const guidanceFacts = buildPromptEnhancementGuidanceFactsV1(request);
  const resolvedFacts = resolvePromptEnhancementSourceConflictsV1(guidanceFacts).facts;
  const sourceMix = applyPromptEnhancementSourceMixV1(resolvedFacts, request.userPreferenceContext.levelState);
  const guidanceGate = applyPromptEnhancementGuidanceGateV1(sourceMix);
  // F1 (send-block fix 2026-08-07): an ACTION never re-decides popup existence. The popup the
  // action came from already exists — its route/no-popup decision was made at PREPARE (possibly
  // via the E6 LLM route-rescue above, which is gated to prepare only). Re-running the gate here
  // could "un-route" an approved open popup and fail its own actions/send (live Windows report:
  // Enter on an approved body -> malformed no-popup action result -> send blocked). The action
  // recompose below still runs the FULL safety validation on the recomposed body — this bypass
  // only stops an action from cancelling a popup that is already on screen.
  const noPopup = actionRequest !== undefined ? false : (route.noPopup || !guidanceGate.show);

  const planning = planPromptEnhancementSections({
    routeResult: route,
    sourceRefs: request.sourceSignals.sourceRefs,
    guidanceFacts: sourceMix.renderedFacts,
  });

  // E4: bounded LLM composer wording for a shown, NLP-heavy popup on the baseline
  // compose (no action). Gated on a valid key so the whole test suite (no key) and
  // any obvious/clear prompt render deterministically. Any failure -> undefined ->
  // composePromptEnhancementBody validates + falls back deterministically.
  // E8: a directional action (Shorter / More-thorough / More-project-grounded /
  // Owner decision (2026-08-06): the interactive popup actions (Shorter / More-thorough /
  // More-project-grounded / Apply-details) must stay INSTANT — deterministic recompose only,
  // exactly like before. An in-popup LLM wait reads as a frozen popup, so the bounded LLM
  // wording call runs ONLY on the initial prepare (action === undefined, in the background
  // before the popup shows), never inside the popup interaction. The composer's
  // action-directive seam stays available for a future non-blocking use.
  const wantsLlmWording = action === undefined && isPromptEnhancementNlpHeavyCaseV1(route);
  let structuredComposerOutput: PromptEnhancementStructuredComposerOutputV1 | undefined;
  // TI-2 (2026-08-07): the composer now reports WHY it failed, and the facade maps that onto the
  // runtime states that already exist instead of collapsing everything to `undefined` — which made
  // a real provider timeout byte-identical to "never eligible for an LLM call" in the UI, logs,
  // and cost metadata. `no_key` / `no_eligible_sections` stay `undefined` (genuinely "not
  // requested"); downstream, the failure states already produce `callVisibilityMode
  // 'fallback_no_llm'` + a populated `providerFailureState` via `fallbackModeForRuntime`.
  let composerRuntimeState: PromptEnhancementComposerRuntimeState | undefined;
  if (
    wantsLlmWording &&
    !noPopup &&
    isValidApiKey(process.env['OPENAI_API_KEY'] ?? '')
  ) {
    const composerCall = await composeStructuredComposerOutputV1({
      enhancementId,
      originalPromptText: request.sourcePrompt.text,
      planning,
    });
    if (composerCall.ok) {
      structuredComposerOutput = composerCall.output;
      composerRuntimeState = 'accepted_structured_output';
    } else if (composerCall.reason === 'timeout') {
      composerRuntimeState = 'timeout';
    } else if (composerCall.reason === 'provider_error') {
      composerRuntimeState = 'provider_unavailable';
    } else if (composerCall.reason === 'invalid_output') {
      composerRuntimeState = 'invalid_output';
    }
    // 'no_key' / 'no_eligible_sections' -> undefined: the call was genuinely not made.
  }

  const composeInput = {
    enhancementId,
    originalPromptText: request.sourcePrompt.text,
    sectionPlanningResult: planning,
    action: action === 'use_original' || action === 'feedback' || action === 'close' || action === 'use_current_body'
      ? undefined
      : action,
    additionalDetailsText: actionRequest?.userPreferenceContext.additionalDetails?.text,
    editedBodyText: actionRequest?.currentBodyBinding.editedBodyText,
    acceptedAdditionalDetailsText: actionRequest?.userPreferenceContext.additionalDetails?.text,
    priorBodyId: actionRequest?.currentBodyBinding.currentBodyId,
    priorBodyRevision: actionRequest?.currentBodyBinding.bodyRevision,
    timestampMs: request.sourcePrompt.capturedAt,
  };
  let composed = composePromptEnhancementBody({
    ...composeInput,
    composerRuntimeState,
    structuredComposerOutput,
  });
  const validateComposed = (candidate: typeof composed) => validatePromptEnhancementSafety({
    currentBody: candidate.currentBody,
    actionType: noPopup ? 'use_original' : undefined,
    callVisibilityMode: candidate.callVisibilityMode,
    // ONE source of truth (TI-2, 2026-08-07): the validation graph must carry the SAME
    // optionalCallAvailabilityState the composed boundary metadata carries — the result validator
    // enforces graph === metadata === boundary ('mismatched_call_visibility_state'). The composed
    // metadata already derived it correctly for every mode, including the provider-failure states
    // ('unavailable_by_provider_api'), so read it from there instead of re-deriving here.
    optionalCallAvailabilityState: candidate.composerBoundary.inputContract.callVisibilityState.optionalCallAvailabilityState,
    // Only meaningful while the candidate still carries the composer's wording. Once the drafts are
    // dropped below, the body is the deterministic renderer's and the composer's verdict no longer
    // describes it — passing it on would block a body the model never wrote.
    composerAuthoritySelfReport: candidate.callVisibilityMode === 'llm_wording'
      ? {
        generatedMode: structuredComposerOutput?.authorityModeSelfReport,
        requestMode: structuredComposerOutput?.requestModeSelfReport,
      }
      : undefined,
  });
  let safety = validateComposed(composed);
  // Blocked-popup fix part 2 (2026-08-07) — deterministic-fallback safety net. The composer's
  // confirmation-parity guard removes the confirmation-absence block, but an accepted LLM draft
  // can still hard-block the FINAL body through the other blocking families the draft filter
  // does not fully cover (unresolved [X]/<x> placeholders, voice phrases, authority escalation,
  // data-leak wording). A prepare-time block of an LLM-worded body must never reach the user as
  // the empty all-unavailable popup when a proven-valid deterministic body exists: recompose with
  // the drafts dropped — the established rejected-drafts semantics ('fallback_no_llm', the spent
  // LLM call stays counted for E9) — and keep the blocked result ONLY if even the deterministic
  // body blocks (then the content itself — e.g. user-typed details — is the cause, which is the
  // genuine D2 case the blocked popup exists for).
  if (
    structuredComposerOutput !== undefined
    && composed.callVisibilityMode === 'llm_wording'
    && (safety.sendPolicy === 'no_send' || safety.generatedSafeStatus === 'invalid_non_sendable')
  ) {
    const recomposed = composePromptEnhancementBody({
      ...composeInput,
      composerRuntimeState: 'accepted_structured_output',
      structuredComposerOutput: { ...structuredComposerOutput, sectionDrafts: [] },
    });
    const recomposedSafety = validateComposed(recomposed);
    if (recomposedSafety.sendPolicy !== 'no_send' && recomposedSafety.generatedSafeStatus !== 'invalid_non_sendable') {
      composed = {
        ...recomposed,
        diagnostics: [
          ...recomposed.diagnostics,
          { category: 'fallback_or_no_popup' as const, reasonCode: 'llm_final_body_blocked_deterministic_fallback' },
        ],
      };
      safety = recomposedSafety;
    }
  }
  return buildResult(request, enhancementId, route, planning, composed, safety, noPopup);
}

function buildResult(
  request: PromptEnhancementPrepareRequestV1,
  enhancementId: string,
  route: ReturnType<typeof routePromptEnhancement>,
  planning: ReturnType<typeof planPromptEnhancementSections>,
  composed: PromptEnhancementComposeResult,
  safety: PromptEnhancementSafetyValidationResult,
  // Effective no-popup = route.noPopup OR the DR2-G1 gate skip (no useful Source-A
  // survivor / weak evidence). Both collapse to the same not-applicable disposition.
  noPopup: boolean,
): PromptEnhancementPrepareResultV1 {
  const currentBody: PromptEnhancementCurrentBodyV1 = {
    ...composed.currentBody,
    generatedSafeStatus: safety.generatedSafeStatus,
  };
  const disposition = dispositionFor(noPopup, currentBody, safety);
  const blockedNoSend = disposition === 'blocked_no_send';
  // D2 4a (P6-G1 / decision-rule-5): on a hard block, make the engine payload self-safe AT SOURCE. A host
  // reading the result DIRECTLY (before the typed UI layers scrub it) must not receive the offending
  // generated content from ANY field. The full-body fields fall back to the user's own original
  // prompt (the use_original fallback); the per-section text is emptied (a blocked section has no
  // safe per-section fallback). The send policy already forbids transport and the UI layers exclude
  // it too — defense-in-depth (engine + every UI layer), not one terminal scrub. Fields carrying the
  // generated body: currentBody.text / .renderedPromptBody / .sections[].bodyText and the composer
  // boundary's renderedPromptBody (audit copy) — all covered here; every other result text field is
  // deterministic UI copy or request input.
  const safeCurrentBody: PromptEnhancementCurrentBodyV1 = blockedNoSend
    ? {
        ...currentBody,
        text: currentBody.originalPromptText,
        renderedPromptBody: currentBody.originalPromptText,
        sections: currentBody.sections.map((section) => ({ ...section, bodyText: '' })),
      }
    : currentBody;
  const safeComposerBoundary = blockedNoSend
    ? { ...composed.composerBoundary, renderedPromptBody: composed.currentBody.originalPromptText }
    : composed.composerBoundary;
  const diagnostics = diagnosticsFor(enhancementId, [...composed.diagnostics, ...safety.publicDiagnostics]);
  const composerCallVisibility = composed.composerBoundary.inputContract.callVisibilityState;
  const callAndVisibilityMetadata = {
    ...composerCallVisibility,
    callOwner: 'content_semantics' as const,
    callTrigger: 'prepare' as const,
    productValueDiscussionIsRuntimeLimiter: false as const,
  };
  const validationSummary = safety.safetySummary;
  const generatedOrigin = buildGeneratedOrigin(request, enhancementId, currentBody);
  const delivery = buildDelivery(request, safety, noPopup);
  const trustCues = buildTrustCues(currentBody, composed.sourceGuidanceCoverage, safety);
  // UI-9 / transform-rule-10: deterministic header copy — pinch label always (when a popup
  // shows), why-help only when a safety/risk/sensitive-action reason exists.
  const pinchLabel = noPopup
    ? undefined
    : buildPromptEnhancementPinchLabelV1({ familyId: route.familyId, capabilityOverlays: route.capabilityOverlays });
  const whyHelp = noPopup
    ? undefined
    : buildPromptEnhancementWhyHelpV1({
        capabilityOverlays: route.capabilityOverlays,
        hasSensitiveAction: safety.sensitiveActionFindings.some((finding) => finding.requiresConfirmation),
      });
  // MPS (owner ruling 2026-08-06): for a compound prompt the engine emits the typed
  // handoff/sequence summary so the CLI MPS first popup can render the sequence plan. Compound =
  // multiple intent families in one prompt, OR a genuine multi-step list of the same family
  // (>= 3 user points — "schema, cron job, email sender, and the widget"; a plain "add X and Y"
  // stays on the PE popup). Metadata only — the builder itself locks
  // `sequenceActivationPolicy: blocked_pending_…` and `receiverCanActivateRuntime: false`.
  const compoundPromptState = route.contractDecision.compoundPromptState;
  const isSequenceCandidate = compoundPromptState === 'multi_intent_one_prompt'
    || (compoundPromptState === 'multi_point_same_intent' && route.contractDecision.userPointCoverageRefs.length >= 3);
  let handoffAndSequenceSummary = !noPopup && disposition === 'show_current_body' && isSequenceCandidate
    ? buildPromptEnhancementHandoffMetadataV1({
        handoffDecisionId: `${enhancementId}:handoff`,
        requestId: request.requestId,
        projectRoot: request.projectRoot,
        currentBody: safeCurrentBody,
        safetySummary: validationSummary,
        handoffKind: 'compact_sequence_summary_candidate',
      })
    : undefined;
  // Self-guard: emit the summary ONLY if it passes the same handoff validation the boundary
  // enforces — a summary that would make the whole result invalid must never cost the user the
  // PE popup (drop the summary, keep the result; MPS simply skips for that prompt).
  if (handoffAndSequenceSummary) {
    const handoffValidation = validatePromptEnhancementHandoffMetadataV1(
      handoffAndSequenceSummary,
      safeCurrentBody,
      validationSummary,
      { requestId: request.requestId, projectRoot: request.projectRoot },
    );
    if (!handoffValidation.ok) handoffAndSequenceSummary = undefined;
  }
  const uiView: PromptEnhancementUiViewPayloadV1 = {
    ...buildUiView(request, enhancementId, safeCurrentBody, composed, safety, trustCues, diagnostics, noPopup),
    ...(pinchLabel ? { pinchLabel } : {}),
    ...(whyHelp ? { whyHelp } : {}),
    ...(handoffAndSequenceSummary ? { handoffAndSequenceSummary } : {}),
  };

  return {
    schemaVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
    enhancementId,
    requestId: request.requestId,
    projectRoot: request.projectRoot,
    modelVersion: composed.callVisibilityMode === 'llm_wording' ? 'llm-wording-v1' : 'deterministic-v1',
    disposition,
    validationDecisionId: safety.validationDecisionId,
    currentBody: safeCurrentBody,
    availableActions: composed.availableActions,
    sourceGuidanceCoverage: noPopup ? 'not_applicable' : composed.sourceGuidanceCoverage,
    routingAndFeedbackDecision: {
      state: noPopup ? 'suppress' : route.fallbackMode === 'planning_first' ? 'clarify' : 'show',
      confidence: routeConfidence(route.routeConfidence),
      reasonCodes: route.reasonCodes,
      scopedPromptKindKey: route.primaryIntent,
      priorFeedbackEvidenceRefs: request.userPreferenceContext.scopedFeedbackEvidenceRefs,
      resetExpiryState: 'not_applicable',
      selectedFamilyId: route.familyId,
      selectedTagIds: route.secondaryIntentTags,
      selectedLevelState: request.userPreferenceContext.levelState,
      selectedSectionPivotIds: planning.sectionPlans.map((section) => section.sectionId),
    },
    routeDecision: route.contractDecision,
    bodyPlan: planning.bodyPlan,
    composerBoundary: safeComposerBoundary,
    validationSummary,
    safetySummary: validationSummary,
    validationGraph: safety.validationGraph,
    callAndVisibilityMetadata,
    uiView,
    generatedOrigin,
    delivery,
    ownership: {
      owners: ['content_semantics', 'ui_app'],
      sourceSnapshotVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
      fixtureIds: [...route.contractDecision.registryLinkedFixtureIds],
      launchBoundaryRecheckRef: 'launch_boundary_recheck_pending',
      excludesPrivatePlanningLeakage: true,
    },
    diagnostics,
  };
}

/**
 * UI-9: recompute the header why-help against a rebuilt safety result. The route
 * capability overlays are stable across body edits (they come from the original
 * prompt intent), so only the sensitive-action reason can change on an edit; the
 * pinch label stays as-is because it is keyed on the unchanged route family.
 */
function rebuildWhyHelpForSafety(
  result: PromptEnhancementPrepareResultV1,
  safety: PromptEnhancementSafetyValidationResult,
): PromptEnhancementWhyHelpV1 | undefined {
  return buildPromptEnhancementWhyHelpV1({
    capabilityOverlays: result.routeDecision.capabilityOverlays as readonly PromptEnhancementCapabilityId[],
    hasSensitiveAction: safety.sensitiveActionFindings.some((finding) => finding.requiresConfirmation),
  });
}

function rebuildWithEditedBodySafety(
  request: PromptEnhancementActionRequestV1,
  result: PromptEnhancementPrepareResultV1,
  editedBodyText: string,
  safety: PromptEnhancementSafetyValidationResult,
): PromptEnhancementPrepareResultV1 {
  const currentBody: PromptEnhancementCurrentBodyV1 = {
    ...result.currentBody,
    renderedPromptBody: editedBodyText,
    text: editedBodyText,
    generatedOriginState: 'pe_user_edited_body',
    generatedSafeStatus: safety.generatedSafeStatus,
    userDirtyState: 'dirty_user_edited',
  };
  const publicDiagnostics = diagnosticsFor(result.enhancementId, safety.publicDiagnostics);
  const { whyHelp: _priorWhyHelp, ...priorUiView } = result.uiView;
  const whyHelp = rebuildWhyHelpForSafety(result, safety);
  return {
    ...result,
    disposition: dispositionFor(false, currentBody, safety),
    validationDecisionId: safety.validationDecisionId,
    currentBody,
    validationSummary: safety.safetySummary,
    safetySummary: safety.safetySummary,
    validationGraph: safety.validationGraph,
    generatedOrigin: buildGeneratedOrigin(request, result.enhancementId, currentBody),
    delivery: buildDelivery(request, safety, false),
    uiView: {
      ...priorUiView,
      ...(whyHelp ? { whyHelp } : {}),
      body: {
        ...priorUiView.body,
        text: editedBodyText,
        generatedOriginState: 'pe_user_edited_body',
        dirtyState: 'dirty_user_edited',
        sendPolicy: safety.sendPolicy,
        fallbackMode: safety.fallbackMode,
      },
      diagnostics: [...priorUiView.diagnostics, ...publicDiagnostics],
    },
    diagnostics: [...result.diagnostics, ...publicDiagnostics],
  };
}

function rebuildWithSafety(
  result: PromptEnhancementPrepareResultV1,
  safety: PromptEnhancementSafetyValidationResult,
  disposition: PromptEnhancementPrepareResultV1['disposition'],
): PromptEnhancementPrepareResultV1 {
  const currentBody = { ...result.currentBody, generatedSafeStatus: safety.generatedSafeStatus };
  const { whyHelp: _priorWhyHelp, ...priorUiView } = result.uiView;
  const whyHelp = rebuildWhyHelpForSafety(result, safety);
  return {
    ...result,
    disposition,
    validationDecisionId: safety.validationDecisionId,
    currentBody,
    validationSummary: safety.safetySummary,
    safetySummary: safety.safetySummary,
    validationGraph: safety.validationGraph,
    delivery: { ...result.delivery, sendPolicy: safety.sendPolicy },
    uiView: {
      ...priorUiView,
      ...(whyHelp ? { whyHelp } : {}),
      body: { ...priorUiView.body, text: currentBody.text, sendPolicy: safety.sendPolicy },
    },
  };
}

function assertPrepareRequest(request: unknown): asserts request is PromptEnhancementPrepareRequestV1 {
  const validation = validatePromptEnhancementPrepareRequestV1(request);
  if (!validation.ok) throw new Error(`invalid_prompt_enhancement_request:${validation.reasonCodes.join(',')}`);
}

function dispositionFor(
  noPopup: boolean,
  body: PromptEnhancementCurrentBodyV1,
  safety: PromptEnhancementSafetyValidationResult,
): PromptEnhancementPrepareResultV1['disposition'] {
  if (noPopup) return 'no_popup_not_applicable';
  if (safety.sendPolicy === 'no_send' || safety.generatedSafeStatus === 'invalid_non_sendable') return 'blocked_no_send';
  if (safety.sendPolicy === 'send_original' || body.generatedOriginState === 'user_original') return 'fallback_to_original';
  return 'show_current_body';
}

function routeConfidence(value: ReturnType<typeof routePromptEnhancement>['routeConfidence']) {
  if (value === 'strong') return 'high' as const;
  if (value === 'partial') return 'medium' as const;
  if (value === 'missing') return 'none' as const;
  return 'low' as const;
}

function buildGeneratedOrigin(
  request: PromptEnhancementPrepareRequestV1,
  enhancementId: string,
  body: PromptEnhancementCurrentBodyV1,
): PromptEnhancementGeneratedOriginMetadataV1 {
  return {
    generatedOriginId: `${enhancementId}:origin:${body.currentBodyId}:${body.bodyRevision}`,
    generatedOriginState: body.generatedOriginState,
    enhancementId,
    bodyId: body.currentBodyId,
    bodyRevision: body.bodyRevision,
    deliveryChannel: request.hostSurface,
    sourceUseIds: body.sourceAttribution.map((source) => source.sourceRefId),
    echoRecursionGuard: {
      bodyFingerprintRef: `${body.currentBodyId}:${body.bodyRevision}`,
      sourcePromptEchoState: request.sourcePrompt.origin === 'pe_generated_echo' ? 'pe_generated_echo' : 'not_echo',
      lastInjectedPromptIsAuthority: false,
    },
    learningEligibility: {
      promptHistory: false,
      profile: false,
      stage: false,
      language: false,
      memory: false,
      telemetry: false,
      sourceUseTracking: body.sourceAttribution.length > 0,
    },
  };
}

function buildDelivery(
  request: PromptEnhancementPrepareRequestV1,
  safety: PromptEnhancementSafetyValidationResult,
  noPopup: boolean,
): PromptEnhancementDeliveryMetadataV1 {
  const stopBridge = request.hostSurface === 'cli_stop_bridge';
  return {
    deliveryChannel: request.hostSurface,
    sendPolicy: noPopup ? 'no_popup' : safety.sendPolicy,
    stopReasonCarriesTextOnly: stopBridge,
    rawTransportIsSemanticAuthority: false,
    hostCapabilityState: stopBridge ? 'stop_bridge_only' : 'unsupported',
    extensionPayloadState: request.hostSurface === 'extension_bridge' ? 'typed_payload_required' : 'not_applicable',
    hostCapabilityEvidenceRefs: request.sourceSignals.deliveryGateRefs,
    exposureAcknowledgementState: noPopup ? 'not_shown' : 'not_shown',
  };
}

function buildTrustCues(
  body: PromptEnhancementCurrentBodyV1,
  sourceGuidanceCoverage: PromptEnhancementComposeResult['sourceGuidanceCoverage'],
  safety: PromptEnhancementSafetyValidationResult,
): readonly PromptEnhancementPublicTrustCueV1[] {
  const cues: PromptEnhancementPublicTrustCueV1[] = [
    { cueId: 'original-prompt', label: 'original_prompt', publicSafeText: 'Your original request remains visible.', sourceRefIds: [], rawPrivateDataExcluded: true },
    { cueId: 'generated-origin', label: 'generated_source_state', publicSafeText: body.generatedOriginState === 'pe_generated_body' ? 'This body was prepared by Nexpath.' : 'The original request is preserved.', sourceRefIds: [], rawPrivateDataExcluded: true },
    { cueId: 'safety-state', label: 'safety_safeguard', publicSafeText: safety.safetySummary.noAutomaticSend ? 'Nexpath does not send automatically.' : 'Review the supplied send policy before continuing.', sourceRefIds: [], rawPrivateDataExcluded: true },
    { cueId: 'source-guidance', label: sourceGuidanceCoverage === 'covered' ? 'source_signal_guidance' : 'fallback_or_no_popup', publicSafeText: sourceGuidanceCoverage === 'covered' ? 'Grounded guidance is attached.' : 'No generated guidance was safely produced.', sourceRefIds: [], rawPrivateDataExcluded: true },
  ];
  return cues;
}

function diagnosticsFor(
  enhancementId: string,
  diagnostics: readonly { category: PromptEnhancementPublicDiagnosticV1['category']; reasonCode: string }[],
): readonly PromptEnhancementPublicDiagnosticV1[] {
  return diagnostics.map((diagnostic, index) => ({
    diagnosticId: `${enhancementId}:diagnostic:${index + 1}`,
    category: diagnostic.category,
    publicSafeText: diagnostic.reasonCode === 'additional_details_truncated_public_notice'
      ? 'Content beyond 5,000 words was truncated before recomposition.'
      : diagnostic.category === 'generated' ? 'Prepared prompt-enhancement body is available.' : 'Prompt-enhancement state was safely reduced.',
    rawPromptExcluded: true,
    rawGeneratedBodyExcluded: true,
    rawSourceExcerptExcluded: true,
    rawFeedbackExcluded: true,
    privateIdsExcluded: true,
    researchLabelsExcluded: true,
    rawReasonValuesExcluded: true,
  }));
}

function buildUiView(
  request: PromptEnhancementPrepareRequestV1,
  enhancementId: string,
  body: PromptEnhancementCurrentBodyV1,
  composed: PromptEnhancementComposeResult,
  safety: PromptEnhancementSafetyValidationResult,
  trustCues: readonly PromptEnhancementPublicTrustCueV1[],
  diagnostics: readonly PromptEnhancementPublicDiagnosticV1[],
  noPopup: boolean,
): PromptEnhancementUiViewPayloadV1 {
  const timestampMs = request.sourcePrompt.capturedAt ?? Date.now();
  const sectionsForFeedback: readonly PromptEnhancementSectionFeedbackViewV1[] = body.sections.map((section) => ({
    sectionId: section.sectionId,
    sectionKind: section.sectionKind,
    label: section.title,
    templateType: section.templateType,
    familyId: section.familyId,
    primaryIntent: section.primaryIntent,
    sourceKinds: [section.sourceKind],
    sourceIds: section.sourceIds,
    baselineSourceSignalSlot: section.baselineSourceSignalSlot,
    sourceEvidenceStatus: section.sourceEvidenceStatus,
    slotEvidenceStatus: section.slotEvidenceStatus,
    requirementSourceStatus: section.requirementSourceStatus,
    validationStatus: section.validationStatus,
    safetyFlags: section.safetyFlags,
    sensitivityFlags: section.sensitivityFlags,
    publicSafeExplanationCategory: section.publicExplanationCategory,
    fallbackMode: section.fallbackBehavior,
    callVisibilityMode: section.callVisibilityMode,
    spanRefs: section.spanRefs,
    preciseFeedbackAllowed: section.feedbackSensitivity === 'typed_feedback_allowed',
  }));
  return {
    viewPayloadVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
    enhancementId,
    body: {
      text: body.text.replace(
        ' [truncated_to_apply_details_5000_word_cap]',
        '',
      ),
      currentBodyId: body.currentBodyId,
      bodyRevision: body.bodyRevision,
      generatedOriginState: body.generatedOriginState,
      dirtyState: body.userDirtyState,
      originalPromptPreservation: body.originalPromptPreservation,
      levelState: request.userPreferenceContext.levelState,
      actionLoadingState: 'idle',
      sendPolicy: noPopup ? 'no_popup' : safety.sendPolicy,
      fallbackMode: composed.fallbackMode,
    },
    sectionsForFeedback,
    publicTrustCues: trustCues,
    actions: composed.availableActions,
    actionInputContract: {
      actionInputVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
      enhancementId,
      currentBodyId: body.currentBodyId,
      bodyRevision: body.bodyRevision,
      actionId: `${body.currentBodyId}:action:use_current_body`,
      hostSurface: request.hostSurface,
      deliveryChannel: request.hostSurface,
      rendererState: noPopup ? 'not_shown' : 'not_shown',
      exposureAcknowledgementState: 'not_shown',
      timestampMs,
      realUserInitiated: false,
      editedBodyTextPolicy: 'required_when_body_may_be_dirty',
      sectionSpanEditEventsPolicy: 'only_when_span_map_exact',
      additionalDetailsPolicy: 'bounded_recomposition_input_only',
    },
    diagnostics,
    hidesVisibleSectionControls: true,
    exposesPromptVariants: false,
    exposesForegroundSafer: false,
    textOnlyDeliveryIsAuthority: false,
  };
}

/**
 * Diagnosability (2026-08-06): explain why a prepared result carries NO handoff/sequence summary.
 * Pure + deterministic — reproduces the emission decision from the result itself so the runtime
 * (auto.ts) can LOG the exact failing handoff-validation checks that the self-guard, by design,
 * swallows (the public-diagnostics contract excludes raw reason values). Never throws.
 */
export function explainPromptEnhancementSequenceSummaryAbsenceV1(
  request: PromptEnhancementPrepareRequestV1,
  result: PromptEnhancementPrepareResultV1,
): readonly string[] {
  try {
    if (result.uiView.handoffAndSequenceSummary) return ['summary_present'];
    if (result.disposition !== 'show_current_body') return [`disposition:${result.disposition}`];
    const compound = result.routeDecision.compoundPromptState;
    const isCandidate = compound === 'multi_intent_one_prompt'
      || (compound === 'multi_point_same_intent' && result.routeDecision.userPointCoverageRefs.length >= 3);
    if (!isCandidate) return [`not_sequence_candidate:${compound}`];
    const handoff = buildPromptEnhancementHandoffMetadataV1({
      handoffDecisionId: `${result.enhancementId}:handoff`,
      requestId: request.requestId,
      projectRoot: request.projectRoot,
      currentBody: result.currentBody,
      safetySummary: result.validationSummary,
      handoffKind: 'compact_sequence_summary_candidate',
    });
    const validation = validatePromptEnhancementHandoffMetadataV1(
      handoff,
      result.currentBody,
      result.validationSummary,
      { requestId: request.requestId, projectRoot: request.projectRoot },
    );
    return validation.ok
      ? ['validation_ok_summary_unexpectedly_absent']
      : ['summary_dropped_by_validation', ...validation.reasonCodes.slice(0, 6)];
  } catch (error) {
    return [`explain_failed:${error instanceof Error ? error.name : 'unknown'}`];
  }
}
