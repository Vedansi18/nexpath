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
const { ContentScriptUIAdapter } = await import('../content/panel-adapter.js');

const idbLoadSessionState = vi.fn();
const idbGetProjectDetectedLanguage = vi.fn();
const idbSaveSessionState = vi.fn().mockResolvedValue(undefined);
const idbSaveProjectDetectedLanguage = vi.fn().mockResolvedValue(undefined);

const keyStoreGetKey = vi.fn();
const clockNow = vi.fn().mockReturnValue(1000);

const showAdvisoryMock = vi.fn();

const mgrProcessPrompt = vi.fn();
const mgrMarkAdvisoryFired = vi.fn();
const mgrMarkDecisionSessionFired = vi.fn();
let mgrCurrent: Partial<SessionState>;

const getLatestStateMock = vi.fn();

const hasDocumentMock = vi.fn();
const createDocumentMock = vi.fn().mockResolvedValue(undefined);
const openOptionsPageMock = vi.fn();
const onInstalledAddListenerMock = vi.fn();
const onMessageAddListenerMock = vi.fn();

// browser.* (webextension-polyfill) covers everything except chrome.offscreen, which has no
// cross-browser equivalent and stays a real chrome.* global — see importFreshServiceWorker below.
vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: {
      onInstalled:     { addListener: onInstalledAddListenerMock },
      onMessage:        { addListener: onMessageAddListenerMock },
      openOptionsPage:  openOptionsPageMock,
    },
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
    };
    idbLoadSessionState.mockResolvedValue(null);
    idbGetProjectDetectedLanguage.mockResolvedValue(undefined);
    getLatestStateMock.mockReturnValue({ currentStage: 'implementation', detectedLanguage: undefined });
    keyStoreGetKey.mockResolvedValue(null);

    vi.mocked(classifyPrompt).mockResolvedValue(baseClassification());
    vi.mocked(SessionStateManager.load).mockImplementation(function () {
      return {
        current: mgrCurrent,
        processPrompt: mgrProcessPrompt,
        markAdvisoryFired: mgrMarkAdvisoryFired,
        markDecisionSessionFired: mgrMarkDecisionSessionFired,
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
      return { getKey: keyStoreGetKey } as unknown as InstanceType<typeof ChromeStorageKeyAdapter>;
    });
    vi.mocked(BrowserClockAdapter).mockImplementation(function () {
      return { now: clockNow } as unknown as InstanceType<typeof BrowserClockAdapter>;
    });
    vi.mocked(ConsoleLogAdapter).mockImplementation(function () {
      return { debug: vi.fn(), info: vi.fn(), warn: vi.fn() } as unknown as InstanceType<typeof ConsoleLogAdapter>;
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
  });

  describe('onMessage routing', () => {
    it('acknowledges nexpath:response-stop synchronously and does not keep the channel open', async () => {
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });
      const sendResponse = vi.fn();
      const keepOpen = messageListener(
        { type: 'nexpath:response-stop', projectRoot: 'https://replit.com', agent: 'replit', tabId: 1 },
        {},
        sendResponse,
      );
      expect(sendResponse).toHaveBeenCalledWith({ ok: true });
      expect(keepOpen).toBe(false);
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

    it('ignores unrecognized message shapes', async () => {
      const { messageListener } = await importFreshServiceWorker({ hasDocument: hasDocumentMock, createDocument: createDocumentMock });
      const sendResponse = vi.fn();
      const keepOpen = messageListener({ type: 'nexpath:something-else' }, {}, sendResponse);
      expect(sendResponse).not.toHaveBeenCalled();
      expect(keepOpen).toBe(false);
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
      keyStoreGetKey.mockResolvedValue('sk-real-key');
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
        meta: { agent: 'replit', frequency: 'optimum' },
      });
      expect(mgrMarkAdvisoryFired).toHaveBeenCalledOnce();
      expect(mgrMarkDecisionSessionFired).toHaveBeenCalledOnce();
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
    });

    it('does not attempt to show an advisory when there is no tab id', async () => {
      vi.mocked(shouldFireStage2).mockReturnValue({ kind: 'stage_transition' } as unknown as ReturnType<typeof shouldFireStage2>);
      keyStoreGetKey.mockResolvedValue('sk-real-key');
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
