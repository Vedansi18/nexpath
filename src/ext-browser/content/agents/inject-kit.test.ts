// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { injectViaSimulatedPaste, clipboardFallback } from './inject-kit.js';

// Parameterization proof for the shared inject kit: works against arbitrary,
// NON-Replit selectors. The full behavior matrix (focus, landed-verification,
// fallback paths) is covered by replit-inject.test.ts, which exercises this same
// code through the real Replit config.
describe('content/agents/inject-kit.ts — injectViaSimulatedPaste', () => {
  let clipboardWriteTextMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.body.innerHTML = '';
    clipboardWriteTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: clipboardWriteTextMock },
      configurable: true,
    });

    // jsdom implements neither DataTransfer nor ClipboardEvent — same minimal stubs
    // as replit-inject.test.ts (see the caveat there: this exercises the function's
    // own logic, not any real editor's paste handling).
    if (typeof globalThis.DataTransfer === 'undefined') {
      vi.stubGlobal('DataTransfer', class {
        private data = new Map<string, string>();
        setData(format: string, data: string): void { this.data.set(format, data); }
        getData(format: string): string { return this.data.get(format) ?? ''; }
      });
    }
    if (typeof globalThis.ClipboardEvent === 'undefined') {
      vi.stubGlobal('ClipboardEvent', class extends Event {
        clipboardData: unknown;
        constructor(type: string, init: { clipboardData?: unknown } & EventInit = {}) {
          super(type, init);
          this.clipboardData = init.clipboardData;
        }
      });
    }

    // Default execCommand to an inert no-op so the paste-fallback tests are
    // deterministic (jsdom doesn't implement it). The Firefox-path test below
    // overrides this to simulate an editor honoring execCommand('insertText').
    Object.defineProperty(document, 'execCommand', {
      value: vi.fn().mockReturnValue(false),
      configurable: true,
    });
  });

  it('injects into an element matched by an arbitrary configured selector', async () => {
    const input = document.createElement('div');
    input.id = 'bolt-composer';
    document.body.appendChild(input);
    input.addEventListener('paste', (ev) => {
      const text = (ev as ClipboardEvent).clipboardData?.getData('text/plain') ?? '';
      input.textContent = text;
    });

    await injectViaSimulatedPaste('#bolt-composer', 'add dark mode');

    expect(input.textContent).toBe('add dark mode');
    expect(clipboardWriteTextMock).not.toHaveBeenCalled();
  });

  it('auto-submits (dispatches Enter) after the paste lands — "Send to your agent now"', async () => {
    const input = document.createElement('div');
    input.id = 'composer';
    document.body.appendChild(input);
    input.addEventListener('paste', (ev) => {
      input.textContent = (ev as ClipboardEvent).clipboardData?.getData('text/plain') ?? '';
    });
    const keys: string[] = [];
    input.addEventListener('keydown', (e) => keys.push((e as KeyboardEvent).key));

    await injectViaSimulatedPaste('#composer', 'run the tests');

    expect(input.textContent).toBe('run the tests');
    expect(keys).toContain('Enter'); // submitted so the agent acts on it
  });

  it('does NOT submit when the paste failed to land (falls back, no stray Enter)', async () => {
    const input = document.createElement('div');
    input.className = 'editor'; // no paste listener → text never lands
    document.body.appendChild(input);
    const keys: string[] = [];
    input.addEventListener('keydown', (e) => keys.push((e as KeyboardEvent).key));

    await injectViaSimulatedPaste('.editor', 'run the tests');

    expect(keys).not.toContain('Enter');
    expect(clipboardWriteTextMock).toHaveBeenCalledWith('run the tests');
  });

  it('falls back to clipboard when the configured selector matches nothing', async () => {
    await injectViaSimulatedPaste('[data-testid="missing-editor"]', 'add dark mode');
    expect(clipboardWriteTextMock).toHaveBeenCalledWith('add dark mode');
  });

  it('falls back to clipboard when the paste does not visibly land in the matched element', async () => {
    const input = document.createElement('div');
    input.className = 'lovable-editor';
    document.body.appendChild(input); // no paste listener — text never lands

    await injectViaSimulatedPaste('.lovable-editor', 'add dark mode');

    expect(clipboardWriteTextMock).toHaveBeenCalledWith('add dark mode');
  });

  it('Firefox path: synthetic paste is inert, execCommand insertText lands → submits, no clipboard', async () => {
    // Reproduces Firefox: the ClipboardEvent carries no usable clipboardData, so the
    // paste listener sees nothing and the text never lands via paste. The editor DOES
    // honor the trusted execCommand('insertText') that runs as the fallback.
    const input = document.createElement('div');
    input.className = 'ff-editor';
    document.body.appendChild(input);
    input.addEventListener('paste', () => { /* Firefox: clipboardData empty, nothing inserted */ });
    const keys: string[] = [];
    input.addEventListener('keydown', (e) => keys.push((e as KeyboardEvent).key));

    const execMock = vi.fn((cmd: string, _ui?: boolean, value?: string) => {
      if (cmd === 'insertText') { input.textContent = value ?? ''; return true; }
      return false;
    });
    Object.defineProperty(document, 'execCommand', { value: execMock, configurable: true });

    await injectViaSimulatedPaste('.ff-editor', 'ship the release');

    expect(execMock).toHaveBeenCalledWith('insertText', false, 'ship the release');
    expect(input.textContent).toBe('ship the release');
    expect(keys).toContain('Enter');                       // auto-submitted, same as Chrome
    expect(clipboardWriteTextMock).not.toHaveBeenCalled(); // did NOT degrade to clipboard
  });

  it('Chrome path is unchanged: paste lands first try, execCommand is never invoked', async () => {
    const input = document.createElement('div');
    input.id = 'chrome-composer';
    document.body.appendChild(input);
    input.addEventListener('paste', (ev) => {
      input.textContent = (ev as ClipboardEvent).clipboardData?.getData('text/plain') ?? '';
    });
    const execSpy = document.execCommand as unknown as ReturnType<typeof vi.fn>;

    await injectViaSimulatedPaste('#chrome-composer', 'run the tests');

    expect(input.textContent).toBe('run the tests');
    expect(execSpy).not.toHaveBeenCalled(); // Firefox fallback never runs when paste lands
  });

  it('clipboardFallback (exported for hosts with no injector) copies and toasts', async () => {
    await clipboardFallback('option text for an agent without inject-back yet');
    expect(clipboardWriteTextMock).toHaveBeenCalledWith('option text for an agent without inject-back yet');
  });
});
