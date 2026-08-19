import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PROMPT_ENHANCEMENT_PUBLIC_LAUNCH_REQUIRED_FOCUS_V1,
  buildPromptEnhancementPublicLaunchRecheckPacketV1,
  readPromptEnhancementPublicLaunchFileFactsV1,
  validatePromptEnhancementPublicLaunchRecheckPacketV1,
  type PromptEnhancementPublicLaunchFileFactsV1,
  type PromptEnhancementPublicLaunchRecheckPacketV1,
} from './public-launch-recheck.js';

function launchFacts(overrides: Partial<PromptEnhancementPublicLaunchFileFactsV1> = {}): PromptEnhancementPublicLaunchFileFactsV1 {
  return {
    projectRoot: '/repo',
    gitignoreText: [
      'dist/',
      'src/prompt-enhancement/',
      'src/ext-vscode/prebuilds/',
    ].join('\n'),
    trackedFiles: [
      'src/prompt-enhancement/contracts.ts',
      'src/prompt-enhancement/public-launch-recheck.ts',
      'src/prompt-enhancement/public-launch-recheck.test.ts',
    ],
    checkIgnoredPaths: ['src/prompt-enhancement', 'src/ext-vscode/prebuilds'],
    promptEnhancementPathExists: true,
    promptEnhancementNestedGitExists: false,
    nestedGitRemoveOnlyProcedureApproved: true,
    pathRewriteRequested: false,
    packageJsonText: '{"scripts":{"build":"tsc","test":"vitest run"}}',
    tsconfigText: '{"include":["src/**/*"],"exclude":["node_modules","dist","src/ext-vscode"]}',
    publicGoingFileTexts: [
      {
        path: 'src/prompt-enhancement/public-launch-recheck.ts',
        text: 'export const publicSafeStatus = "ids_counts_status_only";',
      },
    ],
    ownerLaunchDecision: 'approved_public_promotion',
    ...overrides,
  };
}

