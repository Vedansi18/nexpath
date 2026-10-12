import { describe, expect, it } from 'vitest';
import {
  composeStructuredComposerOutputV1,
  type PromptEnhancementComposerClientV1,
} from './llm-composer.js';
import {
  composePromptEnhancementBody,
  promptEnhancementComposerOutputForSurvivingSectionsV1,
  type PromptEnhancementStructuredComposerOutputV1,
} from './compose-enhancement.js';
import {
  promptEnhancementProjectWordDirectiveV1,
  promptEnhancementProjectWordForFactV1,
  promptEnhancementProjectWordsLanguageAllowedV1,
  resolvePromptEnhancementProjectWordsV1,
} from './project-words.js';
import { validatePromptEnhancementSafety } from './safety-sendability.js';
import { prunePromptEnhancementSectionsV1 } from './section-pruner.js';
import {
  PROMPT_ENHANCEMENT_TAXONOMY_PRESETS,
  routePromptEnhancement,
  type PromptEnhancementRouteInput,
} from './routing-taxonomy.js';
import {
  planPromptEnhancementSections,
  promptEnhancementSectionCitableRefsV1,
  type PromptEnhancementGuidanceFact,
  type PromptEnhancementSectionPlanningResult,
} from './templates/section-plan.js';
import type { PromptEnhancementSectionPlanItemV1, PromptEnhancementSourceRefV1 } from './contracts.js';

// Project words: one section per applicable probe fact is asked for two to five words naming it, marked [[ ]], and
// keeps them only when every check holds. Each behaviour is asserted beside a CONTROL that fails without the change,
// so no assertion can pass for a reason other than the change.

const PROMPT = 'add a reschedule button to the appointment details page and run the booking tests before release';

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

/** A probe fact shaped as the producer builds it (`guidance-facts.ts`, Source B). */
function probeFact(
  factId: string,
  key: string,
  value: string,
  overrides: Partial<PromptEnhancementGuidanceFact> = {},
): PromptEnhancementGuidanceFact {
  return {
    factId,
    sourceType: 'hard_fact',
    sourceIds: [`hard_fact:${key}`],
    guidanceKind: 'project_grounding',
    sourceEligibilityState: 'support_only_not_triggering',
    suggestedActionKind: 'ground_in_project_fact',
    targetFamily: 'family_agnostic',
    targetSectionKind: '',
    sourceEvidenceState: 'strong',
    sourceOriginScope: 'local_probe',
    claimVerbPolicy: 'may_state_as_project_capability',
    factRole: 'project_grounding_support',
    priority: 'normal',
    renderPolicy: 'render_as_section',
    riskLevel: 'none',
    safetyHooks: [],
    privacyClass: 'local_private',
    sanitizationState: 'not_applicable',
    evidence: { key, value },
    sourceRuntimePath: 'local_store',
    sourceAnchorScope: 'project_root',
    publicCopySafe: true,
    ...overrides,
  };
}

const FRAMEWORK = probeFact('hard-1', 'project_framework', 'nextjs');
const LOCKFILE = probeFact('hard-2', 'has_lockfile', 'true');
const CI = probeFact('hard-3', 'has_ci_pipeline', 'true');
const RUNNER = probeFact('hard-4', 'has_test_runner', 'true');
const MINED = probeFact('mined-1', 'payment_provider', 'stripe', {
  sourceType: 'prompt_derived_fact',
  sourceIds: ['prompt_fact:payment_provider'],
  sourceEvidenceState: 'partial',
  sourceOriginScope: 'recent_prompt_history',
  claimVerbPolicy: 'must_phrase_as_possibility',
  priority: 'low',
  sanitizationState: 'prompt_derived_sanitized',
  publicCopySafe: false,
});
const ref = (factId: string): string => `guidance_fact:${factId}`;

function routeFor(intent: string): ReturnType<typeof routePromptEnhancement> {
  return routePromptEnhancement({
    routeDecisionId: `project-words-${intent}`,
    promptText: PROMPT,
    currentStage: 'implementation',
    prevStage: 'task_breakdown',
    triggerKind: 'absence',
    firedKey: 'absence:verification_gap@implementation',
    classifierState: 'fire_recommended',
    degradedNoActionState: 'none',
    generatedOriginState: 'ordinary_user_prompt',
    classifierPrimaryIntent: intent,
    classifierIntentConfidence: 0.9,
    classifierCapabilityCandidates: [],
    classifierDebugEvidencePresent: [],
  } as unknown as PromptEnhancementRouteInput);
}

