import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// vi.hoisted lets the mocks declared here be referenced from the vi.mock
// factories below (which are themselves hoisted above the import block).
const {
  mockShowOnboarding,
  mockRegisterWebviewViewProvider,
  mockProviderCtor,
  mockPeProviderCtor,
  mockDetectHost,
  mockWorkspaceStorageDir,
  mockWindsurfCodeiumDir,
  mockEnumerateStateVscdbPaths,
  mockCreateChatHistoryWatcher,
  mockWatcherStart,
  mockWatcherStop,
  mockCreateChatEventHandler,
  mockShowInformationMessage,
  mockExistsSync,
  mockExecuteCommand,
  mockReadPendingPromptEnhancement,
  mockIsPeOriginTurn,
  mockChatInputInject,
  mockReadLatestAdvisoryMeta,
  mockReadInjectedPrompt,
  mockCreatePePoller,
  mockPePollerStart,
  mockPePollerStop,
  mockGetCommands,
} = vi.hoisted(() => ({
  mockShowOnboarding: vi.fn(),
  mockRegisterWebviewViewProvider: vi.fn(),
  mockProviderCtor: vi.fn(),
  mockPeProviderCtor: vi.fn(),
  mockDetectHost: vi.fn(() => 'vscode-generic'),
  mockWorkspaceStorageDir: vi.fn(() => null),
  mockWindsurfCodeiumDir: vi.fn(() => '/home/u/.codeium/windsurf'),
  mockEnumerateStateVscdbPaths: vi.fn(() => []),
  mockCreateChatHistoryWatcher: vi.fn(),
  mockWatcherStart: vi.fn(),
  mockWatcherStop: vi.fn(),
  mockCreateChatEventHandler: vi.fn(() => vi.fn()),
  mockShowInformationMessage: vi.fn(),
  mockExistsSync: vi.fn(() => false),
  mockExecuteCommand: vi.fn(),
  mockReadPendingPromptEnhancement: vi.fn(async () => null),
  mockIsPeOriginTurn: vi.fn(async () => false),
  mockChatInputInject: vi.fn(async () => false),
  mockReadLatestAdvisoryMeta: vi.fn(async () => null),
  mockReadInjectedPrompt: vi.fn(async () => null),
  mockCreatePePoller: vi.fn(),
  mockPePollerStart: vi.fn(),
  mockPePollerStop: vi.fn(),
  mockGetCommands: vi.fn(async () => [] as string[]),
}));

vi.mock('vscode', () => ({
  window: {
    registerWebviewViewProvider: mockRegisterWebviewViewProvider,
    showInformationMessage: mockShowInformationMessage,
    createOutputChannel: vi.fn(() => ({
      appendLine: vi.fn(),
      dispose: vi.fn(),
    })),
    createStatusBarItem: vi.fn(() => ({
      text: '',
      tooltip: '',
      command: '',
      show: vi.fn(),
      hide: vi.fn(),
      dispose: vi.fn(),
    })),
  },
  workspace: {
    workspaceFolders: undefined,
  },
  env: { appName: 'Visual Studio Code' },
  commands: {
    executeCommand: mockExecuteCommand,
    getCommands: mockGetCommands,
    registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
  },
  StatusBarAlignment: { Left: 1, Right: 2 },
}));
vi.mock('./onboarding.js', () => ({
  CONSENT_KEY: 'nexpath.consentGranted',
  showOnboardingIfNeeded: mockShowOnboarding,
}));
vi.mock('./webview/view-provider.js', () => ({
  VIEW_ID: 'nexpath.status',
  NexpathDecisionSessionViewProvider: class {
    constructor(...args: unknown[]) {
      mockProviderCtor(...args);
    }
    publishPayload(): void {}
  },
}));
vi.mock('./webview/pe-view-provider.js', () => ({
  PE_VIEW_ID: 'nexpath.promptEnhancement',
  NexpathPromptEnhancementViewProvider: class {
    private currentPayload: unknown = null;
    constructor(...args: unknown[]) {
      mockPeProviderCtor(...args);
    }
    publishPayload(payload: unknown): void {
      this.currentPayload = payload;
    }
    getCurrentPayload(): unknown {
      return this.currentPayload;
    }
  },
}));
vi.mock('./webview/prompt-injection.js', () => ({
  handleOptionSelection: vi.fn(),
}));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, existsSync: mockExistsSync };
});
vi.mock('./host-detector.js', () => ({
  detectHost: mockDetectHost,
  workspaceStorageDir: mockWorkspaceStorageDir,
  windsurfCodeiumDir: mockWindsurfCodeiumDir,
}));
vi.mock('./chat-input-injector.js', () => ({
  chatInputInject: mockChatInputInject,
  CANDIDATE_COMMANDS: { cursor: [], windsurf: [] },
}));
vi.mock('./pe-store-reader.js', () => ({
  readPendingPromptEnhancement: mockReadPendingPromptEnhancement,
}));
vi.mock('./pe-origin.js', () => ({
  isPeOriginTurn: mockIsPeOriginTurn,
}));
vi.mock('./advisory-store-reader.js', () => ({
  readLatestAdvisoryMeta: mockReadLatestAdvisoryMeta,
  readInjectedPrompt: mockReadInjectedPrompt,
}));
vi.mock('./path-enumerator.js', () => ({
  enumerateStateVscdbPaths: mockEnumerateStateVscdbPaths,
  globalStorageStateVscdbPath: () => null,
}));
vi.mock('./chat-history-watcher.js', () => ({
  createChatHistoryWatcher: mockCreateChatHistoryWatcher,
}));
vi.mock('./chat-pipeline.js', () => ({
  createChatEventHandler: mockCreateChatEventHandler,
}));
vi.mock('./ipc.js', () => ({
  spawnAuto: vi.fn(),
  spawnStop: vi.fn(),
}));
vi.mock('./advisory-fallback.js', () => ({
  createAdvisoryFallback: vi.fn(() => ({
    armIfPending: vi.fn(),
    clear: vi.fn(),
    showAdvisory: vi.fn(),
  })),
}));
vi.mock('./advisory-poller.js', () => ({
  createAdvisoryPoller: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    pollOnce: vi.fn(),
  })),
}));
vi.mock('./pe-poller.js', () => ({
  createPePoller: (...args: unknown[]) => {
    mockCreatePePoller(...args);
    return { start: mockPePollerStart, stop: mockPePollerStop, pollOnce: vi.fn() };
  },
}));

import { activate, deactivate, getViewProvider, getPeViewProvider } from './extension.js';

interface FakeContext {
  extensionUri: { __uri: true };
  subscriptions: unknown[];
  globalState: { get: <T>(k: string) => T | undefined };
}

function makeCtx(consent: boolean | undefined = undefined): FakeContext {
  return {
    extensionUri: { __uri: true },
    subscriptions: [],
    globalState: {
      get: <T>(k: string) =>
        (k === 'nexpath.consentGranted' ? (consent as T) : undefined) as
          | T
          | undefined,
    },
  };
}

