/**
 * Bug 2 — why-desc delivery to the agent.
 *
 * On selection the decision session currently sends only the option text to the agent; the
 * why-desc (CA-bound) is shown in the popup but never delivered. This module combines the
 * selected option with its rendered why-desc into the prompt the agent receives.
 *
 * GATED OFF by default: user-voiced why-descs must not reach the agent until the voice pass
 * (Phases 3–16) is complete. `WHYDESC_DELIVERY_ENABLED` is the default gate; Phase 2.2 replaces
 * it with a real config flag. The combine is a pure function so it can be unit-tested with the
 * gate injected.
 */

/**
 * Default delivery gate. OFF until the why-desc voice rewrite is done — flipping this ON while
 * cells are still user-voiced would ship worse text to the agent than today. Phase 2.2 makes
 * this a config/env flag; Phase 17 flips it ON after the voice pass.
 */
export const WHYDESC_DELIVERY_ENABLED = false;

/**
 * Combine the selected option (the prompt) with its rendered why-desc into one message for the
 * agent. Plain format (Decision 1 — sign-off): option, a blank line, then the why-desc; no
 * label. An empty/whitespace-only why-desc yields the option unchanged.
 */
export function combineOptionWithWhyDesc(option: string, whyDesc: string | undefined): string {
  const w = (whyDesc ?? '').trim();
  return w ? `${option}\n\n${w}` : option;
}

/**
 * The prompt to deliver on selection: the combined option + why-desc when delivery is enabled,
 * otherwise the option alone (current behaviour). `enabled` is injectable for testing; it
 * defaults to the module gate.
 */
export function deliverSelectedPrompt(
  option: string,
  whyDesc: string | undefined,
  enabled: boolean = WHYDESC_DELIVERY_ENABLED,
): string {
  return enabled ? combineOptionWithWhyDesc(option, whyDesc) : option;
}
