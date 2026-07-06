// Role-specific context_loss variants (founder / indie_hacker casual · PM formal).
//
// context_loss is re-authored onto the constraint / assumption / decision-thread frame
// (differentiated from the session_length_checkpoint status checkpoint). These three
// role variants speak that same frame in each role's register — founder + indie_hacker
// in a casual voice, PM in a formal voice — retaining the "decision" topic anchor.
// question + pinchFallback mirror the base topic labels. No sensitive action is involved,
// so no confirm-seek safeguard is authored.

import type { DecisionContent } from '../options.js';
import { WHY_HELP_BY_SIGNAL_TYPE } from '../why-help-by-signal-type.js';

const QUESTION = 'Long session — context recapped?';
const PINCH_FALLBACK = 'Context recap?';

/** FOUNDER — casual, product-direction lens. */
export const ABSENCE_CONTEXT_LOSS_FOUNDER: DecisionContent = {
  signalType:   "ABSENCE_CONTEXT_LOSS",
  question:      QUESTION,
  pinchFallback: PINCH_FALLBACK,
  whyHelp:       WHY_HELP_BY_SIGNAL_TYPE['ABSENCE_CONTEXT_LOSS'],
  L1: [
    {
      option: 'Let\'s get the through-line back — walk me through the decisions we\'ve committed to this session, the constraints they lock us into, and the assumptions about where this is heading that we haven\'t pressure-tested, so we don\'t drift from the direction.',
      descBase: `{R4_OPEN}
{R5_INJECT: ~1-2 lines first-person — "Long session; I haven't reconstructed the decisions I've committed to or what they lock the product into."}
The decision-thread that shapes the direction hasn't been reconstructed — the constraints and outcome assumptions are still implicit.
Rundown: the decisions committed / what they lock us into / the direction assumptions not yet pressure-tested.
{R4_CLOSE}`,
    },
    {
      option: 'Take a minute to catch up on the direction — what did we actually decide this session, what does each decision commit us to, and which assumptions about the users or the outcome are we running with unchecked?',
      descBase: `{R4_OPEN}
{R5_INJECT: ~1-2 lines first-person — "Long session; the decisions made and the outcome assumptions behind them aren't recapped."}
The direction recap hasn't been done.
Tell me: what we decided / what each decision commits us to / the outcome assumptions still unchecked.
{R4_CLOSE}`,
    },
  ],
  L2: [
    {
      option: 'What decisions and constraints from this session are still just in my head — which ones does the next move depend on, and which should we make explicit before they steer the product silently?',
      descBase: `{R4_OPEN}
{R5_INJECT: ~1 line first-person — "Long session; the implicit decisions steering the direction aren't flagged."}
Lighter: the decisions and constraints still implicit — which the next move depends on.
{R4_CLOSE}`,
    },
    {
      option: 'What\'s the single most important decision or direction-constraint we set this session that we\'ve got to carry forward so the product doesn\'t drift?',
      descBase: `{R4_OPEN}
{R5_INJECT: ~1 line first-person — "Long session; the key direction decision to carry forward isn't flagged."}
Narrower: the one decision or constraint I shouldn't lose track of.
{R4_CLOSE}`,
    },
  ],
  L3: [
    {
      option: 'What\'s the one decision, constraint, or outcome-assumption from this session you most need to lock in before you keep going — the anchor for where this is heading?',
      descBase: `{R4_OPEN}
{R5_INJECT: ~1 line first-person — "Long session."}
Minimum next step: the one decision I most need to lock in before continuing.
{R4_CLOSE}`,
    },
  ],
};

