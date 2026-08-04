import { describe, expect, it } from 'vitest';
import { buildPromptEnhancementValidatedConfigDisplayModelV1 } from './validated-config-display.js';

const typed = (state: string, freshness = 'current') => ({
  state,
  freshness,
  arbitraryConfigRowsAreAuthority: false,
  legacyDecisionSessionConfigIsAuthority: false,
});

describe('B4.1 validated configuration display boundary', () => {
  it('keeps every supplied typed state distinct and non-interactive', () => {
    for (const state of ['enabled', 'disabled', 'unavailable', 'unsupported', 'policy_disabled', 'fallback']) {
      const model = buildPromptEnhancementValidatedConfigDisplayModelV1({ configResult: typed(state) });
      expect(model.status).toBe(state);
      expect(model.interactive).toBe(false);
      expect(model.configAuthority).toBe('typed_validated_hiren_cli_result_only');
    }
  });

  it('fails closed for missing, malformed, unknown, and stale input', () => {
    expect(buildPromptEnhancementValidatedConfigDisplayModelV1({ configResult: undefined }).status).toBe('unavailable');
    expect(buildPromptEnhancementValidatedConfigDisplayModelV1({ configResult: typed('new_state') }).status).toBe('unavailable');
    expect(buildPromptEnhancementValidatedConfigDisplayModelV1({ configResult: typed('enabled', 'stale') }).status).toBe('fallback');
    expect(buildPromptEnhancementValidatedConfigDisplayModelV1({ configResult: typed('enabled'), freshness: 'stale' }).status).toBe('fallback');
    expect(buildPromptEnhancementValidatedConfigDisplayModelV1({ configResult: typed('enabled'), freshness: 'unknown' }).status).toBe('unavailable');
  });

  it('rejects arbitrary config rows and old Decision Session authority', () => {
    const arbitrary = buildPromptEnhancementValidatedConfigDisplayModelV1({
      configResult: { ...typed('enabled'), arbitraryConfigRowsAreAuthority: true },
    });
    const legacy = buildPromptEnhancementValidatedConfigDisplayModelV1({
      configResult: { ...typed('enabled'), legacyDecisionSessionConfigIsAuthority: true },
    });
    expect(arbitrary.status).toBe('unavailable');
    expect(legacy.status).toBe('unavailable');
  });

  it('excludes config/storage/provider details and makes no local claims', () => {
    const model = buildPromptEnhancementValidatedConfigDisplayModelV1({ configResult: typed('enabled') });
    expect(model.claims.defaultChosen).toBe(false);
    expect(model.claims.persisted).toBe(false);
    expect(model.claims.valueValidatedLocally).toBe(false);
    expect(model.claims.availabilityInferredLocally).toBe(false);
    expect(model.claims.legacyDecisionSessionAuthority).toBe(false);
    expect(model.privacy.rawConfigExcluded).toBe(true);
    expect(model.privacy.privatePathsExcluded).toBe(true);
    expect(JSON.stringify(model)).not.toContain('prompt_enhancement.sequence.enabled');
    expect(JSON.stringify(model)).not.toContain('/home/');

    const policy = buildPromptEnhancementValidatedConfigDisplayModelV1({ configResult: typed('policy_disabled') });
    expect(policy.reasonCodes).toEqual(['configuration_policy_restricted']);
  });
});

