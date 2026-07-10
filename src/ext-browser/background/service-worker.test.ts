import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ClassificationResult, SessionState } from '../../core/classifier/types.js';
// Real (unmocked) — composeWhyHelpBlock + this table run for real in the payload
// test, exactly as the SW uses them, so the whyHelp wiring is proven end to end.
import { WHY_HELP_BY_SIGNAL_TYPE } from '../../decision-session/why-help-by-signal-type.js';

/**
 * service-worker.ts orchestrates the core pipeline + browser adapters. Its own
 * dependencies (classifier, session-state, stage2, pinch, decision content, all
 * adapters) already have dedicated unit tests elsewhere — this file mocks every
 * one of them and only verifies the SW's own wiring: offscreen lifecycle,
 * onInstalled behaviour, and onMessage routing/orchestration order.
 */

vi.mock('../../core/classifier/PromptClassifier.js', () => ({ classifyPrompt: vi.fn() }));
vi.mock('../../core/session-state.js', () => ({ SessionStateManager: { load: vi.fn() } }));
vi.mock('../../core/stage2.js', () => ({ shouldFireStage2: vi.fn(), runStage2: vi.fn() }));
vi.mock('../../core/classifier/AbsenceDetector.js', () => ({ detectAbsenceFlags: vi.fn(() => []) }));
vi.mock('../../core/classifier/StreamBPresenceClassifier.js', () => ({ classifyStreamBPresence: vi.fn() }));
vi.mock('../../core/decision/pinch.js', () => ({ generatePinchLabel: vi.fn() }));
vi.mock('../../decision-session/options.js', () => ({ resolveDecisionContent: vi.fn() }));
vi.mock('../../core/decision/options.js', () => ({ generateOptionList: vi.fn() }));
vi.mock('../adapters/storage-idb.js', () => ({ IdbStorageAdapter: vi.fn() }));
vi.mock('../adapters/memory-storage.js', () => ({ makeMemoryStoragePort: vi.fn() }));
vi.mock('../adapters/llm-fetch.js', () => ({ FetchLLMAdapter: vi.fn() }));
vi.mock('../adapters/storage-chrome.js', () => ({ ChromeStorageKeyAdapter: vi.fn() }));
vi.mock('../adapters/clock-browser.js', () => ({ BrowserClockAdapter: vi.fn() }));
vi.mock('../adapters/log-console.js', () => ({ ConsoleLogAdapter: vi.fn() }));
vi.mock('../adapters/log-persistent.js', () => ({ PersistentLogAdapter: vi.fn() }));
vi.mock('../adapters/embedding-offscreen.js', () => ({ OffscreenEmbeddingAdapter: vi.fn() }));
vi.mock('../content/panel-adapter.js', () => ({ ContentScriptUIAdapter: vi.fn() }));

const { classifyPrompt } = await import('../../core/classifier/PromptClassifier.js');
const { SessionStateManager } = await import('../../core/session-state.js');
const { shouldFireStage2, runStage2 } = await import('../../core/stage2.js');
const { detectAbsenceFlags } = await import('../../core/classifier/AbsenceDetector.js');
const { classifyStreamBPresence } = await import('../../core/classifier/StreamBPresenceClassifier.js');
const { generatePinchLabel } = await import('../../core/decision/pinch.js');
const { resolveDecisionContent } = await import('../../decision-session/options.js');
const { generateOptionList } = await import('../../core/decision/options.js');
const { IdbStorageAdapter } = await import('../adapters/storage-idb.js');
const { makeMemoryStoragePort } = await import('../adapters/memory-storage.js');
const { ChromeStorageKeyAdapter } = await import('../adapters/storage-chrome.js');
const { BrowserClockAdapter } = await import('../adapters/clock-browser.js');
const { ConsoleLogAdapter } = await import('../adapters/log-console.js');
const { PersistentLogAdapter } = await import('../adapters/log-persistent.js');
const { ContentScriptUIAdapter } = await import('../content/panel-adapter.js');

const idbLoadSessionState = vi.fn();
const idbGetProjectDetectedLanguage = vi.fn();
const idbSaveSessionState = vi.fn().mockResolvedValue(undefined);
const idbSaveProjectDetectedLanguage = vi.fn().mockResolvedValue(undefined);

const keyStoreGetKey = vi.fn();
const keyStoreSetKey = vi.fn().mockResolvedValue(undefined);
const clockNow = vi.fn().mockReturnValue(1000);

// Shared across ConsoleLogAdapter instantiations so tests can assert on log events
// (the SW's stage2_result/prompt_submit_deduped observability lines are behaviour).
const logDebugMock = vi.fn();
const logWarnMock = vi.fn();

const showAdvisoryMock = vi.fn();

const mgrProcessPrompt = vi.fn();
const mgrMarkAdvisoryFired = vi.fn();
const mgrMarkDecisionSessionFired = vi.fn();
const mgrHasFiredDecisionSession = vi.fn();
const mgrAddAbsenceFlag = vi.fn();
const mgrApplyStage2SignalUpdates = vi.fn();
const mgrSetProfile = vi.fn();
let mgrCurrent: Partial<SessionState>;

const getLatestStateMock = vi.fn();

const hasDocumentMock = vi.fn();
const createDocumentMock = vi.fn().mockResolvedValue(undefined);
const openOptionsPageMock = vi.fn();
const onInstalledAddListenerMock = vi.fn();
const onMessageAddListenerMock = vi.fn();
const tabsQueryMock = vi.fn();
const tabsReloadMock = vi.fn().mockResolvedValue(undefined);

// browser.* (webextension-polyfill) covers everything except chrome.offscreen, which has no
// cross-browser equivalent and stays a real chrome.* global — see importFreshServiceWorker below.
vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: {
      onInstalled:     { addListener: onInstalledAddListenerMock },
      onMessage:        { addListener: onMessageAddListenerMock },
      openOptionsPage:  openOptionsPageMock,
    },
    tabs: { query: tabsQueryMock, reload: tabsReloadMock },
  },
}));

type MessageListener = (
  msg: unknown,
  sender: { tab?: { id: number } },
  sendResponse: (r: unknown) => void,
) => boolean;

async function importFreshServiceWorker(chromeOffscreen: unknown): Promise<{
  messageListener: MessageListener;
  installedListener: (details: { reason: string }) => void;
}> {
  vi.stubGlobal('chrome', { offscreen: chromeOffscreen });
  vi.resetModules();
  await import('./service-worker.js');
  return {
    messageListener: onMessageAddListenerMock.mock.calls[0]![0] as MessageListener,
    installedListener: onInstalledAddListenerMock.mock.calls[0]![0] as (details: { reason: string }) => void,
  };
}

function baseClassification(): ClassificationResult {
  return { stage: 'implementation', confidence: 0.8, tier: 1 };
}

/** The advisory payload handlePromptSubmit queued (persisted under the pending key). */
function pendingPayload(): Record<string, unknown> | null {
  const call = keyStoreSetKey.mock.calls.find(
    ([k]) => typeof k === 'string' && k.startsWith('nexpath_pending_advisory::'),
  );
  return call ? (JSON.parse(call[1] as string) as Record<string, unknown>) : null;
}

