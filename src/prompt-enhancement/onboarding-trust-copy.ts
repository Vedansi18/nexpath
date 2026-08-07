import type { PromptEnhancementValidatedConfigDisplayStateV1 } from './validated-config-display.js';

export interface PromptEnhancementOnboardingTrustCopyInputV1 {
  configState: unknown;
  approvedCopy: unknown;
}

export interface PromptEnhancementOnboardingTrustCopyModelV1 {
  state: PromptEnhancementValidatedConfigDisplayStateV1;
  heading: string;
  body: string;
  privacyNotice: string | null;
  actionLabel: null;
  interactive: false;
  copyAuthority: 'supplied_owner_approved_public_copy_only';
  claims: {
    installed: false;
    sent: false;
    private: false;
    localOnly: false;
    hostSupported: false;
    telemetryMeaning: false;
    costMeaning: false;
  };
  privacy: {
    rawConfigExcluded: true;
    privatePathsExcluded: true;
    providerErrorsExcluded: true;
    internalTermsExcluded: true;
    planningTermsExcluded: true;
    legacyDecisionSessionTermsExcluded: true;
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

const NON_ACTIONABLE_STATES: readonly PromptEnhancementValidatedConfigDisplayStateV1[] = [
  'disabled',
  'unavailable',
  'unsupported',
  'policy_disabled',
  'fallback',
];

const SAFE_FALLBACK_COPY = {
  heading: 'Prompt Enhancement information is unavailable.',
  body: 'No configuration action is available until a valid typed state is supplied.',
  privacyNotice: null,
};

const FORBIDDEN_COPY_PATTERNS = [
  /(?:^|\/)home\//i,
  /decision\s*session/i,
  /selectedprompt/i,
  /prompt\s*history/i,
  /advisory/i,
  /frequency/i,
  /product\s*rating/i,
  /raw\s+config/i,
  /provider\s+error/i,
  /private\s+path/i,
  /planning|research/i,
  /local[- ]only/i,
  /telemetry/i,
  /launch\s+(?:ready|commitment)/i,
];

interface ApprovedCopy {
  state: PromptEnhancementValidatedConfigDisplayStateV1;
  heading: string;
  body: string;
  privacyNotice?: string | null;
  actionLabel?: string | null;
}

function isState(value: unknown): value is PromptEnhancementValidatedConfigDisplayStateV1 {
  return STATES.includes(value as PromptEnhancementValidatedConfigDisplayStateV1);
}

function isApprovedCopy(value: unknown): value is ApprovedCopy {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return isState(candidate.state)
    && typeof candidate.heading === 'string'
    && candidate.heading.trim().length > 0
    && typeof candidate.body === 'string'
    && candidate.body.trim().length > 0
    && (candidate.privacyNotice === undefined || candidate.privacyNotice === null || typeof candidate.privacyNotice === 'string')
    && (candidate.actionLabel === undefined || candidate.actionLabel === null || typeof candidate.actionLabel === 'string');
}

function hasForbiddenCopy(text: string): boolean {
  return FORBIDDEN_COPY_PATTERNS.some((pattern) => pattern.test(text));
}

export function buildPromptEnhancementOnboardingTrustCopyModelV1(
  input: PromptEnhancementOnboardingTrustCopyInputV1,
): PromptEnhancementOnboardingTrustCopyModelV1 {
  if (!isState(input.configState) || !isApprovedCopy(input.approvedCopy)) return safeModel('invalid_or_missing_typed_copy');
  if (input.approvedCopy.state !== input.configState) return safeModel('copy_state_mismatch');

  const text = [input.approvedCopy.heading, input.approvedCopy.body, input.approvedCopy.privacyNotice ?? ''].join(' ');
  if (!/prompt\s+enhancement/i.test(text) || hasForbiddenCopy(text)) return safeModel('unsafe_public_copy_rejected');
  if (NON_ACTIONABLE_STATES.includes(input.configState) && input.approvedCopy.actionLabel != null) {
    return safeModel('unavailable_action_rejected');
  }

  return model(
    input.configState,
    input.approvedCopy.heading.trim(),
    input.approvedCopy.body.trim(),
    input.approvedCopy.privacyNotice?.trim() || null,
    'approved_public_copy_rendered',
  );
}

function safeModel(reasonCode: string): PromptEnhancementOnboardingTrustCopyModelV1 {
  return model('unavailable', SAFE_FALLBACK_COPY.heading, SAFE_FALLBACK_COPY.body, SAFE_FALLBACK_COPY.privacyNotice, reasonCode);
}

function model(
  state: PromptEnhancementValidatedConfigDisplayStateV1,
  heading: string,
  body: string,
  privacyNotice: string | null,
  reasonCode: string,
): PromptEnhancementOnboardingTrustCopyModelV1 {
  return {
    state,
    heading,
    body,
    privacyNotice,
    actionLabel: null,
    interactive: false,
    copyAuthority: 'supplied_owner_approved_public_copy_only',
    claims: {
      installed: false,
      sent: false,
      private: false,
      localOnly: false,
      hostSupported: false,
      telemetryMeaning: false,
      costMeaning: false,
    },
    privacy: {
      rawConfigExcluded: true,
      privatePathsExcluded: true,
      providerErrorsExcluded: true,
      internalTermsExcluded: true,
      planningTermsExcluded: true,
      legacyDecisionSessionTermsExcluded: true,
    },
    reasonCodes: [reasonCode],
  };
}

