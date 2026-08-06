import { describe, expect, it } from 'vitest';
import {
  PROMPT_ENHANCEMENT_CONTRACT_VERSION,
  type PromptEnhancementPrepareRequestV1,
  type PromptEnhancementSourceRefV1,
} from './contracts.js';
import { buildPromptEnhancementCostVisibilityMetadataV1 } from './cost-observability.js';
import { preparePromptEnhancement } from './facade.js';
import { getPromptStartStopSourceSnapshot } from './source-reality.js';
import { evaluatePromptEnhancementMpsIntakeDecisionV1 } from './intake-decision.js';
import { buildPromptEnhancementCliMpsIntakeEvidenceV1 } from './cli-mps-intake-evidence.js';
import { runPromptEnhancementCliMpsFirstPopupV1 } from './cli-mps-run.js';
import { isPromptEnhancementSequenceShapedTextV1 } from './routing-taxonomy.js';

const MULTI_INTENT = 'Fix the failing payment test and add a rate limiter to the login endpoint.';
const SINGLE_INTENT = 'Fix the failing payment test.';

function request(text: string): PromptEnhancementPrepareRequestV1 {
  const sourceRef: PromptEnhancementSourceRefV1 = {
    sourceRefId: 'src-a-1', sourceKind: 'source_a_user_prompt', sourceId: 'prompt:1',
    sourceAuthorization: 'source_fact_only', evidenceStatus: 'present', freshness: 'current', confidence: 'high', privacyClass: 'public_safe',
  };
  const p = getPromptStartStopSourceSnapshot();
  return {
    schemaVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION, requestId: 'mps-wire-1', projectRoot: '/tmp/mps-wire', hostSurface: 'cli_stop_bridge',
    sourcePrompt: { text, origin: 'user', capturedAt: 1, promptIndex: 1, generatedOriginPolicy: 'ordinary_source_a' },
    reviewMomentContext: { reviewMoment: 'UserPromptSubmit_preparation', currentAgentMode: 'workspace-write', projectId: 'p1', sessionId: 's1', detectedLanguage: 'en', stageCandidate: 'implementation', promptCount: 1, recentPromptMetadataRefs: [], triggerProvenance: { currentStage: 'implementation', prevStage: 'task_breakdown', triggerKind: 'stage_transition', classifierState: 'fire_recommended', degradedNoActionState: 'none', promptStartBoundary: p.hookBoundary, deliveryBoundary: p.deliveryBoundary, promptStartCanReplaceSameTurn: false } },
    sourceSignals: { sourceAOriginalPromptRef: sourceRef, sourceRefs: [sourceRef], normalizedStageAbsenceSignalRefs: [], contentTemplateRecordFactRefs: [], popupQuestionSourceRefs: [], whyHelpSourceRefs: [], profileRoleModeRefs: [], rightGoodWorkStyleEnvRuntimeRefs: [], missingMemoryCandidateRefs: [], sourceLabels: [{ sourceRefId: sourceRef.sourceRefId, label: 'original_prompt', evidenceStatus: 'present' }], promptStartStop: { hookBoundary: p.hookBoundary, deliveryBoundary: p.deliveryBoundary, runAutoCanHoldOrReplaceSubmittedPrompt: false, sharedSignalCount: p.sharedSignalCount, classifierDegradedNoFireReasons: p.classifierDegradedNoFireReasons }, store: { schemaVersion: 1, missingPromptEnhancementTables: [], cleanupGaps: [] }, transcriptPathState: 'not_authority', streamBOutputs: [], paramEventChannels: [], servedVariantIdentityRefs: [], deliveryGateRefs: [], sourceOnlyHardFactRefs: [] },
    userPreferenceContext: { levelState: 'default', scopedFeedbackEvidenceRefs: [] },
    configSnapshot: { sequenceEnabledState: 'not_enabled_v1', validatedEffectiveConfigState: 'valid', arbitraryConfigRowsAreAuthority: false },
    callVisibilityState: buildPromptEnhancementCostVisibilityMetadataV1('baseline_pe_composer', { callVisibilityMode: 'deterministic', plannedCallCount: 0, usedCallCount: 0 }),
    privacyAndStoragePolicy: { sensitivityClass: 'normal', localStorageEligibility: 'ids_and_categories_only', telemetryEligibility: 'allowlisted_counts_only', llmSharingEligibility: 'allowed_minimal', generatedBodyStoragePolicy: 'do_not_store_raw_by_default' },
  };
}

