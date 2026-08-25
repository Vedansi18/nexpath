import type { PromptEnhancementSlotObligationV1 } from './templates/section-plan.js';

/**
 * What each section obligation asks the composer to DO — in words, not identifiers.
 *
 * The obligations are typed contracts the validator can check; the composer prompt used to hand
 * the model their raw names as a JSON list and explain exactly one of them in prose. A model
 * given an identifier it cannot act on does the only thing it can: repeats it — which is how
 * strings like "family-specific verification" reached prompts real developers sent to their
 * agents. Every obligation now has one plain-English directive in the composer's second person,
 * saying what the section must contain and never naming the obligation itself.
 *
 * Typed as a Record over the CLOSED obligation union, so a new obligation without a directive
 * fails to compile — the completeness gate for this map is the type checker, backed by a
 * runtime test over the producer's universe.
 *
 * Wording is owner-approved (2026-08-25) and lands byte for byte.
 */
export const SLOT_OBLIGATION_DIRECTIVES_V1: Readonly<Record<PromptEnhancementSlotObligationV1, string>> = {
  reproduction_or_evidence_request:
    'Ask for the exact steps, logs, or samples that show the problem; if they are missing, say what is needed rather than guessing.',
  no_invention_state:
    'Hard rule: name only tools, libraries, services, files, APIs or project facts that appear in the original request or in an allowed source fact. If the evidence is missing, ask for it — never supply an example name.',
  behavior_lock:
    'State exactly what must keep working unchanged after the change.',
  baseline_current_output_proof:
    'Ask for the current output or behaviour to be captured before anything changes, so the result can be compared against it.',
  no_unrelated_change_boundary:
    'Keep the change to what was asked, and say plainly that unrelated files and behaviour stay untouched.',
  before_after_verification:
    'Describe how the result will be checked against the captured before-state once the change is made.',
  review_checklist_challenge:
    'Give a review checklist that actively challenges the change rather than confirming it.',
  severity_residual_risk:
    'For each finding, state its severity and what risk remains after the fix.',
  project_source_fact_slots:
    'Fill in the project facts from the allowed source facts; where one is missing, say which is missing instead of inventing it.',
  known_unknown_wording:
    'Separate what is known from what is not yet known, and word the unknowns as open questions.',
  source_ids_evidence_state:
    'Say where each fact came from and how firm it is, in plain words.',
  confirmation_clarification:
    'State clearly which action needs the developer\'s confirmation before it is taken, and what still needs clarifying.',
  send_policy_metadata:
    'Keep the confirmation request self-contained, so it can be sent to the coding agent as-is.',
  safety_hook_linkage:
    'Tie the safety request to the specific risky step it protects, so the two read together.',
  family_specific_verification:
    'Verify in the way that fits this kind of work — name the concrete checks, not generic testing.',
  risk_rollback_recovery:
    'Say what could go wrong, how to roll back, and how to recover if the rollback fails.',
  dry_run_backup_pin_deployment:
    'Call for a dry run, a backup, and a pinned version before anything is deployed or migrated.',
  safety_policy_hooks:
    'Note which safety checks must run before and after the risky step.',
  decomposition_handoff_metadata:
    'Break the request into separately deliverable pieces, each clear enough to hand on by itself.',
  compact_first_popup_summary_support:
    'Lead with a compact summary of the pieces before any detail.',
  ordering_dependency:
    'Order the pieces by dependency and say which must finish before which.',
  baseline_source_signal:
    'Start from what the developer\'s recent practice already shows, and build on it rather than restating it.',
  source_kind_id_evidence_metadata:
    'Describe the kind of evidence behind each signal in plain words, never as an identifier.',
  public_safe_why_help_support:
    'Explain why each point helps, in words safe to show anyone, without private details.',
};

/** The directive for one obligation; an unknown name (impossible under the union) yields nothing. */
export function promptEnhancementObligationDirectiveV1(obligation: string): string | undefined {
  return (SLOT_OBLIGATION_DIRECTIVES_V1 as Readonly<Record<string, string>>)[obligation];
}
