import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PROMPT_ENHANCEMENT_CONTRACT_VERSION,
  type PromptEnhancementPrepareRequestV1,
  type PromptEnhancementSourceRefV1,
} from './contracts.js';
import { buildPromptEnhancementCostVisibilityMetadataV1 } from './cost-observability.js';
import { getPromptStartStopSourceSnapshot } from './source-reality.js';
import {
  buildPromptEnhancementPopupRenderModelV1,
  PROMPT_ENHANCEMENT_PROVIDER_FAILURE_NOTICE_V1,
} from './popup-render-model.js';
import { validatePromptEnhancementPrepareResultV1 } from './contracts.js';
import { renderPromptEnhancementPopupFrameV1 } from './cli-submit-popup.js';

// ---------------------------------------------------------------------------
// TI-2 (2026-08-07) — facade maps the composer's typed failure reason onto the
// runtime states that already exist, instead of collapsing to `undefined`.
//
// Live bug: a real provider timeout produced `callVisibilityMode "deterministic" /
// planned 0 / used 0` — byte-identical to "never eligible for an LLM call" — in the
// UI, logs, and cost metadata simultaneously (reproduced 3/3 before the timeout
// raise). These tests drive the REAL facade with the composer mocked per failure
// reason (zero network) and assert the failure is now carried on the result:
// `fallback_no_llm` + `fallbackReason` + `providerFailureState`, while the body
// still renders deterministically (content unchanged) and `no_key` stays
// byte-identical to today ("genuinely not requested").
// ---------------------------------------------------------------------------

const mockCall = vi.hoisted(() => ({
  result: { ok: false, reason: 'no_key' } as
    | { ok: true; output: unknown }
    | { ok: false; reason: 'no_key' | 'no_eligible_sections' | 'provider_error' | 'timeout' | 'invalid_output' },
}));
vi.mock('./llm-composer.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./llm-composer.js')>();
  return { ...original, composeStructuredComposerOutputV1: vi.fn(async () => mockCall.result) };
});
// The route-rescue path must never reach a real client while a (fake) key is set.
vi.mock('./llm-route-decision.js', () => ({
  decidePromptEnhancementRouteViaLlmV1: vi.fn(async () => undefined),
}));

// NLP-heavy prompt (list shape + 2+ keyword families) so the composer gate opens —
// the same shape the parity suite proves reaches the LLM-wording path.
const NLP_HEAVY_PROMPT = 'The invoice PDF export throws a null error when a client has no address. Fix it and add a test that reproduces the bug.\n\nmake it look nicer';

