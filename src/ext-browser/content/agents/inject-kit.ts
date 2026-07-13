/**
 * Inject kit — agent-agnostic inject-back machinery shared by every browser-agent
 * content script (Replit today; Bolt/Lovable next). ZERO top-level side effects,
 * same contract as capture-kit.ts: safe to import from any entry point.
 *
 * `injectViaSimulatedPaste` covers contenteditable rich/code editors (CodeMirror,
 * ProseMirror, etc.): a "native setter" write only applies to real form elements,
 * while these editors keep an internal model separate from the DOM — directly
 * setting textContent shows text visually but leaves that model out of sync, likely
 * producing broken or reverted text on the next keystroke or re-render. Editors
 * already handle real paste events correctly, so a synthetic paste goes through
 * their own update path. Self-verified after dispatch: if the text didn't land
 * (Firefox drops a synthetic ClipboardEvent's clipboardData) it retries through
 * execCommand('insertText') — trusted input events these editors also honor — and
 * only then falls back to clipboard-copy + an on-page toast, same fallback contract
 * as a missing input. If a future agent's input turns out to be
 * a plain <textarea>, add a native-setter variant here rather than in the agent
 * file — the toast/clipboard fallback below is reusable for it as-is.
 */

export function showToast(message: string): void {
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

/**
 * Copy the text to the clipboard and toast the user to paste it manually. Used
 * internally as the paste-injection fallback, and exported for callers with no
 * agent-specific injector at all (e.g. inject.ts on a host whose inject-back
 * hasn't been built yet) — degraded-but-honest beats silently doing nothing.
 */
export async function clipboardFallback(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied to clipboard — paste it into the chat input.');
  } catch {
    showToast('Could not copy automatically — please copy the option text manually.');
  }
}

/**
 * Best-effort "send directly to your agent" (CLI parity — the CLI's "Send to your
 * agent now"). After the paste lands, press Enter so the agent acts on the injected
 * prompt without the user having to hit send. Bolt and Lovable both submit on Enter.
 * Purely additive + safe: if an agent uses a different submit key or ignores
 * synthetic keys, nothing breaks — the text still sits in the composer for the user
 * to send manually, exactly as before this change.
 */
function dispatchSubmit(input: HTMLElement): void {
  const init: KeyboardEventInit = {
    key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
    bubbles: true, cancelable: true, composed: true,
  } as KeyboardEventInit;
  input.focus();
  input.dispatchEvent(new KeyboardEvent('keydown', init));
  input.dispatchEvent(new KeyboardEvent('keyup', init));
}

function focusAndSelectAll(input: HTMLElement): void {
  input.focus();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(input);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function dispatchSimulatedPaste(input: HTMLElement, text: string): void {
  focusAndSelectAll(input);

  const dataTransfer = new DataTransfer();
  dataTransfer.setData('text/plain', text);
  const pasteEvent = new ClipboardEvent('paste', {
    clipboardData: dataTransfer,
    bubbles: true,
    cancelable: true,
  });
  input.dispatchEvent(pasteEvent);
}

/**
 * Firefox fallback. Firefox drops a script-constructed ClipboardEvent's
 * clipboardData (security), so the simulated paste above is a silent no-op there and
 * the text never enters the editor. execCommand('insertText') emits the *trusted*
 * beforeinput/input events that ProseMirror (Bolt/Lovable) and CodeMirror (Replit)
 * both honor, and it works in Firefox. This runs ONLY after the paste failed to land,
 * so Chrome — where the paste lands on the first check — never reaches it and its
 * behavior is unchanged. execCommand is deprecated but still universally supported;
 * guarded so a throwing/absent impl routes to the clipboard fallback rather than
 * breaking injection.
 */
function insertViaExecCommand(input: HTMLElement, text: string): void {
  focusAndSelectAll(input);
  try {
    document.execCommand('insertText', false, text);
  } catch {
    /* deprecated API — the landed-check below routes to the clipboard fallback */
  }
}

function hasLanded(input: HTMLElement, text: string): boolean {
  return (input.textContent ?? '').trim().includes(text.trim().slice(0, 20));
}

export async function injectViaSimulatedPaste(inputSelector: string, text: string): Promise<void> {
  const input = document.querySelector<HTMLElement>(inputSelector);
  if (!input) {
    await clipboardFallback(text);
    return;
  }

  dispatchSimulatedPaste(input, text);
  // Give the editor a tick to process the paste before checking whether it landed.
  await new Promise((resolve) => setTimeout(resolve, 50));

  // Firefox: the synthetic paste is inert (see insertViaExecCommand). Retry the
  // insertion through the trusted execCommand path, then re-check. No-op on Chrome,
  // which has already landed — its path stays byte-identical.
  if (!hasLanded(input, text)) {
    insertViaExecCommand(input, text);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  if (!hasLanded(input, text)) {
    await clipboardFallback(text);
    return;
  }
  // Landed → "Send to your agent now": auto-submit so the agent acts on it (CLI parity).
  dispatchSubmit(input);
}
