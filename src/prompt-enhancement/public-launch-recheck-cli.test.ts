import { describe, expect, it } from 'vitest';
import {
  buildPromptEnhancementPublicLaunchForbiddenPatternsV1,
  type PromptEnhancementPublicLaunchFileFactsV1,
} from './public-launch-recheck.js';
import { evaluatePromptEnhancementPublicLaunchRecheckV1 } from './public-launch-recheck-cli.js';

// Leak fixtures are decoded from base64 so THIS test source (which lives in the scanned public tree)
// never contains the literal private strings it asserts detection of — the same discipline the
// scanner itself follows (S3 / owner decision #2).
const d = (b64: string): string => Buffer.from(b64, 'base64').toString('utf8');
const LEAK_FORMS: Record<string, string> = {
  id_hyphen: d('cGUtYXItMQ=='),          // research id, hyphen form
  id_underscore: d('cGVfZHIz'),           // research id, underscore form
  id_em: d('UEUtRU0tMQ=='),               // EM family (missed by the old list)
  id_g: d('UEUtRzQ='),                    // G family
  phase_dot: d('QjIuMQ=='),               // dotted phase code
  phase_dash: d('YjMtNA=='),              // dash phase code
  teammate: d('aGlyZW4='),                // bare teammate name
  teammate_enum: d('aGlyZW5fY29udGVudF9hcGk='), // owner-enum value embedding the name
  cost: d('Mi41MA=='),                    // exact cost label
  cost_gate: d('R2F0ZS1HMQ=='),           // exact gate label
};

function factsWithText(text: string, overrides: Partial<PromptEnhancementPublicLaunchFileFactsV1> = {}): PromptEnhancementPublicLaunchFileFactsV1 {
  return {
    projectRoot: '/repo',
    gitignoreText: 'src/prompt-enhancement/\nsrc/ext-vscode/prebuilds/\n',
    trackedFiles: ['src/prompt-enhancement/facade.ts'],
    checkIgnoredPaths: ['src/prompt-enhancement', 'src/ext-vscode/prebuilds'],
    promptEnhancementPathExists: true,
    promptEnhancementNestedGitExists: false,
    nestedGitRemoveOnlyProcedureApproved: false,
    pathRewriteRequested: false,
    packageJsonText: '{"scripts":{"build":"tsc","test":"vitest run"}}',
    tsconfigText: '{"include":["src/**/*"],"exclude":["node_modules","dist","src/ext-vscode"]}',
    publicGoingFileTexts: [{ path: 'src/prompt-enhancement/example.ts', text }],
    ownerLaunchDecision: 'approved_public_promotion',
    ...overrides,
  };
}

describe('S3 — public-launch recheck gate (P14-G1 runs + P14-G2 catches)', () => {
  it('acceptance #1: the regex catches EVERY leak form the old literal list missed', () => {
    const patterns = buildPromptEnhancementPublicLaunchForbiddenPatternsV1();
    const categoryOf = (text: string): string | undefined =>
      patterns.find((p) => p.test.test(text))?.category;
    expect(categoryOf(LEAK_FORMS.id_hyphen)).toBe('id_code');
    expect(categoryOf(LEAK_FORMS.id_underscore)).toBe('id_code');   // underscore form — old list missed this
    expect(categoryOf(LEAK_FORMS.id_em)).toBe('id_code');           // EM family — old list missed this
    expect(categoryOf(LEAK_FORMS.id_g)).toBe('id_code');            // G family — old list missed this
    expect(categoryOf(LEAK_FORMS.phase_dot)).toBe('phase_code');    // phase codes — old list missed these
    expect(categoryOf(LEAK_FORMS.phase_dash)).toBe('phase_code');
    expect(categoryOf(LEAK_FORMS.teammate)).toBe('teammate_name');  // teammate names — old list missed these entirely
    expect(categoryOf(LEAK_FORMS.teammate_enum)).toBe('teammate_name');
    expect(categoryOf(LEAK_FORMS.cost)).toBe('cost_label');
    expect(categoryOf(LEAK_FORMS.cost_gate)).toBe('cost_label');
  });

  it('acceptance #1b: a clean string is NOT flagged (no false positive on ordinary code)', () => {
    const patterns = buildPromptEnhancementPublicLaunchForbiddenPatternsV1();
    expect(patterns.some((p) => p.test.test('export function computeReviewScore(items) { return items.length; }'))).toBe(false);
  });

  it('acceptance #2: forbidden findings hard-BLOCK promotion (status blocked, not promotable)', () => {
    const leakedText = Object.values(LEAK_FORMS).join('\n');
    const result = evaluatePromptEnhancementPublicLaunchRecheckV1(factsWithText(leakedText));
    expect(result.blocked).toBe(true);
    expect(result.publicPromotionAllowed).toBe(false);
    expect(result.forbiddenFindings.length).toBeGreaterThan(0);
    expect(result.failedChecks).toContain('public_safe_names_comments_docs_fixtures');
    // Each category surfaced in its own scoped check.
    expect(result.failedChecks).toContain('forbidden_cost_private_label_scan');
    expect(result.failedChecks).toContain('private_gate_name_scan');
  });

  it('acceptance #2b: missing owner decision alone blocks even a clean tree', () => {
    const result = evaluatePromptEnhancementPublicLaunchRecheckV1(factsWithText('const clean = true;', { ownerLaunchDecision: 'missing' }));
    expect(result.blocked).toBe(true);
    expect(result.failedChecks).toContain('explicit_owner_launch_decision');
  });

  it('acceptance #3: a clean tree WITH explicit owner approval is ready for owner launch review', () => {
    const result = evaluatePromptEnhancementPublicLaunchRecheckV1(factsWithText('const clean = true; // ordinary source'));
    expect(result.blocked).toBe(false);
    expect(result.status).toBe('ready_for_owner_launch_review');
    expect(result.publicPromotionAllowed).toBe(true);
    expect(result.forbiddenFindings.length).toBe(0);
  });
});
