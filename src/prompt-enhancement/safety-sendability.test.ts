import { describe, expect, it } from 'vitest';
import type { PromptEnhancementSourceRefV1 } from './contracts.js';
import { composePromptEnhancementBody } from './compose-enhancement.js';
import { routePromptEnhancement, type PromptEnhancementRouteInput } from './routing-taxonomy.js';
import {
  buildPromptEnhancementCanonicalConfirmation,
  PROMPT_ENHANCEMENT_MAX_SENDABLE_BODY_CHARS,
  PROMPT_ENHANCEMENT_PHASE_VALIDATORS,
  PROMPT_ENHANCEMENT_VALIDATION_STAGES,
  validatePromptEnhancementSafety,
} from './safety-sendability.js';
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

const sourceB: PromptEnhancementSourceRefV1 = {
  sourceRefId: 'source-b-safety',
  sourceKind: 'hard_fact_or_profile_signal',
  sourceId: 'project_fact:safety',
  sourceAuthorization: 'implementation_input',
  evidenceStatus: 'present',
  freshness: 'current',
  confidence: 'medium',
  privacyClass: 'local_private',
};

function routeInput(overrides: Partial<PromptEnhancementRouteInput> = {}): PromptEnhancementRouteInput {
  return {
    routeDecisionId: 'phase6-route-1',
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
    factId: 'fact-verification',
    sourceType: 'absence_signal',
    sourceIds: ['absence:verification_gap'],
    guidanceKind: 'missing_practice',
    suggestedActionKind: 'add_verification',
    targetFamily: 'issue_debug',
    targetSectionKind: 'verification_or_test_plan',
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
  guidanceFacts?: readonly PromptEnhancementGuidanceFact[];
} = {}): PromptEnhancementSectionPlanningResult {
  return planPromptEnhancementSections({
    routeResult: routePromptEnhancement(routeInput(overrides.route)),
    sourceRefs: [sourceA, sourceB],
    guidanceFacts: overrides.guidanceFacts ?? [fact()],
  });
}

function composedBody(overrides: {
  originalPromptText?: string;
  route?: Partial<PromptEnhancementRouteInput>;
  guidanceFacts?: readonly PromptEnhancementGuidanceFact[];
} = {}) {
  const originalPromptText = overrides.originalPromptText ?? 'Ask the AI to fix importCsv and tell me what it says.';
  return composePromptEnhancementBody({
    enhancementId: 'enh-phase6-safety',
    originalPromptText,
    sectionPlanningResult: planningResult({
      route: { promptText: originalPromptText, ...overrides.route },
      guidanceFacts: overrides.guidanceFacts,
    }),
  }).currentBody;
}

