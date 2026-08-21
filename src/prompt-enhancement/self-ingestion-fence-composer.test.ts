/**
 * T3 — the fence, checked where it actually has to hold: in a composed body.
 *
 * The fence unit tests call the extractor directly. That leaves the WIRING unverified —
 * `promptReviewOrigin` has to travel from the planning result through
 * `instructionLinesForSection` to the point-inventory line, and if it did not arrive the
 * fence could be perfect while every unit test still passed.
 *
 * The inventory line is the re-emission vector: it renders "Preserve these original
 * points: …" from harvested text. So this file composes real bodies and reads that line.
 */
import { describe, expect, it } from 'vitest';

import type { PromptEnhancementSourceRefV1 } from './contracts.js';
import { composePromptEnhancementBody } from './compose-enhancement.js';
import { routePromptEnhancement, type PromptEnhancementRouteInput } from './routing-taxonomy.js';
import {
  planPromptEnhancementSections,
  type PromptEnhancementSectionPlanningResult,
} from './templates/section-plan.js';

/**
 * The exact prefix the inventory line renders when it has harvested points. Taken from
 * the composed body rather than guessed — an approximate string would make the negative
 * assertions below pass for the wrong reason.
 */
const INVENTORY_PREFIX = 'Preserve these original points in the work plan:';

const PRIOR_BODY_BULLET = 'Preserve the original request, dependencies, and completion checks inside this one prompt body.';

/** A planning prompt, so the template requires point_inventory_or_decomposition. */
const PLAIN_PLANNING_PROMPT = [
  'plan and break down this work into tasks:',
  '- add retry handling to the webhook',
  '- write a migration for the phone column',
].join('\n');

/** The same planning prompt, with a previous enhanced body pasted in. */
const SELF_INGESTING_PROMPT = [
  'plan and break down this work, here is what nexpath gave me last time:',
  '',
  'My original request (verbatim): fix the checkout flow',
  `- ${PRIOR_BODY_BULLET}`,
  '- Keep the work tied to reproduction and verification evidence.',
].join('\n');

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

function planFor(promptText: string, overrides: Partial<PromptEnhancementRouteInput> = {}): PromptEnhancementSectionPlanningResult {
  const routeInput: PromptEnhancementRouteInput = {
    routeDecisionId: 't3-route',
    promptText,
    currentStage: 'task_breakdown',
    prevStage: 'problem_definition',
    triggerKind: 'stage_transition',
    firedKey: 'stage:problem_definition->task_breakdown',
    effectiveFiredSource: 'classifier_fire_recommendation',
    absenceGateReason: 'not_absence_trigger',
    classifierState: 'fire_recommended',
    degradedNoActionState: 'none',
    generatedOriginState: 'ordinary_user_prompt',
    ...overrides,
  };
  return planPromptEnhancementSections({
    routeResult: routePromptEnhancement(routeInput),
    sourceRefs: [sourceA],
    guidanceFacts: [],
  });
}

describe('T3 — the fence holds in a composed body, not just in the extractor', () => {
  it('lists the user\'s own points when the prompt is genuinely theirs', () => {
    const plan = planFor(PLAIN_PLANNING_PROMPT);
    // Guard against a vacuous pass: if this section is absent the fence assertion below
    // would hold for the wrong reason.
    expect(plan.sectionPlans.some((s) => s.sectionKind === 'point_inventory_or_decomposition')).toBe(true);

    const result = composePromptEnhancementBody({
      enhancementId: 'enh-t3-plain',
      originalPromptText: PLAIN_PLANNING_PROMPT,
      sectionPlanningResult: plan,
    });

    // The control. Without this, "no points listed" proves nothing — the fence could be
    // returning nothing for every input.
    expect(result.currentBody.text).toContain(INVENTORY_PREFIX);
    expect(result.currentBody.text).toContain('add retry handling to the webhook');
  });

  it('lists NO points when the prompt pastes a previous enhanced body', () => {
    const plan = planFor(SELF_INGESTING_PROMPT);
    expect(plan.sectionPlans.some((s) => s.sectionKind === 'point_inventory_or_decomposition')).toBe(true);

    const result = composePromptEnhancementBody({
      enhancementId: 'enh-t3-self',
      originalPromptText: SELF_INGESTING_PROMPT,
      sectionPlanningResult: plan,
    });

    // The defect is the ATTRIBUTION, not the sentence. Nexpath's wording still appears in
    // the body twice for legitimate reasons — the verbatim section echoes the user's paste,
    // and the inventory falls back to that same generic line when it has no points. What
    // must never happen is the prefix that turns text into "these original points".
    expect(result.currentBody.text).not.toContain(INVENTORY_PREFIX);
  });

  it('never composes a body at all for a prompt that came from a previous PE send', () => {
    // Written this way after the first version passed VACUOUSLY. It asserted that no
    // points were listed, which held for a reason unrelated to the fence: routing refuses
    // to enhance a PE-generated prompt, so no sections exist and the inventory line is
    // never reached.
    //
    // Worth recording, because it means the extractor's typed-origin check is
    // DEFENCE-IN-DEPTH behind an upstream block rather than the primary protection —
    // mutating that check away leaves this path green, and that is not a test gap.
    const plan = planFor(PLAIN_PLANNING_PROMPT, { generatedOriginState: 'pe_generated' });
    expect(plan.promptReviewOrigin).toBe('pe_generated_initial_send');

    const result = composePromptEnhancementBody({
      enhancementId: 'enh-t3-generated',
      originalPromptText: PLAIN_PLANNING_PROMPT,
      sectionPlanningResult: plan,
    });

    // No enhanced body at all: the prompt comes back as itself.
    expect(result.currentBody.text).toBe(PLAIN_PLANNING_PROMPT);
    expect(result.currentBody.text).not.toContain('Point Inventory Or Decomposition');
    expect(result.currentBody.text).not.toContain(INVENTORY_PREFIX);
  });
});
