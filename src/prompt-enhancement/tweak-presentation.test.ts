import { describe, expect, it } from 'vitest';
import { buildPromptEnhancementTweakPresentationModelV1 } from './tweak-presentation.js';

const typed = (state: string, freshness = 'current', contractRevision = 'pe-tweak-v1') => ({
  state,
  freshness,
  contractRevision,
  arbitraryConfigRowsAreAuthority: false,
  legacyDecisionSessionConfigIsAuthority: false,
});

describe('B4.3 CTRL+T Prompt Enhancement tweak presentation boundary', () => {
  it('keeps every supplied typed state distinct and non-interactive', () => {
    for (const state of ['enabled', 'disabled', 'policy_disabled', 'unavailable', 'unsupported', 'outside_v1', 'fallback']) {
      const model = buildPromptEnhancementTweakPresentationModelV1({ contract: typed(state) });
      expect(model.status).toBe(state);
      expect(model.surface).toBe('prompt_enhancement_ctrl_t');
      expect(model.shortcut).toBe('CTRL+T');
      expect(model.interactive).toBe(false);
      expect(model.action).toBeNull();
      expect(model.claims.runtimeToggleExposed).toBe(false);
    }
  });

  it('fails closed for missing, malformed, stale, and unknown-freshness input', () => {
    expect(buildPromptEnhancementTweakPresentationModelV1({ contract: undefined }).status).toBe('unavailable');
    expect(buildPromptEnhancementTweakPresentationModelV1({ contract: typed('new_state') }).status).toBe('unavailable');
    expect(buildPromptEnhancementTweakPresentationModelV1({ contract: typed('enabled', 'stale') }).status).toBe('fallback');
    expect(buildPromptEnhancementTweakPresentationModelV1({ contract: typed('enabled'), freshness: 'stale' }).status).toBe('fallback');
    expect(buildPromptEnhancementTweakPresentationModelV1({ contract: typed('enabled'), freshness: 'unknown' }).status).toBe('unavailable');
  });

  it('rejects arbitrary config and legacy Decision Session authority', () => {
    const arbitrary = buildPromptEnhancementTweakPresentationModelV1({
      contract: { ...typed('enabled'), arbitraryConfigRowsAreAuthority: true },
    });
    const legacy = buildPromptEnhancementTweakPresentationModelV1({
      contract: { ...typed('enabled'), legacyDecisionSessionConfigIsAuthority: true },
    });
    expect(arbitrary.status).toBe('unavailable');
    expect(legacy.status).toBe('unavailable');
  });

  it('does not let history, rating, selected prompt, clipboard, Stop, host, or labels control state', () => {
    const model = buildPromptEnhancementTweakPresentationModelV1({
      contract: {
        ...typed('enabled'),
        promptHistory: 'disabled',
        productRating: 'disabled',
        selectedPrompt: 'disabled',
        clipboard: 'disabled',
        rawStopReason: 'disabled',
        hostState: 'disabled',
        visibleLabel: 'disabled',
      },
    });
    expect(model.status).toBe('enabled');
    expect(Object.values(model.negatives).every((value) => value === false)).toBe(true);
    expect(model.publicLabel).not.toContain('disabled');
  });

  it('keeps the public surface distinct and free of legacy/internal wording', () => {
    const model = buildPromptEnhancementTweakPresentationModelV1({ contract: typed('enabled') });
    expect(model.title).toBe('Prompt Enhancement settings');
    expect(model.publicLabel).toContain('Prompt Enhancement');
    expect(JSON.stringify(model)).not.toMatch(/Decision Session|frequency|advisory|role|\/home\//i);
  });

  it('does not expose an action for safe unavailable states', () => {
    for (const state of ['disabled', 'policy_disabled', 'unavailable', 'unsupported', 'outside_v1', 'fallback']) {
      const model = buildPromptEnhancementTweakPresentationModelV1({ contract: typed(state) });
      expect(model.interactive).toBe(false);
      expect(model.action).toBeNull();
    }
  });
});
