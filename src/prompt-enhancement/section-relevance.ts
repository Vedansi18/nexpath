/**
 * I1 — the RELEVANCE OBSERVATION: of the sections that could be planned, which most serve THIS
 * prompt?
 *
 * 🔒 §15.2 step 1: *"an ORDERING, not a deletion; the model deletes nothing"*, and §15.2 step 3:
 * *"model observes, registry decides"* (prohibition 4). This module builds only the observation's
 * vocabulary and its guard. ⛔ **Nothing here prunes.** The registry does that in I2, under the
 * locked drop-criteria (§15.1 (a)/(b)/(c)) — an ordering that arrived from a model is an input to
 * that decision, never the decision.
 *
 * ⚠️ **Why the model is shown section KINDS and not the planned sections.** The classifier call
 * happens BEFORE routing and section planning — planning consumes the intent and capabilities this
 * same reply proposes. So there is no list of planned sections in existence when the observation is
 * made, and asking for one would be asking the model to rank something it cannot see. It ranks the
 * VOCABULARY; I2 applies that ordering to whatever was actually planned, and a kind the plan never
 * produced simply never matches.
 *
 * ⚠️ **This module is a LEAF on purpose, and the list is CHECKED rather than derived.** The first
 * version imported the planner's `PROMPT_ENHANCEMENT_PLANNABLE_SECTION_KINDS_V1` and derived from
 * it — which closed an import cycle (the classifier imports this module, and the planner's module
 * graph reaches the classifier) and threw `Cannot access … before initialization` at load. Making
 * the read lazy did NOT fix it: the cycle is the problem, not the timing.
 *
 * 🔑 So "one map, one meaning" is preserved by a FIXTURE rather than by an import —
 * `section-relevance.test.ts` asserts this list equals the planner's, positionally. A kind added on
 * one side and not the other fails CI. Same guarantee, no cycle.
 */

/**
 * The kinds the model may order, with what each is FOR — IN THE PLANNER'S OWN ORDER.
 *
 * ⚠️ The key order is load-bearing: it IS the vocabulary (see the accessor below), and the fixture
 * compares it to the planner's list positionally.
 */
const SECTION_PURPOSE_V1: Readonly<Record<string, string>> = {
  original_request_or_goal: 'the developer\'s own request, carried verbatim',
  uncertainty_or_clarification: 'what is ambiguous and needs asking',
  acceptance_or_output_expectation: 'what finished looks like and how it will be judged',
  verification_or_test_plan: 'how the change will be proven to work',
  reproduction_or_evidence: 'the steps, logs or samples that show the problem',
  behavior_preservation: 'what must keep working unchanged',
  risk_safety_or_confirmation: 'risk, rollback, and what needs confirming before acting',
  project_grounding_facts: 'facts about this specific project that shape the work',
  requirement_source_state: 'where the requirement came from and how firm it is',
  handoff_or_sequence_candidate: 'work that should be split or handed on',
  context_and_constraints: 'the constraints, environment and limits the work must respect',
  point_inventory_or_decomposition: 'the separate points the request contains',
  finding_format: 'how findings should be reported back',
  source_signal_guidance: 'what the current signals say about this developer\'s practice',
};

/** The vocabulary offered to the model, in the planner's own order. */
export function promptEnhancementRelevanceSectionKindsV1(): readonly string[] {
  return Object.keys(SECTION_PURPOSE_V1);
}

/** One prompt line per kind: the id the reply must use, and what it is for. */
export function promptEnhancementRelevanceMenuLinesV1(): readonly string[] {
  return promptEnhancementRelevanceSectionKindsV1()
    .map((kind) => `- ${kind} — ${SECTION_PURPOSE_V1[kind] ?? ''}`.trimEnd());
}

/** Narrow one raw entry. An unknown kind is DROPPED, never guessed at and never invented. */
export function isPromptEnhancementRelevanceSectionKindV1(value: unknown): value is string {
  return typeof value === 'string' && Object.hasOwn(SECTION_PURPOSE_V1, value);
}

/**
 * Normalise a raw ordering: known kinds only, first occurrence wins, order preserved.
 *
 * ⚠️ Duplicates are dropped rather than rejected. The observation is a RANKING — a model that names
 * the same kind twice has still told us where it ranks it, and discarding the whole reply over a
 * repeat would throw away a usable ordering for a formatting slip.
 */
export function normalizePromptEnhancementRelevanceOrderV1(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    if (!isPromptEnhancementRelevanceSectionKindV1(entry) || seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }
  return out;
}
