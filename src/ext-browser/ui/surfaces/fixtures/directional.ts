// ============================================================================
// D5 static content — the directional variants and their refinement views.
// ----------------------------------------------------------------------------
// Derived, not authored: the shipping variants are the base fixtures with the
// three rows spliced in, so a change to a base fixture flows here instead of
// having a second copy to keep in step. The base fixtures stay directional-free
// because they anchor the live-CLI parity suite, and today's CLI renders no
// directional rows (loop UI-off, `cli-submit-popup.ts:641-664`).
//
// The recomposed bodies are pre-authored (static build): the real behaviour is
// an instant deterministic recompose with no LLM call (Option B), and each text
// below is what a "Shorter" pass over its base body would plausibly produce —
// same task, same guarantees, fewer words.
// ============================================================================

import type { SurfaceModel } from '../surface-model.js';
import { withDirectionalRows, buildRefinementModel } from '../refinement.js';
import { PE_FIXTURE } from './pe.js';
import { MPS_FIRST_FIXTURE, MPS_CANCEL_LABEL } from './mps.js';

/** The base PE body, recomposed shorter — same guarantees, fewer words. */
export const PE_REFINED_TEXT =
  'Add a Stripe webhook handler for payment_intent.succeeded — signature verified, idempotent on retry, tested, output pasted back.';

/** The base MPS-1 step, recomposed shorter. */
export const MPS_REFINED_TEXT =
  'Step 1 — one failing test for the payment webhook; paste its output back.';

/** PE with Shorter / More thorough / More project-grounded before `Use original prompt`. */
export const PE_DIRECTIONAL_FIXTURE: SurfaceModel =
  withDirectionalRows(PE_FIXTURE, 'Use original prompt');

/** MPS-1 with the same three rows before the Cancel row — the blueprint's "PE parity". */
export const MPS_FIRST_DIRECTIONAL_FIXTURE: SurfaceModel =
  withDirectionalRows(MPS_FIRST_FIXTURE, MPS_CANCEL_LABEL);

/** PE after picking Shorter: recomposed body + ← Go back. */
export const PE_REFINEMENT_FIXTURE: SurfaceModel =
  buildRefinementModel(PE_FIXTURE, PE_REFINED_TEXT);

/** MPS-1 after picking Shorter: recomposed body + ← Go back, Sequence plan still visible. */
export const MPS_FIRST_REFINEMENT_FIXTURE: SurfaceModel =
  buildRefinementModel(MPS_FIRST_FIXTURE, MPS_REFINED_TEXT);
