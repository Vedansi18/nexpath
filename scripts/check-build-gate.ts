/**
 * Pre-build content-template gate (§4.E2 / §6.1 live-activation item 8).
 *
 * Runs the HARD build gate (`runBuildGate`: schema validation + the mandatory
 * level-1 floor) over the whole shipped registry BEFORE `tsc`, so a raw
 * `npm run build` — not just `vitest run` — hard-fails on a missing-floor or
 * schema-invalid record. Wired as the `prebuild` npm script; executed via `tsx`
 * so it reads the TypeScript source directly (no compiled dist needed first).
 *
 * Exit code 1 on any gate failure aborts the build before compilation; 0 lets
 * the build proceed.
 */

import { runBuildGate, SHIPPED_CONTENT_TEMPLATES } from '../src/decision-session/content-template-tooling.js';
import { findPromptEnhancementRoutabilityGaps } from '../src/prompt-enhancement/templates/registry.js';

const res = runBuildGate(SHIPPED_CONTENT_TEMPLATES);

if (!res.ok) {
  console.error(`✗ content-template build gate FAILED (${SHIPPED_CONTENT_TEMPLATES.length} records checked)`);
  if (!res.schema.ok) {
    for (const [signalType, errors] of Object.entries(res.schema.errorsBySignalType)) {
      console.error(`  schema — ${signalType}: ${errors.join('; ')}`);
    }
  }
  if (!res.floor.ok) {
    console.error(`  missing level-1 floor: ${res.floor.missingFloor.join(', ')}`);
  }
  console.error('Build aborted: fix the records above before building.');
  process.exit(1);
}

console.log(`✓ content-template build gate passed (${SHIPPED_CONTENT_TEMPLATES.length} records, all floored + schema-valid)`);

// SELECTABILITY: id presence proved a record EXISTS while ten intents sat
// unreachable by any prompt for months. This proves a realistic PROMPT actually
// ROUTES to every intent through the production keyed path - a no-popup outcome
// or an absorb into a different intent aborts the build.
const routabilityGaps = findPromptEnhancementRoutabilityGaps();
if (routabilityGaps.length > 0) {
  console.error(`✗ prompt-enhancement selectability gate FAILED (${routabilityGaps.length} gaps)`);
  for (const gap of routabilityGaps) console.error(`  ${gap}`);
  console.error('Build aborted: an intent a prompt cannot reach is a dead template, not a shipped one.');
  process.exit(1);
}
// Says what it PROVES, not what we wish it proved. Each probe is routed with its
// intent as the classifier proposal, so this gate shows every intent is selectable
// end-to-end at the ROUTER — no absorption into another intent, no skip — which is
// strictly more than the id-presence check it replaced and would have caught the
// original dead-template bug. It does NOT exercise the prompt->intent step: that is
// the classifier's, and an LLM cannot be gated deterministically in a build.
console.log('✓ prompt-enhancement selectability gate passed (every intent routes from its proposal - no absorb, no skip)');
