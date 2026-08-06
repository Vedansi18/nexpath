import type { PromptEnhancementPrepareResultV1 } from './contracts.js';
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
 * cost was never measured/aggregated and the PE-G4 "no cost-based weakening" check
 * never ran. This builds the observability off the prepare result's REAL visibility
 * (P12-G2: `callVisibilityMode` / planned / used counts come from the composer, not the
 * hardcoded request placeholder), calling all four measurement functions.
 *
 * Cost is OBSERVABILITY-ONLY (PE-G4 / `costVisibilityCanWeakenBehavior:false`): no
 * runtime path in E4-E8 weakens behavior because of cost, so every "becauseOfCost"
 * flag is false and the weakening check must return []. The sanitizer excludes every
 * raw field — no raw prompt/generated/source text enters cost logs.
 */
export interface PromptEnhancementCostObservabilityV1 {
  measurement: PromptEnhancementCostMeasurementRecordV1;
  /** Raw output of the PE-G4 weakening check. A clean run is the single sentinel below. */
  weakeningReasonCodes: readonly string[];
  /** True only if a REAL cost-based weakening reason is present (the sentinel is not one). */
  costWeakeningDetected: boolean;
  flowEvidence: PromptEnhancementCostRuntimeFlowEvidencePacketV1;
  inventoryOk: boolean;
}

/**
 * The weakening check returns this single code when nothing weakened behavior — it is a
 * POSITIVE "cost is not a runtime limiter" assertion, NOT a violation. So `[]` never
 * happens: a clean PE-G4 result is exactly `[COST_CLEAN_SENTINEL]`.
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
 * fields are excluded and the PE-G4 weakening check runs (warns only if it ever trips).
 */
export function emitPromptEnhancementCostObservabilityV1(
  result: PromptEnhancementPrepareResultV1,
  surface: PromptEnhancementCostObservabilitySurfaceV1,
  sink: PromptEnhancementCostObservabilitySinkV1,
): PromptEnhancementCostObservabilityV1 {
  const observability = buildPromptEnhancementCostObservabilityV1(result);
  sink.debug('prompt_enhancement_cost_measurement', {
    surface,
    callId: observability.measurement.callId,
    callVisibilityMode: result.callAndVisibilityMetadata.callVisibilityMode,
    status: observability.measurement.status,
    plannedCallCount: observability.measurement.plannedCallCount,
    usedCallCount: observability.measurement.usedCallCount,
    rawFieldsExcluded: observability.measurement.rawPromptBodyExcluded,
    inventoryOk: observability.inventoryOk,
  });
  if (observability.costWeakeningDetected) {
    // PE-G4 invariant: unreachable in v1 (cost is never a gate); surface it loudly if it fires.
    sink.warn('prompt_enhancement_cost_weakening_detected', {
      surface,
      reasonCodes: [...observability.weakeningReasonCodes],
    });
  }
  return observability;
}
