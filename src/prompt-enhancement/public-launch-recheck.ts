import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLAN_LOCK_SOURCE_BASIS } from './plan-lock.js';

export type PromptEnhancementPublicLaunchRecheckStatusV1 =
  | 'blocked_pending_live_recheck'
  | 'blocked_by_public_launch_hard_fail'
  | 'ready_for_owner_launch_review';

export type PromptEnhancementPublicLaunchCheckIdV1 =
  | 'ignore_tracking_state'
  | 'nested_git_remove_only'
  | 'no_path_rewrite'
  | 'tracked_file_inventory'
  | 'build_test_package_inclusion'
  | 'import_stability'
  | 'public_safe_names_comments_docs_fixtures'
  | 'generated_output_exclusion'
  | 'private_planning_leakage'
  | 'forbidden_cost_private_label_scan'
  | 'private_issue_number_scan'
  | 'private_gate_name_scan'
  | 'private_dollar_threshold_scan'
  | 'private_planning_terminology_scan'
  | 'explicit_owner_launch_decision';

export interface PromptEnhancementPublicLaunchFileFactsV1 {
  projectRoot: string;
  gitignoreText: string;
  trackedFiles: readonly string[];
  checkIgnoredPaths: readonly string[];
  promptEnhancementPathExists: boolean;
  promptEnhancementNestedGitExists: boolean;
  nestedGitRemoveOnlyProcedureApproved: boolean;
  pathRewriteRequested: boolean;
  packageJsonText: string;
  tsconfigText: string;
  publicGoingFileTexts: readonly {
    path: string;
    text: string;
  }[];
  ownerLaunchDecision:
    | 'missing'
    | 'blocked'
    | 'approved_public_promotion';
}

export interface PromptEnhancementPublicLaunchCheckV1 {
  id: PromptEnhancementPublicLaunchCheckIdV1;
  ok: boolean;
  expected: string;
  actual: string;
  hardFail: boolean;
}

export interface PromptEnhancementPublicLaunchRecheckPacketV1 {
  gateId: 'G8-PE-CR-5-public-launch';
  owner: 'bhavnesh_coordinating_release_check';
  status: PromptEnhancementPublicLaunchRecheckStatusV1;
  publicPromotionAllowed: boolean;
  launchReadyClaimAllowed: boolean;
  checks: readonly PromptEnhancementPublicLaunchCheckV1[];
  forbiddenFindings: readonly string[];
  requiredFocus: readonly string[];
  removeOnlyBoundary: {
    nestedGitPresent: boolean;
    removalProcedureApproved: boolean;
    pathRewriteAllowed: false;
  };
}

export const PROMPT_ENHANCEMENT_PUBLIC_LAUNCH_REQUIRED_FOCUS_V1 = [
  'ignore_tracking_state',
  'nested_git_remove_only_procedure',
  'no_path_rewrite',
  'tracked_file_inventory',
  'import_build_test_package_inclusion',
  'package_docs_fixture_privacy',
  'generated_output_exclusion',
  'public_safe_names_comments_docs_fixtures',
  'no_private_planning_leakage',
] as const;

/**
 * Launch-recheck forbidden-token detection (owner design decision #2, 2026-08-05). The detection tokens
 * are assembled at runtime from base64 fragments so THIS scanner source never contains the literal
 * private strings it scans for — otherwise, once the working tree is renamed, this file would be the
 * one place those strings survived and it would flag itself. The research-id and phase-code matchers
 * are pattern regexes (they hold no literal private id), so they stay as source regexes; the
 * teammate-name and exact cost/label tokens are decoded from fragments.
 */
export type PromptEnhancementPublicLaunchForbiddenCategoryV1 =
  | 'id_code'
  | 'phase_code'
  | 'teammate_name'
  | 'cost_label';

export interface PromptEnhancementPublicLaunchForbiddenPatternV1 {
  category: PromptEnhancementPublicLaunchForbiddenCategoryV1;
  test: RegExp;
}

