import { describe, expect, it } from 'vitest';
import { promptEnhancementFactValueLinesV1 } from './fact-value-render.js';
import { routePromptEnhancement, type PromptEnhancementRouteInput } from './routing-taxonomy.js';
import { planPromptEnhancementSections, type PromptEnhancementGuidanceFact } from './templates/section-plan.js';
import { composePromptEnhancementBody } from './compose-enhancement.js';
import type { PromptEnhancementSourceRefV1 } from './contracts.js';

const STANDING_INSTRUCTION = 'Ground the request in current project facts';

function fact(overrides: Partial<PromptEnhancementGuidanceFact> = {}): PromptEnhancementGuidanceFact {
  return {
    factId: 'pe-fact-grounding-0',
    sourceType: 'hard_fact',
    sourceIds: ['env:test_runner'],
    guidanceKind: 'project_grounding',
    suggestedActionKind: 'ground_in_project_fact',
    targetFamily: 'family_agnostic',
    targetSectionKind: 'project_grounding_facts',
    sourceEvidenceState: 'strong',
    priority: 'normal',
    renderPolicy: 'render_as_section',
    riskLevel: 'low',
    safetyHooks: [],
    privacyClass: 'public_safe',
    sanitizationState: 'not_applicable',
    claimVerbPolicy: 'may_state_as_project_capability',
    sourceAnchorScope: 'project_root',
    recencyBand: 'recent_project',
    evidence: { key: 'test_runner', value: 'vitest' },
    ...overrides,
  };
}

const sourceA: PromptEnhancementSourceRefV1 = {
  sourceRefId: 'src-a-1',
  sourceKind: 'source_a_user_prompt',
  sourceId: 'prompt:current',
  sourceAuthorization: 'implementation_input',
  evidenceStatus: 'present',
  freshness: 'current',
  confidence: 'high',
  privacyClass: 'local_private',
};

/** The NO-KEY deterministic route — defect G4's own territory. */
function noKeyRoute(): ReturnType<typeof routePromptEnhancement> {
  const input: PromptEnhancementRouteInput = {
    routeDecisionId: 'gr1',
    promptText: 'add tests for the checkout flow before release',
    currentStage: 'implementation',
    prevStage: 'task_breakdown',
    triggerKind: 'absence',
    firedKey: 'absence:verification_gap@implementation',
    classifierState: 'fire_recommended',
    degradedNoActionState: 'none',
    generatedOriginState: 'ordinary_user_prompt',
  };
  return routePromptEnhancement(input);
}

function groundingSectionText(facts: readonly PromptEnhancementGuidanceFact[]): string {
  const planning = planPromptEnhancementSections({
    routeResult: noKeyRoute(),
    sourceRefs: [sourceA],
    guidanceFacts: facts,
  });
  const body = composePromptEnhancementBody({
    enhancementId: 'gr1',
    originalPromptText: 'add tests for the checkout flow before release',
    sectionPlanningResult: planning,
  }).currentBody;
  return (body?.sections ?? []).find((section) => section.sectionKind === 'project_grounding_facts')?.bodyText ?? '';
}

// ── The bill's G4-render fixture ─────────────────────────────────────────────

describe('GR-1 — the deterministic renderer STATES a fact value, not an instruction', () => {
  it('a no-key body contains the typed VALUE, not the standing instruction', () => {
    // The done-when: >=1 real fact value rendered into a NO-KEY body. Before
    // GR-1 the renderer had no mechanism to place a value at all — every line
    // was a standing instruction telling the reader to use grounding it held.
    const text = groundingSectionText([fact()]);
    expect(text).toContain('vitest');
    expect(text).toContain('test runner');
    expect(text).not.toContain(STANDING_INSTRUCTION);
  });

  it('a section whose instruction carries a REAL requirement keeps it, and gains the fact', () => {
    // Only the CONTENT-FREE instructions are displaced. Replacing this one
    // stripped the verification section down to a grounding statement and lost
    // the verification command it exists to ask for — with F1's own slot
    // obligation going with it.
    const planning = planPromptEnhancementSections({
      routeResult: noKeyRoute(),
      sourceRefs: [sourceA],
      guidanceFacts: [fact({ targetSectionKind: 'verification_or_test_plan' })],
    });
    const body = composePromptEnhancementBody({
      enhancementId: 'gr1',
      originalPromptText: 'add tests for the checkout flow before release',
      sectionPlanningResult: planning,
    }).currentBody;
    const text = (body?.sections ?? []).find((s2) => s2.sectionKind === 'verification_or_test_plan')?.bodyText ?? '';
    expect(text).toContain('vitest');
    expect(text).toContain('verification command');
  });

  it('a fact with NO resolved value leaves the instruction alone', () => {
    // ⛔ The Phase-4 revert lesson: widening the projection WITHOUT resolution
    // collapsed to one constant line. No value means no line — never an empty
    // claim, never an invented one.
    const text = groundingSectionText([fact({ evidence: undefined })]);
    expect(text).toContain(STANDING_INSTRUCTION);
    expect(text).not.toContain('vitest');
  });
});

