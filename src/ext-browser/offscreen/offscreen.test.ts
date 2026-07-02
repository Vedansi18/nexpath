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
      result: { stage: 'implementation', confidence: 0.0, tier: 3, allScores: {} },
    });
    // Always true — webextension-polyfill's OnMessageListenerCallback type requires the
    // literal `true` for the 3-arg (sendResponse) form; see the source's header comment.
    expect(handled).toBe(true);
  });

  it('ignores messages of a different type, responding with undefined', () => {
    const sendResponse = vi.fn();
    const handled = registeredListener!({ type: 'nexpath:something-else' }, {}, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith(undefined);
    expect(handled).toBe(true);
  });
});
