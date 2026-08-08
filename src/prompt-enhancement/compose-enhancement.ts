import {
  PROMPT_ENHANCEMENT_CONTRACT_VERSION,
  type PromptEnhancementActionEntryV1,
  type PromptEnhancementActionType,
  type PromptEnhancementCallVisibilityMode,
  type PromptEnhancementComposerBoundaryV1,
  type PromptEnhancementComposerMode,
  type PromptEnhancementCostCallIdV1,
  type PromptEnhancementCostVisibilityMetadataV1,
  type PromptEnhancementCurrentBodyV1,
  type PromptEnhancementFallbackMode,
  type PromptEnhancementInstructionPrecedenceState,
  type PromptEnhancementOriginalAsSourceStatus,
  type PromptEnhancementPublicDiagnosticCategory,
  type PromptEnhancementRuntimeBlockReason,
  type PromptEnhancementSectionV1,
  type PromptEnhancementSectionPlanItemV1,
  type PromptEnhancementSendPolicy,
  type PromptEnhancementSentPromptOrigin,
  type PromptEnhancementSourceAttributionV1,
  type PromptEnhancementSourceRefV1,
  type PromptEnhancementSpanRefV1,
  type PromptEnhancementValidationStatus,
} from './contracts.js';
import { buildPromptEnhancementCostVisibilityMetadataV1 } from './cost-observability.js';
import type { PromptEnhancementPrimaryIntent } from './routing-taxonomy.js';
import {
  buildPromptEnhancementCanonicalConfirmation,
  promptEnhancementGeneratedBodyRequiresConfirmationV1,
  requiresPromptEnhancementExecutionConfirmationForPrompt,
  validatePromptEnhancementSafety,
} from './safety-sendability.js';
import { getPromptEnhancementTemplateByIntent } from './templates/registry.js';
import type { PromptEnhancementSectionPlanningResult } from './templates/section-plan.js';

export type PromptEnhancementComposerAction =
  | 'default'
  | Extract<PromptEnhancementActionType, 'shorter' | 'more_thorough' | 'more_project_grounded' | 'apply_details'>;

export type PromptEnhancementComposerRuntimeState =
  | 'not_requested'
  | 'accepted_structured_output'
  | 'invalid_output'
  | 'timeout'
  | 'provider_unavailable'
  | 'validation_failed';

export interface PromptEnhancementComposeInput {
  enhancementId: string;
  originalPromptText: string;
  sectionPlanningResult: PromptEnhancementSectionPlanningResult;
  editedBodyText?: string;
  action?: PromptEnhancementComposerAction;
  additionalDetailsText?: string;
  acceptedAdditionalDetailsText?: string;
  composerRuntimeState?: PromptEnhancementComposerRuntimeState;
  structuredComposerOutput?: PromptEnhancementStructuredComposerOutputV1;
  previousSendableBody?: PromptEnhancementCurrentBodyV1;
  priorBodyId?: string;
  priorBodyRevision?: number;
  timestampMs?: number;
}

export interface PromptEnhancementStructuredComposerOutputV1 {
  outputId: string;
  sectionDrafts: readonly {
    sectionId: string;
    bodyText: string;
    sourceFactIds: readonly string[];
  }[];
  composerClaims: readonly string[];
  // E5: the composer self-reports the detected language of the original prompt
  // (BCP-47-ish, e.g. 'en' / 'hi' / 'hi-Latn' Hinglish / 'gu-Latn' Gujlish). Read by
  // the E5 language-consistency gate; optional so pre-E5 callers stay valid.
  detectedLanguageSelfReport?: string;
  // The composer self-reports the authority mode of the wording it just produced, so drift from a
  // plan/review request into execution instructions can be caught and rewritten while the composer is
  // still running. Read ONLY by the authority-consistency gate to trigger a retry — it never relaxes
  // the deterministic safety verdict. Optional so pre-existing callers stay valid.
  authorityModeSelfReport?: 'plan_or_review' | 'execute_requested' | 'observe_or_literal';
  // The single most action-oriented sentence the composer produced, quoted verbatim, which is the
  // evidence its authorityModeSelfReport verdict was reached from. Asking for the quote BEFORE the
  // verdict is what makes the verdict describe the produced text rather than the request that was
  // made — without it the model answers from intent ("I was asked to plan, so this is planning") and
  // reports 'plan_or_review' for wording that plainly instructs a deploy. Optional: a missing quote
  // is not drift, exactly as a missing self-report is not drift.
  authorityEvidence?: string;
  // The composer's reading of the ORIGINAL REQUEST's mode, which is a different question from
  // authorityModeSelfReport (the mode of the text it produced).
  //
  // An escalation is only meaningful as "a plan/review request answered with execution wording", so
  // both layers that judge it must first decide what the request was — and both decided it with the
  // same word list, which is the mechanism that misfires. When that list misreads the request, the
  // composer-side gate skips itself entirely. Carrying the model's own reading lets either source
  // establish plan/review intent, so a word-list miss no longer disables the check.
  //
  // Widening only: this can cause the gate to run when it otherwise would not. It can never stop the
  // gate from running, and it never clears a deterministic verdict.
  requestModeSelfReport?: 'plan_or_review' | 'execute_requested' | 'observe_or_literal';
}

export interface PromptEnhancementComposeResult {
  currentBody: PromptEnhancementCurrentBodyV1;
  composerBoundary: PromptEnhancementComposerBoundaryV1;
  availableActions: readonly PromptEnhancementActionEntryV1[];
  bodySectionAgreement: 'exact';
  sourceGuidanceCoverage: 'covered' | 'fallback_no_generated_body' | 'not_applicable';
  fallbackMode: PromptEnhancementFallbackMode;
  sendPolicy: PromptEnhancementSendPolicy;
  actionInteractionState:
    | 'idle'
    | 'success_replaced_body'
    | 'timeout_kept_previous'
    | 'fallback_previous_body'
    | 'fallback_only';
  callVisibilityMode: PromptEnhancementCallVisibilityMode;
  diagnostics: readonly {
    category: PromptEnhancementPublicDiagnosticCategory;
    reasonCode: string;
  }[];
}

/**
 * Why a composer reply was refused. The validator used to reject silently, so a body that lost the
 * model's wording was indistinguishable from one that never had any — the same blindness that hid the
 * provider-failure cause. Reporting the rule that fired makes the loss diagnosable.
 */
type PromptEnhancementComposerDraftRejectionReason =
  NonNullable<PromptEnhancementComposerBoundaryV1['draftRejectionReason']>;

interface ValidatedStructuredComposerDrafts {
  readonly draftsBySectionId: ReadonlyMap<string, string>;
  readonly composerClaims: readonly string[];
  readonly rejectionReason?: PromptEnhancementComposerDraftRejectionReason;
}

const ADDITIONAL_DETAILS_WORD_CAP = 5000;
const ORIGINAL_HEADING = 'My original request (verbatim)';

const ACTION_LABELS: Record<PromptEnhancementActionType, PromptEnhancementActionEntryV1['label']> = {
  use_current_body: 'Use this prompt',
  use_original: 'Use original',
  shorter: 'Shorter',
  more_thorough: 'More thorough',
  more_project_grounded: 'More project-grounded',
  apply_details: 'Apply details',
  feedback: 'Feedback',
  close: 'Close',
};

