/**
 * What a source signal MEANS — the content half of the source-signal guidance section.
 *
 * The section is mandatory, and its facts used to state only that something was observed: an absence
 * fact said `not observed in this prompt`, a stage fact said `task_breakdown → implementation`. The
 * writer received a name and an observation and nothing about the practice itself.
 *
 * OPT-IN BY CONSTRUCTION. Every function here returns the ORIGINAL value when no meaning is supplied,
 * so a caller that does not send `signalMeaningByRef` gets the previous wording byte for byte.
 *
 * The signal's KEY is never changed here: the naming check, its single retry and the discard rule all
 * key on it. The spaced name is carried inside the value, which is the form that check looks for.
 *
 * FAIL-CLOSED ON AUTHORITY. A meaning is evidence for the writer and, on the no-key path, a body
 * sentence of its own. A practice described as an instruction ("apply the migration pattern") can make
 * that sentence read as an execute request or as an authority escalation that the bare signal name
 * never did — and an escalation makes the body non-sendable. So every meaning is checked with the
 * product's own scanners against the strictest request shape (a plan/review prompt), and one that
 * introduces either verdict is dropped: the value then stays exactly what it is today.
 */

import {
  promptEnhancementAuthorityModeForTextV1,
  promptEnhancementGeneratedEscalatesAuthorityV1,
} from './safety-sendability.js';

/**
 * 🔒 THE APPROVED LIST. A signal's description travels ONLY if its key is here; every other signal keeps today's
 * wording, byte for byte.
 *
 * WHY A LIST RATHER THAN A RULE. Measured over four runs, three signals produced a draft that said something WRONG
 * where today's wording says something vague: `cross_confirming` (the agent half dropped), `problem_correction` (the
 * polarity flipped — the absence read as praise) and `session_length_checkpoint` (bent onto the interface, and onto a
 * second person). Their descriptions are the cause, and their weakness is NOT mechanically detectable — a length or
 * polarity rule passes all three. So the gate is an explicit list, and it is fail-closed.
 *
 * HOW A KEY GETS ON IT. Only by being read and judged fit, and — for these seven — by having produced no wrong draft
 * in a measured run. The list is CONTENT, so it is Hiren's to extend; this seed is what the evidence supports today.
 *
 * WHY `context_loss` IS NOT ON IT (measured on staging 35fd8c56, 2026-10-01). On a session about a cancellation policy
 * the writer took its description ("recapping or re-anchoring session context") and applied it to the product — "the
 * cancellation flow does not adequately recap or re-anchor session context". A wrong statement made of the fix's own
 * words is a side effect, so the signal keeps today's wording until its description is rewritten and re-measured.
 */
export const PROMPT_ENHANCEMENT_APPROVED_MEANING_SIGNALS_V1: ReadonlySet<string> = new Set([
  'feature_scope_before_build',
  'idea_scoping',
  'implementation_checkpoint',
  'incremental_build',
  'no_backup_safety',
  'spec_before_code',
  'user_feedback_review',
]);

/**
 * Draft advice per DESTINATION stage — wording to be reviewed before it ships.
 *
 * ⛔ NONE of these is approved yet, and `PROMPT_ENHANCEMENT_APPROVED_STAGE_ADVICE_V1` below is EMPTY on purpose: no
 * stage line has ever produced a correct draft in a measured run. The only stage move these runs exercised was
 * idea → implementation, and the advice it delivered did not fit a jump. The plain stage NAMES still travel, because
 * they carry no advice and are what the benchmark report asked for.
 */
export const PROMPT_ENHANCEMENT_STAGE_ADVICE_V1: Readonly<Record<string, string>> = {
  idea: 'State the problem and who it is for before choosing a solution.',
  prd: 'Write down what done looks like and what is out of scope.',
  architecture: 'Name the parts that change and how they connect before writing code.',
  task_breakdown: 'Split the work into small steps that can each be checked.',
  implementation: 'Run the existing tests before and after your change.',
  review_testing: 'Check the change against what was asked, and test the edge cases.',
  release: 'Confirm what changes for users and how to undo it if needed.',
  feedback_loop: 'Compare the result with the goal and note what to change next.',
};

/** Stages whose advice line is approved to travel. Empty: none has been proved correct by a run. */
export const PROMPT_ENHANCEMENT_APPROVED_STAGE_ADVICE_V1: ReadonlySet<string> = new Set<string>();

const plainName = (id: string): string => id.replaceAll('_', ' ');

/**
 * The strictest request shape for the escalation scanner: a plan/review request grants no execution
 * authority, so anything that reads as execution against it is an escalation.
 */
const PLAN_OR_REVIEW_REQUEST = 'can you review what we have so far and tell me what is missing?';

