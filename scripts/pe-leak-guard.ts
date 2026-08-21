/**
 * S1 §5d Step 10 / S3-shared — CI / pre-push leak-guard (prevent recurrence).
 *
 * Fails (exit 1) if any public-going PE file contains a confidentiality leak token — the same
 * category regex the S3 launch-recheck gate uses (`buildPromptEnhancementPublicLaunchForbiddenPatternsV1`,
 * built from encoded tokens so this guard chain never embeds the literals). Wire this as a pre-push
 * hook / CI step so a leak reintroduced after the S1/S2 scrub HARD-FAILS the build instead of shipping.
 *
 *   npm run pe:leak-guard
 *
 * This is a read-only scan of the working tree — it performs NO git history rewrite, force-push,
 * branch delete, or repo-visibility change (those are owner-gated containment ops, never automated).
 */
import {
  buildPromptEnhancementPublicLaunchForbiddenPatternsV1,
} from '../src/prompt-enhancement/public-launch-recheck.js';
import { enumeratePublicGoingPromptEnhancementFilesV1 } from '../src/prompt-enhancement/public-launch-recheck-cli.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const projectRoot = process.cwd();
const patterns = buildPromptEnhancementPublicLaunchForbiddenPatternsV1();
const findings: string[] = [];

for (const path of enumeratePublicGoingPromptEnhancementFilesV1(projectRoot)) {
  let text = '';
  try { text = readFileSync(join(projectRoot, path), 'utf8'); } catch { continue; }
  for (const { category, test } of patterns) {
    const match = test.exec(text);
    if (match) findings.push(`${path}:${category}:${match[0]}`);
  }
}

if (findings.length > 0) {
  process.stderr.write(`PE leak-guard: BLOCKED — ${findings.length} confidentiality leak finding(s):\n`);
  for (const finding of findings) process.stderr.write(`  ${finding}\n`);
  process.stderr.write('Fix (S1/S2 rename) before pushing — a public-safe tree must have zero findings.\n');
  process.exit(1);
}
process.stdout.write('PE leak-guard: OK — no confidentiality leak tokens in the public-going PE tree.\n');