function request(text: string): PromptEnhancementPrepareRequestV1 {
  const sourceRef: PromptEnhancementSourceRefV1 = {
    sourceRefId: 'src-a-1', sourceKind: 'source_a_user_prompt', sourceId: 'prompt:1',
    sourceAuthorization: 'source_fact_only', evidenceStatus: 'present', freshness: 'current', confidence: 'high', privacyClass: 'public_safe',
  };
  const p = getPromptStartStopSourceSnapshot();
  return {
    schemaVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION, requestId: 'pf-1', projectRoot: '/tmp/pf', hostSurface: 'cli_stop_bridge',
    sourcePrompt: { text, origin: 'user', capturedAt: 1, promptIndex: 1, generatedOriginPolicy: 'ordinary_source_a' },
    reviewMomentContext: { reviewMoment: 'UserPromptSubmit_preparation', currentAgentMode: 'workspace-write', projectId: 'p1', sessionId: 's1', detectedLanguage: 'en', stageCandidate: 'implementation', promptCount: 1, recentPromptMetadataRefs: [], triggerProvenance: { currentStage: 'implementation', prevStage: 'task_breakdown', triggerKind: 'stage_transition', classifierState: 'fire_recommended', degradedNoActionState: 'none', promptStartBoundary: p.hookBoundary, deliveryBoundary: p.deliveryBoundary, promptStartCanReplaceSameTurn: false } },
    sourceSignals: { sourceAOriginalPromptRef: sourceRef, sourceRefs: [sourceRef], normalizedStageAbsenceSignalRefs: [], contentTemplateRecordFactRefs: [], popupQuestionSourceRefs: [], whyHelpSourceRefs: [], profileRoleModeRefs: [], rightGoodWorkStyleEnvRuntimeRefs: [], missingMemoryCandidateRefs: [], sourceLabels: [{ sourceRefId: sourceRef.sourceRefId, label: 'original_prompt', evidenceStatus: 'present' }], promptStartStop: { hookBoundary: p.hookBoundary, deliveryBoundary: p.deliveryBoundary, runAutoCanHoldOrReplaceSubmittedPrompt: false, sharedSignalCount: p.sharedSignalCount, classifierDegradedNoFireReasons: p.classifierDegradedNoFireReasons }, store: { schemaVersion: 1, missingPromptEnhancementTables: [], cleanupGaps: [] }, transcriptPathState: 'not_authority', streamBOutputs: [], paramEventChannels: [], servedVariantIdentityRefs: [], deliveryGateRefs: [], sourceOnlyHardFactRefs: [] },
    userPreferenceContext: { levelState: 'default', scopedFeedbackEvidenceRefs: [] },
    configSnapshot: { sequenceEnabledState: 'not_enabled_v1', validatedEffectiveConfigState: 'valid', arbitraryConfigRowsAreAuthority: false },
    callVisibilityState: buildPromptEnhancementCostVisibilityMetadataV1('baseline_pe_composer', { callVisibilityMode: 'deterministic', plannedCallCount: 0, usedCallCount: 0 }),
    privacyAndStoragePolicy: { sensitivityClass: 'normal', localStorageEligibility: 'ids_and_categories_only', telemetryEligibility: 'allowlisted_counts_only', llmSharingEligibility: 'allowed_minimal', generatedBodyStoragePolicy: 'do_not_store_raw_by_default' },
  };
}

