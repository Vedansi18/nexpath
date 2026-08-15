import {
  buildPromptEnhancementPublicLaunchRecheckPacketV1,
  PROMPT_ENHANCEMENT_PUBLIC_LAUNCH_REQUIRED_FOCUS_V1,
  type PromptEnhancementPublicLaunchFileFactsV1,
  type PromptEnhancementPublicLaunchRecheckPacketV1,
} from './public-launch-recheck.js';

export type PromptEnhancementB5_3ReleaseEvidenceStateV1 = 'missing' | 'supplied' | 'blocked' | 'pass';

export interface PromptEnhancementB5_3EvidenceItemV1 {
  state: PromptEnhancementB5_3ReleaseEvidenceStateV1;
  revision: string | null;
  command: string | null;
  output: string | null;
  owner: 'content_semantics' | 'ui_app' | 'host_transport' | 'release_check' | 'cross_layer_acceptance';
  unresolved: string | null;
}

export interface PromptEnhancementB5_3ReleaseCheckInputV1 {
  observedPrivateRevision: string | null;
  approvedFinalPrivateRevision: string | null;
  publicGoingInventory: readonly string[];
  confidentialityG8ScopeApproval: 'missing' | 'blocked' | 'approved';
  depB501EvidenceRevision: string | null;
  buildTestImportEvidence: PromptEnhancementB5_3EvidenceItemV1;
  publicSafetyEvidence: PromptEnhancementB5_3EvidenceItemV1;
  ownerSignoffs: {
    ownerLaunch: 'missing' | 'approved';
    layerOwners: 'missing' | 'partial' | 'approved';
  };
  publicLaunchFacts: PromptEnhancementPublicLaunchFileFactsV1;
}

export interface PromptEnhancementB5_3ReleaseCheckPacketV1 {
  packetId: 'stage-5-3-release-check-evidence-packet-v1';
  status: 'blocked_pending_release_evidence' | 'blocked_by_public_launch_hard_fail' | 'ready_for_owner_review';
  readinessClaimAllowed: false;
  observedPrivateRevision: string | null;
  approvedFinalPrivateRevision: string | null;
  publicGoingInventory: readonly string[];
  confidentialityG8ScopeApproval: PromptEnhancementB5_3ReleaseCheckInputV1['confidentialityG8ScopeApproval'];
  depB501EvidenceRevision: string | null;
  buildTestImportEvidence: PromptEnhancementB5_3EvidenceItemV1;
  publicSafetyEvidence: PromptEnhancementB5_3EvidenceItemV1;
  ownerSignoffs: PromptEnhancementB5_3ReleaseCheckInputV1['ownerSignoffs'];
  publicLaunchPacket: PromptEnhancementPublicLaunchRecheckPacketV1;
  requiredFocus: typeof PROMPT_ENHANCEMENT_PUBLIC_LAUNCH_REQUIRED_FOCUS_V1;
  boundaryMutationAllowed: false;
  publicLaunchMutationAllowed: false;
  reasonCodes: readonly string[];
}

const BLOCKED_PUBLIC_FACTS: PromptEnhancementPublicLaunchFileFactsV1 = {
  projectRoot: '/current-private-repo',
  gitignoreText: 'src/prompt-enhancement/\nsrc/ext-vscode/prebuilds/\n',
  trackedFiles: [],
  checkIgnoredPaths: ['src/prompt-enhancement', 'src/ext-vscode/prebuilds'],
  promptEnhancementPathExists: true,
  promptEnhancementNestedGitExists: true,
  nestedGitRemoveOnlyProcedureApproved: false,
  pathRewriteRequested: false,
  packageJsonText: '{"scripts":{"build":"tsc","test":"vitest run"}}',
  tsconfigText: '{"include":["src/**/*"],"exclude":["node_modules","dist","src/ext-vscode"]}',
  publicGoingFileTexts: [],
  ownerLaunchDecision: 'missing',
};

const DEFAULT_EVIDENCE: PromptEnhancementB5_3EvidenceItemV1 = {
  state: 'missing', revision: null, command: null, output: null,
  owner: 'release_check', unresolved: 'Owner evidence not supplied.',
};

