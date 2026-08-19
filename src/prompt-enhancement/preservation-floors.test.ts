/**
 * T4 done-when: each floor is a check that FAILS on a constructed violation, and each
 * failure NAMES which floor it is.
 *
 * So every floor gets two cases — a constructed violation that must be caught and named,
 * and a preserved case that must not fire. Without the second half a floor that always
 * reported a violation would pass its own test.
 *
 * Eighteen floors, per the dev-plan table. The phase prose says fourteen and the phase's
 * own prohibition says not to trust that number.
 */
import { describe, expect, it } from 'vitest';

import {
  PROMPT_ENHANCEMENT_PRESERVATION_FLOOR_IDS_V1,
  checkPromptEnhancementPreservationFloorsV1,
  type PromptEnhancementPreservationFloorIdV1,
} from './preservation-floors.js';
import {
  collectPromptEnhancementBodyAssertionFailuresV1,
  collectPromptEnhancementFloorViolationsV1,
} from './body-assertion-checks.js';
import { promptEnhancementAuthorityModeForTextV1 } from './safety-sendability.js';

function floorsFor(originalPromptText: string, generatedBodyText: string): readonly PromptEnhancementPreservationFloorIdV1[] {
  return checkPromptEnhancementPreservationFloorsV1({ originalPromptText, generatedBodyText })
    .map((violation) => violation.floorId);
}

/**
 * One row per floor: a prompt carrying that item class, a body that DROPS it, and a body
 * that keeps it. Kept as data so the eighteen are visibly all present.
 */
const FLOOR_CASES: readonly {
  floorId: PromptEnhancementPreservationFloorIdV1;
  original: string;
  bodyThatViolates: string;
  bodyThatPreserves: string;
}[] = [
  {
    floorId: 'commands',
    original: 'run `npm run build:prod` before shipping',
    bodyThatViolates: 'Run the project build before shipping.',
    bodyThatPreserves: 'Run `npm run build:prod` before shipping.',
  },
  {
    floorId: 'file_paths',
    original: 'the bug is in src/services/payment/handler.ts',
    bodyThatViolates: 'The bug is in the payment handler module.',
    bodyThatPreserves: 'The bug is in src/services/payment/handler.ts.',
  },
  {
    floorId: 'module_api_names',
    original: 'importCsv is dropping rows',
    bodyThatViolates: 'The import routine is dropping rows.',
    bodyThatPreserves: 'importCsv is dropping rows.',
  },
  {
    floorId: 'branch_names',
    original: 'apply this on feature/checkout-retry only',
    bodyThatViolates: 'Apply this on the feature branch only.',
    bodyThatPreserves: 'Apply this on feature/checkout-retry only.',
  },
  {
    floorId: 'issue_ids',
    original: 'this is for PROJ-4821 and #317',
    bodyThatViolates: 'This is for the linked tickets.',
    bodyThatPreserves: 'This is for PROJ-4821 and #317.',
  },
  {
    floorId: 'stack_traces',
    original: 'it fails here:\n    at Object.parseRow (/app/src/csv.ts:88:12)',
    bodyThatViolates: 'It fails somewhere in the CSV parsing code.',
    bodyThatPreserves: 'It fails here:\n    at Object.parseRow (/app/src/csv.ts:88:12)',
  },
  {
    floorId: 'error_names',
    original: 'we keep getting a ValidationError on submit',
    bodyThatViolates: 'We keep getting a failure on submit.',
    bodyThatPreserves: 'We keep getting a ValidationError on submit.',
  },
  {
    floorId: 'test_names',
    original: 'checkout.test.ts is red',
    bodyThatViolates: 'The checkout suite is red.',
    bodyThatPreserves: 'checkout.test.ts is red.',
  },
  {
    floorId: 'urls',
    original: 'see https://internal.example.com/runbook/deploy for the steps',
    bodyThatViolates: 'See the internal runbook for the steps.',
    bodyThatPreserves: 'See https://internal.example.com/runbook/deploy for the steps.',
  },
  {
    floorId: 'output_format_instructions',
    original: 'give me the findings as a table',
    bodyThatViolates: 'Report the findings clearly.',
    bodyThatPreserves: 'Report the findings as a table.',
  },
  {
    floorId: 'constraints',
    original: 'it must stay backward compatible with v1 clients',
    bodyThatViolates: 'Modernise the client interface.',
    bodyThatPreserves: 'It must stay backward compatible with v1 clients.',
  },
  {
    floorId: 'non_goals',
    original: 'the admin panel is out of scope for this change',
    bodyThatViolates: 'Update every surface that touches the change.',
    bodyThatPreserves: 'Note that the admin panel is out of scope for this change.',
  },
  {
    floorId: 'do_not_statements',
    original: 'do not change the public API shape',
    bodyThatViolates: 'Reshape the public API as needed.',
    bodyThatPreserves: 'Do not change the public API shape.',
  },
  {
    floorId: 'permission_boundaries',
    original: 'ask first before touching anything in prod',
    bodyThatViolates: 'Apply the change in prod.',
    bodyThatPreserves: 'Ask first before touching anything in prod.',
  },
  {
    floorId: 'data_safety_boundaries',
    original: 'take a backup first, this touches customer data',
    bodyThatViolates: 'Run the migration against the live table.',
    bodyThatPreserves: 'Take a backup first, this touches customer data.',
  },
  {
    floorId: 'rollback_verification_requests',
    original: 'include a rollback plan and add a test',
    bodyThatViolates: 'Ship the change.',
    bodyThatPreserves: 'Include a rollback plan and add a test.',
  },
  {
    floorId: 'uncertainty_language',
    original: 'i think the parser is at fault, check if that is right',
    bodyThatViolates: 'The parser is at fault. Fix it.',
    bodyThatPreserves: 'I think the parser is at fault, check if that is right.',
  },
];

