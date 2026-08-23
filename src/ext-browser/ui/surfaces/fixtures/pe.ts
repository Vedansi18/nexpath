// ============================================================================
// Static content for the PE surface.
// ----------------------------------------------------------------------------
// Sub-phase D3.5. The strings are the CLI's own, so the parity test has
// something real to compare: hint text and the footer are quoted from
// `cli-submit-popup.ts`, and the body reads like a prompt the popup would
// actually be holding.
//
// This is the file a producer replaces when live data arrives (D-5). Nothing
// else has to move, which is the whole reason the model is typed.
// ============================================================================

import type { SurfaceModel } from '../surface-model.js';

/**
 * The CLI's edit-keys hint. macOS names the Mac keys; every other platform gets
 * the Ctrl spelling (`cli-submit-popup.ts:515-517`). Read at module load, the
 * same moment the CLI reads it.
 */
export const EDIT_KEYS_HINT =
  typeof process !== 'undefined' && process.platform === 'darwin'
    ? 'Cmd+J new line · Cmd+↑/↓ move line'
    : 'Ctrl+J new line · Ctrl+↑/↓ move line';

/** `cli-submit-popup.ts:511`. */
export const BODY_HINT = 'Enter sends this prompt';

/** `cli-submit-popup.ts:512`. */
export const DETAILS_HINT = 'Enter applies these details · unapplied details are not sent';

/** `PROMPT_ENHANCEMENT_CLI_FOOTER_V1`, `cli-submit-popup.ts:509`. */
export const PE_FOOTER = '↑↓ move · Esc cancel';

export const PE_FIXTURE: SurfaceModel = {
  id: 'prompt_enhancement',
  label: 'Prompt enhancement',
  pinch: 'Shipping something?',
  trustCues: ['Your original request is kept in full.'],
  whyHelp: 'Shown because this looks risky to roll back — plan the undo path first.',
  rows: [
    {
      kind: 'field',
      label: 'Use enhanced prompt',
      text: [
        'Add a Stripe webhook handler for payment_intent.succeeded.',
        '',
        'Scope: only the webhook route + its handler.',
        'Acceptance: signature verified, idempotent on retry, unit test for both paths.',
        'Verification: run the payment test suite and paste the output.',
      ].join('\n'),
      // Focused only. Off-focus the send hint would be a lie — Enter acts on
      // whichever row IS focused, not on the body (owner, 2026-08-19).
      hints: { whenFocused: [`${EDIT_KEYS_HINT} · ${BODY_HINT}`] },
    },
    {
      kind: 'field',
      label: 'Additional details',
      text: 'Keep the existing retry helper — do not rewrite it.',
      // Always, then the edit keys when focused — the CLI's order.
      hints: { always: [DETAILS_HINT], whenFocused: [EDIT_KEYS_HINT] },
      blankBefore: true,
    },
    { kind: 'action', label: 'Use original prompt' },
  ],
  footer: PE_FOOTER,
};
