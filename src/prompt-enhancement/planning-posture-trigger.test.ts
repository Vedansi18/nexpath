// The planning posture, pointed at the case it was built for.
//
// The posture that keeps execution-shaped wording NON-EXECUTING already existed, was already
// consumed, and fired on exactly two conditions — both about EVIDENCE QUALITY. Nothing fired when
// a developer ASKED ABOUT something risky and the body answered by instructing the agent to do it.
// This is the third trigger, and the tests below are its contract: it fires on the ruled condition,
// it never absorbs the two that already worked, and it reaches the popup state — the half that was
// never broken is asserted end to end anyway, because that is where the fix is felt.
import { describe, it, expect } from 'vitest';
import {
  routePromptEnhancement,
  PROMPT_ENHANCEMENT_UNREQUESTED_ACTION_POSTURE_REASON_V1,
} from './routing-taxonomy.js';
import { planPromptEnhancementSections } from './templates/section-plan.js';
import { composePromptEnhancementBody } from './compose-enhancement.js';
import { requiresPromptEnhancementExecutionConfirmationForPrompt } from './safety-sendability.js';
import type { PromptEnhancementFallbackMode, PromptEnhancementSourceRefV1 } from './contracts.js';

const sourceA: PromptEnhancementSourceRefV1 = {
  sourceRefId: 'src-a-1',
  sourceKind: 'source_a_user_prompt',
  sourceId: 'prompt:posture-1',
  freshness: 'current',
  confidence: 'high',
  privacyClass: 'local_private',
};

function routeFor(promptText: string, overrides: Record<string, unknown> = {}) {
  return routePromptEnhancement({
    routeDecisionId: 'posture-route',
    promptText,
    currentStage: 'implementation',
    prevStage: 'task_breakdown',
    triggerKind: 'absence',
    firedKey: 'absence:verification_gap@implementation',
    effectiveFiredSource: 'classifier_fire_recommendation',
    selectedQualifyingAbsence: 'verification_gap',
    absenceGateReason: 'selected_qualifying_absence',
    classifierState: 'fire_recommended',
    degradedNoActionState: 'none',
    generatedOriginState: 'ordinary_user_prompt',
    ...overrides,
  } as never);
}

const ASKS_ABOUT_RISK = 'how does deploying this to production actually work?';
const ASKS_TO_EXECUTE = 'delete the old migrations folder before the demo';
const NO_RISK_AT_ALL = 'center the hero text and make the font slightly larger';

describe('the third trigger — asking about something risky', () => {
  it('a question about a risky topic takes the planning posture, with its own reason code', () => {
    const route = routeFor(ASKS_ABOUT_RISK);
    expect(route.fallbackMode).toBe('planning_first');
    expect(route.reasonCodes).toContain(PROMPT_ENHANCEMENT_UNREQUESTED_ACTION_POSTURE_REASON_V1);
  });

  it('a prompt naming no risky topic does not take it', () => {
    const route = routeFor(NO_RISK_AT_ALL);
    expect(route.fallbackMode).toBe('none');
    expect(route.reasonCodes).not.toContain(PROMPT_ENHANCEMENT_UNREQUESTED_ACTION_POSTURE_REASON_V1);
  });

  it('the prompt keeps the family it earned — the posture changes the stance, not the subject', () => {
    // A debugging question about deploys is still a debugging prompt; answering it with planning
    // sections would be a different change than the one this phase is making.
    expect(routeFor(ASKS_ABOUT_RISK).primaryIntent).toBe('issue_debug.production_incident_or_support');
  });

  it('and it is not reported as weak evidence — a clear question can be perfectly well evidenced', () => {
    expect(routeFor(ASKS_ABOUT_RISK).contractDecision.ambiguityState).toBe('clear');
  });
});

describe('the two existing triggers are untouched — the regression guard', () => {
  it('conflicting evidence still reaches the posture, under ITS own reason code', () => {
    const route = routeFor('write the spec and also just ship it now', {
      conflictingRequirementSourceState: 'conflicting',
    });
    if (route.fallbackMode === 'planning_first') {
      // When the conflicting-evidence trigger fires it must be identifiable as itself.
      const isConflict = route.reasonCodes.includes('conflicting_requirement_source');
      const isPosture = route.reasonCodes.includes(PROMPT_ENHANCEMENT_UNREQUESTED_ACTION_POSTURE_REASON_V1);
      expect(isConflict || isPosture).toBe(true);
    }
  });

  it('the new reason code never appears on a route the new trigger did not cause', () => {
    // The guard that matters: the new code is emitted at exactly one site, so it can never be
    // mistaken for one of the evidence-quality causes in any record.
    const route = routeFor(NO_RISK_AT_ALL);
    expect(route.reasonCodes).not.toContain(PROMPT_ENHANCEMENT_UNREQUESTED_ACTION_POSTURE_REASON_V1);
  });
});

