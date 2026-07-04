// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createCaptureKit, type CaptureKitConfig } from './capture-kit.js';

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Deliberately NON-Replit selectors throughout this file: the kit's whole point is
// that the machinery works against whatever selectors an agent config supplies —
// these tests are the proof of that parameterization (Replit-shaped coverage lives
// in replit.test.ts, which exercises the same kit through the real Replit config).
// Each test uses its own selector/flag values so the never-disconnected observers a
// bootstrap() test leaves behind can't react to a later test's DOM.
function makeConfig(overrides: Partial<CaptureKitConfig> = {}): CaptureKitConfig {
  return {
    agent: 'test-agent',
    captureTier: 'mutation-observer',
    bootstrapFlag: '__nexpathTestBootstrapped',
    userMessageSelector: '[data-testid="chat-msg"]',
    extractPromptText: (el) => (el.textContent ?? '').trim(),
    stopButtonSelector: '[data-testid="stop-btn"]',
    ...overrides,
  };
}

describe('content/agents/capture-kit.ts', () => {
  let postMessageSpy: ReturnType<typeof vi.spyOn>;
  let observers: Array<{ disconnect(): void }>;

  beforeEach(async () => {
    document.body.innerHTML = '';
    await flush();
    postMessageSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    observers = [];
  });

  afterEach(() => {
    observers.forEach((o) => o.disconnect());
    postMessageSpy.mockRestore();
  });

  it('carries the configured agent id in prompt-captured messages', async () => {
    const kit = createCaptureKit(makeConfig({ agent: 'bolt', userMessageSelector: '[data-testid="bolt-msg"]' }));
    observers.push(kit.observeUserMessages(document.body));

    const el = document.createElement('div');
    el.setAttribute('data-testid', 'bolt-msg');
    el.textContent = 'build a landing page';
    document.body.appendChild(el);
    await flush();

    expect(postMessageSpy).toHaveBeenCalledWith(
      { type: 'nexpath:prompt-captured', promptText: 'build a landing page', agent: 'bolt' },
      window.location.origin,
    );
  });

  it('captures via a fully custom message selector and extractPromptText', async () => {
    const kit = createCaptureKit(
      makeConfig({
        userMessageSelector: 'article.user-turn',
        extractPromptText: (el) => (el.querySelector('.body')?.textContent ?? '').trim(),
      }),
    );
    observers.push(kit.observeUserMessages(document.body));

    const el = document.createElement('article');
    el.className = 'user-turn';
    const body = document.createElement('div');
    body.className = 'body';
    body.textContent = 'the actual prompt';
    el.appendChild(body);
    const meta = document.createElement('span');
    meta.textContent = 'Just now';
    el.appendChild(meta);
    document.body.appendChild(el);
    await flush();

    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ promptText: 'the actual prompt' }),
      window.location.origin,
    );
  });

  it('two kit instances have independent consecutive-text dedup state', async () => {
    const kitA = createCaptureKit(makeConfig({ agent: 'agent-a', userMessageSelector: '[data-testid="a-msg"]' }));
    const kitB = createCaptureKit(makeConfig({ agent: 'agent-b', userMessageSelector: '[data-testid="b-msg"]' }));
    observers.push(kitA.observeUserMessages(document.body), kitB.observeUserMessages(document.body));

    for (const testid of ['a-msg', 'b-msg']) {
      const el = document.createElement('div');
      el.setAttribute('data-testid', testid);
      el.textContent = 'same text on both agents';
      document.body.appendChild(el);
    }
    await flush();

    // If dedup state were module-level (as it was pre-extraction), the second
    // agent's identical text would be swallowed by the first agent's guard.
    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'agent-a' }),
      window.location.origin,
    );
    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'agent-b' }),
      window.location.origin,
    );
  });

  it('two kit instances have independent response-stop time dedup', async () => {
    const kitA = createCaptureKit(makeConfig({ agent: 'agent-a', stopButtonSelector: '[data-testid="a-stop"]' }));
    const kitB = createCaptureKit(makeConfig({ agent: 'agent-b', stopButtonSelector: '[data-testid="b-stop"]' }));

    const stopA = document.createElement('button');
    stopA.setAttribute('data-testid', 'a-stop');
    const stopB = document.createElement('button');
    stopB.setAttribute('data-testid', 'b-stop');
    document.body.append(stopA, stopB);
    await flush();

    observers.push(kitA.observeStopButton(document.body), kitB.observeStopButton(document.body));
    stopA.remove();
    stopB.remove();
    await flush();

    const stoppedAgents = postMessageSpy.mock.calls
      .map(([msg]) => msg as { type: string; agent: string })
      .filter((msg) => msg.type === 'nexpath:response-stopped')
      .map((msg) => msg.agent);
    expect(stoppedAgents).toContain('agent-a');
    expect(stoppedAgents).toContain('agent-b');
  });

  it('completion label detection uses the configured pattern and log line', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const kit = createCaptureKit(
        makeConfig({
          agent: 'lovable',
          completionLabel: {
            pattern: /\bFinished in\s+\d/,
            maxTextLength: 60,
            log: '[nexpath] response-stop detected (custom label)',
          },
        }),
      );
      observers.push(kit.observeCompletionLabel(document.body));

      const label = document.createElement('span');
      label.textContent = 'Finished in 12 seconds';
      document.body.appendChild(label);
      await flush();

      expect(logSpy).toHaveBeenCalledWith('[nexpath] response-stop detected (custom label)');
      expect(postMessageSpy).toHaveBeenCalledWith(
        { type: 'nexpath:response-stopped', agent: 'lovable' },
        window.location.origin,
      );
    } finally {
      logSpy.mockRestore();
    }
  });

  it('observeComposerSubmit throws when the config has no composer section', () => {
    const kit = createCaptureKit(makeConfig());
    expect(() => kit.observeComposerSubmit(document)).toThrow(/composer config/);
  });

  it('observeCompletionLabel throws when the config has no completionLabel section', () => {
    const kit = createCaptureKit(makeConfig());
    expect(() => kit.observeCompletionLabel(document.body)).toThrow(/completionLabel config/);
  });

  it('composer capture works against fully custom composer/submit selectors', () => {
    const kit = createCaptureKit(
      makeConfig({
        agent: 'bolt',
        stopButtonSelector: '[data-testid="kit-cc-stop"]',
        composer: {
          composerSelector: '[data-testid="kit-cc-editor"]',
          submitButtonSelector: '[data-testid="kit-cc-send"]',
          readComposerText: (input) => (input.textContent ?? '').trim(),
        },
      }),
    );
    observers.push(kit.observeComposerSubmit(document));

    const container = document.createElement('div');
    const editor = document.createElement('div');
    editor.setAttribute('data-testid', 'kit-cc-editor');
    editor.textContent = 'ship it';
    const send = document.createElement('button');
    send.setAttribute('data-testid', 'kit-cc-send');
    container.append(editor, send);
    document.body.appendChild(container);

    send.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(postMessageSpy).toHaveBeenCalledWith(
      { type: 'nexpath:prompt-captured', promptText: 'ship it', agent: 'bolt' },
      window.location.origin,
    );
  });

  it('bootstrap guards on the configured window flag and only wires configured channels', async () => {
    const flag = '__nexpathKitBootstrapTest';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      // Minimal config: no composer, no completionLabel — bootstrap must not throw
      // for channels the agent didn't configure.
      const kit = createCaptureKit(
        makeConfig({
          bootstrapFlag: flag,
          userMessageSelector: '[data-testid="kit-bs-msg"]',
          stopButtonSelector: '[data-testid="kit-bs-stop"]',
        }),
      );
      kit.bootstrap();
      expect((window as unknown as Record<string, boolean>)[flag]).toBe(true);
      expect(logSpy).toHaveBeenCalledWith('[nexpath] capture: mutation-observer');

      // Second bootstrap (stale re-injection) is a logged no-op.
      logSpy.mockClear();
      kit.bootstrap();
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('skipped, already bootstrapped in this page'),
      );

      // The configured message channel is live after bootstrap.
      const el = document.createElement('div');
      el.setAttribute('data-testid', 'kit-bs-msg');
      el.textContent = 'post-bootstrap capture';
      document.body.appendChild(el);
      await flush();
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({ promptText: 'post-bootstrap capture' }),
        window.location.origin,
      );
    } finally {
      logSpy.mockRestore();
      delete (window as unknown as Record<string, boolean | undefined>)[flag];
    }
  });
});
