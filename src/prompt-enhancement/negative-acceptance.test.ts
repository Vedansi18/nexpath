import { describe, expect, it, beforeEach } from 'vitest';
import { openStore, type Store } from '../store/db.js';
import {
  resolvePromptEnhancementPromptSubmitOrigin,
  validatePromptEnhancementExtensionDeliveryPayload,
  type PromptEnhancementPromptSubmitOriginEvidenceV1,
} from './delivery.js';

/**
 * R2 §4b — b5-2 negative-acceptance fixtures for the ui-owner/content-owner-owned rows.
 *
 * Each row proves an INVALID / old-source input creates NO_SIDE_EFFECTS (no PE popup activation, no
 * send/delivery, no sequence, no feedback, no generated-origin, no launch-readiness) — i.e. it holds
 * NO authority. The wired typed contracts are the oracle:
 *  - `resolvePromptEnhancementPromptSubmitOrigin`: any evidence that is not `typed_generated_origin`
 *    returns untrusted → treated as a normal prompt, never as a PE-generated origin.
 *  - `validatePromptEnhancementExtensionDeliveryPayload`: legacy-DS / raw-transport keys are rejected,
 *    so the extension never delivers them.
 *
 * The 4 host-owner-owned rows (B5.2-04/06/08/09 — raw_stop_reason, clipboard_text, extension_labels,
 * missing_host_capability) are handed off (see the R2 host-owner handoff), as they exercise the
 * extension host path.
 */
const PROJECT = '/tmp/b5-2';

function evidence(evidenceKind: PromptEnhancementPromptSubmitOriginEvidenceV1['evidenceKind']): PromptEnhancementPromptSubmitOriginEvidenceV1 {
  return { evidenceKind, projectRoot: PROJECT };
}

/** A non-typed-origin evidence must hold NO PE authority (fail-safe: normal processing preserved). */
function expectNoAuthority(store: Store, evidenceKind: PromptEnhancementPromptSubmitOriginEvidenceV1['evidenceKind']): void {
  const resolution = resolvePromptEnhancementPromptSubmitOrigin(store, evidence(evidenceKind));
  expect(resolution.generatedOriginTrusted).toBe(false);           // no_generated_origin_creation / no PE activation
  expect(resolution.rawTransportIsSemanticAuthority).toBe(false);  // no raw-transport authority
  expect(resolution.lastInjectedPromptIsAuthority).toBe(false);    // no prior-injection authority
  expect(resolution.normalUserPromptFullProcessingPreserved).toBe(true); // falls back to a normal prompt, no PE side effects
}

describe('R2 §4b — b5-2 negative acceptance (ui-owner/content-owner-owned rows)', () => {
  let store: Store;
  beforeEach(async () => { store = await openStore(':memory:'); });

  it('B5.2-01 old_decision_session_rows — old DS rows are not PE input (no authority)', () => {
    expectNoAuthority(store, 'old_ds_row');
    // And an old-DS-shaped extension payload is rejected outright (no delivery).
    expect(validatePromptEnhancementExtensionDeliveryPayload({ advisory: {}, options: [] }).ok).toBe(false);
  });

  it('B5.2-02 product_feedback — feedback cannot activate or explain PE (no authority)', () => {
    expectNoAuthority(store, 'product_feedback');
  });

  it('B5.2-03 prompt_history — history / served variants cannot activate PE (no authority)', () => {
    expectNoAuthority(store, 'prompt_history');
    expectNoAuthority(store, 'served_variant_row');
  });

  it('B5.2-05 selected_prompt — selectedPrompt cannot authorize PE (payload rejected)', () => {
    const rejected = validatePromptEnhancementExtensionDeliveryPayload({ selectedPrompt: 'x' });
    expect(rejected.ok).toBe(false);
    expect(rejected.reasonCodes).toContain('legacy_decision_session_payload_rejected');
    expect(validatePromptEnhancementExtensionDeliveryPayload({ selected_prompt: 'x' }).ok).toBe(false);
  });

  it('B5.2-07 last_injected_prompt — prior injection cannot create current PE origin (no authority)', () => {
    expectNoAuthority(store, 'last_injected_prompt_only');
    // The legacy lastInjectedPrompt key is also rejected as an extension payload.
    expect(validatePromptEnhancementExtensionDeliveryPayload({ lastInjectedPrompt: 'x' }).ok).toBe(false);
  });

  it('B5.2-10 missing_or_malformed_generated_origin — origin absence cannot become origin proof (no authority)', () => {
    expectNoAuthority(store, 'malformed_generated_origin');
    expectNoAuthority(store, 'missing');
  });

  it('the ONLY trusted authority is a real typed_generated_origin (control) — a missing one is not trusted', () => {
    // typed_generated_origin with no matching stored row → still not trusted (row missing), proving the
    // guard never grants authority without real generated-origin evidence in the store.
    const resolution = resolvePromptEnhancementPromptSubmitOrigin(store, {
      evidenceKind: 'typed_generated_origin', projectRoot: PROJECT, bodyId: 'body-x', bodyRevision: 1,
    });
    expect(resolution.generatedOriginTrusted).toBe(false);
    expect(resolution.reasonCodes).toContain('generated_origin_row_missing');
  });
});
