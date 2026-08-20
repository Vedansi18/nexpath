/**
 * I2 — the deterministic pruner, under the LOCKED drop-criteria (§15.1).
 *
 * 🔒 The criteria are Hiren's, given 2026-08-16, and are not re-derived here:
 *   **(a)** evidence first, then relevance — a FACTLESS section drops BEFORE ranking; the model's
 *           ordering ranks the remainder; the REGISTRY drops below-bar.
 *   **(b)** soft cap — the locked floor plus at most 2–3 extras.
 *   **(c)** slots follow their section, but no-invention state, send-policy and confirmation
 *           linkage stay on the body invisibly for the checks.
 *
 * ⛔ **The registry decides; the model only ordered** (prohibition 4). I1's observation is an input
 * to stage (b) and to nothing else: it cannot promote a factless section past stage (a), and it
 * cannot touch the floor at all. An empty or absent ordering is not "rank everything last" — it
 * means no relevance signal, and the cap then falls back to the planner's own order.
 *
 * 🔒 **The floor is UNTOUCHABLE** (prohibition 18, §15.1): the verbatim original, one required
 * guidance section, and safety when risky. Safety sections cannot be pruned, ever — §15.1's bound,
 * and §42.3's fatigue guard says the same thing about the same material.
 */

import type { PromptEnhancementGuidanceFact } from './templates/section-plan.js';
import { PROMPT_ENHANCEMENT_UNCONDITIONAL_SAFETY_FLAGS_V1 } from './templates/section-plan.js';
import type { PromptEnhancementSectionPlanItemV1 } from './contracts.js';

/**
 * The obligations that SURVIVE their section's removal (criterion (c)).
 *
 * ⚠️ These are the classes that exist for a CHECK rather than for the reader: the no-invention
 * state, the send policy, the confirmation linkage and the safety hooks. A visible slot is the
 * section's own; these are the body's, and a body that quietly stopped carrying them because a
 * section was pruned would be a safety regression dressed as a length saving.
 */
const OBLIGATIONS_SURVIVING_THEIR_SECTION_V1: readonly string[] = [
  'no_invention_state',
  'send_policy_metadata',
  'safety_hook_linkage',
  'confirmation_clarification',
];

/** Criterion (b)'s cap: the floor, plus at most this many extras. */
export const PROMPT_ENHANCEMENT_PRUNE_EXTRA_CAP_V1 = 3;

export interface PromptEnhancementPruneResultV1 {
  /** The sections that survive, in their planned order. */
  readonly sectionPlans: readonly PromptEnhancementSectionPlanItemV1[];
  /** Dropped section ids, for the record and for the log. */
  readonly droppedSectionIds: readonly string[];
  /** Criterion (c): obligations inherited from dropped sections, kept on the body. */
  readonly inheritedSlotObligations: readonly string[];
  /** Criterion 5: the facts whose sections went, reason-coded rather than silently gone. */
  readonly facts: readonly PromptEnhancementGuidanceFact[];
}

/** A fact carries content when it has a renderable value — group A's own test, not a kind list. */
function factHasContentV1(fact: PromptEnhancementGuidanceFact): boolean {
  return (fact.evidence?.value ?? '').trim().length > 0;
}

/**
 * Safety material, which can never be pruned (§15.1: *"safety sections cannot be pruned, ever"*).
 *
 * ⚠️ Read from the section's OWN typed flags, never from a list of kind names — a name list would be
 * a second map of the same meaning and would drift the first time a kind is renamed.
 */
function isSafetySectionV1(section: PromptEnhancementSectionPlanItemV1): boolean {
  // 🔴 Corrected during implementation, by MEASURING a real body: `safetyFlags.length > 0` is true
  // of EVERY section, because `source_honesty` and `no_authority_escalation` are unconditional. With
  // that test the floor swallowed 7 of 7 sections and the pruner did nothing at all — while its own
  // unit tests passed, because fixtures only set the flags that mean something.
  //
  // 🔑 What marks a section as safety MATERIAL is a flag beyond that unconditional pair — a
  // confirmation requirement, a risk/rollback overlay, a fact-supplied hook — or a sensitivity flag,
  // which is only ever produced by a high-risk fact.
  return section.safetyFlags.some((flag) => !PROMPT_ENHANCEMENT_UNCONDITIONAL_SAFETY_FLAGS_V1.includes(flag))
    || section.sensitivityFlags.length > 0;
}

/**
 * The floor, EXACTLY as the criterion words it: *"verbatim original + ONE required guidance +
 * safety when risky"*.
 *
 * 🔴 **Corrected during implementation, by measuring rather than reasoning.** The first version
 * treated EVERY `isRequired` section as floor. On a real composed body that was five of seven
 * sections, so the cap had nothing left to bite on and the pruner was inert while its own unit
 * tests passed — they passed because the fixtures marked only ONE section required, which is the
 * criterion's shape and not the planner's.
 *
 * 🔑 The criterion says ONE. Templates mark several sections required, and the rest of them are
 * EXTRAS competing under (a) and (b) like anything else — which is exactly what §47.3's worked
 * example shows when acceptance, a required-shaped section, drops at stage (b).
 *
 * ⚠️ L5010 still binds what happens next: a required Source-A survivor is never *silently* lost —
 * the drop is reason-coded on its facts by the caller, which is criterion 5's job.
 */
