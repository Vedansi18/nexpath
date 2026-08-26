import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGet, mockAddListener, mockSendMessage, mockSetInterceptor } = vi.hoisted(() => ({
  mockGet: vi.fn(), mockAddListener: vi.fn(), mockSendMessage: vi.fn(), mockSetInterceptor: vi.fn(),
}));
vi.mock('webextension-polyfill', () => ({
  default: {
    storage: { local: { get: mockGet }, onChanged: { addListener: mockAddListener } },
    runtime: { sendMessage: mockSendMessage },
  },
}));
vi.mock('./capture-kit.js', () => ({ setComposerSubmitInterceptor: mockSetInterceptor }));

import { installSubmitGate } from './install-submit-gate.js';
import { SITE_SUBSTITUTION_STRATEGY } from '../../inject/submit-substitution.js';

/** The interceptor the installer handed to capture-kit. */
type Interceptor = (
  ev: Event, prompt: string, input: HTMLElement,
  composer: { readComposerText: (el: HTMLElement) => string },
) => boolean;

function lastInterceptor(): Interceptor {
  return mockSetInterceptor.mock.calls.at(-1)![0] as Interceptor;
}

function makeEvent() {
  return {
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  } as unknown as Event;
}

const COMPOSER = { readComposerText: () => 'ship this to production now' };
const INPUT = {} as HTMLElement;

/** Let the installer's async switch resolution settle. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.clearAllMocks();
  // Nothing in storage ⇒ the switch resolves to its shipped default: ON.
  mockGet.mockResolvedValue({});
  vi.stubGlobal('window', { location: { hostname: 'bolt.new', pathname: '/~/p1', origin: 'https://bolt.new' } });
  vi.stubGlobal('document', { querySelector: vi.fn().mockReturnValue({ click: vi.fn() }) });
});

describe('installSubmitGate — exactly one gate may own a site', () => {
  it('a COMPOSER-mechanism site is intercepted when the switch is on', async () => {
    expect(SITE_SUBSTITUTION_STRATEGY['bolt']).toBe('composer_intercept');
    installSubmitGate({ agent: 'bolt', submitButtonSelector: '#send', injectPromptText: vi.fn() });
    await settle();

    const ev = makeEvent();
    expect(lastInterceptor()(ev, 'ship this to production now', INPUT, COMPOSER)).toBe(true);
    expect(ev.preventDefault).toHaveBeenCalled();
  });

  it('a BODY-REWRITE site is NOT intercepted, even with the switch on', async () => {
    // Lovable is rewritten by the page's fetch patch. If this gate also took the
    // submission, one prompt would be decided twice — and on Lovable it would
    // also cancel the very request the rewrite path needs to hold.
    expect(SITE_SUBSTITUTION_STRATEGY['lovable']).toBe('body_rewrite');
    installSubmitGate({ agent: 'lovable', submitButtonSelector: '#send', injectPromptText: vi.fn() });
    await settle();

    const ev = makeEvent();
    expect(lastInterceptor()(ev, 'ship this to production now', INPUT, COMPOSER)).toBe(false);
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });

  it('follows the table rather than the agent name — flipping a site flips the gate', async () => {
    const prev = SITE_SUBSTITUTION_STRATEGY['bolt'];
    try {
      SITE_SUBSTITUTION_STRATEGY['bolt'] = 'body_rewrite';
      installSubmitGate({ agent: 'bolt', submitButtonSelector: '#send', injectPromptText: vi.fn() });
      await settle();
      expect(lastInterceptor()(makeEvent(), 'ship this to production now', INPUT, COMPOSER)).toBe(false);
    } finally {
      SITE_SUBSTITUTION_STRATEGY['bolt'] = prev!;
    }
  });

  it('an explicitly disabled site is not intercepted', async () => {
    mockGet.mockResolvedValue({ bolt_promptsubmit_advisory: 'false' });
    installSubmitGate({ agent: 'bolt', submitButtonSelector: '#send', injectPromptText: vi.fn() });
    await settle();
    expect(lastInterceptor()(makeEvent(), 'ship this to production now', INPUT, COMPOSER)).toBe(false);
  });

  it('does not intercept before the switch has resolved', () => {
    installSubmitGate({ agent: 'bolt', submitButtonSelector: '#send', injectPromptText: vi.fn() });
    // No await: storage has not answered yet, so the page must behave as today.
    expect(lastInterceptor()(makeEvent(), 'ship this to production now', INPUT, COMPOSER)).toBe(false);
  });

  it('marks the replacement as injected BEFORE delivering it', async () => {
    const injectPromptText = vi.fn().mockResolvedValue(undefined);
    installSubmitGate({ agent: 'bolt', submitButtonSelector: '#send', injectPromptText });
    await settle();
    mockSendMessage.mockResolvedValue({ decision: { kind: 'block', replacement: 'the improved prompt' } });

    lastInterceptor()(makeEvent(), 'ship this to production now', INPUT, COMPOSER);
    await vi.waitFor(() => expect(injectPromptText).toHaveBeenCalledWith('the improved prompt'));

    const marks = mockSendMessage.mock.calls
      .map((c) => c[0] as { type?: string; text?: string })
      .filter((m) => m.type === 'nexpath:prompt-injected');
    expect(marks).toHaveLength(1);
    expect(marks[0]!.text).toBe('the improved prompt');
  });
});
