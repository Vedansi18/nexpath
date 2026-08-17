import { describe, expect, it } from 'vitest';
import {
  applyPromptEnhancementSourceMixV1,
  PROMPT_ENHANCEMENT_LOCKED_MIX_PROFILES_V1,
  type PromptEnhancementSourceMixProfile,
} from './source-mix.js';
import { composeStructuredComposerOutputV1, type PromptEnhancementComposerClientV1 } from './llm-composer.js';
import { composePromptEnhancementBody } from './compose-enhancement.js';
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
      // The evidence must arrive FOR EACH TYPE - proven by the per-type fact id
      // beside it, not by a `kind:` label, which names the fact's PURPOSE and is
      // deliberately identical for all six here.
      expect(prompt).toContain(`f-${sourceType}`);
      expect(prompt).toContain('kind: project_grounding');
    }
  });

  it('kind names the fact PURPOSE, as §32.3’s payload does', async () => {
    // The worked example's payload reads `kind: debug_evidence` / `kind: project_grounding`
    // - the guidance kind. Purpose is what changes how a sentence must be worded: a
    // `safety_or_confirmation` fact is not a grounding note, and the model cannot
    // tell them apart from provenance alone.
    const prompt = await capturedModelPrompt([
      fact({ factId: 'f-debug', guidanceKind: 'debug_evidence', sourceType: 'absence_signal' }),
      fact({ factId: 'f-safety', guidanceKind: 'safety_or_confirmation' }),
    ]);
    expect(prompt).toContain('kind: debug_evidence');
    expect(prompt).toContain('kind: safety_or_confirmation');
  });

  it('a fact that never passed the mixer reports the confidence we ACTUALLY have', async () => {
    // The band is a lossless re-encoding of the evidence state, so falling back to
    // "unknown" would report an absence of knowledge we do not have. No production
    // path reaches here unmixed; defence in depth for direct callers.
    const strong = await capturedModelPrompt([fact({ confidenceBand: undefined, sourceEvidenceState: 'strong' })]);
    expect(strong).toContain('confidence: high');
    const weak = await capturedModelPrompt([fact({ confidenceBand: undefined, sourceEvidenceState: 'conflicting' })]);
    expect(weak).toContain('confidence: low');
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

  it('the SHIPPED set is exactly the locked eight — no more, no fewer', () => {
    // Compared against the shipped runtime list, not against another copy of the same
    // literal: test files are not typechecked, so a type-only union could gain or lose
    // a profile with this assertion still green.
    expect([...PROMPT_ENHANCEMENT_LOCKED_MIX_PROFILES_V1].sort()).toEqual([...LOCKED_PROFILES].sort());
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

  // The locked table locks THREE columns and the profile label is only one of them.
  // A label can be right while the behaviour beside it is wrong - and the behaviour
  // column is where the safety rules live ("do not use Source B facts to create
  // filler", "keep one required Source A survivor").

  it('no_useful_source_a_skip: no popup, and NO Source-B filler is rendered', () => {
    const result = applyPromptEnhancementSourceMixV1([], 'default');
    expect(result.profile).toBe('no_useful_source_a_skip');
    expect(result.showPopup).toBe(false);
    expect(result.renderedFacts).toEqual([]);
  });

  it('source_b_only_no_popup: the facts stay classified, but none is rendered', () => {
    // "Keep facts available for future grounding ... do not show a project-grounded-only
    // enhancement" - they must survive as provenance while rendering nothing.
    const result = applyPromptEnhancementSourceMixV1([groundingFact('g1')], 'default');
    expect(result.profile).toBe('source_b_only_no_popup');
    expect(result.showPopup).toBe(false);
    expect(result.classifiedFacts.length).toBeGreaterThan(0);
    expect(result.renderedFacts).toEqual([]);
  });

  it('source_a_only / light grounding / balanced: a popup carrying the Source A survivor', () => {
    for (const facts of [
      [sourceAFact()],
      [sourceAFact(), groundingFact('g1')],
      [sourceAFact(), groundingFact('g1'), groundingFact('g2')],
    ]) {
      const result = applyPromptEnhancementSourceMixV1(facts, 'default');
      expect(result.showPopup).toBe(true);
      expect(result.requiredSurvivor?.factId).toBe('a1');
      expect(result.renderedFacts.map((rendered) => rendered.factId)).toContain('a1');
    }
  });

  it('over_token_or_source_cap_compressed: the required survivor is KEPT, support compressed', () => {
    const many = [sourceAFact(), ...Array.from({ length: 8 }, (_, i) => groundingFact(`g${i}`))];
    const result = applyPromptEnhancementSourceMixV1(many, 'default');
    expect(result.requiredSurvivor?.factId).toBe('a1');
    expect(result.renderedFacts.map((rendered) => rendered.factId)).toContain('a1');
    // Compressed, not dropped: the excess stays classified with a reason.
    expect(result.renderedFacts.length).toBeLessThan(many.length);
    expect(result.classifiedFacts.length).toBe(many.length);
  });

  it('source_invalid_fallback: the invalid fact is rejected, not rendered', () => {
    const result = applyPromptEnhancementSourceMixV1([sourceAFact({ sourceIds: [] })], 'default');
    expect(result.profile).toBe('source_invalid_fallback');
    expect(result.showPopup).toBe(false);
    expect(result.renderedFacts.map((rendered) => rendered.factId)).not.toContain('a1');
  });

  it('source_a_heavy_high_risk: the high-risk survivor is required and rendered', () => {
    const result = applyPromptEnhancementSourceMixV1(
      [sourceAFact({ riskLevel: 'high', guidanceKind: 'safety_or_confirmation' })], 'default');
    expect(result.showPopup).toBe(true);
    expect(result.requiredSurvivor?.factId).toBe('a1');
    expect(result.renderedFacts.map((rendered) => rendered.factId)).toContain('a1');
  });
});

// ── Step 5's gate, END TO END (not just what the model was handed) ───────────

describe('GR-2 — the §32.3 gate: the grounded draft ships, the invented one cannot', () => {
  const debugRoute = () => routePromptEnhancement({
    routeDecisionId: 'g32',
    promptText: 'fix the null pointer error in checkout',
    currentStage: 'implementation',
    prevStage: 'task_breakdown',
    triggerKind: 'absence',
    firedKey: 'absence:debugging_observation_gap@implementation',
    classifierState: 'fire_recommended',
    degradedNoActionState: 'none',
    generatedOriginState: 'ordinary_user_prompt',
    classifierPrimaryIntent: 'issue_debug.runtime_error_exception',
    classifierIntentConfidence: 0.9,
    classifierCapabilityCandidates: [],
    classifierDebugEvidencePresent: [],
  });

  // The user's REAL test path, resolved by group A and rendered by GR-1 — the fact
  // §32.3 says the model must ground in instead of guessing infrastructure.
  const TEST_PATH = 'tests/checkout/payment.test.ts';

  const planFor = () => planPromptEnhancementSections({
    routeResult: debugRoute(),
    sourceRefs: [sourceA],
    guidanceFacts: [fact({
      targetSectionKind: 'reproduction_or_evidence',
      evidence: { key: 'test_path', value: TEST_PATH },
    })],
  });

  /** Drives one model draft through the real composer, exactly as the runtime would. */
  const composeWithDraft = (bodyText: string) => {
    const planning = planFor();
    const section = planning.sectionPlans.find((plan) => plan.sectionKind === 'reproduction_or_evidence')!;
    return composePromptEnhancementBody({
      enhancementId: 'g32',
      originalPromptText: 'fix the null pointer error in checkout',
      sectionPlanningResult: planning,
      composerRuntimeState: 'accepted_structured_output',
      structuredComposerOutput: {
        outputId: 'o1',
        sectionDrafts: [{
          sectionId: section.sectionId,
          bodyText,
          sourceFactIds: [...section.structuredContentPartRefs],
        }],
        // The claims union is OUTPUT-wide: empty or unallowed refuses the whole
        // reply before any wording is judged, so a real one is required here.
        composerClaims: section.structuredContentPartRefs.map((ref) => `claim:${ref}`),
        detectedLanguageSelfReport: 'en',
      },
    });
  };

  const reproSection = (result: ReturnType<typeof composeWithDraft>) =>
    result.currentBody.sections.find((section) => section.sectionKind === 'reproduction_or_evidence');

  it('the GROUNDED half: naming the real test path SHIPS', () => {
    // A file path is an invention item class, so this line survives ONLY because
    // the value the boundary resolved travelled with the section. That is the
    // whole GR-1→GR-2 chain observed at its end: resolved → handed to the model
    // → stated back → recognised as grounding rather than invention.
    const result = composeWithDraft(`Capture the failing run with ${TEST_PATH} before changing code.`);
    expect(reproSection(result)?.bodyText ?? '').toContain(TEST_PATH);
    expect(reproSection(result)?.groundedFactValues).toContain(TEST_PATH);
    expect(result.sendPolicy).toBe('send_current');
    expect(result.currentBody.generatedSafeStatus).toBe('valid');
    expect(result.fallbackMode).toBe('none');
  });

  it('the INVENTED half: the RabbitMQ answer cannot be sent', () => {
    // §32.3's failing case. GR-2 removes its CAUSE (the model now holds the real
    // fact), and this check is the backstop on the section that carries the
    // obligation — so the invented body is refused, not quietly shipped.
    const result = composeWithDraft('Use a reliable queue such as RabbitMQ or AWS SQS to replay the failure.');
    expect(result.sendPolicy).toBe('no_send');
    expect(result.fallbackMode).toBe('validation_failed_no_send');
    expect(result.diagnostics.map((diagnostic) => diagnostic.reasonCode))
      .toContain('no_invention_state:fabricated_item:RabbitMQ');
  });

  it('scope, recorded honestly: only sections carrying the obligation are policed', () => {
    // F2 said so explicitly ("does NOT fix invention everywhere"). On this route
    // ONE of eight sections carries it, so "the invention case is gone" rests
    // mainly on GR-2 removing the CAUSE, with the check as backstop where it
    // rides. Pinned so the bound stays visible instead of being assumed away.
    const planning = planFor();
    const policed = planning.sectionPlans.filter((plan) => plan.slotObligations.includes('no_invention_state'));
    expect(policed.length).toBeGreaterThan(0);
    expect(policed.length).toBeLessThan(planning.sectionPlans.length);
  });
});
