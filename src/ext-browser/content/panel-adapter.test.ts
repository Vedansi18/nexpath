import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContentScriptUIAdapter } from './panel-adapter.js';
import type { AdvisoryPayload, PanelEvent } from '../../core/ports/ui.port.js';

const sendMessageMock = vi.fn();

vi.stubGlobal('chrome', {
  tabs: { sendMessage: sendMessageMock },
  runtime: { lastError: undefined as { message: string } | undefined },
});

function makePayload(): AdvisoryPayload {
  return {
    schemaVersion: 1,
    advisoryId: 'adv-1',
    pinchLabel: 'Hold up.',
    stage: 'implementation',
    options: [],
    meta: { agent: 'replit', frequency: 'optimum' },
  };
}

describe('ContentScriptUIAdapter', () => {
  beforeEach(() => {
    sendMessageMock.mockReset();
    (chrome.runtime as { lastError?: { message: string } }).lastError = undefined;
  });

  it('sends a nexpath:show-advisory message to the given tab', async () => {
    sendMessageMock.mockImplementation((_tabId, _msg, cb) => cb({ type: 'dismiss', advisoryId: 'adv-1' }));
    const adapter = new ContentScriptUIAdapter(42);
    const payload = makePayload();
    await adapter.showAdvisory(payload);

    expect(sendMessageMock).toHaveBeenCalledWith(
      42,
      { type: 'nexpath:show-advisory', payload },
      expect.any(Function),
    );
  });

  it('resolves with the content script response', async () => {
    const response: PanelEvent = { type: 'select', advisoryId: 'adv-1', selectedOptionId: 'l1-0' };
    sendMessageMock.mockImplementation((_tabId, _msg, cb) => cb(response));

    const adapter = new ContentScriptUIAdapter(1);
    const result = await adapter.showAdvisory(makePayload());

    expect(result).toEqual(response);
  });

  it('resolves with a dismiss event when the response is undefined (tab closed / no responder)', async () => {
    sendMessageMock.mockImplementation((_tabId, _msg, cb) => cb(undefined));

    const adapter = new ContentScriptUIAdapter(1);
    const result = await adapter.showAdvisory(makePayload());

    expect(result).toEqual({ type: 'dismiss', advisoryId: 'adv-1' });
  });

  it('rejects when chrome.runtime.lastError is set', async () => {
    sendMessageMock.mockImplementation((_tabId, _msg, cb) => {
      (chrome.runtime as { lastError?: { message: string } }).lastError = { message: 'Could not establish connection' };
      cb(undefined);
    });

    const adapter = new ContentScriptUIAdapter(1);
    await expect(adapter.showAdvisory(makePayload())).rejects.toThrow('Could not establish connection');
  });
});
