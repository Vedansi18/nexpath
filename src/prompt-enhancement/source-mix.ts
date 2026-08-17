import type { PromptEnhancementPrepareRequestV1 } from './contracts.js';
import { redactSecrets } from '../store/redact.js';
import type {
  PromptEnhancementGuidanceFact,
  PromptEnhancementGuidanceSourceType,
  PromptEnhancementSourceOriginScope,
  PromptEnhancementClaimVerbPolicy,
  PromptEnhancementFactRole,
  PromptEnhancementSourceAnchorScope,
  PromptEnhancementSourceLaneV1,
  PromptEnhancementConfidenceBandV1,
  PromptEnhancementRecencyBandV1,
} from './templates/section-plan.js';
import {
  isPromptEnhancementSourceCriticalFactV1,
  PROMPT_ENHANCEMENT_KNOWN_SOURCE_TYPES_V1,
} from './templates/section-plan.js';

/**
 * transform-rule-2 split 1 — dual-lane source mixer (E2 / phase 2.2).
 *
 * Takes the ranked guidance facts from {@link buildPromptEnhancementGuidanceFactsV1}
 * (phase 2.1) and applies the locked transform-rule-2 source-mixing model deterministically
 * before any composer wording:
 *
 *  - Source A (missing-practice / required-survivor lane): stage/absence, memory,
 *    content-template. Exactly one `selected_required` survivor anchors a shown popup.
 *  - Source B (grounding lane): hard facts, RIGHT/GOOD, work-style. Selected only
 *    after the Source A survivor is known; it grounds, it never chooses the objective.
 *
 * Caps (split-1 defaults, transform-rule-2): requiredSourceAFacts = 1; supportingSourceAFacts
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

// MODULE-PRIVATE on purpose. This is the selection GROUPING, not lane semantics —
// the locked three-value lane lives on the fact. Exporting a two-value lane type
// from a phase whose point is three lanes invites the collapse straight back in.
type PromptEnhancementSourceMixLane = 'source_a' | 'source_b';

export type PromptEnhancementSourceMixSelectionRole =
  | 'selected_required'
  | 'selected_supporting'
  | 'deferred_to_handoff'
  | 'selected_source_label_only'
  | 'suppressed_by_payload_cap';

export interface PromptEnhancementSourceMixFact {
  fact: PromptEnhancementGuidanceFact;
  /**
   * ⛔ No `lane` field here. It used to carry a SECOND, two-value lane beside
   * the fact's own three-value `sourceLane` — the very collapse A5 undoes,
   * re-exposed on the result. The done-when is that no stand-in for lane
   * semantics remains, so consumers read `entry.fact.sourceLane`. The two-bucket
   * split still exists inside this module as a SELECTION grouping, derived from
   * the fact's lane rather than defining one.
   */
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

const RENDERABLE_PRIORITIES: ReadonlySet<PromptEnhancementGuidanceFact['priority']> = new Set([
  'required_survivor',
  'high',
  'normal',
  'low',
]);

/**
 * A5 (L4965): the fact's own lane, from the three LOCKED values.
 *
 * Before A5 the only lane notion was the two-value mixer local below, which
 * collapsed the NEUTRAL lane into grounding: a fact known only from the user's
 * own prompt was labelled `source_b` — the same label an independently
 * corroborated project fact carries. The wording clamp already stopped it
 * CLAIMING project knowledge, but nothing recorded that it was a different kind
 * of thing. This makes the distinction explicit and un-collapsible.
 */
export function promptEnhancementSourceLaneForV1(
  fact: PromptEnhancementGuidanceFact,
): PromptEnhancementSourceLaneV1 {
  if (SOURCE_A_TYPES.has(fact.sourceType)) return 'source_a_missing_practice';
  // The user's own prompt is neither a missing practice nor independent
  // grounding — it is the original, and it is the third locked lane.
  if (fact.sourceType === 'prompt_derived_fact') return 'source_neutral_original';
  if (fact.sourceOriginScope === 'current_prompt' || fact.sourceOriginScope === 'original_point_inventory') {
    return 'source_neutral_original';
  }
  return 'source_b_grounding';
}

/** A5 (L4976): the band, from the fact's own typed evidence state. */
export function promptEnhancementConfidenceBandForV1(
  fact: PromptEnhancementGuidanceFact,
): PromptEnhancementConfidenceBandV1 {
  switch (fact.sourceEvidenceState) {
    case 'strong': return 'high';
    case 'partial': return 'medium';
    case 'weak_low_risk':
    case 'weak_source_critical':
    case 'conflicting': return 'low';
    default: return 'unknown';
  }
}