function plan(
  facts: readonly PromptEnhancementGuidanceFact[],
  options: { intent?: string; language?: string } = {},
): PromptEnhancementSectionPlanningResult {
  return planPromptEnhancementSections({
    routeResult: routeFor(options.intent ?? 'feature.fresh_implementation'),
    sourceRefs: [sourceA],
    guidanceFacts: facts,
    ...(options.language === undefined ? {} : { projectWordLanguage: options.language }),
  });
}

/** The same plan as the code before this change produced it: the one field removed. */
function withoutOffer(planning: PromptEnhancementSectionPlanningResult): PromptEnhancementSectionPlanningResult {
  const strip = (section: PromptEnhancementSectionPlanItemV1): PromptEnhancementSectionPlanItemV1 => {
    const { sharedProjectFactRefs: _dropped, ...rest } = section;
    return rest;
  };
  return {
    ...planning,
    sectionPlans: planning.sectionPlans.map(strip),
    bodyPlan: { ...planning.bodyPlan, orderedSectionPlans: planning.bodyPlan.orderedSectionPlans.map(strip) },
  };
}

const hostsOf = (planning: PromptEnhancementSectionPlanningResult) =>
  planning.sectionPlans.filter((section) => section.sharedProjectFactRefs !== undefined);
const sectionOfKind = (planning: PromptEnhancementSectionPlanningResult, kind: string): PromptEnhancementSectionPlanItemV1 => {
  const section = planning.sectionPlans.find((candidate) => candidate.sectionKind === kind);
  if (!section) throw new Error(`fixture plans no ${kind} section`);
  return section;
};

async function composerPrompt(planning: PromptEnhancementSectionPlanningResult): Promise<string> {
  const userPrompts: string[] = [];
  const client: PromptEnhancementComposerClientV1 = {
    chat: {
      completions: {
        create: async (body) => {
          for (const message of body.messages) {
            if (message.role === 'user') userPrompts.push(message.content);
          }
          return { choices: [{ message: { content: '' } }] };
        },
      },
    },
  };
  await composeStructuredComposerOutputV1({ enhancementId: 'project-words', originalPromptText: PROMPT, planning }, client);
  expect(userPrompts.length, 'the composer must have made its call').toBeGreaterThan(0);
  return userPrompts[0] ?? '';
}

/** One draft per non-original section; the host section's text is the given one. */
function replyWith(
  planning: PromptEnhancementSectionPlanningResult,
  textByKind: Readonly<Record<string, string>>,
  extra: Partial<PromptEnhancementStructuredComposerOutputV1> = {},
): PromptEnhancementStructuredComposerOutputV1 {
  const drafts = planning.sectionPlans
    .filter((section) => section.sectionKind !== 'original_request_or_goal')
    .map((section) => ({
      sectionId: section.sectionId,
      bodyText: textByKind[section.sectionKind] ?? `Cover the ${section.sectionKind.split('_')[0]} part of the reschedule button.`,
      sourceFactIds: [section.structuredContentPartRefs[0] ?? `section_kind:${section.sectionKind}`],
    }));
  return {
    outputId: 'project-words:composer-llm',
    sectionDrafts: drafts,
    composerClaims: [...new Set(drafts.map((draft) => `claim:${draft.sourceFactIds[0]}`))],
    ...extra,
  };
}

function composedWith(planning: PromptEnhancementSectionPlanningResult, output: PromptEnhancementStructuredComposerOutputV1, prompt = PROMPT) {
  return composePromptEnhancementBody({
    enhancementId: 'project-words',
    originalPromptText: prompt,
    sectionPlanningResult: planning,
    composerRuntimeState: 'accepted_structured_output',
    structuredComposerOutput: output,
  });
}

const sectionText = (result: ReturnType<typeof composedWith>, kind: string): string =>
  result.currentBody.sections.find((section) => section.sectionKind === kind)?.bodyText ?? '';

describe('the words each fact offers', () => {
  it('the framework names itself as a developer writes it', () => {
    expect(promptEnhancementProjectWordForFactV1(FRAMEWORK)).toEqual({ kind: 'framework', phrase: 'in the Next.js app', namedValues: ['Next.js'] });
  });

  it.each([
    ['a CI pipeline (withdrawn 2026-10-10: kept rarely, and it primed CI mentions in other sections)', CI],
    ['a bare test-runner flag', RUNNER],
    ['a bare lockfile flag', LOCKFILE],
    ['version control', probeFact('hard-5', 'has_version_control', 'true')],
    ['a CI pipeline the probe found ABSENT', probeFact('hard-6', 'has_ci_pipeline', 'false')],
    ['a framework with no name a developer would use ("vite")', probeFact('hard-7', 'project_framework', 'vite')],
    ['a framework MOVEMENT, which states a change, not a project', probeFact('envchg-1', 'project_framework', 'changed from react to nextjs')],
  ] as const)('%s offers no words', (_label, fact) => {
    expect(promptEnhancementProjectWordForFactV1(fact)).toBeUndefined();
  });

  it('only English (or an unknown language) is offered words — the checks read English', () => {
    for (const language of [undefined, '', 'unknown', 'en', 'EN', 'en-US']) expect(promptEnhancementProjectWordsLanguageAllowedV1(language), String(language)).toBe(true);
    for (const language of ['hi', 'hi-Latn', 'gu', 'gu-Latn', 'es', 'fr']) expect(promptEnhancementProjectWordsLanguageAllowedV1(language), language).toBe(false);
  });
});