/** The sentence the deterministic renderer prints for this fact — the exact body form on the no-key path. */
const bodySentence = (name: string, value: string): string => `The current source signal reports ${name} as ${value}.`;

const readsAsExecution = (text: string): boolean => {
  const mode = promptEnhancementAuthorityModeForTextV1(text);
  return mode !== 'plan_or_review' && mode !== 'observe_or_literal';
};

/**
 * Does the enriched value keep the authority shape of the bare one? False when the meaning is what
 * makes the sentence read as an execute request, or makes it escalate authority under a plan/review
 * request. A verdict the bare name already carried is not charged to the meaning.
 */
export function promptEnhancementMeaningKeepsAuthorityV1(name: string, bareValue: string, enrichedValue: string): boolean {
  const before = bodySentence(name, bareValue);
  const after = bodySentence(name, enrichedValue);
  if (readsAsExecution(after) && !readsAsExecution(before)) return false;
  if (
    promptEnhancementGeneratedEscalatesAuthorityV1(PLAN_OR_REVIEW_REQUEST, after)
    && !promptEnhancementGeneratedEscalatesAuthorityV1(PLAN_OR_REVIEW_REQUEST, before)
  ) return false;
  return true;
}

/** An absence fact's evidence value. No meaning supplied ⇒ the original value, unchanged. */
export function promptEnhancementAbsenceEvidenceValueV1(
  signalKey: string,
  original: string,
  meaning: string | undefined,
): string {
  // A trailing full stop is dropped: the deterministic renderer ends its own sentence with one, and a
  // meaning that carried its own printed ".." in the body. (No backslash in this pattern on purpose.)
  // Fail-closed gate 1 of 2: a description travels only if its signal is approved. Measured: three unapproved
  // descriptions produced drafts that said something WRONG where today's wording says something vague.
  if (!PROMPT_ENHANCEMENT_APPROVED_MEANING_SIGNALS_V1.has(signalKey)) return original;
  const text = meaning?.trim().replace(/[. ]+$/, '');
  if (!text) return original;
  const name = plainName(signalKey);
  const enriched = `${original}; ${name} means: ${text}`;
  // Fail-closed gate 2 of 2: and it may never change the sentence's authority shape.
  return promptEnhancementMeaningKeepsAuthorityV1(name, original, enriched) ? enriched : original;
}

/** A stage fact's evidence value. No meaning supplied ⇒ the original value, unchanged. */
export function promptEnhancementStageEvidenceValueV1(
  from: string | undefined,
  to: string | undefined,
  original: string,
  meaning: string | undefined,
): string {
  // A trailing full stop is dropped: the deterministic renderer ends its own sentence with one, and a
  // meaning that carried its own printed ".." in the body. (No backslash in this pattern on purpose.)
  // ⚠️ The opt-in property comes FIRST and is absolute: a caller that supplies no meaning gets the original value
  // byte for byte. Returning plain names here regardless would change every existing caller — including the browser,
  // which sends nothing — and that is the one thing this module may never do.
  const text = meaning?.trim().replace(/[. ]+$/, '');
  if (!text) return original;

  // The stage lane is UNTOUCHED unless a stage line is approved, and none is: no stage line has yet produced a correct
  // draft in a measured run. So the original value travels byte for byte — the stage fact the writer sees is exactly
  // today's, underscores included. (An earlier version let the plain names through, `task breakdown → implementation`;
  // that changed a lane this fix does not need to change, and it is withdrawn so the fix reaches the absence facts of
  // the approved signals and nothing else.)
  if (to === undefined || !PROMPT_ENHANCEMENT_APPROVED_STAGE_ADVICE_V1.has(to)) return original;
  const start = plainName(from ?? 'unknown');
  const move = to === from ? start : `${start} → ${plainName(to)}`;
  const enriched = `${move}; at this stage: ${text}`;
  return promptEnhancementMeaningKeepsAuthorityV1('stage', original, enriched) ? enriched : original;
}

/**
 * The map a caller puts on the request. Pure: it reads nothing. The CALLER resolves the signal's
 * description, which keeps prompt enhancement free of any store or registry read of its own.
 */
export function promptEnhancementSignalMeaningByRefV1(input: {
  readonly absenceKey?: string;
  readonly absenceDescription?: string;
  readonly prevStage?: string;
  readonly currentStage?: string;
}): Readonly<Record<string, string>> | undefined {
  const out: Record<string, string> = {};
  const description = input.absenceDescription?.trim();
  if (input.absenceKey && description) out[`absence:${input.absenceKey}`] = description;
  const advice = input.currentStage ? PROMPT_ENHANCEMENT_STAGE_ADVICE_V1[input.currentStage] : undefined;
  if (input.currentStage && advice) out[`stage:${input.prevStage ?? 'unknown'}-to-${input.currentStage}`] = advice;
  return Object.keys(out).length > 0 ? out : undefined;
}