// Raw key sequences (the shell decodes them with the shared PE key decoder).
const KEY = { enter: '\r', escape: '', up: '[A', down: '[B' } as const;

function scripted(keys: readonly string[]): { next(frame: string): Promise<string>; close(): void; frames: string[] } {
  const queue = [...keys];
  const frames: string[] = [];
  return {
    frames,
    async next(frame) {
      frames.push(frame);
      const key = queue.shift();
      if (key === undefined) throw new Error('missing scripted key');
      return key;
    },
    close() { /* noop */ },
  };
}

describe('MPS CLI wiring (owner ruling 2026-08-06: CLI complete, extension pending)', () => {
  it('the engine emits the handoff/sequence summary for a multi-intent prompt (metadata-only)', async () => {
    const result = await preparePromptEnhancement(request(MULTI_INTENT));
    const handoff = result.uiView.handoffAndSequenceSummary;
    expect(handoff).toBeDefined();
    expect(handoff!.handoffKind).toBe('compact_sequence_summary_candidate');
    // The runtime stays policy-blocked — metadata only, never activation.
    expect(handoff!.sequenceActivationPolicy).toBe('blocked_pending_sequence_runtime_and_cost_gates');
    expect(handoff!.applicability.receiverCanActivateRuntime).toBe(false);
  });

  it('a single-intent prompt emits NO sequence summary (no MPS popup)', async () => {
    const result = await preparePromptEnhancement(request(SINGLE_INTENT));
    expect(result.uiView.handoffAndSequenceSummary).toBeUndefined();
  });

  it('a multi-POINT same-family list (>=3 points) also emits the sequence summary (script-style sequence prompt)', async () => {
    const result = await preparePromptEnhancement(request(
      'Build the whole recurring-billing flow: schema, cron job, email sender, and the dashboard widget - do it as one sequence.',
    ));
    const handoff = result.uiView.handoffAndSequenceSummary;
    expect(handoff).toBeDefined();
    expect(handoff!.handoffKind).toBe('compact_sequence_summary_candidate');
  });

  it('a plain two-part same-family prompt stays on the PE popup (no sequence summary)', async () => {
    // "add X and Y" is list-shaped but not a real multi-step sequence — MPS must not hijack it.
    const result = await preparePromptEnhancement(request('Add a tax field and a discount field to the invoice page.'));
    expect(result.uiView.handoffAndSequenceSummary).toBeUndefined();
  });

  it('the shared sequence-shape text predicate matches the facade emission rule (used by the auto fallback)', () => {
    // The UserPromptSubmit fallback uses this predicate to prepare sequence prompts on
    // NON-trigger turns — it must agree with what the facade will actually emit for.
    expect(isPromptEnhancementSequenceShapedTextV1(MULTI_INTENT)).toBe(true);
    expect(isPromptEnhancementSequenceShapedTextV1(
      'Build the whole recurring-billing flow: schema, cron job, email sender, and the dashboard widget — do it as one sequence.',
    )).toBe(true);
    expect(isPromptEnhancementSequenceShapedTextV1(SINGLE_INTENT)).toBe(false);
    expect(isPromptEnhancementSequenceShapedTextV1('Add a tax field and a discount field to the invoice page.')).toBe(false);
  });

  it('CLI surface gate PERMITS with the three non-extension evidence rows', async () => {
    const result = await preparePromptEnhancement(request(MULTI_INTENT));
    const evidence = buildPromptEnhancementCliMpsIntakeEvidenceV1(result);
    expect(evidence).toBeDefined();
    const gate = evaluatePromptEnhancementMpsIntakeDecisionV1({ surface: 'cli_stop_bridge', evidence: [...evidence!] });
    expect(gate.renderPermission).toBe('mps_render_permitted');
  });

  it('the DEFAULT (extension/global) surface stays fail-closed on the missing host evidence (Vedansi pending)', async () => {
    const result = await preparePromptEnhancement(request(MULTI_INTENT));
    const evidence = buildPromptEnhancementCliMpsIntakeEvidenceV1(result);
    const gate = evaluatePromptEnhancementMpsIntakeDecisionV1({ evidence: [...evidence!] });
    expect(gate.renderPermission).toBe('mps_blocked_fail_closed');
    expect(gate.intakePacket.missingEvidenceKinds).toContain('host_runtime');
  });

  it('MPS first popup: Enter sends the enhanced first-prompt body; the frame shows ALL locked rows', async () => {
    const result = await preparePromptEnhancement(request(MULTI_INTENT));
    const ui = scripted([KEY.enter]);
    const outcome = await runPromptEnhancementCliMpsFirstPopupV1({ result, interaction: ui });
    expect(outcome.state).toBe('send');
    if (outcome.state === 'send') {
      expect(outcome.bodyText).toContain('Fix the failing payment test');
      expect(outcome.bodyText.length).toBeGreaterThan(result.currentBody.originalPromptText.length);
    }
    // The locked §3.3 frame: header + all 3 interactive rows + dim plan + footer, in ONE frame.
    expect(ui.frames[0]).toContain('Multi-prompt sequence');
    expect(ui.frames[0]).toContain('Use enhanced sequence prompt');
    expect(ui.frames[0]).toContain('Additional details');
    expect(ui.frames[0]).toContain('Cancel (remaining multi-prompt sequence)');
    expect(ui.frames[0]).toContain('Sequence plan');
    expect(ui.frames[0]).toContain('Enter send · Esc actions');
  });

  it('no-scroll: every frame fits the reported window height (stacking regression guard)', async () => {
    const result = await preparePromptEnhancement(request(MULTI_INTENT));
    const ui = { ...scripted([KEY.down, KEY.up, KEY.enter]), size: () => ({ columns: 90, rows: 32 }) };
    const outcome = await runPromptEnhancementCliMpsFirstPopupV1({ result, interaction: ui });
    expect(outcome.state).toBe('send');
    // The body is windowed so the WHOLE frame fits the window — the render can never scroll,
    // which is what previously stacked stale frames in scrollback.
    for (const frame of ui.frames) {
      expect(frame.split('\n').length).toBeLessThanOrEqual(31);
    }
  });

  it('row navigation: Down twice focuses Cancel; Enter there declines (falls through to the PE popup)', async () => {
    const result = await preparePromptEnhancement(request(MULTI_INTENT));
    const outcome = await runPromptEnhancementCliMpsFirstPopupV1({
      result,
      interaction: scripted([KEY.down, KEY.down, KEY.enter]),
    });
    expect(outcome.state).toBe('declined');
  });

  it('Additional details: focus the field, type, Enter sends body PLUS the typed details', async () => {
    const result = await preparePromptEnhancement(request(MULTI_INTENT));
    const outcome = await runPromptEnhancementCliMpsFirstPopupV1({
      result,
      interaction: scripted([KEY.down, 'u', 's', 'e', ' ', 'p', 'g', KEY.enter]),
    });
    expect(outcome.state).toBe('send');
    if (outcome.state === 'send') {
      expect(outcome.bodyText).toContain('Additional details to incorporate:\nuse pg');
      expect(outcome.bodyText).toContain('Fix the failing payment test');
    }
  });

  it('MPS first popup: Esc declines (caller falls through to the regular PE popup)', async () => {
    const result = await preparePromptEnhancement(request(MULTI_INTENT));
    const outcome = await runPromptEnhancementCliMpsFirstPopupV1({ result, interaction: scripted([KEY.escape]) });
    expect(outcome.state).toBe('declined');
  });

  it('no handoff summary -> not_shown (single-intent result can never open MPS)', async () => {
    const result = await preparePromptEnhancement(request(SINGLE_INTENT));
    const outcome = await runPromptEnhancementCliMpsFirstPopupV1({ result, interaction: scripted([]) });
    expect(outcome.state).toBe('not_shown');
  });
});
