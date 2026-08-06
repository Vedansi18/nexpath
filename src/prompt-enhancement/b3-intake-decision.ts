import {
  buildPromptEnhancementB3ContractIntakePacketV1,
  type PromptEnhancementB3ContractIntakeInputV1,
  type PromptEnhancementB3ContractIntakePacketV1,
} from './b3-contract-intake.js';

// ---------------------------------------------------------------------------
// UI-5 — MPS typed-runtime intake gate (ui-owner consumer).
//
// Dev-plan scope (alignment plan §290-302, phase table "Gate evaluation only —
// ui-owner consumes"): this is the ONLY ui-owner-owned step of UI-5. It consumes
// the already-locked B3.6 contract-intake packet and turns it into a single
// typed render-permission decision that a CLI MPS surface (UI-6/UI-7) must check
// before rendering the first/continuation projections.
//
// It fails closed by default and invents NO local queue, pointer, Stop
// correlation, terminality, delivery, or host transport (§301-302). Render is
// permitted ONLY when every external evidence packet is supplied and the intake
// packet reaches `ready_for_review`; otherwise the MPS surface stays blocked.
// ---------------------------------------------------------------------------

export type PromptEnhancementMpsIntakeRenderPermissionV1 =
  | 'mps_render_permitted'
  | 'mps_blocked_fail_closed';

export interface PromptEnhancementMpsIntakeDecisionV1 {
  surface: 'prompt_enhancement_mps_intake_gate';
  renderPermission: PromptEnhancementMpsIntakeRenderPermissionV1;
  intakePacket: PromptEnhancementB3ContractIntakePacketV1;
  reasonCodes: readonly string[];
  authority: {
    createsLocalQueue: false;
    createsPointer: false;
    createsStopCorrelation: false;
    createsTerminality: false;
    createsDelivery: false;
    createsHostTransport: false;
  };
}

/**
 * Evaluate the MPS typed-runtime intake gate. Render is permitted only when the
 * consumed contract-intake packet is `ready_for_review`; every other state
 * (missing/stale/contradictory/unknown evidence, or a malformed supplied row)
 * keeps the MPS surface blocked and fail-closed, carrying the packet's own
 * reason codes for diagnostics.
 */
export function evaluatePromptEnhancementMpsIntakeDecisionV1(
  input: PromptEnhancementB3ContractIntakeInputV1 = {},
): PromptEnhancementMpsIntakeDecisionV1 {
  const intakePacket = buildPromptEnhancementB3ContractIntakePacketV1(input);
  const permitted = intakePacket.status === 'ready_for_review';
  return {
    surface: 'prompt_enhancement_mps_intake_gate',
    renderPermission: permitted ? 'mps_render_permitted' : 'mps_blocked_fail_closed',
    intakePacket,
    reasonCodes: permitted ? [] : ['mps_render_blocked_pending_intake', ...intakePacket.reasonCodes],
    authority: {
      createsLocalQueue: false,
      createsPointer: false,
      createsStopCorrelation: false,
      createsTerminality: false,
      createsDelivery: false,
      createsHostTransport: false,
    },
  };
}