export function composePromptEnhancementBody(input: PromptEnhancementComposeInput): PromptEnhancementComposeResult {
  const action = input.action ?? 'default';
  const runtimeState = input.composerRuntimeState ?? 'not_requested';
  const sectionPlans = selectSectionPlansForAction(
    input.sectionPlanningResult,
    action,
    hasAcceptedAdditionalDetails(input),
  );
  const validatedLlmDrafts = validatedStructuredComposerDrafts(input.structuredComposerOutput, sectionPlans);
  const structuredComposerAttempted = runtimeState === 'accepted_structured_output' && input.structuredComposerOutput !== undefined;
  const structuredComposerRejected = structuredComposerAttempted && validatedLlmDrafts.draftsBySectionId.size === 0;
  const effectiveRuntimeState: PromptEnhancementComposerRuntimeState = structuredComposerRejected
    ? 'validation_failed'
    : runtimeState;
  const deterministicFallback = fallbackModeForRuntime(effectiveRuntimeState, sectionPlans.length);
  const usesLlmWording = structuredComposerAttempted && !structuredComposerRejected && validatedLlmDrafts.draftsBySectionId.size > 0;
  const llmCallPolicy = llmCallPolicyForRuntime(runtimeState, structuredComposerAttempted);
  const priorBodyId = input.priorBodyId ?? input.previousSendableBody?.currentBodyId;
  const priorBodyRevision = input.priorBodyRevision ?? input.previousSendableBody?.bodyRevision;
  const currentBodyId = priorBodyId ?? `${input.enhancementId}:body`;
  const bodyRevision = priorBodyRevision === undefined ? 1 : priorBodyRevision + 1;
  const composerRunId = `${input.enhancementId}:composer:${action}:${bodyRevision}`;

  if (action !== 'default' && deterministicFallback !== 'none' && input.previousSendableBody) {
    const previousBodySafety = validatePromptEnhancementSafety({
      currentBody: input.previousSendableBody,
      actionType: action,
      callVisibilityMode: 'fallback_no_llm',
    });
    const previousBody = previousBodySafety.generatedSafeStatus === input.previousSendableBody.generatedSafeStatus
      ? input.previousSendableBody
      : {
          ...input.previousSendableBody,
          generatedSafeStatus: previousBodySafety.generatedSafeStatus,
        };
    return {
      currentBody: previousBody,
      composerBoundary: buildComposerBoundary(input, 'previous_sendable_body', 'fallback_no_llm', [], {
        composerRunId,
        composerMode: 'previous_body_preservation',
        nexpathGeneratedPromptRef: input.previousSendableBody.nexpathGeneratedPromptRef,
        renderedPromptBody: input.previousSendableBody.text,
        sentPromptOrigin: 'previous_sendable_body',
        originalPromptSectionId: input.previousSendableBody.originalPromptSectionId,
        sourceAttribution: input.previousSendableBody.sourceAttribution,
        instructionPrecedenceState: 'fallback_previous_body',
        originalAsSourceStatus: 'previous_body_preserved',
        localOriginalPromptIncluded: input.previousSendableBody.localOriginalPromptIncluded,
        llmCallPolicy,
        rawComposerOutput: structuredComposerRejected ? 'rejected_or_unavailable' : undefined,
      }),
      availableActions: buildActionEntries(
        input.previousSendableBody.currentBodyId,
        input.previousSendableBody.bodyRevision,
        'available',
        'fallback_no_llm',
      ),
      bodySectionAgreement: 'exact',
      sourceGuidanceCoverage: hasSourceGuidanceSection(input.previousSendableBody.sections) ? 'covered' : 'fallback_no_generated_body',
      fallbackMode: previousBodySafety.fallbackMode === 'none' ? 'previous_sendable_body' : previousBodySafety.fallbackMode,
      sendPolicy: previousBodySafety.sendPolicy,
      actionInteractionState: runtimeState === 'timeout' ? 'timeout_kept_previous' : 'fallback_previous_body',
      callVisibilityMode: 'fallback_no_llm',
      diagnostics: [
        { category: 'fallback_or_no_popup', reasonCode: `action_failed_previous_body_preserved:${effectiveRuntimeState}` },
        ...previousBodySafety.publicDiagnostics,
      ],
    };
  }

  if (sectionPlans.length === 0) {
    const text = input.originalPromptText;
    const llmCallPolicy = 'no_call';
    return {
      currentBody: {
        currentBodyId,
        bodyRevision,
        composerRunId,
        routeDecisionId: input.sectionPlanningResult.routeDecisionId,
        promptReviewOrigin: input.sectionPlanningResult.promptReviewOrigin,
        promptReviewProcessingPolicy: input.sectionPlanningResult.promptReviewProcessingPolicy,
        sentPromptOrigin: 'user_authored_original_only',
        nexpathGeneratedPromptRef: `${currentBodyId}:original:${bodyRevision}`,
        renderedPromptBody: text,
        originalPromptSectionId: 'not_applicable_original_only',
        sourceAttribution: [],
        llmCallPolicy,
        composerMode: 'original_fallback',
        languagePolicyApplied: 'technical_english_default',
        languageValidationStatus: 'fallback_applied',
        effectiveLanguageState: 'unknown_default',
        languageSource: 'technical_english_default',
        languageConfidence: 'unknown',
        languagePolicy: 'technical_english_default',
        instructionPrecedenceState: 'original_only_no_generated_sections',
        originalAsSourceStatus: 'original_only_sendable',
        composerClaims: [],
        sourceFactIds: [],
        localOriginalPromptIncluded: true,
        text,
        originalPromptText: input.originalPromptText,
        originalPromptPreservation: 'fallback_original_only',
        generatedOriginState: 'user_original',
        generatedSafeStatus: 'original_only',
        userDirtyState: 'clean',
        sections: [],
      },
      composerBoundary: buildComposerBoundary(input, deterministicFallback, 'fallback_no_llm', sectionPlans, {
        composerRunId,
        composerMode: 'original_fallback',
        nexpathGeneratedPromptRef: `${currentBodyId}:original:${bodyRevision}`,
        renderedPromptBody: text,
        sentPromptOrigin: 'user_authored_original_only',
        originalPromptSectionId: 'not_applicable_original_only',
        sourceAttribution: [],
        instructionPrecedenceState: 'original_only_no_generated_sections',
        originalAsSourceStatus: 'original_only_sendable',
        localOriginalPromptIncluded: true,
      }),
      availableActions: buildActionEntries(currentBodyId, bodyRevision, 'disabled_not_applicable', 'not_applicable'),
      bodySectionAgreement: 'exact',
      sourceGuidanceCoverage: 'not_applicable',
      fallbackMode: 'original_prompt_only',
      sendPolicy: 'original_only',
      actionInteractionState: 'fallback_only',
      callVisibilityMode: 'fallback_no_llm',
      diagnostics: [{ category: 'fallback_or_no_popup', reasonCode: 'no_popup_or_no_sections_original_only' }],
    };
  }

  // Owner ruling 2026-08-07: on a provider failure (provider_api_unavailable / timeout_no_send)
  // the popup shows the FULL deterministic body plus the persistent provider-failure notice —
  // NOT an original-prompt-only shell. The original-only early-return that previously lived here
  // (the strict no-generated-content reading of the locked failure disposition) was removed by
  // that ruling; the failure stays fully visible via the notice + typed metadata
  // (fallbackReason / providerFailureState) while the user keeps the grounded guidance.

  const canonicalConfirmationSectionId = requiresPromptEnhancementExecutionConfirmationForPrompt(input.originalPromptText)
    ? sectionPlans.find((sectionPlan) => (
      sectionPlan.sectionKind === 'risk_safety_or_confirmation' &&
      sectionPlan.safetyFlags.includes('sensitive_action_confirmation')
    ))?.sectionId
      ?? sectionPlans.find((sectionPlan) => (
        sectionPlan.sectionKind !== 'original_request_or_goal' &&
        sectionPlan.safetyFlags.includes('sensitive_action_confirmation')
      ))?.sectionId
    : undefined;
  const renderSectionsWithConfirmation = (confirmationSectionId: string | undefined) => sectionPlans.map((sectionPlan) =>
      renderSection({
        sectionPlan,
        originalPromptText: input.originalPromptText,
        action,
        additionalDetailsText: action === 'apply_details' ? input.additionalDetailsText : input.acceptedAdditionalDetailsText,
        sectionPlanningResult: input.sectionPlanningResult,
        llmDraftsBySectionId: validatedLlmDrafts.draftsBySectionId,
        insertCanonicalConfirmation: sectionPlan.sectionId === confirmationSectionId,
      }),
  );
  let renderedSections = renderSectionsWithConfirmation(canonicalConfirmationSectionId);
  let canonicalText = renderedSections.map((section) => section.text).join('\n\n');
  let text = action === "apply_details" && typeof input.editedBodyText === "string"
    ? applyEditedBodyWithAdditionalDetails(input.editedBodyText, input.additionalDetailsText)
    : canonicalText;
  let sections = attachSpanRefs(sectionPlans, renderedSections, text);
  // Validator-parity confirmation guard (blocked-popup fix 2026-08-07): the prompt-based gate
  // above cannot see risk phrasing the GENERATED wording introduces (an LLM draft is free text),
  // but validatePromptEnhancementSafety scans the generated body and hard-blocks a body that
  // needs the canonical confirmation and lacks it — the user then gets an empty all-unavailable
  // popup. Mirror the validator on the assembled body; when it will demand the confirmation,
  // re-render with the confirmation appended to the LAST generated section, so the body ENDS
  // with it and the validator's "sensitive execution after the confirmation" (hidden/overridden)
  // rule cannot trip either. The classifier ignores the canonical sentence itself, so this
  // converges in one pass. Edited bodies keep their own edit-stage rules (text === canonicalText
  // guard); prompts the prompt-based gate already covers are unaffected (confirmation present).
  // Merge note (2026-08-07): the `!text.includes(...)` guard covers the one case the paragraph above
  // does not — an LLM draft that spontaneously contains the canonical sentence itself. The classifier
  // strips that sentence before scoring risk, so the predicate would still say "required", and
  // re-rendering would then append a SECOND copy. Skipping the re-render when the line is already in
  // the body keeps it appearing exactly once.
  if (
    canonicalConfirmationSectionId === undefined
    && text === canonicalText
    && !text.includes(buildPromptEnhancementCanonicalConfirmation(input.originalPromptText))
    && promptEnhancementGeneratedBodyRequiresConfirmationV1({ sections, originalPromptText: input.originalPromptText }, text)
  ) {
    const lastGeneratedSectionId = [...sectionPlans].reverse()
      .find((sectionPlan) => sectionPlan.sectionKind !== 'original_request_or_goal')?.sectionId;
    if (lastGeneratedSectionId !== undefined) {
      renderedSections = renderSectionsWithConfirmation(lastGeneratedSectionId);
      canonicalText = renderedSections.map((section) => section.text).join('\n\n');
      text = canonicalText;
      sections = attachSpanRefs(sectionPlans, renderedSections, text);
    }
  }
  const generatedSafeStatus: PromptEnhancementValidationStatus = deterministicFallback === 'none' ? 'valid' : 'valid_with_fallback';
  const callVisibilityMode: PromptEnhancementCallVisibilityMode = usesLlmWording
    ? 'llm_wording'
    : deterministicFallback === 'none' ? 'deterministic' : 'fallback_no_llm';
  const diagnostics = compositionDiagnostics(
    action,
    deterministicFallback,
    effectiveRuntimeState,
    sectionPlans,
    input.additionalDetailsText,
    validatedLlmDrafts.rejectionReason,
  );
  const composerMode = composerModeForAction(action, usesLlmWording);
  const sourceFactIds = unique(sectionPlans.flatMap((sectionPlan) => sectionPlan.structuredContentPartRefs));
  const composerClaims = usesLlmWording
    ? [...validatedLlmDrafts.composerClaims]
    : sourceFactIds.map((sourceFactId) => `claim:${sourceFactId}`);
  const sourceAttribution = sourceAttributionFor(sectionPlans);
  const originalPromptSectionId = sections.find((section) => section.sectionKind === 'original_request_or_goal')?.sectionId ?? 'not_applicable_original_only';
  const sentPromptOrigin = sentPromptOriginFor(action, deterministicFallback);
  // E5/5.4: when the LLM wrote the body it adapted to (and self-reported) the user's
  // language, so the language provenance is detected-from-prompt / preserve-user-language
  // instead of the hardcoded technical-English default. Deterministic/fallback bodies
  // stay technical-English.
  const detectedLanguage = usesLlmWording ? input.structuredComposerOutput?.detectedLanguageSelfReport : undefined;

  const currentBody: PromptEnhancementCurrentBodyV1 = {
      currentBodyId,
      bodyRevision,
      composerRunId,
      routeDecisionId: input.sectionPlanningResult.routeDecisionId,
      promptReviewOrigin: input.sectionPlanningResult.promptReviewOrigin,
      promptReviewProcessingPolicy: input.sectionPlanningResult.promptReviewProcessingPolicy,
      sentPromptOrigin,
      nexpathGeneratedPromptRef: `${currentBodyId}:generated:${bodyRevision}`,
      renderedPromptBody: text,
      originalPromptSectionId,
      sourceAttribution,
      llmCallPolicy,
      composerMode,
      languagePolicyApplied: detectedLanguage ? 'preserve_user_language' : 'technical_english_default',
      languageValidationStatus: 'valid',
      effectiveLanguageState: detectedLanguage ? 'known' : 'unknown_default',
      languageSource: detectedLanguage ? 'detected_from_prompt' : 'technical_english_default',
      languageConfidence: detectedLanguage ? 'medium' : 'unknown',
      languagePolicy: detectedLanguage ? 'preserve_user_language' : 'technical_english_default',
      instructionPrecedenceState: 'generated_sections_qualify_original',
      originalAsSourceStatus: 'local_verbatim_source_context',
      composerClaims,
      sourceFactIds,
      localOriginalPromptIncluded: true,
      text,
      originalPromptText: input.originalPromptText,
      originalPromptPreservation: 'visible_verbatim',
      generatedOriginState: action === 'apply_details' && typeof input.editedBodyText === 'string' ? 'pe_user_edited_body' : 'pe_generated_body',
      generatedSafeStatus,
      userDirtyState: action === 'apply_details' && typeof input.editedBodyText === 'string' ? 'dirty_user_edited' : 'clean',
      sections,
    };
  const safetyValidation = validatePromptEnhancementSafety({
    currentBody,
    callVisibilityMode,
  });

  return {
    currentBody: {
      ...currentBody,
      generatedSafeStatus: safetyValidation.generatedSafeStatus === 'valid' && generatedSafeStatus === 'valid_with_fallback'
        ? 'valid_with_fallback'
        : safetyValidation.generatedSafeStatus,
    },
    composerBoundary: buildComposerBoundary(input, deterministicFallback, callVisibilityMode, sectionPlans, {
      composerRunId,
      composerMode,
      nexpathGeneratedPromptRef: `${currentBodyId}:generated:${bodyRevision}`,
      renderedPromptBody: text,
      sentPromptOrigin,
      originalPromptSectionId,
      sourceAttribution,
      instructionPrecedenceState: 'generated_sections_qualify_original',
      originalAsSourceStatus: 'local_verbatim_source_context',
      localOriginalPromptIncluded: true,
      llmCallPolicy,
      rawComposerOutput: structuredComposerRejected ? 'rejected_or_unavailable' : undefined,
      draftRejectionReason: validatedLlmDrafts.rejectionReason,
      composerClaims,
    }, effectiveRuntimeState),
    availableActions: buildActionEntries(currentBodyId, bodyRevision, 'available', callVisibilityMode),
    bodySectionAgreement: 'exact',
    sourceGuidanceCoverage: hasSourceGuidanceSection(sectionPlans) ? 'covered' : 'fallback_no_generated_body',
    fallbackMode: safetyValidation.fallbackMode === 'none' ? deterministicFallback : safetyValidation.fallbackMode,
    sendPolicy: safetyValidation.sendPolicy,
    actionInteractionState: action === 'default' ? 'idle' : 'success_replaced_body',
    callVisibilityMode,
    diagnostics: [...diagnostics, ...safetyValidation.publicDiagnostics],
  };
}

