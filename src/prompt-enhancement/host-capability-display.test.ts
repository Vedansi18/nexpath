import { describe, expect, it } from 'vitest';
import { evaluatePromptEnhancementHostCapability, type PromptEnhancementHostCapabilityEvidenceState } from './delivery.js';
import { buildPromptEnhancementHostCapabilityDisplayModelV1 } from './host-capability-display.js';

describe('stage-2-4 typed host-capability display boundary', () => {
  it('keeps every typed capability/result label distinct and non-authoritative', () => {
    const cases: Array<[PromptEnhancementHostCapabilityEvidenceState, string]> = [
      ['direct_insert_success_text_only', 'inserted'],
      ['clipboard_manual_copy_source_precedent_only', 'manual_paste_required'],
      ['direct_insert_failure', 'failed'],
      ['host_unknown', 'unknown'],
      ['host_unsupported', 'unsupported'],
      ['claude_cli_stop_bridge_supported', 'waiting'],
      ['extension_typed_payload_supported', 'waiting'],
      ['foreground_unavailable', 'failed'],
      ['stale_capability_data', 'unknown'],
    ];

    for (const [evidenceState, expectedStatus] of cases) {
      const model = buildPromptEnhancementHostCapabilityDisplayModelV1({
        evaluation: evaluatePromptEnhancementHostCapability(evidenceState),
      });
      expect(model.status).toBe(expectedStatus);
      expect(model.claims.sent).toBe(false);
      expect(model.claims.execution).toBe(false);
      expect(model.claims.consent).toBe(false);
      expect(model.claims.completion).toBe(false);
      expect(model.claims.sequenceAdvancement).toBe(false);
      expect(model.claims.semanticAuthority).toBe(false);
      expect(model.requiresFreshExplicitUserAction).toBe(true);
    }
  });

  it('maps typed delivery evidence to copied, manual-paste, manual-submit, and waiting states', () => {
    const evaluation = evaluatePromptEnhancementHostCapability('extension_typed_payload_supported');
    expect(buildPromptEnhancementHostCapabilityDisplayModelV1({
      evaluation,
      deliveryEvidenceState: 'clipboard_only_manual_paste_required',
    }).status).toBe('copied');
    expect(buildPromptEnhancementHostCapabilityDisplayModelV1({
      evaluation,
      deliveryEvidenceState: 'clipboard_only_manual_paste_required',
    }).publicLabel).toContain('paste');
    expect(buildPromptEnhancementHostCapabilityDisplayModelV1({
      evaluation,
      deliveryEvidenceState: 'submit_unconfirmed_manual_user_action_required',
    }).status).toBe('manual_submit_required');
    expect(buildPromptEnhancementHostCapabilityDisplayModelV1({
      evaluation,
      deliveryEvidenceState: 'auto_paste_to_existing_chat_attempted',
    }).status).toBe('waiting');
  });

  it('fails closed for missing, malformed, stale, or mismatched capability data', () => {
    const missing = buildPromptEnhancementHostCapabilityDisplayModelV1({ evaluation: undefined });
    expect(missing.status).toBe('unknown');
    expect(missing.fallbackRequired).toBe(true);
    expect(missing.publicLabel).toContain('unknown');

    const malformed = buildPromptEnhancementHostCapabilityDisplayModelV1({ evaluation: { evidenceState: 'host_unknown' } });
    expect(malformed.status).toBe('unknown');
    expect(malformed.privacy.privatePathsExcluded).toBe(true);

    const evaluation = evaluatePromptEnhancementHostCapability('extension_typed_payload_supported');
    for (const resultFreshness of ['stale', 'mismatched', 'unknown'] as const) {
      const model = buildPromptEnhancementHostCapabilityDisplayModelV1({ evaluation, resultFreshness });
      expect(model.status).toBe('unknown');
      expect(model.claims.sent).toBe(false);
      expect(model.claims.execution).toBe(false);
      expect(model.reasonCodes[0]).toContain(resultFreshness);
    }
  });

  it('excludes transport/body/private data from the display model', () => {
    const model = buildPromptEnhancementHostCapabilityDisplayModelV1({
      evaluation: evaluatePromptEnhancementHostCapability('direct_insert_success_text_only'),
    });
    expect(model.privacy.rawPayloadExcluded).toBe(true);
    expect(model.privacy.promptAndBodyExcluded).toBe(true);
    expect(model.privacy.clipboardExcluded).toBe(true);
    expect(model.privacy.privatePathsExcluded).toBe(true);
    expect(model.privacy.internalReasonDetailsExcluded).toBe(true);
    expect(JSON.stringify(model)).not.toContain('/home/');
    expect(JSON.stringify(model)).not.toContain('rawStopReason');
  });
});
