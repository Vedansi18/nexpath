import {
  PROMPT_ENHANCEMENT_CONTRACT_VERSION,
  type PromptEnhancementCurrentBodyV1,
  type PromptEnhancementPrepareResultV1,
  type PromptEnhancementSafetySummaryV1,
} from './contracts.js';
import { buildPromptEnhancementHandoffMetadataV1 } from './handoff-metadata.js';
import type { PromptEnhancementSequencePackagerInputV1 } from './sequence-packager.js';
import type { PromptEnhancementSequenceItemV1 } from './sequence-payload.js';

/**
 * Assemble a continuation-shaped packager input at a continuation Stop.
 *
 * The Stop-time packager (`packagePromptEnhancementSequenceContinuationV1`) takes a full
 * `acceptedResult: PromptEnhancementPrepareResultV1`, but at a continuation Stop only the stored
 * sequence row, the redacted original prompt text, and the handoff kind are on hand — the original
 * result the sequence was offered from is long gone. This builder reconstructs the ONE
 * continuation-shaped `PromptEnhancementSequencePackagerInputV1` the packager needs, without
 * touching the packager or widening the shared `PrepareResultV1` contract.
 *
 * It is a pure function: no store, no client, no clock, no I/O. It is SAFE built-ahead code — it has
 * no live caller, does not touch the Stop hook, and removes no gate.
 *
 * What the continuation ACTUALLY consumes is narrow (see the P0 resolution design doc):
 *  - `currentBody.originalPromptText` — the REDACTED, length-preserving original the packager slices
 *    the served item's own original region out of (MPS-12 Ruling C). Everything else on `currentBody`
 *    is re-pointed by the packager from the served item + the ids below.
 *  - `handoffMetadata.handoffKind` — must be a continuable kind, or the packager refuses.
 *  - `availableActions` — filtered by the packager to the continuation set (`use_current_body`,
 *    `close`), so both must be present here to survive.
 * Every other `PrepareResultV1` field is spread through unread; those get valid typed defaults.
 */

/**
 * The two handoff kinds a continuation popup accepts. Mirrors `CONTINUATION_HANDOFF_KINDS_V1` in the
 * packager (which is module-private there); a non-continuable kind is refused at the popup boundary.
 */
export const CONTINUATION_HANDOFF_KINDS_V1 = [
  'first_prompt_handoff_candidate',
  'compact_sequence_summary_candidate',
] as const;
export type ContinuationHandoffKindV1 = typeof CONTINUATION_HANDOFF_KINDS_V1[number];

export interface AssembleContinuationPackagerInputV1 {
  /** The stored item list, exactly as written on the sequence row (`payload.items`). */
  items: readonly PromptEnhancementSequenceItemV1[];
  /** Which item to serve. 0-based; a continuation is always `1 … itemCount-1`. */
  currentItemIndex: number;
  /** The whole item count, from the row. */
  itemCount: number;
  /** The sequence id, from the row. Deterministic ids below derive from it + the index. */
  sequenceId: string;
  /** The enhancement id, from the row. */
  enhancementId: string;
  /** The project root, from the row. */
  projectRoot: string;
  /**
   * The REDACTED, length-preserving original prompt text stored with the row at intake. The item's
   * stored `originalSliceRef` offsets index it character-for-character, so the packager's MPS-12
   * slice `originalPromptText.slice(start, end)` yields the item's own original region.
   *
   * ⛔ MUST be the `redactSecrets` (length-preserving) copy — never raw text.
   */
  redactedOriginalPromptText: string;
  /** The stored handoff kind. MUST be a continuable kind (see `CONTINUATION_HANDOFF_KINDS_V1`). */
  handoffKind: ContinuationHandoffKindV1;
}

/**
 * A valid, typed `PromptEnhancementCurrentBodyV1` default. Its text fields, ids, and origin are all
 * re-pointed by the packager from the served item + the packager-input ids; the ONE field the
 * continuation reads from here is `originalPromptText`, which carries the redacted, length-preserving
 * original the packager slices the item's own region out of.
 *
 * Shape ported from the proven-valid `validResult()` fixture (`contracts.test.ts`).
 */