function selectSectionPlansForAction(
  planningResult: PromptEnhancementSectionPlanningResult,
  action: PromptEnhancementComposerAction,
  includeAcceptedAdditionalDetails: boolean,
): readonly PromptEnhancementSectionPlanItemV1[] {
  const sectionPlans = [...planningResult.sectionPlans].sort((a, b) => a.order - b.order);
  if (
    (action === 'apply_details' || includeAcceptedAdditionalDetails) &&
    !sectionPlans.some((sectionPlan) => sectionPlan.sectionKind === 'context_and_constraints')
  ) {
    const insertionOrder = Math.max(...sectionPlans.map((sectionPlan) => sectionPlan.order), 1) + 1;
    const base = sectionPlans.find((sectionPlan) => sectionPlan.sectionKind !== 'original_request_or_goal') ?? sectionPlans[0];
    if (base) {
      const sourceARefs = base.sourceRefs.filter((ref) => ref.sourceKind === 'source_a_user_prompt');
      const selectedRefs = sourceARefs.length > 0 ? sourceARefs : base.sourceRefs;
      sectionPlans.push({
        ...base,
        sectionPlanId: `${base.sectionPlanId}:additional-details`,
        sectionId: `${base.sectionId}:additional-details`,
        sectionKind: 'context_and_constraints',
        order: insertionOrder,
        sourceKind: 'source_a_user_prompt',
        sourceRefs: selectedRefs,
        sourceIds: selectedRefs.map((ref) => ref.sourceId),
        structuredContentPartRefs: ['user_popup_input:additional_details_apply'],
        isRequired: true,
        validationStatus: 'valid',
      });
    }
  }
  if (action !== 'shorter') return sectionPlans;

  const primaryIntent = sectionPlans[0]?.primaryIntent;
  const shorterMinimum = primaryIntent
    ? getPromptEnhancementTemplateByIntent(primaryIntent as PromptEnhancementPrimaryIntent).shorterMinimum
    : [];
  const survivorKinds = new Set([
    'original_request_or_goal',
    'source_signal_guidance',
    'risk_safety_or_confirmation',
    ...shorterMinimum,
  ]);

  return sectionPlans.filter((sectionPlan) => (
    sectionPlan.isRequired ||
    survivorKinds.has(sectionPlan.sectionKind) ||
    sectionPlan.safetyFlags.length > 0 ||
    sectionPlan.sensitivityFlags.length > 0
  ));
}

