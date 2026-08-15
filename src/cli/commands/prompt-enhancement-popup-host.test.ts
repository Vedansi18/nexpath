import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createProgram } from '../main.js';
import { PROMPT_ENHANCEMENT_CONTRACT_VERSION, type PromptEnhancementPrepareRequestV1, type PromptEnhancementSourceRefV1 } from '../../prompt-enhancement/contracts.js';
import { buildPromptEnhancementCostVisibilityMetadataV1 } from '../../prompt-enhancement/cost-observability.js';
import { preparePromptEnhancement } from '../../prompt-enhancement/facade.js';
import { getPromptStartStopSourceSnapshot } from '../../prompt-enhancement/source-reality.js';
import type { PromptEnhancementPopupEventV1 } from '../../prompt-enhancement/popup-session.js';
import type { Store } from '../../store/db.js';
import {
  runPromptEnhancementPopupHostCommandV1,
  type PromptEnhancementPopupHostInputV1,
} from './prompt-enhancement-popup-host.js';

function request(): PromptEnhancementPrepareRequestV1 {
  const sourceRef: PromptEnhancementSourceRefV1 = {
    sourceRefId: 'pe1-2-source-a', sourceKind: 'source_a_user_prompt', sourceId: 'prompt:1',
    sourceAuthorization: 'source_fact_only', evidenceStatus: 'present', freshness: 'current', confidence: 'high', privacyClass: 'local_private',
  };
  const promptStartStop = getPromptStartStopSourceSnapshot();
  return {
    schemaVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
    requestId: 'pe1-2-request', projectRoot: '/tmp/pe1-2-project', hostSurface: 'cli_stop_bridge',
    sourcePrompt: { text: 'Fix the payment test and explain verification.', origin: 'user', capturedAt: 1, promptIndex: 1, generatedOriginPolicy: 'ordinary_source_a' },
    reviewMomentContext: {
      reviewMoment: 'UserPromptSubmit_preparation', currentAgentMode: 'workspace-write', projectId: 'project-1', sessionId: 'session-1', detectedLanguage: 'en', stageCandidate: 'implementation', promptCount: 1, recentPromptMetadataRefs: [],
      triggerProvenance: { currentStage: 'implementation', prevStage: 'task_breakdown', triggerKind: 'stage_transition', classifierState: 'fire_recommended', degradedNoActionState: 'none', promptStartBoundary: promptStartStop.hookBoundary, deliveryBoundary: promptStartStop.deliveryBoundary, promptStartCanReplaceSameTurn: false },
    },
    sourceSignals: {
      sourceAOriginalPromptRef: sourceRef, sourceRefs: [sourceRef], normalizedStageAbsenceSignalRefs: [], contentTemplateRecordFactRefs: [], popupQuestionSourceRefs: [], whyHelpSourceRefs: [], profileRoleModeRefs: [], rightGoodWorkStyleEnvRuntimeRefs: [], missingMemoryCandidateRefs: [], sourceLabels: [{ sourceRefId: sourceRef.sourceRefId, label: 'original_prompt', evidenceStatus: 'present' }],
      promptStartStop: { hookBoundary: promptStartStop.hookBoundary, deliveryBoundary: promptStartStop.deliveryBoundary, runAutoCanHoldOrReplaceSubmittedPrompt: false, sharedSignalCount: promptStartStop.sharedSignalCount, classifierDegradedNoFireReasons: promptStartStop.classifierDegradedNoFireReasons },
      store: { schemaVersion: 1, missingPromptEnhancementTables: [], cleanupGaps: [] }, transcriptPathState: 'not_authority', streamBOutputs: [], paramEventChannels: [], servedVariantIdentityRefs: [], deliveryGateRefs: [], sourceOnlyHardFactRefs: [],
    },
    userPreferenceContext: { levelState: 'default', scopedFeedbackEvidenceRefs: [] },
    configSnapshot: { sequenceEnabledState: 'not_enabled_v1', validatedEffectiveConfigState: 'valid', arbitraryConfigRowsAreAuthority: false },
    callVisibilityState: buildPromptEnhancementCostVisibilityMetadataV1('baseline_pe_composer', { callVisibilityMode: 'deterministic', plannedCallCount: 0, usedCallCount: 0 }),
    privacyAndStoragePolicy: { sensitivityClass: 'normal', localStorageEligibility: 'ids_and_categories_only', telemetryEligibility: 'allowlisted_counts_only', llmSharingEligibility: 'allowed_minimal', generatedBodyStoragePolicy: 'do_not_store_raw_by_default' },
  };
}