describe('the planner offers each fact to ONE section, never to every section', () => {
  it('the framework goes to the steps section and nowhere else; the field ships only there', () => {
    const planning = plan([FRAMEWORK, LOCKFILE]);
    expect(hostsOf(planning).map((section) => [section.sectionKind, section.sharedProjectFactRefs])).toEqual([
      ['approach_or_steps', [ref('hard-1')]],
    ]);
    expect(planning.bodyPlan.orderedSectionPlans).toEqual(planning.sectionPlans);
  });

  it('a fact with no words (CI) beside the framework is offered nowhere; the framework still gets its one section', () => {
    const planning = plan([FRAMEWORK, CI]);
    expect(hostsOf(planning).map((section) => [section.sectionKind, section.sharedProjectFactRefs])).toEqual([
      ['approach_or_steps', [ref('hard-1')]],
    ]);
  });

  it.each([
    ['no facts at all', []],
    ['a prompt-mined fact (never judged for applicability)', [MINED]],
    ['a probe fact judged not applicable', [probeFact('hard-1', 'project_framework', 'nextjs', {
      priority: 'suppressed', renderPolicy: 'suppress_with_reason', selectionState: 'suppressed_by_relevance' })]],
    ['a probe that could not tell', [probeFact('hard-1', 'project_framework', 'null', { sourceEvidenceState: 'stale_or_unknown' })]],
    ['a false capability (safety material)', [probeFact('hard-1', 'has_backups', 'false', {
      renderPolicy: 'metadata_only', claimVerbPolicy: 'source_label_only', factRole: 'safety_confirmation_support' })]],
    ['a probe fact with no resolved value', [probeFact('hard-1', 'project_framework', 'nextjs', { evidence: undefined })]],
    ['only facts that offer no words', [RUNNER, LOCKFILE]],
  ] as const)('nothing is offered for %s — the plan is exactly the plan without this change', (_label, facts) => {
    const planning = plan(facts);
    expect(hostsOf(planning)).toEqual([]);
    expect(planning).toEqual(withoutOffer(planning));
  });

  it('a body the developer writes in another language is offered nothing', () => {
    expect(hostsOf(plan([FRAMEWORK], { language: 'hi-Latn' }))).toEqual([]);
    // CONTROL: the same fact, English or unknown, is offered.
    expect(hostsOf(plan([FRAMEWORK], { language: 'en' })).length).toBe(1);
    expect(hostsOf(plan([FRAMEWORK], { language: 'unknown' })).length).toBe(1);
  });

  it('a plan with no section the fact serves offers it nowhere', () => {
    // The rollout-plan preset plans no section the framework serves: it has no home there.
    const planning = plan([FRAMEWORK], { intent: 'planning.rollout_release_plan' });
    expect(planning.sectionPlans.length).toBeGreaterThan(0);
    expect(hostsOf(planning)).toEqual([]);
    // CONTROL: the same fact on a plan with a steps section is offered.
    expect(hostsOf(plan([FRAMEWORK])).length).toBe(1);
  });

  it('the offered id never enters `structuredContentPartRefs` — the field eight other readers use is what it was', () => {
    const offered = plan([FRAMEWORK, CI]);
    const bare = withoutOffer(offered);
    expect(offered.sectionPlans.map((section) => section.structuredContentPartRefs))
      .toEqual(bare.sectionPlans.map((section) => section.structuredContentPartRefs));
  });

  it('the citable refs are the section\'s own refs, then the offered one — the same array when nothing is offered', () => {
    const planning = plan([FRAMEWORK]);
    const host = sectionOfKind(planning, 'approach_or_steps');
    expect(promptEnhancementSectionCitableRefsV1(host)).toEqual([...host.structuredContentPartRefs, ref('hard-1')]);
    const other = sectionOfKind(planning, 'acceptance_or_output_expectation');
    expect(promptEnhancementSectionCitableRefsV1(other)).toBe(other.structuredContentPartRefs);
  });
});