function validatedStructuredComposerDrafts(
  output: PromptEnhancementStructuredComposerOutputV1 | undefined,
  sectionPlans: readonly PromptEnhancementSectionPlanItemV1[],
): ValidatedStructuredComposerDrafts {
  const rejectedFor = (
    rejectionReason: PromptEnhancementComposerDraftRejectionReason,
  ): ValidatedStructuredComposerDrafts => ({ draftsBySectionId: new Map(), composerClaims: [], rejectionReason });
  // No output at all is not a rejection — the composer never produced anything to refuse. But an output
  // that arrives carrying zero drafts IS a refusal, and leaving it reasonless made it the one rejection
  // path that could not be identified.
  if (!output) return { draftsBySectionId: new Map(), composerClaims: [] };
  if (output.sectionDrafts.length === 0) return rejectedFor('no_drafts_returned');
  const sectionIds = new Set(sectionPlans.map((sectionPlan) => sectionPlan.sectionId));
  const sourceIds = new Set(sectionPlans.flatMap((sectionPlan) => sectionPlan.sourceRefs.map((ref) => ref.sourceId)));
  const sourceRefIds = new Set(sectionPlans.flatMap((sectionPlan) => sectionPlan.sourceRefs.map((ref) => ref.sourceRefId)));
  const allowedSourceFactIds = new Set(sectionPlans.flatMap((sectionPlan) => sectionPlan.structuredContentPartRefs));
  const drafts = new Map<string, string>();
  for (const draft of output.sectionDrafts) {
    if (!sectionIds.has(draft.sectionId)) return rejectedFor('unknown_section');
    const sectionPlan = sectionPlans.find((section) => section.sectionId === draft.sectionId);
    if (!sectionPlan || sectionPlan.sectionKind === 'original_request_or_goal') return rejectedFor('original_section');
    const bodyText = normalizeWhitespace(draft.bodyText);
    if (!bodyText || containsDisallowedComposerWording(bodyText, sourceIds, sourceRefIds)) return rejectedFor('empty_or_disallowed_wording');
    if (draft.sourceFactIds.length === 0) return rejectedFor('no_source_fact_ids');
    if (draft.sourceFactIds.some((sourceFactId) => !sectionPlan.structuredContentPartRefs.includes(sourceFactId))) return rejectedFor('source_fact_id_not_in_section');
    drafts.set(draft.sectionId, `- ${bodyText}`);
  }
  const composerClaims = output.composerClaims.map((claim) => claim.startsWith('claim:') ? claim.slice('claim:'.length) : '');
  if (
    composerClaims.length === 0 ||
    composerClaims.some((sourceFactId) => !allowedSourceFactIds.has(sourceFactId))
  ) {
    return rejectedFor('claims_empty_or_unallowed');
  }
  return {
    draftsBySectionId: drafts,
    composerClaims: output.composerClaims,
  };
}

function containsDisallowedComposerWording(
  text: string,
  sourceIds: ReadonlySet<string>,
  sourceRefIds: ReadonlySet<string>,
): boolean {
  const normalizedText = text.toLowerCase();
  if (/\{\{[^}]+\}\}|\{r4_open\}|\{r4_close\}|\{r5_inject:/i.test(text)) return true;
  if (/\bpe-(ar|cr|dr|em|wr|g)-?\d*(?:\.\d+)*\b/i.test(text)) return true;
  if (/\b(source-review|autoresearch|analysis file|dev plan file|planning label|research label)\b/i.test(text)) return true;
  const disallowed = [
    'whydesc',
    'descbase',
    'pinch',
    'the developer should',
    'you seem',
    'you should',
    'you forgot',
    'you already',
    'you usually',
    'you often',
    'nexpath thinks',
    'bad practice',
    'you failed',
    'show simpler options',
    'ask the ai',
    'have the ai',
    'get the ai',
    'instruct the ai',
    'the ai',
    'it says',
    'it finds',
    'its answer',
    'its output',
    'the prompt above',
    'the action below',
    'this action below',
    'this option',
  ];
  if (disallowed.some((phrase) => normalizedText.includes(phrase))) return true;
  return [...sourceIds, ...sourceRefIds].some((sourceId) => sourceId && normalizedText.includes(sourceId.toLowerCase()));
}

function renderSection(input: {
  sectionPlan: PromptEnhancementSectionPlanItemV1;
  originalPromptText: string;
  action: PromptEnhancementComposerAction;
  additionalDetailsText?: string;
  sectionPlanningResult: PromptEnhancementSectionPlanningResult;
  llmDraftsBySectionId?: ReadonlyMap<string, string>;
  insertCanonicalConfirmation?: boolean;
}): { sectionId: string; title: string; bodyText: string; text: string } {
  const { sectionPlan, action } = input;
  const heading = headingForSection(sectionPlan.sectionKind);
  if (sectionPlan.sectionKind === 'original_request_or_goal') {
    const bodyText = input.originalPromptText;
    return {
      sectionId: sectionPlan.sectionId,
      title: ORIGINAL_HEADING,
      bodyText,
      text: `${ORIGINAL_HEADING}:\n${bodyText}`,
    };
  }

  const llmDraft = input.llmDraftsBySectionId?.get(sectionPlan.sectionId);
  if (llmDraft) {
    // Body quality (2026-08-06): provenance lives ONLY in the typed section metadata (sourceKind /
    // evidence statuses on the plan + sectionsForFeedback) — never rendered into the prompt body.
    const lines = [llmDraft];
    if (input.insertCanonicalConfirmation === true) {
      lines.push(`- ${buildPromptEnhancementCanonicalConfirmation(input.originalPromptText)}`);
    }
    const bodyText = lines.join('\n');
    return {
      sectionId: sectionPlan.sectionId,
      title: heading,
      bodyText,
      text: `${heading}:\n${bodyText}`,
    };
  }

  const lines = instructionLinesForSection(sectionPlan.sectionKind, action, input.originalPromptText, heading);
  if (action === 'more_thorough') {
    lines.push(...moreThoroughLines(sectionPlan));
  }
  if (action === 'more_project_grounded') {
    lines.push(projectGroundingLine(sectionPlan));
  }
  if (action === 'apply_details' && sectionPlan.sectionKind === 'context_and_constraints') {
    lines.push(`Use these additional details as bounded task input: ${boundedAdditionalDetails(input.additionalDetailsText)}`);
  } else if (sectionPlan.sectionKind === 'context_and_constraints' && input.additionalDetailsText) {
    lines.push(`Keep these accepted additional details covered: ${boundedAdditionalDetails(input.additionalDetailsText)}`);
  }
  // Body quality (2026-08-06): no per-section provenance sentence in the editable body — that
  // information already lives in the typed section metadata.
  if (input.insertCanonicalConfirmation === true) {
    lines.push(buildPromptEnhancementCanonicalConfirmation(input.originalPromptText));
  }
  const bodyText = lines.map((line) => `- ${line}`).join('\n');

  return {
    sectionId: sectionPlan.sectionId,
    title: heading,
    bodyText,
    text: `${heading}:\n${bodyText}`,
  };
}

