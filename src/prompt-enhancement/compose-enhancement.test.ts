import { describe, expect, it } from 'vitest';
import type { PromptEnhancementSourceRefV1 } from './contracts.js';
import { composePromptEnhancementBody } from './compose-enhancement.js';
import { routePromptEnhancement, type PromptEnhancementRouteInput } from './routing-taxonomy.js';
import {
  planPromptEnhancementSections,
  type PromptEnhancementGuidanceFact,
  type PromptEnhancementSectionPlanningResult,
} from './templates/section-plan.js';

const sourceA: PromptEnhancementSourceRefV1 = {
  sourceRefId: 'source-a-current-prompt',
  sourceKind: 'source_a_user_prompt',
  sourceId: 'prompt:current',
  sourceAuthorization: 'implementation_input',
  evidenceStatus: 'present',
  freshness: 'current',
  confidence: 'high',
  privacyClass: 'local_private',
};

const contentTemplateSourceB: PromptEnhancementSourceRefV1 = {
  sourceRefId: 'source-b-content-template-debug',
  sourceKind: 'content_template_fact',
  sourceId: 'ABSENCE_DEBUGGING_OBSERVATION',
  sourceAuthorization: 'source_fact_only',
  evidenceStatus: 'present',
  freshness: 'current',
  confidence: 'medium',
  privacyClass: 'raw_text_excluded',
};

const hardFactSourceB: PromptEnhancementSourceRefV1 = {
  sourceRefId: 'source-b-project-tests',
  sourceKind: 'hard_fact_or_profile_signal',
  sourceId: 'project_fact:test-suite-present',
  sourceAuthorization: 'implementation_input',
  evidenceStatus: 'present',
  freshness: 'current',
  confidence: 'medium',
  privacyClass: 'local_private',
};

function routeInput(overrides: Partial<PromptEnhancementRouteInput> = {}): PromptEnhancementRouteInput {
  return {
    routeDecisionId: 'phase5-route-1',
    promptText: 'Ask the AI to fix importCsv and tell me what it says.',
    currentStage: 'implementation',
    prevStage: 'task_breakdown',
    triggerKind: 'absence',
    firedKey: 'absence:debugging_observation_gap@implementation',
    effectiveFiredSource: 'classifier_fire_recommendation',
    selectedQualifyingAbsence: 'debugging_observation_gap',
    absenceGateReason: 'selected_qualifying_absence',
    classifierState: 'fire_recommended',
    degradedNoActionState: 'none',
    generatedOriginState: 'ordinary_user_prompt',
    ...overrides,
  };
}

function fact(overrides: Partial<PromptEnhancementGuidanceFact> = {}): PromptEnhancementGuidanceFact {
  return {
    factId: 'fact-debug-repro',
    sourceType: 'content_template_record',
    sourceIds: ['ABSENCE_DEBUGGING_OBSERVATION'],
    guidanceKind: 'debug_evidence',
    suggestedActionKind: 'capture_reproduction',
    targetFamily: 'issue_debug',
    targetSectionKind: 'reproduction_or_evidence',
    sourceEvidenceState: 'strong',
    priority: 'required_survivor',
    renderPolicy: 'render_as_section',
    riskLevel: 'none',
    safetyHooks: ['source_honesty'],
    privacyClass: 'local_private',
    sanitizationState: 'prompt_derived_sanitized',
    publicCopySafe: true,
    ...overrides,
  };
}

function planningResult(overrides: {
  route?: Partial<PromptEnhancementRouteInput>;
  sourceRefs?: readonly PromptEnhancementSourceRefV1[];
  guidanceFacts?: readonly PromptEnhancementGuidanceFact[];
} = {}): PromptEnhancementSectionPlanningResult {
  const route = routePromptEnhancement(routeInput(overrides.route));
  return planPromptEnhancementSections({
    routeResult: route,
    sourceRefs: overrides.sourceRefs ?? [sourceA, contentTemplateSourceB, hardFactSourceB],
    guidanceFacts: overrides.guidanceFacts ?? [
      fact(),
      fact({
        factId: 'fact-verification',
        sourceType: 'absence_signal',
        sourceIds: ['absence:verification_gap'],
        guidanceKind: 'missing_practice',
        suggestedActionKind: 'add_verification',
        targetSectionKind: 'verification_or_test_plan',
      }),
    ],
  });
}

