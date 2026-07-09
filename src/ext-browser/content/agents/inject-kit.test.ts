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

  it('clipboardFallback (exported for hosts with no injector) copies and toasts', async () => {
    await clipboardFallback('option text for an agent without inject-back yet');
    expect(clipboardWriteTextMock).toHaveBeenCalledWith('option text for an agent without inject-back yet');
  });
});