function instructionLinesForSection(
  sectionKind: string,
  action: PromptEnhancementComposerAction,
  originalPromptText: string,
  sectionTitle: string,
): string[] {
  const concise = action === 'shorter';
  const line = (longText: string, shortText: string) => concise ? shortText : longText;
  const map: Record<string, string[]> = {
    source_signal_guidance: [
      line(
        'Use the current source signal as a task constraint and convert it into direct implementation guidance.',
        'Use the source signal as a direct task constraint.',
      ),
    ],
    acceptance_or_output_expectation: [
      line(
        'State the expected output and acceptance criteria clearly enough that the implementation can be checked.',
        'State the expected output and acceptance checks.',
      ),
    ],
    verification_or_test_plan: [
      line(
        'Include the verification command, focused scenario, or regression check that should prove the change.',
        'Include the verification check.',
      ),
    ],
    reproduction_or_evidence: [
      line(
        'Capture the failing behavior, reproduction path, observed evidence, and expected behavior before changing code.',
        'Capture repro, evidence, and expected behavior.',
      ),
    ],
    behavior_preservation: [
      line(
        'Preserve existing behavior outside the requested scope and call out compatibility risks before editing shared paths.',
        'Preserve out-of-scope behavior.',
      ),
    ],
    risk_safety_or_confirmation: [
      line(
        'Name risky or irreversible actions, ask for required confirmation, and include rollback or recovery checks.',
        'Keep confirmation and rollback checks.',
      ),
    ],
    project_grounding_facts: [
      line(
        'Ground the request in current project facts and source references without inventing missing implementation details.',
        'Ground the request in current source facts.',
      ),
    ],
    point_inventory_or_decomposition: [
      line(
        pointInventoryLine(originalPromptText),
        compactPointInventoryLine(originalPromptText),
      ),
    ],
    task_order_dependencies: [
      line(
        'Order the work by dependency and call out the next blocked decision instead of skipping ahead.',
        'Order work by dependency.',
      ),
    ],
    finding_format: [
      line(
        'Use a concrete finding format with severity, source reference, impact, and verification expectation.',
        'Use severity, evidence, impact, and verification.',
      ),
    ],
    context_and_constraints: [
      line(
        'Carry forward relevant constraints, limits, environment facts, and user instructions that affect the work.',
        'Carry forward relevant constraints.',
      ),
    ],
    uncertainty_or_clarification: [
      line(
        'Ask only for missing decisions that block a correct implementation; otherwise proceed from source-backed facts.',
        'Ask only for blocking missing decisions.',
      ),
    ],
  };

  // Body quality (2026-08-06): template-derived sections (kinds outside the map) each name their
  // OWN topic instead of repeating one identical generic line for every section.
  return [...(map[sectionKind] ?? [
    line(
      `Cover ${sectionTitle} for this request with concrete, source-backed specifics — state what is required, how to implement it, and how to verify it.`,
      `Cover ${sectionTitle} concretely.`,
    ),
  ])];
}

function moreThoroughLines(sectionPlan: PromptEnhancementSectionPlanItemV1): string[] {
  const template = getPromptEnhancementTemplateByIntent(sectionPlan.primaryIntent as PromptEnhancementPrimaryIntent);
  const additions = template.moreThoroughAdds.filter((sectionKind) => sectionKind === sectionPlan.sectionKind || !template.requiredSections.includes(sectionKind));
  if (additions.length === 0) {
    return ['Add edge cases, failure behavior, and verification evidence where relevant.'];
  }
  return [`Add deeper coverage for ${additions.join(', ')} without creating extra prompt variants.`];
}

function projectGroundingLine(sectionPlan: PromptEnhancementSectionPlanItemV1): string {
  if (!hasUsableProjectGroundingSource([sectionPlan])) {
    return 'Known project grounding is unavailable for this section; keep the prompt scoped to the provided request and ask only for blocking missing project facts.';
  }
  return `Use the typed project/source metadata attached to this section as grounding; do not invent unavailable project facts.`;
}

function publicSourceBasis(sourceKind: PromptEnhancementSectionPlanItemV1['sourceKind']): string {
  const map: Record<PromptEnhancementSectionPlanItemV1['sourceKind'], string> = {
    source_a_user_prompt: 'current original prompt',
    stage_or_absence_signal: 'current stage or absence signal',
    content_template_record: 'content-template source evidence',
    content_template_fact: 'content-template source evidence',
    hard_fact_or_profile_signal: 'current project or profile fact',
    prompt_enhancement_memory: 'qualified prompt-enhancement memory',
    safety_rule: 'prompt-enhancement safety rule',
    generated_origin: 'generated-origin metadata',
    handoff_metadata: 'handoff metadata',
  };
  return map[sourceKind];
}

function sourceAttributionFor(
  sectionPlans: readonly PromptEnhancementSectionPlanItemV1[],
): readonly PromptEnhancementSourceAttributionV1[] {
  const byRefId = new Map<string, PromptEnhancementSourceAttributionV1>();
  for (const sourceRef of sectionPlans.flatMap((sectionPlan) => sectionPlan.sourceRefs)) {
    if (byRefId.has(sourceRef.sourceRefId)) continue;
    byRefId.set(sourceRef.sourceRefId, {
      sourceRefId: sourceRef.sourceRefId,
      sourceId: sourceRef.sourceId,
      sourceKind: sourceRef.sourceKind,
      evidenceStatus: sourceRef.evidenceStatus,
      publicSafeLabel: publicSourceBasis(sourceRef.sourceKind),
      privateIdPolicy: 'metadata_only_not_body',
    });
  }
  return [...byRefId.values()];
}

function compositionDiagnostics(
  action: PromptEnhancementComposerAction,
  fallbackMode: PromptEnhancementFallbackMode,
  runtimeState: PromptEnhancementComposerRuntimeState,
  sectionPlans: readonly PromptEnhancementSectionPlanItemV1[],
  additionalDetailsText?: string,
  // Which draft-validation rule refused the composer's reply, when one did. Without it a lost body
  // reports only `validation_failed`, which names the stage but not the cause — and there are six
  // possible causes.
  draftRejectionReason?: PromptEnhancementComposerDraftRejectionReason,
): PromptEnhancementComposeResult['diagnostics'] {
  const fallbackReasonCode = draftRejectionReason
    ? `deterministic_fallback:${runtimeState}:${draftRejectionReason}`
    : `deterministic_fallback:${runtimeState}`;
  const diagnostics: PromptEnhancementComposeResult['diagnostics'][number][] = fallbackMode === 'none'
    ? [{ category: 'generated', reasonCode: 'deterministic_body_composed' }]
    : [{ category: 'fallback_or_no_popup', reasonCode: fallbackReasonCode }];

  if (action === 'more_project_grounded' && !hasUsableProjectGroundingSource(sectionPlans)) {
    diagnostics.push({
      category: 'source_coverage',
      reasonCode: 'project_grounding_source_unavailable',
    });
  }

  if (action === 'apply_details' && additionalDetailsWordCount(additionalDetailsText) > ADDITIONAL_DETAILS_WORD_CAP) {
    diagnostics.push({
      category: 'generated',
      reasonCode: 'additional_details_truncated_public_notice',
    });
  }

  return diagnostics;
}

