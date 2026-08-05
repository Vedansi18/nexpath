import type { PromptEnhancementPrepareRequestV1 } from './contracts.js';
import type {
  PromptEnhancementGuidanceFact,
  PromptEnhancementGuidanceSourceType,
} from './templates/section-plan.js';

/**
 * PE-AR-2 split 1 — dual-lane source mixer (E2 / phase 2.2).
 *
 * Takes the ranked guidance facts from {@link buildPromptEnhancementGuidanceFactsV1}
 * (phase 2.1) and applies the locked PE-AR-2 source-mixing model deterministically
 * before any composer wording:
 *
 *  - Source A (missing-practice / required-survivor lane): stage/absence, memory,
 *    content-template. Exactly one `selected_required` survivor anchors a shown popup.
 *  - Source B (grounding lane): hard facts, RIGHT/GOOD, work-style. Selected only
 *    after the Source A survivor is known; it grounds, it never chooses the objective.
 *
 * Caps (split-1 defaults, PE-AR-2): requiredSourceAFacts = 1; supportingSourceAFacts
 * 0-1 (up to 2 for More thorough / high-risk); sourceBFacts 0-2 (up to 3 for More
 * project-grounded / More thorough); total rendered <= 5. Facts over cap become
 * `deferred_to_handoff` / `selected_source_label_only` / `suppressed_by_payload_cap`
 * with a reason code — never hidden generated prose, and a high-risk / source-critical
 * Source A fact is never downgraded to invisible metadata to satisfy the 5-cap.
 *
 * The DR2-G1 no-filler skip is expressed here as {@link showPopup}=false with a
 * `no_useful_source_a_skip` / `source_b_only_no_popup` profile; phase 2.3 turns that
 * into the actual `skip_no_popup` disposition. Selection is deterministic — no LLM.
 */
export type PromptEnhancementSourceMixProfile =
  | 'no_useful_source_a_skip'
  | 'source_a_only'
  | 'source_a_with_light_grounding'
  | 'balanced_dual_source'
  | 'source_a_heavy_high_risk'
  | 'source_b_only_no_popup'
  | 'over_token_or_source_cap_compressed'
  | 'source_invalid_fallback';

export type PromptEnhancementSourceMixLane = 'source_a' | 'source_b';

export type PromptEnhancementSourceMixSelectionRole =
  | 'selected_required'
  | 'selected_supporting'
  | 'deferred_to_handoff'
  | 'selected_source_label_only'
  | 'suppressed_by_payload_cap';

export interface PromptEnhancementSourceMixFact {
  fact: PromptEnhancementGuidanceFact;
  lane: PromptEnhancementSourceMixLane;
  selectionRole: PromptEnhancementSourceMixSelectionRole;
  selectionReasonCode: string;
}

export interface PromptEnhancementSourceMixResult {
  profile: PromptEnhancementSourceMixProfile;
  showPopup: boolean;
  requiredSurvivor: PromptEnhancementGuidanceFact | null;
  renderedFacts: readonly PromptEnhancementGuidanceFact[];
  classifiedFacts: readonly PromptEnhancementSourceMixFact[];
}

const SOURCE_A_TYPES: ReadonlySet<PromptEnhancementGuidanceSourceType> = new Set([
  'stage_transition',
  'absence_signal',
  'content_template_record',
  'content_template_runtime_fact',
  'persistent_missing_signal_memory',
]);

const TOTAL_FACT_CAP = 5;

function laneFor(fact: PromptEnhancementGuidanceFact): PromptEnhancementSourceMixLane {
  return SOURCE_A_TYPES.has(fact.sourceType) ? 'source_a' : 'source_b';
}

/** High-risk / source-critical facts must never be downgraded to invisible metadata. */
function isSourceCritical(fact: PromptEnhancementGuidanceFact): boolean {
  return (
    fact.riskLevel === 'high' ||
    fact.riskLevel === 'sensitive_authority_risky' ||
    fact.guidanceKind === 'safety_or_confirmation'
  );
}

/** Invalid/unsafe facts (missing source ids, unrenderable) are rejected before mixing. */
function isValidFact(fact: PromptEnhancementGuidanceFact): boolean {
  return (
    fact.sourceIds.length > 0 &&
    fact.privacyClass !== 'do_not_render' &&
    fact.sanitizationState !== 'unsafe_to_render'
  );
}

function capsForLevel(
  levelState: PromptEnhancementPrepareRequestV1['userPreferenceContext']['levelState'],
): { supportingSourceA: number; sourceB: number } {
  switch (levelState) {
    case 'more_thorough':
      return { supportingSourceA: 2, sourceB: 3 };
    case 'more_project_grounded':
      return { supportingSourceA: 1, sourceB: 3 };
    default:
      return { supportingSourceA: 1, sourceB: 2 };
  }
}

