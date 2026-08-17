import { describe, expect, it } from 'vitest';
import {
  applyPromptEnhancementSourceMixV1,
  type PromptEnhancementSourceMixProfile,
} from './source-mix.js';
import { composeStructuredComposerOutputV1, type PromptEnhancementComposerClientV1 } from './llm-composer.js';
import { routePromptEnhancement } from './routing-taxonomy.js';
import { planPromptEnhancementSections, type PromptEnhancementGuidanceFact } from './templates/section-plan.js';
import type { PromptEnhancementSourceRefV1 } from './contracts.js';

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

function fact(overrides: Partial<PromptEnhancementGuidanceFact> = {}): PromptEnhancementGuidanceFact {
  return {
    factId: 'f-runner',
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
    // 🔒 §41.3's correction: the vitest-class line is legal ONLY with a
    // project-owned read model as its origin — prompt-mined it is illegal.
    sourceOriginScope: 'local_probe',
    sourceAnchorScope: 'project_root',
    confidenceBand: 'high',
    recencyBand: 'recent_project',
    evidence: { key: 'test_runner', value: 'vitest' },
    ...overrides,
  };
}

/** Captures the user prompt the model would receive, without any network. */
async function capturedModelPrompt(facts: readonly PromptEnhancementGuidanceFact[]): Promise<string> {
  let captured = '';
  const client: PromptEnhancementComposerClientV1 = {
    chat: {
      completions: {
        create: async (body) => {
          // BOTH messages: the rules live in the system prompt and the evidence in
          // the user prompt, and the model receives them together.
          captured = body.messages.map((message) => message.content).join('\n');
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  detectedLanguageSelfReport: 'en',
                  requestModeSelfReport: 'implementation',
                  sectionDrafts: [],
                  composerClaims: [],
                  authorityEvidence: 'x',
                  authorityModeSelfReport: 'implementation',
                }),
              },
            }],
          };
        },
      },
    },
  };
  const route = routePromptEnhancement({
    routeDecisionId: 'gr2',
    promptText: 'the checkout test keeps failing intermittently',
    currentStage: 'implementation',
    prevStage: 'task_breakdown',
    triggerKind: 'absence',
    firedKey: 'absence:verification_gap@implementation',
    classifierState: 'fire_recommended',
    degradedNoActionState: 'none',
    generatedOriginState: 'ordinary_user_prompt',
    classifierPrimaryIntent: 'issue_debug.failing_test',
    classifierIntentConfidence: 0.9,
    classifierCapabilityCandidates: [],
    classifierDebugEvidencePresent: [],
  });
  const planning = planPromptEnhancementSections({ routeResult: route, sourceRefs: [sourceA], guidanceFacts: facts });
  await composeStructuredComposerOutputV1({
    enhancementId: 'gr2',
    originalPromptText: 'the checkout test keeps failing intermittently',
    planning,
  }, client);
  return captured;
}

// ── The bill's §32.3 acceptance fixture ──────────────────────────────────────

