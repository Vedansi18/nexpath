import {
  PROMPT_ENHANCEMENT_CONTRACT_VERSION,
  type PromptEnhancementPrepareResultV1,
} from './contracts.js';
import type { PromptEnhancementB3ContractEvidenceV1 } from './contract-intake.js';
import { buildPromptEnhancementB3FixtureMatrixV1 } from './fixture-matrix.js';

/**
 * MPS CLI intake evidence (owner ruling 2026-08-06: complete the CLI surface; only the
 * extension-host evidence stays pending with its owner).
 *
 * Builds the three non-extension evidence rows for the MPS intake gate from artifacts that are
 * REAL on the CLI path today:
 *  - `mps_handoff` — the engine's typed handoff/sequence summary on THIS live result (the facade
 *    emits it for compound multi-intent prompts; metadata-only, activation stays policy-blocked).
 *  - `approved_b3_fixtures` — the shipped MPS UI fixture matrix + its green suite.
 *  - `privacy_feedback_contract` — the shipped PEF feedback contract (ids/categories only,
 *    raw text excluded), live since the feedback bridge wiring.
 *
 * Deliberately NEVER builds `host_runtime` (DEP-stage-3-02): that is extension-host evidence and
 * remains pending with host_transport; the extension surface stays fail-closed without it.
 * Returns undefined when the result carries no handoff summary — no sequence, no MPS gate to open.
 */
export function buildPromptEnhancementCliMpsIntakeEvidenceV1(
  result: PromptEnhancementPrepareResultV1,
): readonly PromptEnhancementB3ContractEvidenceV1[] | undefined {
  const handoff = result.uiView.handoffAndSequenceSummary;
  if (!handoff) return undefined;
  const contractRevision = `v${PROMPT_ENHANCEMENT_CONTRACT_VERSION}`;
  const fixtureMatrix = buildPromptEnhancementB3FixtureMatrixV1();
  return [
    {
      evidenceId: 'DEP-stage-3-01',
      kind: 'mps_handoff',
      owner: 'engine_contract',
      state: 'supplied',
      contractRevision,
      sourceRefs: [handoff.handoffDecisionId, result.enhancementId],
    },
    {
      evidenceId: 'DEP-TEST-01',
      kind: 'approved_b3_fixtures',
      owner: 'test_owner',
      state: 'supplied',
      contractRevision,
      sourceRefs: [fixtureMatrix.matrixId],
      fixtureIds: fixtureMatrix.rows.map((row) => row.fixtureId),
    },
    {
      evidenceId: 'PE-B3-PRIVACY-FEEDBACK',
      kind: 'privacy_feedback_contract',
      owner: 'privacy_feedback',
      state: 'supplied',
      contractRevision,
      sourceRefs: ['feedback-sink:memory-bridge', 'feedback-policy:aggregate-only'],
    },
  ];
}
