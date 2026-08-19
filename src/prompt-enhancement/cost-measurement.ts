import type { PromptEnhancementPrepareResultV1 } from './contracts.js';
import type { PromptEnhancementGuidanceFact } from './templates/section-plan.js';
import {
  sanitizePromptEnhancementCostMeasurementV1,
  buildPromptEnhancementCostRuntimeFlowEvidenceV1,
  promptEnhancementCostWeakeningReasonCodesV1,
  validatePromptEnhancementCostInventoryV1,
  type PromptEnhancementCostMeasurementInputV1,
  type PromptEnhancementCostMeasurementRecordV1,
  type PromptEnhancementCostRuntimeFlowEvidencePacketV1,
} from './cost-observability.js';

/**
 * E9 — cost measurement / observability wiring (P12-G1 + P12-G2).
 *
 * The cost VISIBILITY was wired live; the MEASUREMENT functions had zero callers — so
 * cost was never measured/aggregated and the gate-rule-4 "no cost-based weakening" check
 * never ran. This builds the observability off the prepare result's REAL visibility
 * (P12-G2: `callVisibilityMode` / planned / used counts come from the composer, not the
 * hardcoded request placeholder), calling all four measurement functions.
 *
 * Cost is OBSERVABILITY-ONLY (gate-rule-4 / `costVisibilityCanWeakenBehavior:false`): no
 * runtime path in E4-E8 weakens behavior because of cost, so every "becauseOfCost"
 * flag is false and the weakening check must return []. The sanitizer excludes every
 * raw field — no raw prompt/generated/source text enters cost logs.
 */
export interface PromptEnhancementCostObservabilityV1 {
  measurement: PromptEnhancementCostMeasurementRecordV1;
  /** Raw output of the gate-rule-4 weakening check. A clean run is the single sentinel below. */
  weakeningReasonCodes: readonly string[];
  /** True only if a REAL cost-based weakening reason is present (the sentinel is not one). */
  costWeakeningDetected: boolean;
  flowEvidence: PromptEnhancementCostRuntimeFlowEvidencePacketV1;
  inventoryOk: boolean;
}

/**
 * The weakening check returns this single code when nothing weakened behavior — it is a
 * POSITIVE "cost is not a runtime limiter" assertion, NOT a violation. So `[]` never
 * happens: a clean gate-rule-4 result is exactly `[COST_CLEAN_SENTINEL]`.
 */
const COST_CLEAN_SENTINEL = 'cost_visibility_is_not_runtime_limiter';

const NO_COST_WEAKENING = {
  disabledBecauseOfCost: false,
  deferredBecauseOfCost: false,
  frequencyGatedBecauseOfCost: false,
  deterministicDowngradeBecauseOfCost: false,
  promptShrunkBecauseOfCost: false,
  explicitUserActionOnlyBecauseOfCost: false,
} as const;

