import { injectViaSimulatedPaste } from './inject-kit.js';

/**
 * Lovable inject-back — B5. Thin agent config over the shared inject kit.
 *
 * Separate, side-effect-free module (not part of lovable.ts) for the same reason
 * as replit-inject.ts/bolt-inject.ts: content/inject.ts imports inject-back, and
 * importing from the auto-bootstrapping capture entry would duplicate its
 * observers into inject.js's bundle (the B3 duplicate-bundling bug).
 *
 * Lovable's prompt input is TipTap/ProseMirror with aria-label "Chat input"
 * (docs/capture-recon/lovable-recon.md §3) — the same editor family whose
 * simulated-paste mechanism is live-verified on Bolt. NOT yet live-verified on
 * Lovable itself (B5 E2E gate item).
 */

const INPUT_SELECTOR = '.tiptap.ProseMirror[aria-label="Chat input"]';

export async function injectPromptText(text: string): Promise<void> {
  await injectViaSimulatedPaste(INPUT_SELECTOR, text);
}
