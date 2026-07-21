// Role-tailored context_loss content as content-template `roleOverrides` (B11).
//
// context_loss is the one genuinely role-varied signal: founder / indie_hacker speak a
// casual voice, pm a formal one, and each applies its own lens to the same practice —
// reconstruct the session's decisions / constraints / assumptions. The engine serves
// these by role (role → register → base). They carry the base record's 5-maturity ladder
// (col-1 one-line recap → col-5 written note), re-voiced per role, keeping the "decision"
// keyword. No sensitive action → no confirm-seek. The founder/indie framing (product
// direction / ship momentum) and the PM framing (decision record / requirements
// traceability) mirror the frozen `context-loss-role-variants.ts` voices they supersede.

import type { LevelForm, RoleOverride } from '../content-template-schema.js';

function form(option: string, whyDesc: string): LevelForm {
  return { kind: 'slot-variant', cell: { option, whyDesc } };
}

/** FOUNDER — casual, product-direction lens. */
export const CONTEXT_LOSS_FOUNDER_OVERRIDE: RoleOverride = {
  levelForms: {
    1: form(
      "Note the one decision and direction-constraint from this session in a line before we continue — what we decided and what it now commits the product to.",
      "The lightest recap: one line on the key decision and what it commits the product to.",
    ),
    2: form(
      "Summarize the decisions we made this session and the constraints they set on the direction — the main ones and what still depends on them, as a quick re-anchor.",
      "A light summary: the main decisions and the direction constraints they set.",
    ),
    3: form(
      "Reconstruct the decisions, constraints, and direction-assumptions for this session: list every decision we committed to, what each locks the product into, and the assumptions about the users and the outcome we haven't pressure-tested — make them explicit before we drift from the direction.",
      "The decisions, constraints, and outcome assumptions steering the direction haven't been reconstructed — the product can drift while they stay implicit.",
    ),
    4: form(
      "Reconstruct the full direction state — the decisions committed, the constraints they lock in, and the outcome assumptions still unchecked, from the goal to the current work — so nothing silently steers the product off-course.",
      "Beyond a quick recap: the full state of decisions, constraints, and outcome assumptions reconstructed.",
    ),
    5: form(
      "Write a direction note: the decisions made, the constraints they commit the product to, the outcome assumptions still open, and the next two or three moves — kept as the re-anchor so the product doesn't drift.",
      "A durable direction note of the decisions, the constraints they commit to, and the next moves.",
    ),
  },
};

/** INDIE_HACKER — casual, ship-momentum lens. */
export const CONTEXT_LOSS_INDIE_HACKER_OVERRIDE: RoleOverride = {
  levelForms: {
    1: form(
      "Note the one decision and constraint from this session in a line before we push further — what we decided and what the next thing to ship depends on.",
      "The lightest recap: one line on the key decision and what the next ship depends on.",
    ),
    2: form(
      "Summarize the decisions we made this session and the constraints they set — the main ones and what still depends on them, so we're not shipping on forgotten context.",
      "A light summary: the main decisions and the constraints the next ship rests on.",
    ),
    3: form(
      "Reconstruct the decisions, constraints, and assumptions for this session: list every decision we committed to while moving fast, what each locks us into, and the assumptions we've been shipping on without checking — make them explicit before we ship ourselves into a corner.",
      "The decisions and assumptions we've been shipping on haven't been reconstructed — moving fast on implicit context can ship us into a corner.",
    ),
    4: form(
      "Reconstruct the full session state — the decisions committed, the constraints they lock in, and the assumptions still unverified, from the goal to what's shipping now — so nothing silently breaks the next release.",
      "Beyond a quick catch-up: the full state of decisions, constraints, and shipping assumptions reconstructed.",
    ),
    5: form(
      "Write a session-state note: the decisions made, the constraints they set, the assumptions still open, and the next two or three things to ship — kept as the re-anchor so momentum doesn't outrun the context.",
      "A durable session-state note of the decisions, constraints, and the next things to ship.",
    ),
  },
};

/** PM — formal, requirements / traceability lens. */
export const CONTEXT_LOSS_PM_OVERRIDE: RoleOverride = {
  levelForms: {
    1: form(
      "Record the single most significant decision and constraint from this session in one line before proceeding — the decision taken and what the next step depends on.",
      "The lightest record: one line on the key decision and its dependency.",
    ),
    2: form(
      "Summarize the decisions taken this session and the constraints they impose — the significant ones and what still depends on them — as a brief re-anchor for the requirements.",
      "A light summary: the significant decisions and the constraints they impose.",
    ),
    3: form(
      "Reconstruct the decision record for this session: every decision taken, the constraints each imposes, and the assumptions it rests on — so the requirements and their rationale are explicit and traceable before work continues.",
      "The decision record — decisions, imposed constraints, and underlying assumptions — has not been reconstructed, leaving requirements traceability implicit.",
    ),
    4: form(
      "Reconstruct the full decision-thread — every decision taken, the constraints it imposes, and the assumptions requiring validation, from the objective to the current work — so no unstated decision distorts the next phase.",
      "Beyond a summary: the full decision-thread and its assumptions reconstructed for traceability.",
    ),
    5: form(
      "Write a decision-record note: the decisions taken, the constraints they impose, the assumptions requiring validation, and the next two or three steps — retained as the traceable anchor for the requirements.",
      "A durable decision-record note of the decisions, constraints, assumptions, and next steps.",
    ),
  },
};
