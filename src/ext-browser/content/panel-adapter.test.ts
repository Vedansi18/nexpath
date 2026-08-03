import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AdvisoryPayload, PanelEvent } from '../../core/ports/ui.port.js';

const sendMessageMock = vi.fn();

vi.mock('webextension-polyfill', () => ({
  default: { tabs: { sendMessage: sendMessageMock } },
}));

const { ContentScriptUIAdapter } = await import('./panel-adapter.js');

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
  });

  it('sends a nexpath:show-advisory message to the given tab', async () => {
    sendMessageMock.mockResolvedValue({ type: 'dismiss', advisoryId: 'adv-1' });
    const adapter = new ContentScriptUIAdapter(42);
    const payload = makePayload();
    await adapter.showAdvisory(payload);

    expect(sendMessageMock).toHaveBeenCalledWith(42, { type: 'nexpath:show-advisory', payload });
  });

  it('resolves with the content script response', async () => {
    const response: PanelEvent = { type: 'select', advisoryId: 'adv-1', selectedOptionId: 'l1-0' };
    sendMessageMock.mockResolvedValue(response);

    const adapter = new ContentScriptUIAdapter(1);
    const result = await adapter.showAdvisory(makePayload());

    expect(result).toEqual(response);
  });

  it('resolves with a dismiss event when the response is undefined (tab closed / no responder)', async () => {
    sendMessageMock.mockResolvedValue(undefined);

    const adapter = new ContentScriptUIAdapter(1);
    const result = await adapter.showAdvisory(makePayload());

    expect(result).toEqual({ type: 'dismiss', advisoryId: 'adv-1' });
  });

  it('rejects when there is no listening tab/content script (connection error)', async () => {
    sendMessageMock.mockRejectedValue(new Error('Could not establish connection'));

    const adapter = new ContentScriptUIAdapter(1);
    await expect(adapter.showAdvisory(makePayload())).rejects.toThrow('Could not establish connection');
  });
});
