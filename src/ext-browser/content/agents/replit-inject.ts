/**
 * Replit inject-back — B3.
 *
 * Deliberately a SEPARATE module from replit.ts, with zero top-level side effects.
 * replit.ts auto-runs bootstrap() on import (it IS the content script entry point for
 * Replit, loaded once via the manifest). content/inject.ts also needs injectPromptText,
 * but must NOT import it from replit.ts directly — esbuild's bundler (bundle: true)
 * inlines a module's entire top-level code, side effects included, into every entry
 * point that imports from it. Since inject.js and replit.js both load as separate
 * <script> tags on the same page, importing from replit.ts into inject.ts would silently
 * duplicate bootstrap()'s auto-run — two independent MutationObserver instances watching
 * the same DOM, doubling every capture. Confirmed directly: the built dist/ext-chrome/
 * content/inject.js contained a full second copy of observeUserMessages/
 * observeSubmitButton/bootstrap before this file existed. This module holds only the
 * side-effect-free, safely-shareable inject-back logic.
 *
 * Replit's prompt input is CodeMirror 6 (confirmed via DOM inspection — see
 * docs/capture-recon/replit-recon.md §2.4), not a plain <textarea>. The devplan's
 * original "native setter" technique only applies to real form elements — CodeMirror
 * keeps its own internal editor model separate from the DOM, so directly setting
 * textContent would show text visually but leave that model out of sync (a known
 * limitation of manipulating rich/code editors via raw DOM writes). A simulated
 * paste event is used instead, since CodeMirror already handles real paste events
 * correctly. Self-verified after dispatch; falls back to clipboard-copy + an on-page
 * toast if the text didn't actually land — same fallback contract as a missing input.
 */

const INPUT_SELECTOR = '.cm-content[contenteditable="true"]';

function showToast(message: string): void {
  const host = document.createElement('div');
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    .toast {
      position: fixed; bottom: 24px; left: 24px; z-index: 2147483647;
      background: #1e1e2e; color: #cdd6f4; border: 1px solid #45475a;
      border-radius: 8px; padding: 10px 14px; font: 13px system-ui, sans-serif;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4); max-width: 320px;
    }
  `;
  shadow.appendChild(style);
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  shadow.appendChild(toast);
  document.body.appendChild(host);
  setTimeout(() => host.remove(), 4000);
}

async function fallbackToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied to clipboard — paste it into the chat input.');
  } catch {
    showToast('Could not copy automatically — please copy the option text manually.');
  }
}

function dispatchSimulatedPaste(input: HTMLElement, text: string): void {
  input.focus();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(input);
  selection?.removeAllRanges();
  selection?.addRange(range);

  const dataTransfer = new DataTransfer();
  dataTransfer.setData('text/plain', text);
  const pasteEvent = new ClipboardEvent('paste', {
    clipboardData: dataTransfer,
    bubbles: true,
    cancelable: true,
  });
  input.dispatchEvent(pasteEvent);
}

export async function injectPromptText(text: string): Promise<void> {
  const input = document.querySelector<HTMLElement>(INPUT_SELECTOR);
  if (!input) {
    await fallbackToClipboard(text);
    return;
  }

  dispatchSimulatedPaste(input, text);

  // Give CodeMirror a tick to process the paste before checking whether it landed.
  await new Promise((resolve) => setTimeout(resolve, 50));
  const landed = (input.textContent ?? '').trim().includes(text.trim().slice(0, 20));
  if (!landed) {
    await fallbackToClipboard(text);
  }
}
