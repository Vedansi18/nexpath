import { findPromptEnhancementInventionViolationsV1 } from './preservation-floors.js';
import {
  PROMPT_ENHANCEMENT_CONTRACT_VERSION,
  type PromptEnhancementActionType,
  type PromptEnhancementCallVisibilityMode,
  type PromptEnhancementCurrentBodyV1,
  type PromptEnhancementFallbackMode,
  type PromptEnhancementPublicDiagnosticCategory,
  type PromptEnhancementSafetySummaryV1,
  type PromptEnhancementSendPolicy,
  type PromptEnhancementValidationFailureV1,
  type PromptEnhancementValidationGraphV1,
  type PromptEnhancementValidationPhaseStateV1,
  type PromptEnhancementValidationStage,
  type PromptEnhancementValidationStatus,
} from './contracts.js';

export const PROMPT_ENHANCEMENT_CANONICAL_CONFIRMATION =
  'Still, before you do this <specific sensitive action> you must ask me for go-ahead confirmation.';
export const PROMPT_ENHANCEMENT_MAX_SENDABLE_BODY_CHARS = 128_000;

// Declared as values so membership can be checked at runtime by consumers that read a stored
// risk kind back; the types below are derived from them so the two cannot drift apart.
export const PROMPT_ENHANCEMENT_SENSITIVE_ACTION_RISK_KINDS = [
  'destructive_filesystem_or_codebase',
  'destructive_data_or_schema',
  'dependency_or_toolchain_change',
  'secret_env_or_credential',
  'production_release_or_external_effect',
  'git_history_rewrite',
  'security_auth_permission',
  'cost_or_resource',
  'wide_scope_or_boundary_expansion',
  'agent_mode_or_permission_boundary',
] as const;
export type PromptEnhancementSensitiveActionRiskKind =
  typeof PROMPT_ENHANCEMENT_SENSITIVE_ACTION_RISK_KINDS[number];

export const PROMPT_ENHANCEMENT_AUTHORITY_MODES = [
  'observe_or_literal',
  'plan_or_review',
  'execute_requested',
  'execute_generated_escalation',
] as const;
export type PromptEnhancementAuthorityMode =
  typeof PROMPT_ENHANCEMENT_AUTHORITY_MODES[number];

export interface PromptEnhancementSensitiveActionFinding {
  riskKind: PromptEnhancementSensitiveActionRiskKind;
  authorityMode: PromptEnhancementAuthorityMode;
  requiresConfirmation: boolean;
  affectedSectionIds: readonly string[];
  affectedBodySpanRefs: readonly string[];
  affectedActionIds: readonly string[];
  reasonCode: string;
}

export interface PromptEnhancementSafetyValidationInput {
  currentBody: PromptEnhancementCurrentBodyV1;
  editedBodyText?: string;
  actionType?: PromptEnhancementActionType;
  callVisibilityMode?: PromptEnhancementCallVisibilityMode;
  optionalCallAvailabilityState?: PromptEnhancementValidationGraphV1['optionalCallAvailabilityState'];
  /**
   * The composer's own verdict on the wording it produced, and its reading of the request that
   * produced it. Supplied only when the body being validated IS that composer output.
   *
   * The deterministic rule above is a floor: it catches wording with no benign reading, and it was
   * narrowed to that role because a broad verb list rejected ordinary planning prose. Between the
   * floor and plainly-safe wording lies a middle band that words alone cannot judge — "Once approved,
   * roll it out to production" carries no listed verb at all. This verdict covers that band.
   *
   * STRICTLY ADDITIVE. It can only turn a pass into a block. A verdict of `plan_or_review` never
   * exempts a body from the deterministic rule, and omitting the field entirely leaves behaviour
   * exactly as it was. The model is trusted to accuse, never to acquit.
   */
  composerAuthoritySelfReport?: {
    generatedMode?: PromptEnhancementAuthorityMode;
    requestMode?: PromptEnhancementAuthorityMode;
  };
}

export interface PromptEnhancementSafetyValidationResult {
  validationGraph: PromptEnhancementValidationGraphV1;
  safetySummary: PromptEnhancementSafetySummaryV1;
  validationDecisionId: string;
  traceVersion: typeof PROMPT_ENHANCEMENT_CONTRACT_VERSION;
  estimatedBodyTokens: number;
  generatedSafeStatus: PromptEnhancementValidationStatus;
  sendPolicy: PromptEnhancementSendPolicy;
  fallbackMode: PromptEnhancementFallbackMode;
  sensitiveActionFindings: readonly PromptEnhancementSensitiveActionFinding[];
  failures: readonly PromptEnhancementValidationFailureV1[];
  publicDiagnostics: readonly {
    category: PromptEnhancementPublicDiagnosticCategory;
    reasonCode: string;
  }[];
}

export interface PromptEnhancementValidationPhaseContext {
  failures: readonly PromptEnhancementValidationFailureV1[];
  hasBlockingFailure: boolean;
  fallbackMode: PromptEnhancementFallbackMode;
}

export type PromptEnhancementValidationPhaseValidator = (
  context: PromptEnhancementValidationPhaseContext,
) => PromptEnhancementValidationPhaseStateV1;

export const PROMPT_ENHANCEMENT_VALIDATION_STAGES: readonly PromptEnhancementValidationStage[] = [
  'request',
  'pre_plan',
  'section_plan',
  'composer_input',
  'composer_output',
  'final_body',
  'user_edit',
  'action',
  'delivery',
  'storage',
  'source_use',
  'privacy',
  'handoff',
  'sequence',
  'launch_check',
];

export const PROMPT_ENHANCEMENT_PHASE_VALIDATORS = {
  request: validatePromptEnhancementRequestPhase,
  pre_plan: validatePromptEnhancementPrePlanPhase,
  section_plan: validatePromptEnhancementSectionPlanPhase,
  composer_input: validatePromptEnhancementComposerInputPhase,
  composer_output: validatePromptEnhancementComposerOutputPhase,
  final_body: validatePromptEnhancementFinalBodyPhase,
  user_edit: validatePromptEnhancementUserEditPhase,
  action: validatePromptEnhancementActionPhase,
  delivery: validatePromptEnhancementDeliveryPhase,
  storage: validatePromptEnhancementStoragePhase,
  source_use: validatePromptEnhancementSourceUsePhase,
  privacy: validatePromptEnhancementPrivacyPhase,
  handoff: validatePromptEnhancementHandoffPhase,
  sequence: validatePromptEnhancementSequencePhase,
  launch_check: validatePromptEnhancementLaunchCheckPhase,
} satisfies Record<PromptEnhancementValidationStage, PromptEnhancementValidationPhaseValidator>;

const GENERATED_VOICE_FAILURE_PATTERNS: readonly [RegExp, string][] = [
  [/\bask\s+(?:the\s+)?(?:ai|assistant|agent|claude|model)\b/i, 'third_person_agent_actor'],
  [/\b(?:have|get|tell|tells|instruct)\s+(?:the\s+)?(?:ai|assistant|agent|coding agent|model)\b/i, 'third_person_agent_actor'],
  [/\b(?:the\s+)?(?:ai|assistant|agent|coding agent|claude|model)\s+should\b/i, 'third_person_agent_actor'],
  [/\b(?:the\s+ai|claude|the\s+assistant)\b/i, 'third_person_agent_actor'],
  [/\b(?:ai|assistant|agent|claude|model)\s+(?:se|ko)\s+.{0,80}\b(?:bolo|karao|karwao|karvao|karne\s+ko\s+bolo)\b/i, 'third_person_agent_actor'],
  [/(?:एआई|असिस्टेंट|एजेंट|क्लॉड|મોડલ|એજન્ટ|અસિસ્ટન્ટ)\s*(?:से|को|ને|પાસે)?\s*.{0,80}(?:बोलो|कह[ोे]|कराओ|करवाओ|કહો|કરાવો)/i, 'third_person_agent_actor'],
  [/\bnexpath\s+(?:recommends|thinks|says)\b/i, 'advisory_caption_voice'],
  [/\byou\s+(?:seem|forgot|already|usually|often|failed)\b|\bbad\s+practice\b/i, 'scolding_or_profile_voice_invalid'],
  [/\byou\s+are\s+(?:rushed|frustrated|angry|careless|confused)\b/i, 'scolding_or_profile_voice_invalid'],
  [/\bwhy\s+this\s+helps\b/i, 'ui_label_bridge_voice_invalid'],
  [/\b(?:this\s+option|the\s+option\s+above|the\s+action\s+below|the\s+prompt\s+above)\b/i, 'ui_label_bridge_voice_invalid'],
  [/\b(?:it\s+(?:says|finds)|its\s+(?:answer|output))\b/i, 'third_person_agent_actor'],
];