describe('service-worker.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasDocumentMock.mockResolvedValue(false);

    mgrCurrent = {
      currentStage: 'implementation',
      promptCount: 3,
      profile: null,
      detectedLanguage: undefined,
      promptHistory: [],
      firedDecisionSessions: [],
      lastAdvisoryPromptIndex: -1,
      advisoryCount: 0,
      absenceFlags: [],
      promptsInCurrentStage: 1,
    };
    idbLoadSessionState.mockResolvedValue(null);
    idbGetProjectDetectedLanguage.mockResolvedValue(undefined);
    getLatestStateMock.mockReturnValue({ currentStage: 'implementation', detectedLanguage: undefined });
    keyStoreGetKey.mockResolvedValue(null);
    mgrHasFiredDecisionSession.mockReturnValue(false);
    tabsQueryMock.mockResolvedValue([]);

    vi.mocked(classifyPrompt).mockResolvedValue(baseClassification());
    // Default: no personalisation → handleResponseStop shows the static queued payload.
    vi.mocked(generateOptionList).mockResolvedValue(null);
    vi.mocked(SessionStateManager.load).mockImplementation(function () {
      return {
        current: mgrCurrent,
        processPrompt: mgrProcessPrompt,
        markAdvisoryFired: mgrMarkAdvisoryFired,
        markDecisionSessionFired: mgrMarkDecisionSessionFired,
        hasFiredDecisionSession: mgrHasFiredDecisionSession,
        setProfile: mgrSetProfile,
        addAbsenceFlag: mgrAddAbsenceFlag,
        applyStage2SignalUpdates: mgrApplyStage2SignalUpdates,
      } as unknown as ReturnType<typeof SessionStateManager.load>;
    });
    vi.mocked(shouldFireStage2).mockReturnValue(null as unknown as ReturnType<typeof shouldFireStage2>);
    vi.mocked(IdbStorageAdapter).mockImplementation(function () {
      return {
        loadSessionState: idbLoadSessionState,
        getProjectDetectedLanguage: idbGetProjectDetectedLanguage,
        saveSessionState: idbSaveSessionState,
        saveProjectDetectedLanguage: idbSaveProjectDetectedLanguage,
      } as unknown as InstanceType<typeof IdbStorageAdapter>;
    });
    vi.mocked(makeMemoryStoragePort).mockReturnValue({
      port: {} as unknown as ReturnType<typeof makeMemoryStoragePort>['port'],
      getLatestState: getLatestStateMock,
    });
    vi.mocked(ChromeStorageKeyAdapter).mockImplementation(function () {
      return { getKey: keyStoreGetKey, setKey: keyStoreSetKey } as unknown as InstanceType<typeof ChromeStorageKeyAdapter>;
    });
    vi.mocked(BrowserClockAdapter).mockImplementation(function () {
      return { now: clockNow } as unknown as InstanceType<typeof BrowserClockAdapter>;
    });
    vi.mocked(ConsoleLogAdapter).mockImplementation(function () {
      return { debug: logDebugMock, info: vi.fn(), warn: logWarnMock } as unknown as InstanceType<typeof ConsoleLogAdapter>;
    });
    // Passthrough: the persistence decorator's own behavior has its dedicated test
    // file; here the SW's log assertions target the inner (console) adapter mocks.
    vi.mocked(PersistentLogAdapter).mockImplementation(function (inner: unknown) {
      return inner as InstanceType<typeof PersistentLogAdapter>;
    });
    vi.mocked(ContentScriptUIAdapter).mockImplementation(function () {
      return { showAdvisory: showAdvisoryMock } as unknown as InstanceType<typeof ContentScriptUIAdapter>;
    });
  });

  describe('onInstalled', () => {
    it('opens the options page on fresh install', async () => {
      const { installedListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });
      installedListener({ reason: 'install' });
      expect(openOptionsPageMock).toHaveBeenCalledOnce();
    });

    it('does not open the options page on update', async () => {
      const { installedListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });
      installedListener({ reason: 'update' });
      expect(openOptionsPageMock).not.toHaveBeenCalled();
    });

    it('reloads open agent-site tabs on update — stale content scripts from the previous generation silently DROP every capture (live 2026-07-06)', async () => {
      tabsQueryMock.mockResolvedValue([{ id: 11 }, { id: 22 }]);
      const { installedListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });
      installedListener({ reason: 'update' });

      await vi.waitFor(() => expect(tabsReloadMock).toHaveBeenCalledTimes(2));
      expect(tabsQueryMock).toHaveBeenCalledWith({
        url: ['https://*.replit.com/*', 'https://bolt.new/*', 'https://*.stackblitz.com/*', 'https://lovable.dev/*'],
      });
      expect(tabsReloadMock).toHaveBeenCalledWith(11);
      expect(tabsReloadMock).toHaveBeenCalledWith(22);
    });

    it('reloads agent tabs on fresh install too (any onInstalled = new generation)', async () => {
      tabsQueryMock.mockResolvedValue([{ id: 7 }]);
      const { installedListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });
      installedListener({ reason: 'install' });

      await vi.waitFor(() => expect(tabsReloadMock).toHaveBeenCalledWith(7));
      expect(openOptionsPageMock).toHaveBeenCalledOnce();
    });

    it('skips tabs without an id and survives a tabs.query failure', async () => {
      tabsQueryMock.mockRejectedValue(new Error('no permission'));
      const { installedListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });
      installedListener({ reason: 'update' });

      await vi.waitFor(() => expect(logWarnMock).toHaveBeenCalledWith('agent_tab_reload_failed', expect.anything()));
      expect(tabsReloadMock).not.toHaveBeenCalled();
    });
  });

  describe('onMessage routing', () => {
    it('keeps the channel open for nexpath:response-stop and resolves {ok:true} when nothing is queued', async () => {
      // response-stop is now async (it shows any queued advisory — CLI popup-on-Stop
      // timing), so it keeps the channel open and resolves via the Promise, like
      // prompt-submit. With no pending advisory (getKey → null) it shows nothing.
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });
      const sendResponse = vi.fn();
      const keepOpen = messageListener(
        { type: 'nexpath:response-stop', projectRoot: 'https://replit.com', agent: 'replit', tabId: 1 },
        {},
        sendResponse,
      );
      expect(keepOpen).toBe(true);
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
      expect(showAdvisoryMock).not.toHaveBeenCalled();
    });

    it('logs response_stop_received so receipt is directly visible in the console, not just inferred', async () => {
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });
      const logInstance = vi.mocked(ConsoleLogAdapter).mock.results.at(-1)!.value as { debug: ReturnType<typeof vi.fn> };

      messageListener(
        { type: 'nexpath:response-stop', projectRoot: 'https://replit.com', agent: 'replit', tabId: 1 },
        {},
        vi.fn(),
      );

      expect(logInstance.debug).toHaveBeenCalledWith('response_stop_received', { agent: 'replit', projectRoot: 'https://replit.com' });
    });

    it('logs prompt_submit_received immediately on receipt, before the pipeline resolves', async () => {
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });
      const logInstance = vi.mocked(ConsoleLogAdapter).mock.results.at(-1)!.value as { debug: ReturnType<typeof vi.fn> };

      messageListener(
        { type: 'nexpath:prompt-submit', promptText: 'hi', projectRoot: 'https://replit.com', agent: 'replit', tabId: 7 },
        {},
        vi.fn(),
      );

      expect(logInstance.debug).toHaveBeenCalledWith('prompt_submit_received', { agent: 'replit', projectRoot: 'https://replit.com' });
    });

    it('ignores unrecognized message shapes, responding with undefined', async () => {
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });
      const sendResponse = vi.fn();
      const keepOpen = messageListener({ type: 'nexpath:something-else' }, {}, sendResponse);
      expect(sendResponse).toHaveBeenCalledWith(undefined);
      expect(keepOpen).toBe(true);
    });

    it('keeps the channel open for nexpath:prompt-submit and resolves {ok:true} when no stage2 trigger fires', async () => {
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });

      const sendResponse = vi.fn();
      const keepOpen = messageListener(
        { type: 'nexpath:prompt-submit', promptText: 'hi', projectRoot: 'https://replit.com', agent: 'replit', tabId: 7 },
        {},
        sendResponse,
      );
      expect(keepOpen).toBe(true);

      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
      expect(classifyPrompt).toHaveBeenCalledOnce();
      expect(mgrProcessPrompt).toHaveBeenCalledOnce();
      expect(idbSaveSessionState).toHaveBeenCalled();
      expect(runStage2).not.toHaveBeenCalled();
    });

    it('skips stage2 and resolves {ok:true} when a trigger fires but no API key is configured', async () => {
      vi.mocked(shouldFireStage2).mockReturnValue({ kind: 'stage_transition' } as unknown as ReturnType<typeof shouldFireStage2>);
      keyStoreGetKey.mockResolvedValue(null);
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });

      const sendResponse = vi.fn();
      messageListener(
        { type: 'nexpath:prompt-submit', promptText: 'hi', projectRoot: 'https://replit.com', agent: 'replit', tabId: 7 },
        {},
        sendResponse,
      );
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
      expect(runStage2).not.toHaveBeenCalled();
      expect(showAdvisoryMock).not.toHaveBeenCalled();
    });

    it('resolves {ok:false} and does not throw when classifyPrompt rejects', async () => {
      vi.mocked(classifyPrompt).mockRejectedValue(new Error('classification blew up'));
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });

      const sendResponse = vi.fn();
      messageListener(
        { type: 'nexpath:prompt-submit', promptText: 'hi', projectRoot: 'https://replit.com', agent: 'replit', tabId: 7 },
        {},
        sendResponse,
      );
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: false }));
    });

    it('QUEUES the advisory on submit (does NOT show yet) when stage2 fires and the key is present — CLI popup-on-Stop timing', async () => {
      vi.mocked(shouldFireStage2).mockReturnValue({ kind: 'stage_transition' } as unknown as ReturnType<typeof shouldFireStage2>);
      // Promise.all calls getKey in declared order: openai_api_key, then
      // advisory_frequency, then role — mockResolvedValueOnce answers only the
      // first, leaving the beforeEach's null default for the other two (a blanket
      // mockResolvedValue here would wrongly feed 'sk-real-key' into
      // resolveFrequencyConfig too, since it now answers all 3 calls in this test).
      keyStoreGetKey.mockResolvedValueOnce('sk-real-key');
      vi.mocked(runStage2).mockResolvedValue({ fire_decision_session: true } as unknown as Awaited<ReturnType<typeof runStage2>>);
      vi.mocked(resolveDecisionContent).mockReturnValue({
        L1: [{ option: 'Write tests', descBase: 'body' }],
        L2: [{ option: 'Write one test', descBase: 'body' }],
        L3: [{ option: 'TODO comment', descBase: 'body' }],
        pinchFallback: 'fallback pinch',
      } as unknown as ReturnType<typeof resolveDecisionContent>);
      vi.mocked(generatePinchLabel).mockResolvedValue('Hold up.');

      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });
      const sendResponse = vi.fn();
      messageListener(
        { type: 'nexpath:prompt-submit', promptText: 'hi', projectRoot: 'https://replit.com', agent: 'replit', tabId: 42 },
        {},
        sendResponse,
      );

      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
      // Shown on the response-stop event, NOT at submit.
      expect(showAdvisoryMock).not.toHaveBeenCalled();
      // The built payload is queued for this project.
      const payload = pendingPayload();
      expect(payload).toMatchObject({
        schemaVersion: 1,
        pinchLabel: 'Hold up.',
        stage: 'implementation',
        options: [
          { id: 'l1-0', level: 'L1', title: 'Write tests', body: 'body' },
          { id: 'l2-0', level: 'L2', title: 'Write one test', body: 'body' },
          { id: 'l3-0', level: 'L3', title: 'TODO comment', body: 'body' },
        ],
        meta: { agent: 'replit', frequency: 'every_event' },
      });
      // Bookkeeping still happens at decision time (CLI auto parity).
      expect(mgrMarkAdvisoryFired).toHaveBeenCalledOnce();
      expect(mgrMarkDecisionSessionFired).toHaveBeenCalledOnce();
    });

    it('does not attempt to show an advisory when there is no tab id', async () => {
      vi.mocked(shouldFireStage2).mockReturnValue({ kind: 'stage_transition' } as unknown as ReturnType<typeof shouldFireStage2>);
      // See the previous test's comment — Once, not blanket, so frequency/role
      // calls still get the beforeEach's null default.
      keyStoreGetKey.mockResolvedValueOnce('sk-real-key');
      vi.mocked(runStage2).mockResolvedValue({ fire_decision_session: true } as unknown as Awaited<ReturnType<typeof runStage2>>);
      vi.mocked(resolveDecisionContent).mockReturnValue({
        L1: [], L2: [], L3: [], pinchFallback: 'fallback',
      } as unknown as ReturnType<typeof resolveDecisionContent>);
      vi.mocked(generatePinchLabel).mockResolvedValue('Hold up.');

      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });
      const sendResponse = vi.fn();
      messageListener(
        { type: 'nexpath:prompt-submit', promptText: 'hi', projectRoot: 'https://replit.com', agent: 'replit', tabId: 0 },
        {},
        sendResponse,
      );

      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
      expect(showAdvisoryMock).not.toHaveBeenCalled();
    });
  });

  describe('advisory frequency + role gating (mirrors cli/commands/auto.ts)', () => {
    // Promise.all calls getKey in declared order: openai_api_key, advisory_frequency,
    // role, then the cross-page dedup record — queue exactly 3 Once values for the
    // first three; the 4th call falls through to the default mockResolvedValue(null)
    // (no prior prompt recorded → dedup guard passes).
    function mockKeyStore(apiKey: string | null, freq: string | null, role: string | null): void {
      keyStoreGetKey.mockResolvedValueOnce(apiKey).mockResolvedValueOnce(freq).mockResolvedValueOnce(role);
    }

    it('freq "off" fast-exits before shouldFireStage2 is ever called', async () => {
      mockKeyStore('sk-real-key', 'off', null);
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });

      const sendResponse = vi.fn();
      messageListener(
        { type: 'nexpath:prompt-submit', promptText: 'hi', projectRoot: 'https://replit.com', agent: 'replit', tabId: 7 },
        {},
        sendResponse,
      );
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
      expect(shouldFireStage2).not.toHaveBeenCalled();
      expect(runStage2).not.toHaveBeenCalled();
    });

    it('blocks when promptCount is below the configured frequency level\'s minPromptsBeforeAdvisory', async () => {
      // major_only requires 5 prompts before any advisory; mgrCurrent.promptCount is 3.
      mockKeyStore('sk-real-key', 'major_only', null);
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });

      const sendResponse = vi.fn();
      messageListener(
        { type: 'nexpath:prompt-submit', promptText: 'hi', projectRoot: 'https://replit.com', agent: 'replit', tabId: 7 },
        {},
        sendResponse,
      );
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
      expect(shouldFireStage2).not.toHaveBeenCalled();
    });

    it('dedups — does not re-run stage2 for a stage_transition event already recorded as fired this session', async () => {
      vi.mocked(shouldFireStage2).mockReturnValue({ kind: 'stage_transition' } as unknown as ReturnType<typeof shouldFireStage2>);
      mgrHasFiredDecisionSession.mockReturnValue(true);
      mockKeyStore('sk-real-key', 'every_event', null);
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });

      const sendResponse = vi.fn();
      messageListener(
        { type: 'nexpath:prompt-submit', promptText: 'hi', projectRoot: 'https://replit.com', agent: 'replit', tabId: 7 },
        {},
        sendResponse,
      );
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
      expect(runStage2).not.toHaveBeenCalled();
    });

    it('major_only blocks an absence-triggered advisory but allows a stage_transition one through', async () => {
      vi.mocked(shouldFireStage2).mockReturnValue({
        kind: 'absence',
        qualifyingFlags: [{ signalKey: 'x' }],
      } as unknown as ReturnType<typeof shouldFireStage2>);
      mockKeyStore('sk-real-key', 'major_only', null);
      mgrCurrent.promptCount = 5; // clears major_only's minPromptsBeforeAdvisory gate
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });

      const sendResponse = vi.fn();
      messageListener(
        { type: 'nexpath:prompt-submit', promptText: 'hi', projectRoot: 'https://replit.com', agent: 'replit', tabId: 7 },
        {},
        sendResponse,
      );
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
      expect(runStage2).not.toHaveBeenCalled();
    });

    it('once_per_session blocks a second advisory in the same session', async () => {
      vi.mocked(shouldFireStage2).mockReturnValue({ kind: 'stage_transition' } as unknown as ReturnType<typeof shouldFireStage2>);
      mockKeyStore('sk-real-key', 'once_per_session', null);
      mgrCurrent.promptCount = 10; // clears once_per_session's minPromptsBeforeAdvisory gate
      mgrCurrent.firedDecisionSessions = ['stage_transition:idea→implementation'];
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });

      const sendResponse = vi.fn();
      messageListener(
        { type: 'nexpath:prompt-submit', promptText: 'hi', projectRoot: 'https://replit.com', agent: 'replit', tabId: 7 },
        {},
        sendResponse,
      );
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
      expect(runStage2).not.toHaveBeenCalled();
    });

    it('post-advisory cooldown blocks a second advisory fired too soon after the last one', async () => {
      vi.mocked(shouldFireStage2).mockReturnValue({ kind: 'stage_transition' } as unknown as ReturnType<typeof shouldFireStage2>);
      mockKeyStore('sk-real-key', 'every_event', null); // postAdvisoryCooldown = 5
      mgrCurrent.promptCount = 4;
      mgrCurrent.lastAdvisoryPromptIndex = 2; // only 2 prompts since the last advisory — inside the 5-prompt cooldown
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });

      const sendResponse = vi.fn();
      messageListener(
        { type: 'nexpath:prompt-submit', promptText: 'hi', projectRoot: 'https://replit.com', agent: 'replit', tabId: 7 },
        {},
        sendResponse,
      );
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
      expect(runStage2).not.toHaveBeenCalled();
    });

    it('session advisory cap blocks further advisories once the default cap is reached', async () => {
      vi.mocked(shouldFireStage2).mockReturnValue({ kind: 'stage_transition' } as unknown as ReturnType<typeof shouldFireStage2>);
      mockKeyStore('sk-real-key', 'every_event', null); // sessionAdvisoryCapDefault = 5
      mgrCurrent.promptCount = 20;
      mgrCurrent.advisoryCount = 5;
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });

      const sendResponse = vi.fn();
      messageListener(
        { type: 'nexpath:prompt-submit', promptText: 'hi', projectRoot: 'https://replit.com', agent: 'replit', tabId: 7 },
        {},
        sendResponse,
      );
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
      expect(runStage2).not.toHaveBeenCalled();
    });

    it('passes frequency-derived minConfidence/contextWindow overrides into runStage2', async () => {
      vi.mocked(shouldFireStage2).mockReturnValue({ kind: 'stage_transition' } as unknown as ReturnType<typeof shouldFireStage2>);
      vi.mocked(runStage2).mockResolvedValue({ fire_decision_session: false } as unknown as Awaited<ReturnType<typeof runStage2>>);
      mockKeyStore('sk-real-key', 'major_only', null); // stage2MinConfidence=0.49, stage2ContextWindow=10
      mgrCurrent.promptCount = 5;
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });

      const sendResponse = vi.fn();
      messageListener(
        { type: 'nexpath:prompt-submit', promptText: 'hi', projectRoot: 'https://replit.com', agent: 'replit', tabId: 7 },
        {},
        sendResponse,
      );
      await vi.waitFor(() => expect(runStage2).toHaveBeenCalledOnce());
      expect(runStage2).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        { minConfidence: 0.49, contextWindow: 10 },
      );
    });

    it('injects the configured role into an existing profile', async () => {
      mgrCurrent.profile = {
        nature: 'hardcore_pro',
        precisionScore: 8,
        playfulnessScore: 2,
        precisionOrdinal: 'high',
        playfulnessOrdinal: 'low',
        mood: 'focused',
        depth: 'high',
        depthScore: 8,
        computedAt: 1,
        role: null,
      };
      mockKeyStore('sk-real-key', 'every_event', 'pm');
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });

      const sendResponse = vi.fn();
      messageListener(
        { type: 'nexpath:prompt-submit', promptText: 'hi', projectRoot: 'https://replit.com', agent: 'replit', tabId: 7 },
        {},
        sendResponse,
      );
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
      expect(mgrSetProfile).toHaveBeenCalledWith(expect.objectContaining({ role: 'pm' }));
    });

    it('does not inject role when no profile exists yet (LLM profile classification not wired in the browser yet)', async () => {
      mockKeyStore('sk-real-key', 'every_event', 'pm');
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });

      const sendResponse = vi.fn();
      messageListener(
        { type: 'nexpath:prompt-submit', promptText: 'hi', projectRoot: 'https://replit.com', agent: 'replit', tabId: 7 },
        {},
        sendResponse,
      );
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
      expect(mgrSetProfile).not.toHaveBeenCalled();
    });
  });

  describe('cross-page prompt dedup (Bolt landing→project double-capture)', () => {
    // The dedup record is read via the 4th getKey in the Promise.all; a name-aware
    // implementation answers only that key so the config keys keep their defaults.
    function mockDedupRecord(record: { text: string; at: number } | null): void {
      keyStoreGetKey.mockImplementation(async (name: string) =>
        name.startsWith('nexpath_last_prompt::') && record ? JSON.stringify(record) : null,
      );
    }

    function submit(messageListener: MessageListener, promptText: string): ReturnType<typeof vi.fn> {
      const sendResponse = vi.fn();
      messageListener(
        { type: 'nexpath:prompt-submit', promptText, projectRoot: 'https://bolt.new', agent: 'bolt', tabId: 7 },
        {},
        sendResponse,
      );
      return sendResponse;
    }

    it('skips the whole pipeline when the same text repeats within the window', async () => {
      mockDedupRecord({ text: 'Add a hero section component', at: 900 }); // clock.now() = 1000 → 100ms old
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });

      const sendResponse = submit(messageListener, 'Add a hero section component');
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
      expect(classifyPrompt).not.toHaveBeenCalled();
      expect(mgrProcessPrompt).not.toHaveBeenCalled();
      expect(logDebugMock).toHaveBeenCalledWith('prompt_submit_deduped', expect.objectContaining({ projectRoot: 'https://bolt.new' }));
    });

    it('processes normally when the text differs and records the new prompt', async () => {
      mockDedupRecord({ text: 'Add a hero section component', at: 900 });
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });

      const sendResponse = submit(messageListener, 'Implement a card layout');
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
      expect(classifyPrompt).toHaveBeenCalledOnce();
      expect(keyStoreSetKey).toHaveBeenCalledWith(
        'nexpath_last_prompt::https://bolt.new',
        JSON.stringify({ text: 'Implement a card layout', at: 1000 }),
      );
    });

    it('processes normally when the identical text arrives after the window has expired', async () => {
      mockDedupRecord({ text: 'Add a hero section component', at: 1000 - 200_000 });
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });

      const sendResponse = submit(messageListener, 'Add a hero section component');
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
      expect(classifyPrompt).toHaveBeenCalledOnce();
    });

    it('treats a malformed stored record as absent and processes normally', async () => {
      keyStoreGetKey.mockImplementation(async (name: string) =>
        name.startsWith('nexpath_last_prompt::') ? 'not-json{{{' : null,
      );
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });

      const sendResponse = submit(messageListener, 'Add a hero section component');
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
      expect(classifyPrompt).toHaveBeenCalledOnce();
    });
  });

  describe('stage-2 outcome observability (the LLM verdict must never be silent)', () => {
    function mockKeyStore3(apiKey: string | null, freq: string | null, role: string | null): void {
      keyStoreGetKey.mockResolvedValueOnce(apiKey).mockResolvedValueOnce(freq).mockResolvedValueOnce(role);
    }

    it('logs stage2_started and a stage2_result with fire:false + reason when the LLM declines', async () => {
      vi.mocked(shouldFireStage2).mockReturnValue({ kind: 'stage_transition' } as unknown as ReturnType<typeof shouldFireStage2>);
      vi.mocked(runStage2).mockResolvedValue({
        fire_decision_session: false,
        stage: 'release',
        stage_confidence: 0.9,
        reason: 'testing practices already demonstrated',
      } as unknown as Awaited<ReturnType<typeof runStage2>>);
      mockKeyStore3('sk-real-key', 'every_event', null);
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });

      const sendResponse = vi.fn();
      messageListener(
        { type: 'nexpath:prompt-submit', promptText: 'ship it', projectRoot: 'https://bolt.new', agent: 'bolt', tabId: 7 },
        {},
        sendResponse,
      );
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
      expect(logDebugMock).toHaveBeenCalledWith('stage2_started', expect.objectContaining({ trigger: 'stage_transition' }));
      expect(logDebugMock).toHaveBeenCalledWith('stage2_result', expect.objectContaining({
        fire: false,
        reason: 'testing practices already demonstrated',
      }));
      expect(showAdvisoryMock).not.toHaveBeenCalled();
      // The verdict must also be persisted — SW console lines die with the SW (MV3),
      // so this record is the only after-the-fact answer to "why no advisory?".
      expect(keyStoreSetKey).toHaveBeenCalledWith(
        'nexpath_last_stage2_result',
        expect.stringContaining('"reason":"testing practices already demonstrated"'),
      );
    });

    it('persists a stage-2 ERROR record when runStage2 throws', async () => {
      vi.mocked(shouldFireStage2).mockReturnValue({ kind: 'stage_transition' } as unknown as ReturnType<typeof shouldFireStage2>);
      vi.mocked(runStage2).mockRejectedValue(new Error('AbortError: timeout'));
      mockKeyStore3('sk-real-key', 'every_event', null);
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });

      const sendResponse = vi.fn();
      messageListener(
        { type: 'nexpath:prompt-submit', promptText: 'ship it', projectRoot: 'https://bolt.new', agent: 'bolt', tabId: 7 },
        {},
        sendResponse,
      );
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
      expect(keyStoreSetKey).toHaveBeenCalledWith(
        'nexpath_last_stage2_result',
        expect.stringContaining('AbortError: timeout'),
      );
    });

    it('logs stage2_result with fire:true and QUEUES the advisory (shown on response-stop, not at submit)', async () => {
      vi.mocked(shouldFireStage2).mockReturnValue({ kind: 'stage_transition' } as unknown as ReturnType<typeof shouldFireStage2>);
      vi.mocked(runStage2).mockResolvedValue({
        fire_decision_session: true,
        stage: 'release',
        stage_confidence: 0.95,
        reason: 'release transition without testing evidence',
      } as unknown as Awaited<ReturnType<typeof runStage2>>);
      vi.mocked(resolveDecisionContent).mockReturnValue({
        L1: [{ option: 'Run tests', descBase: 'd' }],
        L2: [],
        L3: [],
        pinchFallback: 'Final Review',
      } as unknown as ReturnType<typeof resolveDecisionContent>);
      vi.mocked(generatePinchLabel).mockResolvedValue('Final Review');
      mockKeyStore3('sk-real-key', 'every_event', null);
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });

      const sendResponse = vi.fn();
      messageListener(
        { type: 'nexpath:prompt-submit', promptText: 'ship it', projectRoot: 'https://bolt.new', agent: 'bolt', tabId: 7 },
        {},
        sendResponse,
      );
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
      expect(logDebugMock).toHaveBeenCalledWith('stage2_result', expect.objectContaining({ fire: true }));
      // Popup-on-Stop timing: queued now, not shown yet.
      expect(logDebugMock).toHaveBeenCalledWith('advisory_pending', expect.objectContaining({ stage: 'implementation' }));
      expect(showAdvisoryMock).not.toHaveBeenCalled();
      // The verdict record must persist on the FIRE path too, not just declines/errors.
      expect(keyStoreSetKey).toHaveBeenCalledWith(
        'nexpath_last_stage2_result',
        expect.stringContaining('"fire":true'),
      );
    });
  });

  describe('CLI-parity payload enrichment (question + whyHelp + per-level option lists)', () => {
    function primeFirePath(whyHelpEntry: unknown): void {
      vi.mocked(shouldFireStage2).mockReturnValue({ kind: 'stage_transition' } as unknown as ReturnType<typeof shouldFireStage2>);
      keyStoreGetKey.mockResolvedValueOnce('sk-real-key'); // api-key; freq/role/proj → null default
      vi.mocked(runStage2).mockResolvedValue({ fire_decision_session: true } as unknown as Awaited<ReturnType<typeof runStage2>>);
      vi.mocked(resolveDecisionContent).mockReturnValue({
        question: 'Before shipping — has it been reviewed and tested?',
        whyHelp: whyHelpEntry,
        // L1 has TWO options — the CLI-parity list the shipped flat `options` view can't carry.
        L1: [{ option: 'Run the full suite', descBase: 'b1' }, { option: 'Run a focused review', descBase: 'b2' }],
        L2: [{ option: 'Quick check', descBase: 'b3' }],
        L3: [{ option: 'TODO comment', descBase: 'b4' }],
        pinchFallback: 'fallback',
      } as unknown as ReturnType<typeof resolveDecisionContent>);
      vi.mocked(generatePinchLabel).mockResolvedValue('Before you ship.');
      showAdvisoryMock.mockResolvedValue({ type: 'dismiss', advisoryId: 'x' });
    }

    it('sends question, per-level option ARRAYS, and a flat options view that is the first of each level', async () => {
      primeFirePath(undefined); // no why-help entry → composeWhyHelpBlock returns null
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });
      const sr = vi.fn();
      messageListener(
        { type: 'nexpath:prompt-submit', promptText: 'ship it', projectRoot: 'https://replit.com', agent: 'replit', tabId: 9 },
        {}, sr,
      );
      await vi.waitFor(() => expect(sr).toHaveBeenCalledWith({ ok: true }));
      // The enriched payload is what gets QUEUED (shown later on response-stop).
      const payload = pendingPayload();

      expect(payload.question).toBe('Before shipping — has it been reviewed and tested?');
      expect(payload.whyHelp).toBeNull();
      expect(payload.levels.L1).toEqual([
        { id: 'l1-0', level: 'L1', title: 'Run the full suite', body: 'b1' },
        { id: 'l1-1', level: 'L1', title: 'Run a focused review', body: 'b2' },
      ]);
      expect(payload.levels.L2).toEqual([{ id: 'l2-0', level: 'L2', title: 'Quick check', body: 'b3' }]);
      expect(payload.levels.L3).toEqual([{ id: 'l3-0', level: 'L3', title: 'TODO comment', body: 'b4' }]);
      // Shipped-panel back-compat: flat view = first of each level, same ids as before.
      expect(payload.options).toEqual([
        { id: 'l1-0', level: 'L1', title: 'Run the full suite', body: 'b1' },
        { id: 'l2-0', level: 'L2', title: 'Quick check', body: 'b3' },
        { id: 'l3-0', level: 'L3', title: 'TODO comment', body: 'b4' },
      ]);
    });

    it('composes a non-null whyHelp block when the stage has a why-help entry (real composeWhyHelpBlock)', async () => {
      primeFirePath(WHY_HELP_BY_SIGNAL_TYPE['IDEA_TO_PRD']);
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });
      const sr = vi.fn();
      messageListener(
        { type: 'nexpath:prompt-submit', promptText: 'ship it', projectRoot: 'https://replit.com', agent: 'replit', tabId: 9 },
        {}, sr,
      );
      await vi.waitFor(() => expect(sr).toHaveBeenCalledWith({ ok: true }));
      const payload = pendingPayload();
      expect(typeof payload.whyHelp).toBe('string');
      expect((payload.whyHelp as string).length).toBeGreaterThan(0);
    });

    it('does NOT run the option generator at submit — queuing stays instant (regression guard)', async () => {
      // Regression: running generateOptionList (2 LLM calls) on the submit path delayed
      // persisting the pending advisory, so a fast agent response reached response-stop
      // before the advisory was queued → missed popup. Option-gen must run at STOP only.
      primeFirePath(undefined);
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });
      const sr = vi.fn();
      messageListener(
        { type: 'nexpath:prompt-submit', promptText: 'ship it', projectRoot: 'https://replit.com', agent: 'replit', tabId: 9 },
        {}, sr,
      );
      await vi.waitFor(() => expect(sr).toHaveBeenCalledWith({ ok: true }));
      expect(generateOptionList).not.toHaveBeenCalled();
      // Queued payload carries STATIC option text (raw desc-base) — personalised later, at stop.
      const payload = pendingPayload() as unknown as { levels: { L1: { title: string; body: string }[] } };
      expect(payload.levels.L1[0]).toMatchObject({ title: 'Run the full suite', body: 'b1' });
    });
  });

  describe('response-stop shows the queued advisory (CLI popup-on-Stop timing)', () => {
    const P = 'https://replit.com';
    const PENDING_KEY = 'nexpath_pending_advisory::https://replit.com';
    const samplePayload = {
      schemaVersion: 1, advisoryId: 'adv-queued', pinchLabel: 'Hold up.', stage: 'implementation',
      question: 'q', whyHelp: null, levels: { L1: [], L2: [], L3: [] }, options: [],
      meta: { agent: 'replit', frequency: 'every_event' },
    };
    function stop(messageListener, tabId) {
      const sendResponse = vi.fn();
      messageListener(
        { type: 'nexpath:response-stop', projectRoot: P, agent: 'replit', tabId: 0 },
        tabId === undefined ? {} : { tab: { id: tabId } },
        sendResponse,
      );
      return sendResponse;
    }

    it('shows the pending advisory when the agent finishes, logs advisory_showing, and clears the pending key', async () => {
      keyStoreGetKey.mockImplementation(async (name) => (name === PENDING_KEY ? JSON.stringify(samplePayload) : null));
      showAdvisoryMock.mockResolvedValue({ type: 'dismiss', advisoryId: 'adv-queued' });
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });

      const sendResponse = stop(messageListener, 55);
      await vi.waitFor(() => expect(showAdvisoryMock).toHaveBeenCalledOnce());
      expect(showAdvisoryMock).toHaveBeenCalledWith(expect.objectContaining({ advisoryId: 'adv-queued' }));
      expect(ContentScriptUIAdapter).toHaveBeenCalledWith(55); // uses the STOP event's tab
      expect(logDebugMock).toHaveBeenCalledWith('advisory_showing', expect.objectContaining({ tabId: 55 }));
      expect(keyStoreSetKey).toHaveBeenCalledWith(PENDING_KEY, ''); // cleared after read
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
    });

    it('personalises titles + resolves desc bodies at STOP (CLI stop.ts parity), then shows', async () => {
      const OG_KEY = 'nexpath_pending_advisory_og::https://replit.com';
      const og = {
        stage: 'implementation', flagType: 'stage_transition', prevStage: 'implementation',
        promptsInCurrentStage: 3, language: null, profile: null, promptHistory: [],
      };
      keyStoreGetKey.mockImplementation(async (name) => {
        if (name === PENDING_KEY) return JSON.stringify(samplePayload);
        if (name === OG_KEY) return JSON.stringify(og);
        if (name === 'openai_api_key') return 'sk-real-key';
        return null;
      });
      vi.mocked(resolveDecisionContent).mockReturnValue({
        question: 'q', whyHelp: null,
        L1: [{ option: 'static L1', descBase: 'static b1' }],
        L2: [{ option: 'static L2', descBase: 'static b2' }],
        L3: [{ option: 'static L3', descBase: 'static b3' }],
        pinchFallback: 'f',
      } as unknown as ReturnType<typeof resolveDecisionContent>);
      vi.mocked(generateOptionList).mockResolvedValueOnce({
        l1: ['Personalised L1'], l2: ['Personalised L2'], l3: ['Personalised L3'],
        generatedDescBases: { l1: ['resolved body 1'], l2: ['resolved body 2'], l3: ['resolved body 3'] },
      } as unknown as Awaited<ReturnType<typeof generateOptionList>>);
      showAdvisoryMock.mockResolvedValue({ type: 'dismiss', advisoryId: 'adv-queued' });
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });

      stop(messageListener, 55);
      await vi.waitFor(() => expect(showAdvisoryMock).toHaveBeenCalledOnce());
      expect(generateOptionList).toHaveBeenCalledOnce();
      const shown = showAdvisoryMock.mock.calls[0]?.[0] as unknown as {
        levels: { L1: { title: string; body: string }[] };
        options: { title: string; body: string }[];
      };
      expect(shown.levels.L1[0]).toMatchObject({ title: 'Personalised L1', body: 'resolved body 1' });
      expect(shown.options[0]).toMatchObject({ title: 'Personalised L1', body: 'resolved body 1' });
    });

    it('shows the STATIC queued payload when personalisation fails (no missed popup)', async () => {
      keyStoreGetKey.mockImplementation(async (name) => {
        if (name === PENDING_KEY) return JSON.stringify({ ...samplePayload, options: [{ id: 'l1-0', level: 'L1', title: 'static title', body: 'raw {R4_OPEN}' }] });
        if (name === 'nexpath_pending_advisory_og::https://replit.com') return JSON.stringify({ stage: 'implementation', flagType: 'stage_transition', prevStage: null, promptsInCurrentStage: 1, language: null, profile: null, promptHistory: [] });
        if (name === 'openai_api_key') return 'sk-real-key';
        return null;
      });
      vi.mocked(generateOptionList).mockResolvedValueOnce(null); // engine failed → fall back to static
      showAdvisoryMock.mockResolvedValue({ type: 'dismiss', advisoryId: 'adv-queued' });
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });

      stop(messageListener, 55);
      await vi.waitFor(() => expect(showAdvisoryMock).toHaveBeenCalledOnce());
      const shown = showAdvisoryMock.mock.calls[0]?.[0] as unknown as { options: { title: string }[] };
      expect(shown.options[0]?.title).toBe('static title'); // popup still shows, static content
    });

    it('logs the rejection reason when the generator rejects — never a silent swallow', async () => {
      keyStoreGetKey.mockImplementation(async (name) => {
        if (name === PENDING_KEY) return JSON.stringify(samplePayload);
        if (name === 'nexpath_pending_advisory_og::https://replit.com') return JSON.stringify({ stage: 'implementation', flagType: 'stage_transition', prevStage: null, promptsInCurrentStage: 1, language: null, profile: null, promptHistory: [] });
        if (name === 'openai_api_key') return 'sk-real-key';
        return null;
      });
      vi.mocked(generateOptionList).mockRejectedValueOnce(new Error('instant network refusal'));
      showAdvisoryMock.mockResolvedValue({ type: 'dismiss', advisoryId: 'adv-queued' });
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });

      stop(messageListener, 55);
      await vi.waitFor(() => expect(showAdvisoryMock).toHaveBeenCalledOnce()); // popup never missed
      expect(logWarnMock).toHaveBeenCalledWith('advisory_personalize_rejected', expect.objectContaining({ error: expect.stringContaining('instant network refusal') }));
    });

    it('logs a guard skip (hasOg/hasApiKey) when the og sidecar or key is missing', async () => {
      keyStoreGetKey.mockImplementation(async (name) => {
        if (name === PENDING_KEY) return JSON.stringify(samplePayload);
        if (name === 'openai_api_key') return 'sk-real-key';
        return null; // og sidecar missing
      });
      showAdvisoryMock.mockResolvedValue({ type: 'dismiss', advisoryId: 'adv-queued' });
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });

      stop(messageListener, 55);
      await vi.waitFor(() => expect(showAdvisoryMock).toHaveBeenCalledOnce());
      expect(generateOptionList).not.toHaveBeenCalled();
      expect(logDebugMock).toHaveBeenCalledWith('advisory_personalize_skipped', { hasOg: false, hasApiKey: true });
    });

    it('does nothing when no advisory is queued', async () => {
      keyStoreGetKey.mockResolvedValue(null);
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });

      const sendResponse = stop(messageListener, 55);
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
      expect(showAdvisoryMock).not.toHaveBeenCalled();
    });

    it('does NOT show when frequency was switched off after queuing (Ctrl+X honoured at stop)', async () => {
      keyStoreGetKey.mockImplementation(async (name) => {
        if (name === PENDING_KEY) return JSON.stringify(samplePayload);
        if (name === 'advisory_frequency') return 'off';
        return null;
      });
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });

      const sendResponse = stop(messageListener, 55);
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
      // handleResponseStop runs detached; wait until it reaches the clear (which happens
      // before the freq-off return) before asserting the popup was suppressed.
      await vi.waitFor(() => expect(keyStoreSetKey).toHaveBeenCalledWith(PENDING_KEY, '')); // still cleared
      expect(showAdvisoryMock).not.toHaveBeenCalled();
    });

    it('does not show when the stop event has no tab id', async () => {
      keyStoreGetKey.mockImplementation(async (name) => (name === PENDING_KEY ? JSON.stringify(samplePayload) : null));
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });

      const sendResponse = stop(messageListener, undefined); // no sender.tab, msg.tabId = 0
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
      expect(showAdvisoryMock).not.toHaveBeenCalled();
    });
  });

  describe('per-project frequency override (CLI-parity Ctrl+X disable)', () => {
    it('a per-project advisory_frequency:<root>=off fast-exits even while the global setting is active', async () => {
      keyStoreGetKey.mockImplementation(async (name: string) => {
        if (name === 'openai_api_key') return 'sk-real-key';
        if (name === 'advisory_frequency') return 'every_event';        // global: on
        if (name === 'advisory_frequency:https://replit.com') return 'off'; // this project: disabled
        return null;
      });
      vi.mocked(shouldFireStage2).mockReturnValue({ kind: 'stage_transition' } as unknown as ReturnType<typeof shouldFireStage2>);
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });

      const sendResponse = vi.fn();
      messageListener(
        { type: 'nexpath:prompt-submit', promptText: 'hi', projectRoot: 'https://replit.com', agent: 'replit', tabId: 7 },
        {}, sendResponse,
      );
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
      expect(shouldFireStage2).not.toHaveBeenCalled(); // off → fast-exit, same as global off
    });

    it('the per-project override wins over the global setting in the other direction too (global off, project on)', async () => {
      keyStoreGetKey.mockImplementation(async (name: string) => {
        if (name === 'openai_api_key') return 'sk-real-key';
        if (name === 'advisory_frequency') return 'off';                       // global: disabled
        if (name === 'advisory_frequency:https://replit.com') return 'every_event'; // this project: on
        return null;
      });
      vi.mocked(shouldFireStage2).mockReturnValue({ kind: 'stage_transition' } as unknown as ReturnType<typeof shouldFireStage2>);
      vi.mocked(runStage2).mockResolvedValue({ fire_decision_session: false } as unknown as Awaited<ReturnType<typeof runStage2>>);
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });

      const sendResponse = vi.fn();
      messageListener(
        { type: 'nexpath:prompt-submit', promptText: 'hi', projectRoot: 'https://replit.com', agent: 'replit', tabId: 7 },
        {}, sendResponse,
      );
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
      expect(shouldFireStage2).toHaveBeenCalled(); // project override re-enabled → gating proceeds
    });
  });

  describe('advisory footer intents (CLI-parity panel Ctrl+X / Ctrl+T shortcuts)', () => {
    it("'disable-project' writes advisory_frequency:<root>=off and acks, without opening options", async () => {
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });
      const sendResponse = vi.fn();
      const keepOpen = messageListener(
        { type: 'nexpath:advisory-footer-intent', intent: 'disable-project', projectRoot: 'https://replit.com' },
        {}, sendResponse,
      );
      expect(keepOpen).toBe(true);
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
      expect(keyStoreSetKey).toHaveBeenCalledWith('advisory_frequency:https://replit.com', 'off');
      expect(openOptionsPageMock).not.toHaveBeenCalled();
    });

    it("'open-settings' opens the options page and acks, writing no frequency key", async () => {
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });
      const sendResponse = vi.fn();
      messageListener(
        { type: 'nexpath:advisory-footer-intent', intent: 'open-settings', projectRoot: 'https://replit.com' },
        {}, sendResponse,
      );
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
      expect(openOptionsPageMock).toHaveBeenCalledOnce();
      expect(keyStoreSetKey).not.toHaveBeenCalledWith('advisory_frequency:https://replit.com', 'off');
    });

    it('absence trigger: detector flags reach shouldFireStage2; Stage-2 SELECTED signal forms flagType + fired key (CLI auto.ts step 8)', async () => {
      const flag = { signalKey: 'TEST_CREATION', stage: 'implementation', firstAbsentAt: 0, promptCountAtDetection: 3 };
      vi.mocked(detectAbsenceFlags).mockReturnValue([flag] as never);
      vi.mocked(shouldFireStage2).mockReturnValue({ kind: 'absence', qualifyingFlags: [flag] } as unknown as ReturnType<typeof shouldFireStage2>);
      keyStoreGetKey.mockResolvedValueOnce('sk-real-key');
      vi.mocked(runStage2).mockResolvedValue({
        fire_decision_session: true,
        selected_signal_key: 'SECURITY_REVIEW_GAP',
        signals_present: ['TEST_CREATION'],
      } as unknown as Awaited<ReturnType<typeof runStage2>>);
      vi.mocked(resolveDecisionContent).mockReturnValue({
        L1: [{ option: 'o1', descBase: 'b1' }], L2: [], L3: [], pinchFallback: 'f',
      } as unknown as ReturnType<typeof resolveDecisionContent>);
      vi.mocked(generatePinchLabel).mockResolvedValue('Pinch.');

      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });
      const sendResponse = vi.fn();
      messageListener(
        { type: 'nexpath:prompt-submit', promptText: 'more code', projectRoot: 'https://replit.com', agent: 'replit', tabId: 42 },
        {}, sendResponse,
      );
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));

      // Detector output flows into the trigger decision (was hardcoded [] pre-wiring).
      expect(vi.mocked(shouldFireStage2)).toHaveBeenCalledWith(expect.anything(), undefined, [flag], expect.anything());
      // CLI 6.8: newly-detected flags persisted when the trigger is absence —
      // AND saved to IDB before the Stage-2 await (a Stage-2 error must not drop
      // them, or the detector re-flags the same signals every prompt).
      expect(mgrAddAbsenceFlag).toHaveBeenCalledWith(expect.anything(), flag);
      expect(idbSaveSessionState.mock.invocationCallOrder.some(
        (o) => o < vi.mocked(runStage2).mock.invocationCallOrder[0]!
          && o > mgrAddAbsenceFlag.mock.invocationCallOrder[0]!,
      )).toBe(true);
      // CLI 7.5: Stage-2 signal assessments fed back into the counters.
      expect(mgrApplyStage2SignalUpdates).toHaveBeenCalledWith(expect.anything(), ['TEST_CREATION']);
      // CLI step 8: the fired key uses Stage 2's SELECTED signal, not the first qualifying flag.
      expect(mgrMarkDecisionSessionFired).toHaveBeenCalledWith(expect.anything(), 'absence:SECURITY_REVIEW_GAP@implementation');
      const ogCall = keyStoreSetKey.mock.calls.find((c) => (c[0] as string).startsWith('nexpath_pending_advisory_og'));
      expect(ogCall).toBeDefined();
      expect(JSON.parse(ogCall![1] as string)).toMatchObject({ flagType: 'absence:SECURITY_REVIEW_GAP' });
    });

    it('Stream B presence runs ONLY at implementation stage with >=3 prompts in it (CLI auto.ts 2.8 gate)', async () => {
      vi.mocked(classifyStreamBPresence).mockResolvedValue({} as never);
      mgrCurrent.promptsInCurrentStage = 3;
      keyStoreGetKey.mockResolvedValueOnce('sk-real-key');
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });
      const sendResponse = vi.fn();
      messageListener(
        { type: 'nexpath:prompt-submit', promptText: 'p1', projectRoot: 'https://replit.com', agent: 'replit', tabId: 1 },
        {}, sendResponse,
      );
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
      expect(vi.mocked(classifyStreamBPresence)).toHaveBeenCalledTimes(1);

      // Below the prompt floor the gate stays closed (no LLM call).
      vi.mocked(classifyStreamBPresence).mockClear();
      mgrCurrent.promptsInCurrentStage = 1;
      keyStoreGetKey.mockResolvedValueOnce('sk-real-key');
      const sendResponse2 = vi.fn();
      messageListener(
        { type: 'nexpath:prompt-submit', promptText: 'p2', projectRoot: 'https://replit.com', agent: 'replit', tabId: 1 },
        {}, sendResponse2,
      );
      await vi.waitFor(() => expect(sendResponse2).toHaveBeenCalledWith({ ok: true }));
      expect(vi.mocked(classifyStreamBPresence)).not.toHaveBeenCalled();
    });

    it("'set-frequency' writes the CLI Ctrl+T per-project slot advisory_frequency:<root>=<value>", async () => {
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });
      const sendResponse = vi.fn();
      messageListener(
        { type: 'nexpath:advisory-footer-intent', intent: 'set-frequency', projectRoot: 'https://replit.com', value: 'optimum' },
        {}, sendResponse,
      );
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
      expect(keyStoreSetKey).toHaveBeenCalledWith('advisory_frequency:https://replit.com', 'optimum');
    });

    it("'set-role' writes role:<root>=<value>; a non-whitelisted value is rejected without a write", async () => {
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });
      const sendResponse = vi.fn();
      messageListener(
        { type: 'nexpath:advisory-footer-intent', intent: 'set-role', projectRoot: 'https://replit.com', value: 'indie_hacker' },
        {}, sendResponse,
      );
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
      expect(keyStoreSetKey).toHaveBeenCalledWith('role:https://replit.com', 'indie_hacker');

      keyStoreSetKey.mockClear();
      const sendResponse2 = vi.fn();
      messageListener(
        { type: 'nexpath:advisory-footer-intent', intent: 'set-frequency', projectRoot: 'https://replit.com', value: 'off; DROP TABLE' },
        {}, sendResponse2,
      );
      await vi.waitFor(() => expect(sendResponse2).toHaveBeenCalledWith({ ok: true }));
      expect(keyStoreSetKey).not.toHaveBeenCalled();
      expect(logWarnMock).toHaveBeenCalledWith('advisory_set_frequency_rejected', expect.anything());
    });

    it('nexpath:prompt-injected records the text in the cross-page dedup slot (injected-echo suppression)', async () => {
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });
      const sendResponse = vi.fn();
      messageListener(
        { type: 'nexpath:prompt-injected', projectRoot: 'https://replit.com', text: 'Run the full test suite' },
        {}, sendResponse,
      );
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
      const call = keyStoreSetKey.mock.calls.find((c) => c[0] === 'nexpath_last_prompt::https://replit.com');
      expect(call).toBeDefined();
      expect(JSON.parse(call![1] as string)).toMatchObject({ text: 'Run the full test suite' });
    });

    it('nexpath:advisory-terminal logs advisory_dismissed (survives SW-teardown of the round-trip)', async () => {
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });
      const sendResponse = vi.fn();
      messageListener(
        { type: 'nexpath:advisory-terminal', eventType: 'skip', advisoryId: 'adv-99' },
        {}, sendResponse,
      );
      expect(sendResponse).toHaveBeenCalledWith({ ok: true });
      expect(logDebugMock).toHaveBeenCalledWith('advisory_dismissed', { eventType: 'skip', advisoryId: 'adv-99' });
    });
  });

  describe('ensureOffscreen (Chrome offscreen document lifecycle)', () => {
    it('creates the offscreen document when none exists yet', async () => {
      hasDocumentMock.mockResolvedValue(false);
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });

      const sendResponse = vi.fn();
      messageListener(
        { type: 'nexpath:prompt-submit', promptText: 'hi', projectRoot: 'https://replit.com', agent: 'replit', tabId: 7 },
        {},
        sendResponse,
      );
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
      expect(createDocumentMock).toHaveBeenCalledWith({
        url: 'offscreen/offscreen.html',
        reasons: ['WORKERS'],
        justification: expect.any(String),
      });
    });

    it('does not recreate the offscreen document when one already exists', async () => {
      hasDocumentMock.mockResolvedValue(true);
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });

      const sendResponse = vi.fn();
      messageListener(
        { type: 'nexpath:prompt-submit', promptText: 'hi', projectRoot: 'https://replit.com', agent: 'replit', tabId: 7 },
        {},
        sendResponse,
      );
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
      expect(createDocumentMock).not.toHaveBeenCalled();
    });

    it('does not throw on Firefox, which has no chrome.offscreen API at all', async () => {
      const { messageListener } = await importFreshServiceWorker(undefined);

      const sendResponse = vi.fn();
      messageListener(
        { type: 'nexpath:prompt-submit', promptText: 'hi', projectRoot: 'https://replit.com', agent: 'replit', tabId: 7 },
        {},
        sendResponse,
      );
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
      expect(hasDocumentMock).not.toHaveBeenCalled();
      expect(createDocumentMock).not.toHaveBeenCalled();
    });
  });
});