function hasUsableProjectGroundingSource(sectionPlans: readonly PromptEnhancementSectionPlanItemV1[]): boolean {
  return sectionPlans.some((sectionPlan) => (
    sectionPlan.sourceRefs.some((ref) => (
      (ref.sourceKind === 'hard_fact_or_profile_signal' ||
        ref.sourceKind === 'content_template_fact' ||
        ref.sourceKind === 'content_template_record' ||
        ref.sourceKind === 'prompt_enhancement_memory') &&
      ref.evidenceStatus === 'present'
    ))
  ));
}

function hasAcceptedAdditionalDetails(input: PromptEnhancementComposeInput): boolean {
  return normalizeWhitespace(input.acceptedAdditionalDetailsText ?? '').length > 0;
}

function boundedAdditionalDetails(text: string | undefined): string {
  const normalized = normalizeWhitespace(text ?? '');
  if (!normalized) return 'none provided';
  const words = normalized.split(' ');
  if (words.length <= ADDITIONAL_DETAILS_WORD_CAP) return normalized;
  return `${words.slice(0, ADDITIONAL_DETAILS_WORD_CAP).join(' ')} [truncated_to_apply_details_5000_word_cap]`;
}

function applyEditedBodyWithAdditionalDetails(editedBodyText: string, additionalDetailsText: string | undefined): string {
  const editedBody = editedBodyText.trim();
  const details = boundedAdditionalDetails(additionalDetailsText);
  if (!details.trim()) return editedBody;
  return `${editedBody}\n\nAdditional details to incorporate:\n${details}`;
}

function additionalDetailsWordCount(text: string | undefined): number {
  const normalized = normalizeWhitespace(text ?? '');
  return normalized ? normalized.split(' ').length : 0;
}

function pointInventoryLine(originalPromptText: string): string {
  const points = extractPromptPoints(originalPromptText);
  if (points.length === 0) {
    return 'Preserve the original request, dependencies, and completion checks inside this one prompt body.';
  }
  return `Preserve these original points in the work plan: ${points.join(' | ')}.`;
}

function compactPointInventoryLine(originalPromptText: string): string {
  const points = extractPromptPoints(originalPromptText);
  if (points.length === 0) return 'Keep a compact point inventory.';
  return `Keep these points covered: ${points.join(' | ')}.`;
}

function extractPromptPoints(originalPromptText: string): readonly string[] {
  return originalPromptText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^([-*]|\d+[.)])\s+/.test(line))
    .map((line) => normalizeWhitespace(line.replace(/^([-*]|\d+[.)])\s+/, '')))
    .filter(Boolean)
    .slice(0, 12);
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function composerModeForAction(
  action: PromptEnhancementComposerAction,
  usesLlmWording = false,
): PromptEnhancementComposerMode {
  if (action === 'default') return usesLlmWording ? 'baseline_llm_structured_wording' : 'baseline_deterministic_render';
  if (action === 'apply_details') return usesLlmWording ? 'additional_details_recomposition_llm_structured_wording' : 'additional_details_recomposition_deterministic';
  return usesLlmWording ? 'action_recomposition_llm_structured_wording' : 'action_recomposition_deterministic';
}

function sentPromptOriginFor(
  action: PromptEnhancementComposerAction,
  fallbackMode: PromptEnhancementFallbackMode,
): PromptEnhancementSentPromptOrigin {
  if (fallbackMode !== 'none') return 'pe_deterministic_fallback_body';
  if (action === 'default') return 'pe_baseline_generated_body';
  return 'pe_action_generated_body';
}

function attachSpanRefs(
  sectionPlans: readonly PromptEnhancementSectionPlanItemV1[],
  renderedSections: readonly { sectionId: string; title: string; bodyText: string; text: string }[],
  bodyText: string,
): readonly PromptEnhancementSectionV1[] {
  return sectionPlans.map((sectionPlan) => {
    const rendered = renderedSections.find((section) => section.sectionId === sectionPlan.sectionId);
    const startOffset = rendered ? bodyText.indexOf(rendered.text) : -1;
    const endOffset = rendered && startOffset >= 0 ? startOffset + rendered.text.length : startOffset;
    const spanRefs: PromptEnhancementSpanRefV1[] = startOffset >= 0
      ? [{
        spanRefId: `${sectionPlan.sectionId}:span:1`,
        sectionId: sectionPlan.sectionId,
        startOffset,
        endOffset,
        sourceRefs: sectionPlan.sourceRefs.map((ref) => ref.sourceRefId),
        spanMappingStatus: 'exact',
        textStoragePolicy: 'text_in_body_only',
      }]
      : [];

    return {
      sectionId: sectionPlan.sectionId,
      sectionKind: sectionPlan.sectionKind,
      title: rendered?.title ?? headingForSection(sectionPlan.sectionKind),
      bodyText: rendered?.bodyText ?? '',
      templateType: 'prompt-enhancement-template',
      familyId: sectionPlan.familyId,
      primaryIntent: sectionPlan.primaryIntent,
      registryNamespace: 'prompt-enhancement-templates',
      sourceTemplateType: sectionPlan.sourceKind === 'content_template_fact' ? 'content_template_fact' : 'prompt_enhancement_template',
      sourceKind: sectionPlan.sourceKind,
      sourceIds: sectionPlan.sourceIds,
      sourceFactIds: sectionPlan.structuredContentPartRefs,
      routeCandidateRefs: [sectionPlan.templateId],
      evidenceStatus: sectionPlan.sourceEvidenceStatus,
      sourceEvidenceStatus: sectionPlan.sourceEvidenceStatus,
      slotEvidenceStatus: sectionPlan.slotEvidenceStatus,
      baselineSourceSignalSlot: sectionPlan.baselineSourceSignalSlot,
      requirementSourceStatus: sectionPlan.requirementSourceStatus,
      requiredSurvivor: sectionPlan.isRequired,
      mandatoryFloor: sectionPlan.isRequired || sectionPlan.safetyFlags.length > 0 || sectionPlan.sensitivityFlags.length > 0,
      depthState: sectionPlan.isRequired ? 'required_survivor' : 'standard',
      axisContributions: axisContributionsForSection(sectionPlan),
      canMergeInShorter: !sectionPlan.isRequired && sectionPlan.safetyFlags.length === 0,
      canExpandInMoreThorough: true,
      canGroundInMoreProjectGrounded: sectionPlan.sourceRefs.some((ref) => ref.evidenceStatus === 'present'),
      feedbackSensitivity: sectionPlan.isRequired || sectionPlan.safetyFlags.length > 0 ? 'protected' : 'typed_feedback_allowed',
      fallbackBehavior: sectionPlan.fallbackMode,
      handoffFlags: sectionPlan.handoffCapabilityFlags,
      privacyClass: privacyClassForSection(sectionPlan),
      publicCopySafe: !sectionPlan.sourceRefs.some((ref) => ref.privacyClass === 'sensitive'),
      authorityBoundary: 'no_authority_escalation',
      confirmationRequired: sectionPlan.safetyFlags.includes('sensitive_action_confirmation'),
      confirmationPresent: sectionPlan.safetyFlags.includes('sensitive_action_confirmation'),
      isEditable: sectionPlan.isEditable,
      removalFeedbackPolicy: sectionPlan.removalFeedbackPolicy,
      validationStatus: sectionPlan.validationStatus,
      safetyFlags: sectionPlan.safetyFlags,
      sensitivityFlags: sectionPlan.sensitivityFlags,
      spanRefs,
      publicExplanationCategory: 'source_coverage',
      whyHelpReasonCodes: sectionPlan.structuredContentPartRefs,
      callVisibilityMode: sectionPlan.callVisibilityMode,
      contentTemplateRuntimeSeamUse: sectionPlan.contentTemplateRuntimeSeamUse,
      handoffCapabilityFlags: sectionPlan.handoffCapabilityFlags,
    };
  });
}