describe('the composer prompt: one line, in the one section', () => {
  it('the host section may cite the fact, and its list ends with the words it may add', async () => {
    const planning = plan([FRAMEWORK, CI]);
    const prompt = await composerPrompt(planning);
    const hosts = hostsOf(planning);
    expect(hosts.length).toBe(1);
    for (const host of hosts) {
      const block = prompt.slice(prompt.indexOf(`- sectionId: ${host.sectionId}`)).split('\n- sectionId: ')[0]!;
      expect(block).toContain(`  allowedSourceFactIds: ${JSON.stringify(promptEnhancementSectionCitableRefsV1(host))}`);
      const lines = block.split('\n');
      expect(lines[lines.length - 1]).toBe(`  - ${promptEnhancementProjectWordDirectiveV1(promptEnhancementProjectWordForFactV1(FRAMEWORK)!)}`);
    }
    // Never a body-level list of facts "for any section" — the shape that made the writer bolt them on.
    expect(prompt).not.toContain('Project facts you may use in any section');
    expect(prompt.split('[[in the Next.js app]]').length - 1).toBe(1);
    expect(prompt).not.toContain('[[in the CI pipeline]]');
  });

  it('BYTE IDENTITY: take out the one line and the one id, and what is left is the prompt the code sent before', async () => {
    const planning = plan([FRAMEWORK, CI]);
    const fixed = await composerPrompt(planning);
    const before = await composerPrompt(withoutOffer(planning));
    expect(fixed).not.toBe(before);
    let reduced = fixed;
    for (const host of hostsOf(planning)) {
      const word = promptEnhancementProjectWordForFactV1(FRAMEWORK)!;
      reduced = reduced
        .replace(`\n  - ${promptEnhancementProjectWordDirectiveV1(word)}`, '')
        .replace(`allowedSourceFactIds: ${JSON.stringify(promptEnhancementSectionCitableRefsV1(host))}`, `allowedSourceFactIds: ${JSON.stringify(host.structuredContentPartRefs)}`);
    }
    // A host whose only "must" line was ours keeps no empty heading.
    reduced = reduced.replace(/\n  this section must:(?=\n- sectionId: |$)/g, '');
    expect(reduced).toBe(before);
  });

  it.each(PROMPT_ENHANCEMENT_TAXONOMY_PRESETS.map((preset) => [preset.primaryIntent] as const))(
    'BYTE IDENTITY on every preset when nothing is offered — %s',
    async (intent) => {
      const planning = plan([MINED, RUNNER, LOCKFILE], { intent });
      if (planning.sectionPlans.length === 0) return; // a no-popup route plans nothing to word
      expect(hostsOf(planning)).toEqual([]);
      expect(await composerPrompt(planning)).toBe(await composerPrompt(withoutOffer(planning)));
    },
  );
});

