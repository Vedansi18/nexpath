import { describe, expect, it } from 'vitest';
import { buildPromptEnhancementOnboardingTrustCopyModelV1 } from './onboarding-trust-copy.js';

const copy = (state: string, actionLabel: string | null = null) => ({
  state,
  heading: `Prompt Enhancement: ${state}`,
  body: `Prompt Enhancement is shown in the ${state} state.`,
  privacyNotice: 'Only approved public-safe information is shown.',
  actionLabel,
});

describe('B4.2 onboarding and trust-copy boundary', () => {
  it('renders each supplied typed state with no interactive or product claims', () => {
    for (const state of ['enabled', 'disabled', 'unavailable', 'unsupported', 'policy_disabled', 'fallback']) {
      const model = buildPromptEnhancementOnboardingTrustCopyModelV1({ configState: state, approvedCopy: copy(state) });
      expect(model.state).toBe(state);
      expect(model.interactive).toBe(false);
      expect(model.actionLabel).toBeNull();
      expect(model.copyAuthority).toBe('supplied_hiren_approved_public_copy_only');
      expect(model.claims.installed).toBe(false);
      expect(model.claims.sent).toBe(false);
    }
  });

  it('fails closed for missing, malformed, mismatched, and unsafe copy', () => {
    expect(buildPromptEnhancementOnboardingTrustCopyModelV1({ configState: undefined, approvedCopy: undefined }).reasonCodes).toEqual(['invalid_or_missing_typed_copy']);
    expect(buildPromptEnhancementOnboardingTrustCopyModelV1({ configState: 'enabled', approvedCopy: copy('disabled') }).reasonCodes).toEqual(['copy_state_mismatch']);
    expect(buildPromptEnhancementOnboardingTrustCopyModelV1({ configState: 'enabled', approvedCopy: { ...copy('enabled'), body: 'Prompt Enhancement uses /home/private/config.' } }).reasonCodes).toEqual(['unsafe_public_copy_rejected']);
    expect(buildPromptEnhancementOnboardingTrustCopyModelV1({ configState: 'enabled', approvedCopy: { ...copy('enabled'), body: 'Decision Session advisory frequency controls Prompt Enhancement.' } }).reasonCodes).toEqual(['unsafe_public_copy_rejected']);
  });

  it('does not expose an unavailable action for disabled, unsupported, or fallback states', () => {
    for (const state of ['disabled', 'unsupported', 'policy_disabled', 'fallback']) {
      const model = buildPromptEnhancementOnboardingTrustCopyModelV1({ configState: state, approvedCopy: copy(state, 'Enable') });
      expect(model.state).toBe('unavailable');
      expect(model.actionLabel).toBeNull();
      expect(model.interactive).toBe(false);
      expect(model.reasonCodes).toEqual(['unavailable_action_rejected']);
    }
  });

  it('keeps privacy, legacy, telemetry, and product-meaning claims excluded', () => {
    const model = buildPromptEnhancementOnboardingTrustCopyModelV1({ configState: 'enabled', approvedCopy: copy('enabled') });
    expect(model.privacy.rawConfigExcluded).toBe(true);
    expect(model.privacy.privatePathsExcluded).toBe(true);
    expect(model.privacy.providerErrorsExcluded).toBe(true);
    expect(model.privacy.legacyDecisionSessionTermsExcluded).toBe(true);
    expect(model.claims.private).toBe(false);
    expect(model.claims.localOnly).toBe(false);
    expect(model.claims.telemetryMeaning).toBe(false);
    expect(JSON.stringify(model)).not.toContain('Decision Session');
    expect(JSON.stringify(model)).not.toContain('/home/');
  });
});

