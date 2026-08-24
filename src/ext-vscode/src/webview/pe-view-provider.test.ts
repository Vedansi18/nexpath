import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({}));

import {
  NexpathPromptEnhancementViewProvider,
  PE_VIEW_ID,
} from './pe-view-provider.js';
import type { PromptEnhancementExtensionPayloadV1 } from '../pe-payload.js';

interface FakeWebview {
  options: unknown;
  html: string;
  cspSource: string;
  onDidReceiveMessage: ReturnType<typeof vi.fn>;
  __messageListener: ((m: unknown) => void) | undefined;
}

interface FakeWebviewView {
  webview: FakeWebview;
  show: ReturnType<typeof vi.fn>;
  onDidDispose: ReturnType<typeof vi.fn>;
  __disposeListener: (() => void) | undefined;
}

function makeFakeView(): FakeWebviewView {
  const view: FakeWebviewView = {
    webview: {
      options: undefined,
      html: '',
      cspSource: 'vscode-resource:csp-source',
      onDidReceiveMessage: vi.fn((fn: (m: unknown) => void) => {
        view.webview.__messageListener = fn;
        return { dispose: vi.fn() };
      }),
      __messageListener: undefined,
    },
    show: vi.fn(),
    onDidDispose: vi.fn((fn: () => void) => {
      view.__disposeListener = fn;
      return { dispose: vi.fn() };
    }),
    __disposeListener: undefined,
  };
  return view;
}

const fakeUri = { fsPath: '/fake/extension' } as unknown as never;

const payload: PromptEnhancementExtensionPayloadV1 = {
  transportVersion: 1,
  enhancementId: 'enh-1',
  validationDecisionId: 'vd-1',
  currentBodyId: 'body-1',
  bodyRevision: 1,
  currentBodyText: 'the enhanced prompt body',
  sendPolicy: 'send_current',
  renderState: 'ready',
  additionalDetailsAvailable: false,
  directionalActions: [],
  closeActionId: 'a-close',
};

describe('NexpathPromptEnhancementViewProvider — static fields', () => {
  it('exposes a distinct view id from the DS view', () => {
    expect(PE_VIEW_ID).toBe('nexpath.promptEnhancement');
  });
});

describe('NexpathPromptEnhancementViewProvider.resolveWebviewView', () => {
  it('renders the no-popup state initially (no payload published yet)', () => {
    const provider = new NexpathPromptEnhancementViewProvider(fakeUri);
    const view = makeFakeView();
    provider.resolveWebviewView(view as never, {} as never, {} as never);
    expect(view.webview.html).toContain('No prompt enhancement is pending');
    expect(view.webview.options).toEqual({
      enableScripts: true,
      localResourceRoots: [fakeUri],
    });
  });

  it('renders a previously-published payload if resolveWebviewView fires after publishPayload', () => {
    const provider = new NexpathPromptEnhancementViewProvider(fakeUri);
    provider.publishPayload(payload);
    const view = makeFakeView();
    provider.resolveWebviewView(view as never, {} as never, {} as never);
    expect(view.webview.html).toContain('the enhanced prompt body');
  });

  it('clears the stored view reference on dispose', () => {
    const provider = new NexpathPromptEnhancementViewProvider(fakeUri);
    const view = makeFakeView();
    provider.resolveWebviewView(view as never, {} as never, {} as never);
    view.__disposeListener?.();
    // publishPayload after dispose must not throw even though `view` is gone
    expect(() => provider.publishPayload(payload)).not.toThrow();
  });
});

describe('NexpathPromptEnhancementViewProvider.publishPayload', () => {
  it('updates the html and reveals the view when resolved', () => {
    const provider = new NexpathPromptEnhancementViewProvider(fakeUri);
    const view = makeFakeView();
    provider.resolveWebviewView(view as never, {} as never, {} as never);
    provider.publishPayload(payload);
    expect(view.webview.html).toContain('the enhanced prompt body');
    expect(view.show).toHaveBeenCalledWith(true);
  });

  it('stores the payload even when the view is not yet resolved', () => {
    const provider = new NexpathPromptEnhancementViewProvider(fakeUri);
    provider.publishPayload(payload);
    expect(provider.getCurrentPayload()).toEqual(payload);
  });
});

describe('NexpathPromptEnhancementViewProvider.clearPayload', () => {
  it('resets to the no-popup state', () => {
    const provider = new NexpathPromptEnhancementViewProvider(fakeUri);
    const view = makeFakeView();
    provider.resolveWebviewView(view as never, {} as never, {} as never);
    provider.publishPayload(payload);
    provider.clearPayload();
    expect(view.webview.html).toContain('No prompt enhancement is pending');
    expect(provider.getCurrentPayload()).toBeNull();
  });

  it('is a no-op when the view is not resolved', () => {
    const provider = new NexpathPromptEnhancementViewProvider(fakeUri);
    expect(() => provider.clearPayload()).not.toThrow();
    expect(provider.getCurrentPayload()).toBeNull();
  });
});

describe('NexpathPromptEnhancementViewProvider.handleMessage', () => {
  it('forwards a well-formed message to onMessage', async () => {
    const onMessage = vi.fn().mockResolvedValue(undefined);
    const provider = new NexpathPromptEnhancementViewProvider(fakeUri, onMessage);
    await provider.handleMessage({ type: 'pe_deliver_current_body', bodyId: 'b' });
    expect(onMessage).toHaveBeenCalledWith({ type: 'pe_deliver_current_body', bodyId: 'b' });
  });

  it('drops non-object messages without calling onMessage', async () => {
    const onMessage = vi.fn();
    const provider = new NexpathPromptEnhancementViewProvider(fakeUri, onMessage);
    await provider.handleMessage('not an object');
    await provider.handleMessage(null);
    await provider.handleMessage(42);
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('drops messages with a non-string type without calling onMessage', async () => {
    const onMessage = vi.fn();
    const provider = new NexpathPromptEnhancementViewProvider(fakeUri, onMessage);
    await provider.handleMessage({ type: 123 });
    await provider.handleMessage({});
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('catches and logs when onMessage throws, never propagates', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onMessage = vi.fn().mockRejectedValue(new Error('routing blew up'));
    const provider = new NexpathPromptEnhancementViewProvider(fakeUri, onMessage);
    await expect(provider.handleMessage({ type: 'pe_close' })).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith('[nexpath] PE onMessage failed:', expect.any(Error));
    errorSpy.mockRestore();
  });

  it('defaults to a no-op handler when none is injected (P5 ships before P6 wires real routing)', async () => {
    const provider = new NexpathPromptEnhancementViewProvider(fakeUri);
    await expect(provider.handleMessage({ type: 'pe_deliver_current_body' })).resolves.toBeUndefined();
  });

  it('routes messages received via the real onDidReceiveMessage wiring', () => {
    const onMessage = vi.fn().mockResolvedValue(undefined);
    const provider = new NexpathPromptEnhancementViewProvider(fakeUri, onMessage);
    const view = makeFakeView();
    provider.resolveWebviewView(view as never, {} as never, {} as never);
    view.webview.__messageListener?.({ type: 'pe_close' });
    expect(onMessage).toHaveBeenCalledWith({ type: 'pe_close' });
  });
});
