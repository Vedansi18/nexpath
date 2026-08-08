import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createChatEventHandler } from './chat-pipeline.js';
import type { ChatHistoryEvent } from './chat-history-types.js';
import type { StopSelection } from './ipc.js';

const makeEvent = (overrides: Partial<ChatHistoryEvent> = {}): ChatHistoryEvent => ({
  prompt: 'hello world',
  rawSessionId: 'tab:abc-123',
  capturedAt: new Date(0),
  sourcePath: '/fake/state.vscdb',
  extractorId: 'cursor-v2025-q2',
  ...overrides,
});

const fakeSelection: StopSelection = { selectedPrompt: 'Refine the request' };

describe('createChatEventHandler', () => {
  let spawnAuto: ReturnType<typeof vi.fn>;
  let spawnStop: ReturnType<typeof vi.fn>;
  let injectSelection: ReturnType<typeof vi.fn>;
  let onAfterCapture: ReturnType<typeof vi.fn>;
  let errorLog: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    spawnAuto = vi.fn().mockResolvedValue(undefined);
    spawnStop = vi.fn().mockResolvedValue(null);
    injectSelection = vi.fn().mockResolvedValue(undefined);
    onAfterCapture = vi.fn().mockResolvedValue(undefined);
    errorLog = vi.fn();
  });

  it('arms the fallback after auto (before stop), then injects on a selection', async () => {
    spawnStop.mockResolvedValueOnce(fakeSelection);
    const handler = createChatEventHandler({
      spawnAuto,
      spawnStop,
      injectSelection,
      onAfterCapture,
      logger: { error: errorLog },
    });
    const event = makeEvent();
    await handler(event);
    expect(spawnAuto).toHaveBeenCalledWith('hello world', 'tab:abc-123', event);
    expect(onAfterCapture).toHaveBeenCalledWith(event);
    expect(spawnStop).toHaveBeenCalledWith('tab:abc-123', event);
    expect(injectSelection).toHaveBeenCalledWith('Refine the request', event);
    // onAfterCapture runs BEFORE stop
    expect(onAfterCapture.mock.invocationCallOrder[0]).toBeLessThan(
      spawnStop.mock.invocationCallOrder[0],
    );
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('arms the fallback even when there is no selection (does not inject)', async () => {
    spawnStop.mockResolvedValueOnce(null);
    const handler = createChatEventHandler({
      spawnAuto,
      spawnStop,
      injectSelection,
      onAfterCapture,
      logger: { error: errorLog },
    });
    const event = makeEvent();
    await handler(event);
    expect(onAfterCapture).toHaveBeenCalledWith(event);
    expect(injectSelection).not.toHaveBeenCalled();
  });

  it('tolerates a missing onAfterCapture callback', async () => {
    spawnStop.mockResolvedValueOnce(null);
    const handler = createChatEventHandler({
      spawnAuto,
      spawnStop,
      injectSelection,
      logger: { error: errorLog },
    });
    await expect(handler(makeEvent())).resolves.toBeUndefined();
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('uses composeSessionId to derive the session id (workspace-prefixed)', async () => {
    spawnStop.mockResolvedValueOnce(fakeSelection);
    const compose = vi.fn((e: ChatHistoryEvent) => `ws-X|${e.rawSessionId}`);
    const handler = createChatEventHandler({
      spawnAuto,
      spawnStop,
      injectSelection,
      composeSessionId: compose,
      logger: { error: errorLog },
    });
    const event = makeEvent();
    await handler(event);
    expect(compose).toHaveBeenCalledOnce();
    expect(spawnAuto).toHaveBeenCalledWith('hello world', 'ws-X|tab:abc-123', event);
    expect(spawnStop).toHaveBeenCalledWith('ws-X|tab:abc-123', event);
  });

  it('forwards the originating ChatHistoryEvent so callers can derive per-event cwd', async () => {
    spawnStop.mockResolvedValueOnce(fakeSelection);
    const handler = createChatEventHandler({
      spawnAuto,
      spawnStop,
      injectSelection,
      onAfterCapture,
      logger: { error: errorLog },
    });
    const event = makeEvent({
      sourcePath: '/home/u/.config/Cursor/User/workspaceStorage/abc/state.vscdb',
    });
    await handler(event);
    expect((spawnAuto.mock.calls[0][2] as ChatHistoryEvent).sourcePath).toBe(event.sourcePath);
    expect((onAfterCapture.mock.calls[0][0] as ChatHistoryEvent).sourcePath).toBe(event.sourcePath);
    expect((spawnStop.mock.calls[0][1] as ChatHistoryEvent).sourcePath).toBe(event.sourcePath);
  });

  it('returns early when spawnAuto rejects (no arm, no stop, no inject)', async () => {
    spawnAuto.mockRejectedValueOnce(new Error('auto blew up'));
    const handler = createChatEventHandler({
      spawnAuto,
      spawnStop,
      injectSelection,
      onAfterCapture,
      logger: { error: errorLog },
    });
    await handler(makeEvent());
    expect(spawnAuto).toHaveBeenCalledOnce();
    expect(onAfterCapture).not.toHaveBeenCalled();
    expect(spawnStop).not.toHaveBeenCalled();
    expect(injectSelection).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith('[nexpath] spawnAuto failed:', expect.any(Error));
  });

  it('continues past an onAfterCapture error (fallback failure is non-fatal)', async () => {
    onAfterCapture.mockRejectedValueOnce(new Error('arm blew up'));
    spawnStop.mockResolvedValueOnce(fakeSelection);
    const handler = createChatEventHandler({
      spawnAuto,
      spawnStop,
      injectSelection,
      onAfterCapture,
      logger: { error: errorLog },
    });
    await handler(makeEvent());
    expect(errorLog).toHaveBeenCalledWith('[nexpath] onAfterCapture failed:', expect.any(Error));
    // pipeline still proceeds to the popup + injection
    expect(spawnStop).toHaveBeenCalledOnce();
    expect(injectSelection).toHaveBeenCalledOnce();
  });

  it('logs and returns when spawnStop rejects — the armed fallback stands', async () => {
    spawnStop.mockRejectedValueOnce(new Error('stop blew up'));
    const handler = createChatEventHandler({
      spawnAuto,
      spawnStop,
      injectSelection,
      onAfterCapture,
      logger: { error: errorLog },
    });
    await handler(makeEvent());
    expect(onAfterCapture).toHaveBeenCalledOnce(); // armed before the popup
    expect(injectSelection).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith('[nexpath] spawnStop failed:', expect.any(Error));
  });

  it('logs and swallows when injectSelection throws (does not propagate to watcher)', async () => {
    spawnStop.mockResolvedValueOnce(fakeSelection);
    injectSelection.mockRejectedValueOnce(new Error('inject blew up'));
    const handler = createChatEventHandler({
      spawnAuto,
      spawnStop,
      injectSelection,
      logger: { error: errorLog },
    });
    await expect(handler(makeEvent())).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledWith('[nexpath] injectSelection failed:', expect.any(Error));
  });

  it('handler always resolves — never propagates exceptions to the watcher', async () => {
    spawnAuto.mockRejectedValueOnce(new Error('a'));
    spawnStop.mockRejectedValueOnce(new Error('b'));
    injectSelection.mockRejectedValueOnce(new Error('c'));
    onAfterCapture.mockRejectedValueOnce(new Error('d'));
    const handler = createChatEventHandler({
      spawnAuto,
      spawnStop,
      injectSelection,
      onAfterCapture,
      logger: { error: errorLog },
    });
    await expect(handler(makeEvent())).resolves.toBeUndefined();
  });

  // ── P4: PE-origin routing + F6 self-echo guard ────────────────────────────

  describe('PE-origin routing (VED-PE-10 / D-6)', () => {
    let checkPeOrigin: ReturnType<typeof vi.fn>;
    let injectPeResult: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      checkPeOrigin = vi.fn().mockResolvedValue(false);
      injectPeResult = vi.fn().mockResolvedValue(undefined);
    });

    it('routes a PE-origin result to injectPeResult, never injectSelection', async () => {
      checkPeOrigin.mockResolvedValueOnce(true);
      spawnStop.mockResolvedValueOnce(fakeSelection);
      const handler = createChatEventHandler({
        spawnAuto, spawnStop, injectSelection, onAfterCapture,
        checkPeOrigin, injectPeResult,
        logger: { error: errorLog },
      });
      const event = makeEvent();
      await handler(event);
      expect(checkPeOrigin).toHaveBeenCalledWith(event);
      expect(injectPeResult).toHaveBeenCalledWith('Refine the request', event);
      expect(injectSelection).not.toHaveBeenCalled();
      expect(errorLog).not.toHaveBeenCalled();
    });

    it('a DS-origin result (checkPeOrigin false) still routes to injectSelection, never injectPeResult', async () => {
      checkPeOrigin.mockResolvedValueOnce(false);
      spawnStop.mockResolvedValueOnce(fakeSelection);
      const handler = createChatEventHandler({
        spawnAuto, spawnStop, injectSelection, onAfterCapture,
        checkPeOrigin, injectPeResult,
        logger: { error: errorLog },
      });
      await handler(makeEvent());
      expect(injectSelection).toHaveBeenCalledWith('Refine the request', makeEvent());
      expect(injectPeResult).not.toHaveBeenCalled();
    });

    it('falls back to injectSelection when PE-origin but injectPeResult is not wired (partial-wiring safety net)', async () => {
      checkPeOrigin.mockResolvedValueOnce(true);
      spawnStop.mockResolvedValueOnce(fakeSelection);
      const handler = createChatEventHandler({
        spawnAuto, spawnStop, injectSelection, onAfterCapture,
        checkPeOrigin, // injectPeResult omitted
        logger: { error: errorLog },
      });
      await handler(makeEvent());
      expect(injectSelection).toHaveBeenCalledWith('Refine the request', makeEvent());
    });

    it('treats a checkPeOrigin rejection as DS-origin (fail-safe) and logs it', async () => {
      checkPeOrigin.mockRejectedValueOnce(new Error('store unavailable'));
      spawnStop.mockResolvedValueOnce(fakeSelection);
      const handler = createChatEventHandler({
        spawnAuto, spawnStop, injectSelection, onAfterCapture,
        checkPeOrigin, injectPeResult,
        logger: { error: errorLog },
      });
      await handler(makeEvent());
      expect(errorLog).toHaveBeenCalledWith('[nexpath] checkPeOrigin failed:', expect.any(Error));
      expect(injectSelection).toHaveBeenCalledWith('Refine the request', makeEvent());
      expect(injectPeResult).not.toHaveBeenCalled();
    });

    it('logs injectPeResult failures distinctly from injectSelection failures', async () => {
      checkPeOrigin.mockResolvedValueOnce(true);
      injectPeResult.mockRejectedValueOnce(new Error('inject blew up'));
      spawnStop.mockResolvedValueOnce(fakeSelection);
      const handler = createChatEventHandler({
        spawnAuto, spawnStop, injectSelection, onAfterCapture,
        checkPeOrigin, injectPeResult,
        logger: { error: errorLog },
      });
      await expect(handler(makeEvent())).resolves.toBeUndefined();
      expect(errorLog).toHaveBeenCalledWith('[nexpath] injectPeResult failed:', expect.any(Error));
    });

    it('never calls checkPeOrigin when spawnAuto rejects (no turn to classify)', async () => {
      spawnAuto.mockRejectedValueOnce(new Error('auto blew up'));
      const handler = createChatEventHandler({
        spawnAuto, spawnStop, injectSelection, onAfterCapture,
        checkPeOrigin, injectPeResult,
        logger: { error: errorLog },
      });
      await handler(makeEvent());
      expect(checkPeOrigin).not.toHaveBeenCalled();
    });

    it('calls neither injectSelection nor injectPeResult when there is no selection, even when checkPeOrigin is true', async () => {
      checkPeOrigin.mockResolvedValueOnce(true);
      spawnStop.mockResolvedValueOnce(null);
      const handler = createChatEventHandler({
        spawnAuto, spawnStop, injectSelection, onAfterCapture,
        checkPeOrigin, injectPeResult,
        logger: { error: errorLog },
      });
      await handler(makeEvent());
      expect(injectSelection).not.toHaveBeenCalled();
      expect(injectPeResult).not.toHaveBeenCalled();
    });

    it('runs checkPeOrigin right after spawnAuto, before onAfterCapture and spawnStop', async () => {
      spawnStop.mockResolvedValueOnce(fakeSelection);
      const handler = createChatEventHandler({
        spawnAuto, spawnStop, injectSelection, onAfterCapture,
        checkPeOrigin, injectPeResult,
        logger: { error: errorLog },
      });
      await handler(makeEvent());
      expect(spawnAuto.mock.invocationCallOrder[0]).toBeLessThan(
        checkPeOrigin.mock.invocationCallOrder[0],
      );
      expect(checkPeOrigin.mock.invocationCallOrder[0]).toBeLessThan(
        onAfterCapture.mock.invocationCallOrder[0],
      );
      expect(checkPeOrigin.mock.invocationCallOrder[0]).toBeLessThan(
        spawnStop.mock.invocationCallOrder[0],
      );
    });
  });

  describe('F6 self-echo guard (isPeEcho)', () => {
    let isPeEcho: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      isPeEcho = vi.fn().mockResolvedValue(false);
    });

    it('skips auto/stop/inject entirely when isPeEcho reports a self-echo', async () => {
      isPeEcho.mockResolvedValueOnce(true);
      const handler = createChatEventHandler({
        spawnAuto, spawnStop, injectSelection, onAfterCapture, isPeEcho,
        logger: { error: errorLog },
      });
      await handler(makeEvent());
      expect(spawnAuto).not.toHaveBeenCalled();
      expect(spawnStop).not.toHaveBeenCalled();
      expect(onAfterCapture).not.toHaveBeenCalled();
      expect(injectSelection).not.toHaveBeenCalled();
      expect(errorLog).not.toHaveBeenCalled();
    });

    it('runs isPeEcho before spawnAuto when it reports false (checked first, but does not block)', async () => {
      isPeEcho.mockResolvedValueOnce(false);
      spawnStop.mockResolvedValueOnce(fakeSelection);
      const handler = createChatEventHandler({
        spawnAuto, spawnStop, injectSelection, onAfterCapture, isPeEcho,
        logger: { error: errorLog },
      });
      await handler(makeEvent());
      expect(isPeEcho.mock.invocationCallOrder[0]).toBeLessThan(
        spawnAuto.mock.invocationCallOrder[0],
      );
    });

    it('proceeds normally when isPeEcho reports false', async () => {
      isPeEcho.mockResolvedValueOnce(false);
      spawnStop.mockResolvedValueOnce(fakeSelection);
      const handler = createChatEventHandler({
        spawnAuto, spawnStop, injectSelection, onAfterCapture, isPeEcho,
        logger: { error: errorLog },
      });
      await handler(makeEvent());
      expect(spawnAuto).toHaveBeenCalledOnce();
      expect(injectSelection).toHaveBeenCalledWith('Refine the request', makeEvent());
    });

    it('treats an isPeEcho rejection as "not an echo" (fail-safe) and proceeds', async () => {
      isPeEcho.mockRejectedValueOnce(new Error('record store blew up'));
      spawnStop.mockResolvedValueOnce(fakeSelection);
      const handler = createChatEventHandler({
        spawnAuto, spawnStop, injectSelection, onAfterCapture, isPeEcho,
        logger: { error: errorLog },
      });
      await handler(makeEvent());
      expect(errorLog).toHaveBeenCalledWith('[nexpath] isPeEcho check failed:', expect.any(Error));
      expect(spawnAuto).toHaveBeenCalledOnce();
      expect(injectSelection).toHaveBeenCalledWith('Refine the request', makeEvent());
    });

    it('a synchronous (non-Promise) true return also short-circuits the handler', async () => {
      isPeEcho.mockReturnValueOnce(true);
      const handler = createChatEventHandler({
        spawnAuto, spawnStop, injectSelection, onAfterCapture, isPeEcho,
        logger: { error: errorLog },
      });
      await handler(makeEvent());
      expect(spawnAuto).not.toHaveBeenCalled();
    });
  });

  // ── Default logger redaction ─────────────────────────────────────────────
  // Every test above injects a logger, so the built-in one was never exercised.
  // extension.ts injects its own in production, but the default must be safe on
  // its own: this pipeline catches spawnAuto/spawnStop failures, and those
  // errors can carry a delivered body or the user's prompt in a `cause` chain.

  it('the default logger redacts the error instead of logging the raw object', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const leaky = new Error('spawnAuto failed', {
        cause: new Error('stop stdout was ZZQX_BODY_MARKER_7741'),
      });
      spawnAuto.mockRejectedValueOnce(leaky);

      // No `logger` key — exercise the built-in default.
      const handler = createChatEventHandler({ spawnAuto, spawnStop, injectSelection });
      await expect(handler(makeEvent())).resolves.toBeUndefined();

      expect(consoleError).toHaveBeenCalled();
      const [, payload] = consoleError.mock.calls[0]!;

      // A closed record, not the Error — so no stack and no cause payload.
      expect(payload).not.toBeInstanceOf(Error);
      expect(payload).toEqual(
        expect.objectContaining({ name: 'Error', message: 'spawnAuto failed', causeChainDepth: 1 }),
      );
      expect(JSON.stringify(payload)).not.toContain('ZZQX_BODY_MARKER_7741');
    } finally {
      consoleError.mockRestore();
    }
  });

  it('the default logger keeps the handler non-throwing', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      spawnAuto.mockRejectedValueOnce(new Error('boom'));
      const handler = createChatEventHandler({ spawnAuto, spawnStop, injectSelection });
      await expect(handler(makeEvent())).resolves.toBeUndefined();
    } finally {
      consoleError.mockRestore();
    }
  });
});