function continuationDefaultCurrentBodyV1(input: {
  currentBodyId: string;
  bodyRevision: number;
  composerRunId: string;
  nexpathGeneratedPromptRef: string;
  originalPromptText: string;
}): PromptEnhancementCurrentBodyV1 {
  return {
    currentBodyId: input.currentBodyId,
    bodyRevision: input.bodyRevision,
    composerRunId: input.composerRunId,
    routeDecisionId: 'continuation-route-decision-1',
    promptReviewOrigin: 'user_authored_current_prompt',
    promptReviewProcessingPolicy: 'eligible_for_initial_pe_route',
    sentPromptOrigin: 'sequence_handoff_owned_body',
    nexpathGeneratedPromptRef: input.nexpathGeneratedPromptRef,
    renderedPromptBody: 'Continuation body placeholder — re-pointed by the packager.',
    originalPromptSectionId: 'section-original',
    sourceAttribution: [
      {
        sourceRefId: 'src-a-1',
        sourceId: 'prompt:1',
        sourceKind: 'source_a_user_prompt',
        evidenceStatus: 'present',
        publicSafeLabel: 'current original prompt',
        privateIdPolicy: 'metadata_only_not_body',
      },
    ],
    llmCallPolicy: 'no_call',
    composerMode: 'baseline_deterministic_render',
    languagePolicyApplied: 'technical_english_default',
    languageValidationStatus: 'valid',
    effectiveLanguageState: 'unknown_default',
    languageSource: 'technical_english_default',
    languageConfidence: 'unknown',
    languagePolicy: 'technical_english_default',
    instructionPrecedenceState: 'generated_sections_qualify_original',
    originalAsSourceStatus: 'local_verbatim_source_context',
    composerClaims: ['claim:part-original'],
    sourceFactIds: ['part-original'],
    localOriginalPromptIncluded: true,
    text: 'Continuation body placeholder — re-pointed by the packager.',
    originalPromptText: input.originalPromptText,
    originalPromptPreservation: 'visible_verbatim',
    generatedOriginState: 'pe_generated_body',
    generatedSafeStatus: 'valid',
    userDirtyState: 'clean',
    sections: [
      {
        sectionId: 'section-original',
        sectionKind: 'original_request',
        title: 'Original request',
        bodyText: 'Continuation body placeholder — re-pointed by the packager.',
        templateType: 'debug_repair',
        familyId: 'debug_maintenance',
        primaryIntent: 'debug_and_verify',
        registryNamespace: 'prompt-enhancement-templates',
        sourceTemplateType: 'prompt_enhancement_template',
        sourceKind: 'source_a_user_prompt',
        sourceIds: ['prompt:1'],
        sourceFactIds: ['part-original'],
        routeCandidateRefs: ['pe-template-debug-repair'],
        evidenceStatus: 'present',
        sourceEvidenceStatus: 'present',
        slotEvidenceStatus: 'present',
        baselineSourceSignalSlot: 'debugging_observation_gap',
        requirementSourceStatus: 'present',
        requiredSurvivor: true,
        mandatoryFloor: true,
        depthState: 'required_survivor',
        axisContributions: ['practiceDepth', 'sectionDensity'],
        canMergeInShorter: false,
        canExpandInMoreThorough: true,
        canGroundInMoreProjectGrounded: true,
        feedbackSensitivity: 'protected',
        fallbackBehavior: 'none',
        handoffFlags: ['no_runtime_sequence_v1'],
        privacyClass: 'local_private',
        publicCopySafe: true,
        authorityBoundary: 'no_authority_escalation',
        confirmationRequired: false,
        confirmationPresent: false,
        isEditable: true,
        removalFeedbackPolicy: 'typed_event_required',
        validationStatus: 'valid',
        safetyFlags: [],
        sensitivityFlags: [],
        spanRefs: [
          {
            spanRefId: 'span-original-1',
            sectionId: 'section-original',
            startOffset: 0,
            endOffset: 96,
            sourceRefs: ['src-a-1'],
            spanMappingStatus: 'exact',
            textStoragePolicy: 'text_in_body_only',
          },
        ],
        // T2 carriers. This fixture's body is a placeholder the packager re-points, so it
        // quotes no original text — recorded as a REFUSED ref with its reason rather than
        // an empty list, which would read as "nothing to quote" instead of "not located".
        originalTextRefs: [
          {
            refId: 'section-original:otr:1',
            sectionId: 'section-original',
            startOffset: -1,
            endOffset: -1,
            resolution: 'refused',
            refusalReason: 'not_found_in_original',
          },
        ],
        promptPointRefs: [
          {
            refId: 'section-original:ppr:1',
            sectionId: 'section-original',
            promptPointId: 'part-original',
            resolution: 'exact',
          },
        ],
        transformReasonCodes: ['preserved_verbatim', 'no_original_text_quoted'],
        publicExplanationCategory: 'source_coverage',
        whyHelpReasonCodes: ['part-original'],
        callVisibilityMode: 'deterministic',
        contentTemplateRuntimeSeamUse: 'none',
        handoffCapabilityFlags: ['no_runtime_sequence_v1'],
      },
    ],
  };
}