describe('activate', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockShowOnboarding.mockReset();
    mockRegisterWebviewViewProvider.mockReset();
    mockProviderCtor.mockReset();
    mockPeProviderCtor.mockReset();
    mockDetectHost.mockReset().mockReturnValue('vscode-generic');
    mockWorkspaceStorageDir.mockReset().mockReturnValue(null);
    mockWindsurfCodeiumDir.mockReset().mockReturnValue('/home/u/.codeium/windsurf');
    mockEnumerateStateVscdbPaths.mockReset().mockReturnValue([]);
    mockCreateChatHistoryWatcher.mockReset().mockReturnValue({
      start: mockWatcherStart,
      stop: mockWatcherStop,
    });
    mockWatcherStart.mockReset();
    mockWatcherStop.mockReset();
    mockCreateChatEventHandler.mockReset().mockReturnValue(vi.fn());
    mockShowInformationMessage.mockReset();
    mockExistsSync.mockReset().mockReturnValue(false);
    mockExecuteCommand.mockReset().mockResolvedValue(undefined);
    mockReadPendingPromptEnhancement.mockReset().mockResolvedValue(null);
    mockIsPeOriginTurn.mockReset().mockResolvedValue(false);
    mockChatInputInject.mockReset().mockResolvedValue(false);
    mockReadLatestAdvisoryMeta.mockReset().mockResolvedValue(null);
    mockReadInjectedPrompt.mockReset().mockResolvedValue(null);
    mockCreatePePoller.mockReset();
    mockPePollerStart.mockReset();
    mockPePollerStop.mockReset();
    mockGetCommands.mockReset().mockResolvedValue([]);
    mockRegisterWebviewViewProvider.mockReturnValue({ dispose: vi.fn() });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Reset module-level state in extension.ts (deactivate clears viewProvider + watcher)
    deactivate();
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('logs the activation message', async () => {
    mockShowOnboarding.mockResolvedValueOnce(undefined);
    await activate(makeCtx() as never);
    expect(logSpy).toHaveBeenCalledWith('[nexpath] extension activated');
  });

  it('forwards the ExtensionContext to showOnboardingIfNeeded', async () => {
    mockShowOnboarding.mockResolvedValueOnce(undefined);
    const ctx = makeCtx();
    await activate(ctx as never);
    expect(mockShowOnboarding).toHaveBeenCalledOnce();
    expect(mockShowOnboarding).toHaveBeenCalledWith(ctx);
  });

  it('registers both the DS and PE view providers on every activation regardless of consent', async () => {
    mockShowOnboarding.mockResolvedValueOnce(undefined);
    await activate(makeCtx(false) as never); // user denied
    expect(mockProviderCtor).toHaveBeenCalledOnce();
    expect(mockPeProviderCtor).toHaveBeenCalledOnce();
    expect(mockRegisterWebviewViewProvider).toHaveBeenCalledTimes(2);
    expect(mockRegisterWebviewViewProvider).toHaveBeenCalledWith('nexpath.status', expect.anything());
    expect(mockRegisterWebviewViewProvider).toHaveBeenCalledWith('nexpath.promptEnhancement', expect.anything());
  });

  describe('PE onMessage wiring (P6)', () => {
    function capturedOnMessage(): (raw: unknown) => void {
      return mockPeProviderCtor.mock.calls[0]![1] as (raw: unknown) => void;
    }

    it('does nothing when no PE payload has been published yet', async () => {
      mockShowOnboarding.mockResolvedValueOnce(undefined);
      await activate(makeCtx() as never);
      logSpy.mockClear();
      capturedOnMessage()({ type: 'pe_close', actionId: 'a1' });
      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('PE event'));
    });

    it('logs a safe, redacted summary when a routable message arrives with a published payload', async () => {
      mockShowOnboarding.mockResolvedValueOnce(undefined);
      await activate(makeCtx() as never);
      const provider = getPeViewProvider() as unknown as { publishPayload: (p: unknown) => void };
      provider.publishPayload({ currentBodyId: 'body-1', bodyRevision: 3 });
      logSpy.mockClear();
      capturedOnMessage()({ type: 'pe_close', actionId: 'a1' });
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"eventType":"close_no_send"'));
    });

    it('never logs the raw edited body text — only the safe summary (raw-text leak test)', async () => {
      mockShowOnboarding.mockResolvedValueOnce(undefined);
      await activate(makeCtx() as never);
      const provider = getPeViewProvider() as unknown as { publishPayload: (p: unknown) => void };
      provider.publishPayload({ currentBodyId: 'body-1', bodyRevision: 3 });
      logSpy.mockClear();
      const MARKER = 'ZZQX_EXT_WIRING_LEAK_MARKER_4471';
      capturedOnMessage()({ type: 'pe_deliver_current_body', bodyId: 'body-1', bodyRevision: 3, bodyText: MARKER });
      const allLogs = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(allLogs).not.toContain(MARKER);
      expect(allLogs).toContain('"hasEditedBody":true');
    });

    it('does nothing for an unroutable message', async () => {
      mockShowOnboarding.mockResolvedValueOnce(undefined);
      await activate(makeCtx() as never);
      const provider = getPeViewProvider() as unknown as { publishPayload: (p: unknown) => void };
      provider.publishPayload({ currentBodyId: 'body-1', bodyRevision: 3 });
      logSpy.mockClear();
      capturedOnMessage()({ type: 'bogus_type' });
      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('PE event'));
    });
  });

  describe('PE Windsurf/Devin poller (P10)', () => {
    function capturedDeps(): {
      readPendingPe: (root: string) => Promise<unknown>;
      onDeliver: (text: string) => Promise<string>;
      onPublish?: (payload: unknown) => void;
      onOutcome?: (outcome: string) => void;
    } {
      return mockCreatePePoller.mock.calls[0]![0] as never;
    }

    it('starts the PE poller (and the DS poller) on Windsurf', async () => {
      mockShowOnboarding.mockResolvedValueOnce(undefined);
      mockDetectHost.mockReturnValueOnce('windsurf');
      await activate(makeCtx(true) as never);
      expect(mockCreatePePoller).toHaveBeenCalledOnce();
      expect(mockPePollerStart).toHaveBeenCalledOnce();
    });

    it('does not create the PE poller on cursor or plain vscode (Windsurf-only bridge)', async () => {
      mockShowOnboarding.mockResolvedValueOnce(undefined);
      mockDetectHost.mockReturnValueOnce('cursor');
      await activate(makeCtx(true) as never);
      expect(mockCreatePePoller).not.toHaveBeenCalled();
    });

    it('readPendingPe is wired to the real PE-table-only reader', async () => {
      mockShowOnboarding.mockResolvedValueOnce(undefined);
      mockDetectHost.mockReturnValueOnce('windsurf');
      mockReadPendingPromptEnhancement.mockResolvedValueOnce({
        id: 1, projectRoot: '/proj', sessionId: 's1', promptCount: 1,
        status: 'pending', createdAt: 0, requestJson: '{}', resultJson: '{}',
      });
      await activate(makeCtx(true) as never);
      const result = await capturedDeps().readPendingPe('/proj');
      expect(mockReadPendingPromptEnhancement).toHaveBeenCalledWith('/proj');
      expect(result).toEqual(expect.objectContaining({ projectRoot: '/proj' }));
    });

    it('onPublish forwards a non-null payload to the PE webview (same renderer as Cursor)', async () => {
      mockShowOnboarding.mockResolvedValueOnce(undefined);
      mockDetectHost.mockReturnValueOnce('windsurf');
      await activate(makeCtx(true) as never);
      const provider = getPeViewProvider() as unknown as { getCurrentPayload: () => unknown };
      const payload = { currentBodyId: 'body-1', bodyRevision: 3 };
      capturedDeps().onPublish?.(payload);
      expect(provider.getCurrentPayload()).toEqual(payload);
    });

    it('onPublish never crashes when given a null payload (malformed row)', async () => {
      mockShowOnboarding.mockResolvedValueOnce(undefined);
      mockDetectHost.mockReturnValueOnce('windsurf');
      await activate(makeCtx(true) as never);
      expect(() => capturedDeps().onPublish?.(null)).not.toThrow();
    });

    it('onDeliver: succeeds via the clipboard-free Cascade command when it is registered', async () => {
      mockShowOnboarding.mockResolvedValueOnce(undefined);
      mockDetectHost.mockReturnValueOnce('windsurf');
      mockGetCommands.mockResolvedValue(['windsurf.sendChatActionMessage']);
      mockExecuteCommand.mockResolvedValue(undefined);
      await activate(makeCtx(true) as never);
      const outcome = await capturedDeps().onDeliver('the enhanced body');
      expect(outcome).toBe('inserted');
    });

    it('onDeliver: fails (D-1, no clipboard fallback) when no Cascade command is registered', async () => {
      mockShowOnboarding.mockResolvedValueOnce(undefined);
      mockDetectHost.mockReturnValueOnce('windsurf');
      mockGetCommands.mockResolvedValue([]); // no candidate command available
      await activate(makeCtx(true) as never);
      const outcome = await capturedDeps().onDeliver('the enhanced body');
      expect(outcome).toBe('insert_failed_no_clipboard_fallback');
    });

    it('the poller deps carry no field that could read pending_advisories/lastInjectedPrompt (structural proof)', async () => {
      mockShowOnboarding.mockResolvedValueOnce(undefined);
      mockDetectHost.mockReturnValueOnce('windsurf');
      await activate(makeCtx(true) as never);
      const keys = Object.keys(mockCreatePePoller.mock.calls[0]![0] as object).sort();
      expect(keys).toEqual(['onDeliver', 'onOutcome', 'onPublish', 'projectRoots', 'readPendingPe']);
    });

    it('onOutcome logs the windsurf-poller-specific message for a successful insert', async () => {
      mockShowOnboarding.mockResolvedValueOnce(undefined);
      mockDetectHost.mockReturnValueOnce('windsurf');
      await activate(makeCtx(true) as never);
      logSpy.mockClear();
      capturedDeps().onOutcome?.('inserted');
      expect(logSpy).toHaveBeenCalledWith('[nexpath] windsurf PE poller insert outcome: inserted');
    });

    it('onOutcome logs the windsurf-poller-specific message for a failed insert (D-1, no clipboard fallback)', async () => {
      mockShowOnboarding.mockResolvedValueOnce(undefined);
      mockDetectHost.mockReturnValueOnce('windsurf');
      await activate(makeCtx(true) as never);
      logSpy.mockClear();
      capturedDeps().onOutcome?.('insert_failed_no_clipboard_fallback');
      expect(logSpy).toHaveBeenCalledWith(
        '[nexpath] windsurf PE poller insert outcome: insert_failed_no_clipboard_fallback',
      );
    });
  });

  describe('PE action request loop (P9)', () => {
    function capturedOnMessage(): (raw: unknown) => void {
      return mockPeProviderCtor.mock.calls[0]![1] as (raw: unknown) => void;
    }
    async function activateWithPublishedPayload(): Promise<void> {
      mockShowOnboarding.mockResolvedValueOnce(undefined);
      await activate(makeCtx() as never);
      const provider = getPeViewProvider() as unknown as { publishPayload: (p: unknown) => void };
      provider.publishPayload({ currentBodyId: 'body-1', bodyRevision: 3, currentBodyText: 'the published body' });
    }

    it.each([
      ['pe_directional_action', { actionType: 'shorter' }, 'shorter'],
      ['pe_directional_action', { actionType: 'more_thorough' }, 'more_thorough'],
      ['pe_directional_action', { actionType: 'more_project_grounded' }, 'more_project_grounded'],
    ] as const)('%s (actionType=%s): builds a typed action request logged as ok:true', async (type, extra, expectedActionType) => {
      await activateWithPublishedPayload();
      logSpy.mockClear();
      capturedOnMessage()({ type, bodyId: 'body-1', bodyRevision: 3, ...extra });
      const logs = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(logs).toContain('PE action request:');
      expect(logs).toContain(`"actionType":"${expectedActionType}"`);
      expect(logs).toContain('"ok":true');
    });

    it('a directional action with a dirty body edit carries dirtyDraftDisposition=discarded_for_canonical_action', async () => {
      await activateWithPublishedPayload();
      logSpy.mockClear();
      capturedOnMessage()({ type: 'pe_directional_action', actionType: 'shorter', bodyId: 'body-1', bodyRevision: 3, hasDirtyBodyEdit: true });
      const logs = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(logs).toContain('"dirtyDraftDisposition":"discarded_for_canonical_action"');
    });

    it('a directional action with a clean body carries dirtyDraftDisposition=not_applicable', async () => {
      await activateWithPublishedPayload();
      logSpy.mockClear();
      capturedOnMessage()({ type: 'pe_directional_action', actionType: 'shorter', bodyId: 'body-1', bodyRevision: 3 });
      const logs = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(logs).toContain('"dirtyDraftDisposition":"not_applicable"');
    });

    it('apply_details: builds a request (ok:true) when both edited body and details text are present', async () => {
      await activateWithPublishedPayload();
      logSpy.mockClear();
      capturedOnMessage()({
        type: 'pe_submit_additional_details',
        bodyId: 'body-1',
        bodyRevision: 3,
        bodyText: 'the visible edited body',
        additionalDetailsText: 'extra requirements',
      });
      const logs = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(logs).toContain('"actionType":"apply_details"');
      expect(logs).toContain('"ok":true');
    });

    it('apply_details: rejects (ok:false) when the details text is blank', async () => {
      await activateWithPublishedPayload();
      logSpy.mockClear();
      capturedOnMessage()({
        type: 'pe_submit_additional_details',
        bodyId: 'body-1',
        bodyRevision: 3,
        bodyText: 'the visible edited body',
        additionalDetailsText: '   ',
      });
      const logs = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(logs).toContain('"ok":false');
      expect(logs).toContain('apply_details_requires_additional_details_text');
    });

    it('never logs the raw edited body or details text — only actionType/dirtyDraftDisposition (raw-text leak test)', async () => {
      await activateWithPublishedPayload();
      logSpy.mockClear();
      const BODY_MARKER = 'ZZQX_P9_BODY_LEAK_MARKER_71a2';
      const DETAILS_MARKER = 'ZZQX_P9_DETAILS_LEAK_MARKER_93c4';
      capturedOnMessage()({
        type: 'pe_submit_additional_details',
        bodyId: 'body-1',
        bodyRevision: 3,
        bodyText: BODY_MARKER,
        additionalDetailsText: DETAILS_MARKER,
      });
      const allLogs = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(allLogs).not.toContain(BODY_MARKER);
      expect(allLogs).not.toContain(DETAILS_MARKER);
      expect(allLogs).toContain('"actionType":"apply_details"');
    });

    it('does not build an action request for non-action event types (e.g. pe_close)', async () => {
      await activateWithPublishedPayload();
      logSpy.mockClear();
      capturedOnMessage()({ type: 'pe_close', actionId: 'a1' });
      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('PE action request'));
    });
  });

  describe('PE send-intent gating (P7)', () => {
    function capturedOnMessage(): (raw: unknown) => void {
      return mockPeProviderCtor.mock.calls[0]![1] as (raw: unknown) => void;
    }

    const sendablePayload = {
      currentBodyId: 'body-1',
      bodyRevision: 3,
      sendPolicy: 'send_current',
      renderState: 'ready',
    };

    it('logs intent_ready when the current body is sendable, editable, clean, and not stale', async () => {
      mockShowOnboarding.mockResolvedValueOnce(undefined);
      await activate(makeCtx() as never);
      const provider = getPeViewProvider() as unknown as { publishPayload: (p: unknown) => void };
      provider.publishPayload(sendablePayload);
      logSpy.mockClear();
      capturedOnMessage()({ type: 'pe_deliver_current_body', bodyId: 'body-1', bodyRevision: 3, bodyText: 'x' });
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"state":"intent_ready"'));
    });

    it('rejects with current_body_not_sendable when sendPolicy is not send_current — proves no insertion occurs', async () => {
      mockShowOnboarding.mockResolvedValueOnce(undefined);
      await activate(makeCtx() as never);
      const provider = getPeViewProvider() as unknown as { publishPayload: (p: unknown) => void };
      provider.publishPayload({ ...sendablePayload, sendPolicy: 'no_send' });
      logSpy.mockClear();
      capturedOnMessage()({ type: 'pe_deliver_current_body', bodyId: 'body-1', bodyRevision: 3, bodyText: 'x' });
      const allLogs = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(allLogs).toContain('"state":"no_intent"');
      expect(allLogs).toContain('current_body_not_sendable');
      expect(allLogs).not.toContain('"state":"intent_ready"');
    });

    it('rejects with current_body_not_editable when renderState is not ready', async () => {
      mockShowOnboarding.mockResolvedValueOnce(undefined);
      await activate(makeCtx() as never);
      const provider = getPeViewProvider() as unknown as { publishPayload: (p: unknown) => void };
      provider.publishPayload({ ...sendablePayload, renderState: 'loading' });
      logSpy.mockClear();
      capturedOnMessage()({ type: 'pe_deliver_current_body', bodyId: 'body-1', bodyRevision: 3, bodyText: 'x' });
      const allLogs = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(allLogs).toContain('current_body_not_editable');
      expect(allLogs).not.toContain('"state":"intent_ready"');
    });

    it('rejects with dirty_additional_details_requires_apply_or_clear when the message reports dirty details', async () => {
      mockShowOnboarding.mockResolvedValueOnce(undefined);
      await activate(makeCtx() as never);
      const provider = getPeViewProvider() as unknown as { publishPayload: (p: unknown) => void };
      provider.publishPayload(sendablePayload);
      logSpy.mockClear();
      capturedOnMessage()({ type: 'pe_deliver_current_body', bodyId: 'body-1', bodyRevision: 3, bodyText: 'x', hasDirtyAdditionalDetails: true });
      const allLogs = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(allLogs).toContain('dirty_additional_details_requires_apply_or_clear');
      expect(allLogs).not.toContain('"state":"intent_ready"');
    });

    it('rejects with stale_or_mismatched_send_identity when bodyId/bodyRevision disagree with the published payload', async () => {
      mockShowOnboarding.mockResolvedValueOnce(undefined);
      await activate(makeCtx() as never);
      const provider = getPeViewProvider() as unknown as { publishPayload: (p: unknown) => void };
      provider.publishPayload(sendablePayload);
      logSpy.mockClear();
      capturedOnMessage()({ type: 'pe_deliver_current_body', bodyId: 'stale-body', bodyRevision: 3, bodyText: 'x' });
      const allLogs = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(allLogs).toContain('stale_or_mismatched_send_identity');
      expect(allLogs).not.toContain('"state":"intent_ready"');
    });

    it('does not run send-intent gating for non-deliver event types', async () => {
      mockShowOnboarding.mockResolvedValueOnce(undefined);
      await activate(makeCtx() as never);
      const provider = getPeViewProvider() as unknown as { publishPayload: (p: unknown) => void };
      provider.publishPayload({ ...sendablePayload, sendPolicy: 'no_send' }); // would reject if gated
      logSpy.mockClear();
      capturedOnMessage()({ type: 'pe_close', actionId: 'a1' });
      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('PE send intent'));
    });

    it('re-evaluates against the latest published payload, not a stale snapshot from an earlier message', async () => {
      mockShowOnboarding.mockResolvedValueOnce(undefined);
      await activate(makeCtx() as never);
      const provider = getPeViewProvider() as unknown as { publishPayload: (p: unknown) => void };

      provider.publishPayload(sendablePayload);
      logSpy.mockClear();
      capturedOnMessage()({ type: 'pe_deliver_current_body', bodyId: 'body-1', bodyRevision: 3, bodyText: 'x' });
      expect(logSpy.mock.calls.map((c) => String(c[0])).join('\n')).toContain('"state":"intent_ready"');

      provider.publishPayload({ ...sendablePayload, sendPolicy: 'no_send' });
      logSpy.mockClear();
      capturedOnMessage()({ type: 'pe_deliver_current_body', bodyId: 'body-1', bodyRevision: 3, bodyText: 'x' });
      const secondLogs = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(secondLogs).toContain('current_body_not_sendable');
      expect(secondLogs).not.toContain('"state":"intent_ready"');
    });
  });

  describe('PE typed delivery, ACK, and origin guard (P8)', () => {
    interface FakeEvent {
      rawSessionId: string;
      sourcePath: string;
      prompt: string;
      capturedAt: Date;
      extractorId: string;
    }
    interface ChatPipelineDeps {
      checkPeOrigin?: (e: FakeEvent) => Promise<boolean>;
      injectPeResult?: (text: string, e: FakeEvent) => Promise<void>;
      isPeEcho?: (e: FakeEvent) => Promise<boolean> | boolean;
    }
    function makeEvent(overrides: Partial<FakeEvent> = {}): FakeEvent {
      return {
        rawSessionId: 'tab-pe',
        sourcePath: '/fake/ws/a/state.vscdb',
        prompt: 'the enhanced body',
        capturedAt: new Date(0),
        extractorId: 'cursor-v2024-q4',
        ...overrides,
      };
    }
    function pipelineDeps(): ChatPipelineDeps {
      return mockCreateChatEventHandler.mock.calls[0]![0] as ChatPipelineDeps;
    }
    /** createChatEventHandler only builds once the watcher actually starts (consent + host + db paths). */
    async function activateWithWatcher(): Promise<void> {
      mockShowOnboarding.mockResolvedValueOnce(undefined);
      mockDetectHost.mockReturnValueOnce('cursor');
      mockWorkspaceStorageDir.mockReturnValueOnce('/fake/ws');
      mockEnumerateStateVscdbPaths.mockReturnValueOnce(['/fake/ws/a/state.vscdb']);
      await activate(makeCtx(true) as never);
    }
    const validResultJson = JSON.stringify({
      enhancementId: 'enh-1',
      validationDecisionId: 'vd-1',
      uiView: {
        body: {
          text: 'the enhanced body',
          currentBodyId: 'body-1',
          bodyRevision: 3,
          sendPolicy: 'send_current',
          actionLoadingState: 'idle',
          fallbackMode: 'none',
        },
        actions: [],
      },
    });

    it('checkPeOrigin: returns false and never publishes/ACKs when this turn is not PE-origin', async () => {
      mockIsPeOriginTurn.mockResolvedValueOnce(false);
      await activateWithWatcher();
      logSpy.mockClear();
      const result = await pipelineDeps().checkPeOrigin!(makeEvent());
      expect(result).toBe(false);
      expect(mockReadPendingPromptEnhancement).not.toHaveBeenCalled();
      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('PE visible-surface ACK'));
    });

    it('checkPeOrigin: publishes the parsed payload and ACKs pe_body_visible on a real PE-origin turn', async () => {
      mockIsPeOriginTurn.mockResolvedValueOnce(true);
      mockReadPendingPromptEnhancement.mockResolvedValueOnce({
        id: 1, projectRoot: '/proj', sessionId: 's1', promptCount: 1,
        status: 'pending', createdAt: 0, requestJson: '{}', resultJson: validResultJson,
      });
      await activateWithWatcher();
      logSpy.mockClear();
      const result = await pipelineDeps().checkPeOrigin!(makeEvent());
      expect(result).toBe(true);
      const provider = getPeViewProvider() as unknown as { getCurrentPayload: () => { currentBodyId: string } | null };
      expect(provider.getCurrentPayload()?.currentBodyId).toBe('body-1');
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('PE visible-surface ACK: pe_body_visible'));
    });

    it('checkPeOrigin: ACKs not_counted_as_shown (never render_failure) when the pending row vanished before it could be read', async () => {
      mockIsPeOriginTurn.mockResolvedValueOnce(true);
      mockReadPendingPromptEnhancement.mockResolvedValueOnce(null);
      await activateWithWatcher();
      logSpy.mockClear();
      const result = await pipelineDeps().checkPeOrigin!(makeEvent());
      expect(result).toBe(true);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('PE visible-surface ACK: not_counted_as_shown'));
    });

    it('checkPeOrigin: ACKs render_failure when the store read throws, and never propagates the throw', async () => {
      mockIsPeOriginTurn.mockResolvedValueOnce(true);
      mockReadPendingPromptEnhancement.mockRejectedValueOnce(new Error('sqlite busy'));
      await activateWithWatcher();
      logSpy.mockClear();
      await expect(pipelineDeps().checkPeOrigin!(makeEvent())).resolves.toBe(true);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('PE visible-surface ACK: render_failure'));
    });

    it('checkPeOrigin: never reads DS status="shown" — direct spy proof, not coincidental', async () => {
      mockIsPeOriginTurn.mockResolvedValueOnce(true);
      mockReadPendingPromptEnhancement.mockResolvedValueOnce({
        id: 1, projectRoot: '/proj', sessionId: 's1', promptCount: 1,
        status: 'pending', createdAt: 0, requestJson: '{}', resultJson: validResultJson,
      });
      await activateWithWatcher();
      mockReadLatestAdvisoryMeta.mockClear();
      mockReadInjectedPrompt.mockClear();
      await pipelineDeps().checkPeOrigin!(makeEvent());
      // readLatestAdvisoryMeta / readInjectedPrompt are DS-only reads
      // (advisory-store-reader.js's pending_advisories.status='shown' path).
      // Both are mocked and spied on directly here — this asserts the PE
      // wiring never calls either, rather than relying on the coincidence
      // that advisory-fallback.js (their only other caller) is also mocked.
      expect(mockReadLatestAdvisoryMeta).not.toHaveBeenCalled();
      expect(mockReadInjectedPrompt).not.toHaveBeenCalled();
      expect(mockReadPendingPromptEnhancement).toHaveBeenCalledTimes(1);
    });

    it('checkPeOrigin: a slower-resolving OLDER turn never overwrites an already-published NEWER turn\'s payload (Late-ACK ordering gap, found + fixed on P11 cross-confirm)', async () => {
      // chat-history-watcher.ts fires onEvent without awaiting the previous
      // handler (fire-and-forget), so two checkPeOrigin calls for two
      // different turns can genuinely be in flight at once. Without the
      // createdAt guard, a slower-resolving OLDER read could publish AFTER an
      // already-published NEWER one, silently replacing the visible body.
      mockIsPeOriginTurn.mockResolvedValue(true);
      let resolveOlder!: (v: unknown) => void;
      const olderPromise = new Promise((resolve) => { resolveOlder = resolve; });
      const newerResultJson = JSON.stringify({
        enhancementId: 'enh-2', validationDecisionId: 'vd-2',
        uiView: { body: { text: 'the newer body', currentBodyId: 'body-2', bodyRevision: 1, sendPolicy: 'send_current', actionLoadingState: 'idle', fallbackMode: 'none' }, actions: [] },
      });
      mockReadPendingPromptEnhancement
        .mockImplementationOnce(() => olderPromise as never)
        .mockImplementationOnce(async () => ({
          id: 2, projectRoot: '/proj', sessionId: 's1', promptCount: 1,
          status: 'pending', createdAt: 1000, requestJson: '{}', resultJson: newerResultJson,
        }));
      await activateWithWatcher();
      const provider = getPeViewProvider() as unknown as { getCurrentPayload: () => { currentBodyId: string } | null };

      const olderCall = pipelineDeps().checkPeOrigin!(makeEvent({ prompt: 'older turn prompt' }));
      const newerCall = pipelineDeps().checkPeOrigin!(makeEvent({ prompt: 'newer turn prompt' }));
      await newerCall;
      expect(provider.getCurrentPayload()?.currentBodyId).toBe('body-2'); // newer turn correctly visible first

      logSpy.mockClear();
      resolveOlder({
        id: 1, projectRoot: '/proj', sessionId: 's1', promptCount: 1,
        status: 'pending', createdAt: 0, requestJson: '{}', resultJson: validResultJson,
      });
      await olderCall;
      // Fixed: the older turn's late-resolving read is suppressed, not published.
      expect(provider.getCurrentPayload()?.currentBodyId).toBe('body-2');
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('PE publish suppressed'));
    });

    it('checkPeOrigin: a row with the SAME createdAt as the last published one is still published (idempotent re-read, not treated as stale)', async () => {
      mockIsPeOriginTurn.mockResolvedValue(true);
      mockReadPendingPromptEnhancement.mockResolvedValue({
        id: 1, projectRoot: '/proj', sessionId: 's1', promptCount: 1,
        status: 'pending', createdAt: 500, requestJson: '{}', resultJson: validResultJson,
      });
      await activateWithWatcher();
      const provider = getPeViewProvider() as unknown as { getCurrentPayload: () => { currentBodyId: string } | null };
      await pipelineDeps().checkPeOrigin!(makeEvent());
      await pipelineDeps().checkPeOrigin!(makeEvent());
      expect(provider.getCurrentPayload()?.currentBodyId).toBe('body-1');
    });

    it('injectPeResult: on success, logs "inserted" and injects via the clipboard-free chatInputInject only', async () => {
      mockChatInputInject.mockResolvedValueOnce(true);
      await activateWithWatcher();
      logSpy.mockClear();
      await pipelineDeps().injectPeResult!('the enhanced body', makeEvent());
      expect(mockChatInputInject).toHaveBeenCalledWith('the enhanced body', expect.objectContaining({ host: expect.anything() }));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('PE insert outcome: inserted'));
    });

    it('injectPeResult: on failure (D-1), logs the typed failure — no clipboard write exists in this path to make', async () => {
      mockChatInputInject.mockResolvedValueOnce(false);
      await activateWithWatcher();
      logSpy.mockClear();
      await expect(pipelineDeps().injectPeResult!('the enhanced body', makeEvent())).resolves.toBeUndefined();
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('PE insert outcome: insert_failed_no_clipboard_fallback'),
      );
    });

    it('injectPeResult: insertion succeeds but the best-effort origin-record read throws — resolves cleanly, no origin recorded', async () => {
      mockChatInputInject.mockResolvedValueOnce(true);
      mockReadPendingPromptEnhancement.mockRejectedValueOnce(new Error('sqlite busy'));
      await activateWithWatcher();
      await expect(pipelineDeps().injectPeResult!('the enhanced body', makeEvent())).resolves.toBeUndefined();
      // The insert itself succeeded, but since the origin record failed
      // best-effort, the next turn's isPeEcho must NOT report a typed echo —
      // proving the failure is truly swallowed, not silently mis-recorded.
      expect(pipelineDeps().isPeEcho!(makeEvent({ prompt: 'the enhanced body' }))).toBe(false);
    });

    it('isPeEcho: reports true for the exact text just delivered by injectPeResult (typed origin guard armed)', async () => {
      mockChatInputInject.mockResolvedValueOnce(true);
      mockReadPendingPromptEnhancement.mockResolvedValueOnce({
        id: 1, projectRoot: '/proj', sessionId: 's1', promptCount: 1,
        status: 'pending', createdAt: 0, requestJson: '{}', resultJson: validResultJson,
      });
      await activateWithWatcher();
      await pipelineDeps().injectPeResult!('the enhanced body', makeEvent());
      expect(pipelineDeps().isPeEcho!(makeEvent({ prompt: 'the enhanced body' }))).toBe(true);
    });

    it('isPeEcho: reports false for different text, even right after a real delivery', async () => {
      mockChatInputInject.mockResolvedValueOnce(true);
      mockReadPendingPromptEnhancement.mockResolvedValueOnce({
        id: 1, projectRoot: '/proj', sessionId: 's1', promptCount: 1,
        status: 'pending', createdAt: 0, requestJson: '{}', resultJson: validResultJson,
      });
      await activateWithWatcher();
      await pipelineDeps().injectPeResult!('the enhanced body', makeEvent());
      expect(pipelineDeps().isPeEcho!(makeEvent({ prompt: 'a completely different prompt' }))).toBe(false);
    });

    it('isPeEcho: reports false before anything has ever been delivered', async () => {
      await activateWithWatcher();
      expect(pipelineDeps().isPeEcho!(makeEvent())).toBe(false);
    });
  });

  it('does NOT start the watcher when consent is undefined (first launch, user has not answered)', async () => {
    mockShowOnboarding.mockResolvedValueOnce(undefined);
    mockDetectHost.mockReturnValueOnce('cursor');
    await activate(makeCtx(undefined) as never);
    expect(mockCreateChatHistoryWatcher).not.toHaveBeenCalled();
    expect(mockWatcherStart).not.toHaveBeenCalled();
  });

  it('does NOT start the watcher when consent is explicitly false (user denied)', async () => {
    mockShowOnboarding.mockResolvedValueOnce(undefined);
    mockDetectHost.mockReturnValueOnce('cursor');
    await activate(makeCtx(false) as never);
    expect(mockCreateChatHistoryWatcher).not.toHaveBeenCalled();
  });

  it('does NOT start the watcher on plain VS Code host even if consent is true', async () => {
    mockShowOnboarding.mockResolvedValueOnce(undefined);
    mockDetectHost.mockReturnValueOnce('vscode-generic');
    await activate(makeCtx(true) as never);
    expect(mockCreateChatHistoryWatcher).not.toHaveBeenCalled();
  });

  it('does NOT start the watcher when no state.vscdb files are found under workspaceStorage', async () => {
    mockShowOnboarding.mockResolvedValueOnce(undefined);
    mockDetectHost.mockReturnValueOnce('cursor');
    mockWorkspaceStorageDir.mockReturnValueOnce('/fake/workspaceStorage');
    mockEnumerateStateVscdbPaths.mockReturnValueOnce([]);
    await activate(makeCtx(true) as never);
    expect(mockCreateChatHistoryWatcher).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('no workspace state.vscdb'),
    );
  });

  it('starts the watcher when consent=true + host=cursor + dbs present', async () => {
    mockShowOnboarding.mockResolvedValueOnce(undefined);
    mockDetectHost.mockReturnValueOnce('cursor');
    mockWorkspaceStorageDir.mockReturnValueOnce('/fake/workspaceStorage');
    mockEnumerateStateVscdbPaths.mockReturnValueOnce([
      '/fake/workspaceStorage/wsA/state.vscdb',
      '/fake/workspaceStorage/wsB/state.vscdb',
    ]);
    const ctx = makeCtx(true);
    await activate(ctx as never);
    expect(mockCreateChatHistoryWatcher).toHaveBeenCalledOnce();
    const watcherOpts = mockCreateChatHistoryWatcher.mock.calls[0]![0] as {
      targets: Array<{ path: string; kind: string }>;
    };
    expect(watcherOpts.targets).toHaveLength(2);
    expect(watcherOpts.targets[0]!.kind).toBe('cursor-sqlite');
    expect(mockWatcherStart).toHaveBeenCalledOnce();
    // Cleanup disposable pushed onto subscriptions
    expect(ctx.subscriptions.length).toBeGreaterThanOrEqual(2);
  });

  it('builds the chat-event handler with the right composer (workspace-prefixed session id)', async () => {
    mockShowOnboarding.mockResolvedValueOnce(undefined);
    mockDetectHost.mockReturnValueOnce('cursor');
    mockWorkspaceStorageDir.mockReturnValueOnce('/fake/ws');
    mockEnumerateStateVscdbPaths.mockReturnValueOnce(['/fake/ws/a/state.vscdb']);
    await activate(makeCtx(true) as never);
    expect(mockCreateChatEventHandler).toHaveBeenCalledOnce();
    const deps = mockCreateChatEventHandler.mock.calls[0]![0] as {
      composeSessionId?: (e: {
        rawSessionId: string;
        sourcePath: string;
        prompt: string;
        capturedAt: Date;
        extractorId: string;
      }) => string;
    };
    expect(typeof deps.composeSessionId).toBe('function');
    // R4.3 fix: composer now derives cwd per-event from event.sourcePath via
    // sibling workspace.json lookup. The fake path here has no real
    // workspace.json on disk → helper returns null → composer falls back to
    // the extension instance's workspaceCwd (process.cwd() since
    // workspaceFolders is undefined in the mock).
    const composed = deps.composeSessionId!({
      rawSessionId: 'tab-1',
      sourcePath: '/fake/ws/a/state.vscdb',
      prompt: 'irrelevant',
      capturedAt: new Date(0),
      extractorId: 'cursor-v2024-q4',
    });
    expect(composed.endsWith('|tab-1')).toBe(true);
    expect(composed).toMatch(/.+\|tab-1$/);
  });

  it('does not throw when showOnboardingIfNeeded rejects — logs error and continues', async () => {
    mockShowOnboarding.mockRejectedValueOnce(new Error('onboarding boom'));
    mockDetectHost.mockReturnValueOnce('cursor');
    await expect(activate(makeCtx(true) as never)).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      '[nexpath] onboarding failed:',
      expect.any(Error),
    );
  });

  it('exposes the constructed provider via getViewProvider()', async () => {
    mockShowOnboarding.mockResolvedValueOnce(undefined);
    await activate(makeCtx() as never);
    expect(getViewProvider()).toBeDefined();
  });

  // ── Notification-panel pre-open (Cursor/Windsurf toast visibility) ─────────
  // VS Code shows showInformationMessage toasts as transient bottom-right
  // popups. Cursor and Windsurf route them to the silent notification stack
  // (bell icon) and stay invisible until the user opens the panel. extension.ts
  // pre-opens the panel via the `notifications.showList` command on non-VS-Code
  // hosts so the consent toast is immediately discoverable. Dev plan §2.2 M11
  // ("consent toast") + §2.5 cursor-quirks compliance.

  it('on host=cursor: pre-opens notification panel before consent toast', async () => {
    mockShowOnboarding.mockResolvedValueOnce(undefined);
    mockDetectHost.mockReturnValueOnce('cursor');
    await activate(makeCtx() as never);
    expect(mockExecuteCommand).toHaveBeenCalledWith('notifications.showList');
  });

  it('on host=windsurf: pre-opens notification panel before consent toast', async () => {
    mockShowOnboarding.mockResolvedValueOnce(undefined);
    mockDetectHost.mockReturnValueOnce('windsurf');
    await activate(makeCtx() as never);
    expect(mockExecuteCommand).toHaveBeenCalledWith('notifications.showList');
  });

  it('on host=vscode-generic: does NOT pre-open notification panel (toast surfaces natively)', async () => {
    mockShowOnboarding.mockResolvedValueOnce(undefined);
    mockDetectHost.mockReturnValueOnce('vscode-generic');
    await activate(makeCtx() as never);
    expect(mockExecuteCommand).not.toHaveBeenCalledWith('notifications.showList');
  });

  it('swallows errors from notifications.showList (best-effort discoverability hint)', async () => {
    mockShowOnboarding.mockResolvedValueOnce(undefined);
    mockDetectHost.mockReturnValueOnce('cursor');
    mockExecuteCommand.mockRejectedValueOnce(new Error('command not found'));
    await expect(activate(makeCtx() as never)).resolves.toBeUndefined();
    // Onboarding still runs even though showList rejected
    expect(mockShowOnboarding).toHaveBeenCalledOnce();
  });

  // ── Windsurf codeium-cascade dir wiring (Drift A fix) ──────────────────────
  // Per dev plan §2.3 acceptance #2: when host=windsurf, the watcher must
  // monitor BOTH state.vscdb files AND `~/.codeium/windsurf/`. These tests
  // verify the extension.ts wiring that adds the codeium dir as a
  // windsurf-dir WatchTarget alongside the cursor-sqlite targets.

  it('windsurf host: adds codeium cascade dir as a windsurf-dir target when it exists on disk', async () => {
    mockShowOnboarding.mockResolvedValueOnce(undefined);
    mockDetectHost.mockReturnValueOnce('windsurf');
    mockWorkspaceStorageDir.mockReturnValueOnce('/fake/ws');
    mockEnumerateStateVscdbPaths.mockReturnValueOnce(['/fake/ws/a/state.vscdb']);
    mockWindsurfCodeiumDir.mockReturnValueOnce('/home/u/.codeium/windsurf');
    mockExistsSync.mockImplementation(
      (p: string) => p === '/home/u/.codeium/windsurf',
    );

    await activate(makeCtx(true) as never);

    expect(mockCreateChatHistoryWatcher).toHaveBeenCalledOnce();
    const watcherOpts = mockCreateChatHistoryWatcher.mock.calls[0]![0] as {
      targets: Array<{ path: string; kind: string }>;
    };
    expect(watcherOpts.targets).toHaveLength(2);
    expect(watcherOpts.targets[0]).toEqual({
      path: '/fake/ws/a/state.vscdb',
      kind: 'cursor-sqlite',
    });
    expect(watcherOpts.targets[1]).toEqual({
      path: '/home/u/.codeium/windsurf',
      kind: 'windsurf-dir',
    });
  });

  it('windsurf host: skips codeium dir when it does not exist (existsSync = false)', async () => {
    mockShowOnboarding.mockResolvedValueOnce(undefined);
    mockDetectHost.mockReturnValueOnce('windsurf');
    mockWorkspaceStorageDir.mockReturnValueOnce('/fake/ws');
    mockEnumerateStateVscdbPaths.mockReturnValueOnce(['/fake/ws/a/state.vscdb']);
    mockExistsSync.mockReturnValue(false);

    await activate(makeCtx(true) as never);

    const watcherOpts = mockCreateChatHistoryWatcher.mock.calls[0]![0] as {
      targets: Array<{ path: string; kind: string }>;
    };
    expect(watcherOpts.targets).toHaveLength(1);
    expect(watcherOpts.targets[0]!.kind).toBe('cursor-sqlite');
  });

  it('windsurf host: starts watcher when ONLY the codeium dir exists (no state.vscdb yet)', async () => {
    mockShowOnboarding.mockResolvedValueOnce(undefined);
    mockDetectHost.mockReturnValueOnce('windsurf');
    mockWorkspaceStorageDir.mockReturnValueOnce('/fake/ws');
    mockEnumerateStateVscdbPaths.mockReturnValueOnce([]);
    mockWindsurfCodeiumDir.mockReturnValueOnce('/home/u/.codeium/windsurf');
    mockExistsSync.mockImplementation(
      (p: string) => p === '/home/u/.codeium/windsurf',
    );

    await activate(makeCtx(true) as never);

    expect(mockCreateChatHistoryWatcher).toHaveBeenCalledOnce();
    const watcherOpts = mockCreateChatHistoryWatcher.mock.calls[0]![0] as {
      targets: Array<{ path: string; kind: string }>;
    };
    expect(watcherOpts.targets).toHaveLength(1);
    expect(watcherOpts.targets[0]).toEqual({
      path: '/home/u/.codeium/windsurf',
      kind: 'windsurf-dir',
    });
  });

  it('cursor host: never adds a windsurf-dir target (no cross-host leakage)', async () => {
    mockShowOnboarding.mockResolvedValueOnce(undefined);
    mockDetectHost.mockReturnValueOnce('cursor');
    mockWorkspaceStorageDir.mockReturnValueOnce('/fake/ws');
    mockEnumerateStateVscdbPaths.mockReturnValueOnce(['/fake/ws/a/state.vscdb']);
    // Even if existsSync would say yes for /home/u/.codeium/windsurf, the
    // cursor-host branch must never consult it.
    mockExistsSync.mockReturnValue(true);

    await activate(makeCtx(true) as never);

    expect(mockWindsurfCodeiumDir).not.toHaveBeenCalled();
    const watcherOpts = mockCreateChatHistoryWatcher.mock.calls[0]![0] as {
      targets: Array<{ path: string; kind: string }>;
    };
    expect(watcherOpts.targets.every((t) => t.kind === 'cursor-sqlite')).toBe(
      true,
    );
  });

  // ── Watcher-callback wiring (B5 audit follow-up) ───────────────────────────
  // The watcher takes three callbacks at construction time (onEvent,
  // onError, onSchemaUnknown). The watcher itself is mocked in these tests,
  // so we capture the callbacks from the createChatHistoryWatcher call args
  // and invoke them directly — verifying that what extension.ts wires up
  // does the right thing.

  /** Helper: drive activate() with watcher-starting conditions + return the watcher opts. */
  async function activateWithWatcher(): Promise<{
    onEvent: (event: unknown) => void;
    onError: (err: Error) => void;
    onSchemaUnknown: (info: { path: string; observedSampleKeys: readonly string[] }) => void;
  }> {
    mockShowOnboarding.mockResolvedValueOnce(undefined);
    mockDetectHost.mockReturnValueOnce('cursor');
    mockWorkspaceStorageDir.mockReturnValueOnce('/fake/ws');
    mockEnumerateStateVscdbPaths.mockReturnValueOnce(['/fake/ws/a/state.vscdb']);
    await activate(makeCtx(true) as never);
    const opts = mockCreateChatHistoryWatcher.mock.calls[0]![0] as {
      onEvent: (event: unknown) => void;
      onError: (err: Error) => void;
      onSchemaUnknown: (info: {
        path: string;
        observedSampleKeys: readonly string[];
      }) => void;
    };
    return opts;
  }

  it('routes watcher onEvent through the chat-event handler (the integration proof)', async () => {
    const trackedHandler = vi.fn();
    mockCreateChatEventHandler.mockReturnValueOnce(trackedHandler);
    const opts = await activateWithWatcher();
    const event = {
      prompt: 'hi',
      rawSessionId: 'tab-7',
      capturedAt: new Date(0),
      sourcePath: '/fake/ws/a/state.vscdb',
      extractorId: 'cursor-v2025-q2',
    };
    opts.onEvent(event);
    expect(trackedHandler).toHaveBeenCalledOnce();
    expect(trackedHandler).toHaveBeenCalledWith(event);
  });

  it('watcher onSchemaUnknown surfaces a visible info toast with path + observed keys', async () => {
    const opts = await activateWithWatcher();
    opts.onSchemaUnknown({
      path: '/fake/ws/a/state.vscdb',
      observedSampleKeys: ['unknown.key.1', 'unknown.key.2', 'unknown.key.3'],
    });
    expect(mockShowInformationMessage).toHaveBeenCalledOnce();
    const msg = mockShowInformationMessage.mock.calls[0]![0] as string;
    expect(msg).toContain('/fake/ws/a/state.vscdb');
    expect(msg).toContain('schema is not recognised');
    expect(msg).toContain('unknown.key.1');
  });

  it('watcher onError logs to console.error (does not crash the extension)', async () => {
    const opts = await activateWithWatcher();
    const watcherErr = new Error('watch boom');
    expect(() => opts.onError(watcherErr)).not.toThrow();
    expect(errorSpy).toHaveBeenCalledWith('[nexpath] watcher error:', watcherErr);
  });

  // ── Pipeline logger wiring (spawn-error visibility follow-up) ─────────────
  // chat-pipeline.ts catches spawnAuto / spawnStop failures and forwards them
  // to its `logger.error`. extension.ts must wire a logger that writes to
  // BOTH console.error AND the Nexpath OutputChannel (via the local `log`
  // helper). Otherwise IPC errors only surface in Developer Tools Console,
  // invisible to end users. Verified live (nexpath binary moved aside →
  // spawnAuto ENOENT → silent before this fix, surfaces in Output after
  // this fix).

  it('wires a logger into createChatEventHandler that writes spawn errors to the Output channel', async () => {
    mockShowOnboarding.mockResolvedValueOnce(undefined);
    mockDetectHost.mockReturnValueOnce('cursor');
    mockWorkspaceStorageDir.mockReturnValueOnce('/fake/ws');
    mockEnumerateStateVscdbPaths.mockReturnValueOnce(['/fake/ws/a/state.vscdb']);
    await activate(makeCtx(true) as never);
    const handlerDeps = mockCreateChatEventHandler.mock.calls[0]![0] as {
      logger?: { error: (msg: string, err: unknown) => void };
    };
    expect(handlerDeps.logger).toBeDefined();
    expect(typeof handlerDeps.logger!.error).toBe('function');

    // Calling the wired logger.error should reach console.error (existing
    // path) and also call `log()` which writes to console.log (which the
    // OutputChannel mock will also receive via appendLine in production).
    const enoent = Object.assign(new Error('spawn nexpath ENOENT'), {
      code: 'ENOENT',
    });
    handlerDeps.logger!.error('[nexpath] spawnAuto failed:', enoent);
    expect(errorSpy).toHaveBeenCalledWith(
      '[nexpath] spawnAuto failed:',
      enoent,
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('spawn nexpath ENOENT'),
    );
  });

  it('wired logger.error formats non-Error rejection values cleanly', async () => {
    mockShowOnboarding.mockResolvedValueOnce(undefined);
    mockDetectHost.mockReturnValueOnce('cursor');
    mockWorkspaceStorageDir.mockReturnValueOnce('/fake/ws');
    mockEnumerateStateVscdbPaths.mockReturnValueOnce(['/fake/ws/a/state.vscdb']);
    await activate(makeCtx(true) as never);
    const handlerDeps = mockCreateChatEventHandler.mock.calls[0]![0] as {
      logger?: { error: (msg: string, err: unknown) => void };
    };
    handlerDeps.logger!.error('[nexpath] spawnStop failed:', 'plain string err');
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('plain string err'),
    );
  });
});

