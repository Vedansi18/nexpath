import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PROMPT_ENHANCEMENT_CONTRACT_VERSION,
  type PromptEnhancementPrepareRequestV1,
  type PromptEnhancementSourceRefV1,
} from './contracts.js';
import { buildPromptEnhancementCostVisibilityMetadataV1 } from './cost-observability.js';
import { getPromptStartStopSourceSnapshot } from './source-reality.js';

// ---------------------------------------------------------------------------
// Send-block fix (2026-08-07) — actions must never re-decide popup existence.
//
// Live bug (Windows report, reproduced on Linux): a prompt the deterministic router soft-skips
// routes ONLY via the E6 LLM route-rescue at prepare — the popup appears. Every popup action
// (Enter-send, Shorter, More thorough…) re-ran the FULL prepare pipeline including routing, and
// the rescue is gated to prepare — so the action re-prepare "un-routed" the open popup:
//   - Enter (use_current_body) → failed_keep_previous [invalid_action_result, missing_body_plan]
//     → the (now removed) "That adjustment could not be applied" line → the approved prompt was
//     UNSENDABLE.
//   - Shorter / More thorough → accepted but no-popup-shaped result → the popup CLOSED silently.
// F1 pins popup existence for action requests (safety validation unchanged); F2 sends an
// unedited approved body directly; F5 removes the failure line (silent keep-previous);
// F3 routes failure reason codes to a diagnostics sink.
// The LLM route-decider and composer are mocked — this suite never performs network calls.
// ---------------------------------------------------------------------------

// The live shape: nexpath's own enhanced output fed back as the prompt (meta text the keyword
// router cannot route).
const FED_BACK_PROMPT = [
  'this one you just got in the stop hook is exactly the output from my system of ehanced prompt. so you got one from my system already.',
  '',
  'My original request (verbatim):',
  'Rebuild project memory after power outage.',
  '',
  'Context And Constraints:',
  '- Carry forward relevant constraints, limits, environment facts, and user instructions that affect the work.',
].join('\n');

vi.mock('./llm-route-decision.js', () => ({
  decidePromptEnhancementRouteViaLlmV1: vi.fn(async () => ({
    familyId: 'issue_debug',
    primaryIntent: 'issue_debug.integration_api_failure',
    capabilities: [],
    ambiguityState: 'clear',
  })),
}));
// The LLM composer never runs in this suite (deterministic wording path).
vi.mock('./llm-composer.js', () => ({
  composeStructuredComposerOutputV1: vi.fn(async () => ({ ok: false as const, reason: 'no_key' as const })),
}));

