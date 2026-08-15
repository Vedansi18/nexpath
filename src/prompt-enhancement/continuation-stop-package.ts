import {
  assembleContinuationPackagerInputV1,
  CONTINUATION_HANDOFF_KINDS_V1,
  type ContinuationHandoffKindV1,
} from './continuation-packager-input.js';
import {
  prepareSequenceContinuationOfferV1,
  packageSequenceContinuationOfferV1,
} from './sequence-continuation-delivery.js';
import type {
  PromptEnhancementSequencePackagedContinuationV1,
  PromptEnhancementSequencePackagerRefusalV1,
} from './sequence-packager.js';
import type { PromptEnhancementSequenceItemV1 } from './sequence-payload.js';
import type {
  PromptEnhancementSequenceRuntimeStateV1,
  PromptEnhancementSequenceRuntimeReasonCodeV1,
} from './sequence-runtime.js';

/**
 * MPS continuation shell — P2 (offer + package).
 *
 * The active sequence row's runtime state + the content it carries, mapped structurally so this PE
 * module does not import the store — stop.ts maps the row onto it. The two continuation side fields are
 * nullable exactly as the row stores them; a null is a fail-closed skip.
 */
export interface ContinuationStopPackageInputV1 {
  /** The active row's runtime state (ids/counts/index/status) — drives the offer decision. */
  state:                      PromptEnhancementSequenceRuntimeStateV1;
  /** The action id for THIS continuation Stop — idempotency for the advance the offer applies. */
  actionId:                   string;
  /** The stored worded item list (`row.payload.items`) — the batch wrote items 2…N on send (P1b-iii). */
  items:                      readonly PromptEnhancementSequenceItemV1[];
  redactedOriginalPromptText: string | null;
  handoffKind:                string | null;
}

export type ContinuationStopPackageResultV1 =
  | {
      ok: true;
      packaged: PromptEnhancementSequencePackagedContinuationV1;
      /** The advanced/re-offered runtime state — what P4 persists on send/keep/cancel. NOT persisted here. */
      offeredState: PromptEnhancementSequenceRuntimeStateV1;
      /** True when the offer advanced to a new item (awaiting_response); false when re-offering a pending one. */
      advanced: boolean;
    }
  | { ok: false; reason: 'no_stored_items' | 'no_redacted_original' | 'handoff_not_continuable' }
  | { ok: false; reason: 'sequence_complete'; terminalState: PromptEnhancementSequenceRuntimeStateV1 }
  | { ok: false; reason: 'no_offer'; reasonCode: PromptEnhancementSequenceRuntimeReasonCodeV1 | 'not_offerable_status' }
  | { ok: false; reason: 'packager_refused'; refusal: PromptEnhancementSequencePackagerRefusalV1 };

function isContinuationHandoffKindV1(kind: string | null): kind is ContinuationHandoffKindV1 {
  return kind !== null && (CONTINUATION_HANDOFF_KINDS_V1 as readonly string[]).includes(kind);
}

/**
 * At a continuation Stop, decide which item to offer and package it — its own wording, verdict,
 * itemKind, and original slice — ready for the popup (P3) to render.
 *
 * The OFFER step is essential and comes first: an `awaiting_response` row ADVANCES to the next item
 * (the just-sent item 0 must not be re-served — the packager refuses index 0), and an `item_pending`
 * row RE-OFFERS the same item (a prior interruption/decline left it pending). The offered index — not
 * the row's stored index — is what the packager serves. The advanced/re-offered state is RETURNED for
 * P4 to persist; nothing is persisted or rendered here.
 *
 * Fail-closed: the row must carry worded items (the batch stored them on send — P1b-iii), the redacted
 * length-preserving original (the packager slices the item's own region out of it — MPS-12), and a
 * continuable handoff kind; a sequence with no items left to offer completes; the packager's own
 * refusals surface as `packager_refused`. Any of these is a typed result, never a throw.
 */
export function packageContinuationAtStopV1(
  input: ContinuationStopPackageInputV1,
): ContinuationStopPackageResultV1 {
  // Content prerequisites first — independent of the offer decision.
  if (input.items.length === 0) return { ok: false, reason: 'no_stored_items' };
  if (input.redactedOriginalPromptText === null) return { ok: false, reason: 'no_redacted_original' };
  if (!isContinuationHandoffKindV1(input.handoffKind)) return { ok: false, reason: 'handoff_not_continuable' };

  // Offer: advance (awaiting_response) or re-offer (item_pending). The offered index is what we serve.
  const offer = prepareSequenceContinuationOfferV1(input.state, input.actionId);
  if (offer.state === 'sequence_complete') return { ok: false, reason: 'sequence_complete', terminalState: offer.terminalState };
  if (offer.state === 'no_offer') return { ok: false, reason: 'no_offer', reasonCode: offer.reasonCode };

  const packaged = packageSequenceContinuationOfferV1(
    assembleContinuationPackagerInputV1({
      items:                      input.items,
      currentItemIndex:           offer.itemIndex,
      itemCount:                  input.state.itemCount,
      sequenceId:                 input.state.sequenceId,
      enhancementId:              input.state.enhancementId,
      projectRoot:                input.state.projectRoot,
      redactedOriginalPromptText: input.redactedOriginalPromptText,
      handoffKind:                input.handoffKind,
    }),
  );
  if (packaged.kind === 'no_popup') return { ok: false, reason: 'packager_refused', refusal: packaged.refusal };
  return { ok: true, packaged: packaged.packaged, offeredState: offer.offeredState, advanced: offer.advanced };
}