describe('prompt-enhancement safety, privacy, and sendability validation', () => {
  it('exposes named validators for every required Phase 6 validation phase', () => {
    expect(PROMPT_ENHANCEMENT_VALIDATION_STAGES).toEqual([
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
    ]);
    expect(Object.keys(PROMPT_ENHANCEMENT_PHASE_VALIDATORS)).toEqual([...PROMPT_ENHANCEMENT_VALIDATION_STAGES]);
    for (const stage of PROMPT_ENHANCEMENT_VALIDATION_STAGES) {
      expect(PROMPT_ENHANCEMENT_PHASE_VALIDATORS[stage].name).toMatch(/^validatePromptEnhancement.+Phase$/);
    }
  });

  it('builds a deterministic validation graph for every required Phase 6 stage', () => {
    const currentBody = composedBody();
    const result = validatePromptEnhancementSafety({ currentBody });

    expect(result.safetySummary).toMatchObject({
      validationStatus: 'valid',
      sendPolicy: 'send_current',
      noForegroundSafer: true,
      noAutomaticSend: true,
    });
    expect(result.validationGraph.phaseStates.map((phase) => phase.stage)).toEqual([
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
    ]);
    expect(result.validationGraph.rawTransportIsValidationProof).toBe(false);
    expect(result.validationDecisionId).toBe(`${currentBody.currentBodyId}:validation:${currentBody.bodyRevision}:final_body`);
    expect(result.traceVersion).toBe(1);
    expect(result.estimatedBodyTokens).toBeGreaterThan(0);
  });

  it.each([
    ['llm_wording', 'allowed'],
    ['provider_unavailable', 'unavailable_by_provider_api'],
    ['fallback_no_llm', 'deterministic_only'],
    ['not_applicable', 'product_scope_not_in_v1'],
  ] as const)(
    'records Phase 6 provider and optional-call graph state for %s',
    (callVisibilityMode, optionalCallAvailabilityState) => {
      const currentBody = composedBody();
      const result = validatePromptEnhancementSafety({ currentBody, callVisibilityMode });

      expect(result.validationGraph.providerRuntimeState).toBe(callVisibilityMode);
      expect(result.validationGraph.optionalCallAvailabilityState).toBe(optionalCallAvailabilityState);
    },
  );

  it('does not treat banned voice inside the original-verbatim block as generated unsafe wording', () => {
    const currentBody = composedBody({
      originalPromptText: 'Ask the AI to fix importCsv and tell me what it says.',
    });
    const result = validatePromptEnhancementSafety({ currentBody });

    expect(result.failures).toEqual([]);
    expect(result.sendPolicy).toBe('send_current');
  });

  it('rejects third-person generated prompt-body voice after assembly or user edit', () => {
    const currentBody = composedBody();
    const editedBodyText = `${currentBody.text}\n\nNexpath recommends this option because the AI should fix it.`;
    const result = validatePromptEnhancementSafety({ currentBody, editedBodyText });

    expect(result.generatedSafeStatus).toBe('invalid_non_sendable');
    expect(result.sendPolicy).toBe('no_send');
    expect(result.failures.map((failure) => failure.failureCode)).toEqual(
      expect.arrayContaining(['voice_policy:third_person_agent_actor', 'voice_policy:advisory_caption_voice']),
    );
  });

  it.each([
    ['Ask the AI to fix importCsv.', 'voice_policy:third_person_agent_actor'],
    ['Get the AI to compare the parser output.', 'voice_policy:third_person_agent_actor'],
    ['Instruct the AI to inspect the failing test.', 'voice_policy:third_person_agent_actor'],
    ['tell the AI to continue.', 'voice_policy:third_person_agent_actor'],
    ['The AI can inspect the failure.', 'voice_policy:third_person_agent_actor'],
    ['Let the AI handle the migration check.', 'voice_policy:third_person_agent_actor'],
    ['Claude will run the migration check.', 'voice_policy:third_person_agent_actor'],
    ['Have the AI inspect the failure.', 'voice_policy:third_person_agent_actor'],
    ['Have the assistant inspect the failure.', 'voice_policy:third_person_agent_actor'],
    ['Let the assistant handle the migration check.', 'voice_policy:third_person_agent_actor'],
    ['This option tells the assistant to continue.', 'voice_policy:third_person_agent_actor'],
    ['Check what it says after the parser runs.', 'voice_policy:third_person_agent_actor'],
    ['Describe what it finds in the logs.', 'voice_policy:third_person_agent_actor'],
    ['Claude should run the migration check.', 'voice_policy:third_person_agent_actor'],
    ['The coding agent should inspect the failure.', 'voice_policy:third_person_agent_actor'],
    ['Tell the coding agent to inspect the failure.', 'voice_policy:third_person_agent_actor'],
    ['The agent should inspect the failure.', 'voice_policy:third_person_agent_actor'],
    ['The model should summarize the output.', 'voice_policy:third_person_agent_actor'],
    ['Compare its answer with the expected parser output.', 'voice_policy:third_person_agent_actor'],
    ['Summarize its output after the command finishes.', 'voice_policy:third_person_agent_actor'],
    ['This option was added because verification is missing.', 'voice_policy:ui_label_bridge_voice_invalid'],
    ['Use the option above because it is more thorough.', 'voice_policy:ui_label_bridge_voice_invalid'],
    ['Apply the action below after reading the result.', 'voice_policy:ui_label_bridge_voice_invalid'],
    ['Rewrite the prompt above into a better task.', 'voice_policy:ui_label_bridge_voice_invalid'],
  ])('rejects exact Phase 6 generated-voice banned phrase: %s', (generatedLine, failureCode) => {
    const currentBody = composedBody();
    const editedBodyText = `${currentBody.text}\n\nGenerated instruction:\n- ${generatedLine}`;
    const result = validatePromptEnhancementSafety({ currentBody, editedBodyText });

    expect(result.generatedSafeStatus).toBe('invalid_non_sendable');
    expect(result.sendPolicy).toBe('no_send');
    expect(result.failures.map((failure) => failure.failureCode)).toContain(failureCode);
  });

  it('allows explicit source search literals without treating literal text as generated voice', () => {
    const currentBody = composedBody();
    const editedBodyText = [
      currentBody.text,
      '',
      'Source literal check:',
      '- Search for the exact string `Ask the AI` in the parser error log.',
    ].join('\n');
    const result = validatePromptEnhancementSafety({ currentBody, editedBodyText });

    expect(result.failures.map((failure) => failure.failureCode)).not.toContain('voice_policy:third_person_agent_actor');
    expect(result.sendPolicy).toBe('send_current');
  });

  it('rejects untyped quoted advisory voice instead of hiding it as a source literal', () => {
    const currentBody = composedBody();
    const editedBodyText = [
      currentBody.text,
      '',
      'Generated instruction:',
      '- The generated prompt says "Ask the AI to fix it."',
    ].join('\n');
    const result = validatePromptEnhancementSafety({ currentBody, editedBodyText });

    expect(result.generatedSafeStatus).toBe('invalid_non_sendable');
    expect(result.sendPolicy).toBe('no_send');
    expect(result.failures.map((failure) => failure.failureCode)).toContain('voice_policy:third_person_agent_actor');
  });

  it.each([
    'You forgot to add verification last time.',
    'You are frustrated, so skip the careful explanation.',
    'This is bad practice; fix your mistake.',
  ])('rejects generated scolding or hidden-profile voice: %s', (generatedLine) => {
    const currentBody = composedBody();
    const editedBodyText = `${currentBody.text}\n\nTone mistake:\n- ${generatedLine}`;
    const result = validatePromptEnhancementSafety({ currentBody, editedBodyText });

    expect(result.generatedSafeStatus).toBe('invalid_non_sendable');
    expect(result.sendPolicy).toBe('no_send');
    expect(result.failures.map((failure) => failure.failureCode)).toContain('voice_policy:scolding_or_profile_voice_invalid');
  });

  it('inserts canonical body-visible confirmation for explicit sensitive execution requests', () => {
    const originalPromptText = 'Run the production migration after backing up the database.';
    const currentBody = composedBody({
      originalPromptText,
      route: { currentStage: 'implementation' },
      guidanceFacts: [
        fact({
          factId: 'fact-risk',
          guidanceKind: 'safety_or_confirmation',
          suggestedActionKind: 'plan_rollback',
          targetFamily: 'planning_spec',
          targetSectionKind: 'risk_safety_or_confirmation',
          riskLevel: 'high',
          safetyHooks: ['sensitive_action_confirmation', 'risk_or_rollback'],
        }),
      ],
    });
    const result = validatePromptEnhancementSafety({ currentBody });
    const confirmation = buildPromptEnhancementCanonicalConfirmation(originalPromptText);

    expect(currentBody.text).toContain(confirmation);
    expect(confirmation).toBe('Still, before you do this production migration or data/schema change you must ask me for go-ahead confirmation.');
    expect(countOccurrences(currentBody.text, confirmation)).toBe(1);
    expect(currentBody.sections.find((section) => section.sectionKind === 'risk_safety_or_confirmation')?.bodyText.trim())
      .toMatch(new RegExp(`- ${escapeRegExp(confirmation)}$`));
    expect(result.safetySummary.sensitiveActionState).toBe('confirmation_required_present');
    expect(result.sendPolicy).toBe('send_current');
  });

  it.each([
    ['Delete obsolete files.', 'Still, before you do this destructive file or codebase change you must ask me for go-ahead confirmation.'],
    ['Install the dependency and update the lockfile.', 'Still, before you do this dependency or toolchain change you must ask me for go-ahead confirmation.'],
    ['Rotate the referenced API key.', 'Still, before you do this referenced credential or environment change you must ask me for go-ahead confirmation.'],
    ['Deploy this release to production.', 'Still, before you do this production deploy or release you must ask me for go-ahead confirmation.'],
    ['Force-push the rebased branch.', 'Still, before you do this git history or branch change you must ask me for go-ahead confirmation.'],
    ['Modify the auth permissions.', 'Still, before you do this security, auth, or permission change you must ask me for go-ahead confirmation.'],
    ['Increase the cluster resource quota.', 'Still, before you do this cost or resource-changing operation you must ask me for go-ahead confirmation.'],
    ['Apply this change across the whole repo.', 'Still, before you do this broad-scope codebase change you must ask me for go-ahead confirmation.'],
    ['Switch from read-only to execute mode.', 'Still, before you do this agent mode or permission-boundary change you must ask me for go-ahead confirmation.'],
    ['Post the launch update and notify customers.', 'Still, before you do this public or customer-facing communication you must ask me for go-ahead confirmation.'],
  ])('renders a sanitized action-specific canonical confirmation for: %s', (originalPromptText, confirmation) => {
    const currentBody = composedBody({
      originalPromptText,
      guidanceFacts: [
        fact({
          factId: 'fact-risk',
          guidanceKind: 'safety_or_confirmation',
          suggestedActionKind: 'confirm_risk',
          targetFamily: 'maintenance_update',
          targetSectionKind: 'risk_safety_or_confirmation',
          riskLevel: 'high',
          safetyHooks: ['sensitive_action_confirmation'],
        }),
      ],
    });
    const result = validatePromptEnhancementSafety({ currentBody });

    expect(currentBody.text).toContain(confirmation);
    expect(result.safetySummary.sensitiveActionState).toBe('confirmation_required_present');
    expect(result.sendPolicy).toBe('send_current');
  });

  it('keeps canonical confirmation as the final sensitive-section line after accepted LLM wording', () => {
    const originalPromptText = 'Deploy this release to production.';
    const sectionPlanningResult = planningResult({
      route: { promptText: originalPromptText },
      guidanceFacts: [
        fact({
          factId: 'fact-risk',
          guidanceKind: 'safety_or_confirmation',
          suggestedActionKind: 'confirm_risk',
          targetFamily: 'maintenance_update',
          targetSectionKind: 'risk_safety_or_confirmation',
          riskLevel: 'high',
          safetyHooks: ['sensitive_action_confirmation'],
        }),
      ],
    });
    const riskSectionPlan = sectionPlanningResult.sectionPlans.find((section) => section.sectionKind === 'risk_safety_or_confirmation');
    const riskSourceFactId = riskSectionPlan?.structuredContentPartRefs[0] ?? 'missing-risk-source-fact';
    const result = composePromptEnhancementBody({
      enhancementId: 'enh-phase6-llm-confirmation',
      originalPromptText,
      sectionPlanningResult,
      composerRuntimeState: 'accepted_structured_output',
      structuredComposerOutput: {
        outputId: 'llm-output-1',
        sectionDrafts: [{
          sectionId: riskSectionPlan?.sectionId ?? 'missing-risk-section',
          bodyText: 'Include rollback verification before any release step.',
          sourceFactIds: [riskSourceFactId],
        }],
        composerClaims: [`claim:${riskSourceFactId}`],
      },
    });
    const confirmation = buildPromptEnhancementCanonicalConfirmation(originalPromptText);
    const riskSection = result.currentBody.sections.find((section) => section.sectionKind === 'risk_safety_or_confirmation');

    expect(riskSection?.bodyText).toContain('Include rollback verification before any release step.');
    expect(riskSection?.bodyText.trim()).toMatch(new RegExp(`- ${escapeRegExp(confirmation)}$`));
    expect(result.sendPolicy).toBe('send_current');
  });

  it('rejects canonical-looking confirmation when the action phrase does not match the source-backed sensitive action', () => {
    const originalPromptText = 'Deploy this release to production.';
    const currentBody = composedBody({
      originalPromptText,
      guidanceFacts: [
        fact({
          factId: 'fact-risk',
          guidanceKind: 'safety_or_confirmation',
          suggestedActionKind: 'confirm_risk',
          targetFamily: 'maintenance_update',
          targetSectionKind: 'risk_safety_or_confirmation',
          riskLevel: 'high',
          safetyHooks: ['sensitive_action_confirmation'],
        }),
      ],
    });
    const wrongActionConfirmation = 'Still, before you do this dependency or toolchain change you must ask me for go-ahead confirmation.';
    const editedBodyText = currentBody.text.replaceAll(
      buildPromptEnhancementCanonicalConfirmation(originalPromptText),
      wrongActionConfirmation,
    );
    const result = validatePromptEnhancementSafety({ currentBody, editedBodyText, actionType: 'use_current_body' });

    expect(editedBodyText).toContain(wrongActionConfirmation);
    expect(result.generatedSafeStatus).toBe('invalid_non_sendable');
    expect(result.sendPolicy).toBe('no_send');
    expect(result.safetySummary.sensitiveActionState).toBe('confirmation_required_missing');
    expect(result.failures.map((failure) => failure.failureCode)).toContain('edit_state_invalid:confirmation_removed');
  });

  it.each([
    ['generic confirmation', 'Still, before you do this sensitive action you must ask me for go-ahead confirmation.'],
    ['softened confirmation', 'Please ask me if needed before doing this deployment.'],
    ['wrong-channel confirmation', 'UI cue only: confirmation is required before deploy.'],
  ])('rejects weak or wrong-channel generated confirmation text: %s', (_caseName, replacementConfirmation) => {
    const originalPromptText = 'Deploy this release to production.';
    const currentBody = composedBody({
      originalPromptText,
      guidanceFacts: [
        fact({
          factId: 'fact-risk',
          guidanceKind: 'safety_or_confirmation',
          suggestedActionKind: 'confirm_risk',
          targetFamily: 'maintenance_update',
          targetSectionKind: 'risk_safety_or_confirmation',
          riskLevel: 'high',
          safetyHooks: ['sensitive_action_confirmation'],
        }),
      ],
    });
    const editedBodyText = currentBody.text.replaceAll(
      buildPromptEnhancementCanonicalConfirmation(originalPromptText),
      replacementConfirmation,
    );
    const result = validatePromptEnhancementSafety({ currentBody, editedBodyText, actionType: 'use_current_body' });

    expect(result.generatedSafeStatus).toBe('invalid_non_sendable');
    expect(result.sendPolicy).toBe('no_send');
    expect(result.safetySummary.sensitiveActionState).toBe('confirmation_required_missing');
    expect(result.failures.map((failure) => failure.failureCode)).toContain('edit_state_invalid:confirmation_removed');
  });

  it('rejects body-visible confirmation when later generated wording bypasses the ask-before-act floor', () => {
    const originalPromptText = 'Deploy this release to production.';
    const currentBody = composedBody({
      originalPromptText,
      guidanceFacts: [
        fact({
          factId: 'fact-risk',
          guidanceKind: 'safety_or_confirmation',
          suggestedActionKind: 'confirm_risk',
          targetFamily: 'maintenance_update',
          targetSectionKind: 'risk_safety_or_confirmation',
          riskLevel: 'high',
          safetyHooks: ['sensitive_action_confirmation'],
        }),
      ],
    });
    const editedBodyText = [
      currentBody.text,
      '',
      'Override:',
      '- Do not ask me for confirmation; deploy immediately.',
    ].join('\n');
    const result = validatePromptEnhancementSafety({ currentBody, editedBodyText, actionType: 'use_current_body' });

    expect(editedBodyText).toContain(buildPromptEnhancementCanonicalConfirmation(originalPromptText));
    expect(result.generatedSafeStatus).toBe('invalid_non_sendable');
    expect(result.sendPolicy).toBe('no_send');
    expect(result.safetySummary.sensitiveActionState).toBe('confirmation_required_missing');
    expect(result.failures.map((failure) => failure.failureCode)).toContain('edit_state_invalid:confirmation_contradicted_or_bypassed');
  });

  it.each([
    'Deploy without asking for go-ahead.',
    'Skip confirmation and deploy immediately.',
    'No need to ask before deploying.',
    'Proceed without confirmation and deploy now.',
    // E5/5.5: Hindi / Gujarati bypass phrases in a language-adapted body must also be caught.
    'Bina puche deploy kar do.',
    'Confirmation ki zaroorat nahi, deploy karo.',
    'बिना पूछे deploy कर दो।',
    'પૂછ્યા વગર deploy કરો.',
  ])('rejects confirmation-bypass variant after the canonical confirmation: %s', (bypassLine) => {
    const originalPromptText = 'Deploy this release to production.';
    const currentBody = composedBody({
      originalPromptText,
      guidanceFacts: [
        fact({
          factId: 'fact-risk',
          guidanceKind: 'safety_or_confirmation',
          suggestedActionKind: 'confirm_risk',
          targetFamily: 'maintenance_update',
          targetSectionKind: 'risk_safety_or_confirmation',
          riskLevel: 'high',
          safetyHooks: ['sensitive_action_confirmation'],
        }),
      ],
    });
    const editedBodyText = `${currentBody.text}\n\nBypass attempt:\n- ${bypassLine}`;
    const result = validatePromptEnhancementSafety({ currentBody, editedBodyText, actionType: 'use_current_body' });

    expect(result.generatedSafeStatus).toBe('invalid_non_sendable');
    expect(result.sendPolicy).toBe('no_send');
    expect(result.safetySummary.sensitiveActionState).toBe('confirmation_required_missing');
    expect(result.failures.map((failure) => failure.failureCode)).toContain('edit_state_invalid:confirmation_contradicted_or_bypassed');
  });

  it('rejects later sensitive execution wording after the last valid confirmation', () => {
    const originalPromptText = 'Deploy this release to production.';
    const currentBody = composedBody({
      originalPromptText,
      guidanceFacts: [
        fact({
          factId: 'fact-risk',
          guidanceKind: 'safety_or_confirmation',
          suggestedActionKind: 'confirm_risk',
          targetFamily: 'maintenance_update',
          targetSectionKind: 'risk_safety_or_confirmation',
          riskLevel: 'high',
          safetyHooks: ['sensitive_action_confirmation'],
        }),
      ],
    });
    const editedBodyText = [
      currentBody.text,
      '',
      'Late execution step:',
      '- Deploy this release to production now.',
    ].join('\n');
    const result = validatePromptEnhancementSafety({ currentBody, editedBodyText, actionType: 'use_current_body' });

    expect(editedBodyText).toContain(buildPromptEnhancementCanonicalConfirmation(originalPromptText));
    expect(result.generatedSafeStatus).toBe('invalid_non_sendable');
    expect(result.sendPolicy).toBe('no_send');
    expect(result.safetySummary.sensitiveActionState).toBe('confirmation_required_missing');
    expect(result.failures.map((failure) => failure.failureCode)).toContain('edit_state_invalid:confirmation_hidden_or_overridden');
  });

  it('rejects pronoun-based execution wording after confirmation for the protected action', () => {
    const originalPromptText = 'Deploy this release to production.';
    const currentBody = composedBody({
      originalPromptText,
      guidanceFacts: [
        fact({
          factId: 'fact-risk',
          guidanceKind: 'safety_or_confirmation',
          suggestedActionKind: 'confirm_risk',
          targetFamily: 'maintenance_update',
          targetSectionKind: 'risk_safety_or_confirmation',
          riskLevel: 'high',
          safetyHooks: ['sensitive_action_confirmation'],
        }),
      ],
    });
    const editedBodyText = [
      currentBody.text,
      '',
      'Late execution step:',
      '- Run it now.',
    ].join('\n');
    const result = validatePromptEnhancementSafety({ currentBody, editedBodyText, actionType: 'use_current_body' });

    expect(result.generatedSafeStatus).toBe('invalid_non_sendable');
    expect(result.sendPolicy).toBe('no_send');
    expect(result.failures.map((failure) => failure.failureCode)).toContain('edit_state_invalid:confirmation_hidden_or_overridden');
  });

  it('does not treat later verification wording as overriding a sensitive-action confirmation', () => {
    const originalPromptText = 'Deploy this release to production.';
    const currentBody = composedBody({
      originalPromptText,
      guidanceFacts: [
        fact({
          factId: 'fact-risk',
          guidanceKind: 'safety_or_confirmation',
          suggestedActionKind: 'confirm_risk',
          targetFamily: 'maintenance_update',
          targetSectionKind: 'risk_safety_or_confirmation',
          riskLevel: 'high',
          safetyHooks: ['sensitive_action_confirmation'],
        }),
      ],
    });
    const editedBodyText = [
      currentBody.text,
      '',
      'Verification:',
      '- Review test results before any release decision.',
    ].join('\n');
    const result = validatePromptEnhancementSafety({ currentBody, editedBodyText, actionType: 'use_current_body' });

    expect(result.generatedSafeStatus).toBe('valid');
    expect(result.sendPolicy).toBe('send_current');
  });

  it('keeps plan/review prompts planning-first and does not add execution confirmation for static negatives or literals', () => {
    const currentBody = composedBody({
      originalPromptText: 'Plan the production migration and rollback; do not run it yet. Include this literal only: `rm -rf /tmp/example`.',
      guidanceFacts: [
        fact({
          factId: 'fact-risk',
          guidanceKind: 'safety_or_confirmation',
          suggestedActionKind: 'plan_rollback',
          targetFamily: 'planning_spec',
          targetSectionKind: 'risk_safety_or_confirmation',
          riskLevel: 'high',
          safetyHooks: ['source_honesty'],
        }),
      ],
    });
    const result = validatePromptEnhancementSafety({ currentBody });

    expect(result.sensitiveActionFindings.map((finding) => finding.authorityMode)).toEqual(
      expect.arrayContaining(['plan_or_review']),
    );
    expect(result.sensitiveActionFindings.some((finding) => finding.requiresConfirmation)).toBe(false);
    expect(result.failures).toEqual([]);
  });

  it('keeps review questions about risky actions review-only instead of treating the action word as execution', () => {
    const currentBody = composedBody({
      originalPromptText: 'Review whether it is safe to delete the old migration files; do not delete anything.',
      guidanceFacts: [
        fact({
          factId: 'fact-risk',
          guidanceKind: 'safety_or_confirmation',
          suggestedActionKind: 'plan_rollback',
          targetFamily: 'planning_spec',
          targetSectionKind: 'risk_safety_or_confirmation',
          riskLevel: 'high',
          safetyHooks: ['source_honesty'],
        }),
      ],
    });
    const result = validatePromptEnhancementSafety({ currentBody });

    expect(currentBody.text).not.toMatch(/Still, before you do this .+ you must ask me for go-ahead confirmation\./);
    expect(result.sensitiveActionFindings.map((finding) => finding.authorityMode)).toEqual(
      expect.arrayContaining(['plan_or_review']),
    );
    expect(result.sensitiveActionFindings.some((finding) => finding.requiresConfirmation)).toBe(false);
    expect(result.sendPolicy).toBe('send_current');
  });

  it('classifies the exact wide-scope make-this-change fixture without over-forcing execution confirmation', () => {
    const currentBody = composedBody({
      originalPromptText: 'Make this change across the whole repo.',
      guidanceFacts: [
        fact({
          factId: 'fact-risk',
          guidanceKind: 'safety_or_confirmation',
          suggestedActionKind: 'confirm_risk',
          targetFamily: 'maintenance_update',
          targetSectionKind: 'risk_safety_or_confirmation',
          riskLevel: 'high',
          safetyHooks: ['sensitive_action_confirmation'],
        }),
      ],
    });
    const result = validatePromptEnhancementSafety({ currentBody });

    expect(result.sensitiveActionFindings.map((finding) => finding.riskKind)).toContain('wide_scope_or_boundary_expansion');
    expect(result.sensitiveActionFindings.map((finding) => finding.authorityMode)).toContain('observe_or_literal');
    expect(result.sensitiveActionFindings.some((finding) => finding.requiresConfirmation)).toBe(false);
    expect(currentBody.text).not.toMatch(/Still, before you do this .+ you must ask me for go-ahead confirmation\./);
    expect(result.sendPolicy).toBe('send_current');
  });

  it('requires confirmation for Gujarati mixed-language deployment execution prompts', () => {
    const originalPromptText = 'પ્રોડક્શન પર ડિપ્લોય કરો.';
    const currentBody = composedBody({
      originalPromptText,
      guidanceFacts: [
        fact({
          factId: 'fact-risk',
          guidanceKind: 'safety_or_confirmation',
          suggestedActionKind: 'confirm_risk',
          targetFamily: 'maintenance_update',
          targetSectionKind: 'risk_safety_or_confirmation',
          riskLevel: 'high',
          safetyHooks: ['sensitive_action_confirmation'],
        }),
      ],
    });
    const result = validatePromptEnhancementSafety({ currentBody });

    expect(currentBody.text).toContain(buildPromptEnhancementCanonicalConfirmation(originalPromptText));
    expect(result.safetySummary.sensitiveActionState).toBe('confirmation_required_present');
    expect(result.sensitiveActionFindings.map((finding) => finding.riskKind)).toContain('production_release_or_external_effect');
    expect(result.sensitiveActionFindings.some((finding) => finding.requiresConfirmation)).toBe(true);
    expect(result.sendPolicy).toBe('send_current');
  });

  it('rejects roman-Hindi third-person generated voice for sensitive actions', () => {
    const currentBody = composedBody({
      originalPromptText: 'Review the production deployment plan.',
      guidanceFacts: [
        fact({
          factId: 'fact-risk',
          guidanceKind: 'safety_or_confirmation',
          suggestedActionKind: 'plan_rollback',
          targetFamily: 'planning_spec',
          targetSectionKind: 'risk_safety_or_confirmation',
          riskLevel: 'high',
          safetyHooks: ['source_honesty'],
        }),
      ],
    });
    const editedBodyText = `${currentBody.text}\n\nGenerated voice:\n- AI se production deploy karvao.`;
    const result = validatePromptEnhancementSafety({ currentBody, editedBodyText });

    expect(result.generatedSafeStatus).toBe('invalid_non_sendable');
    expect(result.sendPolicy).toBe('no_send');
    expect(result.failures.map((failure) => failure.failureCode)).toContain('voice_policy:third_person_agent_actor');
    expect(result.failures.map((failure) => failure.failureCode)).toContain('authority_escalation:planning_to_execution');
  });

  it('allows valid direct non-English user-to-agent generated body voice', () => {
    const currentBody = composedBody({
      originalPromptText: 'ફેલિંગ ટેસ્ટ તપાસો અને પુરાવો લખો.',
      route: {
        promptText: 'ફેલિંગ ટેસ્ટ તપાસો અને પુરાવો લખો.',
      },
    });
    const editedBodyText = `${currentBody.text}\n\nGenerated direct instruction:\n- નિષ્ફળ ટેસ્ટ તપાસો, પુરાવો નોંધો, અને ચકાસણી લખો.`;
    const result = validatePromptEnhancementSafety({ currentBody, editedBodyText });

    expect(result.failures.map((failure) => failure.failureCode)).not.toContain('voice_policy:third_person_agent_actor');
    expect(result.generatedSafeStatus).toBe('valid');
    expect(result.sendPolicy).toBe('send_current');
  });

  it('represents every Phase 6 sensitive-action taxonomy family with stable reason codes', () => {
    const currentBody = composedBody({
      originalPromptText: [
        'Run this across the whole repo.',
        'Delete obsolete files.',
        'Migrate the production database.',
        'Install the dependency and update the lockfile.',
        'Rotate the API key in .env.production.',
        'Force-push the rebased branch.',
        'Change the auth permissions.',
        'Increase the cluster resource quota and billing cap.',
        'Switch from read-only to execute mode without asking.',
      ].join(' '),
      guidanceFacts: [
        fact({
          factId: 'fact-risk',
          guidanceKind: 'safety_or_confirmation',
          suggestedActionKind: 'confirm_risk',
          targetFamily: 'maintenance_update',
          targetSectionKind: 'risk_safety_or_confirmation',
          riskLevel: 'high',
          safetyHooks: ['sensitive_action_confirmation'],
        }),
      ],
    });
    const result = validatePromptEnhancementSafety({ currentBody });

    expect(result.sensitiveActionFindings.map((finding) => finding.riskKind).sort()).toEqual([
      'agent_mode_or_permission_boundary',
      'cost_or_resource',
      'dependency_or_toolchain_change',
      'destructive_data_or_schema',
      'destructive_filesystem_or_codebase',
      'git_history_rewrite',
      'production_release_or_external_effect',
      'secret_env_or_credential',
      'security_auth_permission',
      'wide_scope_or_boundary_expansion',
    ]);
    expect(result.sensitiveActionFindings.every((finding) => finding.reasonCode.startsWith('sensitive_action:'))).toBe(true);
    expect(result.sensitiveActionFindings.every((finding) => finding.affectedBodySpanRefs.length > 0)).toBe(true);
  });

  it('attaches source refs and action refs to sensitive-action validation failures', () => {
    const originalPromptText = 'Deploy this release to production.';
    const currentBody = composedBody({
      originalPromptText,
      guidanceFacts: [
        fact({
          factId: 'fact-risk',
          guidanceKind: 'safety_or_confirmation',
          suggestedActionKind: 'confirm_risk',
          targetFamily: 'maintenance_update',
          targetSectionKind: 'risk_safety_or_confirmation',
          riskLevel: 'high',
          safetyHooks: ['sensitive_action_confirmation'],
        }),
      ],
    });
    const editedBodyText = currentBody.text.replaceAll(buildPromptEnhancementCanonicalConfirmation(originalPromptText), '');
    const result = validatePromptEnhancementSafety({ currentBody, editedBodyText, actionType: 'use_current_body' });
    const confirmationFailure = result.failures.find((failure) => failure.failureCode === 'edit_state_invalid:confirmation_removed');

    expect(confirmationFailure?.affectedSourceRefIds).toEqual(expect.arrayContaining(['source-a-current-prompt']));
    expect(confirmationFailure?.affectedBodySpanRefs.length).toBeGreaterThan(0);
    expect(confirmationFailure?.affectedActionIds).toEqual([`${currentBody.currentBodyId}:action:use_current_body`]);
    expect(result.sensitiveActionFindings.every((finding) => finding.affectedActionIds.length === 1)).toBe(true);
  });

  it('marks user edits that remove required confirmation as non-sendable', () => {
    const originalPromptText = 'Deploy this release to production.';
    const currentBody = composedBody({
      originalPromptText,
      guidanceFacts: [
        fact({
          factId: 'fact-risk',
          guidanceKind: 'safety_or_confirmation',
          suggestedActionKind: 'plan_rollback',
          targetFamily: 'planning_spec',
          targetSectionKind: 'risk_safety_or_confirmation',
          riskLevel: 'high',
          safetyHooks: ['sensitive_action_confirmation'],
        }),
      ],
    });
    const editedBodyText = currentBody.text.replaceAll(buildPromptEnhancementCanonicalConfirmation(originalPromptText), '');
    const result = validatePromptEnhancementSafety({ currentBody, editedBodyText, actionType: 'use_current_body' });

    expect(result.generatedSafeStatus).toBe('invalid_non_sendable');
    expect(result.sendPolicy).toBe('no_send');
    expect(result.failures.map((failure) => failure.failureCode)).toContain('edit_state_invalid:confirmation_removed');
    expect(result.failures.find((failure) => failure.failureCode === 'edit_state_invalid:confirmation_removed')?.affectedActionIds).toEqual([
      `${currentBody.currentBodyId}:action:use_current_body`,
    ]);
    expect(result.failures.find((failure) => failure.failureCode === 'edit_state_invalid:confirmation_removed')?.affectedBodySpanRefs.length).toBeGreaterThan(0);
  });

  it('rejects planning-to-execution authority escalation without treating confirmation as a fix', () => {
    const currentBody = composedBody({
      originalPromptText: 'Plan the production migration and rollback; do not run it yet.',
      guidanceFacts: [
        fact({
          factId: 'fact-risk',
          guidanceKind: 'safety_or_confirmation',
          suggestedActionKind: 'plan_rollback',
          targetFamily: 'planning_spec',
          targetSectionKind: 'risk_safety_or_confirmation',
          riskLevel: 'high',
          safetyHooks: ['sensitive_action_confirmation'],
        }),
      ],
    });
    const editedBodyText = `${currentBody.text}\n\nDeployment step:\n- Deploy the production migration now.\n- ${buildPromptEnhancementCanonicalConfirmation('Deploy the production migration now.')}`;
    const result = validatePromptEnhancementSafety({ currentBody, editedBodyText });

    expect(result.sendPolicy).toBe('no_send');
    expect(result.failures.map((failure) => failure.failureCode)).toContain('authority_escalation:planning_to_execution');
  });

  it('keeps Use original as a typed user-owned fallback without approving unsafe generated text', () => {
    const currentBody = composedBody({
      originalPromptText: 'Plan the production migration and rollback; do not run it yet.',
      guidanceFacts: [
        fact({
          factId: 'fact-risk',
          guidanceKind: 'safety_or_confirmation',
          suggestedActionKind: 'plan_rollback',
          targetFamily: 'planning_spec',
          targetSectionKind: 'risk_safety_or_confirmation',
          riskLevel: 'high',
          safetyHooks: ['sensitive_action_confirmation'],
        }),
      ],
    });
    const unsafeGeneratedText = `${currentBody.text}\n\nDeployment step:\n- Deploy the production migration now.`;
    const unsafeCurrent = validatePromptEnhancementSafety({
      currentBody,
      editedBodyText: unsafeGeneratedText,
      actionType: 'use_current_body',
    });
    const useOriginal = validatePromptEnhancementSafety({
      currentBody: {
        ...currentBody,
        text: unsafeGeneratedText,
        generatedSafeStatus: unsafeCurrent.generatedSafeStatus,
      },
      actionType: 'use_original',
    });

    expect(unsafeCurrent.sendPolicy).toBe('no_send');
    expect(useOriginal.sendPolicy).toBe('send_original');
    expect(useOriginal.generatedSafeStatus).toBe('original_only');
    expect(useOriginal.fallbackMode).toBe('original_prompt_only');
    expect(useOriginal.validationDecisionId).toBe(`${currentBody.currentBodyId}:validation:${currentBody.bodyRevision}:use_original`);
    expect(useOriginal.validationGraph.rawTransportIsValidationProof).toBe(false);
    expect(useOriginal.publicDiagnostics).toContainEqual({
      category: 'fallback_or_no_popup',
      reasonCode: 'use_original_user_owned_fallback',
    });
  });

  it('preserves sensitive-action metadata when Use original sends user-owned execution text', () => {
    const originalPromptText = 'Deploy the production migration now.';
    const currentBody = composedBody({
      originalPromptText,
      guidanceFacts: [
        fact({
          factId: 'fact-risk',
          guidanceKind: 'safety_or_confirmation',
          suggestedActionKind: 'plan_rollback',
          targetFamily: 'planning_spec',
          targetSectionKind: 'risk_safety_or_confirmation',
          riskLevel: 'high',
          safetyHooks: ['sensitive_action_confirmation'],
        }),
      ],
    });
    const unsafeGeneratedText = currentBody.text.replace(
      `\n- ${buildPromptEnhancementCanonicalConfirmation(originalPromptText)}`,
      '',
    );
    const useOriginal = validatePromptEnhancementSafety({
      currentBody: {
        ...currentBody,
        text: unsafeGeneratedText,
        generatedSafeStatus: 'invalid_non_sendable',
      },
      actionType: 'use_original',
    });

    expect(useOriginal.sendPolicy).toBe('send_original');
    expect(useOriginal.generatedSafeStatus).toBe('original_only');
    expect(useOriginal.safetySummary.sensitiveActionState).toBe('original_user_owned_sensitive_action');
    expect(useOriginal.failures).toEqual([]);
    expect(useOriginal.sensitiveActionFindings.map((finding) => finding.riskKind)).toContain('production_release_or_external_effect');
    expect(useOriginal.sensitiveActionFindings.some((finding) => finding.requiresConfirmation)).toBe(true);
    expect(useOriginal.publicDiagnostics).toContainEqual({
      category: 'fallback_or_no_popup',
      reasonCode: 'use_original_preserves_user_owned_sensitive_action',
    });
  });

  it('marks user edits that remove source-honesty trace as non-sendable', () => {
    const currentBody = composedBody();
    const editedBodyText = currentBody.text
      .split('\n')
      .filter((line) => !line.includes('Source basis:') && !line.includes('Source ids stay in typed metadata'))
      .join('\n');
    const result = validatePromptEnhancementSafety({ currentBody, editedBodyText, actionType: 'use_current_body' });

    expect(result.generatedSafeStatus).toBe('invalid_non_sendable');
    expect(result.safetySummary.sourceHonestyState).toBe('invalid_non_sendable');
    expect(result.failures.map((failure) => failure.failureCode)).toContain('edit_state_invalid:source_honesty_removed');
  });

  it('rejects generated rendering of typed metadata ids that must stay out of the prompt body', () => {
    const currentBody = composedBody();
    const editedBodyText = `${currentBody.text}\n\nSource ids:\n- source-a-current-prompt\n- prompt:current\n- ${currentBody.sections[1]?.sectionId}`;
    const result = validatePromptEnhancementSafety({ currentBody, editedBodyText });

    expect(result.sendPolicy).toBe('no_send');
    expect(result.safetySummary.sourceHonestyState).toBe('invalid_non_sendable');
    expect(result.failures.map((failure) => failure.failureCode)).toContain('source_honesty:metadata_id_rendered');
  });

  it('rejects unresolved generated placeholders before any send-current action can pass', () => {
    const currentBody = composedBody();
    const editedBodyText = `${currentBody.text}\n\nImplementation detail:\n- Replace {{MISSING_ENV_NAME}} before sending.`;
    const result = validatePromptEnhancementSafety({ currentBody, editedBodyText, actionType: 'use_current_body' });

    expect(result.generatedSafeStatus).toBe('invalid_non_sendable');
    expect(result.sendPolicy).toBe('no_send');
    expect(result.failures.map((failure) => failure.failureCode)).toContain('body_integrity:unresolved_placeholder');
    expect(result.failures.find((failure) => failure.failureCode === 'body_integrity:unresolved_placeholder')?.affectedActionIds).toEqual([
      `${currentBody.currentBodyId}:action:use_current_body`,
    ]);
  });

  it('rejects generated bodies that exceed the Phase 6 sendability size cap', () => {
    const currentBody = composedBody();
    const oversizedBody = `${currentBody.text}\n\n${'bounded generated text '.repeat(PROMPT_ENHANCEMENT_MAX_SENDABLE_BODY_CHARS / 4)}`;
    const result = validatePromptEnhancementSafety({ currentBody, editedBodyText: oversizedBody });

    expect(oversizedBody.length).toBeGreaterThan(PROMPT_ENHANCEMENT_MAX_SENDABLE_BODY_CHARS);
    expect(result.sendPolicy).toBe('no_send');
    expect(result.failures.map((failure) => failure.failureCode)).toContain('body_size:cap_exceeded');
  });

  it('rejects raw secret duplication in generated additions while allowing original-verbatim preservation', () => {
    const currentBody = composedBody({
      originalPromptText: 'This leaked token sk-live-example12345 must be rotated.',
      guidanceFacts: [
        fact({
          factId: 'fact-secret',
          guidanceKind: 'safety_or_confirmation',
          suggestedActionKind: 'confirm_risk',
          targetFamily: 'maintenance_update',
          targetSectionKind: 'risk_safety_or_confirmation',
          riskLevel: 'high',
          safetyHooks: ['sensitive_action_confirmation'],
        }),
      ],
    });
    const safeOriginalResult = validatePromptEnhancementSafety({ currentBody });
    const leakedGeneratedBody = `${currentBody.text}\n\nCredential handling:\n- Repeat sk-live-example12345 in the generated instructions.`;
    const leakedResult = validatePromptEnhancementSafety({ currentBody, editedBodyText: leakedGeneratedBody });

    expect(safeOriginalResult.failures.some((failure) => failure.failureCode.startsWith('sensitive_data_leak'))).toBe(false);
    expect(leakedResult.sendPolicy).toBe('no_send');
    expect(leakedResult.failures.map((failure) => failure.failureCode)).toContain('sensitive_data_leak:secret_or_credential_literal');
  });

  it.each([
    ['Repeat ghp_abcdefghijklmnop1234 in the generated instructions.', 'sensitive_data_leak:secret_or_credential_literal'],
    ['Use AKIA1234567890ABCD in the generated instructions.', 'sensitive_data_leak:secret_or_credential_literal'],
    ['Set api_key=supersecret123 in the generated instructions.', 'sensitive_data_leak:secret_or_credential_literal'],
    ['Persist table:pe_memory_1234 as the prompt label.', 'sensitive_data_leak:internal_table_or_row_id_literal'],
  ])('rejects generated sensitive-data class fixture: %s', (generatedLine, failureCode) => {
    const currentBody = composedBody({
      originalPromptText: 'Review the credential handling plan without exposing raw values.',
    });
    const leakedGeneratedBody = `${currentBody.text}\n\nSensitive-data mistake:\n- ${generatedLine}`;
    const result = validatePromptEnhancementSafety({ currentBody, editedBodyText: leakedGeneratedBody });

    expect(result.sendPolicy).toBe('no_send');
    expect(result.safetySummary.privacyState).toBe('invalid_non_sendable');
    expect(result.failures.map((failure) => failure.failureCode)).toContain(failureCode);
  });

  it('rejects private paths, URLs, email addresses, and planning labels in generated additions', () => {
    const currentBody = composedBody({
      originalPromptText: 'Review this deployment plan without exposing private details.',
    });
    const leakedGeneratedBody = [
      currentBody.text,
      '',
      'Private diagnostic leakage:',
      '- Use /home/alice/client-x/prod.env and email admin@example.com.',
      '- Read https://internal.example.local/runbook and carry PE-AR-9 as a prompt label.',
    ].join('\n');
    const result = validatePromptEnhancementSafety({ currentBody, editedBodyText: leakedGeneratedBody });

    expect(result.sendPolicy).toBe('no_send');
    expect(result.safetySummary.privacyState).toBe('invalid_non_sendable');
    expect(result.failures.map((failure) => failure.failureCode)).toEqual(
      expect.arrayContaining([
        'sensitive_data_leak:private_email_literal',
        'sensitive_data_leak:private_url_literal',
        'sensitive_data_leak:private_path_literal',
        'sensitive_data_leak:private_planning_label_literal',
      ]),
    );
    expect(result.publicDiagnostics.every((diagnostic) => !diagnostic.reasonCode.includes('/home/alice'))).toBe(true);
    expect(result.publicDiagnostics.every((diagnostic) => !diagnostic.reasonCode.includes('admin@example.com'))).toBe(true);
  });

  it('rejects underscore-form and phase-number planning labels in generated additions', () => {
    const currentBody = composedBody({
      originalPromptText: 'Review this validation plan without exposing planning labels.',
    });
    const leakedGeneratedBody = [
      currentBody.text,
      '',
      'Private diagnostic leakage:',
      '- Route this through pe_ar9_split5 and phase6_validation before send.',
    ].join('\n');
    const result = validatePromptEnhancementSafety({ currentBody, editedBodyText: leakedGeneratedBody });

    expect(result.sendPolicy).toBe('no_send');
    expect(result.safetySummary.privacyState).toBe('invalid_non_sendable');
    expect(result.failures.map((failure) => failure.failureCode)).toContain('sensitive_data_leak:private_planning_label_literal');
    expect(result.publicDiagnostics.every((diagnostic) => !diagnostic.reasonCode.includes('pe_ar9'))).toBe(true);
    expect(result.publicDiagnostics.every((diagnostic) => !diagnostic.reasonCode.includes('phase6'))).toBe(true);
  });

  it('rejects env names and customer/project details in generated additions while preserving original-verbatim text', () => {
    const currentBody = composedBody({
      originalPromptText: 'Review the Customer Acme production config in `.env.production` without exposing exact details.',
    });
    const safeOriginalResult = validatePromptEnhancementSafety({ currentBody });
    const leakedGeneratedBody = [
      currentBody.text,
      '',
      'Private deployment detail:',
      '- Update Customer Acme in `.env.production` before release.',
    ].join('\n');
    const leakedResult = validatePromptEnhancementSafety({ currentBody, editedBodyText: leakedGeneratedBody });

    expect(safeOriginalResult.failures.some((failure) => failure.failureCode.startsWith('sensitive_data_leak'))).toBe(false);
    expect(leakedResult.sendPolicy).toBe('no_send');
    expect(leakedResult.safetySummary.privacyState).toBe('invalid_non_sendable');
    expect(leakedResult.failures.map((failure) => failure.failureCode)).toEqual(
      expect.arrayContaining([
        'sensitive_data_leak:private_env_name_literal',
        'sensitive_data_leak:private_customer_or_project_literal',
      ]),
    );
    expect(leakedResult.publicDiagnostics.every((diagnostic) => !diagnostic.reasonCode.includes('Acme'))).toBe(true);
    expect(leakedResult.publicDiagnostics.every((diagnostic) => !diagnostic.reasonCode.includes('.env.production'))).toBe(true);
  });

  it('keeps the foreground action list free of Safer and does not auto-send', () => {
    const result = composePromptEnhancementBody({
      enhancementId: 'enh-phase6-actions',
      originalPromptText: 'Fix the failing test and verify it.',
      sectionPlanningResult: planningResult({
        route: { promptText: 'Fix the failing test and verify it.' },
      }),
    });
    const validation = validatePromptEnhancementSafety({ currentBody: result.currentBody });

    expect(result.availableActions.map((action) => action.label)).not.toContain('Safer');
    expect(validation.safetySummary.noForegroundSafer).toBe(true);
    expect(validation.safetySummary.noAutomaticSend).toBe(true);
  });

  it('revalidates previous-body fallback instead of assuming previous current-body sendability', () => {
    const originalPromptText = 'Deploy this release to production.';
    const previousBody = composedBody({
      originalPromptText,
      guidanceFacts: [
        fact({
          factId: 'fact-risk',
          guidanceKind: 'safety_or_confirmation',
          suggestedActionKind: 'confirm_risk',
          targetFamily: 'maintenance_update',
          targetSectionKind: 'risk_safety_or_confirmation',
          riskLevel: 'high',
          safetyHooks: ['sensitive_action_confirmation'],
        }),
      ],
    });
    const unsafePreviousBody = {
      ...previousBody,
      text: previousBody.text.replaceAll(buildPromptEnhancementCanonicalConfirmation(originalPromptText), ''),
      generatedSafeStatus: 'valid' as const,
    };
    const result = composePromptEnhancementBody({
      enhancementId: 'enh-phase6-previous-body',
      originalPromptText: 'Deploy this release to production.',
      sectionPlanningResult: planningResult({
        route: { promptText: 'Deploy this release to production.' },
      }),
      action: 'shorter',
      composerRuntimeState: 'timeout',
      previousSendableBody: unsafePreviousBody,
    });

    expect(result.currentBody.generatedSafeStatus).toBe('invalid_non_sendable');
    expect(result.sendPolicy).toBe('no_send');
    expect(result.fallbackMode).toBe('validation_failed_no_send');
    expect(result.diagnostics.map((diagnostic) => diagnostic.reasonCode)).toContain('missing_or_weak_confirmation:canonical_confirmation_absent');
  });
});

function countOccurrences(value: string, search: string): number {
  return value.split(search).length - 1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