/**
 * Build the full, typed continuation-shaped `PrepareResultV1` default. Every field is a valid typed
 * default reused from the proven `validResult()` fixture, except: `currentBody.originalPromptText`
 * (the redacted original — consumed), `availableActions` (the continuation set — filtered), and
 * `handoffMetadata` (a real continuable handoff built by the shared production builder).
 */
function continuationDefaultPrepareResultV1(input: {
  enhancementId: string;
  requestId: string;
  projectRoot: string;
  currentBody: PromptEnhancementCurrentBodyV1;
  handoffDecisionId: string;
  handoffKind: ContinuationHandoffKindV1;
}): PromptEnhancementPrepareResultV1 {
  const { currentBody } = input;
  const safetySummary: PromptEnhancementSafetySummaryV1 = {
    validationStatus: 'valid',
    sendPolicy: 'send_current',
    sensitiveActionState: 'none',
    sourceHonestyState: 'valid',
    privacyState: 'valid',
    authorityEscalationState: 'valid',
    noForegroundSafer: true,
    noAutomaticSend: true,
  };
  const callVisibility = {
    callOwner: 'content_semantics',
    callVisibilityMode: 'deterministic',
    callTrigger: 'prepare',
    optionalCallAvailabilityState: 'deterministic_only',
    timeoutMs: 0,
    estimatedInputTokens: 0,
    estimatedOutputTokens: 0,
    plannedCallCount: 0,
    usedCallCount: 0,
    providerAvailabilityState: 'not_applicable',
    fallbackReason: 'not_applicable',
    priorCallAccountingRefs: [],
    localLoggingHookState: 'counts_only',
    productValueSignoffRef: 'accepted_with_product_scope_notes',
    productValueDiscussionIsRuntimeLimiter: false,
  } as const;
  // The continuation surface offers exactly these two; the packager filters `availableActions` to
  // this same set, so both must be present here to survive.
  const availableActions = [
    {
      actionId: 'act-use-current',
      actionType: 'use_current_body',
      label: 'Use this prompt',
      currentBodyId: currentBody.currentBodyId,
      bodyRevision: currentBody.bodyRevision,
      availability: 'available',
      callVisibilityMode: 'deterministic',
    },
    {
      actionId: 'act-close',
      actionType: 'close',
      label: 'Close',
      currentBodyId: currentBody.currentBodyId,
      bodyRevision: currentBody.bodyRevision,
      availability: 'available',
      callVisibilityMode: 'deterministic',
    },
  ] as const;
  const handoffMetadata = buildPromptEnhancementHandoffMetadataV1({
    handoffDecisionId: input.handoffDecisionId,
    requestId: input.requestId,
    projectRoot: input.projectRoot,
    currentBody,
    safetySummary,
    handoffKind: input.handoffKind,
  });
  return {
    schemaVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
    enhancementId: input.enhancementId,
    requestId: input.requestId,
    projectRoot: input.projectRoot,
    modelVersion: 'continuation-shell-v1',
    disposition: 'show_current_body',
    validationDecisionId: `${currentBody.currentBodyId}:validation:${currentBody.bodyRevision}:final_body`,
    currentBody,
    availableActions: availableActions.map((action) => ({ ...action })),
    handoffMetadata,
    sourceGuidanceCoverage: 'covered',
    routingAndFeedbackDecision: {
      state: 'show',
      confidence: 'high',
      reasonCodes: ['source_a_plus_shared_absence'],
      scopedPromptKindKey: 'debug_and_verify',
      priorFeedbackEvidenceRefs: [],
      resetExpiryState: 'not_applicable',
      selectedFamilyId: 'debug_maintenance',
      selectedTagIds: ['debug'],
      selectedLevelState: 'default',
      selectedSectionPivotIds: ['section-original'],
    },
    routeDecision: {
      routeDecisionId: currentBody.routeDecisionId,
      promptReviewOrigin: 'user_authored_current_prompt',
      promptReviewProcessingPolicy: 'eligible_for_initial_pe_route',
      familyId: 'issue_debug',
      primaryIntent: 'issue_debug.failing_test',
      capabilityOverlays: ['capability.reproduction_or_evidence_needed', 'capability.verification_required'],
      compoundPromptState: 'single_intent',
      userPointCoverageRefs: ['src-a-1'],
      nonPrimaryUserIntentHandling: 'covered_by_primary',
      selectedTemplateRef: {
        schemaVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
        templateId: 'pe-template-debug-repair',
        registryNamespace: 'prompt-enhancement-templates',
        templateType: 'debug_repair',
        familyId: 'debug_maintenance',
        displayLabel: 'Debug repair',
        primaryIntent: 'debug_and_verify',
        intentTags: ['debug', 'verify'],
        capabilityIds: ['debug', 'verify'],
        triggerHints: ['debugging_observation_gap'],
        supportedLevels: ['default', 'shorter', 'more_thorough', 'more_project_grounded'],
        defaultLevel: 'default',
        applicabilityAxes: ['stage', 'absence', 'source_a'],
        applicabilityGuards: ['source_a_required'],
        sourcePriorityState: 'source_a_first',
        targetScopePolicy: 'source_a_plus_grounded_support',
        capabilityRequirements: ['test_reproduction', 'verification'],
        requiredSectionKinds: ['original_request', 'grounded_plan'],
        optionalSectionKinds: ['verification_notes'],
        sectionSlots: ['original', 'plan'],
        sectionOrderPolicy: 'fixed_required_before_optional',
        sourceGuidanceFloorPolicy: 'required_when_popup_shown',
        originalPromptPreservationPolicy: 'visible_verbatim_required',
        allowedSourceKinds: ['source_a_user_prompt', 'content_template_fact', 'stage_or_absence_signal'],
        requiredSourceACoverage: 'visible_original_prompt',
        allowedSourceBSupportKinds: ['content_template_fact', 'stage_or_absence_signal'],
        baselineSourceSignalSlot: 'debugging_observation_gap',
        sourceEvidenceStatusRules: ['present', 'not_applicable', 'unknown', 'failed_fallback'],
        contentTemplateInputRefs: ['ct:ABSENCE_DEBUGGING_OBSERVATION'],
        safetyHookIds: ['voice_policy', 'source_honesty'],
        sensitivityPolicy: 'deterministic_flags_required',
        voicePolicyRef: 'user_to_agent_voice',
        confirmationRequirementPolicy: 'preserve_when_required',
        supportedDirectionalActions: ['shorter', 'more_thorough', 'more_project_grounded', 'apply_details'],
        composerPolicy: 'deterministic_only',
        deterministicRendererId: 'deterministic-joined-body-v1',
        llmCallPolicy: 'no_call',
        tokenTimeoutProfileRef: 'cost-default',
        validationRequirementIds: ['original_preserved', 'source_honesty'],
        fallbackReasonCodes: ['provider_unavailable', 'validation_failed', 'not_applicable'],
        publicSafeDiagnosticCodes: ['generated', 'source_coverage', 'validation_failed'],
        fallbackPolicy: 'deterministic_body',
        testFixtureIds: ['pe-contract-valid-one-body'],
        invariantIds: ['one_current_body', 'no_old_ds_options'],
        ownerArea: 'content_semantics',
        launchVisibility: 'private_until_launch_recheck',
        publicSafeSourceNotes: ['Content-template refs are Source B only.'],
        routeFixtureIds: ['route-debug-maintenance'],
        evaluationFixtureIds: ['eval-debug-maintenance'],
      },
      secondaryIntentTags: [],
      routeCandidates: [
        {
          routeId: 'pe-route-issue-debug-failing-test',
          familyId: 'debug_maintenance',
          primaryIntent: 'debug_and_verify',
          capabilityIds: ['debug', 'verify'],
          evidenceRefs: ['src-a-1'],
          confidence: 'strong',
          state: 'selected',
        },
      ],
      candidateRouteIds: ['pe-route-issue-debug-failing-test', 'pe-route-feature-fresh-implementation'],
      rejectedRouteReasonCodes: ['lower_source_match'],
      rejectedRoutes: [
        {
          routeId: 'pe-route-feature-fresh-implementation',
          reasonCode: 'lower_source_match',
          publicSafeReasonCategory: 'source_coverage',
        },
      ],
      routeConfidence: 'strong',
      signalProvenance: ['classifier_fire_recommendation'],
      sourceSignalRole: 'effective_fired_advisory_source',
      sourceSignalPolicy: 'render_baseline_guidance',
      sectionPlanRefs: ['section-plan-original'],
      fallbackMode: 'none',
      llmRoutePolicy: {
        mode: 'no_call',
        owner: 'content_semantics',
        costWorksheetRow: 'not_applicable_deterministic',
        freeformRouteOutputAllowed: false,
      },
      ambiguityState: 'clear',
      suppressionState: 'not_suppressed',
      routeInputEvidenceRefs: ['src-a-1', 'ct:ABSENCE_DEBUGGING_OBSERVATION'],
      routeEvidence: ['src-a-1', 'ct:ABSENCE_DEBUGGING_OBSERVATION'],
      registryLinkedFixtureIds: ['route-debug-maintenance'],
      usesPeOnlyClassifier: false,
      usesOldStaticDecisionSessionMap: false,
    },
    bodyPlan: {
      bodyPlanId: 'body-plan-1',
      bodyRevision: currentBody.bodyRevision,
      routeDecisionId: currentBody.routeDecisionId,
      orderedSectionPlans: [
        {
          sectionPlanId: 'section-plan-original',
          sectionId: 'section-original',
          sectionKind: 'original_request',
          templateId: 'pe-template-debug-repair',
          familyId: 'debug_maintenance',
          primaryIntent: 'debug_and_verify',
          order: 1,
          sourceRefs: [
            {
              sourceRefId: 'src-a-1',
              sourceKind: 'source_a_user_prompt',
              sourceId: 'prompt:1',
              sourceAuthorization: 'implementation_input',
              evidenceStatus: 'present',
              freshness: 'current',
              confidence: 'high',
              privacyClass: 'local_private',
            },
          ],
          sourceKind: 'source_a_user_prompt',
          sourceIds: ['prompt:1'],
          sourceEvidenceStatus: 'present',
          slotEvidenceStatus: 'present',
          baselineSourceSignalSlot: 'debugging_observation_gap',
          requirementSourceStatus: 'present',
          isRequired: true,
          isEditable: true,
          removalFeedbackPolicy: 'typed_event_required',
          safetyFlags: [],
          sensitivityFlags: [],
          validationStatus: 'valid',
          fallbackMode: 'none',
          callVisibilityMode: 'deterministic',
          deterministicTextBasisPolicy: 'structured_parts',
          textDraftRef: 'draft-original',
          structuredContentPartRefs: ['part-original'],
          supportedActions: ['use_current_body', 'shorter', 'more_thorough', 'more_project_grounded', 'apply_details'],
          contentTemplateRuntimeSeamUse: 'none',
          handoffCapabilityFlags: ['no_runtime_sequence_v1'],
        },
      ],
      originalPromptPreservation: 'visible_verbatim',
      groundedSourceGuidancePolicy: 'required_when_popup_shown',
      generatedOriginPolicy: 'attach_generated_origin_metadata',
      futurePromptTextPolicy: 'not_generated_not_stored_not_rendered',
      exposesPrecomputedVariants: false,
    },
    composerBoundary: {
      composerBoundaryVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
      composerPolicy: 'deterministic_only',
      composerRunId: currentBody.composerRunId,
      routeDecisionId: currentBody.routeDecisionId,
      promptReviewOrigin: 'user_authored_current_prompt',
      promptReviewProcessingPolicy: 'eligible_for_initial_pe_route',
      sentPromptOrigin: 'sequence_handoff_owned_body',
      nexpathGeneratedPromptRef: currentBody.nexpathGeneratedPromptRef,
      renderedPromptBody: currentBody.renderedPromptBody,
      originalPromptSectionId: 'section-original',
      sourceAttribution: [
        {
          sourceRefId: 'src-a-1',
          sourceId: 'prompt:1',
          sourceKind: 'source_a_user_prompt',
          evidenceStatus: 'present',
          publicSafeLabel: 'current original prompt',
          privateIdPolicy: 'metadata_only_not_body',
        },
      ],
      llmCallPolicy: 'no_call',
      rawComposerOutput: 'not_used_deterministic',
      validatedCanonicalPromptArtifact: 'current_body_v1',
      composerMode: 'baseline_deterministic_render',
      budgetState: {
        llmCallPolicy: 'no_call',
        callVisibilityMode: 'deterministic',
        productValueDiscussionIsRuntimeLimiter: false,
      },
      languagePolicyApplied: 'technical_english_default',
      languageValidationStatus: 'valid',
      effectiveLanguageState: 'unknown_default',
      languageSource: 'technical_english_default',
      languageConfidence: 'unknown',
      languagePolicy: 'technical_english_default',
      instructionPrecedenceState: 'generated_sections_qualify_original',
      originalAsSourceStatus: 'local_verbatim_source_context',
      composerClaims: ['claim:part-original'],
      sourceFactIds: ['part-original'],
      localRenderOriginalPrompt: true,
      composerVisiblePromptContext: {
        contextPolicy: 'structured_refs_only_no_raw_original',
        originalPromptVisibleLocallyOnly: true,
        boundedContextRefCount: 2,
        rawPromptTextExcluded: true,
      },
      composerVisiblePromptContextRefs: ['src-a-1', 'part-original'],
      composerInputPrivacyState: 'approved_refs_only',
      localOriginalPromptIncluded: true,
      strictSchemaFailureReasonCodes: [
        'invalid_json',
        'duplicate_key',
        'unknown_field',
        'invalid_enum',
        'bad_reference',
        'output_cap_exceeded',
        'unsafe_metadata_copy',
      ],
      fallbackReasonCodes: ['not_applicable'],
      inputContract: {
        originalPromptRef: {
          sourceRefId: 'src-a-1',
          sourceKind: 'source_a_user_prompt',
          sourceId: 'prompt:1',
          sourceAuthorization: 'implementation_input',
          evidenceStatus: 'present',
          freshness: 'current',
          confidence: 'high',
          privacyClass: 'local_private',
        },
        bodyPlanId: 'body-plan-1',
        sectionPlanIds: ['section-plan-original'],
        boundedSourceSummaryRefs: ['ct:ABSENCE_DEBUGGING_OBSERVATION'],
        privacyApprovedFactsOnly: true,
        callVisibilityState: callVisibility,
        excludesRawStoreRows: true,
        excludesOldDecisionSessionOptionText: true,
        excludesUiInferredBusinessState: true,
      },
      outputContract: {
        structuredSectionsRequired: true,
        joinedCurrentBodyRequired: true,
        preservesSectionIds: true,
        preservesSourceRefs: true,
        preservesSafetyRequirements: true,
        textOnlyOutputAllowed: false,
      },
      deterministicFallback: {
        available: true,
        fallbackMode: 'deterministic_body',
        productValueDiscussionIsRuntimeLimiter: false,
      },
    },
    validationSummary: safetySummary,
    safetySummary,
    validationGraph: {
      graphVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
      graphOwner: 'content_semantics',
      phaseStates: ([
        'request',
        'pre_plan',
        'section_plan',
        'composer_input',
        'composer_output',
        'final_body',
        'user_edit',
        'action',
        'delivery',
        'storage',
        'source_use',
        'privacy',
        'handoff',
        'sequence',
        'launch_check',
      ] as const).map((stage) => ({
        stage,
        status: 'valid' as const,
        fallbackMode: 'none' as const,
        failureCodes: [] as readonly string[],
        publicSafeReasonCategory: 'generated' as const,
      })),
      failures: [],
      safetyState: safetySummary,
      providerRuntimeState: 'deterministic',
      optionalCallAvailabilityState: 'deterministic_only',
      rawTransportIsValidationProof: false,
      evaluatesAgentResponseQuality: false,
      canAutoAdvanceSequencePointer: false,
    },
    callAndVisibilityMetadata: callVisibility,
    uiView: {
      viewPayloadVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
      enhancementId: input.enhancementId,
      body: {
        text: currentBody.renderedPromptBody,
        currentBodyId: currentBody.currentBodyId,
        bodyRevision: currentBody.bodyRevision,
        generatedOriginState: 'pe_generated_body',
        dirtyState: 'clean',
        originalPromptPreservation: 'visible_verbatim',
        levelState: 'default',
        actionLoadingState: 'idle',
        sendPolicy: 'send_current',
        fallbackMode: 'none',
      },
      sectionsForFeedback: [
        {
          sectionId: 'section-original',
          sectionKind: 'original_request',
          label: 'Original request',
          templateType: 'debug_repair',
          familyId: 'debug_maintenance',
          primaryIntent: 'debug_and_verify',
          sourceKinds: ['source_a_user_prompt'],
          sourceIds: ['prompt:1'],
          baselineSourceSignalSlot: 'debugging_observation_gap',
          sourceEvidenceStatus: 'present',
          slotEvidenceStatus: 'present',
          requirementSourceStatus: 'present',
          validationStatus: 'valid',
          safetyFlags: [],
          sensitivityFlags: [],
          publicSafeExplanationCategory: 'source_coverage',
          fallbackMode: 'none',
          callVisibilityMode: 'deterministic',
          spanRefs: [
            {
              spanRefId: 'span-original-1',
              sectionId: 'section-original',
              startOffset: 0,
              endOffset: 96,
              sourceRefs: ['src-a-1'],
              spanMappingStatus: 'exact',
              textStoragePolicy: 'text_in_body_only',
            },
          ],
          preciseFeedbackAllowed: true,
        },
      ],
      publicTrustCues: [
        {
          cueId: 'cue-original',
          label: 'original_prompt',
          publicSafeText: 'Original prompt preserved.',
          sourceRefIds: ['src-a-1'],
          rawPrivateDataExcluded: true,
        },
        {
          cueId: 'cue-safety',
          label: 'safety_safeguard',
          publicSafeText: 'Safety validation passed.',
          sourceRefIds: [],
          rawPrivateDataExcluded: true,
        },
      ],
      actions: availableActions.map((action) => ({ ...action })),
      actionInputContract: {
        actionInputVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
        enhancementId: input.enhancementId,
        currentBodyId: currentBody.currentBodyId,
        bodyRevision: currentBody.bodyRevision,
        actionId: 'act-use-current',
        hostSurface: 'cli_stop_bridge',
        deliveryChannel: 'cli_stop_bridge',
        rendererState: 'shown',
        exposureAcknowledgementState: 'shown',
        timestampMs: 1,
        realUserInitiated: true,
        editedBodyTextPolicy: 'required_when_body_may_be_dirty',
        sectionSpanEditEventsPolicy: 'only_when_span_map_exact',
        additionalDetailsPolicy: 'bounded_recomposition_input_only',
      },
      handoffAndSequenceSummary: handoffMetadata,
      diagnostics: [
        {
          diagnosticId: 'diagnostic-generated',
          category: 'generated',
          publicSafeText: 'Generated prompt is ready.',
          rawPromptExcluded: true,
          rawGeneratedBodyExcluded: true,
          rawSourceExcerptExcluded: true,
          rawFeedbackExcluded: true,
          privateIdsExcluded: true,
          researchLabelsExcluded: true,
          rawReasonValuesExcluded: true,
        },
      ],
      hidesVisibleSectionControls: true,
      exposesPromptVariants: false,
      exposesForegroundSafer: false,
      textOnlyDeliveryIsAuthority: false,
    },
    generatedOrigin: {
      generatedOriginId: 'origin-1',
      generatedOriginState: 'pe_generated_body',
      enhancementId: input.enhancementId,
      bodyId: currentBody.currentBodyId,
      bodyRevision: currentBody.bodyRevision,
      deliveryChannel: 'cli_stop_bridge',
      sourceUseIds: ['source-use-1'],
      echoRecursionGuard: {
        bodyFingerprintRef: 'body-fingerprint-1',
        sourcePromptEchoState: 'not_echo',
        lastInjectedPromptIsAuthority: false,
      },
      learningEligibility: {
        promptHistory: false,
        profile: false,
        stage: false,
        language: false,
        memory: false,
        telemetry: false,
        sourceUseTracking: true,
      },
    },
    delivery: {
      deliveryChannel: 'cli_stop_bridge',
      sendPolicy: 'send_current',
      stopReasonCarriesTextOnly: true,
      rawTransportIsSemanticAuthority: false,
      hostCapabilityState: 'stop_bridge_only',
      extensionPayloadState: 'not_applicable',
      hostCapabilityEvidenceRefs: ['stop-bridge-current'],
      exposureAcknowledgementState: 'shown',
    },
    ownership: {
      owners: ['content_semantics', 'ui_app', 'host_transport'],
      sourceSnapshotVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
      fixtureIds: ['pe-contract-valid-one-body'],
      launchBoundaryRecheckRef: 'launch_boundary_recheck_pending',
      excludesPrivatePlanningLeakage: true,
    },
    diagnostics: [
      {
        diagnosticId: 'diagnostic-continuation-shell',
        category: 'generated',
        publicSafeText: 'Public-safe continuation shell default.',
        rawPromptExcluded: true,
        rawGeneratedBodyExcluded: true,
        rawSourceExcerptExcluded: true,
        rawFeedbackExcluded: true,
        privateIdsExcluded: true,
        researchLabelsExcluded: true,
        rawReasonValuesExcluded: true,
      },
    ],
  };
}

