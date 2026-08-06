import { describe, expect, it } from 'vitest';
import {
  buildPromptEnhancementB5_3ReleaseCheckPacketV1,
  type PromptEnhancementB5_3ReleaseCheckInputV1,
} from './b5-3-release-check-packet.js';

const approvedFacts: PromptEnhancementB5_3ReleaseCheckInputV1 = {
  observedPrivateRevision: 'ae17793',
  approvedFinalPrivateRevision: 'ae17793',
  publicGoingInventory: ['src/prompt-enhancement/public-launch-recheck.ts'],
  peCr5G8ScopeApproval: 'approved',
  depB501EvidenceRevision: '6b74b3f',
  buildTestImportEvidence: {
    state: 'pass', revision: 'ae17793', command: 'npm run build && npx vitest run src/prompt-enhancement',
    output: 'build and full PE suite passed', owner: 'release_check', unresolved: null,
  },
  publicSafetyEvidence: {
    state: 'pass', revision: 'ae17793', command: 'private-boundary scan',
    output: 'no forbidden public findings', owner: 'release_check', unresolved: null,
  },
  ownerSignoffs: { hirenLaunch: 'approved', layerOwners: 'approved' },
  publicLaunchFacts: {
    projectRoot: '/approved-recheck',
    gitignoreText: 'src/prompt-enhancement/\nsrc/ext-vscode/prebuilds/\n',
    trackedFiles: ['src/prompt-enhancement/public-launch-recheck.ts'],
    checkIgnoredPaths: ['src/prompt-enhancement', 'src/ext-vscode/prebuilds'],
    promptEnhancementPathExists: true,
    promptEnhancementNestedGitExists: false,
    nestedGitRemoveOnlyProcedureApproved: true,
    pathRewriteRequested: false,
    packageJsonText: '{"scripts":{"build":"tsc","test":"vitest run"}}',
    tsconfigText: '{"include":["src/**/*"],"exclude":["node_modules","dist","src/ext-vscode"]}',
    publicGoingFileTexts: [{ path: 'src/prompt-enhancement/public-launch-recheck.ts', text: 'export const publicSafe = true;' }],
    ownerLaunchDecision: 'approved_public_promotion',
  },
};

describe('B5.3 release-check evidence packet', () => {
  it('keeps the current private boundary and missing release evidence blocked', () => {
    const packet = buildPromptEnhancementB5_3ReleaseCheckPacketV1();

    expect(packet.status).toBe('blocked_by_public_launch_hard_fail');
    expect(packet.readinessClaimAllowed).toBe(false);
    expect(packet.observedPrivateRevision).toBe('ae17793');
    expect(packet.approvedFinalPrivateRevision).toBeNull();
    expect(packet.publicLaunchPacket.publicPromotionAllowed).toBe(false);
    expect(packet.boundaryMutationAllowed).toBe(false);
    expect(packet.publicLaunchMutationAllowed).toBe(false);
    expect(packet.reasonCodes).toEqual(expect.arrayContaining([
      'approved_final_private_revision_missing',
      'pe_cr5_g8_scope_not_approved',
      'public_launch_recheck_not_ready',
    ]));
  });

  it('accepts a complete evidence packet only for owner review, never as automatic GO', () => {
    const packet = buildPromptEnhancementB5_3ReleaseCheckPacketV1(approvedFacts);

    expect(packet.status).toBe('ready_for_owner_review');
    expect(packet.reasonCodes).toEqual([]);
    expect(packet.publicLaunchPacket.publicPromotionAllowed).toBe(true);
    expect(packet.readinessClaimAllowed).toBe(false);
    expect(packet.publicGoingInventory).toEqual(['src/prompt-enhancement/public-launch-recheck.ts']);
  });

  it('hard-blocks contradictory path or nested-git facts without mutating them', () => {
    const packet = buildPromptEnhancementB5_3ReleaseCheckPacketV1({
      ...approvedFacts,
      publicLaunchFacts: {
        ...approvedFacts.publicLaunchFacts,
        promptEnhancementNestedGitExists: true,
        nestedGitRemoveOnlyProcedureApproved: false,
        pathRewriteRequested: true,
      },
    });

    expect(packet.status).toBe('blocked_by_public_launch_hard_fail');
    expect(packet.publicLaunchPacket.publicPromotionAllowed).toBe(false);
    expect(packet.publicLaunchPacket.removeOnlyBoundary).toEqual({
      nestedGitPresent: true,
      removalProcedureApproved: false,
      pathRewriteAllowed: false,
    });
    expect(packet.boundaryMutationAllowed).toBe(false);
  });
});
