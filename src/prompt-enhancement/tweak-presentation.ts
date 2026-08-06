/**
 * B4.3 application boundary for the Prompt Enhancement CTRL+T surface.
 *
 * content-owner owns the meaning, defaults, validation, persistence, and runtime
 * policy of PE settings. This module only presents an already validated,
 * typed state. It never creates a setting, writes config, or exposes a
 * sequence/runtime toggle. The legacy Decision Session chooser is not an
 * authority for this surface.
 */

export type PromptEnhancementTweakStateV1 =
  | 'enabled'
  | 'disabled'
  | 'policy_disabled'
  | 'unavailable'
  | 'unsupported'
  | 'outside_v1'
  | 'fallback';

export type PromptEnhancementTweakFreshnessV1 = 'current' | 'stale' | 'unknown';

export interface PromptEnhancementTypedTweakContractV1 {
  state: PromptEnhancementTweakStateV1;
  freshness: PromptEnhancementTweakFreshnessV1;
  contractRevision: string;
  arbitraryConfigRowsAreAuthority: false;
  legacyDecisionSessionConfigIsAuthority: false;
}

export interface PromptEnhancementTweakPresentationInputV1 {
  contract: unknown;
  freshness?: PromptEnhancementTweakFreshnessV1;
}

export interface PromptEnhancementTweakPresentationModelV1 {
  surface: 'prompt_enhancement_ctrl_t';
  shortcut: 'CTRL+T';
  title: 'Prompt Enhancement settings';
  status: PromptEnhancementTweakStateV1;
  publicLabel: string;
  interactive: false;
  action: null;
  contractRevision: string | null;
  authority: 'typed_owner_pe_tweak_contract_only';
  claims: {
    configCreated: false;
    configPersisted: false;
    configValidatedLocally: false;
    sequenceSemanticsDecidedLocally: false;
    runtimeToggleExposed: false;
    legacyDecisionSessionAuthority: false;
  };
  negatives: {
    promptHistoryAuthority: false;
    productRatingAuthority: false;
    selectedPromptAuthority: false;
    clipboardAuthority: false;
    rawStopReasonAuthority: false;
    hostStateAuthority: false;
    visibleLabelAuthority: false;
  };
}

const STATES: readonly PromptEnhancementTweakStateV1[] = [
  'enabled',
  'disabled',
  'policy_disabled',
  'unavailable',
  'unsupported',
  'outside_v1',
  'fallback',
];

const FRESHNESS: readonly PromptEnhancementTweakFreshnessV1[] = [
  'current',
  'stale',
  'unknown',
];

const PUBLIC_LABELS: Record<PromptEnhancementTweakStateV1, string> = {
  enabled: 'Prompt Enhancement settings are available.',
  disabled: 'Prompt Enhancement is disabled.',
  policy_disabled: 'Prompt Enhancement is disabled by policy.',
  unavailable: 'Prompt Enhancement settings are unavailable.',
  unsupported: 'Prompt Enhancement settings are unsupported here.',
  outside_v1: 'Prompt Enhancement settings are not available in this version.',
  fallback: 'Prompt Enhancement settings are using a safe fallback.',
};

function isContract(value: unknown): value is PromptEnhancementTypedTweakContractV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return STATES.includes(candidate.state as PromptEnhancementTweakStateV1)
    && FRESHNESS.includes(candidate.freshness as PromptEnhancementTweakFreshnessV1)
    && typeof candidate.contractRevision === 'string'
    && candidate.contractRevision.trim().length > 0
    && candidate.arbitraryConfigRowsAreAuthority === false
    && candidate.legacyDecisionSessionConfigIsAuthority === false;
}

export function buildPromptEnhancementTweakPresentationModelV1(
  input: PromptEnhancementTweakPresentationInputV1,
): PromptEnhancementTweakPresentationModelV1 {
  if (!isContract(input.contract)) return model('unavailable', null, 'invalid_or_missing_typed_contract');
  if (input.freshness !== undefined && !FRESHNESS.includes(input.freshness)) {
    return model('unavailable', null, 'invalid_freshness');
  }

  if (input.freshness === 'stale' || input.contract.freshness === 'stale') {
    return model('fallback', input.contract.contractRevision, 'stale_typed_contract');
  }
  if (input.freshness === 'unknown' || input.contract.freshness === 'unknown') {
    return model('unavailable', null, 'unknown_typed_contract_freshness');
  }

  return model(input.contract.state, input.contract.contractRevision, 'typed_state_rendered');
}

function model(
  status: PromptEnhancementTweakStateV1,
  contractRevision: string | null,
  _reasonCode: string,
): PromptEnhancementTweakPresentationModelV1 {
  return {
    surface: 'prompt_enhancement_ctrl_t',
    shortcut: 'CTRL+T',
    title: 'Prompt Enhancement settings',
    status,
    publicLabel: PUBLIC_LABELS[status],
    interactive: false,
    action: null,
    contractRevision,
    authority: 'typed_owner_pe_tweak_contract_only',
    claims: {
      configCreated: false,
      configPersisted: false,
      configValidatedLocally: false,
      sequenceSemanticsDecidedLocally: false,
      runtimeToggleExposed: false,
      legacyDecisionSessionAuthority: false,
    },
    negatives: {
      promptHistoryAuthority: false,
      productRatingAuthority: false,
      selectedPromptAuthority: false,
      clipboardAuthority: false,
      rawStopReasonAuthority: false,
      hostStateAuthority: false,
      visibleLabelAuthority: false,
    },
  };
}