/**
 * Assemble the packager input for the current continuation item.
 *
 * The per-body ids are derived deterministically from `sequenceId` + `currentItemIndex`, so the same
 * item re-offered assembles the same ids — the packager's "same item, same text" guarantee extends to
 * the identifiers, not just the wording.
 */
export function assembleContinuationPackagerInputV1(
  input: AssembleContinuationPackagerInputV1,
): PromptEnhancementSequencePackagerInputV1 {
  const base = `${input.sequenceId}:item:${input.currentItemIndex}`;
  const currentBodyId = `${base}:body`;
  // Deterministic, consistent across the packager's event/body agreement checks. The item's first
  // offering, so its revision is 0.
  const bodyRevision = 0;
  const composerRunId = `${base}:composer-run`;
  const nexpathGeneratedPromptRef = `${base}:generated`;
  const validationDecisionId = `${base}:validation`;
  const handoffDecisionId = `${base}:handoff`;

  const currentBody = continuationDefaultCurrentBodyV1({
    currentBodyId,
    bodyRevision,
    composerRunId,
    nexpathGeneratedPromptRef,
    // ⛔ The redacted, length-preserving original — the packager slices the served item's own
    // original region out of THIS (MPS-12 Ruling C). Never raw text.
    originalPromptText: input.redactedOriginalPromptText,
  });

  const acceptedResult = continuationDefaultPrepareResultV1({
    enhancementId: input.enhancementId,
    requestId: `${input.sequenceId}:continuation`,
    projectRoot: input.projectRoot,
    currentBody,
    handoffDecisionId,
    handoffKind: input.handoffKind,
  });

  return {
    acceptedResult,
    items: input.items,
    currentItemIndex: input.currentItemIndex,
    itemCount: input.itemCount,
    sequenceId: input.sequenceId,
    sequenceItemId: base,
    currentItemRevision: 0,
    bodyRevision,
    currentBodyId,
    nexpathGeneratedPromptRef,
    validationDecisionId,
    composerRunId,
    handoffDecisionId,
    compactSummaryId: `${base}:summary`,
  };
}
