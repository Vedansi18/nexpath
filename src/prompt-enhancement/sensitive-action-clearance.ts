/**
 * The sensitive-action clearance gate — the ONE shared decision both risk-decision
 * functions consult before emitting the canonical confirmation line.
 *
 * Two layers produce the decision this gate arbitrates:
 *   - Layer 1 (RECALL, deterministic): the RISK_PATTERNS keyword table raises a
 *     candidate whenever a risky word appears. It is kept whole — measured at
 *     20/20 on the frozen risky set — and this module never touches it.
 *   - Layer 2 (PRECISION, LLM): one observation parked on the stage-classifier
 *     call answers a single question — does this prompt PROPOSE performing the
 *     risky action, or merely MENTION the word? "drop a shadow" clears;
 *     "drop the table" does not.
 *
 * This is an APPROVED EXCEPTION to the additive-only rule (a model turning a
 * block into a pass), granted in writing for this layer only, and three
 * conditions bind it here:
 *   1. Only an explicit 'not_proposed' clears. Absent, degraded, malformed,
 *      unparseable and 'proposed' ALL emit — every failure mode lands on
 *      today's behaviour with no special case.
 *   2. A clearance with no stated reason is VOID. The model cannot remove a
 *      safety line by asserting; it has to say what the benign reading IS,
 *      which turns "we could audit clearances" into "a clearance that cannot
 *      be audited never happened".
 *   3. The verdict was computed on the user's PROMPT text. It may clear only
 *      candidates that arise from that text — callers judging prompt+body
 *      material pass the PROMPT slice here and keep body-introduced candidates
 *      fully armed (a pattern the classifier never saw says nothing about).
 *
 * Placement rule (the part that was wrong three times before it was mapped):
 * only the two risk-DECISION functions consult this gate. It never enters
 * `classifyTextRiskKinds` (one of its consumers builds the sentence wording —
 * a cleared kind there would change the wording, the strip would miss, and the
 * mis-strip defect returns), never the sentence builder, and never the
 * sequence lane's floor.
 */

/** The clearance observation as carried on the PE request (string-typed at the boundary). */
export interface PromptEnhancementSensitiveActionClearanceV1 {
  readonly verdict?: string;
  readonly reason?: string;
}

/** A reason counts only when it says something: whitespace is not a benign reading. */
function isNonEmptyReason(reason: string | undefined): reason is string {
  return typeof reason === 'string' && reason.trim().length > 0;
}

/**
 * Does this clearance clear candidates arising from `textJudged`?
 *
 * `textJudged` is the text whose keyword candidates the caller is deciding on. Per
 * condition 3 above it must be the user's PROMPT slice — never generated-body text —
 * because the verdict was computed on the prompt alone. An empty judged text has no
 * candidates a clearance could apply to, so it never clears.
 *
 * The truth table, verbatim from the fail-closed mechanism:
 *   cleared = verdict === 'not_proposed' && isNonEmptyReason(reason)
 * absent · degraded · malformed · reasonless · 'proposed' ⇒ NOT cleared ⇒ the
 * confirmation is emitted on the keyword candidate exactly as today.
 */
export function promptEnhancementSensitiveActionClearedForTextV1(
  textJudged: string,
  clearance: PromptEnhancementSensitiveActionClearanceV1 | undefined,
): boolean {
  if (textJudged.trim().length === 0) return false;
  if (clearance === undefined) return false;
  return clearance.verdict === 'not_proposed' && isNonEmptyReason(clearance.reason);
}