export function applyPromptEnhancementSourceMixV1(
  facts: readonly PromptEnhancementGuidanceFact[],
  levelState: PromptEnhancementPrepareRequestV1['userPreferenceContext']['levelState'] = 'default',
): PromptEnhancementSourceMixResult {
  const caps = capsForLevel(levelState);
  const classified: PromptEnhancementSourceMixFact[] = [];

  const validFacts = facts.filter(isValidFact);
  const rejectedSourceA = facts.some((fact) => !isValidFact(fact) && laneFor(fact) === 'source_a');

  const sourceA = validFacts.filter((fact) => laneFor(fact) === 'source_a');
  const sourceB = validFacts.filter((fact) => laneFor(fact) === 'source_b');

  // No valid Source A survivor -> DR2-G1: skip, never build filler from Source B.
  if (sourceA.length === 0) {
    for (const fact of sourceB) {
      classified.push({
        fact,
        lane: 'source_b',
        selectionRole: 'suppressed_by_payload_cap',
        selectionReasonCode: 'no_source_a_survivor_no_source_b_filler',
      });
    }
    // A Source A candidate rejected for invalidity, with none valid remaining, is the
    // fallback path (not a plain "no signal" skip).
    const skipProfile: PromptEnhancementSourceMixProfile = rejectedSourceA
      ? 'source_invalid_fallback'
      : sourceB.length > 0
        ? 'source_b_only_no_popup'
        : 'no_useful_source_a_skip';
    return {
      profile: skipProfile,
      showPopup: false,
      requiredSurvivor: null,
      renderedFacts: [],
      classifiedFacts: classified,
    };
  }

  // Source A is ranked required-survivor-first (phase 2.1). Anchor with exactly one.
  const [requiredSurvivor, ...remainingSourceA] = sourceA;
  classified.push({
    fact: requiredSurvivor,
    lane: 'source_a',
    selectionRole: 'selected_required',
    selectionReasonCode: 'required_source_signal_survivor',
  });
  let renderedCount = 1;

  // Supporting Source A up to the level cap and the hard total cap. Overflow stays
  // visible (source-critical -> label_only, else deferred to handoff).
  let supportingSourceASelected = 0;
  for (const fact of remainingSourceA) {
    const underLevelCap = supportingSourceASelected < caps.supportingSourceA;
    const underTotalCap = renderedCount < TOTAL_FACT_CAP;
    if (underLevelCap && underTotalCap) {
      classified.push({
        fact,
        lane: 'source_a',
        selectionRole: 'selected_supporting',
        selectionReasonCode: 'supporting_source_a_within_cap',
      });
      supportingSourceASelected += 1;
      renderedCount += 1;
    } else if (isSourceCritical(fact)) {
      classified.push({
        fact,
        lane: 'source_a',
        selectionRole: 'selected_source_label_only',
        selectionReasonCode: 'source_critical_over_cap_kept_visible',
      });
    } else {
      classified.push({
        fact,
        lane: 'source_a',
        selectionRole: 'deferred_to_handoff',
        selectionReasonCode: 'supporting_source_a_over_cap',
      });
    }
  }

  // Source B grounding, only after the Source A survivor is fixed.
  let sourceBSelected = 0;
  for (const fact of sourceB) {
    const underLevelCap = sourceBSelected < caps.sourceB;
    const underTotalCap = renderedCount < TOTAL_FACT_CAP;
    if (underLevelCap && underTotalCap) {
      classified.push({
        fact,
        lane: 'source_b',
        selectionRole: 'selected_supporting',
        selectionReasonCode: 'source_b_grounding_within_cap',
      });
      sourceBSelected += 1;
      renderedCount += 1;
    } else {
      classified.push({
        fact,
        lane: 'source_b',
        selectionRole: 'suppressed_by_payload_cap',
        selectionReasonCode: 'source_b_over_payload_cap',
      });
    }
  }

  const renderedFacts = classified
    .filter((entry) => entry.selectionRole === 'selected_required' || entry.selectionRole === 'selected_supporting')
    .map((entry) => entry.fact);

  return {
    profile: determineProfile({
      requiredSurvivor,
      supportingSourceASelected,
      sourceBSelected,
      overCap: classified.some(
        (entry) =>
          entry.selectionRole === 'deferred_to_handoff' ||
          entry.selectionRole === 'suppressed_by_payload_cap' ||
          entry.selectionRole === 'selected_source_label_only',
      ),
    }),
    showPopup: true,
    requiredSurvivor,
    renderedFacts,
    classifiedFacts: classified,
  };
}

function determineProfile(input: {
  requiredSurvivor: PromptEnhancementGuidanceFact;
  supportingSourceASelected: number;
  sourceBSelected: number;
  overCap: boolean;
}): PromptEnhancementSourceMixProfile {
  if (isSourceCritical(input.requiredSurvivor)) return 'source_a_heavy_high_risk';
  if (input.overCap) return 'over_token_or_source_cap_compressed';
  // "No useful Source B fact" is the source_a_only hallmark (PE-AR-2), regardless of
  // how many supporting Source A facts were selected.
  if (input.sourceBSelected === 0) return 'source_a_only';
  if (input.sourceBSelected === 1 && input.supportingSourceASelected === 0) return 'source_a_with_light_grounding';
  return 'balanced_dual_source';
}
