/**
 * T2 carriers, third plan test: the refs survive the composer's own validation path.
 *
 * The builder is exercised in original-text-refs.test.ts. This file goes through
 * composePromptEnhancementBody so the refs are checked where they actually get written —
 * once, at composition — and are still intact on the body the validator returns.
 */
import { describe, expect, it } from 'vitest';

import type { PromptEnhancementSourceRefV1 } from './contracts.js';
import { composePromptEnhancementBody } from './compose-enhancement.js';
import { routePromptEnhancement, type PromptEnhancementRouteInput } from './routing-taxonomy.js';
import {
  planPromptEnhancementSections,
  type PromptEnhancementGuidanceFact,
  type PromptEnhancementSectionPlanningResult,
} from './templates/section-plan.js';
import { resolvePromptEnhancementOriginalTextRefV1 } from './original-text-refs.js';

const ORIGINAL_PROMPT = 'Ask the AI to fix importCsv and tell me what it says.';

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

function routeInput(overrides: Partial<PromptEnhancementRouteInput> = {}): PromptEnhancementRouteInput {
  return {
    routeDecisionId: 't2-route-1',
    promptText: ORIGINAL_PROMPT,
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

function planningResult(): PromptEnhancementSectionPlanningResult {
  return planPromptEnhancementSections({
    routeResult: routePromptEnhancement(routeInput()),
    sourceRefs: [sourceA],
    guidanceFacts: [fact()],
  });
}

describe('T2 carriers survive the composer validation path', () => {
  it('writes all three carriers onto every composed section', () => {
    const result = composePromptEnhancementBody({
      enhancementId: 'enh-t2-1',
      originalPromptText: ORIGINAL_PROMPT,
      sectionPlanningResult: planningResult(),
    });

    expect(result.currentBody.sections.length).toBeGreaterThan(0);
    for (const section of result.currentBody.sections) {
      // Present on every section, not just the ones that happened to quote something.
      expect(section.originalTextRefs).toHaveLength(1);
      expect(section.transformReasonCodes.length).toBeGreaterThan(0);
      expect(Array.isArray(section.promptPointRefs)).toBe(true);
    }
  });

  it('carries an original-section ref that resolves to the user\'s exact words', () => {
    const result = composePromptEnhancementBody({
      enhancementId: 'enh-t2-2',
      originalPromptText: ORIGINAL_PROMPT,
      sectionPlanningResult: planningResult(),
    });

    const originalSection = result.currentBody.sections
      .find((section) => section.sectionKind === 'original_request_or_goal');
    expect(originalSection).toBeDefined();

    const ref = originalSection?.originalTextRefs[0];
    expect(ref?.resolution).toBe('exact');
    // The done-when, checked on a real composed body rather than a constructed one.
    expect(resolvePromptEnhancementOriginalTextRefV1(ref!, ORIGINAL_PROMPT)).toBe(ORIGINAL_PROMPT);
    expect(originalSection?.transformReasonCodes).toContain('preserved_verbatim');
    expect(originalSection?.transformReasonCodes).toContain('quotes_original_text');
  });

  it('keeps a refused ref on the body instead of dropping it', () => {
    const result = composePromptEnhancementBody({
      enhancementId: 'enh-t2-3',
      originalPromptText: ORIGINAL_PROMPT,
      sectionPlanningResult: planningResult(),
    });

    // Generated sections are deterministic guidance prose; whatever they do or do not
    // quote, every one of them still carries a ref that states which it was.
    const generated = result.currentBody.sections
      .filter((section) => section.sectionKind !== 'original_request_or_goal');
    expect(generated.length).toBeGreaterThan(0);
    for (const section of generated) {
      const ref = section.originalTextRefs[0];
      expect(ref).toBeDefined();
      expect(['exact', 'refused']).toContain(ref?.resolution);
      if (ref?.resolution === 'refused') {
        // A refusal always says why — that is what makes it a record rather than a gap.
        expect(ref.refusalReason).toBeDefined();
        expect(section.transformReasonCodes).toContain('no_original_text_quoted');
      } else {
        expect(resolvePromptEnhancementOriginalTextRefV1(ref!, ORIGINAL_PROMPT)).toBeDefined();
        expect(section.transformReasonCodes).toContain('quotes_original_text');
      }
    }
  });

  it('leaves the body sendable — the carriers do not trip the validator', () => {
    const result = composePromptEnhancementBody({
      enhancementId: 'enh-t2-4',
      originalPromptText: ORIGINAL_PROMPT,
      sectionPlanningResult: planningResult(),
    });

    expect(result.currentBody.sections.every((section) => section.validationStatus !== 'invalid_non_sendable')).toBe(true);
  });
});