/**
 * A5 (L4977): 🔴 *"stale/historical cannot be hidden"*. Derived from the fact's
 * origin scope, which already records WHERE the knowledge came from — so a
 * months-old memory can no longer look identical to current-prompt evidence.
 */
export function promptEnhancementRecencyBandForV1(
  fact: PromptEnhancementGuidanceFact,
): PromptEnhancementRecencyBandV1 {
  switch (fact.sourceOriginScope ?? DEFAULT_ORIGIN_BY_SOURCE_TYPE[fact.sourceType]) {
    case 'current_prompt':
    case 'original_point_inventory': return 'current_prompt';
    case 'recent_prompt_history':
    case 'transcript_corroboration': return 'current_session';
    case 'local_probe':
    case 'content_template_runtime':
    case 'content_template_registry': return 'recent_project';
    case 'stored_memory':
    case 'longitudinal_param_events': return 'historical';
    default: return 'unknown';
  }
}

function laneFor(fact: PromptEnhancementGuidanceFact): PromptEnhancementSourceMixLane {
  // READS the fact's lane — it does not re-derive one. The done-when is that no
  // local stands in for lane semantics the lock puts ON the fact, so once the
  // field exists it must be the authority; deriving here again would leave the
  // field decorative. The fallback covers only un-normalized fixture facts.
  const lane = fact.sourceLane ?? promptEnhancementSourceLaneForV1(fact);
  // The internal two-bucket split the selection logic has always used. Source
  // NEUTRAL rides the B bucket for SELECTION exactly as it did before A5 (it is
  // clamped to label-only and never consumes a grounding slot), so behaviour is
  // unchanged — but the fact now carries the honest three-value lane.
  return lane === 'source_a_missing_practice' ? 'source_a' : 'source_b';
}

// ── Tier-1 evidence-field normalization ──────────────────────────────────────
// Every fact entering the mix carries sourceOriginScope / claimVerbPolicy /
// factRole. Producers set them; legacy or fixture facts get deterministic
// defaults here, and the prompt-derived clamp below enforces the lane boundary:
// a fact known only from prompt text may never claim practice or project
// capability uncorroborated — its policy is clamped to possibility wording.

const DEFAULT_ORIGIN_BY_SOURCE_TYPE: Record<PromptEnhancementGuidanceSourceType, PromptEnhancementSourceOriginScope> = {
  stage_transition: 'current_prompt',
  absence_signal: 'current_prompt',
  content_template_record: 'content_template_registry',
  content_template_runtime_fact: 'content_template_runtime',
  persistent_missing_signal_memory: 'stored_memory',
  hard_fact: 'local_probe',
  right_good_pattern: 'longitudinal_param_events',
  work_style_fact: 'longitudinal_param_events',
  prompt_derived_fact: 'current_prompt',
};

const DEFAULT_POLICY_BY_SOURCE_TYPE: Record<PromptEnhancementGuidanceSourceType, PromptEnhancementClaimVerbPolicy> = {
  stage_transition: 'must_phrase_as_source_signal',
  absence_signal: 'must_phrase_as_source_signal',
  content_template_record: 'must_phrase_as_source_signal',
  content_template_runtime_fact: 'must_phrase_as_source_signal',
  persistent_missing_signal_memory: 'must_phrase_as_source_signal',
  hard_fact: 'must_phrase_as_possibility',
  right_good_pattern: 'must_phrase_as_possibility',
  work_style_fact: 'source_label_only',
  prompt_derived_fact: 'must_phrase_as_possibility',
};

const DEFAULT_ANCHOR_BY_SOURCE_TYPE: Record<PromptEnhancementGuidanceSourceType, PromptEnhancementSourceAnchorScope> = {
  stage_transition: 'current_prompt_scope',
  absence_signal: 'current_prompt_scope',
  content_template_record: 'content_template_scope',
  content_template_runtime_fact: 'content_template_scope',
  persistent_missing_signal_memory: 'longitudinal_user_behavior',
  // An env fact without a boundary-stamped anchor is UNANCHORED — its certainty
  // is suppressed below, per the anchor rule.
  hard_fact: 'unknown_anchor',
  right_good_pattern: 'longitudinal_user_behavior',
  work_style_fact: 'longitudinal_user_behavior',
  prompt_derived_fact: 'current_prompt_scope',
};

function defaultFactRole(fact: PromptEnhancementGuidanceFact): PromptEnhancementFactRole {
  if (laneFor(fact) === 'source_a') {
    return fact.priority === 'required_survivor' ? 'required_source_signal_survivor' : 'supporting_missing_practice';
  }
  switch (fact.sourceType) {
    case 'right_good_pattern': return 'positive_practice_preservation';
    case 'work_style_fact':    return 'neutral_style_support';
    default:                   return 'project_grounding_support';
  }
}

