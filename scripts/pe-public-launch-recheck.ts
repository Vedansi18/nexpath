/**
 * S3 / P14-G1 — owner-run public-launch recheck (owner design decision #1: owner-run, no CI gate).
 *
 * MANDATORY pre-promotion checklist action: run this BEFORE promoting the prompt-enhancement tree to
 * public. It executes the PE-CR-5 / G8 launch-recheck gate against real repo facts and hard-BLOCKS
 * (exit 1) unless the gate is ready + the owner has explicitly approved public promotion. There is
 * deliberately no CI backstop — skipping this step is exactly what caused the confidentiality incident.
 *
 *   npm run pe:launch-recheck
 *   PE_OWNER_LAUNCH_DECISION=approved_public_promotion \
 *   PE_NESTED_GIT_REMOVE_ONLY_APPROVED=true npm run pe:launch-recheck
 */
import { runPromptEnhancementPublicLaunchRecheckCliV1 } from '../src/prompt-enhancement/public-launch-recheck-cli.js';

const decision = process.env['PE_OWNER_LAUNCH_DECISION'];
const ownerLaunchDecision =
  decision === 'approved_public_promotion' || decision === 'blocked' ? decision : 'missing';

const result = runPromptEnhancementPublicLaunchRecheckCliV1({
  projectRoot: process.cwd(),
  ownerLaunchDecision,
  nestedGitRemoveOnlyProcedureApproved: process.env['PE_NESTED_GIT_REMOVE_ONLY_APPROVED'] === 'true',
  pathRewriteRequested: process.env['PE_PATH_REWRITE_REQUESTED'] === 'true',
});

process.stdout.write(`${result.report}\n`);
process.exit(result.blocked ? 1 : 0);