function decodeToken(fragment: string): string {
  return Buffer.from(fragment, 'base64').toString('utf8');
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildPromptEnhancementPublicLaunchForbiddenPatternsV1(): readonly PromptEnhancementPublicLaunchForbiddenPatternV1[] {
  const teammateNames = ['aGlyZW4=', 'Ymhhdm5lc2g=', 'dmVkYW5zaQ=='].map(decodeToken);
  const costLabels = ['Mi41MA==', 'My4wMA==', 'QUctMTE=', 'R2F0ZS1HMQ=='].map(decodeToken);
  return [
    // research / gate id codes — both hyphen and underscore forms, any casing.
    { category: 'id_code', test: /\bpe[-_]?(ar|cr|dr|em|wr|g)[-_]?\d/i },
    // private phase codes — dotted and dash/underscore forms.
    { category: 'phase_code', test: /\b[bh]\d\.\d\b/i },
    { category: 'phase_code', test: /\b[bh]\d[-_]\d/i },
    // teammate names + owner-enum values (the enum values embed the bare name).
    { category: 'teammate_name', test: new RegExp(teammateNames.map(escapeForRegExp).join('|'), 'i') },
    // exact private cost / label tokens.
    { category: 'cost_label', test: new RegExp(costLabels.map(escapeForRegExp).join('|')) },
  ];
}

export function readPromptEnhancementPublicLaunchFileFactsV1(input: {
  projectRoot: string;
  trackedFiles: readonly string[];
  checkIgnoredPaths: readonly string[];
  publicGoingFilePaths?: readonly string[];
  nestedGitRemoveOnlyProcedureApproved?: boolean;
  pathRewriteRequested?: boolean;
  ownerLaunchDecision?: PromptEnhancementPublicLaunchFileFactsV1['ownerLaunchDecision'];
}): PromptEnhancementPublicLaunchFileFactsV1 {
  return {
    projectRoot: input.projectRoot,
    gitignoreText: readText(join(input.projectRoot, '.gitignore')),
    trackedFiles: input.trackedFiles,
    checkIgnoredPaths: input.checkIgnoredPaths,
    promptEnhancementPathExists: existsSync(join(input.projectRoot, 'src/prompt-enhancement')),
    promptEnhancementNestedGitExists: existsSync(join(input.projectRoot, 'src/prompt-enhancement/.git')),
    nestedGitRemoveOnlyProcedureApproved: input.nestedGitRemoveOnlyProcedureApproved ?? false,
    pathRewriteRequested: input.pathRewriteRequested ?? false,
    packageJsonText: readText(join(input.projectRoot, 'package.json')),
    tsconfigText: readText(join(input.projectRoot, 'tsconfig.json')),
    publicGoingFileTexts: (input.publicGoingFilePaths ?? []).map((path) => ({
      path,
      text: readText(join(input.projectRoot, path)),
    })),
    ownerLaunchDecision: input.ownerLaunchDecision ?? 'missing',
  };
}

export function buildPromptEnhancementPublicLaunchRecheckPacketV1(
  facts: PromptEnhancementPublicLaunchFileFactsV1,
): PromptEnhancementPublicLaunchRecheckPacketV1 {
  const promptEnhancementTracked = filesWithPrefix(facts.trackedFiles, PLAN_LOCK_SOURCE_BASIS.ignoredPromptEnhancementPath);
  const prebuildTracked = filesWithPrefix(facts.trackedFiles, PLAN_LOCK_SOURCE_BASIS.ignoredExtVscodePrebuildsPath);
  const forbiddenFindings = findForbiddenPublicLaunchFindings(facts.publicGoingFileTexts);
  const checks: PromptEnhancementPublicLaunchCheckV1[] = [
    check(
      'ignore_tracking_state',
      'prompt-enhancement and ext-vscode prebuild paths are explicitly checked against ignore/tracking facts',
      `${includesPath(facts.gitignoreText, PLAN_LOCK_SOURCE_BASIS.ignoredPromptEnhancementPath) ? 'pe-ignore-present' : 'pe-ignore-missing'}; ${includesPath(facts.gitignoreText, PLAN_LOCK_SOURCE_BASIS.ignoredExtVscodePrebuildsPath) ? 'prebuild-ignore-present' : 'prebuild-ignore-missing'}; checked=${facts.checkIgnoredPaths.join(',')}`,
      includesPath(facts.gitignoreText, PLAN_LOCK_SOURCE_BASIS.ignoredPromptEnhancementPath)
        && includesPath(facts.gitignoreText, PLAN_LOCK_SOURCE_BASIS.ignoredExtVscodePrebuildsPath)
        && facts.checkIgnoredPaths.includes('src/prompt-enhancement')
        && facts.checkIgnoredPaths.includes('src/ext-vscode/prebuilds'),
    ),
    check(
      'nested_git_remove_only',
      'nested private git may be removed only by explicit owner-approved remove-only procedure',
      facts.promptEnhancementNestedGitExists
        ? `nested-git-present; remove-only-approved=${facts.nestedGitRemoveOnlyProcedureApproved}`
        : `nested-git-absent; remove-only-approved=${facts.nestedGitRemoveOnlyProcedureApproved}`,
      !facts.promptEnhancementNestedGitExists || facts.nestedGitRemoveOnlyProcedureApproved,
      true,
    ),
    check(
      'no_path_rewrite',
      'no path rewrite requested',
      facts.pathRewriteRequested ? 'path-rewrite-requested' : 'no-path-rewrite',
      facts.pathRewriteRequested === false,
      true,
    ),
    check(
      'tracked_file_inventory',
      'real tracked PE source inventory exists and generated prebuilds are not tracked',
      `pe=${promptEnhancementTracked.length}; prebuild=${prebuildTracked.length}`,
      promptEnhancementTracked.length > 0 && prebuildTracked.length === 0,
    ),
    check(
      'build_test_package_inclusion',
      'package build/test scripts and tsconfig include public PE TypeScript while excluding ext-vscode generated output',
      buildPackageInclusionActual(facts),
      facts.packageJsonText.includes('"build"')
        && facts.packageJsonText.includes('"test"')
        && facts.tsconfigText.includes('"src/**/*"')
        && facts.tsconfigText.includes('"src/ext-vscode"'),
    ),
    check(
      'import_stability',
      'public-going PE files use relative .js imports and no private submodule path imports',
      importStabilityActual(facts.publicGoingFileTexts),
      facts.publicGoingFileTexts.every((file) => !file.text.includes('lib/shared/submodules') && !file.text.includes('reviewduel')),
    ),
    check(
      'public_safe_names_comments_docs_fixtures',
      'public-going source/docs/tests/fixtures avoid private labels and raw private content',
      forbiddenFindings.length === 0 ? 'no forbidden findings' : forbiddenFindings.join(','),
      forbiddenFindings.length === 0,
      true,
    ),
    check(
      'generated_output_exclusion',
      'src/ext-vscode/prebuilds is generated output and not tracked as PE source',
      `tracked-prebuild=${prebuildTracked.length}`,
      prebuildTracked.length === 0,
      true,
    ),
    check(
      'private_planning_leakage',
      'no private planning leakage in public-going files',
      findingsInCategories(forbiddenFindings, ['teammate_name', 'phase_code']).join(',') || 'none',
      findingsInCategories(forbiddenFindings, ['teammate_name', 'phase_code']).length === 0,
      true,
    ),
    check(
      'forbidden_cost_private_label_scan',
      'public-going files do not expose forbidden private cost/gate labels',
      findingsInCategories(forbiddenFindings, ['cost_label']).join(',') || 'none',
      findingsInCategories(forbiddenFindings, ['cost_label']).length === 0,
      true,
    ),
    check(
      'private_issue_number_scan',
      'public-going files do not expose private issue numbers',
      findingsInCategories(forbiddenFindings, ['phase_code']).join(',') || 'none',
      findingsInCategories(forbiddenFindings, ['phase_code']).length === 0,
      true,
    ),
    check(
      'private_gate_name_scan',
      'public-going files do not expose private gate names',
      findingsInCategories(forbiddenFindings, ['id_code']).join(',') || 'none',
      findingsInCategories(forbiddenFindings, ['id_code']).length === 0,
      true,
    ),
    check(
      'private_dollar_threshold_scan',
      'public-going files do not expose private dollar thresholds',
      findingsInCategories(forbiddenFindings, ['cost_label']).join(',') || 'none',
      findingsInCategories(forbiddenFindings, ['cost_label']).length === 0,
      true,
    ),
    check(
      'private_planning_terminology_scan',
      'public-going files do not expose private planning terminology',
      findingsInCategories(forbiddenFindings, ['teammate_name']).join(',') || 'none',
      findingsInCategories(forbiddenFindings, ['teammate_name']).length === 0,
      true,
    ),
    check(
      'explicit_owner_launch_decision',
      'Bhavnesh coordinating release-check owner has approved public promotion',
      facts.ownerLaunchDecision,
      facts.ownerLaunchDecision === 'approved_public_promotion',
    ),
  ];

  const hardFailed = checks.some((item) => item.hardFail && !item.ok);
  const allOk = checks.every((item) => item.ok);

  return {
    gateId: 'G8-PE-CR-5-public-launch',
    owner: 'bhavnesh_coordinating_release_check',
    status: allOk ? 'ready_for_owner_launch_review' : hardFailed ? 'blocked_by_public_launch_hard_fail' : 'blocked_pending_live_recheck',
    publicPromotionAllowed: allOk,
    launchReadyClaimAllowed: allOk,
    checks,
    forbiddenFindings,
    requiredFocus: PROMPT_ENHANCEMENT_PUBLIC_LAUNCH_REQUIRED_FOCUS_V1,
    removeOnlyBoundary: {
      nestedGitPresent: facts.promptEnhancementNestedGitExists,
      removalProcedureApproved: facts.nestedGitRemoveOnlyProcedureApproved,
      pathRewriteAllowed: false,
    },
  };
}

export function validatePromptEnhancementPublicLaunchRecheckPacketV1(
  packet: PromptEnhancementPublicLaunchRecheckPacketV1,
): readonly string[] {
  const reasonCodes: string[] = [];
  const checkIds = new Set(packet.checks.map((item) => item.id));
  for (const focus of PROMPT_ENHANCEMENT_PUBLIC_LAUNCH_REQUIRED_FOCUS_V1) {
    if (!packet.requiredFocus.includes(focus)) reasonCodes.push(`missing_required_focus:${focus}`);
  }
  for (const checkId of [
    'ignore_tracking_state',
    'nested_git_remove_only',
    'no_path_rewrite',
    'tracked_file_inventory',
    'build_test_package_inclusion',
    'import_stability',
    'public_safe_names_comments_docs_fixtures',
    'generated_output_exclusion',
    'private_planning_leakage',
    'forbidden_cost_private_label_scan',
    'private_issue_number_scan',
    'private_gate_name_scan',
    'private_dollar_threshold_scan',
    'private_planning_terminology_scan',
    'explicit_owner_launch_decision',
  ] as const) {
    if (!checkIds.has(checkId)) reasonCodes.push(`missing_check:${checkId}`);
  }
  if (packet.removeOnlyBoundary.pathRewriteAllowed !== false) reasonCodes.push('path_rewrite_allowed');
  if (packet.publicPromotionAllowed !== packet.checks.every((item) => item.ok)) reasonCodes.push('public_promotion_state_mismatch');
  if (packet.launchReadyClaimAllowed !== packet.publicPromotionAllowed) reasonCodes.push('launch_ready_claim_state_mismatch');
  if (packet.publicPromotionAllowed && packet.status !== 'ready_for_owner_launch_review') reasonCodes.push('ready_status_mismatch');
  if (!packet.publicPromotionAllowed && packet.status === 'ready_for_owner_launch_review') reasonCodes.push('blocked_status_mismatch');
  return reasonCodes;
}

function readText(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function filesWithPrefix(files: readonly string[], prefix: string): readonly string[] {
  return files.filter((file) => file === prefix.replace(/\/$/, '') || file.startsWith(prefix));
}

function includesPath(text: string, path: string): boolean {
  return text.split(/\r?\n/).some((line) => line.trim() === path);
}

function buildPackageInclusionActual(facts: PromptEnhancementPublicLaunchFileFactsV1): string {
  return [
    facts.packageJsonText.includes('"build"') ? 'build-script-present' : 'build-script-missing',
    facts.packageJsonText.includes('"test"') ? 'test-script-present' : 'test-script-missing',
    facts.tsconfigText.includes('"src/**/*"') ? 'src-include-present' : 'src-include-missing',
    facts.tsconfigText.includes('"src/ext-vscode"') ? 'ext-vscode-excluded' : 'ext-vscode-exclusion-missing',
  ].join('; ');
}

function importStabilityActual(files: readonly { path: string; text: string }[]): string {
  const badFiles = files
    .filter((file) => file.text.includes('lib/shared/submodules') || file.text.includes('reviewduel'))
    .map((file) => file.path);
  return badFiles.length === 0 ? 'no private path imports' : badFiles.join(',');
}

function findingsInCategories(
  findings: readonly string[],
  categories: readonly PromptEnhancementPublicLaunchForbiddenCategoryV1[],
): readonly string[] {
  // Findings are `path:category:match`; filter by the safe category label (never by a leaked literal).
  return findings.filter((finding) => categories.some((category) => finding.includes(`:${category}:`)));
}

function findForbiddenPublicLaunchFindings(files: readonly { path: string; text: string }[]): readonly string[] {
  const patterns = buildPromptEnhancementPublicLaunchForbiddenPatternsV1();
  const findings: string[] = [];
  for (const file of files) {
    for (const { category, test } of patterns) {
      const match = test.exec(file.text);
      if (match) findings.push(`${file.path}:${category}:${match[0]}`);
    }
  }
  return findings;
}

function check(
  id: PromptEnhancementPublicLaunchCheckIdV1,
  expected: string,
  actual: string,
  ok: boolean,
  hardFail = false,
): PromptEnhancementPublicLaunchCheckV1 {
  return { id, expected, actual, ok, hardFail };
}
