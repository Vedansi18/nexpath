/**
 * B4.1 application boundary for a validated PE configuration result.
 *
 * The Hiren/CLI producer owns config keys, defaults, validation, persistence,
 * availability, and business meaning.  This module only converts an already
 * validated, typed state into a public-safe display model.  It deliberately
 * accepts `unknown` at the boundary so an absent or newer producer packet can
 * never enable PE by accident.
 */

export type PromptEnhancementValidatedConfigDisplayStateV1 =
  | 'enabled'
  | 'disabled'
  | 'unavailable'
  | 'unsupported'
  | 'policy_disabled'
  | 'fallback';

export type PromptEnhancementValidatedConfigFreshnessV1 =
  | 'current'
  | 'stale'
  | 'unknown';

export interface PromptEnhancementValidatedConfigDisplayInputV1 {
  configResult: unknown;
  freshness?: PromptEnhancementValidatedConfigFreshnessV1;
}

export interface PromptEnhancementValidatedConfigDisplayModelV1 {
  status: PromptEnhancementValidatedConfigDisplayStateV1;
  publicLabel: string;
  interactive: false;
  configAuthority: 'typed_validated_hiren_cli_result_only';
  claims: {
    defaultChosen: false;
    persisted: false;
    valueValidatedLocally: false;
    availabilityInferredLocally: false;
    legacyDecisionSessionAuthority: false;
    businessMeaningDecidedLocally: false;
  };
  privacy: {
    rawConfigExcluded: true;
    privatePathsExcluded: true;
    storageDetailsExcluded: true;
    providerErrorsExcluded: true;
    internalEnumDetailsExcluded: true;
    planningTermsExcluded: true;
  };
  reasonCodes: readonly string[];
}

const STATES: readonly PromptEnhancementValidatedConfigDisplayStateV1[] = [
  'enabled',
  'disabled',
  'unavailable',
  'unsupported',
  'policy_disabled',
  'fallback',
];

const FRESHNESS: readonly PromptEnhancementValidatedConfigFreshnessV1[] = [
  'current',
  'stale',
  'unknown',
];

const PUBLIC_LABELS: Record<PromptEnhancementValidatedConfigDisplayStateV1, string> = {
  enabled: 'Prompt Enhancement is enabled.',
  disabled: 'Prompt Enhancement is disabled.',
  unavailable: 'Prompt Enhancement configuration is unavailable.',
  unsupported: 'Prompt Enhancement configuration is unsupported here.',
  policy_disabled: 'Prompt Enhancement is disabled by policy.',
  fallback: 'Prompt Enhancement is using a safe fallback configuration.',
};

const PUBLIC_REASON_CODES: Record<PromptEnhancementValidatedConfigDisplayStateV1, string> = {
  enabled: "configuration_available",
  disabled: "configuration_disabled",
  unavailable: "configuration_unavailable",
  unsupported: "configuration_unsupported",
  policy_disabled: "configuration_policy_restricted",
  fallback: "configuration_safe_fallback",
};

interface ValidatedConfigResult {
  state: PromptEnhancementValidatedConfigDisplayStateV1;
  freshness: PromptEnhancementValidatedConfigFreshnessV1;
  arbitraryConfigRowsAreAuthority: false;
  legacyDecisionSessionConfigIsAuthority: false;
}

function isValidatedConfigResult(value: unknown): value is ValidatedConfigResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return STATES.includes(candidate.state as PromptEnhancementValidatedConfigDisplayStateV1)
    && FRESHNESS.includes(candidate.freshness as PromptEnhancementValidatedConfigFreshnessV1)
    && candidate.arbitraryConfigRowsAreAuthority === false
    && candidate.legacyDecisionSessionConfigIsAuthority === false;
}

export function buildPromptEnhancementValidatedConfigDisplayModelV1(
  input: PromptEnhancementValidatedConfigDisplayInputV1,
): PromptEnhancementValidatedConfigDisplayModelV1 {
  if (!isValidatedConfigResult(input.configResult)) {
    return model('unavailable', 'configuration_unavailable');
  }

  if (input.freshness !== undefined && !FRESHNESS.includes(input.freshness)) {
    return model('unavailable', 'configuration_unavailable');
  }

  if (input.freshness === 'stale' || input.configResult.freshness === 'stale') {
    return model('fallback', 'configuration_safe_fallback');
  }
  if (input.freshness === 'unknown' || input.configResult.freshness === 'unknown') {
    return model('unavailable', 'configuration_unavailable');
  }

  return model(input.configResult.state, PUBLIC_REASON_CODES[input.configResult.state]);
}

function model(
  status: PromptEnhancementValidatedConfigDisplayStateV1,
  reasonCode: string,
): PromptEnhancementValidatedConfigDisplayModelV1 {
  return {
    status,
    publicLabel: PUBLIC_LABELS[status],
    interactive: false,
    configAuthority: 'typed_validated_hiren_cli_result_only',
    claims: {
      defaultChosen: false,
      persisted: false,
      valueValidatedLocally: false,
      availabilityInferredLocally: false,
      legacyDecisionSessionAuthority: false,
      businessMeaningDecidedLocally: false,
    },
    privacy: {
      rawConfigExcluded: true,
      privatePathsExcluded: true,
      storageDetailsExcluded: true,
      providerErrorsExcluded: true,
      internalEnumDetailsExcluded: true,
      planningTermsExcluded: true,
    },
    reasonCodes: [reasonCode],
  };
}