function request(text: string): PromptEnhancementPrepareRequestV1 {
  const sourceRef: PromptEnhancementSourceRefV1 = {
    sourceRefId: 'src-a-1', sourceKind: 'source_a_user_prompt', sourceId: 'prompt:1',
    sourceAuthorization: 'source_fact_only', evidenceStatus: 'present', freshness: 'current', confidence: 'high', privacyClass: 'public_safe',
  };
  const p = getPromptStartStopSourceSnapshot();
  return {
    schemaVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION, requestId: 'act-route-1', projectRoot: '/tmp/act-route', hostSurface: 'cli_stop_bridge',
    sourcePrompt: { text, origin: 'user', capturedAt: 1, promptIndex: 1, generatedOriginPolicy: 'ordinary_source_a' },
    reviewMomentContext: { reviewMoment: 'UserPromptSubmit_preparation', currentAgentMode: 'workspace-write', projectId: 'p1', sessionId: 's1', detectedLanguage: 'en', stageCandidate: 'implementation', promptCount: 1, recentPromptMetadataRefs: [], triggerProvenance: { currentStage: 'implementation', prevStage: 'task_breakdown', triggerKind: 'stage_transition', classifierState: 'fire_recommended', degradedNoActionState: 'none', promptStartBoundary: p.hookBoundary, deliveryBoundary: p.deliveryBoundary, promptStartCanReplaceSameTurn: false } },
    sourceSignals: { sourceAOriginalPromptRef: sourceRef, sourceRefs: [sourceRef], normalizedStageAbsenceSignalRefs: [], contentTemplateRecordFactRefs: [], popupQuestionSourceRefs: [], whyHelpSourceRefs: [], profileRoleModeRefs: [], rightGoodWorkStyleEnvRuntimeRefs: [], missingMemoryCandidateRefs: [], sourceLabels: [{ sourceRefId: sourceRef.sourceRefId, label: 'original_prompt', evidenceStatus: 'present' }], promptStartStop: { hookBoundary: p.hookBoundary, deliveryBoundary: p.deliveryBoundary, runAutoCanHoldOrReplaceSubmittedPrompt: false, sharedSignalCount: p.sharedSignalCount, classifierDegradedNoFireReasons: p.classifierDegradedNoFireReasons }, store: { schemaVersion: 1, missingPromptEnhancementTables: [], cleanupGaps: [] }, transcriptPathState: 'not_authority', streamBOutputs: [], paramEventChannels: [], servedVariantIdentityRefs: [], deliveryGateRefs: [], sourceOnlyHardFactRefs: [] },
    userPreferenceContext: { levelState: 'default', scopedFeedbackEvidenceRefs: [] },
    configSnapshot: { sequenceEnabledState: 'not_enabled_v1', validatedEffectiveConfigState: 'valid', arbitraryConfigRowsAreAuthority: false },
    callVisibilityState: buildPromptEnhancementCostVisibilityMetadataV1('baseline_pe_composer', { callVisibilityMode: 'deterministic', plannedCallCount: 0, usedCallCount: 0 }),
    privacyAndStoragePolicy: { sensitivityClass: 'normal', localStorageEligibility: 'ids_and_categories_only', telemetryEligibility: 'allowlisted_counts_only', llmSharingEligibility: 'allowed_minimal', generatedBodyStoragePolicy: 'do_not_store_raw_by_default' },
  };
}

