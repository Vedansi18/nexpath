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