// ── Step 2: the typed rules bind the deterministic wording ───────────────────

describe('GR-1 — claim policy, anchor and recency bind the deterministic wording', () => {
  it.each([
    ['may_state_as_project_capability' as const, 'Known project fact'],
    ['may_state_as_user_practice' as const, 'Your established practice'],
    ['must_have_behaviour_verified_practice' as const, 'Behaviour-verified practice'],
    ['must_phrase_as_source_signal' as const, 'The current source signal reports'],
  ])('claim policy %s chooses its verb', (claimVerbPolicy, expected) => {
    expect(promptEnhancementFactValueLinesV1('project_grounding_facts', [fact({ claimVerbPolicy })])[0])
      .toContain(expected);
  });

  it('a possibility-clamped fact is never stated flatly', () => {
    const line = promptEnhancementFactValueLinesV1('project_grounding_facts', [
      fact({ claimVerbPolicy: 'must_phrase_as_possibility' }),
    ])[0] ?? '';
    expect(line).toContain('appears to be');
    expect(line).toContain('confirm before relying on it');
    expect(line).not.toContain('Known project fact');
  });

  it('A4 anchors: a machine fact is placed on the machine, never in the project', () => {
    const machine = promptEnhancementFactValueLinesV1('project_grounding_facts', [
      fact({ sourceAnchorScope: 'machine_environment' }),
    ])[0] ?? '';
    expect(machine).toContain('on this machine');
    expect(machine).not.toContain('in this project');
  });

  it('L4977: a historical fact says so — staleness cannot be hidden', () => {
    const historical = promptEnhancementFactValueLinesV1('project_grounding_facts', [
      fact({ recencyBand: 'historical' }),
    ])[0] ?? '';
    const current = promptEnhancementFactValueLinesV1('project_grounding_facts', [
      fact({ recencyBand: 'current_prompt' }),
    ])[0] ?? '';
    expect(historical).toContain('from earlier project history');
    expect(current).not.toContain('from earlier project history');
    expect(historical).not.toBe(current);
  });
});

// ── Step 3: the per-fact gates hold on this path too ─────────────────────────

describe('GR-1 — the per-fact gates hold on the deterministic path', () => {
  it.each([
    ['do_not_render privacy', { privacyClass: 'do_not_render' as const }],
    ['unsafe_to_render sanitization', { sanitizationState: 'unsafe_to_render' as const }],
    ['a do_not_render claim policy', { claimVerbPolicy: 'do_not_render' as const }],
    ['a suppressed priority', { priority: 'suppressed' as const }],
    ['a suppress_with_reason render policy', { renderPolicy: 'suppress_with_reason' as const }],
  ])('%s never renders its value', (_label, overrides) => {
    expect(promptEnhancementFactValueLinesV1('project_grounding_facts', [fact(overrides)])).toEqual([]);
  });

  it('a gated fact leaves the section on its instruction, with the value absent from the body', () => {
    const text = groundingSectionText([fact({ privacyClass: 'do_not_render', evidence: { key: 'secret_path', value: '/etc/keys' } })]);
    expect(text).toContain(STANDING_INSTRUCTION);
    expect(text).not.toContain('/etc/keys');
  });

  it('sensitive_ref_only states THAT a source exists, never its content', () => {
    const text = groundingSectionText([fact({
      privacyClass: 'sensitive_ref_only',
      evidence: { key: 'api_token', value: 'sk-live-xyz' },
    })]);
    expect(text).toContain('content is withheld');
    expect(text).not.toContain('sk-live-xyz');
  });

  it('a fact targeting another section does not leak into this one', () => {
    expect(promptEnhancementFactValueLinesV1('project_grounding_facts', [
      fact({ targetSectionKind: 'verification_or_test_plan' }),
    ])).toEqual([]);
  });
});