describe('resolving the words in one section', () => {
  const WORD = promptEnhancementProjectWordForFactV1(FRAMEWORK)!;
  const PHRASES = [WORD.phrase];
  const resolve = (text: string, options: { kind?: string; host?: typeof WORD; keep?: boolean; prompt?: string } = {}) =>
    resolvePromptEnhancementProjectWordsV1({
      text,
      sectionKind: options.kind ?? 'approach_or_steps',
      hostWord: 'host' in options ? options.host : WORD,
      bodyPhrases: PHRASES,
      originalPromptText: options.prompt ?? PROMPT,
      keep: options.keep ?? true,
    });

  it('KEEPS the words right after the thing being added, in a sentence about this request', () => {
    expect(resolve('Add the reschedule button to the appointment details page [[in the Next.js app]]. Then email the provider.'))
      .toEqual({ text: 'Add the reschedule button to the appointment details page in the Next.js app. Then email the provider.', keptPhrase: 'in the Next.js app' });
  });

  it('REMOVES words that attach to the wrong thing — the sentence stays whole', () => {
    expect(resolve('Email the provider when the booking moves [[in the Next.js app]].'))
      .toEqual({ text: 'Email the provider when the booking moves.' });
  });

  it('a short sentence that names nothing from the request was written to hold the words: in the host it goes with them', () => {
    expect(resolve('Add the reschedule button to the appointment details page. Create a component [[in the Next.js app]].'))
      .toEqual({ text: 'Add the reschedule button to the appointment details page.' });
    // …but never so far that the section is emptied.
    expect(resolve('Create a component [[in the Next.js app]].')).toEqual({ text: 'Create a component.' });
  });

  it("outside the host only the words go — the sentence there is the writer's own", () => {
    expect(resolve('Check the booking flow. Create a component [[in the Next.js app]].', { kind: 'acceptance_or_output_expectation', host: undefined }))
      .toEqual({ text: 'Check the booking flow. Create a component.' });
  });

  it("the host's own phrase without the marks is judged exactly as if marked; elsewhere a bare mention is the writer's own and stays", () => {
    expect(resolve('Add the reschedule button to the appointment details page in the Next.js app.'))
      .toEqual({ text: 'Add the reschedule button to the appointment details page in the Next.js app.', keptPhrase: 'in the Next.js app' });
    expect(resolve('The button works in the Next.js app on every page.', { kind: 'acceptance_or_output_expectation', host: undefined }))
      .toEqual({ text: 'The button works in the Next.js app on every page.' });
  });

  it('the project-facts section keeps its own words; only our marks go', () => {
    expect(resolve('The project is built [[in the Next.js app]] note.', { kind: 'project_grounding_facts', host: undefined }))
      .toEqual({ text: 'The project is built in the Next.js app note.' });
  });

  it('one per section: a second occurrence is removed', () => {
    expect(resolve('Add the reschedule button to the appointment details page [[in the Next.js app]]. Add the booking form [[in the Next.js app]] next.'))
      .toEqual({ text: 'Add the reschedule button to the appointment details page in the Next.js app. Add the booking form next.', keptPhrase: 'in the Next.js app' });
  });

  it('never repeats a location ("in the project in the Next.js app")', () => {
    expect(resolve('Add the booking page in the project [[in the Next.js app]].'))
      .toEqual({ text: 'Add the booking page in the project.' });
  });

  it('a [[ ]] the developer wrote in the request is theirs: left exactly as written', () => {
    const text = 'See [[Payments]] in the wiki and add the reschedule button to the appointment details page.';
    expect(resolve(text, { prompt: `${PROMPT}; see [[Payments]] in the wiki` })).toEqual({ text });
  });

  it('[[ ]] the writer borrowed for words of its own loses the brackets and keeps the words — in every section', () => {
    // Measured 2026-10-10: 3 of ~280 replies asked for the framework words borrowed the notation; one reached a shown body.
    expect(resolve('Add the reschedule button to the appointment details page [[from the current signals]].'))
      .toEqual({ text: 'Add the reschedule button to the appointment details page from the current signals.' });
    expect(resolve('Check the booking flow [[from a recent observation of the project]].', { kind: 'source_signal_guidance', host: undefined }))
      .toEqual({ text: 'Check the booking flow from a recent observation of the project.' });
    expect(resolve('The project runs [[guidance fact]] checks.', { kind: 'project_grounding_facts', host: undefined }))
      .toEqual({ text: 'The project runs guidance fact checks.' });
    // …and ours beside it is still judged as ours.
    expect(resolve('Add the reschedule button to the appointment details page [[in the Next.js app]] [[from the current signals]].'))
      .toEqual({ text: 'Add the reschedule button to the appointment details page in the Next.js app from the current signals.', keptPhrase: 'in the Next.js app' });
  });

  it('keep: false — the comparison body — removes every one of ours and keeps none', () => {
    expect(resolve('Add the reschedule button to the appointment details page [[in the Next.js app]].', { keep: false }))
      .toEqual({ text: 'Add the reschedule button to the appointment details page.' });
  });

  it('a section offered nothing, with nothing of ours in it, is returned untouched', () => {
    const text = 'Check the booking flow on the appointment details page.';
    expect(resolve(text, { kind: 'acceptance_or_output_expectation', host: undefined })).toEqual({ text });
  });
});