describe('PE actions never re-decide popup existence (send-block fix 2026-08-07)', () => {
  const savedKey = process.env['OPENAI_API_KEY'];
  beforeEach(() => {
    // Format-valid fake key so the E6 rescue gate opens (the decider is mocked — no network).
    process.env['OPENAI_API_KEY'] = `sk-${'a'.repeat(24)}`;
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env['OPENAI_API_KEY'];
    else process.env['OPENAI_API_KEY'] = savedKey;
  });

  async function rescuedPrepared() {
    const { preparePromptEnhancement } = await import('./facade.js');
    const req = request(FED_BACK_PROMPT);
    const result = await preparePromptEnhancement(req);
    expect(result.disposition).toBe('show_current_body'); // routed only via the (mocked) rescue
    return { req, result };
  }

  async function runAction(req: PromptEnhancementPrepareRequestV1, result: Awaited<ReturnType<typeof rescuedPrepared>>['result'], actionType: string) {
    const { applyPromptEnhancementAction } = await import('./facade.js');
    const { buildPromptEnhancementPopupRenderModelV1 } = await import('./popup-render-model.js');
    const { buildPromptEnhancementActionAdapterStateV1, executePromptEnhancementActionV1 } = await import('./action-adapter.js');
    const rendered = buildPromptEnhancementPopupRenderModelV1({ result, timestampMs: Date.now(), deliverySurface: result.delivery.deliveryChannel });
    expect(rendered.state).toBe('render_model_ready');
    if (rendered.state !== 'render_model_ready') throw new Error('unreachable');
    const model = rendered.model;
    const action = model.controls.currentBody.actionType === actionType
      ? model.controls.currentBody
      : model.controls.directional.find((entry) => entry.action.actionType === actionType)?.action;
    expect(action?.availability).toBe('available');
    const execution = await executePromptEnhancementActionV1({
      adapterState: buildPromptEnhancementActionAdapterStateV1(model.session),
      baseRequest: req,
      action: action!,
      editedBodyText: model.body.text,
      timestampMs: Date.now(),
      // The popup loop passes the prepared route (result.routeDecision) with every action.
      routeCarryover: { familyId: result.routeDecision.familyId, primaryIntent: result.routeDecision.primaryIntent },
      facade: applyPromptEnhancementAction,
    });
    return { execution, buildPromptEnhancementPopupRenderModelV1 };
  }

  it('Enter-send (use_current_body) on a rescue-routed prompt is ACCEPTED and renderable (was invalid_action_result/missing_body_plan)', async () => {
    const { req, result } = await rescuedPrepared();
    const { execution, buildPromptEnhancementPopupRenderModelV1 } = await runAction(req, result, 'use_current_body');
    expect(execution.state).toBe('accepted_result');
    if (execution.state !== 'accepted_result') return;
    expect(execution.result.disposition).not.toBe('no_popup_not_applicable');
    const back = buildPromptEnhancementPopupRenderModelV1({ result: execution.result, timestampMs: Date.now(), deliverySurface: execution.result.delivery.deliveryChannel });
    expect(back.state).toBe('render_model_ready');
  });

  it('a directional action (shorter) on a rescue-routed prompt stays renderable (was a silent popup close)', async () => {
    const { req, result } = await rescuedPrepared();
    const { execution, buildPromptEnhancementPopupRenderModelV1 } = await runAction(req, result, 'shorter');
    expect(execution.state).toBe('accepted_result');
    if (execution.state !== 'accepted_result') return;
    expect(execution.result.disposition).not.toBe('no_popup_not_applicable');
    const back = buildPromptEnhancementPopupRenderModelV1({ result: execution.result, timestampMs: Date.now(), deliverySurface: execution.result.delivery.deliveryChannel });
    expect(back.state).toBe('render_model_ready');
  });

  it('F2: Enter on an UNEDITED approved body sends that exact body directly — even if the action engine were broken', async () => {
    const { req, result } = await rescuedPrepared();
    const { runPromptEnhancementCliSubmitPopupV1 } = await import('./cli-submit-popup.js');
    const views: unknown[] = [];
    const outcome = await runPromptEnhancementCliSubmitPopupV1({
      request: { ...req, sourcePrompt: { ...req.sourcePrompt, text: '' } } as typeof req, // a broken base request cannot matter: the direct path never calls the engine
      result,
      interaction: {
        async next(view: { editedBodyText: string }) {
          views.push(view);
          return { type: 'use_current' as const };
        },
        close() { /* noop */ },
      },
    });
    expect(outcome.state).toBe('selected_current');
    if (outcome.state === 'selected_current') {
      expect(outcome.bodyText).toBe((views[0] as { editedBodyText: string }).editedBodyText);
      expect(outcome.bodyText.length).toBeGreaterThan(0);
    }
  });

  it('F5: a failed action shows NO notice — the popup keeps the previous prompt silently and reports codes to the sink', async () => {
    const { req, result } = await rescuedPrepared();
    const { runPromptEnhancementCliSubmitPopupV1 } = await import('./cli-submit-popup.js');
    const sinkEvents: { actionType: string; state: string; reasonCodes: readonly string[] }[] = [];
    const commands = [
      { type: 'go_back' as const },      // no refinement is active -> previously noticed, now silent no-op
      { type: 'edit_body' as const, text: '   ' }, // rejected edit -> silent, previous body kept
      { type: 'close' as const },
    ];
    const notices: (string | undefined)[] = [];
    const outcome = await runPromptEnhancementCliSubmitPopupV1({
      request: req,
      result,
      interaction: {
        async next(view: { publicNotice?: string }) {
          notices.push(view.publicNotice);
          return commands.shift()!;
        },
        close() { /* noop */ },
      },
      actionDiagnosticsSink: (event) => sinkEvents.push(event),
    });
    expect(outcome.state).toBe('closed_no_send');
    // The removed failure line never appears — and no substitute notice either.
    for (const notice of notices) {
      expect(notice ?? '').not.toContain('could not be applied');
    }
    // The rejected edit was reported to the diagnostics sink (typed codes only).
    expect(sinkEvents.some((event) => event.actionType === 'edit_body' && event.state === 'rejected_empty_or_uneditable')).toBe(true);
  });
});
