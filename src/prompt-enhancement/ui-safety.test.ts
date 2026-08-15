import { describe, expect, it } from 'vitest';
import { PROMPT_ENHANCEMENT_CONTRACT_VERSION, type PromptEnhancementPrepareRequestV1, type PromptEnhancementSourceRefV1 } from './contracts.js';
import { buildPromptEnhancementCostVisibilityMetadataV1 } from './cost-observability.js';
import { preparePromptEnhancement } from './facade.js';
import { buildPromptEnhancementSendIntentAdapterStateV1, buildPromptEnhancementSendIntentV1 } from './send-intent.js';
import { buildPromptEnhancementPopupLifecycleModelV1 } from './popup-lifecycle.js';
import { buildPromptEnhancementRecoveryModelV1 } from './recovery-state.js';
import { buildPromptEnhancementUiBoundarySessionV1 } from './ui-boundary.js';
import { getPromptStartStopSourceSnapshot } from './source-reality.js';
import { buildPromptEnhancementSafeUiModelV1 } from './ui-safety.js';

function request(overrides: Partial<PromptEnhancementPrepareRequestV1> = {}): PromptEnhancementPrepareRequestV1 {
  const sourceRef: PromptEnhancementSourceRefV1 = {
    sourceRefId: 'b15-source-1', sourceKind: 'source_a_user_prompt', sourceId: 'prompt:1',
    sourceAuthorization: 'source_fact_only', evidenceStatus: 'present', freshness: 'current', confidence: 'high', privacyClass: 'public_safe',
  };
  const promptStartStop = getPromptStartStopSourceSnapshot();
  return {
    schemaVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION, requestId: 'b15-test-1', projectRoot: '/tmp/project', hostSurface: 'cli_stop_bridge',
    sourcePrompt: { text: 'Fix the failing payment test and explain the verification.', origin: 'user', capturedAt: 1, promptIndex: 1, generatedOriginPolicy: 'ordinary_source_a' },
    reviewMomentContext: {
      reviewMoment: 'UserPromptSubmit_preparation', currentAgentMode: 'workspace-write', projectId: 'project-1', sessionId: 'session-1', detectedLanguage: 'en', stageCandidate: 'implementation', promptCount: 1, recentPromptMetadataRefs: [],
      triggerProvenance: { currentStage: 'implementation', prevStage: 'task_breakdown', triggerKind: 'stage_transition', classifierState: 'fire_recommended', degradedNoActionState: 'none', promptStartBoundary: promptStartStop.hookBoundary, deliveryBoundary: promptStartStop.deliveryBoundary, promptStartCanReplaceSameTurn: false },
    },
    sourceSignals: {
      sourceAOriginalPromptRef: sourceRef, sourceRefs: [sourceRef], normalizedStageAbsenceSignalRefs: [], contentTemplateRecordFactRefs: [], popupQuestionSourceRefs: [], whyHelpSourceRefs: [], profileRoleModeRefs: [], rightGoodWorkStyleEnvRuntimeRefs: [], missingMemoryCandidateRefs: [], sourceLabels: [{ sourceRefId: sourceRef.sourceRefId, label: 'original_prompt', evidenceStatus: 'present' }],
      promptStartStop: { hookBoundary: promptStartStop.hookBoundary, deliveryBoundary: promptStartStop.deliveryBoundary, runAutoCanHoldOrReplaceSubmittedPrompt: false, sharedSignalCount: promptStartStop.sharedSignalCount, classifierDegradedNoFireReasons: promptStartStop.classifierDegradedNoFireReasons },
      store: { schemaVersion: 1, missingPromptEnhancementTables: [], cleanupGaps: [] }, transcriptPathState: 'not_authority', streamBOutputs: [], paramEventChannels: [], servedVariantIdentityRefs: [], deliveryGateRefs: [], sourceOnlyHardFactRefs: [],
    },
    userPreferenceContext: { levelState: 'default', scopedFeedbackEvidenceRefs: [] }, configSnapshot: { sequenceEnabledState: 'not_enabled_v1', validatedEffectiveConfigState: 'valid', arbitraryConfigRowsAreAuthority: false },
    callVisibilityState: buildPromptEnhancementCostVisibilityMetadataV1('baseline_pe_composer', { callVisibilityMode: 'deterministic', plannedCallCount: 0, usedCallCount: 0 }),
    privacyAndStoragePolicy: { sensitivityClass: 'normal', localStorageEligibility: 'ids_and_categories_only', telemetryEligibility: 'allowlisted_counts_only', llmSharingEligibility: 'allowed_minimal', generatedBodyStoragePolicy: 'do_not_store_raw_by_default' },
    ...overrides,
  };
}