export function buildPromptEnhancementCostObservabilityV1(
  result: PromptEnhancementPrepareResultV1,
): PromptEnhancementCostObservabilityV1 {
  const visibility = result.callAndVisibilityMetadata;
  const status: PromptEnhancementCostMeasurementInputV1['status'] =
    visibility.callVisibilityMode === 'llm_wording'
      ? 'used'
      : visibility.callVisibilityMode === 'fallback_no_llm'
        ? 'fallback'
        : 'planned';

  const measurementInput: PromptEnhancementCostMeasurementInputV1 = {
    // callId is optional on the visibility metadata (a deterministic run makes no call);
    // the baseline composer id is the correct default for the "no LLM call" case.
    callId: visibility.callId ?? 'baseline_pe_composer',
    plannedCallCount: visibility.plannedCallCount,
    usedCallCount: visibility.usedCallCount,
    estimatedInputTokens: visibility.estimatedInputTokens,
    estimatedOutputTokens: visibility.estimatedOutputTokens,
    status,
    // No raw text is passed; the sanitizer marks every raw field excluded regardless.
  };

  const measurement = sanitizePromptEnhancementCostMeasurementV1(measurementInput);
  const weakeningReasonCodes = promptEnhancementCostWeakeningReasonCodesV1(NO_COST_WEAKENING);
  const costWeakeningDetected = weakeningReasonCodes.some((code) => code !== COST_CLEAN_SENTINEL);
  const flowEvidence = buildPromptEnhancementCostRuntimeFlowEvidenceV1({
    evidenceId: `${result.enhancementId}:cost-flow`,
    enhancementId: result.enhancementId,
    requestId: result.requestId,
    callVisibilityMetadata: visibility,
    measurementInputs: [measurementInput],
    observedSurfaces: ['prompt_start_prepare', 'enhancement_popup', 'stop_or_extension_delivery'],
    weakeningCheck: NO_COST_WEAKENING,
  });
  const inventoryOk = validatePromptEnhancementCostInventoryV1().ok;

  return { measurement, weakeningReasonCodes, costWeakeningDetected, flowEvidence, inventoryOk };
}

/** The runtime surface a measured result was produced at (§4a flow: prepare -> popup action). */
export type PromptEnhancementCostObservabilitySurfaceV1 = 'prepare' | 'popup_action';

/** Logger-shaped emit target; injected so this module stays pure (never imports the CLI logger). */
export interface PromptEnhancementCostObservabilitySinkV1 {
  debug: (event: string, data?: Record<string, unknown>) => void;
  warn: (event: string, data?: Record<string, unknown>) => void;
}

/**
 * Measure a produced result's cost and emit it through the injected logger-shaped sink.
 * Called at EVERY runtime point a real result is produced: prepare (E4/E6, `auto.ts`) and
 * the interactive popup directional/apply-details action (E8, the popup host loop) — so a
 * repeated "Shorter" click is measured, not silently uncounted. Observability-only; the raw
 * fields are excluded and the gate-rule-4 weakening check runs (warns only if it ever trips).
 */
/**
 * A6 (prohibition 10 · L4970 · L4979): the RUNTIME-SEAM and PAYLOAD-WEIGHT summary call-visibility needs.
 *
 * Prohibition 10 is two claims, not one — *"every runtime path typed **+ call-visibility visible**"* — and
 * A6 delivered only the typing. L4979 likewise names its own purpose as *"call-visibility call/token
 * visibility"*, which cannot happen if the weight never reaches the visibility surface. This
 * aggregates both from the facts the body actually rendered.
 *
 * ⛔ Counts and typed path names ONLY — no evidence text, no ids, no fact content. And it feeds a
 * LOG, never a decision: prohibition 9 forbids cost suppressing, deferring, gating or shrinking
 * accepted behaviour, so nothing here may be read back into the pipeline.
 */
export function summarisePromptEnhancementRuntimeSeamsV1(
  facts: readonly PromptEnhancementGuidanceFact[],
): { runtimePaths: readonly string[]; unknownRuntimePathCount: number; totalPayloadWeight: number } {
  const paths = new Set<string>();
  let unknown = 0;
  let weight = 0;
  for (const fact of facts) {
    const path = fact.sourceRuntimePath ?? 'unstamped';
    paths.add(path);
    if (path === 'unknown') unknown += 1;
    weight += fact.payloadWeight ?? 0;
  }
  return {
    runtimePaths: [...paths].sort(),
    unknownRuntimePathCount: unknown,
    totalPayloadWeight: weight,
  };
}