/** Policies stronger than possibility wording — illegal for prompt-only knowledge. */
const PROJECT_KNOWLEDGE_POLICIES: ReadonlySet<PromptEnhancementClaimVerbPolicy> = new Set([
  'may_state_as_user_practice',
  'may_state_as_project_capability',
  'must_have_behaviour_verified_practice',
]);

export function normalizePromptEnhancementTier1FieldsV1(
  fact: PromptEnhancementGuidanceFact,
): PromptEnhancementGuidanceFact {
  const sourceOriginScope = fact.sourceOriginScope ?? DEFAULT_ORIGIN_BY_SOURCE_TYPE[fact.sourceType];
  let claimVerbPolicy = fact.claimVerbPolicy ?? DEFAULT_POLICY_BY_SOURCE_TYPE[fact.sourceType];
  // Prompt-derived lane boundary: knowledge from prompt text alone must never be
  // phrased as project knowledge — clamp to possibility wording, whatever was asked.
  const promptOnly = sourceOriginScope === 'current_prompt' || sourceOriginScope === 'recent_prompt_history';
  if (promptOnly && PROJECT_KNOWLEDGE_POLICIES.has(claimVerbPolicy)) {
    claimVerbPolicy = 'must_phrase_as_possibility';
  }
  // Served rows are provenance only — never practice proof, never instruction prose.
  const served = sourceOriginScope === 'served_variant_identity';
  if (served) claimVerbPolicy = 'source_label_only';
  const sourceAnchorScope = fact.sourceAnchorScope ?? DEFAULT_ANCHOR_BY_SOURCE_TYPE[fact.sourceType];
  // Anchor rules: a MACHINE fact never makes a project or practice claim, and an
  // UNANCHORED env fact has its certainty suppressed — uncertainty phrasing only.
  // Deliberately NO project_root+practice clamp here: practice wording on an env
  // fact exists only via behaviour-corroborated tier-P promotion (the registry's
  // policy assignment), and this seam cannot distinguish a promoted fact from a
  // smuggled one — a clamp would undo legitimate tier-P wording. Do not add one.
  if (sourceAnchorScope === 'machine_environment' && PROJECT_KNOWLEDGE_POLICIES.has(claimVerbPolicy)) {
    claimVerbPolicy = 'must_phrase_as_possibility';
  }
  if (fact.sourceType === 'hard_fact' && sourceAnchorScope === 'unknown_anchor' && PROJECT_KNOWLEDGE_POLICIES.has(claimVerbPolicy)) {
    claimVerbPolicy = 'must_phrase_as_possibility';
  }
  const withTier1 = {
    ...fact,
    sourceOriginScope,
    claimVerbPolicy,
    sourceAnchorScope,
    factRole: fact.factRole ?? (served ? 'served_variant_provenance_only' : defaultFactRole(fact)),
  };
  // A5 tier-2/3: normalized here for the same reason the tier-1 trio is — no
  // fact reaches selection without them, and producers may still set them.
  return {
    ...withTier1,
    // Producers may set the lane, but prompt-only knowledge can never be
    // RELABELLED into a lane it cannot occupy — the same boundary the claim
    // clamp above enforces for wording, applied to the lane itself.
    sourceLane: promptEnhancementSourceLaneForV1(withTier1) === 'source_neutral_original'
      ? 'source_neutral_original'
      : fact.sourceLane ?? promptEnhancementSourceLaneForV1(withTier1),
    confidenceBand: fact.confidenceBand ?? promptEnhancementConfidenceBandForV1(withTier1),
    recencyBand: fact.recencyBand ?? promptEnhancementRecencyBandForV1(withTier1),
  };
}

/** High-risk / source-critical facts must never be downgraded to invisible metadata. */
// One definition, shared with the mixer/gate and F3's never-faded guard.
const isSourceCritical = isPromptEnhancementSourceCriticalFactV1;

