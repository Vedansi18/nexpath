/**
 * T4 — the floors measured against REAL composed bodies, not constructed fixtures.
 *
 * Unit fixtures prove a floor can fire. They cannot tell you whether it fires on
 * everything, which is the failure mode that makes a check useless: a detector that
 * reports a violation for every prompt is noise, and nobody reads noise.
 *
 * Both defects this file exists to prevent were found by running the floors over these
 * bodies, and neither was visible from reading the code:
 *
 *   1. Checking the WHOLE body reported zero violations for every prompt — the body opens
 *      with the user's text verbatim, so every item is trivially present and no floor
 *      could ever fire.
 *   2. Checking the guidance half then reported `commands` for "make the landing page
 *      look more modern", because several tool names are ordinary English words too.
 *
 * The prompt set is the one the live assertion script uses, covering both traffic shapes.
 */
import { describe, expect, it } from 'vitest';

import type { PromptEnhancementSourceRefV1 } from './contracts.js';
import { composePromptEnhancementBody } from './compose-enhancement.js';
import { routePromptEnhancement, type PromptEnhancementRouteInput } from './routing-taxonomy.js';
import { planPromptEnhancementSections } from './templates/section-plan.js';
import { checkPromptEnhancementPreservationFloorsV1 } from './preservation-floors.js';
import { promptEnhancementGuidanceHalfV1 } from './body-assertion-checks.js';

const sourceA: PromptEnhancementSourceRefV1 = {
  sourceRefId: 'src-a',
  sourceKind: 'source_a_user_prompt',
  sourceId: 'prompt:1',
  sourceAuthorization: 'implementation_input',
  evidenceStatus: 'present',
  freshness: 'current',
  confidence: 'high',
  privacyClass: 'local_private',
};

const PROMPTS: readonly string[] = [
  'The invoice PDF shows a null address for customers created after the migration. Fix it.',
  'Add a retry with exponential backoff to the webhook sender in src/webhooks/send.ts.',
  "The login page throws 'Cannot read property id of undefined' after the session refactor.",
  'Write a migration to add a nullable phone_number column to the users table.',
  'make the landing page look more modern and professional',
  'why is my app so slow',
  'add dark mode to the settings page',
  'i need to send emails when someone signs up',
  'my stripe checkout keeps failing for some customers and i dont know why',
  'build me a dashboard that shows how many users signed up each day',
];

function guidanceFloorsFor(promptText: string): readonly string[] {
  const routeInput: PromptEnhancementRouteInput = {
    routeDecisionId: 'floors-real',
    promptText,
    currentStage: 'implementation',
    prevStage: 'task_breakdown',
    triggerKind: 'stage_transition',
    firedKey: 'stage:task_breakdown->implementation',
    effectiveFiredSource: 'classifier_fire_recommendation',
    absenceGateReason: 'not_absence_trigger',
    classifierState: 'fire_recommended',
    degradedNoActionState: 'none',
    generatedOriginState: 'ordinary_user_prompt',
  };
  const body = composePromptEnhancementBody({
    enhancementId: 'floors-real',
    originalPromptText: promptText,
    sectionPlanningResult: planPromptEnhancementSections({
      routeResult: routePromptEnhancement(routeInput),
      sourceRefs: [sourceA],
      guidanceFacts: [],
    }),
  });
  return checkPromptEnhancementPreservationFloorsV1({
    originalPromptText: promptText,
    generatedBodyText: promptEnhancementGuidanceHalfV1(body.currentBody.text),
  }).map((violation) => violation.floorId);
}

describe('T4 — floors over real composed bodies stay quiet unless something is genuinely lost', () => {
  it.each(PROMPTS.filter((prompt) => !prompt.includes('src/webhooks/send.ts')))(
    'reports no violation for: %s',
    (prompt) => {
      // Nine of the ten supply no item class the deterministic guidance drops. A regex
      // that starts matching ordinary English shows up here first.
      expect(guidanceFloorsFor(prompt)).toEqual([]);
    },
  );

  it('reports the one real loss: a supplied file path the guidance never mentions', () => {
    // The control. Without a prompt that DOES violate, the nine clean results above would
    // also pass if the checker had been broken back to reporting nothing at all.
    expect(guidanceFloorsFor('Add a retry with exponential backoff to the webhook sender in src/webhooks/send.ts.'))
      .toContain('file_paths');
  });
});