describe('the composed body', () => {
  const STEPS = 'Add the reschedule button to the appointment details page [[in the Next.js app]]. Then email the provider.';
  const STEPS_KEPT = 'Add the reschedule button to the appointment details page in the Next.js app. Then email the provider.';

  it('keeps the words in the host section, and only that section may name what they state', () => {
    const planning = plan([FRAMEWORK]);
    const result = composedWith(planning, replyWith(planning, { approach_or_steps: STEPS }));
    expect(result.currentBody.composerMode).toBe('baseline_llm_structured_wording');
    expect(sectionText(result, 'approach_or_steps')).toBe(`- ${STEPS_KEPT}`);
    expect(result.currentBody.text).toContain(STEPS_KEPT);
    expect(result.currentBody.text).not.toContain('[[');
    const withValues = result.currentBody.sections.filter((section) => section.projectWordValues !== undefined);
    expect(withValues.map((section) => [section.sectionKind, section.projectWordValues])).toEqual([['approach_or_steps', ['Next.js']]]);
    expect(validatePromptEnhancementSafety({ currentBody: result.currentBody }).failures
      .filter((failure) => failure.failureCode.startsWith('no_invention_state:'))).toEqual([]);
  });

  it('CONTROL: the same section without the kept words\' allowance is judged to have invented the framework', () => {
    const planning = plan([FRAMEWORK]);
    const body = composedWith(planning, replyWith(planning, { approach_or_steps: STEPS })).currentBody;
    const bare = { ...body, sections: body.sections.map(({ projectWordValues: _dropped, ...section }) => section) };
    expect(validatePromptEnhancementSafety({ currentBody: bare }).failures.map((failure) => failure.failureCode))
      .toContain('no_invention_state:fabricated_item:Next.js');
  });

  it('a framework named OUTSIDE the host is judged exactly as before — nothing vouches for it there', () => {
    const planning = plan([FRAMEWORK]);
    const result = composedWith(planning, replyWith(planning, {
      approach_or_steps: STEPS,
      acceptance_or_output_expectation: 'The reschedule button must work within the Next.js framework.',
    }));
    expect(validatePromptEnhancementSafety({ currentBody: result.currentBody }).failures.map((failure) => failure.failureCode))
      .toContain('no_invention_state:fabricated_item:Next.js');
  });

  it('IDENTITY: the composed body is exactly the body without the words, plus the words', () => {
    const planning = plan([FRAMEWORK]);
    const output = replyWith(planning, { approach_or_steps: STEPS });
    const withWords = composedWith(planning, output);
    // The same reply with our marks removed, composed from the plan WITHOUT the offer: what today's code makes of it.
    const plain = replyWith(planning, { approach_or_steps: STEPS.replace(' [[in the Next.js app]]', '') });
    const today = composedWith(withoutOffer(planning), plain);
    expect(withWords.currentBody.text.replace(' in the Next.js app', '')).toBe(today.currentBody.text);
    expect(withWords.sendPolicy).toBe(today.sendPolicy);
    expect(withWords.diagnostics).toEqual(today.diagnostics);
    expect(withWords.currentBody.sections.map((section) => section.sectionId)).toEqual(today.currentBody.sections.map((section) => section.sectionId));
  });

  it('FAIL-CLOSED: if keeping the words would change anything else, the body without them is returned', () => {
    // The request itself already says "in the Next.js app", so taking the kept words out of the whole text cannot be
    // matched back exactly: the comparison is not satisfied, and the words go.
    const prompt = 'add the reschedule button to the appointment details page in the Next.js app';
    const planning = plan([FRAMEWORK]);
    const result = composedWith(planning, replyWith(planning, { approach_or_steps: STEPS }), prompt);
    expect(sectionText(result, 'approach_or_steps')).toBe('- Add the reschedule button to the appointment details page. Then email the provider.');
    expect(result.currentBody.sections.some((section) => section.projectWordValues !== undefined)).toBe(false);
  });

  it('a reply the writer reports as not English keeps no words — every mark of ours is resolved away', () => {
    const planning = plan([FRAMEWORK]);
    const result = composedWith(planning, replyWith(planning, { approach_or_steps: STEPS }, { detectedLanguageSelfReport: 'hi-Latn' }));
    expect(sectionText(result, 'approach_or_steps')).toBe('- Add the reschedule button to the appointment details page. Then email the provider.');
  });

  it('a plan that offered nothing composes byte-for-byte as before', () => {
    const planning = plan([RUNNER, LOCKFILE]);
    const output = replyWith(planning, { approach_or_steps: 'Add the reschedule button to the appointment details page.' });
    expect(composedWith(planning, output)).toEqual(composedWith(withoutOffer(planning), output));
  });

  it('a deterministic body (no reply) carries no words and no allowance', () => {
    const body = composePromptEnhancementBody({ enhancementId: 'project-words', originalPromptText: PROMPT, sectionPlanningResult: plan([FRAMEWORK, CI]) }).currentBody;
    expect(body.composerMode).toBe('baseline_deterministic_render');
    expect(body.sections.some((section) => section.projectWordValues !== undefined)).toBe(false);
  });

  it('the host may cite the fact; the claim is accepted and no draft is dropped', () => {
    const planning = plan([FRAMEWORK]);
    const host = sectionOfKind(planning, 'approach_or_steps');
    const output = replyWith(planning, { approach_or_steps: STEPS });
    const citing = {
      ...output,
      sectionDrafts: output.sectionDrafts.map((draft) => (draft.sectionId === host.sectionId ? { ...draft, sourceFactIds: [...draft.sourceFactIds, ref('hard-1')] } : draft)),
      composerClaims: [...output.composerClaims, `claim:${ref('hard-1')}`],
    };
    const result = composedWith(planning, citing);
    expect(result.currentBody.composerMode).toBe('baseline_llm_structured_wording');
    expect(result.diagnostics.map((diagnostic) => diagnostic.reasonCode).join(' ')).not.toContain('partial_draft_drop');
    // CONTROL: a section that was not offered the fact is refused for citing it, exactly as before.
    const other = sectionOfKind(planning, 'acceptance_or_output_expectation');
    const outside = {
      ...output,
      sectionDrafts: output.sectionDrafts.map((draft) => (draft.sectionId === other.sectionId ? { ...draft, sourceFactIds: [ref('hard-1')] } : draft)),
    };
    expect(composedWith(planning, outside).diagnostics.map((diagnostic) => diagnostic.reasonCode).join(' ')).toContain('source_fact_id_not_in_section');
  });

  // Measured 2026-10-10 (1 reply in 140): the writer skipped the words, named the framework in its own words in the
  // host section and cited the fact it was offered. Kept for that citation, the draft's own "Next.js" blocked the WHOLE
  // body; before the offer the citation alone was refused and only that section was lost.
  const OWN_WORDS = 'Add the reschedule button to the appointment details page. Then test the whole flow within the Next.js app.';
  const citingHost = (planning: PromptEnhancementSectionPlanningResult, output: PromptEnhancementStructuredComposerOutputV1) => {
    const host = sectionOfKind(planning, 'approach_or_steps');
    return {
      ...output,
      sectionDrafts: output.sectionDrafts.map((draft) => (draft.sectionId === host.sectionId ? { ...draft, sourceFactIds: [...draft.sourceFactIds, ref('hard-1')] } : draft)),
      composerClaims: [...output.composerClaims, `claim:${ref('hard-1')}`],
    };
  };
  const unsendable = (result: ReturnType<typeof composedWith>): boolean =>
    result.sendPolicy === 'no_send' || result.currentBody.generatedSafeStatus === 'invalid_non_sendable';

  it('a host draft citing the offered fact and naming it in its own words is refused for the citation — that one section, exactly as without the offer', () => {
    const planning = plan([FRAMEWORK]);
    const reply = citingHost(planning, replyWith(planning, { approach_or_steps: OWN_WORDS }));
    const result = composedWith(planning, reply);
    // What the code before the offer made of this very reply: the citation refused, that section rendered by NexPath.
    const today = composedWith(withoutOffer(planning), reply);
    expect(unsendable(today)).toBe(false);
    expect(unsendable(result)).toBe(false);
    expect(result.currentBody.text).toBe(today.currentBody.text);
    expect(result.diagnostics).toEqual(today.diagnostics);
    expect(result.diagnostics.map((diagnostic) => diagnostic.reasonCode).join(' ')).toContain('source_fact_id_not_in_section');
    expect(sectionText(result, 'approach_or_steps')).not.toContain('Next.js');
    expect(result.currentBody.sections.some((section) => section.projectWordValues !== undefined)).toBe(false);
  });

  it('CONTROL: the same draft WITHOUT the citation is blocked for the name exactly as before — nothing gets a name through', () => {
    const planning = plan([FRAMEWORK]);
    const reply = replyWith(planning, { approach_or_steps: OWN_WORDS });
    const result = composedWith(planning, reply);
    const today = composedWith(withoutOffer(planning), reply);
    expect(unsendable(today)).toBe(true);
    expect(unsendable(result)).toBe(true);
    expect(result.currentBody.text).toBe(today.currentBody.text);
    expect(validatePromptEnhancementSafety({ currentBody: result.currentBody }).failures.map((failure) => failure.failureCode))
      .toContain('no_invention_state:fabricated_item:Next.js');
  });

  it('kept words, a citation and NO name of its own: the words stay — the rule never takes them', () => {
    const planning = plan([FRAMEWORK]);
    const result = composedWith(planning, citingHost(planning, replyWith(planning, { approach_or_steps: STEPS })));
    expect(unsendable(result)).toBe(false);
    expect(sectionText(result, 'approach_or_steps')).toBe(`- ${STEPS_KEPT}`);
    expect(result.diagnostics.map((diagnostic) => diagnostic.reasonCode).join(' ')).not.toContain('partial_draft_drop');
  });

  it('kept words AND the framework named again in the writer\'s own words: refused for the citation, that section only', () => {
    const planning = plan([FRAMEWORK]);
    const reply = citingHost(planning, replyWith(planning, { approach_or_steps: `${STEPS} Test the flow within the Next.js app.` }));
    const result = composedWith(planning, reply);
    expect(unsendable(result)).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.reasonCode).join(' ')).toContain('source_fact_id_not_in_section');
    expect(sectionText(result, 'approach_or_steps')).not.toContain('Next.js');
    // CONTROL: the code before the offer refuses this very reply's citation the same way.
    const plain = { ...reply, sectionDrafts: reply.sectionDrafts.map((draft) => ({ ...draft, bodyText: draft.bodyText.replace(' [[in the Next.js app]]', '') })) };
    expect(result.currentBody.text).toBe(composedWith(withoutOffer(planning), plain).currentBody.text);
  });

  it('the request itself names the framework: naming it is the developer\'s own, and a citing host draft is NOT refused', () => {
    const prompt = 'add the reschedule button to the appointment details page of our Next.js app';
    const planning = plan([FRAMEWORK]);
    const result = composedWith(planning, citingHost(planning, replyWith(planning, { approach_or_steps: OWN_WORDS })), prompt);
    expect(unsendable(result)).toBe(false);
    expect(sectionText(result, 'approach_or_steps')).toContain('within the Next.js app');
    expect(result.diagnostics.map((diagnostic) => diagnostic.reasonCode).join(' ')).not.toContain('source_fact_id_not_in_section');
  });

  it('no [[ ]] reaches a shown body: a section that borrowed the notation shows its words without the brackets', () => {
    const planning = plan([FRAMEWORK]);
    const result = composedWith(planning, replyWith(planning, {
      approach_or_steps: STEPS,
      acceptance_or_output_expectation: 'The reschedule button works on the appointment details page [[from the current signals]].',
    }));
    expect(result.currentBody.text).not.toContain('[[');
    expect(result.currentBody.text).not.toContain(']]');
    expect(sectionText(result, 'acceptance_or_output_expectation')).toBe('- The reschedule button works on the appointment details page from the current signals.');
    expect(sectionText(result, 'approach_or_steps')).toBe(`- ${STEPS_KEPT}`);
  });

  it('a name in ANOTHER section is judged exactly as before — the rule never reaches outside the host', () => {
    const planning = plan([FRAMEWORK]);
    const reply = citingHost(planning, replyWith(planning, {
      approach_or_steps: STEPS,
      acceptance_or_output_expectation: 'The reschedule button must work within the Next.js framework.',
    }));
    const result = composedWith(planning, reply);
    expect(unsendable(result)).toBe(true);
    const plain = { ...reply, sectionDrafts: reply.sectionDrafts.map((draft) => ({ ...draft, bodyText: draft.bodyText.replace(' [[in the Next.js app]]', '') })) };
    expect(unsendable(composedWith(withoutOffer(planning), plain))).toBe(true);
  });
});