/** Invalid/unsafe facts (missing source ids, unrenderable) are rejected before mixing. */
function isValidFact(fact: PromptEnhancementGuidanceFact): boolean {
  return (
    // L4966: an UNKNOWN source kind FAILS. Without this an unrecognised fact was
    // accepted and rendered as `source_b_grounding` — foreign provenance
    // presenting as project grounding. It rides the existing invalid-source
    // rejection rather than a new gate, so the locked downgrade path is unchanged.
    PROMPT_ENHANCEMENT_KNOWN_SOURCE_TYPES_V1.has(fact.sourceType) &&
    fact.sourceIds.length > 0 &&
    fact.privacyClass !== 'do_not_render' &&
    fact.sanitizationState !== 'unsafe_to_render' &&
    // Ids must be stable keys or redacted fingerprints, NEVER a raw sensitive
    // literal — a secret-shaped id invalidates the fact, which rides the existing
    // invalid-source rejection (rerun/skip with reason), the locked downgrade path.
    fact.sourceIds.every((id) => redactSecrets(id) === id)
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
  rawFacts: readonly PromptEnhancementGuidanceFact[],
  levelState: PromptEnhancementPrepareRequestV1['userPreferenceContext']['levelState'] = 'default',
): PromptEnhancementSourceMixResult {
  // Tier-1 fields are REQUIRED at this seam: normalize every entering fact so none
  // is classified without origin scope, claim policy, and role.
  const facts = rawFacts.map(normalizePromptEnhancementTier1FieldsV1);
  const caps = capsForLevel(levelState);
  const classified: PromptEnhancementSourceMixFact[] = [];

  const rejectedSourceA = facts.some((fact) => !isValidFact(fact) && laneFor(fact) === 'source_a');

  // Only render-eligible priorities are mix candidates; suppressed / handoff-only /
  // deferred facts (e.g. a conflict-suppressed positive fact) carry provenance but
  // are not selected into the shown body.
  const renderableFacts = facts.filter((fact) => isValidFact(fact) && RENDERABLE_PRIORITIES.has(fact.priority));

  const sourceA = renderableFacts.filter((fact) => laneFor(fact) === 'source_a');
  const sourceB = renderableFacts.filter((fact) => laneFor(fact) === 'source_b');

  // No valid Source A survivor -> DR2-G1: skip, never build filler from Source B.
  if (sourceA.length === 0) {
    for (const fact of sourceB) {
      classified.push({
        fact,
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
        selectionRole: 'selected_supporting',
        selectionReasonCode: 'supporting_source_a_within_cap',
      });
      supportingSourceASelected += 1;
      renderedCount += 1;
    } else if (isSourceCritical(fact)) {
      classified.push({
        fact,
        selectionRole: 'selected_source_label_only',
        selectionReasonCode: 'source_critical_over_cap_kept_visible',
      });
    } else {
      classified.push({
        fact,
        selectionRole: 'deferred_to_handoff',
        selectionReasonCode: 'supporting_source_a_over_cap',
      });
    }
  }

  // Source B grounding, only after the Source A survivor is fixed. Two lane
  // boundaries hold here: a FALSE capability is safety material and never counts
  // as grounding, and prompt-only knowledge never satisfies a Source B cap —
  // both stay visible as source labels, never as independent grounding.
  let sourceBSelected = 0;
  for (const fact of sourceB) {
    if (fact.factRole === 'safety_confirmation_support') {
      classified.push({
        fact,
        selectionRole: 'selected_source_label_only',
        selectionReasonCode: 'negative_capability_safety_not_grounding',
      });
      continue;
    }
    if (fact.sourceOriginScope === 'current_prompt' || fact.sourceOriginScope === 'recent_prompt_history') {
      classified.push({
        fact,
        selectionRole: 'selected_source_label_only',
        selectionReasonCode: 'prompt_derived_not_independent_grounding',
      });
      continue;
    }
    // False OR UNKNOWN capability facts must not satisfy grounding caps — an
    // unknown probe value stays visible as a label, never as a grounding claim.
    if (fact.sourceEvidenceState === 'stale_or_unknown') {
      classified.push({
        fact,
        selectionRole: 'selected_source_label_only',
        selectionReasonCode: 'stale_or_unknown_not_grounding',
      });
      continue;
    }
    const underLevelCap = sourceBSelected < caps.sourceB;
    const underTotalCap = renderedCount < TOTAL_FACT_CAP;
    if (underLevelCap && underTotalCap) {
      classified.push({
        fact,
        selectionRole: 'selected_supporting',
        selectionReasonCode: 'source_b_grounding_within_cap',
      });
      sourceBSelected += 1;
      renderedCount += 1;
    } else {
      classified.push({
        fact,
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
  // "No useful Source B fact" is the source_a_only hallmark (transform-rule-2), regardless of
  // how many supporting Source A facts were selected.
  if (input.sourceBSelected === 0) return 'source_a_only';
  if (input.sourceBSelected === 1 && input.supportingSourceASelected === 0) return 'source_a_with_light_grounding';
  return 'balanced_dual_source';
}
