import { execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  readPromptEnhancementPublicLaunchFileFactsV1,
  buildPromptEnhancementPublicLaunchRecheckPacketV1,
  validatePromptEnhancementPublicLaunchRecheckPacketV1,
  type PromptEnhancementPublicLaunchFileFactsV1,
  type PromptEnhancementPublicLaunchRecheckPacketV1,
} from './public-launch-recheck.js';

/**
 * S3 / P14-G1 — the owner-run public-launch recheck CLI (owner design decision #1, 2026-08-05:
 * owner-run command, NO CI gate). This makes the previously-unrun G8 confidentiality gate actually
 * EXECUTE before public promotion — the single mandatory pre-promotion checklist action. It gathers real
 * facts (git tracked files, .gitignore, the public-going PE file set) and hard-BLOCKS unless the gate
 * is `ready_for_owner_launch_review` + `publicPromotionAllowed` (which already requires the explicit
 * owner approved-public-promotion decision). There is deliberately no CI backstop, so skipping this
 * step is exactly the incident cause — it must stay on the release-check owner's checklist.
 *
 * Scope note: the scan set is the PUBLIC tree only (`src/prompt-enhancement/**` + `src/ext-vscode`
 * public sources) — NOT the private submodule planning docs (`lib/shared/sub-module/**`), which
 * legitimately contain the private ids as documentation and would false-block.
 */
export interface PromptEnhancementPublicLaunchRecheckCliResultV1 {
  blocked: boolean;
  status: PromptEnhancementPublicLaunchRecheckPacketV1['status'];
  publicPromotionAllowed: boolean;
  forbiddenFindings: readonly string[];
  failedChecks: readonly string[];
  reasonCodes: readonly string[];
  report: string;
}

/** Pure core: build + validate the packet from already-gathered facts, and decide block/allow. */
export function evaluatePromptEnhancementPublicLaunchRecheckV1(
  facts: PromptEnhancementPublicLaunchFileFactsV1,
): PromptEnhancementPublicLaunchRecheckCliResultV1 {
  const packet = buildPromptEnhancementPublicLaunchRecheckPacketV1(facts);
  const reasonCodes = validatePromptEnhancementPublicLaunchRecheckPacketV1(packet);
  const promotable =
    packet.status === 'ready_for_owner_launch_review' &&
    packet.publicPromotionAllowed === true &&
    reasonCodes.length === 0;
  const failedChecks = packet.checks.filter((check) => !check.ok).map((check) => check.id);
  const report = [
    promotable
      ? 'PE public-launch recheck: READY FOR OWNER LAUNCH REVIEW (all checks pass + owner approval).'
      : 'PE public-launch recheck: BLOCKED — do NOT promote to public.',
    `  status: ${packet.status}`,
    `  publicPromotionAllowed: ${packet.publicPromotionAllowed}`,
    failedChecks.length ? `  failed checks: ${failedChecks.join(', ')}` : '  failed checks: none',
    packet.forbiddenFindings.length
      ? `  forbidden findings (${packet.forbiddenFindings.length}): ${packet.forbiddenFindings.join(' | ')}`
      : '  forbidden findings: none',
    reasonCodes.length ? `  validator reason codes: ${reasonCodes.join(', ')}` : '  validator reason codes: none',
  ].join('\n');
  return {
    blocked: !promotable,
    status: packet.status,
    publicPromotionAllowed: packet.publicPromotionAllowed,
    forbiddenFindings: packet.forbiddenFindings,
    failedChecks,
    reasonCodes,
    report,
  };
}

/** Enumerate the public-going PE file set (public tree only; excludes the private submodule). */
export function enumeratePublicGoingPromptEnhancementFilesV1(projectRoot: string): readonly string[] {
  const roots = ['src/prompt-enhancement', 'src/ext-vscode/src'];
  const out: string[] = [];
  const walk = (absoluteDir: string): void => {
    for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'prebuilds' || entry.name === '.git') continue;
      const abs = join(absoluteDir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (/\.(ts|md|json)$/.test(entry.name)) out.push(relative(projectRoot, abs));
    }
  };
  for (const root of roots) {
    const abs = join(projectRoot, root);
    if (existsSync(abs)) walk(abs);
  }
  return out;
}

/** Gather real repo facts (git + fs) and run the recheck. Used by the CLI main(). */
export function runPromptEnhancementPublicLaunchRecheckCliV1(input: {
  projectRoot: string;
  ownerLaunchDecision?: PromptEnhancementPublicLaunchFileFactsV1['ownerLaunchDecision'];
  nestedGitRemoveOnlyProcedureApproved?: boolean;
  pathRewriteRequested?: boolean;
}): PromptEnhancementPublicLaunchRecheckCliResultV1 {
  const trackedFiles = execSync('git ls-files', { cwd: input.projectRoot, encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const publicGoingFilePaths = enumeratePublicGoingPromptEnhancementFilesV1(input.projectRoot);
  const facts = readPromptEnhancementPublicLaunchFileFactsV1({
    projectRoot: input.projectRoot,
    trackedFiles,
    checkIgnoredPaths: ['src/prompt-enhancement', 'src/ext-vscode/prebuilds'],
    publicGoingFilePaths,
    ownerLaunchDecision: input.ownerLaunchDecision ?? 'missing',
    nestedGitRemoveOnlyProcedureApproved: input.nestedGitRemoveOnlyProcedureApproved ?? false,
    pathRewriteRequested: input.pathRewriteRequested ?? false,
  });
  return evaluatePromptEnhancementPublicLaunchRecheckV1(facts);
}
