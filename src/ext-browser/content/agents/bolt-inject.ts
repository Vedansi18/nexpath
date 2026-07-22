import { injectViaSimulatedPaste } from './inject-kit.js';

/**
 * Bolt inject-back — B4. Thin agent config over the shared inject kit.
 *
 * Separate, side-effect-free module (not part of bolt.ts) for the same reason as
 * replit-inject.ts: content/inject.ts imports inject-back, and importing from the
 * auto-bootstrapping capture entry would duplicate its observers into inject.js's
 * bundle (the B3 duplicate-bundling bug).
 *
 * Bolt's prompt input is TipTap/ProseMirror (confirmed via live DOM inspection —
 * see docs/capture-recon/bolt-recon.md §2.1), a contenteditable editor with its
 * own internal model — hence the simulated-paste mechanism (see inject-kit.ts for
 * why direct textContent writes don't work on such editors). NOT yet
 * live-verified against Bolt's real editor.
 */

const INPUT_SELECTOR = '.tiptap.ProseMirror';

export async function injectPromptText(text: string): Promise<void> {
  await injectViaSimulatedPaste(INPUT_SELECTOR, text);
}