describe('prompt-enhancement composer and deterministic fallback', () => {
  it('composes exactly one editable current body with visible original-verbatim preservation', () => {
    const originalPrompt = 'Ask the AI to fix importCsv and tell me what it says.';
    const result = composePromptEnhancementBody({
      enhancementId: 'enh-phase5-1',
      originalPromptText: originalPrompt,
      sectionPlanningResult: planningResult(),
    });

    expect(result.currentBody.text).toContain('My original request (verbatim):\nAsk the AI to fix importCsv and tell me what it says.');
    expect(result.currentBody.originalPromptText).toBe(originalPrompt);
    expect(result.currentBody.originalPromptPreservation).toBe('visible_verbatim');
    expect(result.currentBody.generatedOriginState).toBe('pe_generated_body');
    expect(result.currentBody.userDirtyState).toBe('clean');
    expect(result.availableActions.map((action) => action.label)).toEqual([
      'Use this prompt',
      'Use original',
      'Shorter',
      'More thorough',
      'More project-grounded',
      'Apply details',
      'Feedback',
      'Close',
    ]);
    expect(result.bodySectionAgreement).toBe('exact');
  });

  it('emits canonical composer artifact metadata required by the Phase 5 contract', () => {
    const result = composePromptEnhancementBody({
      enhancementId: 'enh-phase5-artifact-metadata',
      originalPromptText: 'Fix the importCsv parser and verify the regression.',
      sectionPlanningResult: planningResult(),
    });

    expect(result.currentBody.composerRunId).toBe('enh-phase5-artifact-metadata:composer:default:1');
    expect(result.currentBody.routeDecisionId).toBe('phase5-route-1');
    expect(result.currentBody.promptReviewOrigin).toBe('user_authored_current_prompt');
    expect(result.currentBody.promptReviewProcessingPolicy).toBe('eligible_for_initial_pe_route');
    expect(result.currentBody.sentPromptOrigin).toBe('pe_baseline_generated_body');
    expect(result.currentBody.nexpathGeneratedPromptRef).toBe('enh-phase5-artifact-metadata:body:generated:1');
    expect(result.currentBody.renderedPromptBody).toBe(result.currentBody.text);
    expect(result.currentBody.originalPromptSectionId).toBe('phase5-route-1:section:1:original_request_or_goal');
    expect(result.currentBody.llmCallPolicy).toBe('no_call');
    expect(result.currentBody.sourceAttribution).toEqual(
      expect.arrayContaining([
        {
          sourceRefId: 'source-a-current-prompt',
          sourceId: 'prompt:current',
          sourceKind: 'source_a_user_prompt',
          evidenceStatus: 'present',
          publicSafeLabel: 'current original prompt',
          privateIdPolicy: 'metadata_only_not_body',
        },
      ]),
    );
    expect(result.currentBody.composerMode).toBe('baseline_deterministic_render');
    expect(result.currentBody.languagePolicyApplied).toBe('technical_english_default');
    expect(result.currentBody.languageValidationStatus).toBe('valid');
    expect(result.currentBody.effectiveLanguageState).toBe('unknown_default');
    expect(result.currentBody.languageSource).toBe('technical_english_default');
    expect(result.currentBody.languageConfidence).toBe('unknown');
    expect(result.currentBody.languagePolicy).toBe('technical_english_default');
    expect(result.currentBody.instructionPrecedenceState).toBe('generated_sections_qualify_original');
    expect(result.currentBody.originalAsSourceStatus).toBe('local_verbatim_source_context');
    expect(result.currentBody.localOriginalPromptIncluded).toBe(true);
    expect(result.currentBody.sourceFactIds).toEqual(
      expect.arrayContaining(['guidance_fact:fact-debug-repro', 'guidance_fact:fact-verification']),
    );
    expect(result.currentBody.composerClaims).toEqual(
      expect.arrayContaining(['claim:guidance_fact:fact-debug-repro', 'claim:guidance_fact:fact-verification']),
    );

    expect(result.composerBoundary.composerRunId).toBe(result.currentBody.composerRunId);
    expect(result.composerBoundary.routeDecisionId).toBe(result.currentBody.routeDecisionId);
    expect(result.composerBoundary.promptReviewOrigin).toBe(result.currentBody.promptReviewOrigin);
    expect(result.composerBoundary.promptReviewProcessingPolicy).toBe(result.currentBody.promptReviewProcessingPolicy);
    expect(result.composerBoundary.sentPromptOrigin).toBe(result.currentBody.sentPromptOrigin);
    expect(result.composerBoundary.nexpathGeneratedPromptRef).toBe(result.currentBody.nexpathGeneratedPromptRef);
    expect(result.composerBoundary.renderedPromptBody).toBe(result.currentBody.text);
    expect(result.composerBoundary.originalPromptSectionId).toBe(result.currentBody.originalPromptSectionId);
    expect(result.composerBoundary.sourceAttribution).toEqual(result.currentBody.sourceAttribution);
    expect(result.composerBoundary.llmCallPolicy).toBe('no_call');
    expect(result.composerBoundary.validatedCanonicalPromptArtifact).toBe('current_body_v1');
    expect(result.composerBoundary.rawComposerOutput).toBe('not_used_deterministic');
    expect(result.composerBoundary.budgetState).toEqual({
      llmCallPolicy: 'no_call',
      callVisibilityMode: 'deterministic',
      productValueDiscussionIsRuntimeLimiter: false,
    });
    expect(result.composerBoundary.composerInputPrivacyState).toBe('approved_refs_only');
    expect(result.composerBoundary.localRenderOriginalPrompt).toBe(true);
    expect(result.composerBoundary.composerVisiblePromptContext).toEqual({
      contextPolicy: 'structured_refs_only_no_raw_original',
      originalPromptVisibleLocallyOnly: true,
      boundedContextRefCount: result.composerBoundary.composerVisiblePromptContextRefs.length,
      rawPromptTextExcluded: true,
    });
    expect(result.composerBoundary.composerVisiblePromptContextRefs).toEqual(
      expect.arrayContaining(['source-a-current-prompt', 'source-b-content-template-debug', 'source-b-project-tests', 'guidance_fact:fact-debug-repro']),
    );
    expect(result.composerBoundary.strictSchemaFailureReasonCodes).toEqual([
      'invalid_json',
      'duplicate_key',
      'unknown_field',
      'invalid_enum',
      'bad_reference',
      'output_cap_exceeded',
      'unsafe_metadata_copy',
    ]);

    const generatedSection = result.currentBody.sections.find((section) => section.sectionKind === 'source_signal_guidance');
    expect(generatedSection).toMatchObject({
      title: 'Source Signal Guidance',
      sourceFactIds: ['section_kind:source_signal_guidance'],
      evidenceStatus: 'present',
      requiredSurvivor: true,
      mandatoryFloor: true,
      depthState: 'required_survivor',
      fallbackBehavior: 'none',
      authorityBoundary: 'no_authority_escalation',
      confirmationRequired: false,
      confirmationPresent: false,
    });
    expect(generatedSection?.bodyText).toContain('Use the current source signal as a task constraint');
    expect(generatedSection?.axisContributions).toEqual(expect.arrayContaining(['practiceDepth', 'sectionDensity', 'groundingDepth']));
    expect(generatedSection?.whyHelpReasonCodes).toContain('section_kind:source_signal_guidance');
  });

  it('transforms source facts into coding-agent instructions without copying DS advisory prose fields', () => {
    const result = composePromptEnhancementBody({
      enhancementId: 'enh-phase5-2',
      originalPromptText: 'Fix this failing test and include verification',
      sectionPlanningResult: planningResult(),
    });

    expect(result.currentBody.text).toContain('Capture the failing behavior, reproduction path, observed evidence, and expected behavior before changing code.');
    // Body quality (2026-08-06): provenance sentences live ONLY in typed metadata, never in the body.
    expect(result.currentBody.text).not.toContain('Source basis:');
    expect(result.currentBody.text).not.toContain('Source ids stay in typed metadata');
    expect(result.currentBody.text).not.toContain('ABSENCE_DEBUGGING_OBSERVATION');
    expect(result.currentBody.text).not.toContain('whyDesc');
    expect(result.currentBody.text).not.toContain('descBase');
    expect(result.currentBody.text).not.toContain('pinchFallback');
    expect(result.currentBody.text).not.toContain('Show simpler options');
    const contentTemplateSection = result.currentBody.sections.find((section) => section.sourceTemplateType === 'content_template_fact');
    expect(contentTemplateSection?.sourceIds).toContain('ABSENCE_DEBUGGING_OBSERVATION');
  });

  it('uses accepted structured LLM wording only inside planned sections with visible call metadata', () => {
    const planned = planningResult();
    const sourceGuidanceSection = planned.sectionPlans.find((section) => section.sectionKind === 'source_signal_guidance');
    const llmSourceFactId = sourceGuidanceSection?.structuredContentPartRefs[0] ?? 'missing-source-fact';
    const result = composePromptEnhancementBody({
      enhancementId: 'enh-phase5-llm-wording',
      originalPromptText: 'Fix importCsv and verify the regression.',
      sectionPlanningResult: planned,
      composerRuntimeState: 'accepted_structured_output',
      structuredComposerOutput: {
        outputId: 'llm-output-1',
        sectionDrafts: [
          {
            sectionId: sourceGuidanceSection?.sectionId ?? 'missing',
            bodyText: 'Use the current implementation-stage signal to keep the fix tied to reproduction, parser behavior, and verification evidence.',
            sourceFactIds: [llmSourceFactId],
          },
        ],
        composerClaims: [`claim:${llmSourceFactId}`],
      },
    });

    expect(result.currentBody.composerMode).toBe('baseline_llm_structured_wording');
    expect(result.currentBody.llmCallPolicy).toBe('optional_with_cost_visibility');
    expect(result.currentBody.text).toContain('Use the current implementation-stage signal');
    expect(result.currentBody.text).toContain('My original request (verbatim):\nFix importCsv and verify the regression.');
    expect(result.currentBody.text).not.toContain('ABSENCE_DEBUGGING_OBSERVATION');
    expect(result.currentBody.text).not.toContain('source-b-content-template-debug');
    expect(result.currentBody.composerClaims).toEqual([`claim:${llmSourceFactId}`]);
    expect(result.composerBoundary.composerClaims).toEqual([`claim:${llmSourceFactId}`]);
    expect(result.composerBoundary.rawComposerOutput).toBe('llm_output_validated_into_artifact');
    expect(result.composerBoundary.composerPolicy).toBe('optional_llm_with_visibility');
    expect(result.composerBoundary.budgetState.llmCallPolicy).toBe('optional_with_cost_visibility');
    expect(result.composerBoundary.inputContract.callVisibilityState).toMatchObject({
      callVisibilityMode: 'llm_wording',
      optionalCallAvailabilityState: 'allowed',
      plannedCallCount: 1,
      usedCallCount: 1,
      providerAvailabilityState: 'available',
      inputTokenCap: 8000,
      outputTokenCap: 2000,
      estimatedInputTokens: 0,
      estimatedOutputTokens: 0,
      timeoutMs: 45_000,
      productValueDiscussionIsRuntimeLimiter: false,
    });
  });

  it('E5/5.4: derives language provenance from the composer self-report on the LLM path', () => {
    const planned = planningResult();
    const sourceGuidanceSection = planned.sectionPlans.find((section) => section.sectionKind === 'source_signal_guidance');
    const llmSourceFactId = sourceGuidanceSection?.structuredContentPartRefs[0] ?? 'missing-source-fact';
    const result = composePromptEnhancementBody({
      enhancementId: 'enh-phase5-language',
      originalPromptText: 'importCsv me bug fix karo aur regression verify karo.',
      sectionPlanningResult: planned,
      composerRuntimeState: 'accepted_structured_output',
      structuredComposerOutput: {
        outputId: 'llm-output-lang',
        detectedLanguageSelfReport: 'hi-Latn',
        sectionDrafts: [
          {
            sectionId: sourceGuidanceSection?.sectionId ?? 'missing',
            bodyText: 'Reproduction, parser behavior aur verification evidence ke saath fix ko tie rakho.',
            sourceFactIds: [llmSourceFactId],
          },
        ],
        composerClaims: [`claim:${llmSourceFactId}`],
      },
    });

    expect(result.currentBody.languageSource).toBe('detected_from_prompt');
    expect(result.currentBody.languagePolicy).toBe('preserve_user_language');
    expect(result.currentBody.languagePolicyApplied).toBe('preserve_user_language');
    expect(result.currentBody.effectiveLanguageState).toBe('known');
  });

  it('E5/5.4: keeps technical-English provenance on the deterministic path', () => {
    const result = composePromptEnhancementBody({
      enhancementId: 'enh-phase5-lang-det',
      originalPromptText: 'Fix importCsv and verify the regression.',
      sectionPlanningResult: planningResult(),
    });
    expect(result.currentBody.languageSource).toBe('technical_english_default');
    expect(result.currentBody.effectiveLanguageState).toBe('unknown_default');
  });

  it('rejects unsafe structured LLM wording and keeps deterministic fallback wording', () => {
    const planned = planningResult();
    const sourceGuidanceSection = planned.sectionPlans.find((section) => section.sectionKind === 'source_signal_guidance');
    const llmSourceFactId = sourceGuidanceSection?.structuredContentPartRefs[0] ?? 'missing-source-fact';
    const result = composePromptEnhancementBody({
      enhancementId: 'enh-phase5-llm-unsafe',
      originalPromptText: 'Fix importCsv and verify the regression.',
      sectionPlanningResult: planned,
      composerRuntimeState: 'accepted_structured_output',
      structuredComposerOutput: {
        outputId: 'llm-output-unsafe',
        sectionDrafts: [
          {
            sectionId: sourceGuidanceSection?.sectionId ?? 'missing',
            bodyText: 'Copy whyDesc and ABSENCE_DEBUGGING_OBSERVATION into this option.',
            sourceFactIds: [llmSourceFactId],
          },
        ],
        composerClaims: [`claim:${llmSourceFactId}`],
      },
    });

    expect(result.currentBody.composerMode).toBe('baseline_deterministic_render');
    expect(result.currentBody.llmCallPolicy).toBe('optional_with_cost_visibility');
    expect(result.fallbackMode).toBe('deterministic_body');
    expect(result.currentBody.generatedSafeStatus).toBe('valid_with_fallback');
    expect(result.currentBody.text).not.toContain('whyDesc');
    expect(result.currentBody.text).not.toContain('ABSENCE_DEBUGGING_OBSERVATION');
    expect(result.composerBoundary.rawComposerOutput).toBe('rejected_or_unavailable');
    expect(result.composerBoundary.inputContract.callVisibilityState).toMatchObject({
      callVisibilityMode: 'fallback_no_llm',
      optionalCallAvailabilityState: 'allowed',
      plannedCallCount: 1,
      usedCallCount: 1,
      fallbackReason: 'validation_failed',
    });
  });

  it('rejects structured LLM wording when claims are not backed by planned source facts', () => {
    const planned = planningResult();
    const sourceGuidanceSection = planned.sectionPlans.find((section) => section.sectionKind === 'source_signal_guidance');
    const llmSourceFactId = sourceGuidanceSection?.structuredContentPartRefs[0] ?? 'missing-source-fact';
    const result = composePromptEnhancementBody({
      enhancementId: 'enh-phase5-llm-unbacked-claim',
      originalPromptText: 'Fix importCsv and verify the regression.',
      sectionPlanningResult: planned,
      composerRuntimeState: 'accepted_structured_output',
      structuredComposerOutput: {
        outputId: 'llm-output-unbacked-claim',
        sectionDrafts: [
          {
            sectionId: sourceGuidanceSection?.sectionId ?? 'missing',
            bodyText: 'Use the current implementation-stage signal to keep the fix tied to reproduction and verification evidence.',
            sourceFactIds: [llmSourceFactId],
          },
        ],
        composerClaims: ['claim:not-in-section-plan'],
      },
    });

    expect(result.currentBody.composerMode).toBe('baseline_deterministic_render');
    expect(result.fallbackMode).toBe('deterministic_body');
    expect(result.currentBody.text).not.toContain('Use the current implementation-stage signal to keep the fix tied to reproduction and verification evidence.');
    expect(result.composerBoundary.rawComposerOutput).toBe('rejected_or_unavailable');
    expect(result.composerBoundary.inputContract.callVisibilityState.usedCallCount).toBe(1);
  });

  it('rejects structured LLM wording with unresolved template tokens or banned generated voice', () => {
    const planned = planningResult();
    const sourceGuidanceSection = planned.sectionPlans.find((section) => section.sectionKind === 'source_signal_guidance');
    const llmSourceFactId = sourceGuidanceSection?.structuredContentPartRefs[0] ?? 'missing-source-fact';
    const result = composePromptEnhancementBody({
      enhancementId: 'enh-phase5-llm-template-token',
      originalPromptText: 'Fix importCsv and verify the regression.',
      sectionPlanningResult: planned,
      composerRuntimeState: 'accepted_structured_output',
      structuredComposerOutput: {
        outputId: 'llm-output-template-token',
        sectionDrafts: [
          {
            sectionId: sourceGuidanceSection?.sectionId ?? 'missing',
            bodyText: 'The developer should copy {R4_OPEN} because it says this action below is ready.',
            sourceFactIds: [llmSourceFactId],
          },
        ],
        composerClaims: [`claim:${llmSourceFactId}`],
      },
    });

    expect(result.currentBody.composerMode).toBe('baseline_deterministic_render');
    expect(result.fallbackMode).toBe('deterministic_body');
    expect(result.currentBody.text).not.toContain('{R4_OPEN}');
    expect(result.currentBody.text).not.toContain('The developer should');
    expect(result.currentBody.text).not.toContain('this action below');
    expect(result.composerBoundary.rawComposerOutput).toBe('rejected_or_unavailable');
  });

  /**
   * Voice-policy matching is phrase-accurate, not substring-accurate.
   *
   * Every phrase used to be matched with `.includes()`, and several are short enough to sit inside
   * unrelated words. Because one bad draft discards the WHOLE reply, a single such match cost the user
   * every section. Measured live: a prompt reading "compare our AI assistant integration against the
   * AI gateway we already ship" produced 8 valid drafts and all 8 were thrown away, because the
   * composer is required to mirror the user's own vocabulary and therefore wrote "the AI gateway".
   */
  describe('voice policy matches phrases, not substrings', () => {
    const composeWith = (bodyText: string) => {
      const planned = planningResult();
      const section = planned.sectionPlans.find((s) => s.sectionKind === 'source_signal_guidance');
      const factId = section?.structuredContentPartRefs[0] ?? 'missing-source-fact';
      return composePromptEnhancementBody({
        enhancementId: 'enh-voice-substring',
        originalPromptText: 'Fix importCsv and verify the regression.',
        sectionPlanningResult: planned,
        composerRuntimeState: 'accepted_structured_output',
        structuredComposerOutput: {
          outputId: 'llm-output-voice-substring',
          sectionDrafts: [{ sectionId: section?.sectionId ?? 'missing', bodyText, sourceFactIds: [factId] }],
          composerClaims: [`claim:${factId}`],
        },
      });
    };
    const rejected = (bodyText: string) => composeWith(bodyText).composerBoundary.rawComposerOutput === 'rejected_or_unavailable';

    it('no longer rejects ordinary words that merely contain a banned phrase', () => {
      expect(rejected('The commit says the driver changed, so capture that in the notes.')).toBe(false);
      expect(rejected('Keep this optional flag for now and record why it stays.')).toBe(false);
      expect(rejected('Count the units output by the job and compare against the baseline.')).toBe(false);
      expect(rejected('Check the aim of the retry helper before changing it.')).toBe(false);
      expect(rejected('Document the airflow DAG changes alongside the fix.')).toBe(false);
    });

    it('still rejects the phrases themselves', () => {
      expect(rejected('Note what it says in the failing log line.')).toBe(true);
      expect(rejected('Confirm this option is still needed before shipping.')).toBe(true);
      expect(rejected('Verify its output matches the recorded fixture.')).toBe(true);
      expect(rejected('You should have checked the fixture first.')).toBe(true);
    });

    it('rejects third-person references to the agent, but not the user own AI vocabulary', () => {
      // The rule exists to stop the body talking ABOUT the agent. A following verb is what makes it
      // a reference to the actor rather than to a thing the user is building.
      expect(rejected('The AI should run the migration before the checks.')).toBe(true);
      expect(rejected('The AI will need the fixture in place first.')).toBe(true);
      expect(rejected('Ask the AI to re-run the failing suite.')).toBe(true);

      expect(rejected('Compare the AI gateway against the AI assistant integration we ship.')).toBe(false);
      expect(rejected('List the AI agent features we already support in the console.')).toBe(false);
    });

    it('still rejects inflected forms of the banned phrases', () => {
      // Regression test for a defect in the boundary fix itself: a bare trailing \b silently stopped
      // matching these three, trading three voice-policy leaks for the three false positives it
      // fixed. The inflection allowance is narrow enough that the collateral above stays fixed.
      expect(rejected("You shouldn't have skipped the fixture.")).toBe(true);
      expect(rejected('That is bad practices in this repo.')).toBe(true);
      expect(rejected('Compare its outputs against the baseline.')).toBe(true);
      // ...while `m`, `rflow` and `al` are still not inflections.
      expect(rejected('Check the aim of the retry helper.')).toBe(false);
      expect(rejected('Keep this optional flag for now.')).toBe(false);
      expect(rejected('Review the optionality matrix before the change.')).toBe(false);
    });

    it('rejects common agent verbs, not only modals', () => {
      expect(rejected('The AI runs the tests every night.')).toBe(true);
      expect(rejected('The AI generates the summary for each run.')).toBe(true);
      expect(rejected('The AI ought to stop at the first failure.')).toBe(true);
    });

    it('KNOWN LEAKS, accepted: possessive, and a verb outside the list', () => {
      // 1. No verb follows "the AI", so the pattern cannot see it. `its answer` / `its output` still
      //    cover the common shape.
      expect(rejected("Record the AI's reasoning in the notes.")).toBe(false);
      // 2. Exhaustive verb detection is not attainable with a word list — the same lesson the
      //    authority rule taught. Recorded so it is not mistaken for a bug.
      expect(rejected('The AI orchestrates the whole run.')).toBe(false);
    });

    it('internal identifier fragments are still matched as substrings, deliberately', () => {
      // These are identifier fragments, not English: a partial match is a real leak. Word boundaries
      // here would let exactly what the rule exists to stop straight through.
      expect(rejected('Check pinchFallback rendering before the release.')).toBe(true);
      expect(rejected('Read whyDescBase to see where the copy comes from.')).toBe(true);
    });
  });

  it('rejects structured LLM wording that leaks private planning labels or user-referential scolding voice', () => {
    const planned = planningResult();
    const sourceGuidanceSection = planned.sectionPlans.find((section) => section.sectionKind === 'source_signal_guidance');
    const llmSourceFactId = sourceGuidanceSection?.structuredContentPartRefs[0] ?? 'missing-source-fact';
    const result = composePromptEnhancementBody({
      enhancementId: 'enh-phase5-llm-private-labels',
      originalPromptText: 'Fix importCsv and verify the regression.',
      sectionPlanningResult: planned,
      composerRuntimeState: 'accepted_structured_output',
      structuredComposerOutput: {
        outputId: 'llm-output-private-labels',
        sectionDrafts: [
          {
            sectionId: sourceGuidanceSection?.sectionId ?? 'missing',
            bodyText: 'You forgot transform-rule-1 source-review coverage in this action below.',
            sourceFactIds: [llmSourceFactId],
          },
        ],
        composerClaims: [`claim:${llmSourceFactId}`],
      },
    });

    expect(result.currentBody.composerMode).toBe('baseline_deterministic_render');
    expect(result.fallbackMode).toBe('deterministic_body');
    expect(result.currentBody.text).not.toContain('transform-rule-1');
    expect(result.currentBody.text).not.toContain('source-review');
    expect(result.currentBody.text).not.toContain('You forgot');
    expect(result.currentBody.text).not.toContain('this action below');
    expect(result.composerBoundary.rawComposerOutput).toBe('rejected_or_unavailable');
  });

  it('keeps source metadata and exact body span refs aligned with each rendered section', () => {
    const result = composePromptEnhancementBody({
      enhancementId: 'enh-phase5-3',
      originalPromptText: 'Debug the payment callback regression with tests.',
      sectionPlanningResult: planningResult(),
    });

    for (const section of result.currentBody.sections) {
      expect(section.spanRefs).toHaveLength(1);
      const span = section.spanRefs[0];
      expect(span?.spanMappingStatus).toBe('exact');
      expect(span?.startOffset).toBeGreaterThanOrEqual(0);
      expect(span?.endOffset).toBeGreaterThan(span?.startOffset ?? -1);
      // Every section's span covers its own rendered block — identified by its own heading/title.
      expect(result.currentBody.text.slice(span?.startOffset, span?.endOffset)).toContain(section.title);
      expect(span?.sourceRefs.length).toBeGreaterThan(0);
    }
    expect(result.composerBoundary.outputContract.preservesSectionIds).toBe(true);
    expect(result.composerBoundary.outputContract.preservesSourceRefs).toBe(true);
    expect(result.composerBoundary.outputContract.textOnlyOutputAllowed).toBe(false);
  });

  it('keeps Shorter as one-body recomposition while preserving original, safety, source, and verification floors', () => {
    const result = composePromptEnhancementBody({
      enhancementId: 'enh-phase5-4',
      originalPromptText: 'Fix the auth migration and verify rollback behavior.',
      sectionPlanningResult: planningResult({
        route: {
          promptText: 'Fix the auth migration and verify rollback behavior.',
          currentStage: 'architecture',
        },
        guidanceFacts: [
          fact({
            factId: 'fact-risk',
            sourceType: 'hard_fact',
            sourceIds: ['project_fact:test-suite-present'],
            guidanceKind: 'safety_or_confirmation',
            suggestedActionKind: 'plan_rollback',
            targetFamily: 'planning_spec',
            targetSectionKind: 'risk_safety_or_confirmation',
            riskLevel: 'high',
            safetyHooks: ['sensitive_action_confirmation', 'risk_or_rollback'],
          }),
        ],
      }),
      action: 'shorter',
    });

    expect(result.currentBody.generatedOriginState).toBe('pe_generated_body');
    expect(result.currentBody.text).toContain('My original request (verbatim):\nFix the auth migration and verify rollback behavior.');
    expect(result.currentBody.text).toContain('Keep confirmation and rollback checks.');
    expect(result.currentBody.text).not.toContain('Source basis:');
    expect(result.availableActions.find((action) => action.actionType === 'shorter')?.availability).toBe('available');
  });

  it('supports More thorough as recomposition with deeper coverage without creating variants', () => {
    const result = composePromptEnhancementBody({
      enhancementId: 'enh-phase5-5',
      originalPromptText: 'Review this deployment plan.',
      sectionPlanningResult: planningResult({
        route: { promptText: 'Review this deployment plan.' },
      }),
      action: 'more_thorough',
    });

    expect(result.currentBody.text).toContain('Add deeper coverage');
    expect(result.currentBody.text).not.toContain('Variant 1');
    expect(result.currentBody.text).not.toContain('Option A');
    expect(result.composerBoundary.deterministicFallback.productValueDiscussionIsRuntimeLimiter).toBe(false);
  });

  it('supports More project-grounded by attaching source refs without inventing unavailable project facts', () => {
    const result = composePromptEnhancementBody({
      enhancementId: 'enh-phase5-6',
      originalPromptText: 'Improve the flaky notification test.',
      sectionPlanningResult: planningResult({
        route: { promptText: 'Improve the flaky notification test.' },
      }),
      action: 'more_project_grounded',
    });

    expect(result.currentBody.text).toContain('Use the typed project/source metadata attached to this section as grounding');
    expect(result.currentBody.text).not.toContain('project_fact:test-suite-present');
    expect(result.currentBody.text).toContain('do not invent unavailable project facts');
    expect(result.currentBody.sections.some((section) => section.sourceIds.includes('project_fact:test-suite-present'))).toBe(true);
  });

  it('marks More project-grounded with source-coverage metadata when no project facts are available', () => {
    const result = composePromptEnhancementBody({
      enhancementId: 'enh-phase5-project-grounded-no-facts',
      originalPromptText: 'Improve the parser migration prompt.',
      sectionPlanningResult: planningResult({
        route: { promptText: 'Improve the parser migration prompt.' },
        sourceRefs: [sourceA],
        guidanceFacts: [
          fact({
            factId: 'fact-source-a-only',
            sourceType: 'prompt_derived_fact',
            sourceIds: ['prompt:current'],
            guidanceKind: 'source_signal_guidance',
            suggestedActionKind: 'no_action_render_context_only',
            targetSectionKind: 'context_and_constraints',
          }),
        ],
      }),
      action: 'more_project_grounded',
    });

    expect(result.currentBody.text).toContain('Known project grounding is unavailable for this section');
    expect(result.currentBody.text).not.toContain('Use the typed project/source metadata attached to this section as grounding');
    expect(result.diagnostics).toContainEqual({
      category: 'source_coverage',
      reasonCode: 'project_grounding_source_unavailable',
    });
    expect([...new Set(result.currentBody.sections.flatMap((section) => section.sourceIds))]).toEqual(['prompt:current']);
  });

  it('applies Additional Details through bounded recomposition of the current body', () => {
    const longDetails = `${'deployment checklist '.repeat(3000)}extra`;
    const result = composePromptEnhancementBody({
      enhancementId: 'enh-phase5-7',
      originalPromptText: 'Plan the release checklist.',
      sectionPlanningResult: planningResult({
        route: { promptText: 'Plan the release checklist.' },
        guidanceFacts: [
          fact({
            factId: 'fact-context',
            sourceType: 'prompt_derived_fact',
            sourceIds: ['prompt:current'],
            guidanceKind: 'source_signal_guidance',
            suggestedActionKind: 'no_action_render_context_only',
            targetFamily: 'planning_spec',
            targetSectionKind: 'context_and_constraints',
          }),
        ],
      }),
      action: 'apply_details',
      additionalDetailsText: longDetails,
    });

    expect(result.currentBody.text).toContain('Use these additional details as bounded task input:');
    expect(result.currentBody.text).toContain('[truncated_to_apply_details_5000_word_cap]');
    expect(result.composerBoundary.inputContract.callVisibilityState.callTrigger).toBe('additional_details');
    expect(result.sendPolicy).toBe('send_current');
    expect(result.actionInteractionState).toBe('success_replaced_body');
  });

  it('revalidates accepted Additional Details and blocks sensitive data before send', () => {
    const result = composePromptEnhancementBody({
      enhancementId: 'enh-phase6-details-sensitive',
      originalPromptText: 'Plan the production credential rotation.',
      sectionPlanningResult: planningResult({
        route: { promptText: 'Plan the production credential rotation.' },
        guidanceFacts: [
          fact({
            factId: 'fact-context',
            sourceType: 'prompt_derived_fact',
            sourceIds: ['prompt:current'],
            guidanceKind: 'source_signal_guidance',
            suggestedActionKind: 'no_action_render_context_only',
            targetFamily: 'planning_spec',
            targetSectionKind: 'context_and_constraints',
          }),
        ],
      }),
      action: 'apply_details',
      additionalDetailsText: 'Use token sk-live-example12345 in .env.production.',
    });

    expect(result.currentBody.text).toContain('Use these additional details as bounded task input:');
    expect(result.sendPolicy).toBe('no_send');
    expect(result.currentBody.generatedSafeStatus).toBe('invalid_non_sendable');
    expect(result.fallbackMode).toBe('validation_failed_no_send');
    expect(result.diagnostics.map((diagnostic) => diagnostic.reasonCode)).toContain('sensitive_data_leak:secret_or_credential_literal');
  });

  it('revalidates Additional Details bad voice instead of treating popup input as safe generated prose', () => {
    const result = composePromptEnhancementBody({
      enhancementId: 'enh-phase6-details-voice',
      originalPromptText: 'Plan the failing parser test fix.',
      sectionPlanningResult: planningResult({
        route: { promptText: 'Plan the failing parser test fix.' },
        guidanceFacts: [
          fact({
            factId: 'fact-context',
            sourceType: 'prompt_derived_fact',
            sourceIds: ['prompt:current'],
            guidanceKind: 'source_signal_guidance',
            suggestedActionKind: 'no_action_render_context_only',
            targetFamily: 'planning_spec',
            targetSectionKind: 'context_and_constraints',
          }),
        ],
      }),
      action: 'apply_details',
      additionalDetailsText: 'Ask the AI to fix this and explain why this helps.',
    });

    expect(result.currentBody.text).toContain('Use these additional details as bounded task input:');
    expect(result.sendPolicy).toBe('no_send');
    expect(result.currentBody.generatedSafeStatus).toBe('invalid_non_sendable');
    expect(result.fallbackMode).toBe('validation_failed_no_send');
    expect(result.diagnostics.map((diagnostic) => diagnostic.reasonCode)).toEqual(
      expect.arrayContaining([
        'voice_policy:third_person_agent_actor',
        'voice_policy:ui_label_bridge_voice_invalid',
      ]),
    );
  });

  it('renders Additional Details even when the original section plan did not include context and constraints', () => {
    const result = composePromptEnhancementBody({
      enhancementId: 'enh-phase5-details-synthetic-section',
      originalPromptText: 'Fix the failing import parser test.',
      sectionPlanningResult: planningResult({
        route: { promptText: 'Fix the failing import parser test.' },
        guidanceFacts: [fact({ targetSectionKind: 'verification_or_test_plan', suggestedActionKind: 'add_verification' })],
      }),
      action: 'apply_details',
      additionalDetailsText: 'The CSV fixture must keep semicolon delimiters and blank trailing columns.',
    });

    const detailsSection = result.currentBody.sections.find((section) => section.sectionKind === 'context_and_constraints');
    expect(detailsSection).toBeDefined();
    expect(result.composerBoundary.inputContract.sectionPlanIds).toContain(`${detailsSection?.sectionId.replace(':section:', ':section-plan:')}`);
    expect(result.currentBody.text).toContain('The CSV fixture must keep semicolon delimiters and blank trailing columns.');
    expect(result.currentBody.text).not.toContain('Source basis:');
    expect(result.currentBody.text).not.toContain('prompt:current');
    expect(detailsSection?.sourceIds).toContain('prompt:current');
  });

  it('keeps raw source ids out of the editable body while preserving source-use metadata', () => {
    const result = composePromptEnhancementBody({
      enhancementId: 'enh-phase5-source-id-privacy',
      originalPromptText: 'Debug the parser failure and verify rollback.',
      sectionPlanningResult: planningResult(),
      action: 'more_project_grounded',
    });

    expect(result.currentBody.text).not.toContain('ABSENCE_DEBUGGING_OBSERVATION');
    expect(result.currentBody.text).not.toContain('project_fact:test-suite-present');
    // Provenance prose is also excluded — source honesty lives entirely in typed metadata below.
    expect(result.currentBody.text).not.toContain('Source ids stay in typed metadata');
    expect(result.currentBody.sections.flatMap((section) => section.sourceIds)).toEqual(
      expect.arrayContaining(['prompt:current', 'ABSENCE_DEBUGGING_OBSERVATION', 'project_fact:test-suite-present']),
    );
    expect(result.composerBoundary.inputContract.boundedSourceSummaryRefs).toEqual(
      expect.arrayContaining(['source-a-current-prompt', 'source-b-content-template-debug', 'source-b-project-tests']),
    );
  });

  it('uses a 5000-word cap for Additional Details rather than a shorter character cap', () => {
    const details = Array.from({ length: 5001 }, (_, index) => `word${index}`).join(' ');
    const result = composePromptEnhancementBody({
      enhancementId: 'enh-phase5-details-word-cap',
      originalPromptText: 'Plan the deployment follow-up.',
      sectionPlanningResult: planningResult({ route: { promptText: 'Plan the deployment follow-up.' } }),
      action: 'apply_details',
      additionalDetailsText: details,
    });

    expect(result.currentBody.text).toContain('word4999');
    expect(result.currentBody.text).not.toContain('word5000');
    expect(result.currentBody.text).toContain('[truncated_to_apply_details_5000_word_cap]');
  });

  it('keeps accepted Additional Details covered through later Shorter recomposition', () => {
    const result = composePromptEnhancementBody({
      enhancementId: 'enh-phase5-details-shorter-canonical',
      originalPromptText: 'Plan the parser release.',
      sectionPlanningResult: planningResult({
        route: { promptText: 'Plan the parser release.' },
        guidanceFacts: [fact({ targetSectionKind: 'verification_or_test_plan', suggestedActionKind: 'add_verification' })],
      }),
      action: 'shorter',
      acceptedAdditionalDetailsText: 'Keep semicolon CSV fixtures, rollback docs, and release notes in scope.',
    });

    const detailsSection = result.currentBody.sections.find((section) => section.sectionKind === 'context_and_constraints');
    expect(detailsSection).toBeDefined();
    expect(result.currentBody.text).toContain('Keep these accepted additional details covered:');
    expect(result.currentBody.text).toContain('Keep semicolon CSV fixtures, rollback docs, and release notes in scope.');
    expect(result.currentBody.text).toContain('My original request (verbatim):\nPlan the parser release.');
  });

  it('does not use dirty unaccepted Additional Details for ordinary directional actions', () => {
    const result = composePromptEnhancementBody({
      enhancementId: 'enh-phase5-dirty-details-not-action-input',
      originalPromptText: 'Plan the parser release.',
      sectionPlanningResult: planningResult({
        route: { promptText: 'Plan the parser release.' },
      }),
      action: 'more_thorough',
      additionalDetailsText: 'UNACCEPTED hidden detail that must not be merged.',
    });

    expect(result.currentBody.text).not.toContain('UNACCEPTED hidden detail');
    expect(result.currentBody.sections.some((section) => section.sectionKind === 'context_and_constraints')).toBe(false);
  });

  it('preserves many original prompt points inside the point inventory section', () => {
    const originalPrompt = [
      'Break this work down.',
      '- keep auth behavior unchanged',
      '- update parser fixture',
      '- run focused tests',
      '- run full suite',
      '- report residual risks',
    ].join('\n');
    const result = composePromptEnhancementBody({
      enhancementId: 'enh-phase5-many-points',
      originalPromptText: originalPrompt,
      sectionPlanningResult: planningResult({
        route: {
          promptText: originalPrompt,
          currentStage: 'task_breakdown',
          firedKey: 'stage:ARCHITECTURE_TO_TASKS',
          triggerKind: 'stage_transition',
        },
        guidanceFacts: [
          fact({
            factId: 'fact-point-inventory',
            sourceType: 'stage_transition',
            sourceIds: ['stage:ARCHITECTURE_TO_TASKS'],
            guidanceKind: 'stage_transition_discipline',
            suggestedActionKind: 'handoff_sequence',
            targetFamily: 'planning_spec',
            targetSectionKind: 'point_inventory_or_decomposition',
          }),
        ],
      }),
    });

    expect(result.currentBody.text).toContain('Preserve these original points in the work plan');
    expect(result.currentBody.text).toContain('keep auth behavior unchanged');
    expect(result.currentBody.text).toContain('update parser fixture');
    expect(result.currentBody.text).toContain('run full suite');
  });

  it('keeps every extracted original point inside Shorter point inventory', () => {
    const originalPrompt = [
      'Break this work down.',
      '- keep auth behavior unchanged',
      '- update parser fixture',
      '- run focused tests',
      '- run full suite',
      '- report residual risks',
      '- preserve rollback notes',
      '- include release owner handoff',
    ].join('\n');
    const result = composePromptEnhancementBody({
      enhancementId: 'enh-phase5-shorter-all-points',
      originalPromptText: originalPrompt,
      sectionPlanningResult: planningResult({
        route: {
          promptText: originalPrompt,
          currentStage: 'task_breakdown',
          firedKey: 'stage:ARCHITECTURE_TO_TASKS',
          triggerKind: 'stage_transition',
        },
        guidanceFacts: [
          fact({
            factId: 'fact-shorter-point-inventory',
            sourceType: 'stage_transition',
            sourceIds: ['stage:ARCHITECTURE_TO_TASKS'],
            guidanceKind: 'stage_transition_discipline',
            suggestedActionKind: 'handoff_sequence',
            targetFamily: 'planning_spec',
            targetSectionKind: 'point_inventory_or_decomposition',
          }),
        ],
      }),
      action: 'shorter',
    });

    expect(result.currentBody.text).toContain('Keep these points covered:');
    for (const expectedPoint of [
      'keep auth behavior unchanged',
      'update parser fixture',
      'run focused tests',
      'run full suite',
      'report residual risks',
      'preserve rollback notes',
      'include release owner handoff',
    ]) {
      expect(result.currentBody.text).toContain(expectedPoint);
    }
  });

  it('keeps the previous sendable body when a directional action recomposition fails', () => {
    const previous = composePromptEnhancementBody({
      enhancementId: 'enh-phase5-previous',
      originalPromptText: 'Fix failing CI and show verification.',
      sectionPlanningResult: planningResult(),
    }).currentBody;

    const result = composePromptEnhancementBody({
      enhancementId: 'enh-phase5-previous',
      originalPromptText: 'Fix failing CI and show verification.',
      sectionPlanningResult: planningResult(),
      action: 'more_thorough',
      composerRuntimeState: 'timeout',
      previousSendableBody: previous,
      priorBodyId: previous.currentBodyId,
      priorBodyRevision: previous.bodyRevision,
    });

    expect(result.currentBody).toBe(previous);
    expect(result.fallbackMode).toBe('previous_sendable_body');
    expect(result.actionInteractionState).toBe('timeout_kept_previous');
    expect(result.sendPolicy).toBe('send_current');
    expect(result.diagnostics[0]?.reasonCode).toBe('action_failed_previous_body_preserved:timeout');
  });

  it('binds successful directional action recomposition to the previous current body revision', () => {
    const previous = composePromptEnhancementBody({
      enhancementId: 'enh-phase5-action-bind',
      originalPromptText: 'Improve the parser migration prompt.',
      sectionPlanningResult: planningResult(),
    }).currentBody;

    const result = composePromptEnhancementBody({
      enhancementId: 'enh-phase5-action-bind',
      originalPromptText: 'Improve the parser migration prompt.',
      sectionPlanningResult: planningResult(),
      action: 'more_thorough',
      previousSendableBody: previous,
    });

    expect(result.currentBody.currentBodyId).toBe(previous.currentBodyId);
    expect(result.currentBody.bodyRevision).toBe(previous.bodyRevision + 1);
    expect(result.actionInteractionState).toBe('success_replaced_body');
    expect(result.availableActions.every((action) => (
      action.currentBodyId === result.currentBody.currentBodyId &&
      action.bodyRevision === result.currentBody.bodyRevision
    ))).toBe(true);
  });

  it('keeps repeated More thorough recomposition idempotent instead of inflating body text', () => {
    const first = composePromptEnhancementBody({
      enhancementId: 'enh-phase5-more-thorough-idempotent',
      originalPromptText: 'Improve the parser migration prompt.',
      sectionPlanningResult: planningResult(),
      action: 'more_thorough',
    }).currentBody;

    const repeated = composePromptEnhancementBody({
      enhancementId: 'enh-phase5-more-thorough-idempotent',
      originalPromptText: 'Improve the parser migration prompt.',
      sectionPlanningResult: planningResult(),
      action: 'more_thorough',
      previousSendableBody: first,
    }).currentBody;

    expect(repeated.currentBodyId).toBe(first.currentBodyId);
    expect(repeated.bodyRevision).toBe(first.bodyRevision + 1);
    expect(repeated.text).toBe(first.text);
    expect(repeated.text.match(/Add deeper coverage/g)?.length).toBe(first.text.match(/Add deeper coverage/g)?.length);
  });

  it('recomposes cross-action changes from canonical sections instead of previous body text', () => {
    const shorter = composePromptEnhancementBody({
      enhancementId: 'enh-phase5-cross-action-canonical',
      originalPromptText: 'Improve the parser migration prompt.',
      sectionPlanningResult: planningResult(),
      action: 'shorter',
    }).currentBody;

    const thorough = composePromptEnhancementBody({
      enhancementId: 'enh-phase5-cross-action-canonical',
      originalPromptText: 'Improve the parser migration prompt.',
      sectionPlanningResult: planningResult(),
      action: 'more_thorough',
      previousSendableBody: shorter,
    }).currentBody;

    expect(thorough.currentBodyId).toBe(shorter.currentBodyId);
    expect(thorough.bodyRevision).toBe(shorter.bodyRevision + 1);
    expect(thorough.text).toContain('Capture the failing behavior, reproduction path, observed evidence, and expected behavior before changing code.');
    expect(thorough.text).toContain('Add deeper coverage');
    expect(thorough.text).not.toContain('Capture repro, observed behavior, and expected behavior.');
  });

  it('keeps generated body wording direct and avoids generic third-person recipient phrasing', () => {
    const result = composePromptEnhancementBody({
      enhancementId: 'enh-phase5-direct-voice',
      originalPromptText: 'Improve the flaky checkout test.',
      sectionPlanningResult: planningResult({
        route: { promptText: 'Improve the flaky checkout test.' },
      }),
    });

    const generatedText = result.currentBody.text.replace(/My original request \(verbatim\):[\s\S]*?(?=\n\n[A-Z]|$)/, '');
    expect(generatedText).not.toMatch(/\bthe coding agent\b/i);
    expect(generatedText).not.toMatch(/\bthe AI\b/i);
    expect(generatedText).not.toMatch(/\bAsk the AI\b/i);
    expect(result.composerBoundary.inputContract.callVisibilityState.fallbackReason).toBe('not_applicable');
  });

  it.each(['invalid_output', 'validation_failed'] as const)(
    'falls back deterministically for %s composer runtime state',
    (composerRuntimeState) => {
      const result = composePromptEnhancementBody({
        enhancementId: `enh-phase5-fallback-${composerRuntimeState}`,
        originalPromptText: 'Fix failing CI and show verification.',
        sectionPlanningResult: planningResult(),
        composerRuntimeState,
      });

      expect(result.currentBody.text).toContain('Fix failing CI and show verification.');
      expect(result.fallbackMode).not.toBe('none');
      expect(result.currentBody.generatedSafeStatus).toBe('valid_with_fallback');
      expect(result.composerBoundary.deterministicFallback.available).toBe(true);
      expect(result.composerBoundary.inputContract.callVisibilityState.plannedCallCount).toBe(1);
      expect(result.composerBoundary.inputContract.callVisibilityState.usedCallCount).toBe(1);
      if (composerRuntimeState === 'provider_unavailable') {
        expect(result.callVisibilityMode).toBe('provider_unavailable');
        expect(result.composerBoundary.inputContract.callVisibilityState.providerAvailabilityState).toBe('unavailable_by_provider_api');
        expect(result.composerBoundary.inputContract.callVisibilityState.optionalCallAvailabilityState).toBe('unavailable_by_provider_api');
        expect(result.composerBoundary.inputContract.callVisibilityState.fallbackReason).toBe('provider_unavailable');
      }
      expect(result.diagnostics[0]?.category).toBe('fallback_or_no_popup');
    },
  );

  it.each(['timeout', 'provider_unavailable'] as const)(
    'renders the FULL deterministic body for %s composer runtime state (owner ruling 2026-08-07) with the failure carried in metadata',
    (composerRuntimeState) => {
      const result = composePromptEnhancementBody({
        enhancementId: `enh-phase12-no-generated-${composerRuntimeState}`,
        originalPromptText: 'Fix failing CI and show verification.',
        sectionPlanningResult: planningResult(),
        composerRuntimeState,
      });

      // Owner ruling 2026-08-07: the original-prompt-only shell was removed — a provider failure
      // keeps the grounded deterministic body (the popup shows the failure NOTICE instead), and
      // the failure stays fully visible in the typed metadata below.
      expect(result.currentBody.text).toContain('Fix failing CI and show verification.');
      expect(result.currentBody.sections.length).toBeGreaterThan(0);
      expect(result.currentBody.generatedOriginState).toBe('pe_generated_body');
      expect(result.sendPolicy).toBe('send_current');
      expect(result.callVisibilityMode).toBe('fallback_no_llm');
      expect(result.composerBoundary.inputContract.callVisibilityState.plannedCallCount).toBe(1);
      expect(result.composerBoundary.inputContract.callVisibilityState.usedCallCount).toBe(0);
      expect(result.composerBoundary.inputContract.callVisibilityState.productValueDiscussionIsRuntimeLimiter).toBe(false);
      expect(result.composerBoundary.inputContract.callVisibilityState.providerAvailabilityState).toBe('unavailable_by_provider_api');
      expect(result.composerBoundary.inputContract.callVisibilityState.optionalCallAvailabilityState).toBe('unavailable_by_provider_api');
      if (composerRuntimeState === 'timeout') {
        expect(result.fallbackMode).toBe('timeout_no_send');
        expect(result.composerBoundary.inputContract.callVisibilityState.fallbackReason).toBe('timeout');
        expect(result.composerBoundary.inputContract.callVisibilityState.providerFailureState).toBe('timeout');
      } else {
        expect(result.fallbackMode).toBe('provider_api_unavailable');
        expect(result.composerBoundary.inputContract.callVisibilityState.fallbackReason).toBe('provider_unavailable');
        expect(result.composerBoundary.inputContract.callVisibilityState.providerFailureState).toBe('provider_api_unavailable');
      }
      expect(result.diagnostics[0]?.reasonCode).toBe(`deterministic_fallback:${composerRuntimeState}`);
    },
  );

  it('returns original-only state for no-popup routes instead of fabricating a generic enhanced prompt', () => {
    const result = composePromptEnhancementBody({
      enhancementId: 'enh-phase5-no-popup',
      originalPromptText: 'ok',
      sectionPlanningResult: planningResult({
        route: {
          promptText: 'ok',
          triggerKind: 'none',
          firedKey: undefined,
          effectiveFiredSource: undefined,
          selectedQualifyingAbsence: undefined,
          absenceGateReason: undefined,
        },
        sourceRefs: [sourceA],
        guidanceFacts: [],
      }),
    });

    expect(result.currentBody.text).toBe('ok');
    expect(result.currentBody.sections).toEqual([]);
    expect(result.currentBody.originalPromptPreservation).toBe('fallback_original_only');
    expect(result.currentBody.generatedOriginState).toBe('user_original');
    expect(result.sourceGuidanceCoverage).toBe('not_applicable');
    expect(result.availableActions.find((action) => action.actionType === 'use_original')?.availability).toBe('available');
    expect(result.availableActions.find((action) => action.actionType === 'shorter')?.availability).toBe('disabled_not_applicable');
  });
});