describe('stage-1-5 safe UI boundary', () => {
  it('fails closed to an error shell for invalid or stale input', () => {
    const model = buildPromptEnhancementSafeUiModelV1({ result: { body: '<script>secret</script>' }, timestampMs: 1 });
    expect(model.state).toBe('error_shell');
    expect(model.body).toBeUndefined();
    expect(model.publicCopy.stateMessage).not.toContain('script');
    expect(model.safety.generatedBodyExcluded).toBe(true);
  });

  it('keeps a valid ready body typed and exposes only public-safe controls/copy', async () => {
    const result = await preparePromptEnhancement(request());
    const model = buildPromptEnhancementSafeUiModelV1({ result, timestampMs: 2 });
    expect(model.state).toBe('ready');
    expect(model.body?.text).toContain('failing payment test');
    expect(model.body?.editable).toBe(true);
    expect(model.controls.map((control) => control.actionType)).toContain('close');
    expect(model.controls.every((control) => !('actionId' in control))).toBe(true);
    expect(model.accessibility.onePopupOnly).toBe(true);
    expect(model.accessibility.keyboardTraversalRequired).toBe(true);
  });

  it('removes generated body and controls for typed generated-origin no-popup results', async () => {
    const base = request();
    const result = await preparePromptEnhancement({ ...base, sourcePrompt: { ...base.sourcePrompt, origin: 'pe_generated_echo', generatedOriginPolicy: 'exclude_from_ordinary_learning' } });
    const model = buildPromptEnhancementSafeUiModelV1({ result, timestampMs: 2 });
    expect(model.state).toBe('no_send');
    expect(model.body).toBeUndefined();
    expect(model.controls).toEqual([]);
    expect(model.publicCopy.stateMessage).toBe('No message was sent.');
  });

  it('escapes unsafe display markup and drops private diagnostic text', async () => {
    const result = await preparePromptEnhancement(request());
    const unsafeDiagnostic = { ...result.uiView.diagnostics[0], publicSafeText: '<img src="javascript:alert(1)">' };
    const unsafe = { ...result, uiView: { ...result.uiView, diagnostics: [unsafeDiagnostic] } };
    const model = buildPromptEnhancementSafeUiModelV1({ result: unsafe, timestampMs: 2 });
    expect(model.publicCopy.diagnostics).toEqual([]);
    expect(model.publicCopy.trustCues.every((cue) => !/[<>]/.test(cue.text))).toBe(true);
    expect(model.safety.unsafeMarkupRejected).toBe(true);
  });

  it('keeps loading and retry shells stable without exposing a partial body', async () => {
    const result = await preparePromptEnhancement(request());
    const loading = buildPromptEnhancementSafeUiModelV1({ result, timestampMs: 2, sessionOverrides: { lifecycleState: 'initial_loading' } });
    const retrying = buildPromptEnhancementSafeUiModelV1({ result, timestampMs: 2, sessionOverrides: { lifecycleState: 'validation_repair' } });
    expect(loading.state).toBe('loading');
    expect(loading.body).toBeUndefined();
    expect(retrying.state).toBe('retrying');
    expect(retrying.body).toBeUndefined();
  });

  it('removes generated body for fallback, unsupported, and blocked states', async () => {
    const result = await preparePromptEnhancement(request());
    const fallback = buildPromptEnhancementSafeUiModelV1({ result, timestampMs: 2, sessionOverrides: { lifecycleState: 'fallback_current_or_original' } });
    const unsupported = buildPromptEnhancementSafeUiModelV1({ result, timestampMs: 2, sessionOverrides: { extensionCapabilityState: 'extension_fallback_non_old_copy_unavailable' } });
    const blocked = buildPromptEnhancementSafeUiModelV1({ result, timestampMs: 2, sessionOverrides: { lifecycleState: 'blocked_or_no_send_high_risk' } });
    expect(fallback.state).toBe('fallback');
    expect(unsupported.state).toBe('unsupported');
    expect(blocked.state).toBe('no_send');
    expect(fallback.body).toBeUndefined();
    expect(unsupported.body).toBeUndefined();
    expect(blocked.body).toBeUndefined();
    expect(fallback.safety.generatedBodyExcluded).toBe(true);
    expect(unsupported.safety.generatedBodyExcluded).toBe(true);
    expect(blocked.safety.generatedBodyExcluded).toBe(true);
  });

  it('keeps safe output free of action ids, source refs, and raw diagnostics', async () => {
    const result = await preparePromptEnhancement(request());
    const model = buildPromptEnhancementSafeUiModelV1({ result, timestampMs: 2 });
    expect(JSON.stringify(model.controls)).not.toContain('actionId');
    expect(JSON.stringify(model.publicCopy)).not.toContain('b15-source-1');
    expect(model.safety.privateDiagnosticsExcluded).toBe(true);
  });

  it("emits one current send intent and rejects a duplicate", async () => {
    const result = await preparePromptEnhancement(request());
    const boundary = buildPromptEnhancementUiBoundarySessionV1({ result, timestampMs: 2 });
    expect(boundary.state).toBe("session_ready");
    if (boundary.state === "no_popup") return;
    const action = result.uiView.actions.find((entry) => entry.actionType === "use_current_body");
    if (action === undefined) throw new Error("missing current action fixture");
    const event = { session: boundary.session, eventType: "deliver_current_body" as const, actionId: action.actionId, currentBodyId: boundary.session.currentBodyId, bodyRevision: boundary.session.bodyRevision, editedBodyText: boundary.session.currentBodyText, timestampMs: 3, realUserInitiated: true as const };
    const first = buildPromptEnhancementSendIntentV1({ adapterState: buildPromptEnhancementSendIntentAdapterStateV1(), event, editedBodyText: boundary.session.currentBodyText, additionalDetailsText: "keep the verification concise" });
    expect(first.state).toBe("intent_ready");
    if (first.state === "no_intent") return;
    expect(first.intent.intentType).toBe("send_current");
    expect(first.intent.additionalDetailsBodyRevision).toBe(boundary.session.bodyRevision);
    const duplicate = buildPromptEnhancementSendIntentV1({ adapterState: first.adapterState, event, editedBodyText: boundary.session.currentBodyText });
    expect(duplicate.state).toBe("no_intent");
    expect(duplicate.reasonCodes).toContain("duplicate_send_intent");
  });

  it("keeps original intent separate and rejects stale or close events", async () => {
    const result = await preparePromptEnhancement(request());
    const boundary = buildPromptEnhancementUiBoundarySessionV1({ result, timestampMs: 2 });
    expect(boundary.state).toBe("session_ready");
    if (boundary.state === "no_popup") return;
    const originalAction = result.uiView.actions.find((entry) => entry.actionType === "use_original");
    if (originalAction === undefined) throw new Error("missing original action fixture");
    const original = buildPromptEnhancementSendIntentV1({ adapterState: buildPromptEnhancementSendIntentAdapterStateV1(), event: { session: boundary.session, eventType: "use_original", actionId: originalAction.actionId, currentBodyId: boundary.session.currentBodyId, bodyRevision: boundary.session.bodyRevision, timestampMs: 4, realUserInitiated: true }, originalPromptText: result.currentBody.originalPromptText });
    expect(original.state).toBe("intent_ready");
    if (original.state === "no_intent") return;
    expect(original.intent.intentType).toBe("send_original");
    const stale = buildPromptEnhancementSendIntentV1({ adapterState: buildPromptEnhancementSendIntentAdapterStateV1(), event: { session: boundary.session, eventType: "deliver_current_body", actionId: originalAction.actionId, currentBodyId: boundary.session.currentBodyId, bodyRevision: boundary.session.bodyRevision + 1, timestampMs: 5, realUserInitiated: true }, editedBodyText: boundary.session.currentBodyText });
    expect(stale.state).toBe("no_intent");
    expect(stale.reasonCodes).toContain("stale_or_mismatched_send_identity");
    const close = buildPromptEnhancementSendIntentV1({ adapterState: buildPromptEnhancementSendIntentAdapterStateV1(), event: { session: boundary.session, eventType: "close_no_send", actionId: boundary.session.closeActionId, currentBodyId: boundary.session.currentBodyId, bodyRevision: boundary.session.bodyRevision, timestampMs: 6, realUserInitiated: true } });
    expect(close.state).toBe("no_intent");
    expect(close.reasonCodes).toContain("event_is_not_send_intent");
  });
  it("projects typed no-popup results to a closed, non-interactive surface", async () => {
    const base = request();
    const result = await preparePromptEnhancement({ ...base, sourcePrompt: { ...base.sourcePrompt, origin: "pe_generated_echo", generatedOriginPolicy: "exclude_from_ordinary_learning" } });
    const model = buildPromptEnhancementPopupLifecycleModelV1({ result, timestampMs: 2 });
    expect(model.state).toBe("closed");
    expect(model.surface).toBe("none");
    expect(model.permittedActionTypes).toEqual([]);
    expect(model.events.sendIntent).toBe("none");
    expect(model.exposure).toBe("not_counted");
    expect(model.reasonCodes).toContain("typed_no_popup");
  });

  it("projects lifecycle states and keeps send controls typed-only", async () => {
    const result = await preparePromptEnhancement(request());
    const ready = buildPromptEnhancementPopupLifecycleModelV1({ result, timestampMs: 2, sessionOverrides: { visibleSurfaceAckState: "pe_body_visible" } });
    expect(ready.state).toBe("ready");
    expect(ready.surface).toBe("one_popup");
    expect(ready.bodyVisible).toBe(true);
    expect(ready.events.sendIntent).toBe("typed_control_only");
    expect(ready.exposure).toBe("count_after_visible_ack");

    const loading = buildPromptEnhancementPopupLifecycleModelV1({ result, timestampMs: 2, sessionOverrides: { lifecycleState: "initial_loading", popupArbitrationState: "pe_popup_shown_acknowledged" } });
    expect(loading.state).toBe("loading");
    expect(loading.bodyVisible).toBe(false);
    expect(loading.events.sendIntent).toBe("none");

    const fallback = buildPromptEnhancementPopupLifecycleModelV1({ result, timestampMs: 2, sessionOverrides: { lifecycleState: "fallback_current_or_original", popupArbitrationState: "pe_popup_shown_acknowledged" } });
    expect(fallback.state).toBe("fallback");
    expect(fallback.bodyVisible).toBe(true);
    expect(fallback.events.sendIntent).toBe("typed_control_only");

    const deferred = buildPromptEnhancementPopupLifecycleModelV1({ result, timestampMs: 2, sessionOverrides: { popupArbitrationState: "pe_review_priority_product_feedback_waits" } });
    expect(deferred.state).toBe("deferred");
    expect(deferred.events.sendIntent).toBe("none");

    const blocked = buildPromptEnhancementPopupLifecycleModelV1({ result, timestampMs: 2, sessionOverrides: { lifecycleState: "blocked_or_no_send_high_risk", popupArbitrationState: "pe_popup_shown_acknowledged" } });
    expect(blocked.state).toBe("blocked_no_send");
    expect(blocked.events.sendIntent).toBe("none");

    const unavailable = buildPromptEnhancementPopupLifecycleModelV1({ result, timestampMs: 2, sessionOverrides: { extensionCapabilityState: "extension_fallback_non_old_copy_unavailable" } });
    expect(unavailable.state).toBe("unavailable");
    expect(unavailable.surface).toBe("one_popup");
    expect(unavailable.events.sendIntent).toBe("none");
  });

  it("keeps invalid and no-popup outcomes no-send", async () => {
    const invalid = buildPromptEnhancementRecoveryModelV1({ result: { raw: "private" }, timestampMs: 2 });
    expect(invalid.state).toBe("stale_invalid");
    expect(invalid.surface).toBe("none");
    expect(invalid.events.sendIntent).toBe("none");
    expect(invalid.publicMessage).not.toContain("private");

    const base = request();
    const noPopupResult = await preparePromptEnhancement({ ...base, sourcePrompt: { ...base.sourcePrompt, origin: "pe_generated_echo", generatedOriginPolicy: "exclude_from_ordinary_learning" } });
    const noPopup = buildPromptEnhancementRecoveryModelV1({ result: noPopupResult, timestampMs: 2 });
    expect(noPopup.state).toBe("cancelled_no_send");
    expect(noPopup.events.cancel).toBe("none");
    expect(noPopup.events.sendIntent).toBe("none");
  });

  it("projects fallback, retry, blocked, and unsupported recovery without body or auto-send", async () => {
    const result = await preparePromptEnhancement(request());
    const fallback = buildPromptEnhancementRecoveryModelV1({ result, timestampMs: 2, sessionOverrides: { lifecycleState: "fallback_current_or_original", popupArbitrationState: "pe_popup_shown_acknowledged" } });
    expect(fallback.state).toBe("fallback_explicit_choice");
    expect(fallback.bodyExposure).toBe("not_exposed");
    expect(fallback.preservedState).toBe("identity_only");
    expect(fallback.events.sendIntent).toBe("none");
    expect(fallback.events.fallbackSelection).toBe("typed_control_only");
    expect(fallback.permittedActionTypes).toContain("use_original");

    const retry = buildPromptEnhancementRecoveryModelV1({ result, timestampMs: 2, sessionOverrides: { visibleSurfaceAckState: "render_failure", popupArbitrationState: "pe_popup_shown_acknowledged" } });
    expect(retry.state).toBe("retryable_failure");
    expect(retry.events.retry).toBe("none");
    expect(retry.events.sendIntent).toBe("none");

    const blocked = buildPromptEnhancementRecoveryModelV1({ result, timestampMs: 2, sessionOverrides: { lifecycleState: "blocked_or_no_send_high_risk", popupArbitrationState: "pe_popup_shown_acknowledged" } });
    expect(blocked.state).toBe("blocked_no_send");
    expect(blocked.events.cancel).toBe("typed_control_only");
    expect(blocked.events.sendIntent).toBe("none");

    const unsupported = buildPromptEnhancementRecoveryModelV1({ result, timestampMs: 2, sessionOverrides: { extensionCapabilityState: "extension_fallback_non_old_copy_unavailable" } });
    expect(unsupported.state).toBe("unsupported");
    expect(unsupported.surface).toBe("one_popup");
    expect(unsupported.events.sendIntent).toBe("none");
    expect(JSON.stringify(unsupported)).not.toContain("/home/");
  });
});
