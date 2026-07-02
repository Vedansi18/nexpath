import { describe, it, expect, vi, beforeEach } from 'vitest';

type OnMessageListener = (msg: unknown, sender: unknown, sendResponse: (r: unknown) => void) => boolean;

const { addListenerMock } = vi.hoisted(() => ({ addListenerMock: vi.fn() }));
let registeredListener: OnMessageListener | undefined;

vi.mock('webextension-polyfill', () => ({
  default: { runtime: { onMessage: { addListener: addListenerMock } } },
}));

describe('offscreen.ts', () => {
  beforeEach(async () => {
    addListenerMock.mockClear();
    addListenerMock.mockImplementation((listener: OnMessageListener) => {
      registeredListener = listener;
    });
    registeredListener = undefined;
    vi.resetModules();
    await import('./offscreen.js');
  });

  it('registers exactly one onMessage listener', () => {
    expect(addListenerMock).toHaveBeenCalledOnce();
    expect(registeredListener).toBeTypeOf('function');
  });

  it('responds with the neutral stub result for nexpath:embedding-classify', () => {
    const sendResponse = vi.fn();
    const handled = registeredListener!({ type: 'nexpath:embedding-classify', text: 'hi' }, {}, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith({
      result: { stage: 'implementation', confidence: 0.0, tier: 3 },
    });
    expect(handled).toBe(false);
  });

  it('ignores messages of a different type', () => {
    const sendResponse = vi.fn();
    const handled = registeredListener!({ type: 'nexpath:something-else' }, {}, sendResponse);

    expect(sendResponse).not.toHaveBeenCalled();
    expect(handled).toBe(false);
  });
});