export function emitPromptEnhancementCostObservabilityV1(
  result: PromptEnhancementPrepareResultV1,
  surface: PromptEnhancementCostObservabilitySurfaceV1,
  sink: PromptEnhancementCostObservabilitySinkV1,
  /**
   * A6: the runtime-seam / payload-weight summary, from the caller that holds the mixed
   * facts. Optional so every existing call site keeps working unchanged.
   */
  runtimeSeams?: ReturnType<typeof summarisePromptEnhancementRuntimeSeamsV1>,
): PromptEnhancementCostObservabilityV1 | undefined {
  // Observability-only: measuring/logging cost must NEVER break the runtime path it rides on
  // (prepare pipeline or the interactive popup), so any failure — including a throwing logger —
  // is swallowed and returns undefined rather than propagating.
  try {
    const observability = buildPromptEnhancementCostObservabilityV1(result);
    sink.debug('prompt_enhancement_cost_measurement', {
      surface,
      callId: observability.measurement.callId,
      callVisibilityMode: result.callAndVisibilityMetadata.callVisibilityMode,
      status: observability.measurement.status,
      plannedCallCount: observability.measurement.plannedCallCount,
      usedCallCount: observability.measurement.usedCallCount,
      // TI-2 (2026-08-07): a provider failure used to be byte-identical to "never eligible" in
      // this line. These two typed-enum fields (already on the metadata, never body text) make a
      // timeout log as `fallback_no_llm / fallbackReason "timeout_no_send" / providerFailureState
      // "timeout"` — distinguishable from "no key" and from "not eligible".
      fallbackReason: result.callAndVisibilityMetadata.fallbackReason,
      providerFailureState: result.callAndVisibilityMetadata.providerFailureState,
      // TI-3.3 (2026-08-08): a blocked LLM body that was silently swapped for a deterministic one
      // used to log byte-identical to a clean run (the emitted safetySummary describes the
      // replacement). These two reporting-only fields make "body blocked & replaced" distinct:
      // `deterministicFallbackApplied true` + `preSubstitutionAuthorityEscalationState` = the
      // verdict the replaced body carried. `false`/undefined on every non-substituted run.
      deterministicFallbackApplied: result.deterministicFallbackApplied ?? false,
      preSubstitutionAuthorityEscalationState: result.preSubstitutionAuthorityEscalationState,
      // TI-3.2 (2026-08-08): the compose-layer fallback reason codes the public diagnostics array
      // genericizes away — names WHY the body was reduced (one of six draft-rejection causes +
      // the substitution marker), not just that it was. Empty when no compose-layer fallback
      // occurred. Typed reason codes only, never body text.
      compositionFallbackReasonCodes: result.compositionFallbackReasonCodes ?? [],
      // A6 (prohibition 10 + L4979): the runtime seams the body's facts came through, and the
      // relative payload weight they carried — the call-visibility visibility half of "every runtime
      // path typed AND visible". `unknownRuntimePathCount` is the one that matters: a body
      // built through a path nobody declared is exactly the hidden seam the lock forbids.
      // ⛔ Typed names and counts only, and read by nothing in the pipeline (prohibition 9).
      // Supplied by the caller, which is the layer holding the mix — the RESULT carries fact
      // IDS only, never the facts, so deriving this from it would have logged an empty
      // summary forever while looking correct. Verified against the contract before wiring.
      ...(runtimeSeams ?? result.callAndVisibilityMetadata.runtimeSeamSummary ?? {}),
      // TI-3 audit follow-up (2026-08-09): whether the user's additional-details input hit the
      // 5,000-word cap and was truncated. A `generated` input-cap event (not a fallback), surfaced
      // as its own flag so "was the input truncated?" is answerable from the log. Never body text.
      additionalDetailsTruncated: result.additionalDetailsTruncated ?? false,
      rawFieldsExcluded: observability.measurement.rawPromptBodyExcluded,
      inventoryOk: observability.inventoryOk,
    });
    if (observability.costWeakeningDetected) {
      // gate-rule-4 invariant: unreachable in v1 (cost is never a gate); surface it loudly if it fires.
      sink.warn('prompt_enhancement_cost_weakening_detected', {
        surface,
        reasonCodes: [...observability.weakeningReasonCodes],
      });
    }
    return observability;
  } catch {
    return undefined;
  }
}
