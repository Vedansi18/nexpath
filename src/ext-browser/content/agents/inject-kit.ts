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

/**
 * Resolve the agent's composer from ONE selector or a PRIORITISED LIST. Purely
 * additive over the original single-`querySelector` lookup and can never do worse:
 *   • a bare string behaves exactly as before;
 *   • a list is tried in order — the FIRST selector that matches wins, so the
 *     original/most-specific selector stays authoritative and every later entry is
 *     only a fallback for when a site renames its composer (e.g. Lovable relabelled
 *     its input's aria-label "Chat input" → "Ask Lovable…", which silently routed
 *     "Send to your agent" to the clipboard fallback);
 *   • when a selector matches several nodes, the first RENDERED one is preferred
 *     (getClientRects covers position:fixed, which offsetParent misses), hardening
 *     every agent against duplicate/off-screen editors.
 * If nothing is rendered it still returns the first raw match — so the existing
 * clipboard-fallback contract (null → clipboard) is unchanged.
 */
function resolveComposer(selectors: string | string[]): HTMLElement | null {
  const list = Array.isArray(selectors) ? selectors : [selectors];
  let firstMatch: HTMLElement | null = null;
  for (const selector of list) {
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      firstMatch ??= el;
      if (el.getClientRects().length > 0) return el;
    }
  }
  return firstMatch;
}

/**
 * Wait until the text is visible in the editor, or the budget runs out. Rich
 * editors (TipTap/ProseMirror on Bolt and Lovable) process a paste through
 * their own async model — a fixed 50ms check missed slow frames on a busy
 * page for a multi-KB body (live 2026-08-25: the PE popup's ~2.6KB enhanced
 * prompt fell to the clipboard while the shorter advisory options always
 * landed). Polling keeps fast editors fast and only slow ones wait.
 */
async function waitForLanding(input: HTMLElement, text: string, budgetMs: number): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    if (hasLanded(input, text)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
}

/** Diagnosability: an inject that degrades must say WHY — the clipboard toast
 * alone made the live failure undebuggable (2026-08-25). Page console only;
 * never carries the text. */
function logInjectOutcome(outcome: string, detail = ''): void {
  console.log(`[nexpath] inject-back: ${outcome}${detail ? ` — ${detail}` : ''}`);
}

/**
 * Ask the MAIN-world script to perform the insertion inside the page's own
 * world (see main-world.ts's inject bridge): a ClipboardEvent constructed in
 * THIS isolated world crosses to the page with clipboardData rich editors
 * cannot read, so TipTap/ProseMirror never accepted the content-script paste
 * (live-diagnosed on Bolt 2026-08-25). Resolves true only on a typed 'landed'
 * reply; a missing bridge (stale page generation) times out to false and the
 * caller's own fallback chain takes over — this path can only improve delivery.
 */
function requestMainWorldInject(selector: string, text: string): Promise<boolean> {
  return new Promise((resolve) => {
    const requestId = `nx-inject-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timer = setTimeout(() => {
      window.removeEventListener('message', onReply);
      resolve(false);
    }, 1_500);
    const onReply = (ev: MessageEvent): void => {
      if (ev.source !== window) return;
      const msg = ev.data as { type?: unknown; requestId?: unknown; landed?: unknown } | null;
      if (!msg || msg.type !== 'nexpath:inject-result' || msg.requestId !== requestId) return;
      clearTimeout(timer);
      window.removeEventListener('message', onReply);
      resolve(msg.landed === true);
    };
    window.addEventListener('message', onReply);
    window.postMessage({ type: 'nexpath:inject-request', requestId, selector, text }, window.location.origin);
  });
}

/** How long the synthetic Enter gets to clear the composer before the button
 * fallback fires. Agents clear their composer immediately on a real send. */
const SUBMIT_SETTLE_MS = 800;

/**
 * Auto-submit the landed prompt. Synthetic Enter first (Chrome-proven on all
 * three agents), then — when the composer STILL holds the text after a settle
 * — click the agent's real submit button. Firefox/Bolt live 2026-08-25: the
 * paste landed but the synthetic Enter never triggered Bolt's send, so the
 * text just sat in the composer. A synthetic button .click() runs the
 * framework's own submit handler and is not trust-gated the way editor
 * keyboard shortcuts can be.
 */
async function submitInjectedPrompt(
  input: HTMLElement,
  text: string,
  submitButtonSelector?: string,
): Promise<void> {
  dispatchSubmit(input);
  if (!submitButtonSelector) return;
  await new Promise((resolve) => setTimeout(resolve, SUBMIT_SETTLE_MS));
  if (!hasLanded(input, text)) return; // composer cleared — the Enter submit worked
  const button = document.querySelector<HTMLButtonElement>(submitButtonSelector);
  if (button && !button.disabled) {
    logInjectOutcome('auto-submit via button click', 'synthetic Enter did not submit');
    button.click();
  } else {
    logInjectOutcome('auto-submit uncertain', `text still in composer and no clickable ${submitButtonSelector}`);
  }
}

export async function injectViaSimulatedPaste(
  inputSelector: string | string[],
  text: string,
  submitButtonSelector?: string,
): Promise<void> {
  const input = resolveComposer(inputSelector);
  if (!input) {
    logInjectOutcome('clipboard fallback', `no composer matched ${JSON.stringify(inputSelector)}`);
    await clipboardFallback(text);
    return;
  }

  // Preferred path: the page-world bridge (first-class events for rich editors).
  const selectorList = Array.isArray(inputSelector) ? inputSelector : [inputSelector];
  for (const selector of selectorList) {
    if (await requestMainWorldInject(selector, text)) {
      logInjectOutcome('landed via main-world bridge');
      await submitInjectedPrompt(input, text, submitButtonSelector);
      return;
    }
    if (document.querySelector(selector)) break; // selector matches; bridge tried and failed — don't retry others
  }

  dispatchSimulatedPaste(input, text);
  if (await waitForLanding(input, text, 900)) {
    logInjectOutcome('landed via simulated paste');
    await submitInjectedPrompt(input, text, submitButtonSelector);
    return;
  }

  // Firefox: the synthetic paste is inert (see insertViaExecCommand). Retry the
  // insertion through the trusted execCommand path, then re-check. Also the
  // second chance for a rich editor that dropped the synthetic paste entirely.
  insertViaExecCommand(input, text);
  if (await waitForLanding(input, text, 900)) {
    logInjectOutcome('landed via execCommand');
    await submitInjectedPrompt(input, text, submitButtonSelector);
    return;
  }

  logInjectOutcome('clipboard fallback', `paste did not land in <${input.tagName.toLowerCase()} class="${(input.className || '').toString().slice(0, 60)}">`);
  await clipboardFallback(text);
}
