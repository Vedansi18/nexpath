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
import { runPromptEnhancementCliMpsFirstPopupV1, buildPromptEnhancementMpsCancelFeedbackEventV1 } from './cli-mps-run.js';
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

function scripted(keys: readonly string[]): {
  next(frame: string, cursor?: { row: number; col: number } | null): Promise<string>;
  close(): void;
  frames: string[];
  cursors: ({ row: number; col: number } | null)[];
} {
  const queue = [...keys];
  const frames: string[] = [];
  const cursors: ({ row: number; col: number } | null)[] = [];
  return {
    frames,
    cursors,
    async next(frame, cursor) {
      frames.push(frame);
      cursors.push(cursor ?? null);
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
    // The hardware cursor is placed in the focused editable body on open (owner request): the
    // body opens at the TOP with the caret on its first content line, at column 7.
    expect(ui.cursors[0]).not.toBeNull();
    expect(ui.cursors[0]!.col).toBe(7);
    expect(ui.cursors[0]!.row).toBeGreaterThan(1);
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

  it('Cancel opens the PEF feedback popup and ends the flow as cancelled — never the PE popup (owner request)', async () => {
    const result = await preparePromptEnhancement(request(MULTI_INTENT));
    // Down×2 -> Cancel; Enter -> the PEF feedback popup opens; Esc skips feedback -> cancelled.
    const ui = scripted([KEY.down, KEY.down, KEY.enter, KEY.escape]);
    const outcome = await runPromptEnhancementCliMpsFirstPopupV1({ result, interaction: ui });
    expect(outcome.state).toBe('cancelled');
    if (outcome.state === 'cancelled') expect(outcome.feedback).toBeUndefined();
    // The frame painted after Enter-on-Cancel is the PEF feedback popup, not the PE popup.
    expect(ui.frames[ui.frames.length - 1]).toContain('Prompt enhancement feedback');
    expect(ui.frames[ui.frames.length - 1]).toContain('Not relevant enough');
  });

  it('Cancel -> feedback reason submitted -> cancelled WITH the typed feedback, and it builds a valid PEF event', async () => {
    const result = await preparePromptEnhancement(request(MULTI_INTENT));
    // Enter on Cancel opens feedback; Enter on the first reason submits it.
    const outcome = await runPromptEnhancementCliMpsFirstPopupV1({
      result,
      interaction: scripted([KEY.down, KEY.down, KEY.enter, KEY.enter]),
    });
    expect(outcome.state).toBe('cancelled');
    if (outcome.state !== 'cancelled') return;
    expect(outcome.feedback).toEqual({ kind: 'suggested', category: 'not_relevant_enough' });
    // The caller records it through the SAME typed PEF event chain the PE popup uses.
    const event = buildPromptEnhancementMpsCancelFeedbackEventV1(result, outcome.feedback!, Date.now());
    expect(event).not.toBeNull();
    expect(event!.eventType).toBe('explicit_feedback');
    expect(event!.feedbackCategory).toBe('not_relevant_enough');
  });

  it('Additional details: Enter APPLIES the details into the enhanced sequence prompt (PE parity) — then Enter on the body sends the merged prompt', async () => {
    const result = await preparePromptEnhancement(request(MULTI_INTENT));
    // down -> details row; type; Enter -> APPLY (popup stays open, focus returns to the body);
    // Enter again -> send the merged body.
    const ui = scripted([KEY.down, 'u', 's', 'e', ' ', 'p', 'g', KEY.enter, KEY.enter]);
    const outcome = await runPromptEnhancementCliMpsFirstPopupV1({ result, interaction: ui });
    expect(outcome.state).toBe('send');
    if (outcome.state === 'send') {
      expect(outcome.bodyText).toContain('Additional details to incorporate:\nuse pg');
      expect(outcome.bodyText).toContain('Fix the failing payment test');
    }
    // The apply did NOT send — a further frame was painted after it (the merged-body view),
    // and the details field is empty again on that frame (the text moved into the body).
    const afterApply = ui.frames[ui.frames.length - 1]!;
    expect(afterApply).toContain('Additional details to incorporate:');
    expect(afterApply).toContain('Enter applies these details · unapplied details are not sent');
  });

  it('UNAPPLIED details are not sent: typing details and sending from the body row sends the body only (PE parity)', async () => {
    const result = await preparePromptEnhancement(request(MULTI_INTENT));
    const outcome = await runPromptEnhancementCliMpsFirstPopupV1({
      result,
      interaction: scripted([KEY.down, 'z', 'z', KEY.up, KEY.enter]),
    });
    expect(outcome.state).toBe('send');
    if (outcome.state === 'send') {
      expect(outcome.bodyText).not.toContain('zz');
      expect(outcome.bodyText).toContain('Fix the failing payment test');
    }
  });

  it('details helpers (PE parity, owner request 2026-08-07): apply-hint always visible; focusing the row adds the short help', async () => {
    const result = await preparePromptEnhancement(request(MULTI_INTENT));
    const ui = scripted([KEY.down, KEY.escape]);
    await runPromptEnhancementCliMpsFirstPopupV1({ result, interaction: ui });
    // Frame 0 (body focused): the apply hint is visible, the focused-only help is not.
    expect(ui.frames[0]).toContain('Enter applies these details · unapplied details are not sent');
    expect(ui.frames[0]).not.toContain('Add extra requirement');
    // Frame 1 (details focused): the short help appears, like the PE popup.
    expect(ui.frames[1]).toContain('Add extra requirement');
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