describe('Phase 14 public launch recheck', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('allows public promotion only when every G8 launch recheck row is explicitly satisfied', () => {
    const packet = buildPromptEnhancementPublicLaunchRecheckPacketV1(launchFacts());

    expect(packet.gateId).toBe('G8-confidentiality-rule-5-public-launch');
    expect(packet.owner).toBe('coordinating_release_check');
    expect(packet.status).toBe('ready_for_owner_launch_review');
    expect(packet.publicPromotionAllowed).toBe(true);
    expect(packet.launchReadyClaimAllowed).toBe(true);
    expect(packet.requiredFocus).toEqual(PROMPT_ENHANCEMENT_PUBLIC_LAUNCH_REQUIRED_FOCUS_V1);
    expect(packet.checks.filter((check) => !check.ok)).toEqual([]);
    expect(validatePromptEnhancementPublicLaunchRecheckPacketV1(packet)).toEqual([]);
  });

  it('keeps the current private-boundary state blocked without deleting nested git or rewriting paths', () => {
    const packet = buildPromptEnhancementPublicLaunchRecheckPacketV1(launchFacts({
      trackedFiles: [],
      promptEnhancementNestedGitExists: true,
      nestedGitRemoveOnlyProcedureApproved: false,
      ownerLaunchDecision: 'missing',
    }));

    expect(packet.status).toBe('blocked_by_public_launch_hard_fail');
    expect(packet.publicPromotionAllowed).toBe(false);
    expect(packet.launchReadyClaimAllowed).toBe(false);
    expect(packet.removeOnlyBoundary).toEqual({
      nestedGitPresent: true,
      removalProcedureApproved: false,
      pathRewriteAllowed: false,
    });
    expect(packet.checks.find((check) => check.id === 'tracked_file_inventory')).toMatchObject({
      ok: false,
      actual: 'pe=0; prebuild=0',
    });
    expect(packet.checks.find((check) => check.id === 'nested_git_remove_only')).toMatchObject({
      ok: false,
      hardFail: true,
    });
    expect(packet.checks.find((check) => check.id === 'explicit_owner_launch_decision')).toMatchObject({
      ok: false,
      actual: 'missing',
    });
  });

  it('hard-fails private planning labels, private cost labels, private paths, generated prebuild tracking, and path rewrites', () => {
    const packet = buildPromptEnhancementPublicLaunchRecheckPacketV1(launchFacts({
      pathRewriteRequested: true,
      trackedFiles: [
        'src/prompt-enhancement/contracts.ts',
        'src/ext-vscode/prebuilds/native.node',
      ],
      publicGoingFileTexts: [
        {
          path: 'src/prompt-enhancement/bad-fixture.ts',
          // Leak tokens decoded from base64 so this test source stays leak-free (S3 discipline):
          // one of EACH category (id-code, phase-code, teammate-name, cost/gate label) + a private import.
          text: [
            Buffer.from('cGUtYXItMQ==', 'base64').toString('utf8'),   // id_code
            Buffer.from('QjIuMQ==', 'base64').toString('utf8'),       // phase_code
            Buffer.from('aGlyZW4=', 'base64').toString('utf8'),       // teammate_name
            Buffer.from('R2F0ZS1HMQ==', 'base64').toString('utf8'),   // cost_label (gate label)
            'lib/shared/submodules/reviewduel',
          ].join(' '),
        },
      ],
    }));

    expect(packet.status).toBe('blocked_by_public_launch_hard_fail');
    // New category-tagged finding format (`path:category:match`) — the label + teammate name are caught.
    expect(packet.forbiddenFindings.some((finding) => finding.includes('bad-fixture.ts:cost_label:'))).toBe(true);
    expect(packet.forbiddenFindings.some((finding) => finding.includes('bad-fixture.ts:teammate_name:'))).toBe(true);
    expect(packet.checks.find((check) => check.id === 'forbidden_cost_private_label_scan')).toMatchObject({ ok: false });
    expect(packet.checks.find((check) => check.id === 'private_planning_terminology_scan')).toMatchObject({ ok: false });
    expect(packet.checks.find((check) => check.id === 'no_path_rewrite')).toMatchObject({ ok: false, hardFail: true });
    expect(packet.checks.find((check) => check.id === 'generated_output_exclusion')).toMatchObject({ ok: false, hardFail: true });
    expect(packet.checks.find((check) => check.id === 'import_stability')).toMatchObject({ ok: false });
    expect(packet.checks.find((check) => check.id === 'public_safe_names_comments_docs_fixtures')).toMatchObject({ ok: false, hardFail: true });
    expect(packet.checks.find((check) => check.id === 'forbidden_cost_private_label_scan')).toMatchObject({ ok: false, hardFail: true });
    expect(packet.checks.find((check) => check.id === 'private_issue_number_scan')).toMatchObject({ ok: false, hardFail: true });
    expect(packet.checks.find((check) => check.id === 'private_gate_name_scan')).toMatchObject({ ok: false, hardFail: true });
    expect(packet.checks.find((check) => check.id === 'private_dollar_threshold_scan')).toMatchObject({ ok: false, hardFail: true });
    expect(packet.checks.find((check) => check.id === 'private_planning_terminology_scan')).toMatchObject({ ok: false, hardFail: true });
  });

  it('validates required focus, required checks, promotion state, and no path rewrite boundary', () => {
    const packet = structuredClone(buildPromptEnhancementPublicLaunchRecheckPacketV1(launchFacts())) as PromptEnhancementPublicLaunchRecheckPacketV1;
    packet.requiredFocus = packet.requiredFocus.filter((focus) => focus !== 'no_private_planning_leakage');
    packet.checks = packet.checks.filter((check) => check.id !== 'private_planning_leakage');
    packet.removeOnlyBoundary.pathRewriteAllowed = true;
    packet.publicPromotionAllowed = false;
    packet.launchReadyClaimAllowed = true;

    expect(validatePromptEnhancementPublicLaunchRecheckPacketV1(packet)).toEqual(expect.arrayContaining([
      'missing_required_focus:no_private_planning_leakage',
      'missing_check:private_planning_leakage',
      'path_rewrite_allowed',
      'public_promotion_state_mismatch',
      'launch_ready_claim_state_mismatch',
      'blocked_status_mismatch',
    ]));
  });

  it('reads filesystem launch facts without shelling out or changing git state', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'nexpath-public-launch-'));
    tempDirs.push(projectRoot);
    mkdirSync(join(projectRoot, 'src/prompt-enhancement/.git'), { recursive: true });
    mkdirSync(join(projectRoot, 'src/ext-vscode'), { recursive: true });
    writeFileSync(join(projectRoot, '.gitignore'), 'src/prompt-enhancement/\nsrc/ext-vscode/prebuilds/\n', 'utf8');
    writeFileSync(join(projectRoot, 'package.json'), '{"scripts":{"build":"tsc","test":"vitest run"}}', 'utf8');
    writeFileSync(join(projectRoot, 'tsconfig.json'), '{"include":["src/**/*"],"exclude":["src/ext-vscode"]}', 'utf8');
    writeFileSync(join(projectRoot, 'src/prompt-enhancement/public.ts'), 'export const ok = true;\n', 'utf8');

    const facts = readPromptEnhancementPublicLaunchFileFactsV1({
      projectRoot,
      trackedFiles: ['src/prompt-enhancement/public.ts'],
      checkIgnoredPaths: ['src/prompt-enhancement', 'src/ext-vscode/prebuilds'],
      publicGoingFilePaths: ['src/prompt-enhancement/public.ts'],
    });

    expect(facts.promptEnhancementPathExists).toBe(true);
    expect(facts.promptEnhancementNestedGitExists).toBe(true);
    expect(facts.gitignoreText).toContain('src/prompt-enhancement/');
    expect(facts.publicGoingFileTexts).toEqual([
      {
        path: 'src/prompt-enhancement/public.ts',
        text: 'export const ok = true;\n',
      },
    ]);
  });
});