describe('T4 — every floor fails on a constructed violation, and names itself', () => {
  it.each(FLOOR_CASES)('$floorId — catches the violation and names the floor', (floorCase) => {
    const violations = checkPromptEnhancementPreservationFloorsV1({
      originalPromptText: floorCase.original,
      generatedBodyText: floorCase.bodyThatViolates,
    });

    const named = violations.filter((violation) => violation.floorId === floorCase.floorId);
    expect(named.length).toBeGreaterThan(0);
    // Naming the floor is half the done-when; the other half is saying what was lost.
    expect(named[0]?.lostFromOriginal.length).toBeGreaterThan(0);
    expect(named[0]?.hardFailReason.length).toBeGreaterThan(0);
  });

  it.each(FLOOR_CASES)('$floorId — stays silent when the item is preserved', (floorCase) => {
    // Without this half, a floor that always reported a violation would pass above.
    expect(floorsFor(floorCase.original, floorCase.bodyThatPreserves)).not.toContain(floorCase.floorId);
  });
});

describe('T4 — the verb-mood floor, which is about the request changing rather than an item vanishing', () => {
  it('catches planning language turned into execution wording', () => {
    const violations = checkPromptEnhancementPreservationFloorsV1({
      originalPromptText: 'review whether we should migrate the schema and plan the steps',
      generatedBodyText: 'Migrate the schema now and deploy the change to production.',
    });

    expect(violations.map((violation) => violation.floorId)).toContain('sensitive_action_verb_mood');
  });

  it('stays silent when the body keeps the planning mood', () => {
    const violations = checkPromptEnhancementPreservationFloorsV1({
      originalPromptText: 'review whether we should migrate the schema and plan the steps',
      generatedBodyText: 'Review whether the schema migration is warranted, and plan the steps before acting.',
    });

    expect(violations.map((violation) => violation.floorId)).not.toContain('sensitive_action_verb_mood');
  });
});

describe('T4 — the floor set itself', () => {
  it('carries eighteen floors, not the fourteen the phase prose lists', () => {
    // Prohibition 5: never treat 13 or 14 as the locked count — read the dev plan. The
    // table at L7487-7504 has eighteen rows.
    expect(PROMPT_ENHANCEMENT_PRESERVATION_FLOOR_IDS_V1).toHaveLength(18);
  });

  it('covers every floor id with a constructed case', () => {
    // The four the audit found uncounted — data-safety, rollback/verification,
    // uncertainty, verb mood — are the ones most at risk of being skipped again.
    const covered = new Set<PromptEnhancementPreservationFloorIdV1>([
      ...FLOOR_CASES.map((floorCase) => floorCase.floorId),
      'sensitive_action_verb_mood',
    ]);
    for (const floorId of PROMPT_ENHANCEMENT_PRESERVATION_FLOOR_IDS_V1) {
      expect(covered.has(floorId)).toBe(true);
    }
  });

  it('reports nothing when the body preserves an ordinary prompt whole', () => {
    const original = 'please fix the retry logic in the webhook handler';
    expect(checkPromptEnhancementPreservationFloorsV1({
      originalPromptText: original,
      generatedBodyText: `${original}\n\nVerify the fix with a regression test.`,
    })).toEqual([]);
  });
});