const DEFAULT_INPUT: PromptEnhancementB5_3ReleaseCheckInputV1 = {
  observedPrivateRevision: 'ae17793',
  approvedFinalPrivateRevision: null,
  publicGoingInventory: [],
  confidentialityG8ScopeApproval: 'missing',
  depB501EvidenceRevision: null,
  buildTestImportEvidence: DEFAULT_EVIDENCE,
  publicSafetyEvidence: DEFAULT_EVIDENCE,
  ownerSignoffs: { ownerLaunch: 'missing', layerOwners: 'missing' },
  publicLaunchFacts: BLOCKED_PUBLIC_FACTS,
};

export function buildPromptEnhancementB5_3ReleaseCheckPacketV1(
  input: Partial<PromptEnhancementB5_3ReleaseCheckInputV1> = {},
): PromptEnhancementB5_3ReleaseCheckPacketV1 {
  const merged: PromptEnhancementB5_3ReleaseCheckInputV1 = {
    ...DEFAULT_INPUT,
    ...input,
    buildTestImportEvidence: input.buildTestImportEvidence ?? DEFAULT_INPUT.buildTestImportEvidence,
    publicSafetyEvidence: input.publicSafetyEvidence ?? DEFAULT_INPUT.publicSafetyEvidence,
    ownerSignoffs: input.ownerSignoffs ?? DEFAULT_INPUT.ownerSignoffs,
    publicLaunchFacts: input.publicLaunchFacts ?? DEFAULT_INPUT.publicLaunchFacts,
  };
  const publicLaunchPacket = buildPromptEnhancementPublicLaunchRecheckPacketV1(merged.publicLaunchFacts);
  const reasonCodes: string[] = [];
  if (!merged.approvedFinalPrivateRevision) reasonCodes.push('approved_final_private_revision_missing');
  if (merged.publicGoingInventory.length === 0) reasonCodes.push('public_going_inventory_missing');
  if (merged.confidentialityG8ScopeApproval !== 'approved') reasonCodes.push('confidentiality_g8_scope_not_approved');
  if (!merged.depB501EvidenceRevision) reasonCodes.push('dep_b5_01_evidence_revision_missing');
  if (merged.buildTestImportEvidence.state !== 'pass') reasonCodes.push('build_test_import_evidence_missing_or_unpassed');
  if (merged.publicSafetyEvidence.state !== 'pass') reasonCodes.push('public_safety_evidence_missing_or_unpassed');
  if (merged.ownerSignoffs.ownerLaunch !== 'approved') reasonCodes.push('launch_signoff_missing');
  if (merged.ownerSignoffs.layerOwners !== 'approved') reasonCodes.push('layer_owner_signoff_missing');
  if (!publicLaunchPacket.publicPromotionAllowed) reasonCodes.push('public_launch_recheck_not_ready');
  const hardFail = publicLaunchPacket.status === 'blocked_by_public_launch_hard_fail';

  return {
    packetId: 'stage-5-3-release-check-evidence-packet-v1',
    status: hardFail ? 'blocked_by_public_launch_hard_fail' : reasonCodes.length === 0 ? 'ready_for_owner_review' : 'blocked_pending_release_evidence',
    readinessClaimAllowed: false,
    observedPrivateRevision: merged.observedPrivateRevision,
    approvedFinalPrivateRevision: merged.approvedFinalPrivateRevision,
    publicGoingInventory: merged.publicGoingInventory,
    confidentialityG8ScopeApproval: merged.confidentialityG8ScopeApproval,
    depB501EvidenceRevision: merged.depB501EvidenceRevision,
    buildTestImportEvidence: merged.buildTestImportEvidence,
    publicSafetyEvidence: merged.publicSafetyEvidence,
    ownerSignoffs: merged.ownerSignoffs,
    publicLaunchPacket,
    requiredFocus: PROMPT_ENHANCEMENT_PUBLIC_LAUNCH_REQUIRED_FOCUS_V1,
    boundaryMutationAllowed: false,
    publicLaunchMutationAllowed: false,
    reasonCodes,
  };
}
