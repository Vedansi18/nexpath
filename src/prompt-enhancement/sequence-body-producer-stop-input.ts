import { redactSecrets } from '../store/redact.js';
import type { PromptEnhancementPrepareResultV1 } from './contracts.js';
import type {
  PromptEnhancementSequenceItemV1,
  PromptEnhancementSequenceOffsetRangeV1,
} from './sequence-payload.js';
import type { PromptEnhancementSequenceBodyProducerInputV1 } from './sequence-body-producer-runtime.js';

/**
 * MPS P1b-ii (step 8b-2) — assemble the background wording batch's input at the Stop hook.
 *
 * The batch (`runPromptEnhancementSequenceBodyProducerV1`) runs in the Stop-hook process while the MPS
 * first popup is open, but every piece it needs was produced at UserPromptSubmit and reaches the Stop
 * hook only through the stored pending PE (`pending.result` + the carried `plannerItems` /
 * `plannerPromptDirectives`). This maps those pieces onto the runtime input, fail-closed: if the item
 * list is absent (non-sequence, or a corrupt carrier that read back undefined) there is nothing to word
 * and the caller must not run the batch.
 *
 * NOTE the batch STARTS when the popup opens (so it is finished by the time the user sends — §4.13),
 * NOT on send — so item 0's body is the COMPOSED first body the popup displays
 * (`result.currentBody.text`, see first-popup.ts), never the possibly-edited sent body, which is not
 * known yet at start.
 *
 * ⚠️ PRIVACY: the batch composer sends `localOriginalText`, its slices, `firstBodyText`, and the
 * directive strings to the LLM provider RAW — it performs NO redaction of its own (unlike the Phase-7
 * planner, which split off a redacted context). So this assembler redacts here, with the
 * length-preserving `redactSecrets`, so (a) the planner offsets still index the same character
 * positions and (b) no unredacted user text reaches the provider. This mirrors `sequence-intake.ts`,
 * which redacts the same `currentBody.originalPromptText`.
 */
export interface AssemblePromptEnhancementSequenceBodyProducerArgsV1 {
  result: PromptEnhancementPrepareResultV1;
  /** The carried planner item list (item 0 first); undefined ⇒ no sequence ⇒ no batch. */
  plannerItems?: readonly PromptEnhancementSequenceItemV1[];
  /** The carried whole-prompt directive ranges; undefined/absent is treated as "no directives". */
  plannerPromptDirectives?: readonly PromptEnhancementSequenceOffsetRangeV1[];
}

export type AssemblePromptEnhancementSequenceBodyProducerResultV1 =
  | { ok: true; input: PromptEnhancementSequenceBodyProducerInputV1 }
  | { ok: false; reason: 'no_planner_items' | 'no_handoff' | 'no_original' };

export function assemblePromptEnhancementSequenceBodyProducerInputV1(
  args: AssemblePromptEnhancementSequenceBodyProducerArgsV1,
): AssemblePromptEnhancementSequenceBodyProducerResultV1 {
  const { result, plannerItems, plannerPromptDirectives } = args;

  // The batch words items 2…N from the planner's list; a non-sequence prepare or a corrupt carrier
  // (which read back undefined, fail-open) leaves nothing to word.
  if (!plannerItems || plannerItems.length === 0) return { ok: false, reason: 'no_planner_items' };

  // planGenerationId has no dedicated field; the handoff decision id is the same id the sequence row
  // is keyed on (sequence-intake.ts) and the packager builds item ids from — so the batch's verdict
  // ids line up with what the continuation later emits.
  const handoff = result.uiView.handoffAndSequenceSummary;
  if (!handoff) return { ok: false, reason: 'no_handoff' };
  const planGenerationId = handoff.handoffDecisionId;

  // The offset base the planner ranges index — NOT request.sourcePrompt.text (which may differ).
  const originalText = result.currentBody.originalPromptText;
  if (originalText.length === 0) return { ok: false, reason: 'no_original' };

  // Redact ONCE, length-preserving, so offsets still resolve to the same characters.
  const redactedOriginal = redactSecrets(originalText);

  // Resolve the directive ranges to text against the REDACTED original (never the raw text).
  const promptDirectives = (plannerPromptDirectives ?? []).map(
    (range) => redactedOriginal.slice(range.start, range.end),
  );

  return {
    ok: true,
    input: {
      plannerItems,
      planGenerationId,
      // Item 0's composed body (what the popup shows) is the batch's context, redacted before it can
      // reach the provider. The batch starts at popup-open, so the sent/edited body is not known yet.
      firstBodyText: redactSecrets(result.currentBody.text),
      promptDirectives,
      localOriginalText: redactedOriginal,
      baseSafetySummary: result.safetySummary,
      providerRuntimeState: result.validationGraph.providerRuntimeState,
      optionalCallAvailabilityState: result.validationGraph.optionalCallAvailabilityState,
      // Match the packager's inline `${sequenceId}:item:${order}` scheme (continuation-packager-input.ts).
      sequenceItemIdFor: (order) => `${planGenerationId}:item:${order}`,
    },
  };
}
