import { describe, expect, it } from 'vitest';
import {
  buildPromptEnhancementPinchLabelV1,
  buildPromptEnhancementWhyHelpV1,
} from './pe-header-copy.js';

describe('UI-9 pinch label producer', () => {
  it('keys the funny pinch on the route family', () => {
    expect(buildPromptEnhancementPinchLabelV1({ familyId: 'issue_debug', capabilityOverlays: [] }))
      .toEqual({ text: 'Bug hunt.', derivedFrom: 'family' });
    expect(buildPromptEnhancementPinchLabelV1({ familyId: 'feature_delivery', capabilityOverlays: [] }).derivedFrom)
      .toBe('family');
  });

  it('lets a safety/risk overlay take priority over the family', () => {
    expect(buildPromptEnhancementPinchLabelV1({ familyId: 'issue_debug', capabilityOverlays: ['capability.risk_or_rollback'] }))
      .toMatchObject({ derivedFrom: 'overlay' });
  });
});

describe('UI-9 why-help producer', () => {
  it('is absent when there is no safety / risk / sensitive reason (§8.6 — only when needed)', () => {
    expect(buildPromptEnhancementWhyHelpV1({ capabilityOverlays: [], hasSensitiveAction: false })).toBeUndefined();
  });

  it('names the source-backed reason, sensitive-action first, then rollback, then confirmation', () => {
    expect(buildPromptEnhancementWhyHelpV1({ capabilityOverlays: ['capability.risk_or_rollback'], hasSensitiveAction: true })?.reasonKind)
      .toBe('sensitive_action');
    expect(buildPromptEnhancementWhyHelpV1({ capabilityOverlays: ['capability.risk_or_rollback'], hasSensitiveAction: false })?.reasonKind)
      .toBe('risk_or_rollback');
    expect(buildPromptEnhancementWhyHelpV1({ capabilityOverlays: ['capability.confirmation_needed'], hasSensitiveAction: false })?.reasonKind)
      .toBe('confirmation_needed');
  });
});