describe('pruning and accounting read none of it', () => {
  it('the same plan with and without the offer prunes identically', () => {
    const planning = plan([FRAMEWORK, CI, LOCKFILE]);
    const prune = (sectionPlans: readonly PromptEnhancementSectionPlanItemV1[]) => prunePromptEnhancementSectionsV1({
      sectionPlans,
      facts: planning.renderedFacts,
      relevanceOrder: [],
      draftedSectionIds: new Set(sectionPlans.map((section) => section.sectionId)),
    });
    const withField = prune(planning.sectionPlans);
    const bare = prune(withoutOffer(planning).sectionPlans);
    expect(withField.droppedSectionIds).toEqual(bare.droppedSectionIds);
    expect(withField.sectionPlans.map((section) => section.sectionId)).toEqual(bare.sectionPlans.map((section) => section.sectionId));
    expect(withField.facts).toEqual(bare.facts);
  });

  it('a pruned project-facts section does not strand the claim of a fact the host still cites', () => {
    const planning = plan([FRAMEWORK]);
    const grounding = sectionOfKind(planning, 'project_grounding_facts');
    const host = sectionOfKind(planning, 'approach_or_steps');
    const output: PromptEnhancementStructuredComposerOutputV1 = {
      outputId: 'project-words:composer-llm',
      sectionDrafts: [
        { sectionId: host.sectionId, bodyText: 'Add the reschedule button.', sourceFactIds: [ref('hard-1')] },
        { sectionId: grounding.sectionId, bodyText: 'The project uses nextjs.', sourceFactIds: [ref('hard-1')] },
      ],
      composerClaims: [`claim:${ref('hard-1')}`],
    };
    const survivors = planning.sectionPlans.filter((section) => section !== grounding);
    expect(promptEnhancementComposerOutputForSurvivingSectionsV1(output, survivors, [grounding])?.composerClaims)
      .toEqual([`claim:${ref('hard-1')}`]);
    // CONTROL: read through the old field alone, the claim is stranded.
    const bare = withoutOffer(planning);
    const bareGrounding = sectionOfKind(bare, 'project_grounding_facts');
    expect(promptEnhancementComposerOutputForSurvivingSectionsV1(output, bare.sectionPlans.filter((section) => section !== bareGrounding), [bareGrounding])?.composerClaims)
      .toEqual([]);
  });
});
