// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { injectPromptText } from './replit-inject.js';

describe('replit-inject.ts — injectPromptText', () => {
  let clipboardWriteTextMock: ReturnType<typeof vi.fn>;

  function makeInput(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'cm-content';
    el.setAttribute('contenteditable', 'true');
    document.body.appendChild(el);
    return el;
  }

  beforeEach(() => {
    document.body.innerHTML = '';
    clipboardWriteTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: clipboardWriteTextMock },
      configurable: true,
    });

    // jsdom does not implement DataTransfer at all — this is a real gap in the test
    // environment (not a test bug), consistent with the rest of this session's finding
    // that real-browser paste/editor behaviour can't be fully verified outside Chrome.
    // Minimal stub lets us exercise this function's own logic (landed vs not-landed
    // detection, fallback triggering) — it does NOT prove Replit's real CodeMirror
    // instance accepts a synthetic paste the same way; that still needs a live test.
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

  it('falls back to clipboard immediately when the input element is not found', async () => {
    await injectPromptText('write a test');
    expect(clipboardWriteTextMock).toHaveBeenCalledWith('write a test');
  });

  it('dispatches a paste event and does not fall back when the editor updates its content', async () => {
    const input = makeInput();
    // Simulates CodeMirror's real paste handling — extracts clipboardData, writes to DOM.
    input.addEventListener('paste', (ev) => {
      const text = (ev as ClipboardEvent).clipboardData?.getData('text/plain') ?? '';
      input.textContent = text;
    });

    await injectPromptText('write a test');

    expect(input.textContent).toBe('write a test');
    expect(clipboardWriteTextMock).not.toHaveBeenCalled();
  });

  it('falls back to clipboard when the paste event does not visibly update the input', async () => {
    makeInput(); // no paste listener attached — nothing changes textContent, matching an editor that ignores the synthetic event

    await injectPromptText('write a test');

    expect(clipboardWriteTextMock).toHaveBeenCalledWith('write a test');
  });

  it('focuses the input before dispatching the paste event', async () => {
    const input = makeInput();
    const focusSpy = vi.spyOn(input, 'focus');
    input.addEventListener('paste', (ev) => {
      const text = (ev as ClipboardEvent).clipboardData?.getData('text/plain') ?? '';
      input.textContent = text;
    });

    await injectPromptText('hello');

    expect(focusSpy).toHaveBeenCalled();
  });
});