async function validInput(): Promise<PromptEnhancementPopupHostInputV1> {
  const preparedRequest = request();
  return {
    protocolVersion: 1,
    request: preparedRequest,
    result: await preparePromptEnhancement(preparedRequest),
  };
}

function files() {
  const dir = mkdtempSync(join(tmpdir(), 'nexpath-pe1-2-'));
  return { inputFile: join(dir, 'input.json'), resultFile: join(dir, 'result.json') };
}

describe('spawned-window MPS parity (fix 2026-08-06)', () => {
  const MULTI_INTENT = 'Fix the failing payment test and add a rate limiter to the login endpoint.';

  async function sequenceInput(): Promise<PromptEnhancementPopupHostInputV1> {
    const base = request();
    const preparedRequest = { ...base, sourcePrompt: { ...base.sourcePrompt, text: MULTI_INTENT } };
    return { protocolVersion: 1, request: preparedRequest, result: await preparePromptEnhancement(preparedRequest) };
  }

  it('a handoff-bearing input shows the MPS popup first; Enter-send returns selected_current (PE popup skipped)', async () => {
    const paths = files();
    const input = await sequenceInput();
    expect((input.result as { uiView: { handoffAndSequenceSummary?: unknown } }).uiView.handoffAndSequenceSummary).toBeDefined();
    writeFileSync(paths.inputFile, JSON.stringify(input), 'utf8');
    const runPopup = vi.fn(async () => ({ state: 'selected_original' as const }));
    const runMpsPopup = vi.fn(async () => ({ state: 'send' as const, bodyText: 'ENHANCED FIRST PROMPT' }));

    const output = await runPromptEnhancementPopupHostCommandV1(
      { ...paths, db: ':memory:' },
      { openStore: async () => ({} as Store), closeStore: vi.fn(), runPopup, runMpsPopup, recordActionSignal: vi.fn() },
    );

    expect(output.result).toEqual({ state: 'selected_current', bodyText: 'ENHANCED FIRST PROMPT' });
    expect(runMpsPopup).toHaveBeenCalledTimes(1);
    expect(runPopup).not.toHaveBeenCalled(); // MPS send resolves the popup turn; PE popup skipped
  });

  it('NF apply-details capture: the MPS actionSignalSink is wired to recordActionSignal (mps_apply_details)', async () => {
    const paths = files();
    writeFileSync(paths.inputFile, JSON.stringify(await sequenceInput()), 'utf8');
    const runPopup = vi.fn(async () => ({ state: 'selected_original' as const }));
    // The runner invokes the sink when the user applies details in-popup, then sends.
    const runMpsPopup = vi.fn(async (arg: { actionSignalSink?: (kind: string, ts: number) => void }) => {
      arg.actionSignalSink?.('mps_apply_details', 1234);
      return { state: 'send' as const, bodyText: 'ENHANCED FIRST PROMPT' };
    });
    const recordActionSignal = vi.fn();

    await runPromptEnhancementPopupHostCommandV1(
      { ...paths, db: ':memory:' },
      { openStore: async () => ({} as Store), closeStore: vi.fn(), runPopup, runMpsPopup, recordActionSignal },
    );

    // The apply is recorded (mps_apply_details), AND the terminal outcome (mps_send) is recorded too.
    const kinds = recordActionSignal.mock.calls.map((c) => c[2]);
    expect(kinds).toContain('mps_apply_details');
    expect(kinds).toContain('mps_send');
  });

  it('MPS declined (Esc) falls through to the regular PE popup in the same window', async () => {
    const paths = files();
    writeFileSync(paths.inputFile, JSON.stringify(await sequenceInput()), 'utf8');
    const runPopup = vi.fn(async () => ({ state: 'selected_original' as const }));
    const runMpsPopup = vi.fn(async () => ({ state: 'declined' as const }));

    const output = await runPromptEnhancementPopupHostCommandV1(
      { ...paths, db: ':memory:' },
      { openStore: async () => ({} as Store), closeStore: vi.fn(), runPopup, runMpsPopup, recordActionSignal: vi.fn() },
    );

    expect(output.result).toEqual({ state: 'selected_original' });
    expect(runMpsPopup).toHaveBeenCalledTimes(1);
    expect(runPopup).toHaveBeenCalledTimes(1);
  });

  it('MPS cancelled ends the flow with closed_no_send — the PE popup never opens (owner request)', async () => {
    const paths = files();
    const input = await sequenceInput();
    writeFileSync(paths.inputFile, JSON.stringify(input), 'utf8');
    const runPopup = vi.fn(async () => ({ state: 'selected_original' as const }));
    const runMpsPopup = vi.fn(async () => ({
      state: 'cancelled' as const,
      feedback: { kind: 'suggested' as const, category: 'not_relevant_enough' as const },
    }));
    const recordFeedback = vi.fn();

    const output = await runPromptEnhancementPopupHostCommandV1(
      { ...paths, db: ':memory:' },
      { openStore: async () => ({} as Store), closeStore: vi.fn(), runPopup, runMpsPopup, recordFeedback, recordActionSignal: vi.fn() },
    );

    expect(output.result).toEqual({ state: 'closed_no_send' });
    expect(runPopup).not.toHaveBeenCalled(); // cancel ends the flow — no PE popup after cancel
    // The feedback collected by the MPS cancel flow is recorded through the PEF chain.
    expect(recordFeedback).toHaveBeenCalledTimes(1);
    expect(recordFeedback.mock.calls[0][2]).toMatchObject({ eventType: 'explicit_feedback', feedbackCategory: 'not_relevant_enough' });
  });

  it('a non-sequence input never invokes the MPS popup (parity guard)', async () => {
    const paths = files();
    writeFileSync(paths.inputFile, JSON.stringify(await validInput()), 'utf8');
    const runPopup = vi.fn(async () => ({ state: 'closed_no_send' as const }));
    const runMpsPopup = vi.fn(async () => ({ state: 'declined' as const }));

    await runPromptEnhancementPopupHostCommandV1(
      { ...paths, db: ':memory:' },
      { openStore: async () => ({} as Store), closeStore: vi.fn(), runPopup, runMpsPopup, recordActionSignal: vi.fn() },
    );

    expect(runMpsPopup).not.toHaveBeenCalled();
    expect(runPopup).toHaveBeenCalledTimes(1);
  });

  it('the readiness marker is written exactly once when MPS renders first then PE falls through', async () => {
    const paths = files();
    const readinessFile = join(paths.inputFile, '..', 'ready');
    writeFileSync(paths.inputFile, JSON.stringify(await sequenceInput()), 'utf8');
    const markReady = vi.fn();
    const runPopup = vi.fn(async (input: { onFirstRender?: () => void }) => {
      input.onFirstRender?.(); // the PE popup's own first render must NOT double-write
      return { state: 'selected_original' as const };
    });
    const runMpsPopup = vi.fn(async () => ({ state: 'declined' as const }));

    await runPromptEnhancementPopupHostCommandV1(
      { ...paths, readinessFile, db: ':memory:' },
      { openStore: async () => ({} as Store), closeStore: vi.fn(), runPopup, runMpsPopup, markReady },
    );

    expect(markReady).toHaveBeenCalledTimes(1);
  });
});

