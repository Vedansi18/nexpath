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
