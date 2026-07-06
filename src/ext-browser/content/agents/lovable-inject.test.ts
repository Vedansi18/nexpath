// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { injectPromptText } from './lovable-inject.js';

describe('lovable-inject.ts — injectPromptText', () => {
  let clipboardWriteTextMock: ReturnType<typeof vi.fn>;

  function makeTipTapInput(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'tiptap ProseMirror';
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('aria-label', 'Chat input');
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

    // Same jsdom gaps + minimal stubs as replit-inject.test.ts (see the caveat
    // there — this exercises the function's logic, not ProseMirror's real paste
    // handling; that needs a live test).
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

  it('targets the TipTap composer and does not fall back when the paste lands', async () => {
    const input = makeTipTapInput();
    input.addEventListener('paste', (ev) => {
      const text = (ev as ClipboardEvent).clipboardData?.getData('text/plain') ?? '';
      input.textContent = text;
    });

    await injectPromptText('add dark mode');

    expect(input.textContent).toBe('add dark mode');
    expect(clipboardWriteTextMock).not.toHaveBeenCalled();
  });

  it('falls back to clipboard when no TipTap composer exists on the page', async () => {
    await injectPromptText('add dark mode');
    expect(clipboardWriteTextMock).toHaveBeenCalledWith('add dark mode');
  });

  it('ignores a TipTap editor without the "Chat input" aria-label (wrong element) and falls back', async () => {
    const other = document.createElement('div');
    other.className = 'tiptap ProseMirror';
    other.setAttribute('contenteditable', 'true');
    other.addEventListener('paste', () => { other.textContent = 'should never land here'; });
    document.body.appendChild(other);

    await injectPromptText('add dark mode');

    expect(other.textContent).not.toBe('should never land here');
    expect(clipboardWriteTextMock).toHaveBeenCalledWith('add dark mode');
  });

  it('falls back to clipboard when the paste does not visibly land', async () => {
    makeTipTapInput(); // no paste listener — text never lands

    await injectPromptText('add dark mode');

    expect(clipboardWriteTextMock).toHaveBeenCalledWith('add dark mode');
  });
});