describe('PE1.2 — hidden prompt-enhancement popup child command', () => {
  it('revalidates typed input and atomically writes the selected result without stdout output', async () => {
    const paths = files();
    const input = await validInput();
    writeFileSync(paths.inputFile, JSON.stringify(input), 'utf8');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const runPopup = vi.fn(async () => ({ state: 'selected_original' as const }));
    const store = {} as Store;

    const output = await runPromptEnhancementPopupHostCommandV1(
      { ...paths, db: ':memory:' },
      { openStore: async () => store, closeStore: vi.fn(), runPopup },
    );

    expect(output).toEqual({ protocolVersion: 1, result: { state: 'selected_original' } });
    expect(JSON.parse(readFileSync(paths.resultFile, 'utf8'))).toEqual(output);
    // POSIX file mode — Windows has no 0o600 equivalent, so assert it only off win32 (P5).
    if (process.platform !== 'win32') expect(statSync(paths.resultFile).mode & 0o777).toBe(0o600);
    expect(runPopup).toHaveBeenCalledTimes(1);
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
    stdout.mockRestore();
    stderr.mockRestore();
  });

  it('returns a safe no-send result without opening a store for invalid, missing, or stale input', async () => {
    const invalid = files();
    writeFileSync(invalid.inputFile, '{not json', 'utf8');
    const openStore = vi.fn();
    const runPopup = vi.fn();
    const invalidOutput = await runPromptEnhancementPopupHostCommandV1(
      { ...invalid, db: ':memory:' },
      { openStore, runPopup },
    );

    const missing = files();
    const missingOutput = await runPromptEnhancementPopupHostCommandV1(
      { ...missing, db: ':memory:' },
      { openStore, runPopup },
    );

    const stale = files();
    const input = await validInput();
    writeFileSync(stale.inputFile, JSON.stringify({ ...input, result: { ...(input.result as object), requestId: 'stale-request' } }), 'utf8');
    const staleOutput = await runPromptEnhancementPopupHostCommandV1(
      { ...stale, db: ':memory:' },
      { openStore, runPopup },
    );

    expect(invalidOutput).toEqual({ protocolVersion: 1, result: { state: 'closed_no_send' } });
    expect(missingOutput).toEqual({ protocolVersion: 1, result: { state: 'closed_no_send' } });
    expect(staleOutput).toEqual({ protocolVersion: 1, result: { state: 'closed_no_send' } });
    expect(JSON.parse(readFileSync(invalid.resultFile, 'utf8')).result).toEqual({ state: 'closed_no_send' });
    expect(openStore).not.toHaveBeenCalled();
    expect(runPopup).not.toHaveBeenCalled();
  });

  it('uses the existing PEF store boundary with the validated request project root', async () => {
    const paths = files();
    const input = await validInput();
    writeFileSync(paths.inputFile, JSON.stringify(input), 'utf8');
    const store = {} as Store;
    const event = {} as PromptEnhancementPopupEventV1;
    const recordFeedback = vi.fn(() => ({ stableEventIdentity: 'event-1', status: 'accepted' as const, publicSafeText: 'Feedback saved. Your prompt is unchanged.' }));
    const runPopup = vi.fn(async ({ feedbackSink }: { feedbackSink?: (value: PromptEnhancementPopupEventV1) => unknown }) => {
      await feedbackSink!(event);
      return { state: 'closed_no_send' as const };
    });

    await runPromptEnhancementPopupHostCommandV1(
      { ...paths, db: ':memory:' },
      { openStore: async () => store, closeStore: vi.fn(), runPopup, recordFeedback },
    );

    // The request is threaded through so the feedback->memory policy (E3/3.2a) can
    // re-derive the signal key + safety from it.
    expect(recordFeedback).toHaveBeenCalledWith(
      store,
      '/tmp/pe1-2-project',
      event,
      expect.objectContaining({ requestId: 'pe1-2-request', projectRoot: '/tmp/pe1-2-project' }),
    );
  });

  it('writes the private readiness marker only after the popup reports its first render', async () => {
    const paths = files();
    const readinessFile = join(dirname(paths.resultFile), 'ready');
    const input = await validInput();
    writeFileSync(paths.inputFile, JSON.stringify(input), 'utf8');
    const runPopup = vi.fn(async ({ onFirstRender }: { onFirstRender?: () => void }) => {
      expect(existsSync(readinessFile)).toBe(false);
      onFirstRender?.();
      return { state: 'selected_original' as const };
    });

    await runPromptEnhancementPopupHostCommandV1(
      { ...paths, readinessFile, db: ':memory:' },
      { openStore: async () => ({} as Store), closeStore: vi.fn(), runPopup },
    );

    expect(runPopup).toHaveBeenCalledTimes(1);
    expect(readFileSync(readinessFile, 'utf8')).toBe('ready');
    // POSIX file mode — assert only off win32 (P5).
    if (process.platform !== 'win32') expect(statSync(readinessFile).mode & 0o777).toBe(0o600);
  });

  it('registers the child command as hidden, outside the public help surface', () => {
    const command = createProgram().commands.find((candidate) => candidate.name() === 'prompt-enhancement-popup-host');
    expect(command).toBeDefined();
    expect(command!.options.map((option) => option.long)).toEqual(expect.arrayContaining(['--input-file', '--result-file', '--db']));
    expect(createProgram().helpInformation()).not.toContain('prompt-enhancement-popup-host');
  });
});
