import { describe, expect, it } from 'vitest';
import {
  composeStructuredComposerOutputV1,
  type PromptEnhancementComposerClientV1,
} from './llm-composer.js';
import { planPromptEnhancementSections } from './templates/section-plan.js';
import { routePromptEnhancement, type PromptEnhancementRouteInput } from './routing-taxonomy.js';
import type { PromptEnhancementSourceRefV1 } from './contracts.js';

// Reader 1 of the no-invention state: the COMPOSER must carry the constraint
// into the section's own instruction. The other two readers (the post-compose
// check and the hard-fail fixtures) are asserted in the safety suite; this
// captures the prompt actually sent, because an instruction that never reaches
// the model is the same prose-only state the typed field replaced.

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

function capturingClient(): { client: PromptEnhancementComposerClientV1; userPrompts: string[] } {
  const userPrompts: string[] = [];
  const client: PromptEnhancementComposerClientV1 = {
    chat: {
      completions: {
        create: async (body) => {
          for (const message of body.messages) {
            if (message.role === 'user') userPrompts.push(message.content);
          }
          // An empty reply is enough: the call is made, the prompt is captured,
          // and the composer falls back deterministically.
          return { choices: [{ message: { content: '' } }] };
        },
      },
    },
  };
  return { client, userPrompts };
}

async function promptFor(intent: string, promptText: string): Promise<string> {
  const route = routePromptEnhancement({
    routeDecisionId: `composer-slot-${intent}`,
    promptText,
    currentStage: 'implementation',
    prevStage: 'task_breakdown',
    triggerKind: 'absence',
    firedKey: 'absence:debugging_observation_gap@implementation',
    classifierState: 'fire_recommended',
    degradedNoActionState: 'none',
    generatedOriginState: 'ordinary_user_prompt',
    classifierPrimaryIntent: intent,
    classifierIntentConfidence: 0.9,
    classifierCapabilityCandidates: [],
    classifierDebugEvidencePresent: [],
  } as unknown as PromptEnhancementRouteInput);
  const planning = planPromptEnhancementSections({
    routeResult: route,
    sourceRefs: [sourceA],
    guidanceFacts: [],
  });
  const { client, userPrompts } = capturingClient();
  await composeStructuredComposerOutputV1(
    { enhancementId: `composer-slot-${intent}`, originalPromptText: promptText, planning },
    client,
  );
  expect(userPrompts.length, 'the composer must have made its call').toBeGreaterThan(0);
  // The FIRST call's prompt: an empty reply makes the composer retry, and each
  // retry sends the same prompt again — joining them would count one line per
  // attempt and say nothing about per-section scoping.
  return userPrompts[0] ?? '';
}

describe('composer instruction: the typed slot obligations reach the model', () => {
  it('a repro section carrying the no-invention state gets the hard constraint in its instruction', async () => {
    const prompt = await promptFor('issue_debug.reproduction_discovery', 'the checkout job stops halfway and I cannot tell why');
    expect(prompt).toContain('slotObligations');
    expect(prompt).toContain('no_invention_state');
    expect(prompt).toContain('NO-INVENTION (hard)');
    // The locked behaviour when evidence is missing: ask, never illustrate.
    expect(prompt).toMatch(/ASK for it/);
  });

  it('the constraint is scoped to the section that carries it, not the whole prompt', async () => {
    const prompt = await promptFor('issue_debug.reproduction_discovery', 'the checkout job stops halfway and I cannot tell why');
    const noInventionLines = prompt.split('\n').filter((line) => line.includes('NO-INVENTION (hard)'));
    expect(noInventionLines).toHaveLength(1);
  });

  it('a route with no no-invention obligation carries no such instruction', async () => {
    const prompt = await promptFor('planning.spec_or_prd', 'write a spec for the new onboarding flow');
    expect(prompt).not.toContain('NO-INVENTION (hard)');
    expect(prompt).not.toContain('no_invention_state');
  });
});
