import { injectViaSimulatedPaste } from './inject-kit.js';

/**
 * Replit inject-back — B3. Thin agent config over the shared inject kit.
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
 * content/inject.js contained a full second copy of the capture machinery before this
 * file existed.
 *
 * Replit's prompt input is CodeMirror 6 (confirmed via DOM inspection — see
 * internal recon), not a plain <textarea> — hence the
 * simulated-paste mechanism (see inject-kit.ts for why native-setter/textContent
 * writes don't work on editors with an internal model).
 */

const INPUT_SELECTOR = '.cm-content[contenteditable="true"]';

// Replit's real send control — the Enter-didn't-submit fallback clicks it.
const SUBMIT_BUTTON_SELECTOR = '[data-cy="ai-prompt-submit"]';

export async function injectPromptText(text: string): Promise<void> {
  // `preferExecCommand`: Replit turns a large PASTE into a file attachment —
  // live 2026-08-26 the enhanced prompt arrived as two `Pasted-My-original…`
  // chips beside the untouched original, and chips persist even if text lands
  // later. CodeMirror 6 accepts `execCommand('insertText')` cleanly, and that
  // path cannot trigger the conversion, so it goes first here.
  await injectViaSimulatedPaste(INPUT_SELECTOR, text, SUBMIT_BUTTON_SELECTOR, {
    preferExecCommand: true,
  });
}