function axisContributionsForSection(sectionPlan: PromptEnhancementSectionPlanItemV1): readonly string[] {
  const axes = new Set<string>(['practiceDepth', 'sectionDensity']);
  if (sectionPlan.sectionKind === 'risk_safety_or_confirmation' || sectionPlan.safetyFlags.length > 0) {
    axes.add('riskDepth');
  }
  if (sectionPlan.sectionKind === 'project_grounding_facts' || sectionPlan.sourceRefs.length > 0) {
    axes.add('groundingDepth');
  }
  if (sectionPlan.sectionKind === 'uncertainty_or_clarification') {
    axes.add('uncertaintyHandling');
  }
  if (sectionPlan.handoffCapabilityFlags.some((flag) => flag.includes('sequence') || flag.includes('handoff'))) {
    axes.add('decompositionDepth');
  }
  return [...axes];
}

function privacyClassForSection(
  sectionPlan: PromptEnhancementSectionPlanItemV1,
): PromptEnhancementSectionV1['privacyClass'] {
  if (sectionPlan.sourceRefs.some((ref) => ref.privacyClass === 'sensitive')) return 'sensitive_ref_only';
  if (sectionPlan.sourceRefs.some((ref) => ref.privacyClass === 'raw_text_excluded')) return 'local_private';
  if (sectionPlan.sourceRefs.every((ref) => ref.privacyClass === 'public_safe')) return 'public_safe';
  return 'local_private';
}

function buildComposerBoundary(
  input: PromptEnhancementComposeInput,
  fallbackMode: PromptEnhancementFallbackMode,
  callVisibilityMode: PromptEnhancementCallVisibilityMode,
  selectedSectionPlans: readonly PromptEnhancementSectionPlanItemV1[] = input.sectionPlanningResult.sectionPlans,
  artifactState?: {
    composerRunId: string;
    composerMode: PromptEnhancementComposerMode;
    nexpathGeneratedPromptRef: string;
    renderedPromptBody: string;
    sentPromptOrigin: PromptEnhancementSentPromptOrigin;
    originalPromptSectionId: string | 'not_applicable_original_only';
    sourceAttribution: readonly PromptEnhancementSourceAttributionV1[];
    instructionPrecedenceState: PromptEnhancementInstructionPrecedenceState;
    originalAsSourceStatus: PromptEnhancementOriginalAsSourceStatus;
    localOriginalPromptIncluded: boolean;
    llmCallPolicy?: PromptEnhancementComposerBoundaryV1['llmCallPolicy'];
    rawComposerOutput?: PromptEnhancementComposerBoundaryV1['rawComposerOutput'];
    draftRejectionReason?: PromptEnhancementComposerBoundaryV1['draftRejectionReason'];
    composerClaims?: readonly string[];
  },
  runtimeState?: PromptEnhancementComposerRuntimeState,
): PromptEnhancementComposerBoundaryV1 {
  const sourceRefs = selectedSectionPlans.flatMap((section) => section.sourceRefs);
  const originalPromptRef = selectedSectionPlans
    .find((section) => section.sectionKind === 'original_request_or_goal')?.sourceRefs[0]
    ?? sourceRefs.find((ref) => ref.sourceKind === 'source_a_user_prompt')
    ?? fallbackSourceA();
  const action = input.action ?? 'default';
  const composerRunId = artifactState?.composerRunId ?? `${input.enhancementId}:composer:${action}:1`;
  const composerMode = artifactState?.composerMode ?? composerModeForAction(action);
  const sourceFactIds = unique(selectedSectionPlans.flatMap((section) => section.structuredContentPartRefs));
  const llmCallPolicy = artifactState?.llmCallPolicy ?? (artifactState?.composerMode.includes('llm_structured_wording')
    ? 'optional_with_cost_visibility'
    : 'no_call');
  const renderedPromptBody = artifactState?.renderedPromptBody ?? '';
  const nexpathGeneratedPromptRef = artifactState?.nexpathGeneratedPromptRef ?? `${input.enhancementId}:body:generated:1`;
  const sentPromptOrigin = artifactState?.sentPromptOrigin ?? sentPromptOriginFor(action, fallbackMode);
  const originalPromptSectionId = artifactState?.originalPromptSectionId
    ?? selectedSectionPlans.find((section) => section.sectionKind === 'original_request_or_goal')?.sectionId
    ?? 'not_applicable_original_only';
  const sourceAttribution = artifactState?.sourceAttribution ?? sourceAttributionFor(selectedSectionPlans);
  const composerVisiblePromptContextRefs = unique([
    ...sourceRefs.map((ref) => ref.sourceRefId),
    ...sourceFactIds,
  ]);

  return {
    composerBoundaryVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
    composerPolicy: llmCallPolicy === 'optional_with_cost_visibility' ? 'optional_llm_with_visibility' : 'deterministic_only',
    composerRunId,
    routeDecisionId: input.sectionPlanningResult.routeDecisionId,
    promptReviewOrigin: input.sectionPlanningResult.promptReviewOrigin,
    promptReviewProcessingPolicy: input.sectionPlanningResult.promptReviewProcessingPolicy,
    sentPromptOrigin,
    nexpathGeneratedPromptRef,
    renderedPromptBody,
    originalPromptSectionId,
    sourceAttribution,
    llmCallPolicy,
    rawComposerOutput: artifactState?.rawComposerOutput ?? (llmCallPolicy === 'optional_with_cost_visibility'
      ? artifactState?.composerMode.includes('llm_structured_wording') ? 'llm_output_validated_into_artifact' : 'rejected_or_unavailable'
      : fallbackMode === 'previous_sendable_body' ? 'rejected_or_unavailable' : 'not_used_deterministic'),
    draftRejectionReason: artifactState?.draftRejectionReason,
    validatedCanonicalPromptArtifact: 'current_body_v1',
    composerMode,
    budgetState: {
      llmCallPolicy,
      callVisibilityMode,
      productValueDiscussionIsRuntimeLimiter: false,
    },
    languagePolicyApplied: 'technical_english_default',
    languageValidationStatus: fallbackMode === 'none' ? 'valid' : 'fallback_applied',
    effectiveLanguageState: 'unknown_default',
    languageSource: 'technical_english_default',
    languageConfidence: 'unknown',
    languagePolicy: 'technical_english_default',
    instructionPrecedenceState: artifactState?.instructionPrecedenceState ?? 'generated_sections_qualify_original',
    originalAsSourceStatus: artifactState?.originalAsSourceStatus ?? 'local_verbatim_source_context',
    composerClaims: artifactState?.composerClaims ?? sourceFactIds.map((sourceFactId) => `claim:${sourceFactId}`),
    sourceFactIds,
    localRenderOriginalPrompt: true,
    composerVisiblePromptContext: {
      contextPolicy: 'structured_refs_only_no_raw_original',
      originalPromptVisibleLocallyOnly: true,
      boundedContextRefCount: composerVisiblePromptContextRefs.length,
      rawPromptTextExcluded: true,
    },
    composerVisiblePromptContextRefs,
    composerInputPrivacyState: 'approved_refs_only',
    localOriginalPromptIncluded: artifactState?.localOriginalPromptIncluded ?? selectedSectionPlans.some((section) => section.sectionKind === 'original_request_or_goal'),
    strictSchemaFailureReasonCodes: [
      'invalid_json',
      'duplicate_key',
      'unknown_field',
      'invalid_enum',
      'bad_reference',
      'output_cap_exceeded',
      'unsafe_metadata_copy',
    ],
    fallbackReasonCodes: [runtimeBlockReasonFor(fallbackMode, runtimeState) ?? 'not_applicable'],
    inputContract: {
      originalPromptRef,
      bodyPlanId: input.sectionPlanningResult.bodyPlan.bodyPlanId,
      sectionPlanIds: selectedSectionPlans.map((section) => section.sectionPlanId),
      boundedSourceSummaryRefs: unique(sourceRefs.map((ref) => ref.sourceRefId)),
      privacyApprovedFactsOnly: true,
      callVisibilityState: callVisibilityState(callVisibilityMode, fallbackMode, input.action ?? 'default', llmCallPolicy, runtimeState),
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
      fallbackMode,
      productValueDiscussionIsRuntimeLimiter: false,
    },
  };
}

