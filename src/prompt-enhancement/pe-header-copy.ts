import type {
  PromptEnhancementPinchLabelV1,
  PromptEnhancementWhyHelpV1,
} from './contracts.js';
import type {
  PromptEnhancementCapabilityId,
  PromptEnhancementFamilyId,
} from './routing-taxonomy.js';

// ---------------------------------------------------------------------------
// UI-9 / PE-AR-10 — deterministic header copy (pinch label + why-help).
//
// Locked decisions (plan §8.6, owner 2026-08-03):
//  - Deterministic only — NO LLM call before first render.
//  - Pinch label: funny/light, built around the prompt's signal (here the route
//    family / safety overlay, which reflects the user's flow + problem), with a
//    funny fallback.
//  - Why-help: present ONLY when a safety / risk / sensitive-action reason
//    exists, and it names that source-backed reason; otherwise it is absent.
//  - The UI never invents these — it renders exactly what this producer supplies.
//
// The copy strings below are PLACEHOLDER pending the reference screenshot; the
// structure (keys, gating, fallback) is the locked part.
// ---------------------------------------------------------------------------

/** Funny/light pinch labels keyed on the route family. */
const PINCH_BY_FAMILY: Readonly<Record<PromptEnhancementFamilyId, string>> = {
  feature_delivery: 'Shipping something?',
  planning_spec: 'Plot first.',
  issue_debug: 'Bug hunt.',
  maintenance_refactor: 'Tidy-up time.',
  review_verification: 'Second look.',
  quick_improvement: 'Quick polish.',
};

const PINCH_FALLBACK = 'Quick nudge.';

/** A safety/risk overlay takes priority so the label reflects the real concern. */
const PINCH_BY_OVERLAY: ReadonlyArray<{ overlay: PromptEnhancementCapabilityId; text: string }> = [
  { overlay: 'capability.risk_or_rollback', text: 'Careful — rollback risk.' },
  { overlay: 'capability.confirmation_needed', text: 'Worth a confirm.' },
];

/** Build the deterministic pinch label: overlay-driven first, else family, else fallback. */
export function buildPromptEnhancementPinchLabelV1(input: {
  familyId: PromptEnhancementFamilyId;
  capabilityOverlays: readonly PromptEnhancementCapabilityId[];
}): PromptEnhancementPinchLabelV1 {
  const overlaid = PINCH_BY_OVERLAY.find((entry) => input.capabilityOverlays.includes(entry.overlay));
  if (overlaid) return { text: overlaid.text, derivedFrom: 'overlay' };
  const byFamily = PINCH_BY_FAMILY[input.familyId];
  if (byFamily) return { text: byFamily, derivedFrom: 'family' };
  return { text: PINCH_FALLBACK, derivedFrom: 'fallback' };
}

/** Short, source-backed why-help copy keyed on the reason. */
const WHY_HELP_BY_REASON: Readonly<Record<PromptEnhancementWhyHelpV1['reasonKind'], string>> = {
  sensitive_action: 'Shown because this touches a sensitive action — ask for go-ahead before doing it.',
  risk_or_rollback: 'Shown because this looks risky to roll back — plan the undo path first.',
  confirmation_needed: 'Shown because this could act on real state — confirm before it runs.',
};

/**
 * Build the why-help ONLY when a real reason exists (sensitive action > rollback
 * risk > confirmation). Returns undefined when there is no reason, so the header
 * stays clean and the why-help keeps its value for when it matters.
 */
export function buildPromptEnhancementWhyHelpV1(input: {
  capabilityOverlays: readonly PromptEnhancementCapabilityId[];
  hasSensitiveAction: boolean;
}): PromptEnhancementWhyHelpV1 | undefined {
  if (input.hasSensitiveAction) {
    return { text: WHY_HELP_BY_REASON.sensitive_action, reasonKind: 'sensitive_action' };
  }
  if (input.capabilityOverlays.includes('capability.risk_or_rollback')) {
    return { text: WHY_HELP_BY_REASON.risk_or_rollback, reasonKind: 'risk_or_rollback' };
  }
  if (input.capabilityOverlays.includes('capability.confirmation_needed')) {
    return { text: WHY_HELP_BY_REASON.confirmation_needed, reasonKind: 'confirmation_needed' };
  }
  return undefined;
}