/** INDIE_HACKER — casual, ship-momentum lens. */
export const ABSENCE_CONTEXT_LOSS_INDIE_HACKER: DecisionContent = {
  signalType:   "ABSENCE_CONTEXT_LOSS",
  question:      QUESTION,
  pinchFallback: PINCH_FALLBACK,
  whyHelp:       WHY_HELP_BY_SIGNAL_TYPE['ABSENCE_CONTEXT_LOSS'],
  L1: [
    {
      option: 'Let\'s not lose the thread while we\'re moving fast — walk me through the decisions we\'ve made this session, the constraints we\'re building around, and the assumptions we\'ve been shipping on that we haven\'t checked, before we push further.',
      descBase: `{R4_OPEN}
{R5_INJECT: ~1-2 lines first-person — "Shipping fast this session; I haven't paused to reconstruct the decisions and constraints I've been moving on."}
The decision-thread hasn't been reconstructed — the constraints and assumptions we're shipping on are implicit.
Rundown: the decisions made / the constraints we're building around / the assumptions we haven't checked.
{R4_CLOSE}`,
    },
    {
      option: 'Quick catch-up before we ship more — what decisions did we make this session, what are we now locked into, and which assumptions did we move fast on without checking?',
      descBase: `{R4_OPEN}
{R5_INJECT: ~1-2 lines first-person — "Moving fast; the decisions made and the assumptions behind them aren't recapped."}
The catch-up hasn't been done.
Tell me: what we decided / what we're locked into / the assumptions we skipped checking.
{R4_CLOSE}`,
    },
  ],
  L2: [
    {
      option: 'What decisions and constraints from this session are still just in my head — which does the next thing to ship depend on, and which should we make explicit now?',
      descBase: `{R4_OPEN}
{R5_INJECT: ~1 line first-person — "Shipping fast; the implicit decisions aren't flagged."}
Lighter: the decisions and constraints still implicit — which the next ship depends on.
{R4_CLOSE}`,
    },
    {
      option: 'What\'s the single most important decision or constraint we set this session that we\'ve got to carry forward so we don\'t ship ourselves into a corner?',
      descBase: `{R4_OPEN}
{R5_INJECT: ~1 line first-person — "Shipping fast; the key decision to carry forward isn't flagged."}
Narrower: the one decision or constraint I shouldn't lose track of.
{R4_CLOSE}`,
    },
  ],
  L3: [
    {
      option: 'What\'s the one decision, constraint, or assumption from this session you most need to lock in before you keep shipping — the anchor we can\'t afford to lose?',
      descBase: `{R4_OPEN}
{R5_INJECT: ~1 line first-person — "Long session."}
Minimum next step: the one decision I most need to lock in before continuing.
{R4_CLOSE}`,
    },
  ],
};

/** PM — formal, requirements / traceability lens. */
export const ABSENCE_CONTEXT_LOSS_PM: DecisionContent = {
  signalType:   "ABSENCE_CONTEXT_LOSS",
  question:      QUESTION,
  pinchFallback: PINCH_FALLBACK,
  whyHelp:       WHY_HELP_BY_SIGNAL_TYPE['ABSENCE_CONTEXT_LOSS'],
  L1: [
    {
      option: 'Reconstruct the decision record for this session: the decisions taken, the constraints they impose, and the assumptions they rest on — so the requirements and their rationale are explicit before work continues.',
      descBase: `{R4_OPEN}
{R5_INJECT: ~1-2 lines — "Extended session; the decision record — decisions, constraints, and underlying assumptions — has not been reconstructed."}
The decision record for this session has not been reconstructed — decisions, the constraints they impose, and their underlying assumptions remain implicit.
Reconstruct: decisions taken / constraints imposed / assumptions they rest on.
{R4_CLOSE}`,
    },
    {
      option: 'Document the decision-thread for this session: which decisions the current work depends on, the constraints that shaped each, and the assumptions that require validation before the next phase.',
      descBase: `{R4_OPEN}
{R5_INJECT: ~1-2 lines — "Extended session; the decision-thread and its dependencies have not been documented."}
The decision-thread and its dependencies have not been documented.
Capture: dependent decisions / shaping constraints / assumptions requiring validation.
{R4_CLOSE}`,
    },
  ],
  L2: [
    {
      option: 'Which decisions and constraints from this session remain implicit — what does the next step depend on, and which require explicit sign-off before proceeding?',
      descBase: `{R4_OPEN}
{R5_INJECT: ~1 line — "Extended session; implicit decisions and constraints not surfaced for sign-off."}
Narrower: the decisions and constraints still implicit that the next step depends on.
{R4_CLOSE}`,
    },
    {
      option: 'What is the single most significant decision or constraint established this session that must be explicitly carried forward to preserve requirements traceability?',
      descBase: `{R4_OPEN}
{R5_INJECT: ~1 line — "Extended session; the key decision requiring carry-forward is not flagged."}
Narrower: the one decision or constraint that must be carried forward.
{R4_CLOSE}`,
    },
  ],
  L3: [
    {
      option: 'What is the single decision, constraint, or assumption from this session that must be documented and carried forward before the next step — the anchor that cannot be lost?',
      descBase: `{R4_OPEN}
{R5_INJECT: ~1 line — "Extended session."}
Minimum next step: the one decision or constraint that must be carried forward.
{R4_CLOSE}`,
    },
  ],
};