function buildActionEntries(
  currentBodyId: string,
  bodyRevision: number,
  availability: PromptEnhancementActionEntryV1['availability'],
  callVisibilityMode: PromptEnhancementCallVisibilityMode,
): readonly PromptEnhancementActionEntryV1[] {
  const actionTypes: readonly PromptEnhancementActionType[] = [
    'use_current_body',
    'use_original',
    'shorter',
    'more_thorough',
    'more_project_grounded',
    'apply_details',
    'feedback',
    'close',
  ];
  return actionTypes.map((actionType) => ({
    actionId: `${currentBodyId}:action:${actionType}`,
    actionType,
    label: ACTION_LABELS[actionType],
    currentBodyId,
    bodyRevision,
    availability: availabilityForAction(actionType, availability),
    fallbackReason: availability === 'disabled_not_applicable' ? 'not_applicable' : undefined,
    callVisibilityMode,
  }));
}

function availabilityForAction(
  actionType: PromptEnhancementActionType,
  base: PromptEnhancementActionEntryV1['availability'],
): PromptEnhancementActionEntryV1['availability'] {
  if (base === 'disabled_not_applicable') return actionType === 'use_original' || actionType === 'close' ? 'available' : base;
  return base;
}

function fallbackModeForRuntime(
  runtimeState: PromptEnhancementComposerRuntimeState,
  sectionPlanCount: number,
): PromptEnhancementFallbackMode {
  if (sectionPlanCount === 0) return 'original_prompt_only';
  if (runtimeState === 'not_requested' || runtimeState === 'accepted_structured_output') return 'none';
  if (runtimeState === 'provider_unavailable') return 'provider_api_unavailable';
  if (runtimeState === 'timeout') return 'timeout_no_send';
  if (runtimeState === 'validation_failed' || runtimeState === 'invalid_output') return 'deterministic_body';
  return 'deterministic_body';
}

function llmCallPolicyForRuntime(
  runtimeState: PromptEnhancementComposerRuntimeState,
  structuredComposerAttempted: boolean,
): PromptEnhancementComposerBoundaryV1['llmCallPolicy'] {
  if (structuredComposerAttempted) return 'optional_with_cost_visibility';
  if (
    runtimeState === 'provider_unavailable' ||
    runtimeState === 'timeout' ||
    runtimeState === 'invalid_output' ||
    runtimeState === 'validation_failed'
  ) {
    return 'optional_with_cost_visibility';
  }
  return 'no_call';
}

function callVisibilityState(
  callVisibilityMode: PromptEnhancementCallVisibilityMode,
  fallbackMode: PromptEnhancementFallbackMode,
  action: PromptEnhancementComposerAction,
  llmCallPolicy: PromptEnhancementComposerBoundaryV1['llmCallPolicy'] = 'no_call',
  runtimeState?: PromptEnhancementComposerRuntimeState,
): PromptEnhancementCostVisibilityMetadataV1 {
  const usesLlm = llmCallPolicy === 'optional_with_cost_visibility';
  const metadata = buildPromptEnhancementCostVisibilityMetadataV1(costCallIdForAction(action), {
    callVisibilityMode,
    plannedCallCount: usesLlm ? 1 : 0,
    usedCallCount: usesLlm ? 1 : 0,
    fallbackReason: runtimeBlockReasonFor(fallbackMode, runtimeState) ?? 'not_applicable',
    providerFailureState: providerFailureStateForFallback(fallbackMode, callVisibilityMode),
  });
  if (usesLlm || callVisibilityMode === 'provider_unavailable') return metadata;
  return {
    ...metadata,
    optionalCallAvailabilityState: 'deterministic_only',
    provider: undefined,
    model: undefined,
    inputTokenCap: undefined,
    outputTokenCap: undefined,
    estimatedInputTokens: undefined,
    estimatedOutputTokens: undefined,
    timeoutMs: undefined,
    retryCount: undefined,
    latencyTargetMs: undefined,
    providerAvailabilityState: 'not_applicable',
    providerFailureState: 'none',
  };
}

function providerFailureStateForFallback(
  fallbackMode: PromptEnhancementFallbackMode,
  callVisibilityMode: PromptEnhancementCallVisibilityMode,
): PromptEnhancementCostVisibilityMetadataV1['providerFailureState'] {
  if (callVisibilityMode === 'provider_unavailable') return 'provider_api_unavailable';
  // Owner ruling 2026-08-07: provider failures render the deterministic body under
  // 'fallback_no_llm', so the failure state must key on the FALLBACK MODE (same output as the
  // old 'provider_unavailable'-mode pairing kept above for compatibility).
  if (fallbackMode === 'provider_api_unavailable') return 'provider_api_unavailable';
  if (fallbackMode === 'timeout_no_send') return 'timeout';
  return 'none';
}

function costCallIdForAction(action: PromptEnhancementComposerAction): PromptEnhancementCostCallIdV1 {
  if (action === 'shorter') return 'action_shorter';
  if (action === 'more_thorough') return 'action_more_thorough';
  if (action === 'more_project_grounded') return 'action_more_project_grounded';
  if (action === 'apply_details') return 'additional_details_recomposition';
  return 'baseline_pe_composer';
}

function runtimeBlockReasonFor(
  fallbackMode: PromptEnhancementFallbackMode,
  runtimeState?: PromptEnhancementComposerRuntimeState,
): PromptEnhancementRuntimeBlockReason | undefined {
  if (fallbackMode === 'provider_api_unavailable') return 'provider_unavailable';
  if (fallbackMode === 'timeout_no_send') return 'timeout';
  // Two very different failures both fall back to a deterministic body, and reporting them under one
  // reason made them indistinguishable in the logs: a body whose drafts were REJECTED by
  // `validatedStructuredComposerDrafts` looked identical to a composer that GAVE UP after exhausting
  // its retries on malformed/inconsistent replies. `malformed_output` already exists in the contract
  // for the second case; use it, so a reader can tell which half of the pipeline failed.
  if (fallbackMode === 'deterministic_body') {
    return runtimeState === 'invalid_output' ? 'malformed_output' : 'validation_failed';
  }
  if (fallbackMode === 'original_prompt_only' || fallbackMode === 'no_popup') return 'not_applicable';
  return undefined;
}

function hasSourceGuidanceSection(
  sections: readonly Pick<PromptEnhancementSectionPlanItemV1 | PromptEnhancementSectionV1, 'sectionKind' | 'sourceKind'>[],
): boolean {
  return sections.some((section) => (
    section.sectionKind === 'source_signal_guidance' ||
    section.sourceKind !== 'source_a_user_prompt'
  ));
}

function headingForSection(sectionKind: string): string {
  const words = sectionKind.split('_').filter(Boolean);
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function fallbackSourceA(): PromptEnhancementSourceRefV1 {
  return {
    sourceRefId: 'source-a-current-prompt',
    sourceKind: 'source_a_user_prompt',
    sourceId: 'prompt:current',
    sourceAuthorization: 'implementation_input',
    evidenceStatus: 'unknown',
    freshness: 'current',
    confidence: 'none',
    privacyClass: 'local_private',
  };
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}
