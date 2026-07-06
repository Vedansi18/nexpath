import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ClassificationResult, SessionState } from '../../core/classifier/types.js';

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
vi.mock('../../core/decision/pinch.js', () => ({ generatePinchLabel: vi.fn() }));
vi.mock('../../decision-session/options.js', () => ({ resolveDecisionContent: vi.fn() }));
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
const { generatePinchLabel } = await import('../../core/decision/pinch.js');
const { resolveDecisionContent } = await import('../../decision-session/options.js');
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
    };
    idbLoadSessionState.mockResolvedValue(null);
    idbGetProjectDetectedLanguage.mockResolvedValue(undefined);
    getLatestStateMock.mockReturnValue({ currentStage: 'implementation', detectedLanguage: undefined });
    keyStoreGetKey.mockResolvedValue(null);
    mgrHasFiredDecisionSession.mockReturnValue(false);
    tabsQueryMock.mockResolvedValue([]);

    vi.mocked(classifyPrompt).mockResolvedValue(baseClassification());
    vi.mocked(SessionStateManager.load).mockImplementation(function () {
      return {
        current: mgrCurrent,
        processPrompt: mgrProcessPrompt,
        markAdvisoryFired: mgrMarkAdvisoryFired,
        markDecisionSessionFired: mgrMarkDecisionSessionFired,
        hasFiredDecisionSession: mgrHasFiredDecisionSession,
        setProfile: mgrSetProfile,
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
    it('acknowledges nexpath:response-stop synchronously, calling sendResponse before returning', async () => {
      // Always returns true — webextension-polyfill's OnMessageListenerCallback type
      // requires the literal `true` for the 3-arg (sendResponse) form; `false` isn't a
      // valid return for any of its 3 listener shapes, and calling sendResponse
      // synchronously before returning true is harmless (the response is already sent).
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });
      const sendResponse = vi.fn();
      const keepOpen = messageListener(
        { type: 'nexpath:response-stop', projectRoot: 'https://replit.com', agent: 'replit', tabId: 1 },
        {},
        sendResponse,
      );
      expect(sendResponse).toHaveBeenCalledWith({ ok: true });
      expect(keepOpen).toBe(true);
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

    it('runs the full pipeline through to showAdvisory when stage2 fires and the key is present', async () => {
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
      showAdvisoryMock.mockResolvedValue({ type: 'dismiss', advisoryId: 'whatever' });

      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });
      const sendResponse = vi.fn();
      messageListener(
        { type: 'nexpath:prompt-submit', promptText: 'hi', projectRoot: 'https://replit.com', agent: 'replit', tabId: 42 },
        {},
        sendResponse,
      );

      await vi.waitFor(() => expect(showAdvisoryMock).toHaveBeenCalledOnce());
      const payload = showAdvisoryMock.mock.calls[0]![0];
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
      expect(mgrMarkAdvisoryFired).toHaveBeenCalledOnce();
      expect(mgrMarkDecisionSessionFired).toHaveBeenCalledOnce();
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
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

    it('logs stage2_result with fire:true and advisory_showing on the fire path', async () => {
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
      showAdvisoryMock.mockResolvedValue({ type: 'dismiss' });
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
      expect(logDebugMock).toHaveBeenCalledWith('advisory_showing', expect.objectContaining({ tabId: 7 }));
      expect(showAdvisoryMock).toHaveBeenCalledOnce();
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