describe('TI-2: facade maps composer failure reasons onto the existing runtime states', () => {
  const savedKey = process.env['OPENAI_API_KEY'];
  beforeEach(() => {
    // Format-valid fake key so the facade takes the LLM path; the composer is mocked — zero network.
    process.env['OPENAI_API_KEY'] = `sk-${'a'.repeat(24)}`;
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env['OPENAI_API_KEY'];
    else process.env['OPENAI_API_KEY'] = savedKey;
  });

  async function prepared() {
    const { preparePromptEnhancement } = await import('./facade.js');
    return preparePromptEnhancement(request(NLP_HEAVY_PROMPT));
  }

  it('timeout -> fallback_no_llm / fallbackReason timeout / providerFailureState timeout / deterministic body + notice (owner ruling)', async () => {
    mockCall.result = { ok: false, reason: 'timeout' };
    const result = await prepared();
    // The result MUST pass the boundary validator — otherwise auto.ts would reduce it to
    // invalid_result and NO popup would open (the regression this assertion guards).
    expect(validatePromptEnhancementPrepareResultV1(result)).toEqual({ ok: true, reasonCodes: [] });
    expect(result.callAndVisibilityMetadata.callVisibilityMode).toBe('fallback_no_llm');
    expect(result.callAndVisibilityMetadata.plannedCallCount).toBe(1);
    // A provider-unavailable failure counts NO completed billable call (builder forces used 0).
    expect(result.callAndVisibilityMetadata.usedCallCount).toBe(0);
    expect(result.callAndVisibilityMetadata.fallbackReason).toBe('timeout');
    expect(result.callAndVisibilityMetadata.providerFailureState).toBe('timeout');
    expect(result.callAndVisibilityMetadata.providerAvailabilityState).toBe('unavailable_by_provider_api');
    // Owner ruling 2026-08-07: a provider failure renders the FULL deterministic body (the
    // original-only shell was removed) — the failure stays visible via the notice + metadata.
    expect(result.disposition).toBe('show_current_body');
    expect(result.currentBody.sections.length).toBeGreaterThan(0);
    expect(result.currentBody.text).not.toBe(NLP_HEAVY_PROMPT);
    expect(result.currentBody.text).toContain(NLP_HEAVY_PROMPT.split('\n')[0]!); // original stays visible inside
    // The fallback diagnostic reaches the result as its public-safe CATEGORY (the reason code is
    // stripped by the rawReasonValuesExcluded contract — category is the assertable signal).
    expect(result.uiView.diagnostics.some((d) => d.category === 'fallback_or_no_popup')).toBe(true);
    // TI-2 UI half (end-to-end): the popup MODEL carries the public-safe failure notice and the
    // FRAME renders it persistently — the user is SHOWN the failure (locked disposition part a).
    const rendered = buildPromptEnhancementPopupRenderModelV1({ result, timestampMs: Date.now(), deliverySurface: result.delivery.deliveryChannel });
    expect(rendered.state).toBe('render_model_ready');
    if (rendered.state !== 'render_model_ready') return;
    expect(rendered.model.providerFailureNotice).toBe(PROMPT_ENHANCEMENT_PROVIDER_FAILURE_NOTICE_V1);
    const view = { model: rendered.model, editedBodyText: rendered.model.body.text, additionalDetailsText: '' };
    const frame0 = renderPromptEnhancementPopupFrameV1(view, { focusIndex: 0, helpExpanded: false });
    const frame2 = renderPromptEnhancementPopupFrameV1(view, { focusIndex: 2, helpExpanded: false });
    expect(frame0).toContain(PROMPT_ENHANCEMENT_PROVIDER_FAILURE_NOTICE_V1);
    expect(frame2).toContain(PROMPT_ENHANCEMENT_PROVIDER_FAILURE_NOTICE_V1); // persists across focus moves
    // Yellow caution tone in colour mode; appears exactly once per frame.
    const colored = renderPromptEnhancementPopupFrameV1(view, { focusIndex: 0, helpExpanded: false, colorize: true });
    const ESC = String.fromCharCode(27);
    expect(colored).toContain(`${ESC}[33m${PROMPT_ENHANCEMENT_PROVIDER_FAILURE_NOTICE_V1}`);
    expect(frame0.split(PROMPT_ENHANCEMENT_PROVIDER_FAILURE_NOTICE_V1).length - 1).toBe(1);
  });

  it('provider_error -> fallback_no_llm / fallbackReason provider_unavailable / deterministic body + notice (owner ruling)', async () => {
    mockCall.result = { ok: false, reason: 'provider_error' };
    const result = await prepared();
    // The result MUST pass the boundary validator — otherwise auto.ts would reduce it to
    // invalid_result and NO popup would open (the regression this assertion guards).
    expect(validatePromptEnhancementPrepareResultV1(result)).toEqual({ ok: true, reasonCodes: [] });
    expect(result.callAndVisibilityMetadata.callVisibilityMode).toBe('fallback_no_llm');
    expect(result.callAndVisibilityMetadata.fallbackReason).toBe('provider_unavailable');
    expect(result.callAndVisibilityMetadata.providerFailureState).toBe('provider_api_unavailable');
    expect(result.disposition).toBe('show_current_body');
    expect(result.currentBody.sections.length).toBeGreaterThan(0);
    expect(result.uiView.diagnostics.some((d) => d.category === 'fallback_or_no_popup')).toBe(true);
    const rendered = buildPromptEnhancementPopupRenderModelV1({ result, timestampMs: Date.now(), deliverySurface: result.delivery.deliveryChannel });
    expect(rendered.state === 'render_model_ready' && rendered.model.providerFailureNotice).toBe(PROMPT_ENHANCEMENT_PROVIDER_FAILURE_NOTICE_V1);
  });

  it('MPS: a failed SEQUENCE prompt still opens MPS (show_current_body) and its popup carries the notice (owner ruling)', async () => {
    mockCall.result = { ok: false, reason: 'timeout' };
    const { preparePromptEnhancement } = await import('./facade.js');
    const { buildPromptEnhancementMpsFirstPopupV1 } = await import('./first-popup.js');
    const { renderPromptEnhancementMpsFirstPopupFrameV1 } = await import('./cli-mps-popup.js');
    const result = await preparePromptEnhancement(request('Fix the failing payment test and add a rate limiter to the login endpoint.'));
    expect(result.disposition).toBe('show_current_body');
    expect(result.uiView.handoffAndSequenceSummary).toBeDefined();
    const built = buildPromptEnhancementMpsFirstPopupV1({
      result,
      handoffMetadata: result.uiView.handoffAndSequenceSummary!,
      cancel: { state: 'available', disposition: 'blocked_no_send' },
    });
    expect(built.state).toBe('ready');
    if (built.state !== 'ready') return;
    expect(built.model.providerFailureNotice).toBe(PROMPT_ENHANCEMENT_PROVIDER_FAILURE_NOTICE_V1);
    const frame = renderPromptEnhancementMpsFirstPopupFrameV1(built.model, { focusIndex: 0, colorize: true });
    const ESC = String.fromCharCode(27);
    expect(frame).toContain(`${ESC}[33m${PROMPT_ENHANCEMENT_PROVIDER_FAILURE_NOTICE_V1}`);
  });

  it('invalid_output -> fallback_no_llm with fallbackReason validation_failed; body renders the FULL deterministic sections', async () => {
    mockCall.result = { ok: false, reason: 'invalid_output' };
    const result = await prepared();
    // The result MUST pass the boundary validator — otherwise auto.ts would reduce it to
    // invalid_result and NO popup would open (the regression this assertion guards).
    expect(validatePromptEnhancementPrepareResultV1(result)).toEqual({ ok: true, reasonCodes: [] });
    expect(result.callAndVisibilityMetadata.callVisibilityMode).toBe('fallback_no_llm');
    expect(result.callAndVisibilityMetadata.fallbackReason).toBe('validation_failed');
    expect(result.callAndVisibilityMetadata.providerFailureState).toBe('none');
    // invalid_output falls back to the normal deterministic BODY (not the original-only shell).
    expect(result.disposition).toBe('show_current_body');
    expect(result.currentBody.sections.length).toBeGreaterThan(0);
    // No provider-failure notice for invalid_output (per the UI fix plan): frame unchanged.
    const rendered = buildPromptEnhancementPopupRenderModelV1({ result, timestampMs: Date.now(), deliverySurface: result.delivery.deliveryChannel });
    expect(rendered.state === 'render_model_ready' && rendered.model.providerFailureNotice).toBeUndefined();
  });

  it('no_key stays byte-identical to "genuinely not requested" (deterministic / 0 / 0)', async () => {
    mockCall.result = { ok: false, reason: 'no_key' };
    const result = await prepared();
    // The result MUST pass the boundary validator — otherwise auto.ts would reduce it to
    // invalid_result and NO popup would open (the regression this assertion guards).
    expect(validatePromptEnhancementPrepareResultV1(result)).toEqual({ ok: true, reasonCodes: [] });
    expect(result.callAndVisibilityMetadata.callVisibilityMode).toBe('deterministic');
    expect(result.callAndVisibilityMetadata.plannedCallCount).toBe(0);
    expect(result.callAndVisibilityMetadata.usedCallCount).toBe(0);
    expect(result.callAndVisibilityMetadata.providerFailureState).toBe('none');
    expect(result.disposition).toBe('show_current_body');
    const rendered = buildPromptEnhancementPopupRenderModelV1({ result, timestampMs: Date.now(), deliverySurface: result.delivery.deliveryChannel });
    expect(rendered.state === 'render_model_ready' && rendered.model.providerFailureNotice).toBeUndefined();
  });
});