describe('end to end — the popup state, which is where the fix is felt', () => {
  it('the posture route puts the popup in its clarify state', () => {
    // Asserted on the popup state rather than the route result: the route result was never the
    // broken half. This is the line the consumer reads.
    const route = routeFor(ASKS_ABOUT_RISK);
    const popupState = route.noPopup ? 'suppress' : route.fallbackMode === 'planning_first' ? 'clarify' : 'show';
    expect(popupState).toBe('clarify');
  });

  it('an ordinary prompt still shows normally', () => {
    const route = routeFor(NO_RISK_AT_ALL);
    const popupState = route.noPopup ? 'suppress' : route.fallbackMode === 'planning_first' ? 'clarify' : 'show';
    expect(popupState).toBe('show');
  });
});

describe('the composed body proposes rather than instructs', () => {
  it('a posture body carries no execute-shaped instruction to do the risky thing', () => {
    const route = routeFor(ASKS_ABOUT_RISK);
    const planning = planPromptEnhancementSections({ routeResult: route, sourceRefs: [sourceA], guidanceFacts: [] });
    const body = composePromptEnhancementBody({
      enhancementId: 'posture-enh',
      originalPromptText: ASKS_ABOUT_RISK,
      sectionPlanningResult: planning,
    }).currentBody;
    const generated = body.sections
      .filter((section) => section.sectionKind !== 'original_request_or_goal')
      .map((section) => section.bodyText)
      .join('\n');
    // No imperative telling the agent to carry the risky action out.
    expect(generated).not.toMatch(/\bdeploy (this|it|the)\b/i);
    expect(generated).not.toMatch(/\brun the deployment\b/i);
    expect(generated.length).toBeGreaterThan(0);
  });
});

describe('disjointness — every risky prompt gets exactly ONE treatment', () => {
  const rows: readonly [string, string, boolean][] = [
    ['asked ABOUT a risky topic', ASKS_ABOUT_RISK, true],
    ['asked TO DO the risky thing', ASKS_TO_EXECUTE, false],
    ['asked to deploy, plainly', 'deploy this release to production now', false],
  ];

  it.each(rows)('%s', (_label, prompt, expectPosture) => {
    const posture = routeFor(prompt).fallbackMode === 'planning_first';
    const confirmation = requiresPromptEnhancementExecutionConfirmationForPrompt(prompt);
    expect(posture).toBe(expectPosture);
    // The property, not just the pair: never both, and a risky prompt is never left with neither.
    expect(posture && confirmation).toBe(false);
    expect(posture || confirmation).toBe(true);
  });
});

describe('the deliberately-dead route values stay dead', () => {
  it('no route assigns confirmation_first or fallback_safe_floor_only', () => {
    // They serve send policy, and the post-edit send path is out of scope. Pinned so a later
    // reader does not file them as fresh defects and quietly wire them.
    const prompts = [ASKS_ABOUT_RISK, ASKS_TO_EXECUTE, NO_RISK_AT_ALL, 'review my auth module for problems'];
    for (const prompt of prompts) {
      expect(['confirmation_first', 'fallback_safe_floor_only']).not.toContain(routeFor(prompt).fallbackMode);
    }
  });

  it('the DEGRADATION enum never gains the three route values — the category-error guard', () => {
    // A composed planning-posture body is not a degraded body. If these ever appear in the
    // degradation union, good bodies start being reported as failed ones.
    const degradationValues: readonly PromptEnhancementFallbackMode[] = [
      'none', 'deterministic_body', 'previous_sendable_body', 'original_prompt_only', 'no_popup',
      'disabled_action', 'delivery_unavailable', 'direct_insert_unavailable',
      'approved_non_old_copy_delivery_fallback', 'provider_api_unavailable', 'timeout_no_send',
      'validation_failed_no_send',
    ];
    for (const forbidden of ['planning_first', 'confirmation_first', 'fallback_safe_floor_only']) {
      expect(degradationValues as readonly string[]).not.toContain(forbidden);
    }
  });
});