describe('deactivate', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockShowOnboarding.mockReset();
    mockRegisterWebviewViewProvider.mockReset();
    mockProviderCtor.mockReset();
    mockPeProviderCtor.mockReset();
    mockDetectHost.mockReset().mockReturnValue('vscode-generic');
    mockWorkspaceStorageDir.mockReset().mockReturnValue(null);
    mockWindsurfCodeiumDir.mockReset().mockReturnValue('/home/u/.codeium/windsurf');
    mockEnumerateStateVscdbPaths.mockReset().mockReturnValue([]);
    mockCreateChatHistoryWatcher.mockReset().mockReturnValue({
      start: mockWatcherStart,
      stop: mockWatcherStop,
    });
    mockWatcherStart.mockReset();
    mockWatcherStop.mockReset();
    mockExistsSync.mockReset().mockReturnValue(false);
    mockCreatePePoller.mockReset();
    mockPePollerStart.mockReset();
    mockPePollerStop.mockReset();
    mockGetCommands.mockReset().mockResolvedValue([]);
    mockRegisterWebviewViewProvider.mockReturnValue({ dispose: vi.fn() });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('logs the deactivation message', () => {
    deactivate();
    expect(logSpy).toHaveBeenCalledWith('[nexpath] extension deactivated');
  });

  it('returns synchronously without throwing', () => {
    expect(() => deactivate()).not.toThrow();
  });

  it('clears module-level viewProvider on deactivate', async () => {
    mockShowOnboarding.mockResolvedValueOnce(undefined);
    await activate(makeCtx() as never);
    expect(getViewProvider()).toBeDefined();
    deactivate();
    expect(getViewProvider()).toBeUndefined();
  });

  it('stops the watcher on deactivate (if one was started)', async () => {
    mockShowOnboarding.mockResolvedValueOnce(undefined);
    mockDetectHost.mockReturnValueOnce('cursor');
    mockWorkspaceStorageDir.mockReturnValueOnce('/fake/ws');
    mockEnumerateStateVscdbPaths.mockReturnValueOnce(['/fake/ws/a/state.vscdb']);
    await activate(makeCtx(true) as never);
    expect(mockWatcherStart).toHaveBeenCalledOnce();
    deactivate();
    expect(mockWatcherStop).toHaveBeenCalled();
  });

  it('stops the PE poller on deactivate (P10, Windsurf only)', async () => {
    mockShowOnboarding.mockResolvedValueOnce(undefined);
    mockDetectHost.mockReturnValueOnce('windsurf');
    await activate(makeCtx(true) as never);
    expect(mockPePollerStart).toHaveBeenCalledOnce();
    deactivate();
    expect(mockPePollerStop).toHaveBeenCalledOnce();
  });
});