const PRIVATE_GENERATED_VALUE_PATTERNS: readonly [RegExp, string][] = [
  [/\bsk-[a-z0-9_-]{8,}\b/i, 'secret_or_credential_literal'],
  [/\bgh[pousr]_[a-z0-9_]{12,}\b/i, 'secret_or_credential_literal'],
  [/\bAKIA[0-9A-Z]{12,}\b/, 'secret_or_credential_literal'],
  [/\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*['"]?[^\s'"]{6,}/i, 'secret_or_credential_literal'],
  [/(?:^|[\s`"'(])(?:\.env(?:\.[a-z0-9_.-]+)?|env\.(?:production|prod|staging|local)|prod\.env|production\.env)\b/i, 'private_env_name_literal'],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, 'private_email_literal'],
  [/\bhttps?:\/\/[^\s)]+/i, 'private_url_literal'],
  [/(?:^|\s)(?:\/home\/|\/Users\/|[A-Za-z]:\\)[^\s]+/i, 'private_path_literal'],
  [/\b(?:[Cc]lient|[Cc]ustomer|[Tt]enant|[Aa]ccount|[Oo]rganization)\s+["'`]?[A-Z][A-Za-z0-9_-]{2,}\b/, 'private_customer_or_project_literal'],
  [/\bpe-(?:ar|cr|dr|em|wr|g)-?\d*(?:\.\d+)*\b/i, 'private_planning_label_literal'],
  [/pe_(?:ar|cr|dr|em|wr|g)_?\d*(?:_\d+)*/i, 'private_planning_label_literal'],
  [/\bphase\d+(?:[_-][a-z0-9]+)*\b/i, 'private_planning_label_literal'],
  [/\b(?:table|row|sqlite|sql)\s*[:#=]\s*[a-z0-9_-]{4,}/i, 'internal_table_or_row_id_literal'],
];

const CONFIRMATION_BYPASS_PATTERNS: readonly RegExp[] = [
  /\b(?:do\s+not|don't|dont|never)\s+(?:ask|confirm|request)\b/i,
  /\bwithout\s+(?:asking|confirmation|go[-\s]?ahead)\b/i,
  /\b(?:skip|bypass|ignore)\s+(?:the\s+)?(?:confirmation|go[-\s]?ahead|ask[-\s]?first)\b/i,
  /\bno\s+need\s+to\s+(?:ask|confirm|wait\s+for\s+go[-\s]?ahead)\b/i,
  /\bproceed\s+without\s+(?:asking|confirmation|go[-\s]?ahead)\b/i,
  // E5/5.5: Hindi / Gujarati (romanized + script) confirmation-bypass phrases, so a
  // language-adapted body cannot slip a bypass past the English-only patterns above.
  /\bbina\s+puch(?:e|o|ke)\b|\bpuch(?:e|o)\s+bina\b/i,
  /\bconfirmation\s+(?:mat|na)\s+(?:pucho|mango|maango)\b/i,
  /\b(?:confirmation|pushti|puchne|puchhne)\s+(?:ki\s+)?(?:zaroorat|zarurat|jaroor|jarur)\s+nahi\b/i,
  /(?:बिना\s*पूछे|पूछे\s*बिना|पुष्टि\s*मत|(?:पुष्टि|पूछने)\s*की\s*(?:ज़रूरत|जरूरत)\s*नहीं)/,
  /(?:પૂછ્યા\s*વગર|(?:પુષ્ટિ|પૂછવાની)\s*(?:ની\s*)?જરૂર\s*નથી)/,
];

const RISK_PATTERNS: readonly [PromptEnhancementSensitiveActionRiskKind, RegExp][] = [
  ['destructive_filesystem_or_codebase', /\b(?:delete|remove|rm\s+-rf|wipe|overwrite|drop|hatao|mitao|nikal\s+do)\b|(?:हटाओ|मिटाओ|निकाल\s*दो|काढो|કાઢી\s*નાખો|મિટાવો|દૂર\s*કરો)/i],
  ['destructive_data_or_schema', /\b(?:migration|migrate|schema|database|restore|backup|truncate|drop\s+table|migrate\s+karo|backup\s+karo)\b|(?:माइग्रेशन|माइग्रेट|डेटाबेस|स्कीमा|बैकअप|रिस्टोर|માઇગ્રેશન|માઇગ્રેટ|ડેટાબેઝ|સ્કીમા|બેકઅપ|રીસ્ટોર)/i],
  ['dependency_or_toolchain_change', /\b(?:install|dependency|package-lock|lockfile|npm\s+install|pip\s+install|upgrade|install\s+karo)\b|(?:इंस्टॉल|निर्भरता|अपग्रेड|ઇન્સ્ટોલ|ડિપેન્ડન્સી|અપગ્રેડ)/i],
  ['secret_env_or_credential', /\b(?:token|secret|credential|api[_\s-]?key|password|\.env|env\.production)\b|(?:टोकन|सीक्रेट|पासवर्ड|क्रेडेंशियल|ટોકન|સિક્રેટ|પાસવર્ડ|ક્રેડેન્શિયલ)/i],
  ['production_release_or_external_effect', /\b(?:production|deploy|release|publish|post|notify|customer|external|go\s+live|deploy\s+karo|release\s+karo)\b|(?:प्रोडक्शन|डिप्लॉय|डिप्लोय|रिलीज|पब्लिश|ग्राहक|પ્રોડક્શન|ડિપ્લોય|રીલીઝ|પબ્લિશ|ગ્રાહક)/i],
  ['git_history_rewrite', /\b(?:force[-\s]?push|rebase|rewrite\s+history|reset\s+--hard|force\s+push\s+karo)\b|(?:फोर्स\s*पुश|रीबेस|इतिहास\s*बदल|ફોર્સ\s*પુશ|રીબેઝ|ઇતિહાસ\s*બદલ)/i],
  ['security_auth_permission', /\b(?:security|auth|permission|oauth|admin|role|access)\b|(?:सुरक्षा|अनुमति|एडमिन|एक्सेस|સુરક્ષા|પરવાનગી|એડમિન|ઍક્સેસ)/i],
  ['cost_or_resource', /\b(?:cost|billing|quota|resource|autoscale|instance|cluster)\b|(?:लागत|बिलिंग|कोटा|संसाधन|ખર્ચ|બિલિંગ|ક્વોટા|સાધન)/i],
  ['wide_scope_or_boundary_expansion', /\b(?:whole\s+repo|entire\s+repo|across\s+the\s+repo|all\s+files|broad\s+scope|poora\s+repo|pura\s+repo|sabhi\s+files)\b|(?:पूरे\s*रेपो|सभी\s*फाइल|વિસ્તૃત\s*સ્કોપ|આખા\s*રેપો|બધી\s*ફાઇલો)/i],
  ['agent_mode_or_permission_boundary', /\b(?:execute\s+mode|read[-\s]?only|make\s+changes|without\s+asking|do\s+not\s+ask|bina\s+puche|execute\s+karo)\b|(?:बिना\s*पूछे|पूछे\s*बिना|एग्जीक्यूट\s*मोड|रीड\s*ओनली|પૂછ્યા\s*વગર|એક્ઝિક્યુટ\s*મોડ|રીડ\s*ઓનલી)/i],
];

const EXECUTION_VERB = /\b(?:run|execute|deploy|delete|remove|migrate|install|force[-\s]?push|publish|post|notify|write|modify|apply|rotate|increase|truncate|drop|karo|kar\s+do|chalao|hatao|mitao|lagao)\b|(?:करो|कर\s*दो|चलाओ|हटाओ|मिटाओ|लिखो|बदलो|કરો|કરી\s*દો|ચલાવો|કાઢી\s*નાખો|મિટાવો|લખો|બદલો)/i;
const PLANNING_VERB = /\b(?:plan|review|compare|check|prepare|assess|evaluate|draft|discuss|list|yojana|suchi|jaanch|janch)\b|(?:योजना|समीक्षा|तुलना|जांच|जाँच|तैयार|सूची|યોજના|સમીક્ષા|તુલના|તપાસ|તૈયાર|યાદી)/i;
const REVIEW_QUESTION_PATTERN = /\b(?:whether|safe\s+to|should\s+i|should\s+we|can\s+i|can\s+we|could\s+i|could\s+we)\b/i;
const UNRESOLVED_PLACEHOLDER_PATTERN = /\{\{[^}]{1,80}\}\}|\[[A-Z][A-Z0-9 _-]{2,80}\]|<[^>\n]{2,80}>/;

/**
 * Owner ruling 2026-08-14: *"if user edits something than we will not argu against that
 * for now."* One switch, exported so the behaviour is greppable and reversible in one place
 * rather than being reconstructed from seven scattered conditions later.
 *
 * Reconsideration is recorded in the v2 deferred-issues file, which also lists what must be
 * answered before this is flipped back â chiefly that a block today becomes `no_send`, a dead end,
 * when the contract's own design calls for confirm-before-send instead.
 */
export const PROMPT_ENHANCEMENT_ARGUES_WITH_USER_EDITS_V1 = false;

export function validatePromptEnhancementSafety(
  input: PromptEnhancementSafetyValidationInput,
): PromptEnhancementSafetyValidationResult {
  if (input.actionType === 'use_original') {
    return originalOnlyValidationResult(input);
  }

  const bodyText = input.editedBodyText ?? input.currentBody.text;
  const generatedBodyText = generatedOnlyText(bodyText, input.currentBody.originalPromptText);
  const edited = input.editedBodyText !== undefined && input.editedBodyText !== input.currentBody.text;
  /**
   * Owner ruling 2026-08-14: a user's edit is the user's, and Nexpath does not refuse to send a body
   * because the user changed it — whether they removed a confirmation, removed the source-honesty
   * floor, added an execution verb, or pasted something of their own.
   *
   * This suppresses CONTENT JUDGEMENTS only. `body_size:cap_exceeded` below is deliberately NOT
   * suppressed: a body past the transport cap cannot be sent at all, which is a limit rather than an
   * opinion about what the user wrote.
   *
   * Detection is unaffected — `preservation-floors.ts` still names which floor an edit removed. The
   * generated-body path is unaffected too: everything here still runs when `edited` is false.
   */
  const suppressEditContentJudgements = edited && !PROMPT_ENHANCEMENT_ARGUES_WITH_USER_EDITS_V1;
  const failures: PromptEnhancementValidationFailureV1[] = [];
  const generatedSpanRefIds = generatedSpanRefs(input.currentBody);
  const generatedSourceRefIds = generatedSourceRefs(input.currentBody);
  const affectedActionIds = input.actionType ? [`${input.currentBody.currentBodyId}:action:${input.actionType}`] : [];

  const sensitiveActionFindings = classifySensitiveActions(input.currentBody, generatedBodyText, affectedActionIds);
  const generatedVoicePolicyText = sourceLiteralAwareVoicePolicyText(generatedBodyText);
  const confirmationRequired = sensitiveActionFindings.some((finding) => finding.requiresConfirmation);
  const expectedConfirmation = buildPromptEnhancementCanonicalConfirmation(input.currentBody.originalPromptText);
  const confirmationPresent = hasCanonicalConfirmation(bodyText, expectedConfirmation);
  const confirmationContradicted = confirmationPresent &&
    confirmationBypassPresent(generatedBodyText, expectedConfirmation);
  const confirmationOverridden = confirmationPresent &&
    laterSensitiveExecutionAfterConfirmation(generatedBodyText, expectedConfirmation, input.currentBody.originalPromptText);
  const confirmationEffective = confirmationPresent && !confirmationContradicted && !confirmationOverridden;

  for (const [pattern, reasonCode] of GENERATED_VOICE_FAILURE_PATTERNS) {
    if (!suppressEditContentJudgements && pattern.test(generatedVoicePolicyText)) {
      failures.push(failure({
        failureCode: `voice_policy:${reasonCode}`,
        stage: edited ? 'user_edit' : 'final_body',
        affectedSectionIds: generatedSectionIds(input.currentBody),
        affectedBodySpanRefs: generatedSpanRefIds,
        affectedSourceRefIds: generatedSourceRefIds,
        affectedActionIds,
      }));
    }
  }

  if (
    !suppressEditContentJudgements
    && (generatedEscalatesAuthority(input.currentBody.originalPromptText, generatedBodyText)
      || composerReportsEscalation(input.currentBody.originalPromptText, input.composerAuthoritySelfReport))
  ) {
    failures.push(failure({
      failureCode: 'authority_escalation:planning_to_execution',
      stage: edited ? 'user_edit' : 'composer_output',
      affectedSectionIds: generatedSectionIds(input.currentBody),
      affectedBodySpanRefs: generatedSpanRefIds,
      affectedSourceRefIds: generatedSourceRefIds,
      affectedActionIds,
    }));
  }

  if (!suppressEditContentJudgements && confirmationRequired && !confirmationEffective) {
    failures.push(failure({
      failureCode: !confirmationPresent
        ? edited ? 'edit_state_invalid:confirmation_removed' : 'missing_or_weak_confirmation:canonical_confirmation_absent'
        : confirmationContradicted
          ? edited
            ? 'edit_state_invalid:confirmation_contradicted_or_bypassed'
            : 'missing_or_weak_confirmation:confirmation_contradicted_or_bypassed'
          : edited
            ? 'edit_state_invalid:confirmation_hidden_or_overridden'
            : 'missing_or_weak_confirmation:confirmation_hidden_or_overridden',
      stage: edited ? 'user_edit' : 'final_body',
      affectedSectionIds: sensitiveActionSectionIds(input.currentBody, sensitiveActionFindings),
      affectedBodySpanRefs: generatedSpanRefIds,
      affectedSourceRefIds: generatedSourceRefIds,
      affectedActionIds,
    }));
  }

  // The no-invention state, ENFORCED. The typed obligation rides each section
  // from the slot-effect layer; this asserts it after composition using the
  // preservation floors' own extractors pointed the other way (does the
  // section name something nobody supplied?), rather than a new gate. Only
  // sections carrying the obligation are checked, and an item is a violation
  // only when it appears in NEITHER the user's prompt NOR that section's
  // allowed source facts.
  if (!suppressEditContentJudgements) {
    for (const section of input.currentBody.sections) {
      if (!section.slotObligations.includes('no_invention_state')) continue;
      const inventions = findPromptEnhancementInventionViolationsV1({
        sectionText: section.bodyText,
        // GR-1: a value the BOUNDARY resolved was supplied — by a local probe or
        // the store rather than by the prompt — so it is grounding, not invention.
        allowedTexts: [
          input.currentBody.originalPromptText,
          ...section.sourceFactIds,
          ...section.sourceIds,
          ...(section.groundedFactValues ?? []),
        ],
      });
      for (const invention of inventions) {
        failures.push(failure({
          failureCode: `no_invention_state:fabricated_item:${invention.item}`,
          stage: edited ? 'user_edit' : 'composer_output',
          affectedSectionIds: [section.sectionId],
          affectedBodySpanRefs: generatedSpanRefIds,
          affectedSourceRefIds: generatedSourceRefIds,
          affectedActionIds,
          publicSafeReasonCategory: 'validation_failed',
        }));
      }
    }
  }

  for (const [pattern, reasonCode] of PRIVATE_GENERATED_VALUE_PATTERNS) {
    if (!suppressEditContentJudgements && pattern.test(generatedBodyText)) {
      failures.push(failure({
        failureCode: `sensitive_data_leak:${reasonCode}`,
        stage: edited ? 'user_edit' : 'privacy',
        affectedSectionIds: generatedSectionIds(input.currentBody),
        affectedBodySpanRefs: generatedSpanRefIds,
        affectedSourceRefIds: generatedSourceRefIds,
        affectedActionIds,
        publicSafeReasonCategory: 'validation_failed',
      }));
    }
  }

  if (!suppressEditContentJudgements && renderedMetadataIdPresent(input.currentBody, generatedBodyText)) {
    failures.push(failure({
      failureCode: 'source_honesty:metadata_id_rendered',
      stage: edited ? 'user_edit' : 'final_body',
      affectedSectionIds: generatedSectionIds(input.currentBody),
      affectedBodySpanRefs: generatedSpanRefIds,
      affectedSourceRefIds: generatedSourceRefIds,
      affectedActionIds,
    }));
  }

  if (!suppressEditContentJudgements && UNRESOLVED_PLACEHOLDER_PATTERN.test(generatedBodyText)) {
    failures.push(failure({
      failureCode: 'body_integrity:unresolved_placeholder',
      stage: edited ? 'user_edit' : 'final_body',
      affectedSectionIds: generatedSectionIds(input.currentBody),
      affectedBodySpanRefs: generatedSpanRefIds,
      affectedSourceRefIds: generatedSourceRefIds,
      affectedActionIds,
    }));
  }

  if (bodyText.length > PROMPT_ENHANCEMENT_MAX_SENDABLE_BODY_CHARS) {
    failures.push(failure({
      failureCode: 'body_size:cap_exceeded',
      stage: edited ? 'user_edit' : 'final_body',
      affectedSectionIds: generatedSectionIds(input.currentBody),
      affectedBodySpanRefs: generatedSpanRefIds,
      affectedSourceRefIds: generatedSourceRefIds,
      affectedActionIds,
    }));
  }

  if (edited && !suppressEditContentJudgements && sourceHonestyFloorRemoved(input.currentBody.text, bodyText)) {
    failures.push(failure({
      failureCode: 'edit_state_invalid:source_honesty_removed',
      stage: 'user_edit',
      affectedSectionIds: generatedSectionIds(input.currentBody),
      affectedBodySpanRefs: generatedSpanRefIds,
      affectedSourceRefIds: generatedSourceRefIds,
      affectedActionIds,
    }));
  }

  if (edited && !suppressEditContentJudgements && addsSensitiveExecution(input.currentBody.text, bodyText)) {
    failures.push(failure({
      failureCode: 'edit_state_invalid:sensitive_action_added',
      stage: 'user_edit',
      affectedSectionIds: generatedSectionIds(input.currentBody),
      affectedBodySpanRefs: generatedSpanRefIds,
      affectedSourceRefIds: generatedSourceRefIds,
      affectedActionIds,
    }));
  }

  const hasBlockingFailure = failures.some((candidate) => candidate.blocking);
  const generatedSafeStatus: PromptEnhancementValidationStatus = hasBlockingFailure
    ? 'invalid_non_sendable'
    : input.currentBody.generatedSafeStatus === 'valid_with_fallback' ? 'valid_with_fallback' : 'valid';
  const sendPolicy: PromptEnhancementSendPolicy = hasBlockingFailure ? 'no_send' : 'send_current';
  const fallbackMode: PromptEnhancementFallbackMode = hasBlockingFailure ? 'validation_failed_no_send' : 'none';
  const sensitiveActionState: PromptEnhancementSafetySummaryV1['sensitiveActionState'] = confirmationRequired
    ? confirmationEffective ? 'confirmation_required_present' : 'confirmation_required_missing'
    : 'none';
  const safetySummary: PromptEnhancementSafetySummaryV1 = {
    validationStatus: generatedSafeStatus,
    sendPolicy,
    sensitiveActionState,
    sourceHonestyState: hasFailurePrefix(failures, 'authority_escalation') ||
      hasFailurePrefix(failures, 'edit_state_invalid:source_honesty_removed') ||
      hasFailurePrefix(failures, 'source_honesty')
      ? 'invalid_non_sendable'
      : 'valid',
    privacyState: hasFailurePrefix(failures, 'sensitive_data_leak') ? 'invalid_non_sendable' : 'valid',
    authorityEscalationState: hasFailurePrefix(failures, 'authority_escalation') ? 'invalid_non_sendable' : 'valid',
    noForegroundSafer: true,
    noAutomaticSend: true,
  };
  const validationGraph: PromptEnhancementValidationGraphV1 = {
    graphVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
    graphOwner: 'content_semantics',
    phaseStates: runPromptEnhancementPhaseValidators({
      failures,
      hasBlockingFailure,
      fallbackMode,
    }),
    failures,
    safetyState: safetySummary,
    providerRuntimeState: input.callVisibilityMode ?? 'deterministic',
    optionalCallAvailabilityState: input.optionalCallAvailabilityState ??
      optionalCallAvailabilityStateFor(input.callVisibilityMode ?? 'deterministic'),
    rawTransportIsValidationProof: false,
    evaluatesAgentResponseQuality: false,
    canAutoAdvanceSequencePointer: false,
  };

  return {
    validationGraph,
    safetySummary,
    validationDecisionId: `${input.currentBody.currentBodyId}:validation:${input.currentBody.bodyRevision}:${edited ? 'user_edit' : 'final_body'}`,
    traceVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
    estimatedBodyTokens: estimateBodyTokens(bodyText),
    generatedSafeStatus,
    sendPolicy,
    fallbackMode,
    sensitiveActionFindings,
    failures,
    publicDiagnostics: failures.map((candidate) => ({
      category: candidate.publicSafeReasonCategory,
      reasonCode: candidate.failureCode,
    })),
  };
}

function originalOnlyValidationResult(
  input: PromptEnhancementSafetyValidationInput,
): PromptEnhancementSafetyValidationResult {
  const sensitiveActionFindings = classifySensitiveActions(
    input.currentBody,
    '',
    [`${input.currentBody.currentBodyId}:action:use_original`],
  );
  const originalRequiresConfirmation = sensitiveActionFindings.some((finding) => finding.requiresConfirmation);
  const safetySummary: PromptEnhancementSafetySummaryV1 = {
    validationStatus: 'original_only',
    sendPolicy: 'send_original',
    sensitiveActionState: originalRequiresConfirmation ? 'original_user_owned_sensitive_action' : 'none',
    sourceHonestyState: 'valid',
    privacyState: 'valid',
    authorityEscalationState: 'valid',
    noForegroundSafer: true,
    noAutomaticSend: true,
  };
  const fallbackMode: PromptEnhancementFallbackMode = 'original_prompt_only';

  return {
    validationGraph: {
      graphVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
      graphOwner: 'content_semantics',
      phaseStates: runPromptEnhancementOriginalOnlyPhaseValidators(fallbackMode),
      failures: [],
      safetyState: safetySummary,
      providerRuntimeState: input.callVisibilityMode ?? 'deterministic',
      optionalCallAvailabilityState: input.optionalCallAvailabilityState ??
        optionalCallAvailabilityStateFor(input.callVisibilityMode ?? 'deterministic'),
      rawTransportIsValidationProof: false,
      evaluatesAgentResponseQuality: false,
      canAutoAdvanceSequencePointer: false,
    },
    safetySummary,
    validationDecisionId: `${input.currentBody.currentBodyId}:validation:${input.currentBody.bodyRevision}:use_original`,
    traceVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
    estimatedBodyTokens: estimateBodyTokens(input.currentBody.originalPromptText),
    generatedSafeStatus: 'original_only',
    sendPolicy: 'send_original',
    fallbackMode,
    sensitiveActionFindings,
    failures: [],
    publicDiagnostics: [
      {
        category: 'fallback_or_no_popup',
        reasonCode: 'use_original_user_owned_fallback',
      },
      ...(originalRequiresConfirmation ? [{
        category: 'fallback_or_no_popup' as const,
        reasonCode: 'use_original_preserves_user_owned_sensitive_action',
      }] : []),
    ],
  };
}

export function requiresPromptEnhancementConfirmation(
  currentBody: Pick<PromptEnhancementCurrentBodyV1, 'sections' | 'originalPromptText'>,
): boolean {
  return classifySensitiveActions(currentBody, '').some((finding) => finding.requiresConfirmation);
}

export function requiresPromptEnhancementExecutionConfirmationForPrompt(originalPromptText: string): boolean {
  return classifyTextRiskKinds(originalPromptText).length > 0 && authorityModeFor(originalPromptText) === 'execute_requested';
}

/**
 * The authority mode of a piece of text, as the validator computes it.
 *
 * Exposed so the composer can tell — before it returns — whether the user's request was
 * plan/review-shaped, and therefore whether the wording it just produced would be an escalation. The
 * composer uses this to correct itself; it never relaxes a verdict, which stays entirely inside
 * `validatePromptEnhancementSafety`.
 */
export function promptEnhancementAuthorityModeForTextV1(text: string): PromptEnhancementAuthorityMode {
  return authorityModeFor(text);
}

/**
 * Validator-parity predicate for the COMPOSER (blocked-popup fix 2026-08-07). The composer's
 * prompt-based gate above cannot see sensitive-action risk phrasing that the GENERATED wording
 * introduces (LLM drafts are free text), but `validatePromptEnhancementSafety` scans the generated
 * body too and hard-blocks a body that needs the canonical confirmation and lacks it
 * (`missing_or_weak_confirmation:canonical_confirmation_absent` → blocked_no_send → an empty,
 * all-unavailable popup). This applies EXACTLY the validator's own rule — same classifier, same
 * generated-only text derivation — so the composer can guarantee the confirmation is present
 * whenever the validator will demand it.
 */
export function promptEnhancementGeneratedBodyRequiresConfirmationV1(
  currentBody: Pick<PromptEnhancementCurrentBodyV1, 'sections' | 'originalPromptText'>,
  bodyText: string,
): boolean {
  const generatedBodyText = generatedOnlyText(bodyText, currentBody.originalPromptText);
  return classifySensitiveActions(currentBody, generatedBodyText).some((finding) => finding.requiresConfirmation);
}

/**
 * Does the generated wording claim more authority than the request granted?
 *
 * The safety validator runs this over a single prompt's finished body. A multi-prompt sequence is a
 * list of generated bodies, one per item, and none of them passes through that path — so without a
 * per-item check a composer can turn a plan-or-review slice into execute-requested wording and
 * nothing in the system notices.
 *
 * Exported rather than reimplemented on purpose. This is the copy that was hardened after the
 * escalation defects, including the floor being consulted first so that a dangerous instruction the
 * user never asked for is caught even when no execution verb appears elsewhere in the body. A second
 * implementation would start from the version those fixes were made against.
 */
export function promptEnhancementGeneratedEscalatesAuthorityV1(
  originalPromptText: string,
  generatedBodyText: string,
): boolean {
  return generatedEscalatesAuthority(originalPromptText, generatedBodyText);
}

/**
 * The sensitive-action risk families a piece of text reads as, or an empty list.
 *
 * Sibling of `promptEnhancementAuthorityModeForTextV1`: the same question asked of a slice rather
 * than a whole prompt, so a sequence item can carry the risk family its own words imply instead of
 * inheriting one from the request it came from. Literal blocks are stripped before matching, which
 * is why quoted example commands do not register as risks — a behaviour a fresh implementation
 * would be unlikely to reproduce.
 */
export function promptEnhancementRiskKindsForTextV1(
  text: string,
): readonly PromptEnhancementSensitiveActionRiskKind[] {
  return classifyTextRiskKinds(text);
}

export function buildPromptEnhancementCanonicalConfirmation(originalPromptText: string): string {
  return `Still, before you do this ${specificSensitiveActionTextForPrompt(originalPromptText)} you must ask me for go-ahead confirmation.`;
}

function classifySensitiveActions(
  currentBody: Pick<PromptEnhancementCurrentBodyV1, 'sections' | 'originalPromptText'>,
  generatedBodyText: string,
  affectedActionIds: readonly string[] = [],
): readonly PromptEnhancementSensitiveActionFinding[] {
  const findings = new Map<PromptEnhancementSensitiveActionRiskKind, PromptEnhancementSensitiveActionFinding>();
  const originalAuthority = authorityModeFor(currentBody.originalPromptText);
  const sections = currentBody.sections.filter((section) => section.sectionKind !== 'original_request_or_goal');
  const generatedRiskText = generatedBodyText.replace(buildPromptEnhancementCanonicalConfirmation(currentBody.originalPromptText), '');
  const generatedAuthority = authorityModeFor(generatedRiskText);
  const textByRisk = `${stripLiteralBlocks(currentBody.originalPromptText)}\n${stripLiteralBlocks(generatedRiskText)}`;

  for (const [riskKind, pattern] of RISK_PATTERNS) {
    if (!pattern.test(textByRisk)) continue;
    const authorityMode: PromptEnhancementAuthorityMode = generatedAuthority === 'execute_requested' &&
      (originalAuthority === 'plan_or_review' || /\bdo\s+not\s+run\b/i.test(currentBody.originalPromptText))
      ? 'execute_generated_escalation'
      : generatedAuthority === 'execute_requested' || originalAuthority === 'execute_requested'
        ? 'execute_requested'
        : originalAuthority;
    // Every generated section, not a flag-selected subset. Whether a body carries something unsafe
    // is a property of its TEXT — the risk pattern above matched the whole body — so which sections
    // are affected cannot be answered by a planning flag.
    //
    // This used to filter on `safetyFlags.length > 0`, which looked selective and was not: three of
    // the four flag values are ROUTE capabilities stamped onto every section, so the filter admitted
    // everything. It only appeared to work because it never excluded anything. Reading it as a real
    // filter would have been the mistake the moment those flags were corrected to mean what the
    // design says they mean.
    const affectedSections = sections;
    findings.set(riskKind, {
      riskKind,
      authorityMode,
      requiresConfirmation: authorityMode === 'execute_requested' || authorityMode === 'execute_generated_escalation',
      affectedSectionIds: affectedSections.map((section) => section.sectionId),
      affectedBodySpanRefs: affectedSections.flatMap((section) => section.spanRefs.map((spanRef) => spanRef.spanRefId)),
      affectedActionIds,
      reasonCode: `sensitive_action:${riskKind}:${authorityMode}`,
    });
  }

  // The wide-scope fallback: no risk PATTERN matched, but the route still asked for confirmation.
  //
  // This is the only case the loop above cannot reach. `capability.confirmation_needed` can come
  // from ambiguity or missing acceptance facts rather than from risky wording, and then no pattern
  // matches while a section still carries the flag. That is a real gap in coverage and this closes
  // it.
  //
  // An earlier revision of this phase also OR'd in
  // `requiresPromptEnhancementExecutionConfirmationForPrompt`, on the theory that scoping the flags
  // could leave a confirmation-needed route with no flagged section. That condition can never fire:
  // it is `classifyTextRiskKinds(prompt).length > 0 && ...`, and `classifyTextRiskKinds` runs the
  // SAME `RISK_PATTERNS` the loop above runs against text that includes the prompt — so whenever it
  // is true, `findings` is already non-empty and this branch is skipped. It was dead code implying
  // a protection it did not provide, and it is removed rather than left to reassure a reader.
  for (const section of sections) {
    if (!section.safetyFlags.includes('sensitive_action_confirmation')) continue;
    if (findings.size === 0) {
      findings.set('wide_scope_or_boundary_expansion', {
        riskKind: 'wide_scope_or_boundary_expansion',
        authorityMode: generatedAuthority,
        requiresConfirmation: generatedAuthority === 'execute_requested',
        affectedSectionIds: [section.sectionId],
        affectedBodySpanRefs: section.spanRefs.map((spanRef) => spanRef.spanRefId),
        affectedActionIds,
        reasonCode: `sensitive_action:wide_scope_or_boundary_expansion:${generatedAuthority}`,
      });
    }
  }

  return [...findings.values()];
}

function authorityModeFor(text: string): PromptEnhancementAuthorityMode {
  const normalized = stripLiteralBlocks(text).replace(/\bdry\s+run\b/gi, 'dryruncheck');
  if (/\b(?:do\s+not|don't|dont|without)\s+(?:run|execute|deploy|delete|remove|migrate|install|force[-\s]?push|publish|post|notify)\b/i.test(normalized)) {
    return PLANNING_VERB.test(normalized) ? 'plan_or_review' : 'observe_or_literal';
  }
  if (PLANNING_VERB.test(normalized) && REVIEW_QUESTION_PATTERN.test(normalized) && EXECUTION_VERB.test(normalized)) {
    return 'plan_or_review';
  }
  if (EXECUTION_VERB.test(normalized)) return 'execute_requested';
  if (PLANNING_VERB.test(normalized)) return 'plan_or_review';
  return 'observe_or_literal';
}

/**
 * Actions dangerous enough to count as an authority escalation on sight, whatever surrounds them.
 * Deliberately tiny: only wording with no benign reading. This is the floor that sentence scoping
 * below can never soften.
 */
const ALWAYS_ESCALATE_PATTERN = /\b(?:force[-\s]?push|rm\s+-rf|drop\s+table|truncate|reset\s+--hard|rewrite\s+history)\b/i;

/**
 * Split generated wording into the units an execution verb and a risk term must SHARE to count as an
 * escalation.
 *
 * Splitting on newlines alone is not enough: a single rendered line can carry several numbered items
 * ("1. Execute automated tests… 2. Perform stress tests on database operations"), and treating that as
 * one unit lets `execute` pair with `database` from a different item — the exact false positive this
 * scoping exists to remove. Sentence boundaries are therefore split too.
 *
 * The lookahead requires an uppercase letter or digit after the terminator, so version numbers
 * (`v1.2`), file names (`package.json`) and `e.g.` stay intact instead of fragmenting a sentence and
 * hiding a genuine escalation.
 */
function authorityScopeUnits(text: string): readonly string[] {
  return text
    .split(/\r?\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-Z0-9])/))
    .map((unit) => unit.trim())
    .filter(Boolean);
}

/**
 * The verbs strong enough to raise an escalation on their own, as a deliberate subset of
 * `EXECUTION_VERB`.
 *
 * Sentence scoping alone did not fix the false positives, because `post`, `write`, `apply`, `modify`,
 * `notify` and `increase` are ordinary planning vocabulary that no verification or acceptance section
 * can avoid. Paired with any risk noun in the same sentence they escalated, so wording as plainly
 * non-executing as "Modify nothing yet; list the database changes we would need" and "Write down the
 * acceptance criteria for the schema change" was rejected — and `post` is worse still, since it is a
 * word boundary away from `post-migration` and `post-deployment`.
 *
 * ⚠️ This is a KNOWN, ACCEPTED narrowing, not a tidy-up. Wording such as "Write the new schema" or
 * "Apply the migration" no longer escalates by this rule; it is covered by `ALWAYS_ESCALATE_PATTERN`
 * only where that floor matches, and otherwise by the composer's authority self-report. The loss is
 * pinned by an explicit test so it can never be rediscovered by accident.
 *
 * `EXECUTION_VERB` itself is deliberately left untouched — it also drives authority-mode
 * classification and the edited-body checks, where the broader reading is correct.
 */
const ESCALATION_VERB =
  /\b(?:run|execute|deploy|delete|remove|migrate|install|force[-\s]?push|publish|rotate|truncate|drop|karo|kar\s+do|chalao|hatao|mitao)\b|(?:करो|कर\s*दो|चलाओ|हटाओ|मिटाओ|કરો|કરી\s*દો|ચલાવો|કાઢી\s*નાખો|મિટાવો)/i;

/**
 * Does the generated wording actually escalate, rather than merely contain an execution verb?
 *
 * Two conditions, both narrowing and neither able to make previously-safe wording escalate: the verb
 * must be one of the strong ones above, and a risk term must appear in the SAME unit. The unit rule
 * separates "execute the tests" from "execute the rollback"; body-level risk matching cannot, because
 * risk patterns fire on the prompt's topic (`database`, `upgrade`) rather than on the action.
 *
 * The floor is NOT tested here — it is tested by the caller, before the caller's own execution-mode
 * precondition, so that it genuinely applies unconditionally. See `generatedEscalatesAuthority`.
 */
function generatedRiskEscalationPresent(generatedText: string): boolean {
  return authorityScopeUnits(generatedText).some((unit) =>
    ESCALATION_VERB.test(unit) && RISK_PATTERNS.some(([, pattern]) => pattern.test(unit)),
  );
}

/**
 * Does the composer's own verdict amount to an escalation the deterministic floor would miss?
 *
 * Only ever returns `true` — it is OR-ed with the deterministic rule, so it can add a block and can
 * never remove one. An escalation is "a plan/review request answered with execution wording", so the
 * request must read as plan/review by EITHER the word list or the composer's own reading; relying on
 * the word list alone would reproduce, one layer up, the exact misreading this check exists to cover.
 */
function composerReportsEscalation(
  originalPromptText: string,
  report: PromptEnhancementSafetyValidationInput['composerAuthoritySelfReport'],
): boolean {
  if (report?.generatedMode !== 'execute_requested') return false;
  return authorityModeFor(originalPromptText) === 'plan_or_review' || report.requestMode === 'plan_or_review';
}

function generatedEscalatesAuthority(originalPromptText: string, generatedBodyText: string): boolean {
  const originalAuthority = authorityModeFor(originalPromptText);
  const generatedRiskText = generatedBodyText.replace(buildPromptEnhancementCanonicalConfirmation(originalPromptText), '');

  // ── The floor ────────────────────────────────────────────────────────────────────────────────
  // Consulted FIRST, its own match is sufficient, and it asks "did the user ask for the dangerous
  // thing?" rather than "did the user ask to plan?".
  //
  // Two separate defects were fixed here, both of which let floor wording through:
  //
  // 1. It used to sit BELOW the execution-mode precondition further down, which is decided by
  //    `EXECUTION_VERB` — and `reset --hard` and `rewrite history` are in the floor but in NO
  //    execution-verb list, so standing alone they never reached the floor at all. "Use reset --hard
  //    to clear the working tree" passed while "Run the cleanup, then use reset --hard" blocked: an
  //    unrelated word elsewhere in the body decided whether the safety net existed.
  //
  // 2. It used to require the request to read as `plan_or_review`, which silently excluded
  //    `observe_or_literal` — "Walk me through how the refunds flow behaves today" is not a planning
  //    request, and answering it with `rm -rf` is exactly as unrequested. Widening the mode
  //    classification instead would have mislabelled ordinary questions as planning; the request mode
  //    is right, the CONDITION was wrong. Only an explicit execution request earns the exemption.
  //
  // Deliberate WIDENING of a safety rule, on the owner's ruling that a higher block rate is an
  // accepted cost where safety is concerned. Bounded: it is the floor only — wording with no benign
  // reading — and an explicit execution request is still honoured.
  if (originalAuthority !== 'execute_requested' && ALWAYS_ESCALATE_PATTERN.test(generatedRiskText)) {
    return true;
  }

  // ── Everything above the floor ───────────────────────────────────────────────────────────────
  // Unchanged, and still scoped to plan/review requests: outside the floor, an escalation only means
  // anything as "a plan/review request answered with execution wording".
  if (originalAuthority !== 'plan_or_review') return false;
  if (authorityModeFor(generatedRiskText) !== 'execute_requested') return false;
  // Pure narrowing: both original conditions still hold above, and this can only turn a `true` into a
  // `false`. It can never make previously-safe wording escalate.
  return generatedRiskEscalationPresent(generatedRiskText);
}

function addsSensitiveExecution(previousBodyText: string, editedBodyText: string): boolean {
  const previousRisks = classifyTextRiskKinds(previousBodyText);
  const editedRisks = classifyTextRiskKinds(editedBodyText);
  if (!EXECUTION_VERB.test(stripLiteralBlocks(editedBodyText))) return false;
  return editedRisks.some((risk) => !previousRisks.includes(risk));
}

function sourceHonestyFloorRemoved(previousBodyText: string, editedBodyText: string): boolean {
  return countOccurrences(previousBodyText, 'Source basis:') > countOccurrences(editedBodyText, 'Source basis:') ||
    countOccurrences(previousBodyText, 'Source ids stay in typed metadata') > countOccurrences(editedBodyText, 'Source ids stay in typed metadata');
}

function classifyTextRiskKinds(text: string): readonly PromptEnhancementSensitiveActionRiskKind[] {
  const normalized = stripLiteralBlocks(text);
  return RISK_PATTERNS
    .filter(([, pattern]) => pattern.test(normalized))
    .map(([riskKind]) => riskKind);
}

function renderedMetadataIdPresent(
  currentBody: Pick<PromptEnhancementCurrentBodyV1, 'sourceAttribution' | 'sections'>,
  generatedBodyText: string,
): boolean {
  const lowerGenerated = generatedBodyText.toLowerCase();
  const metadataIds = unique([
    ...currentBody.sourceAttribution.flatMap((sourceRef) => [
      sourceRef.sourceRefId,
      sourceRef.sourceId,
    ]),
    ...currentBody.sections.flatMap((section) => [
      section.sectionId,
      ...section.sourceFactIds,
      ...section.spanRefs.flatMap((spanRef) => [
        spanRef.spanRefId,
        ...spanRef.sourceRefs,
      ]),
    ]),
  ].filter((value): value is string => value.length > 0));
  return metadataIds.some((metadataId) => lowerGenerated.includes(metadataId.toLowerCase()));
}

function generatedOnlyText(bodyText: string, originalPromptText: string): string {
  const withoutOriginalHeading = bodyText.replace(
    new RegExp(`${escapeRegExp('My original request (verbatim)')}:\\s*${escapeRegExp(originalPromptText)}`, 'i'),
    '',
  );
  return withoutOriginalHeading;
}

function sourceLiteralAwareVoicePolicyText(generatedBodyText: string): string {
  return generatedBodyText
    .split(/\r?\n/)
    .map((line) => isExplicitSourceLiteralLine(line) ? stripInlineLiteralText(line) : line)
    .join('\n');
}

function isExplicitSourceLiteralLine(line: string): boolean {
  return /^\s*-\s*(?:search|find|look\s+for|preserve|compare|match|include)\b/i.test(line) &&
    /\b(?:exact\s+string|literal|code|error|path|log)\b/i.test(line) &&
    /`[^`]+`|"[^"]+"/.test(line);
}

function stripInlineLiteralText(line: string): string {
  return line.replace(/`[^`]+`|"[^"]+"/g, '<source_literal>');
}

function hasCanonicalConfirmation(bodyText: string, expectedConfirmation: string): boolean {
  return bodyText.includes(expectedConfirmation);
}

function confirmationBypassPresent(generatedBodyText: string, expectedConfirmation: string): boolean {
  const generatedWithoutCanonicalConfirmation = generatedBodyText.replaceAll(expectedConfirmation, '');
  return CONFIRMATION_BYPASS_PATTERNS.some((pattern) => pattern.test(generatedWithoutCanonicalConfirmation));
}

function laterSensitiveExecutionAfterConfirmation(
  generatedBodyText: string,
  expectedConfirmation: string,
  originalPromptText: string,
): boolean {
  const confirmationOffset = generatedBodyText.lastIndexOf(expectedConfirmation);
  if (confirmationOffset < 0) return false;
  const laterText = generatedBodyText.slice(confirmationOffset + expectedConfirmation.length);
  const normalizedLaterText = stripLiteralBlocks(laterText);
  if (!EXECUTION_VERB.test(normalizedLaterText)) return false;
  return classifyTextRiskKinds(normalizedLaterText).length > 0 ||
    laterTextRefersToOriginalSensitiveAction(normalizedLaterText, originalPromptText);
}

function laterTextRefersToOriginalSensitiveAction(laterText: string, originalPromptText: string): boolean {
  if (authorityModeFor(originalPromptText) !== 'execute_requested' || classifyTextRiskKinds(originalPromptText).length === 0) {
    return false;
  }
  return /\b(?:it|this|that|the\s+(?:change|action|step|release|deploy(?:ment)?|migration|database|schema|env(?:ironment)?|token|credential|dependency|package|branch|permission|rollout))\b/i.test(laterText);
}

function specificSensitiveActionTextForPrompt(originalPromptText: string): string {
  const riskKinds = classifyTextRiskKinds(originalPromptText);
  const normalized = originalPromptText.toLowerCase();
  const hasDataOrSchemaAction = riskKinds.includes('destructive_data_or_schema');
  const hasExplicitReleaseVerb = /\b(?:deploy|release|publish|post|notify|customer|external|go\s+live)\b/.test(normalized);
  const actionPhrases = riskKinds.flatMap((riskKind) => {
    switch (riskKind) {
      case 'destructive_data_or_schema':
        return [/\bproduction\b/.test(normalized) ? 'production migration or data/schema change' : 'data/schema change'];
      case 'production_release_or_external_effect':
        if (hasDataOrSchemaAction && !hasExplicitReleaseVerb) return [];
        if (/\b(?:post|notify|customer|external)\b/.test(normalized)) return ['public or customer-facing communication'];
        // ⛔ NOT "production deploy or release". That phrase contained the bare verb `deploy`, which
        // EXECUTION_VERB and ESCALATION_VERB both hunt — so the safety sentence tripped the escalation
        // scanners, and was only harmless because the stripper removes it before scanning. That made a
        // wording change in one place and not the other able to block a body for carrying its own safety
        // clause. Measured 2026-08-23: of the nine phrases this function emits, that was the only one
        // that was not inert. This wording carries the same meaning and trips nothing.
        return ['production release or rollout'];
      case 'secret_env_or_credential':
        return ['referenced credential or environment change'];
      case 'dependency_or_toolchain_change':
        return ['dependency or toolchain change'];
      case 'destructive_filesystem_or_codebase':
        return ['destructive file or codebase change'];
      case 'git_history_rewrite':
        return ['git history or branch change'];
      case 'security_auth_permission':
        return ['security, auth, or permission change'];
      case 'cost_or_resource':
        return ['cost or resource-changing operation'];
      case 'wide_scope_or_boundary_expansion':
        return ['broad-scope codebase change'];
      case 'agent_mode_or_permission_boundary':
        return ['agent mode or permission-boundary change'];
    }
  });
  const uniquePhrases = unique(actionPhrases);
  if (uniquePhrases.length === 0) return 'sensitive action';
  if (uniquePhrases.length === 1) return uniquePhrases[0] ?? 'sensitive action';
  return `${uniquePhrases.slice(0, -1).join(', ')}, and ${uniquePhrases[uniquePhrases.length - 1]}`;
}

function stripLiteralBlocks(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/"[^"]*"/g, ' ');
}

function generatedSectionIds(currentBody: Pick<PromptEnhancementCurrentBodyV1, 'sections'>): readonly string[] {
  return currentBody.sections
    .filter((section) => section.sectionKind !== 'original_request_or_goal')
    .map((section) => section.sectionId);
}

function generatedSpanRefs(currentBody: Pick<PromptEnhancementCurrentBodyV1, 'sections'>): readonly string[] {
  return currentBody.sections
    .filter((section) => section.sectionKind !== 'original_request_or_goal')
    .flatMap((section) => section.spanRefs.map((spanRef) => spanRef.spanRefId));
}

function generatedSourceRefs(currentBody: Pick<PromptEnhancementCurrentBodyV1, 'sections'>): readonly string[] {
  return unique(currentBody.sections
    .filter((section) => section.sectionKind !== 'original_request_or_goal')
    .flatMap((section) => section.spanRefs.flatMap((spanRef) => spanRef.sourceRefs)));
}

function sensitiveActionSectionIds(
  currentBody: Pick<PromptEnhancementCurrentBodyV1, 'sections'>,
  findings: readonly PromptEnhancementSensitiveActionFinding[],
): readonly string[] {
  const sectionIds = unique(findings.flatMap((finding) => finding.affectedSectionIds));
  if (sectionIds.length > 0) return sectionIds;
  return generatedSectionIds(currentBody);
}

function hasFailurePrefix(failures: readonly PromptEnhancementValidationFailureV1[], prefix: string): boolean {
  return failures.some((failureItem) => failureItem.failureCode.startsWith(prefix));
}

function phaseState(
  stage: PromptEnhancementValidationStage,
  failures: readonly PromptEnhancementValidationFailureV1[],
  hasBlockingFailure: boolean,
  fallbackMode: PromptEnhancementFallbackMode,
): PromptEnhancementValidationPhaseStateV1 {
  const stageFailures = failures.filter((failureItem) => failureItem.stage === stage);
  return {
    stage,
    status: stageFailures.length > 0
      ? 'invalid_non_sendable'
      : hasBlockingFailure && (stage === 'delivery' || stage === 'action')
        ? 'invalid_non_sendable'
        : 'valid',
    fallbackMode,
    failureCodes: stageFailures.map((failureItem) => failureItem.failureCode),
    publicSafeReasonCategory: stageFailures.length > 0 ? 'validation_failed' : 'generated',
  };
}

function runPromptEnhancementPhaseValidators(
  context: PromptEnhancementValidationPhaseContext,
): readonly PromptEnhancementValidationPhaseStateV1[] {
  return PROMPT_ENHANCEMENT_VALIDATION_STAGES.map((stage) =>
    PROMPT_ENHANCEMENT_PHASE_VALIDATORS[stage](context));
}

function runPromptEnhancementOriginalOnlyPhaseValidators(
  fallbackMode: PromptEnhancementFallbackMode,
): readonly PromptEnhancementValidationPhaseStateV1[] {
  return PROMPT_ENHANCEMENT_VALIDATION_STAGES.map((stage) => ({
    stage,
    status: stage === 'action' || stage === 'delivery' || stage === 'final_body' ? 'original_only' : 'valid',
    fallbackMode,
    failureCodes: [],
    publicSafeReasonCategory: 'fallback_or_no_popup',
  }));
}

export function validatePromptEnhancementRequestPhase(
  context: PromptEnhancementValidationPhaseContext,
): PromptEnhancementValidationPhaseStateV1 {
  return phaseState('request', context.failures, context.hasBlockingFailure, context.fallbackMode);
}

export function validatePromptEnhancementPrePlanPhase(
  context: PromptEnhancementValidationPhaseContext,
): PromptEnhancementValidationPhaseStateV1 {
  return phaseState('pre_plan', context.failures, context.hasBlockingFailure, context.fallbackMode);
}

export function validatePromptEnhancementSectionPlanPhase(
  context: PromptEnhancementValidationPhaseContext,
): PromptEnhancementValidationPhaseStateV1 {
  return phaseState('section_plan', context.failures, context.hasBlockingFailure, context.fallbackMode);
}

export function validatePromptEnhancementComposerInputPhase(
  context: PromptEnhancementValidationPhaseContext,
): PromptEnhancementValidationPhaseStateV1 {
  return phaseState('composer_input', context.failures, context.hasBlockingFailure, context.fallbackMode);
}

export function validatePromptEnhancementComposerOutputPhase(
  context: PromptEnhancementValidationPhaseContext,
): PromptEnhancementValidationPhaseStateV1 {
  return phaseState('composer_output', context.failures, context.hasBlockingFailure, context.fallbackMode);
}

export function validatePromptEnhancementFinalBodyPhase(
  context: PromptEnhancementValidationPhaseContext,
): PromptEnhancementValidationPhaseStateV1 {
  return phaseState('final_body', context.failures, context.hasBlockingFailure, context.fallbackMode);
}

export function validatePromptEnhancementUserEditPhase(
  context: PromptEnhancementValidationPhaseContext,
): PromptEnhancementValidationPhaseStateV1 {
  return phaseState('user_edit', context.failures, context.hasBlockingFailure, context.fallbackMode);
}

export function validatePromptEnhancementActionPhase(
  context: PromptEnhancementValidationPhaseContext,
): PromptEnhancementValidationPhaseStateV1 {
  return phaseState('action', context.failures, context.hasBlockingFailure, context.fallbackMode);
}

export function validatePromptEnhancementDeliveryPhase(
  context: PromptEnhancementValidationPhaseContext,
): PromptEnhancementValidationPhaseStateV1 {
  return phaseState('delivery', context.failures, context.hasBlockingFailure, context.fallbackMode);
}

export function validatePromptEnhancementStoragePhase(
  context: PromptEnhancementValidationPhaseContext,
): PromptEnhancementValidationPhaseStateV1 {
  return phaseState('storage', context.failures, context.hasBlockingFailure, context.fallbackMode);
}

export function validatePromptEnhancementSourceUsePhase(
  context: PromptEnhancementValidationPhaseContext,
): PromptEnhancementValidationPhaseStateV1 {
  return phaseState('source_use', context.failures, context.hasBlockingFailure, context.fallbackMode);
}

export function validatePromptEnhancementPrivacyPhase(
  context: PromptEnhancementValidationPhaseContext,
): PromptEnhancementValidationPhaseStateV1 {
  return phaseState('privacy', context.failures, context.hasBlockingFailure, context.fallbackMode);
}

export function validatePromptEnhancementHandoffPhase(
  context: PromptEnhancementValidationPhaseContext,
): PromptEnhancementValidationPhaseStateV1 {
  return phaseState('handoff', context.failures, context.hasBlockingFailure, context.fallbackMode);
}

export function validatePromptEnhancementSequencePhase(
  context: PromptEnhancementValidationPhaseContext,
): PromptEnhancementValidationPhaseStateV1 {
  return phaseState('sequence', context.failures, context.hasBlockingFailure, context.fallbackMode);
}

export function validatePromptEnhancementLaunchCheckPhase(
  context: PromptEnhancementValidationPhaseContext,
): PromptEnhancementValidationPhaseStateV1 {
  return phaseState('launch_check', context.failures, context.hasBlockingFailure, context.fallbackMode);
}

function optionalCallAvailabilityStateFor(
  callVisibilityMode: PromptEnhancementCallVisibilityMode,
): PromptEnhancementValidationGraphV1['optionalCallAvailabilityState'] {
  if (callVisibilityMode === 'llm_wording') return 'allowed';
  if (callVisibilityMode === 'provider_unavailable') return 'unavailable_by_provider_api';
  if (callVisibilityMode === 'not_applicable') return 'product_scope_not_in_v1';
  return 'deterministic_only';
}

function failure(input: {
  failureCode: string;
  stage: PromptEnhancementValidationStage;
  affectedSectionIds: readonly string[];
  affectedBodySpanRefs?: readonly string[];
  affectedSourceRefIds?: readonly string[];
  affectedActionIds?: readonly string[];
  publicSafeReasonCategory?: PromptEnhancementPublicDiagnosticCategory;
}): PromptEnhancementValidationFailureV1 {
  return {
    failureCode: input.failureCode,
    stage: input.stage,
    severity: 'blocking',
    blocking: true,
    affectedSectionIds: input.affectedSectionIds,
    affectedBodySpanRefs: input.affectedBodySpanRefs ?? [],
    affectedSourceRefIds: input.affectedSourceRefIds ?? [],
    affectedActionIds: input.affectedActionIds ?? [],
    publicSafeReasonCategory: input.publicSafeReasonCategory ?? 'validation_failed',
    privateDebugDetailPolicy: 'bounded_local_only',
  };
}

function unique<T>(values: readonly T[]): readonly T[] {
  return [...new Set(values)];
}

function countOccurrences(value: string, search: string): number {
  return value.split(search).length - 1;
}

function estimateBodyTokens(value: string): number {
  const nonWhitespace = value.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(0, Math.ceil(nonWhitespace * 1.35));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