function selectFloorV1(
  sectionPlans: readonly PromptEnhancementSectionPlanItemV1[],
): ReadonlySet<string> {
  const floor = new Set<string>();
  let requiredGuidanceTaken = false;
  for (const section of sectionPlans) {
    if (section.sectionKind === 'original_request_or_goal' || isSafetySectionV1(section)) {
      floor.add(section.sectionId);
      continue;
    }
    // The FIRST required guidance section, in planned order, and only the first.
    if (section.isRequired && !requiredGuidanceTaken) {
      floor.add(section.sectionId);
      requiredGuidanceTaken = true;
    }
  }
  return floor;
}

/**
 * Prune under the locked criteria. Pure: it decides, and the caller applies.
 *
 * ⚠️ Order is load-bearing and is the criteria's own: evidence, THEN relevance. A section with no
 * content-carrying fact is gone before the ordering is consulted, so a model that ranked it first
 * cannot save it — which is the whole point of stage (a) preceding stage (b).
 */
export function prunePromptEnhancementSectionsV1(input: {
  readonly sectionPlans: readonly PromptEnhancementSectionPlanItemV1[];
  readonly facts: readonly PromptEnhancementGuidanceFact[];
  /** I1's ordering, most-useful-first. Empty or absent = no relevance signal. */
  readonly relevanceOrder?: readonly string[];
}): PromptEnhancementPruneResultV1 {
  const { sectionPlans, facts } = input;
  const relevanceOrder = input.relevanceOrder ?? [];

  const factsById = new Map(facts.map((fact) => [fact.factId, fact]));
  const contentFactIdsFor = (section: PromptEnhancementSectionPlanItemV1): readonly string[] =>
    section.structuredContentPartRefs
      .map((ref: string) => ref.replace(/^guidance_fact:/, ''))
      .filter((factId: string) => {
        const fact = factsById.get(factId);
        return fact !== undefined && factHasContentV1(fact);
      });

  // ── Stage (a): evidence first. A factless section drops BEFORE anything is ranked. ──────────
  const floorIds = selectFloorV1(sectionPlans);
  const floor: PromptEnhancementSectionPlanItemV1[] = [];
  const evidenced: PromptEnhancementSectionPlanItemV1[] = [];
  const dropped: PromptEnhancementSectionPlanItemV1[] = [];
  for (const section of sectionPlans) {
    if (floorIds.has(section.sectionId)) { floor.push(section); continue; }
    if (contentFactIdsFor(section).length === 0) { dropped.push(section); continue; }
    evidenced.push(section);
  }

  // ── Stage (b): the soft cap, ordered by the model's observation where it has one. ───────────
  // ⚠️ Sections the ordering never mentions keep their planned position AFTER the ranked ones,
  // rather than being treated as lowest-ranked: an absent entry is missing information, not a
  // judgement, and inventing a judgement from silence is what prohibition 4 forbids.
  const rank = (section: PromptEnhancementSectionPlanItemV1): number => {
    const at = relevanceOrder.indexOf(section.sectionKind);
    return at === -1 ? Number.MAX_SAFE_INTEGER : at;
  };
  const ranked = [...evidenced]
    .map((section, planned) => ({ section, planned, rank: rank(section) }))
    .sort((a, b) => (a.rank - b.rank) || (a.planned - b.planned))
    .map((entry) => entry.section);

  const kept = ranked.slice(0, PROMPT_ENHANCEMENT_PRUNE_EXTRA_CAP_V1);
  dropped.push(...ranked.slice(PROMPT_ENHANCEMENT_PRUNE_EXTRA_CAP_V1));

  // Survivors render in the PLANNED order, not the ranked one: relevance decides what stays, not
  // what the body reads like. Reordering a body under the reader is a separate change nobody asked
  // for, and §15.1 bounds this to pruning inside the single editable body.
  const keptIds = new Set([...floor, ...kept].map((section) => section.sectionId));
  const survivors = sectionPlans.filter((section) => keptIds.has(section.sectionId));

  // ── Criterion (c): the visible slots go with the section; these stay on the body. ───────────
  const inherited = new Set<string>();
  for (const section of dropped) {
    for (const obligation of section.slotObligations) {
      if (OBLIGATIONS_SURVIVING_THEIR_SECTION_V1.includes(obligation)) inherited.add(obligation);
    }
  }

  // ── Criterion 5: reason-code the facts whose section went. Never a silent loss. ─────────────
  const droppedFactIds = new Set(dropped.flatMap((section) => contentFactIdsFor(section)));
  const reasonCoded = facts.map((fact) => (
    droppedFactIds.has(fact.factId)
      ? {
        ...fact,
        selectionState: 'suppressed_by_relevance' as const,
        selectionReasonCodes: [...(fact.selectionReasonCodes ?? []), 'section_pruned_by_relevance'],
      }
      : fact
  ));

  return {
    sectionPlans: survivors,
    droppedSectionIds: dropped.map((section) => section.sectionId),
    inheritedSlotObligations: [...inherited],
    facts: reasonCoded,
  };
}