describe('T4 — floors reported through the live assertion harness', () => {
  it('names the floor for each violation across a run, and stays out of the Phase 2 oracle', () => {
    // Real body shape: the verbatim section, a blank line, then the generated guidance.
    // The collector reads only the guidance half, because the verbatim half trivially
    // contains everything the floors look for.
    const results = [
      {
        prompt: 'do not change the public API shape',
        bodyText: 'My original request (verbatim):\ndo not change the public API shape\n\nReshape the public API as needed.',
        composed: true,
      },
      {
        prompt: 'take a backup first',
        bodyText: 'My original request (verbatim):\ntake a backup first\n\nRun the migration.',
        composed: true,
      },
    ];

    const reported = collectPromptEnhancementFloorViolationsV1(results);
    expect(reported.some((line) => line.includes('floor do_not_statements'))).toBe(true);
    expect(reported.some((line) => line.includes('floor data_safety_boundaries'))).toBe(true);

    // Phase 2's oracle is locked, so the floors must NOT have been folded into it.
    expect(collectPromptEnhancementBodyAssertionFailuresV1(results)).toEqual([]);
  });

  it('reports nothing when the bodies preserve what the prompts supplied', () => {
    const results = [
      {
        prompt: 'do not change the public API shape',
        bodyText: 'My original request (verbatim):\ndo not change the public API shape\n\nDo not change the public API shape while adding the field.',
        composed: true,
      },
    ];
    expect(collectPromptEnhancementFloorViolationsV1(results)).toEqual([]);
  });
});

describe('T4 — the floor check versus the shipped permission-boundary substitute', () => {
  /**
   * The phase plan says the substitute must not be deleted AND must not be assumed to
   * agree with the real check. Agreement was measured rather than assumed, and they
   * diverge — so the divergence is pinned here. If either side changes, this fails and
   * someone re-reads the comparison instead of discovering it in production.
   */
  const substituteFlagsEscalation = (originalPromptText: string, generatedBodyText: string): boolean =>
    promptEnhancementAuthorityModeForTextV1(originalPromptText) === 'plan_or_review'
    && promptEnhancementAuthorityModeForTextV1(generatedBodyText).startsWith('execute');

  it.each([
    ['ask first before touching anything in prod', 'Apply the change in prod.'],
    ['do not deploy without my ok', 'Deploy the service.'],
  ])('catches an escalation the substitute misses: %s', (original, body) => {
    // The substitute reads verb MOOD, so ask-first and do-not phrasings are not
    // "plan_or_review" to it and the escalation goes unflagged.
    expect(substituteFlagsEscalation(original, body)).toBe(false);

    const floors = floorsFor(original, body);
    expect(floors).toContain('permission_boundaries');
  });

  it('agrees with the substitute when the original is plan-shaped', () => {
    const original = 'review whether we should migrate the schema';
    const body = 'Migrate the schema now.';

    expect(substituteFlagsEscalation(original, body)).toBe(true);
    expect(floorsFor(original, body)).toContain('sensitive_action_verb_mood');
  });
});

describe('T4 — floors must be able to fire on a real composed body', () => {
  it('does not treat an English verb as a command', () => {
    // "make the landing page look more modern" reported a `commands` violation, because
    // several tool names are ordinary English words. Caught by measuring against real
    // composed bodies; reading the regex had not caught it.
    expect(floorsFor('make the landing page look more modern', 'Improve the visual design of the landing page.'))
      .not.toContain('commands');
    expect(floorsFor('node the tree structure', 'Restructure the tree.')).not.toContain('commands');
  });

  it('still catches a real command', () => {
    expect(floorsFor('run npm run build:prod first', 'Build the project first.')).toContain('commands');
  });

  it('would report nothing at all if handed a whole body instead of the guidance half', () => {
    // The reason the collector splits: a composed body opens with the user's prompt
    // verbatim, so every item is trivially present and no floor can fire. This pins the
    // property that made the first wiring vacuous.
    const prompt = 'the bug is in src/services/payment/handler.ts';
    const wholeBody = `My original request (verbatim):\n${prompt}\n\nThe bug is in the payment module.`;

    expect(floorsFor(prompt, wholeBody)).toEqual([]);
    expect(floorsFor(prompt, 'The bug is in the payment module.')).toContain('file_paths');
  });
});