describe('GR-2 — the §32.3 acceptance example, corrected by §41.3', () => {
  it('the model RECEIVES the resolved evidence, not a bare id list', () => {
    // Step 1: A3's payload arriving at its consumer. Before this the model was
    // handed ids and told to ground in "the facts provided" — an id names a
    // fact, it does not contain one, so there was nothing to ground in.
    return capturedModelPrompt([fact()]).then((prompt) => {
      expect(prompt).toContain('resolvedSourceFacts');
      expect(prompt).toContain('test_runner = vitest');
      expect(prompt).toContain('f-runner');
    });
  });

  it('the vitest-class evidence carries its CORROBORATED origin scope', async () => {
    // §41.3: that line is illegal as prompt-mined and legal from a project-owned
    // read model, so the origin has to travel with it or the model cannot tell.
    const prompt = await capturedModelPrompt([fact()]);
    expect(prompt).toContain('origin: local_probe');
    expect(prompt).toContain('claim: may_state_as_project_capability');
  });

  it('the claim CEILING binds the model, as it binds the deterministic path', async () => {
    const prompt = await capturedModelPrompt([fact({ claimVerbPolicy: 'must_phrase_as_possibility' })]);
    expect(prompt).toContain('claim: must_phrase_as_possibility');
    expect(prompt).toContain('Never state a fact more strongly than its claim allows');
  });

  it('evidence is FOR the model, not copy for the body (L7567)', async () => {
    const prompt = await capturedModelPrompt([fact()]);
    expect(prompt).toContain('EVIDENCE for you, not text to paste');
    expect(prompt).toContain('Never copy an evidence line verbatim');
  });

  it('a WITHHELD fact reaches the model as a citation only — its content never travels', async () => {
    // The prompt is an outbound surface: a value the body may not state must not
    // leave in the model call either, under any "the model decides" excuse.
    const prompt = await capturedModelPrompt([fact({
      factId: 'f-secret',
      privacyClass: 'sensitive_ref_only',
      evidence: { key: 'api_token', value: 'sk-live-must-not-travel' },
    })]);
    expect(prompt).not.toContain('sk-live-must-not-travel');
    expect(prompt).toContain('WITHHELD');
  });

  it('ONE change for ALL fact types — never hard_fact alone (step 4)', async () => {
    // Defect G9 blocks every fact type, so the fix cannot be keyed to one.
    for (const sourceType of [
      'absence_signal', 'stage_transition', 'content_template_record',
      'hard_fact', 'right_good_pattern', 'work_style_fact',
    ] as const) {
      const prompt = await capturedModelPrompt([fact({ sourceType, factId: `f-${sourceType}` })]);
      expect(prompt, `${sourceType} evidence did not reach the model`).toContain('test_runner = vitest');
      expect(prompt).toContain(`kind: ${sourceType}`);
    }
  });

  it('the citation contract is kept, not rebuilt (step 3)', async () => {
    const prompt = await capturedModelPrompt([fact()]);
    expect(prompt).toContain('allowedSourceFactIds');
    expect(prompt).toContain('cite in sourceFactIds only the allowed source fact ids listed for THAT section');
  });
});

// ── The bill's 8-way mixProfile fixture ──────────────────────────────────────

describe('GR-2 — the eight locked mixProfiles are each reachable in the shipped mixer', () => {
  const LOCKED_PROFILES: readonly PromptEnhancementSourceMixProfile[] = [
    'no_useful_source_a_skip',
    'source_a_only',
    'source_a_with_light_grounding',
    'balanced_dual_source',
    'source_a_heavy_high_risk',
    'source_b_only_no_popup',
    'over_token_or_source_cap_compressed',
    'source_invalid_fallback',
  ];

  const sourceAFact = (overrides: Partial<PromptEnhancementGuidanceFact> = {}) => fact({
    factId: 'a1',
    sourceType: 'absence_signal',
    sourceIds: ['absence:verification_gap@implementation'],
    guidanceKind: 'missing_practice',
    targetSectionKind: 'verification_or_test_plan',
    priority: 'required_survivor',
    ...overrides,
  });
  const groundingFact = (id: string) => fact({ factId: id, sourceIds: [`env:${id}`] });

  it('all eight locked values exist in the shipped union — no more, no fewer', () => {
    expect([...LOCKED_PROFILES].sort()).toEqual([
      'balanced_dual_source', 'no_useful_source_a_skip', 'over_token_or_source_cap_compressed',
      'source_a_heavy_high_risk', 'source_a_only', 'source_a_with_light_grounding',
      'source_b_only_no_popup', 'source_invalid_fallback',
    ]);
  });

  it.each([
    ['no_useful_source_a_skip', [] as readonly PromptEnhancementGuidanceFact[]],
    ['source_a_only', [sourceAFact()]],
    ['source_a_with_light_grounding', [sourceAFact(), groundingFact('g1')]],
    ['balanced_dual_source', [sourceAFact(), groundingFact('g1'), groundingFact('g2')]],
    ['source_a_heavy_high_risk', [sourceAFact({ riskLevel: 'high', guidanceKind: 'safety_or_confirmation' })]],
    ['source_b_only_no_popup', [groundingFact('g1')]],
    ['source_invalid_fallback', [sourceAFact({ sourceIds: [] })]],
  ])('%s is produced by its locked source condition', (expected, facts) => {
    expect(applyPromptEnhancementSourceMixV1(facts, 'default').profile).toBe(expected);
  });

  it('over_token_or_source_cap_compressed is produced when useful facts exceed the cap', () => {
    const many = [sourceAFact(), ...Array.from({ length: 8 }, (_, i) => groundingFact(`g${i}`))];
    expect(applyPromptEnhancementSourceMixV1(many, 'default').profile).toBe('over_token_or_source_cap_compressed');
  });
});
