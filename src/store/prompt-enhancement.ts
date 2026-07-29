import { saveStore, type Store } from './db.js';
import { SCHEMA_VERSION } from './schema.js';

export type PromptEnhancementMemoryEvidenceState = 'live_current' | 'historical_candidate' | 'feedback_derived' | 'unknown_neutral';
export type PromptEnhancementMemoryConfidenceBand = 'low' | 'medium' | 'high';
export type PromptEnhancementMemorySourceStrength = 'weak' | 'moderate' | 'strong';
export type PromptEnhancementMemoryProtectionState = 'none' | 'current_source_a' | 'safety_protected' | 'mandatory_protected' | 'high_risk_protected';
export type PromptEnhancementMemoryFatigueState = 'none' | 'candidate' | 'fatigued';
export type PromptEnhancementMemorySuppressionState = 'none' | 'candidate_scoped' | 'suppressed_scoped';
export type PromptEnhancementMemoryStatus = 'qualified' | 'candidate' | 'decayed' | 'disabled_by_policy' | 'malformed_ignored';
export type PromptEnhancementFeedbackCategory =
  | 'surface_exposed'
  | 'accept_send'
  | 'use_original'
  | 'close_no_send'
  | 'edit'
  | 'edit_before_send'
  | 'skip_cancel'
  | 'reject'
  | 'remove'
  | 'not_needed'
  | 'directional_action'
  | 'additional_details_apply'
  | 'fallback'
  | 'multi_prompt_disposition'
  | 'not_relevant_enough'
  | 'too_much_or_too_long'
  | 'too_long'
  | 'too_shallow'
  | 'not_project_grounded'
  | 'wrong_tone'
  | 'custom_typed'
  | 'section_removed_by_edit'
  | 'user_deleted_generated_section'
  | 'action_result_rejected';

export interface PromptEnhancementMemoryRow {
  projectRoot: string;
  signalKey: string;
  schemaVersion: number;
  evidenceCount: number;
  positiveCount: number;
  negativeCount: number;
  currentEvidenceState: PromptEnhancementMemoryEvidenceState;
  confidenceBand: PromptEnhancementMemoryConfidenceBand;
  sourceStrength: PromptEnhancementMemorySourceStrength;
  protectionState: PromptEnhancementMemoryProtectionState;
  fatigueState: PromptEnhancementMemoryFatigueState;
  suppressionState: PromptEnhancementMemorySuppressionState;
  lastUsedAt: number | null;
  lastEvidenceAt: number | null;
  decayAfter: number | null;
  status: PromptEnhancementMemoryStatus;
  reasonCodes: readonly string[];
  provenance: {
    promptIntent?: string;
    templateFamily?: string;
    sourceIds: readonly string[];
    sectionIds: readonly string[];
    memoryEvidenceOnly: true;
    rawTextStored: false;
  };
  createdAt: number;
  updatedAt: number;
}

export interface PromptEnhancementMemoryEvidenceInput {
  projectRoot: string;
  signalKey: string;
  evidenceKind: 'positive' | 'negative' | 'neutral';
  currentEvidenceState: PromptEnhancementMemoryEvidenceState;
  confidenceBand: PromptEnhancementMemoryConfidenceBand;
  sourceStrength: PromptEnhancementMemorySourceStrength;
  protectionState?: PromptEnhancementMemoryProtectionState;
  fatigueState?: PromptEnhancementMemoryFatigueState;
  suppressionState?: PromptEnhancementMemorySuppressionState;
  status?: PromptEnhancementMemoryStatus;
  reasonCodes?: readonly string[];
  promptIntent?: string;
  templateFamily?: string;
  sourceIds?: readonly string[];
  sectionIds?: readonly string[];
  decayAfter?: number | null;
  now?: number;
}

export interface PromptEnhancementSourceUseInput {
  sourceUseId: string;
  projectRoot: string;
  enhancementId: string;
  bodyId: string;
  bodyRevision: number;
  sourceKind: string;
  sourceId: string;
  sectionIds?: readonly string[];
  useKind: 'body_section' | 'trust_cue' | 'fallback_reason' | 'handoff_metadata';
  memoryEvidence?: boolean;
  reasonCodes?: readonly string[];
  now?: number;
}

export interface PromptEnhancementMemoryUseInput {
  sourceUseId: string;
  enhancementId: string;
  bodyId: string;
  bodyRevision: number;
  useKind?: PromptEnhancementSourceUseInput['useKind'];
  reasonCodes?: readonly string[];
}

export interface PromptEnhancementLearningEligibilityFlags {
  promptHistory: boolean;
  profile: boolean;
  stage: boolean;
  language: boolean;
  missingSignalMemory: boolean;
  feedback: boolean;
  telemetry: boolean;
  sourceUseTracking: boolean;
}

export interface PromptEnhancementGeneratedOriginInput {
  generatedOriginId: string;
  projectRoot: string;
  enhancementId: string;
  bodyId: string;
  bodyRevision: number;
  generatedOriginState: string;
  deliveryChannel: string;
  promptSubmitProcessingPolicy: string;
  learningEligible?: boolean;
  learningEligibilityFlags?: Partial<PromptEnhancementLearningEligibilityFlags>;
  sourceUseIds?: readonly string[];
  actionIds?: readonly string[];
  fallbackState?: string;
  privacyStoragePolicy?: string;
  reasonCodes?: readonly string[];
  now?: number;
}

export interface PromptEnhancementFeedbackInput {
  feedbackEventId: string;
  projectRoot: string;
  enhancementId: string;
  bodyId: string;
  bodyRevision: number;
  feedbackCategory: PromptEnhancementFeedbackCategory;
  feedbackScopeKey: string;
  learningEligibility: 'eligible_scoped' | 'not_eligible' | 'pending_policy';
  safetyImpactState: 'none' | 'safety_floor_touched' | 'source_floor_touched' | 'unknown';
  memoryEvidence?: boolean;
  reasonCodes?: readonly string[];
  now?: number;
}

export interface PromptEnhancementPreparedBodyInput {
  preparedBodyId: string;
  projectRoot: string;
  enhancementId: string;
  bodyId: string;
  bodyRevision: number;
  generatedOriginState: 'pe_generated_body' | 'user_edited_pe_body' | 'user_original' | 'old_ds_injected_text' | 'ordinary_user_prompt' | string;
  deliveryChannel: string;
  promptSubmitProcessingPolicy: string;
  learningEligible?: boolean;
  learningEligibilityFlags?: Partial<PromptEnhancementLearningEligibilityFlags>;
  sourceUseIds?: readonly string[];
  actionIds?: readonly string[];
  fallbackState?: string;
  privacyStoragePolicy?: string;
  reasonCodes?: readonly string[];
  now?: number;
}

export interface PromptEnhancementExposureInput {
  exposureEventId: string;
  projectRoot: string;
  enhancementId: string;
  bodyId: string;
  bodyRevision: number;
  exposureState: string;
  actionAvailabilityState: string;
  reasonCodes?: readonly string[];
  now?: number;
}

export interface PromptEnhancementActionInput {
  actionEventId: string;
  projectRoot: string;
  enhancementId: string;
  bodyId: string;
  bodyRevision: number;
  actionCategory: PromptEnhancementFeedbackCategory;
  feedbackScopeKey?: string;
  learningEligibility?: PromptEnhancementFeedbackInput['learningEligibility'];
  safetyImpactState?: PromptEnhancementFeedbackInput['safetyImpactState'];
  memoryEvidence?: boolean;
  reasonCodes?: readonly string[];
  now?: number;
}

export interface PromptEnhancementStatusInput {
  projectRoot: string;
  statusKey: string;
  statusValue: string;
  now?: number;
}

export interface PromptEnhancementStoreStatus {
  projectRoot?: string;
  schemaVersion: number;
  enabledState: 'local_store_enabled' | 'policy_disabled_or_no_data';
  memoryRows: number;
  sourceUseRows: number;
  generatedOriginRows: number;
  feedbackRows: number;
  statusRows: number;
  globalMemoryRows: number;
  globalSourceUseRows: number;
  globalGeneratedOriginRows: number;
  globalFeedbackRows: number;
  globalStatusRows: number;
  estimatedBytes: number;
  exportedDbBytes: number;
  capState: 'within_bounds' | 'over_row_cap_pruned' | 'policy_disabled_or_no_data';
  rowCapState: 'within_bounds' | 'over_row_cap_pruned' | 'policy_disabled_or_no_data';
  byteThresholdState: 'within_bounds' | 'over_byte_threshold_pruned' | 'policy_disabled_or_no_data';
  lastCleanupOutcome: string;
  telemetryPolicy: 'ids_enums_counts_status_timing_only';
  rawContentStoredByDefault: false;
  oldStoreSurfacesAreAuthority: false;
  reasonCodes: readonly string[];
  lastPruneAt: number | null;
  lastDecayAt: number | null;
  fallbackCount: number;
  errorCount: number;
}

export interface PromptEnhancementPruneResult {
  deletedRows: number;
  decayedRows: number;
  reasonCodes: readonly string[];
}

export interface PromptEnhancementGeneratedOriginResolution {
  generatedOriginId: string;
  projectRoot: string;
  enhancementId: string;
  bodyId: string;
  bodyRevision: number;
  generatedOriginState: string;
  deliveryChannel: string;
  promptSubmitProcessingPolicy: string;
  learningEligible: boolean;
  learningEligibilityFlags: PromptEnhancementLearningEligibilityFlags;
  sourceUseIds: readonly string[];
  actionIds: readonly string[];
  fallbackState: string;
  privacyStoragePolicy: string;
  reasonCodes: readonly string[];
  createdAt: number;
}

export interface PromptEnhancementFeedbackSummary {
  projectRoot: string;
  feedbackScopeKey?: string;
  totalEvents: number;
  categoryCounts: readonly { feedbackCategory: string; count: number }[];
  memoryEvidenceEvents: number;
  rawTextStoredEvents: number;
}

export interface PromptEnhancementSourceUseSummary {
  projectRoot: string;
  bodyId?: string;
  totalSourceUses: number;
  sourceKindCounts: readonly { sourceKind: string; count: number }[];
  useKindCounts: readonly { useKind: string; count: number }[];
  memoryEvidenceRows: number;
}

const MEMORY_EVIDENCE_KINDS = ['positive', 'negative', 'neutral'] as const;
const MEMORY_EVIDENCE_STATES: readonly PromptEnhancementMemoryEvidenceState[] = ['live_current', 'historical_candidate', 'feedback_derived', 'unknown_neutral'];
const MEMORY_CONFIDENCE_BANDS: readonly PromptEnhancementMemoryConfidenceBand[] = ['low', 'medium', 'high'];
const MEMORY_SOURCE_STRENGTHS: readonly PromptEnhancementMemorySourceStrength[] = ['weak', 'moderate', 'strong'];
const MEMORY_PROTECTION_STATES: readonly PromptEnhancementMemoryProtectionState[] = ['none', 'current_source_a', 'safety_protected', 'mandatory_protected', 'high_risk_protected'];
const MEMORY_FATIGUE_STATES: readonly PromptEnhancementMemoryFatigueState[] = ['none', 'candidate', 'fatigued'];
const MEMORY_SUPPRESSION_STATES: readonly PromptEnhancementMemorySuppressionState[] = ['none', 'candidate_scoped', 'suppressed_scoped'];
const MEMORY_STATUSES: readonly PromptEnhancementMemoryStatus[] = ['qualified', 'candidate', 'decayed', 'disabled_by_policy', 'malformed_ignored'];
const SOURCE_USE_KINDS: readonly PromptEnhancementSourceUseInput['useKind'][] = ['body_section', 'trust_cue', 'fallback_reason', 'handoff_metadata'];
const FEEDBACK_CATEGORIES: readonly PromptEnhancementFeedbackCategory[] = [
  'surface_exposed',
  'accept_send',
  'use_original',
  'close_no_send',
  'edit',
  'edit_before_send',
  'skip_cancel',
  'reject',
  'remove',
  'not_needed',
  'directional_action',
  'additional_details_apply',
  'fallback',
  'multi_prompt_disposition',
  'not_relevant_enough',
  'too_much_or_too_long',
  'too_long',
  'too_shallow',
  'not_project_grounded',
  'wrong_tone',
  'custom_typed',
  'section_removed_by_edit',
  'user_deleted_generated_section',
  'action_result_rejected',
];
const FEEDBACK_LEARNING_ELIGIBILITY: readonly PromptEnhancementFeedbackInput['learningEligibility'][] = ['eligible_scoped', 'not_eligible', 'pending_policy'];
const FEEDBACK_SAFETY_IMPACT_STATES: readonly PromptEnhancementFeedbackInput['safetyImpactState'][] = ['none', 'safety_floor_touched', 'source_floor_touched', 'unknown'];

const SELECT_MEMORY = `
  project_root, signal_key, schema_version, evidence_count, positive_count, negative_count,
  current_evidence_state, confidence_band, source_strength, protection_state, fatigue_state,
  suppression_state, last_used_at, last_evidence_at, decay_after, status, reason_codes_json,
  provenance_json, created_at, updated_at
`;

export function queryRelevantPromptEnhancementMemory(
  store: Store,
  projectRoot: string,
  signalKeys: readonly string[],
): PromptEnhancementMemoryRow[] {
  const stableSignalKeys = cleanPublicSafeTokens(signalKeys);
  if (!projectRoot || stableSignalKeys.length === 0) return [];
  const placeholders = stableSignalKeys.map(() => '?').join(', ');
  const res = store.db.exec(
    `SELECT ${SELECT_MEMORY}
       FROM prompt_enhancement_memory
      WHERE project_root = ?
        AND signal_key IN (${placeholders})
        AND schema_version <= ?
        AND status IN ('qualified', 'candidate', 'decayed')
      ORDER BY
        CASE protection_state
          WHEN 'safety_protected' THEN 0
          WHEN 'mandatory_protected' THEN 1
          WHEN 'current_source_a' THEN 2
          WHEN 'high_risk_protected' THEN 3
          ELSE 4
        END ASC,
        updated_at DESC,
        signal_key ASC`,
    [projectRoot, ...stableSignalKeys, SCHEMA_VERSION],
  );
  return (res[0]?.values ?? []).map(mapMemoryRow).filter((row): row is PromptEnhancementMemoryRow => row !== null);
}

export function recordPromptEnhancementMemoryEvidence(
  store: Store,
  input: PromptEnhancementMemoryEvidenceInput,
): PromptEnhancementMemoryRow {
  assertMemoryEvidenceInput(input);
  const now = input.now ?? Date.now();
  const existing = getPromptEnhancementMemory(store, input.projectRoot, input.signalKey);
  const positiveDelta = input.evidenceKind === 'positive' ? 1 : 0;
  const negativeDelta = input.evidenceKind === 'negative' ? 1 : 0;
  const existingProvenance = existing?.provenance;
  const provenance = {
    promptIntent: cleanOptionalPublicSafeToken(input.promptIntent) ?? existingProvenance?.promptIntent,
    templateFamily: cleanOptionalPublicSafeToken(input.templateFamily) ?? existingProvenance?.templateFamily,
    sourceIds: unionStrings(existingProvenance?.sourceIds ?? [], cleanPublicSafeTokens(input.sourceIds ?? [])),
    sectionIds: unionStrings(existingProvenance?.sectionIds ?? [], cleanPublicSafeTokens(input.sectionIds ?? [])),
    memoryEvidenceOnly: true as const,
    rawTextStored: false as const,
  };
  const reasonCodes = unionStrings(existing?.reasonCodes ?? [], cleanPublicSafeTokens(input.reasonCodes ?? []));
  store.db.run(
    `INSERT INTO prompt_enhancement_memory
       (project_root, signal_key, schema_version, evidence_count, positive_count, negative_count,
        current_evidence_state, confidence_band, source_strength, protection_state, fatigue_state,
        suppression_state, last_used_at, last_evidence_at, decay_after, status, reason_codes_json,
        provenance_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_root, signal_key) DO UPDATE SET
       schema_version = excluded.schema_version,
       evidence_count = excluded.evidence_count,
       positive_count = excluded.positive_count,
       negative_count = excluded.negative_count,
       current_evidence_state = excluded.current_evidence_state,
       confidence_band = excluded.confidence_band,
       source_strength = excluded.source_strength,
       protection_state = excluded.protection_state,
       fatigue_state = excluded.fatigue_state,
       suppression_state = excluded.suppression_state,
       last_evidence_at = excluded.last_evidence_at,
       decay_after = excluded.decay_after,
       status = excluded.status,
       reason_codes_json = excluded.reason_codes_json,
       provenance_json = excluded.provenance_json,
       updated_at = excluded.updated_at`,
    [
      input.projectRoot,
      input.signalKey,
      SCHEMA_VERSION,
      (existing?.evidenceCount ?? 0) + 1,
      (existing?.positiveCount ?? 0) + positiveDelta,
      (existing?.negativeCount ?? 0) + negativeDelta,
      input.currentEvidenceState,
      input.confidenceBand,
      input.sourceStrength,
      input.protectionState ?? existing?.protectionState ?? 'none',
      input.fatigueState ?? existing?.fatigueState ?? 'none',
      input.suppressionState ?? existing?.suppressionState ?? 'none',
      existing?.lastUsedAt ?? null,
      now,
      input.decayAfter ?? existing?.decayAfter ?? null,
      input.status ?? existing?.status ?? 'candidate',
      JSON.stringify(reasonCodes),
      JSON.stringify(provenance),
      existing?.createdAt ?? now,
      now,
    ],
  );
  setPromptEnhancementStatus(store, {
    projectRoot: input.projectRoot,
    statusKey: 'last_memory_evidence',
    statusValue: JSON.stringify({
      signalKey: input.signalKey,
      evidenceKind: input.evidenceKind,
      currentEvidenceState: input.currentEvidenceState,
      confidenceBand: input.confidenceBand,
      sourceStrength: input.sourceStrength,
      status: input.status ?? existing?.status ?? 'candidate',
      at: now,
    }),
    now,
  });
  saveStore(store);
  return getPromptEnhancementMemory(store, input.projectRoot, input.signalKey) as PromptEnhancementMemoryRow;
}

export function markPromptEnhancementMemoryUsed(
  store: Store,
  projectRoot: string,
  signalKey: string,
  now: number = Date.now(),
  usage?: PromptEnhancementMemoryUseInput,
): boolean {
  assertProjectSignal(projectRoot, signalKey);
  if (usage) assertMemoryUseInput(usage);
  if (usage && sourceUseExists(store, usage.sourceUseId)) return true;
  store.db.run(
    `UPDATE prompt_enhancement_memory
        SET last_used_at = ?, updated_at = ?
      WHERE project_root = ? AND signal_key = ? AND schema_version <= ?`,
    [now, now, projectRoot, signalKey, SCHEMA_VERSION],
  );
  const changed = store.db.getRowsModified();
  if (changed > 0) {
    if (usage) {
      recordPromptEnhancementSourceUse(store, {
        sourceUseId: usage.sourceUseId,
        projectRoot,
        enhancementId: usage.enhancementId,
        bodyId: usage.bodyId,
        bodyRevision: usage.bodyRevision,
        sourceKind: 'memory_ref',
        sourceId: signalKey,
        useKind: usage.useKind ?? 'body_section',
        memoryEvidence: false,
        reasonCodes: unionStrings(['memory_used_in_body'], usage.reasonCodes ?? []),
        now,
      });
    }
    setPromptEnhancementStatus(store, {
      projectRoot,
      statusKey: 'last_memory_used',
      statusValue: JSON.stringify({
        signalKey,
        sourceUseId: usage?.sourceUseId,
        bodyId: usage?.bodyId,
        bodyRevision: usage?.bodyRevision,
        at: now,
      }),
      now,
    });
  }
  saveStore(store);
  return changed > 0;
}

export function recordPromptEnhancementMemoryFeedback(
  store: Store,
  input: PromptEnhancementFeedbackInput,
): void {
  const inserted = recordPromptEnhancementFeedbackEvent(store, input);
  if (!inserted) return;
  if (input.learningEligibility !== 'eligible_scoped' || input.safetyImpactState !== 'none' || input.memoryEvidence !== true) return;
  recordPromptEnhancementMemoryEvidence(store, {
    projectRoot: input.projectRoot,
    signalKey: input.feedbackScopeKey,
    evidenceKind: isNegativeFeedbackCategory(input.feedbackCategory)
      ? 'negative'
      : input.feedbackCategory === 'accept_send'
        ? 'positive'
      : 'neutral',
    currentEvidenceState: 'feedback_derived',
    confidenceBand: 'low',
    sourceStrength: 'weak',
    status: 'candidate',
    reasonCodes: ['feedback_candidate_not_global_preference'],
    now: input.now,
  });
}

export function recordPromptEnhancementSourceUse(store: Store, input: PromptEnhancementSourceUseInput): void {
  assertSourceUseInput(input);
  const now = input.now ?? Date.now();
  store.db.run(
    `INSERT OR REPLACE INTO prompt_enhancement_source_use
       (source_use_id, project_root, enhancement_id, body_id, body_revision, source_kind, source_id,
        section_ids_json, use_kind, memory_evidence, schema_version, reason_codes_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.sourceUseId,
      input.projectRoot,
      input.enhancementId,
      input.bodyId,
      input.bodyRevision,
      input.sourceKind,
      input.sourceId,
      JSON.stringify(cleanPublicSafeTokens(input.sectionIds ?? [])),
      input.useKind,
      input.memoryEvidence === true ? 1 : 0,
      SCHEMA_VERSION,
      JSON.stringify(cleanPublicSafeTokens(input.reasonCodes ?? [])),
      now,
    ],
  );
  setPromptEnhancementStatus(store, {
    projectRoot: input.projectRoot,
    statusKey: 'last_source_use',
    statusValue: JSON.stringify({
      sourceUseId: input.sourceUseId,
      bodyId: input.bodyId,
      bodyRevision: input.bodyRevision,
      sourceKind: input.sourceKind,
      useKind: input.useKind,
      sectionIds: input.sectionIds ?? [],
      memoryEvidence: input.memoryEvidence === true,
      at: now,
    }),
    now,
  });
  saveStore(store);
}

export function recordPromptEnhancementGeneratedOrigin(store: Store, input: PromptEnhancementGeneratedOriginInput): void {
  assertGeneratedOriginInput(input);
  const now = input.now ?? Date.now();
  store.db.run(
    `INSERT OR REPLACE INTO prompt_enhancement_generated_origin
       (generated_origin_id, project_root, enhancement_id, body_id, body_revision, generated_origin_state,
        delivery_channel, prompt_submit_processing_policy, learning_eligible, learning_eligibility_json, source_use_ids_json,
        action_ids_json, fallback_state, privacy_storage_policy, schema_version, reason_codes_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.generatedOriginId,
      input.projectRoot,
      input.enhancementId,
      input.bodyId,
      input.bodyRevision,
      input.generatedOriginState,
      input.deliveryChannel,
      input.promptSubmitProcessingPolicy,
      input.learningEligible === true ? 1 : 0,
      JSON.stringify(resolveLearningEligibilityFlags(input.learningEligibilityFlags, input.learningEligible === true)),
      JSON.stringify(input.sourceUseIds ?? []),
      JSON.stringify(input.actionIds ?? []),
      input.fallbackState ?? 'unknown_not_applicable',
      input.privacyStoragePolicy ?? 'raw_text_excluded_by_default',
      SCHEMA_VERSION,
      JSON.stringify(cleanPublicSafeTokens(input.reasonCodes ?? [])),
      now,
    ],
  );
  setPromptEnhancementStatus(store, {
    projectRoot: input.projectRoot,
    statusKey: 'last_generated_origin',
    statusValue: JSON.stringify({
      generatedOriginId: input.generatedOriginId,
      bodyId: input.bodyId,
      bodyRevision: input.bodyRevision,
      generatedOriginState: input.generatedOriginState,
      deliveryChannel: input.deliveryChannel,
      learningEligible: input.learningEligible === true,
      learningEligibilityFlags: resolveLearningEligibilityFlags(input.learningEligibilityFlags, input.learningEligible === true),
      sourceUseIds: input.sourceUseIds ?? [],
      actionIds: input.actionIds ?? [],
      fallbackState: input.fallbackState ?? 'unknown_not_applicable',
      privacyStoragePolicy: input.privacyStoragePolicy ?? 'raw_text_excluded_by_default',
      at: now,
    }),
    now,
  });
  saveStore(store);
}

export function recordPromptEnhancementFeedbackEvent(store: Store, input: PromptEnhancementFeedbackInput): boolean {
  assertFeedbackInput(input);
  const now = input.now ?? Date.now();
  store.db.run(
    `INSERT OR IGNORE INTO prompt_enhancement_feedback
       (feedback_event_id, project_root, enhancement_id, body_id, body_revision, feedback_category,
        feedback_scope_key, learning_eligibility, safety_impact_state, raw_text_stored, memory_evidence,
        schema_version, reason_codes_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    [
      input.feedbackEventId,
      input.projectRoot,
      input.enhancementId,
      input.bodyId,
      input.bodyRevision,
      input.feedbackCategory,
      input.feedbackScopeKey,
      input.learningEligibility,
      input.safetyImpactState,
      input.memoryEvidence === true ? 1 : 0,
      SCHEMA_VERSION,
      JSON.stringify(cleanPublicSafeTokens(input.reasonCodes ?? [])),
      now,
    ],
  );
  const inserted = store.db.getRowsModified() > 0;
  setPromptEnhancementStatus(store, {
    projectRoot: input.projectRoot,
    statusKey: 'last_feedback_event',
    statusValue: JSON.stringify({
      feedbackEventId: input.feedbackEventId,
      bodyId: input.bodyId,
      bodyRevision: input.bodyRevision,
      feedbackCategory: input.feedbackCategory,
      learningEligibility: input.learningEligibility,
      safetyImpactState: input.safetyImpactState,
      memoryEvidence: input.memoryEvidence === true,
      rawTextStored: false,
      at: now,
    }),
    now,
  });
  saveStore(store);
  return inserted;
}

export function recordPromptEnhancementPreparedBody(store: Store, input: PromptEnhancementPreparedBodyInput): void {
  assertPreparedBodyInput(input);
  recordPromptEnhancementGeneratedOrigin(store, {
    generatedOriginId: input.preparedBodyId,
    projectRoot: input.projectRoot,
    enhancementId: input.enhancementId,
    bodyId: input.bodyId,
    bodyRevision: input.bodyRevision,
    generatedOriginState: input.generatedOriginState,
    deliveryChannel: input.deliveryChannel,
    promptSubmitProcessingPolicy: input.promptSubmitProcessingPolicy,
    learningEligible: input.learningEligible,
    learningEligibilityFlags: input.learningEligibilityFlags,
    sourceUseIds: input.sourceUseIds,
    actionIds: input.actionIds,
    fallbackState: input.fallbackState,
    privacyStoragePolicy: input.privacyStoragePolicy,
    reasonCodes: input.reasonCodes,
    now: input.now,
  });
  setPromptEnhancementStatus(store, {
    projectRoot: input.projectRoot,
    statusKey: 'last_prepared_body',
    statusValue: JSON.stringify({
      preparedBodyId: input.preparedBodyId,
      bodyId: input.bodyId,
      bodyRevision: input.bodyRevision,
      generatedOriginState: input.generatedOriginState,
      actionIds: input.actionIds ?? [],
      fallbackState: input.fallbackState ?? 'unknown_not_applicable',
      privacyStoragePolicy: input.privacyStoragePolicy ?? 'raw_text_excluded_by_default',
      rawTextStored: false,
      at: input.now ?? Date.now(),
    }),
    now: input.now,
  });
  saveStore(store);
}

export function recordPromptEnhancementExposure(store: Store, input: PromptEnhancementExposureInput): void {
  assertExposureInput(input);
  recordPromptEnhancementFeedbackEvent(store, {
    feedbackEventId: input.exposureEventId,
    projectRoot: input.projectRoot,
    enhancementId: input.enhancementId,
    bodyId: input.bodyId,
    bodyRevision: input.bodyRevision,
    feedbackCategory: 'surface_exposed',
    feedbackScopeKey: input.bodyId,
    learningEligibility: 'not_eligible',
    safetyImpactState: 'none',
    memoryEvidence: false,
    reasonCodes: unionStrings(input.reasonCodes ?? [], [
      `exposure_state:${input.exposureState}`,
      `action_availability:${input.actionAvailabilityState}`,
    ]),
    now: input.now,
  });
}

export function recordPromptEnhancementAction(store: Store, input: PromptEnhancementActionInput): void {
  assertActionInput(input);
  recordPromptEnhancementFeedbackEvent(store, {
    feedbackEventId: input.actionEventId,
    projectRoot: input.projectRoot,
    enhancementId: input.enhancementId,
    bodyId: input.bodyId,
    bodyRevision: input.bodyRevision,
    feedbackCategory: input.actionCategory,
    feedbackScopeKey: input.feedbackScopeKey ?? input.bodyId,
    learningEligibility: input.learningEligibility ?? 'not_eligible',
    safetyImpactState: input.safetyImpactState ?? 'none',
    memoryEvidence: input.memoryEvidence,
    reasonCodes: input.reasonCodes,
    now: input.now,
  });
}

export function decayPromptEnhancementMemory(store: Store, projectRoot: string, now: number = Date.now()): number {
  assertNonEmpty('project_root_required', projectRoot);
  store.db.run(
    `UPDATE prompt_enhancement_memory
        SET status = 'decayed',
            fatigue_state = CASE WHEN fatigue_state = 'none' THEN 'candidate' ELSE fatigue_state END,
            updated_at = ?
      WHERE project_root = ?
        AND decay_after IS NOT NULL
        AND decay_after <= ?
        AND protection_state = 'none'
        AND status IN ('qualified', 'candidate')`,
    [now, projectRoot, now],
  );
  const changed = store.db.getRowsModified();
  setPromptEnhancementStatus(store, {
    projectRoot,
    statusKey: 'last_decay',
    statusValue: JSON.stringify({ changedRows: changed, at: now }),
    now,
  });
  saveStore(store);
  return changed;
}

export function prunePromptEnhancementMemory(
  store: Store,
  input: { projectRoot?: string; olderThan?: number; maxRowsPerProject?: number; maxEstimatedBytes?: number; now?: number },
): PromptEnhancementPruneResult {
  const reasonCodes: string[] = [];
  let deletedRows = 0;
  let decayedRows = 0;
  const now = input.now ?? Date.now();
  if (input.projectRoot) decayedRows += decayPromptEnhancementMemory(store, input.projectRoot, now);
  if (typeof input.olderThan === 'number') {
    const projectClause = input.projectRoot ? 'AND project_root = ?' : '';
    const params = input.projectRoot ? [input.olderThan, input.projectRoot] : [input.olderThan];
    store.db.run(
      `DELETE FROM prompt_enhancement_memory
        WHERE COALESCE(last_evidence_at, updated_at) < ?
          ${projectClause}
          AND protection_state = 'none'
          AND status IN ('candidate', 'decayed', 'malformed_ignored', 'disabled_by_policy')`,
      params,
    );
    deletedRows += store.db.getRowsModified();
    reasonCodes.push('stale_low_value_rows_pruned');
  }
  if (typeof input.maxRowsPerProject === 'number' && input.maxRowsPerProject > 0) {
    const projects = input.projectRoot ? [input.projectRoot] : listMemoryProjects(store);
    for (const projectRoot of projects) {
      store.db.run(
        `DELETE FROM prompt_enhancement_memory
          WHERE project_root = ?
            AND protection_state = 'none'
            AND signal_key IN (
              SELECT signal_key FROM prompt_enhancement_memory
               WHERE project_root = ?
                 AND protection_state = 'none'
               ORDER BY updated_at ASC, signal_key ASC
               LIMIT MAX(0, (SELECT COUNT(*) FROM prompt_enhancement_memory WHERE project_root = ?) - ?)
            )`,
        [projectRoot, projectRoot, projectRoot, input.maxRowsPerProject],
      );
      deletedRows += store.db.getRowsModified();
    }
    reasonCodes.push('row_cap_enforced_without_prompt_fifo');
  }
  if (typeof input.maxEstimatedBytes === 'number' && input.maxEstimatedBytes >= 0) {
    while (estimatePromptEnhancementBytes(store, input.projectRoot) > input.maxEstimatedBytes) {
      const victim = findBytePressureVictim(store, input.projectRoot);
      if (!victim) break;
      store.db.run(
        'DELETE FROM prompt_enhancement_memory WHERE project_root = ? AND signal_key = ?',
        [victim.projectRoot, victim.signalKey],
      );
      deletedRows += store.db.getRowsModified();
    }
    reasonCodes.push('byte_cap_enforced_without_prompt_fifo');
  }
  if (deletedRows > 0) store.db.run('VACUUM');
  setPromptEnhancementStatus(store, {
    projectRoot: input.projectRoot ?? '__all_projects__',
    statusKey: 'last_prune',
    statusValue: JSON.stringify({
      deletedRows,
      decayedRows,
      olderThan: input.olderThan,
      maxRowsPerProject: input.maxRowsPerProject,
      reasonCodes: [...new Set(reasonCodes)],
      at: now,
    }),
    now,
  });
  saveStore(store);
  return { deletedRows, decayedRows, reasonCodes: [...new Set(reasonCodes)] };
}

export function prunePromptEnhancementFeedbackAndSourceUse(
  store: Store,
  input: { projectRoot?: string; olderThan?: number; now?: number },
): PromptEnhancementPruneResult {
  if (typeof input.olderThan !== 'number') return { deletedRows: 0, decayedRows: 0, reasonCodes: [] };
  const now = input.now ?? Date.now();
  let deletedRows = 0;
  const projectClause = input.projectRoot ? 'AND project_root = ?' : '';
  const params = input.projectRoot ? [input.olderThan, input.projectRoot] : [input.olderThan];
  for (const table of ['prompt_enhancement_source_use', 'prompt_enhancement_generated_origin', 'prompt_enhancement_feedback']) {
    store.db.run(
      `DELETE FROM ${table}
        WHERE created_at < ?
          ${projectClause}`,
      params,
    );
    deletedRows += store.db.getRowsModified();
  }
  if (deletedRows > 0) store.db.run('VACUUM');
  setPromptEnhancementStatus(store, {
    projectRoot: input.projectRoot ?? '__all_projects__',
    statusKey: 'last_lifecycle_prune',
    statusValue: JSON.stringify({
      deletedRows,
      olderThan: input.olderThan,
      reasonCodes: ['lifecycle_rows_pruned_without_prompt_fifo'],
      at: now,
    }),
    now,
  });
  saveStore(store);
  return { deletedRows, decayedRows: 0, reasonCodes: ['lifecycle_rows_pruned_without_prompt_fifo'] };
}

export function prunePromptEnhancementRows(
  store: Store,
  input: { projectRoot?: string; olderThan?: number; maxRowsPerProject?: number; maxEstimatedBytes?: number; now?: number },
): PromptEnhancementPruneResult {
  const memory = prunePromptEnhancementMemory(store, input);
  const lifecycle = prunePromptEnhancementFeedbackAndSourceUse(store, input);
  return {
    deletedRows: memory.deletedRows + lifecycle.deletedRows,
    decayedRows: memory.decayedRows + lifecycle.decayedRows,
    reasonCodes: [...new Set([...memory.reasonCodes, ...lifecycle.reasonCodes])],
  };
}

export function deletePromptEnhancementMemoryForProject(store: Store, projectRoot: string): number {
  assertNonEmpty('project_root_required', projectRoot);
  store.db.run('DELETE FROM prompt_enhancement_memory WHERE project_root = ?', [projectRoot]);
  const deletedRows = store.db.getRowsModified();
  saveStore(store);
  return deletedRows;
}

export function deleteAllPromptEnhancementMemory(store: Store): number {
  store.db.run('DELETE FROM prompt_enhancement_memory');
  const deletedRows = store.db.getRowsModified();
  saveStore(store);
  return deletedRows;
}

export function deleteAllPromptEnhancementRows(store: Store): number {
  const tables = peTables();
  let deletedRows = 0;
  for (const table of tables) {
    store.db.run(`DELETE FROM ${table}`);
    deletedRows += store.db.getRowsModified();
  }
  saveStore(store);
  return deletedRows;
}

export function deletePromptEnhancementProjectRows(store: Store, projectRoot: string): number {
  assertNonEmpty('project_root_required', projectRoot);
  const tables = peTables();
  let deletedRows = 0;
  for (const table of tables) {
    store.db.run(`DELETE FROM ${table} WHERE project_root = ?`, [projectRoot]);
    deletedRows += store.db.getRowsModified();
  }
  saveStore(store);
  return deletedRows;
}

export function resetPromptEnhancementProjectRows(store: Store, projectRoot: string): number {
  return deletePromptEnhancementProjectRows(store, projectRoot);
}

export function resetAllPromptEnhancementRows(store: Store): number {
  return deleteAllPromptEnhancementRows(store);
}

export function setPromptEnhancementStatus(store: Store, input: PromptEnhancementStatusInput): void {
  assertNonEmpty('project_root_required', input.projectRoot);
  assertPublicSafeToken('status_key_public_safe_token_required', input.statusKey);
  const now = input.now ?? Date.now();
  store.db.run(
    `INSERT INTO prompt_enhancement_status
       (project_root, status_key, status_value, schema_version, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(project_root, status_key) DO UPDATE SET
       status_value = excluded.status_value,
       schema_version = excluded.schema_version,
       updated_at = excluded.updated_at`,
    [input.projectRoot, input.statusKey, sanitizeStatusValue(input.statusValue), SCHEMA_VERSION, now],
  );
  saveStore(store);
}

export function deletePromptEnhancementStatusForProject(store: Store, projectRoot: string): number {
  assertNonEmpty('project_root_required', projectRoot);
  store.db.run('DELETE FROM prompt_enhancement_status WHERE project_root = ?', [projectRoot]);
  const deletedRows = store.db.getRowsModified();
  saveStore(store);
  return deletedRows;
}

export function deleteAllPromptEnhancementStatus(store: Store): number {
  store.db.run('DELETE FROM prompt_enhancement_status');
  const deletedRows = store.db.getRowsModified();
  saveStore(store);
  return deletedRows;
}

export function deleteAllPromptEnhancementFeedback(store: Store): number {
  store.db.run('DELETE FROM prompt_enhancement_feedback');
  const deletedRows = store.db.getRowsModified();
  saveStore(store);
  return deletedRows;
}

export function deletePromptEnhancementFeedbackForProject(store: Store, projectRoot: string): number {
  assertNonEmpty('project_root_required', projectRoot);
  store.db.run('DELETE FROM prompt_enhancement_feedback WHERE project_root = ?', [projectRoot]);
  const deletedRows = store.db.getRowsModified();
  saveStore(store);
  return deletedRows;
}

export function deleteAllPromptEnhancementSourceUse(store: Store): number {
  let deletedRows = 0;
  for (const table of ['prompt_enhancement_source_use', 'prompt_enhancement_generated_origin']) {
    store.db.run(`DELETE FROM ${table}`);
    deletedRows += store.db.getRowsModified();
  }
  saveStore(store);
  return deletedRows;
}

export function deletePromptEnhancementSourceUseForProject(store: Store, projectRoot: string): number {
  assertNonEmpty('project_root_required', projectRoot);
  let deletedRows = 0;
  for (const table of ['prompt_enhancement_source_use', 'prompt_enhancement_generated_origin']) {
    store.db.run(`DELETE FROM ${table} WHERE project_root = ?`, [projectRoot]);
    deletedRows += store.db.getRowsModified();
  }
  saveStore(store);
  return deletedRows;
}

export function getPromptEnhancementMemoryStats(store: Store, projectRoot?: string): PromptEnhancementStoreStatus {
  return getPromptEnhancementStoreStatus(store, projectRoot);
}

export function getPromptEnhancementStoreStatus(store: Store, projectRoot?: string): PromptEnhancementStoreStatus {
  const memoryRows = countRows(store, 'prompt_enhancement_memory', projectRoot);
  const sourceUseRows = countRows(store, 'prompt_enhancement_source_use', projectRoot);
  const generatedOriginRows = countRows(store, 'prompt_enhancement_generated_origin', projectRoot);
  const feedbackRows = countRows(store, 'prompt_enhancement_feedback', projectRoot);
  const statusRows = countRows(store, 'prompt_enhancement_status', projectRoot);
  const globalMemoryRows = countRows(store, 'prompt_enhancement_memory');
  const globalSourceUseRows = countRows(store, 'prompt_enhancement_source_use');
  const globalGeneratedOriginRows = countRows(store, 'prompt_enhancement_generated_origin');
  const globalFeedbackRows = countRows(store, 'prompt_enhancement_feedback');
  const globalStatusRows = countRows(store, 'prompt_enhancement_status');
  const pruneStatus = readStatusValue(store, projectRoot, 'last_prune') ?? readStatusValue(store, '__all_projects__', 'last_prune');
  const lifecyclePruneStatus = readStatusValue(store, projectRoot, 'last_lifecycle_prune')
    ?? readStatusValue(store, '__all_projects__', 'last_lifecycle_prune');
  const decayStatus = readStatusValue(store, projectRoot, 'last_decay');
  const lastReasonCodes = [
    ...extractReasonCodes(pruneStatus),
    ...extractReasonCodes(lifecyclePruneStatus),
  ];
  const errorCount = countStatusKeyMatches(store, projectRoot, 'error');
  const fallbackCount = countStatusKeyMatches(store, projectRoot, 'fallback');
  const hasScopedData = memoryRows + sourceUseRows + generatedOriginRows + feedbackRows + statusRows > 0;
  const rowCapState = lastReasonCodes.some((code) => code === 'row_cap_enforced_without_prompt_fifo')
    ? 'over_row_cap_pruned'
    : hasScopedData
      ? 'within_bounds'
      : 'policy_disabled_or_no_data';
  const byteThresholdState = lastReasonCodes.some((code) => code === 'byte_cap_enforced_without_prompt_fifo')
    ? 'over_byte_threshold_pruned'
    : hasScopedData
      ? 'within_bounds'
      : 'policy_disabled_or_no_data';
  return {
    projectRoot,
    schemaVersion: SCHEMA_VERSION,
    enabledState: hasScopedData
      ? 'local_store_enabled'
      : 'policy_disabled_or_no_data',
    memoryRows,
    sourceUseRows,
    generatedOriginRows,
    feedbackRows,
    statusRows,
    globalMemoryRows,
    globalSourceUseRows,
    globalGeneratedOriginRows,
    globalFeedbackRows,
    globalStatusRows,
    estimatedBytes: estimatePromptEnhancementBytes(store, projectRoot),
    exportedDbBytes: store.db.export().byteLength,
    capState: rowCapState,
    rowCapState,
    byteThresholdState,
    lastCleanupOutcome: lastReasonCodes[lastReasonCodes.length - 1] ?? 'none',
    telemetryPolicy: 'ids_enums_counts_status_timing_only',
    rawContentStoredByDefault: false,
    oldStoreSurfacesAreAuthority: false,
    reasonCodes: [...new Set(lastReasonCodes)],
    lastPruneAt: latestNumber(extractAt(pruneStatus), extractAt(lifecyclePruneStatus)),
    lastDecayAt: extractAt(decayStatus),
    fallbackCount,
    errorCount,
  };
}

export function getPromptEnhancementDebugSummary(store: Store, projectRoot?: string): PromptEnhancementStoreStatus {
  return getPromptEnhancementStoreStatus(store, projectRoot);
}

export function resolvePromptEnhancementGeneratedOrigin(
  store: Store,
  input: { projectRoot: string; bodyId: string; bodyRevision: number },
): PromptEnhancementGeneratedOriginResolution | null {
  assertNonEmpty('project_root_required', input.projectRoot);
  assertPublicSafeToken('body_id_public_safe_token_required', input.bodyId);
  const res = store.db.exec(
    `SELECT generated_origin_id, project_root, enhancement_id, body_id, body_revision, generated_origin_state,
            delivery_channel, prompt_submit_processing_policy, learning_eligible, learning_eligibility_json, source_use_ids_json,
            action_ids_json, fallback_state, privacy_storage_policy, reason_codes_json, created_at
       FROM prompt_enhancement_generated_origin
      WHERE project_root = ?
        AND body_id = ?
        AND body_revision = ?
        AND schema_version <= ?
      ORDER BY created_at DESC, generated_origin_id ASC
      LIMIT 1`,
    [input.projectRoot, input.bodyId, input.bodyRevision, SCHEMA_VERSION],
  );
  const row = res[0]?.values[0];
  if (!row) return null;
  const generatedOriginId = readPublicSafeToken(row[0]);
  const enhancementId = readPublicSafeToken(row[2]);
  const bodyId = readPublicSafeToken(row[3]);
  const generatedOriginState = readPublicSafeToken(row[5]);
  const deliveryChannel = readPublicSafeToken(row[6]);
  const promptSubmitProcessingPolicy = readPublicSafeToken(row[7]);
  const fallbackState = readPublicSafeToken(row[12]);
  const privacyStoragePolicy = readPublicSafeToken(row[13]);
  if (
    !generatedOriginId ||
    !enhancementId ||
    !bodyId ||
    !generatedOriginState ||
    !deliveryChannel ||
    !promptSubmitProcessingPolicy ||
    !fallbackState ||
    !privacyStoragePolicy
  ) {
    return null;
  }
  return {
    generatedOriginId,
    projectRoot: row[1] as string,
    enhancementId,
    bodyId,
    bodyRevision: row[4] as number,
    generatedOriginState,
    deliveryChannel,
    promptSubmitProcessingPolicy,
    learningEligible: row[8] === 1,
    learningEligibilityFlags: parseLearningEligibilityFlags(row[9] as string, row[8] === 1),
    sourceUseIds: parseStringArray(row[10] as string),
    actionIds: parseStringArray(row[11] as string),
    fallbackState,
    privacyStoragePolicy,
    reasonCodes: parseStringArray(row[14] as string),
    createdAt: row[15] as number,
  };
}

export function getPromptEnhancementFeedbackSummary(
  store: Store,
  projectRoot: string,
  feedbackScopeKey?: string,
): PromptEnhancementFeedbackSummary {
  assertNonEmpty('project_root_required', projectRoot);
  if (feedbackScopeKey !== undefined) assertPublicSafeToken('feedback_scope_key_public_safe_token_required', feedbackScopeKey);
  const scopeClause = feedbackScopeKey ? 'AND feedback_scope_key = ?' : '';
  const params = feedbackScopeKey ? [projectRoot, feedbackScopeKey, SCHEMA_VERSION] : [projectRoot, SCHEMA_VERSION];
  const rows = store.db.exec(
    `SELECT feedback_category, memory_evidence, raw_text_stored
       FROM prompt_enhancement_feedback
      WHERE project_root = ?
        ${scopeClause}
        AND schema_version <= ?
      ORDER BY feedback_category ASC`,
    params,
  )[0]?.values ?? [];
  const counts = new Map<string, number>();
  let totalEvents = 0;
  let memoryEvidenceEvents = 0;
  let rawTextStoredEvents = 0;
  for (const row of rows) {
    const feedbackCategory = readKnownValue(row[0], FEEDBACK_CATEGORIES);
    if (!feedbackCategory) continue;
    totalEvents += 1;
    counts.set(feedbackCategory, (counts.get(feedbackCategory) ?? 0) + 1);
    if (row[1] === 1) memoryEvidenceEvents += 1;
    if (row[2] === 1) rawTextStoredEvents += 1;
  }
  return {
    projectRoot,
    feedbackScopeKey,
    totalEvents,
    categoryCounts: [...counts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([feedbackCategory, count]) => ({ feedbackCategory, count })),
    memoryEvidenceEvents,
    rawTextStoredEvents,
  };
}

export function getPromptEnhancementSourceUseSummary(
  store: Store,
  projectRoot: string,
  bodyId?: string,
): PromptEnhancementSourceUseSummary {
  assertNonEmpty('project_root_required', projectRoot);
  if (bodyId !== undefined) assertPublicSafeToken('body_id_public_safe_token_required', bodyId);
  const bodyClause = bodyId ? 'AND body_id = ?' : '';
  const params = bodyId ? [projectRoot, bodyId, SCHEMA_VERSION] : [projectRoot, SCHEMA_VERSION];
  const rows = store.db.exec(
    `SELECT source_kind, use_kind, memory_evidence
       FROM prompt_enhancement_source_use
      WHERE project_root = ?
        ${bodyClause}
        AND schema_version <= ?
      ORDER BY source_kind ASC, use_kind ASC`,
    params,
  )[0]?.values ?? [];
  const sourceKindCounts = new Map<string, number>();
  const useKindCounts = new Map<string, number>();
  let totalSourceUses = 0;
  let memoryEvidenceRows = 0;
  for (const row of rows) {
    const sourceKind = readPublicSafeToken(row[0]);
    const useKind = readKnownValue(row[1], SOURCE_USE_KINDS);
    if (!sourceKind || !useKind) continue;
    totalSourceUses += 1;
    sourceKindCounts.set(sourceKind, (sourceKindCounts.get(sourceKind) ?? 0) + 1);
    useKindCounts.set(useKind, (useKindCounts.get(useKind) ?? 0) + 1);
    if (row[2] === 1) memoryEvidenceRows += 1;
  }
  return {
    projectRoot,
    bodyId,
    totalSourceUses,
    sourceKindCounts: [...sourceKindCounts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([sourceKind, count]) => ({ sourceKind, count })),
    useKindCounts: [...useKindCounts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([useKind, count]) => ({ useKind, count })),
    memoryEvidenceRows,
  };
}

export function getPromptEnhancementSchemaVersionState(store: Store): {
  schemaVersion: number;
  tableStates: readonly { tableName: string; exists: boolean }[];
} {
  return {
    schemaVersion: SCHEMA_VERSION,
    tableStates: peTables().map((tableName) => ({ tableName, exists: tableExists(store, tableName) })),
  };
}

export function getPromptEnhancementMemory(
  store: Store,
  projectRoot: string,
  signalKey: string,
): PromptEnhancementMemoryRow | null {
  const res = store.db.exec(
    `SELECT ${SELECT_MEMORY}
       FROM prompt_enhancement_memory
      WHERE project_root = ? AND signal_key = ? AND schema_version <= ?`,
    [projectRoot, signalKey, SCHEMA_VERSION],
  );
  const row = res[0]?.values[0];
  return row ? mapMemoryRow(row) : null;
}

function mapMemoryRow(row: (string | number | null | Uint8Array)[]): PromptEnhancementMemoryRow | null {
  const schemaVersion = row[2] as number;
  if (schemaVersion > SCHEMA_VERSION) return null;
  const signalKey = readPublicSafeToken(row[1]);
  const currentEvidenceState = readKnownValue(row[6], MEMORY_EVIDENCE_STATES);
  const confidenceBand = readKnownValue(row[7], MEMORY_CONFIDENCE_BANDS);
  const sourceStrength = readKnownValue(row[8], MEMORY_SOURCE_STRENGTHS);
  const protectionState = readKnownValue(row[9], MEMORY_PROTECTION_STATES);
  const fatigueState = readKnownValue(row[10], MEMORY_FATIGUE_STATES);
  const suppressionState = readKnownValue(row[11], MEMORY_SUPPRESSION_STATES);
  const status = readKnownValue(row[15], MEMORY_STATUSES);
  if (!signalKey || !currentEvidenceState || !confidenceBand || !sourceStrength || !protectionState || !fatigueState || !suppressionState || !status) {
    return null;
  }
  const reasonCodes = parseStringArray(row[16] as string);
  const provenance = parseProvenance(row[17] as string);
  if (!provenance) return null;
  return {
    projectRoot: row[0] as string,
    signalKey,
    schemaVersion,
    evidenceCount: row[3] as number,
    positiveCount: row[4] as number,
    negativeCount: row[5] as number,
    currentEvidenceState,
    confidenceBand,
    sourceStrength,
    protectionState,
    fatigueState,
    suppressionState,
    lastUsedAt: row[12] as number | null,
    lastEvidenceAt: row[13] as number | null,
    decayAfter: row[14] as number | null,
    status,
    reasonCodes,
    provenance,
    createdAt: row[18] as number,
    updatedAt: row[19] as number,
  };
}

function parseStringArray(value: string): readonly string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? cleanPublicSafeTokens(parsed.filter((item): item is string => typeof item === 'string')) : [];
  } catch {
    return [];
  }
}

function cleanPublicSafeTokens(values: readonly string[]): readonly string[] {
  return [...new Set(values.map(cleanPublicSafeToken).filter((value): value is string => value !== null))];
}

function cleanPublicSafeToken(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 200) return null;
  return /^[A-Za-z0-9._:/#@+-]+$/.test(trimmed) ? trimmed : null;
}

function cleanOptionalPublicSafeToken(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return cleanPublicSafeToken(value) ?? undefined;
}

function readPublicSafeToken(value: unknown): string | null {
  return typeof value === 'string' ? cleanPublicSafeToken(value) : null;
}

function readKnownValue<T extends string>(value: unknown, allowedValues: readonly T[]): T | null {
  return typeof value === 'string' && allowedValues.includes(value as T) ? value as T : null;
}

function resolveLearningEligibilityFlags(
  flags: Partial<PromptEnhancementLearningEligibilityFlags> | undefined,
  broadLearningEligible: boolean,
): PromptEnhancementLearningEligibilityFlags {
  const defaultAllowed = broadLearningEligible === true;
  return {
    promptHistory: flags?.promptHistory ?? defaultAllowed,
    profile: flags?.profile ?? defaultAllowed,
    stage: flags?.stage ?? defaultAllowed,
    language: flags?.language ?? defaultAllowed,
    missingSignalMemory: flags?.missingSignalMemory ?? defaultAllowed,
    feedback: flags?.feedback ?? defaultAllowed,
    telemetry: flags?.telemetry ?? false,
    sourceUseTracking: flags?.sourceUseTracking ?? true,
  };
}

function parseLearningEligibilityFlags(value: string, broadLearningEligible: boolean): PromptEnhancementLearningEligibilityFlags {
  try {
    const parsed = JSON.parse(value) as Partial<Record<keyof PromptEnhancementLearningEligibilityFlags, unknown>>;
    return resolveLearningEligibilityFlags({
      promptHistory: typeof parsed.promptHistory === 'boolean' ? parsed.promptHistory : undefined,
      profile: typeof parsed.profile === 'boolean' ? parsed.profile : undefined,
      stage: typeof parsed.stage === 'boolean' ? parsed.stage : undefined,
      language: typeof parsed.language === 'boolean' ? parsed.language : undefined,
      missingSignalMemory: typeof parsed.missingSignalMemory === 'boolean' ? parsed.missingSignalMemory : undefined,
      feedback: typeof parsed.feedback === 'boolean' ? parsed.feedback : undefined,
      telemetry: typeof parsed.telemetry === 'boolean' ? parsed.telemetry : undefined,
      sourceUseTracking: typeof parsed.sourceUseTracking === 'boolean' ? parsed.sourceUseTracking : undefined,
    }, broadLearningEligible);
  } catch {
    return resolveLearningEligibilityFlags(undefined, broadLearningEligible);
  }
}

function parseProvenance(value: string): PromptEnhancementMemoryRow['provenance'] | null {
  try {
    const parsed = JSON.parse(value) as Partial<PromptEnhancementMemoryRow['provenance']>;
    if (parsed.memoryEvidenceOnly !== true || parsed.rawTextStored !== false) return null;
    return {
      promptIntent: typeof parsed.promptIntent === 'string' ? cleanOptionalPublicSafeToken(parsed.promptIntent) : undefined,
      templateFamily: typeof parsed.templateFamily === 'string' ? cleanOptionalPublicSafeToken(parsed.templateFamily) : undefined,
      sourceIds: Array.isArray(parsed.sourceIds) ? cleanPublicSafeTokens(parsed.sourceIds.filter((item): item is string => typeof item === 'string')) : [],
      sectionIds: Array.isArray(parsed.sectionIds) ? cleanPublicSafeTokens(parsed.sectionIds.filter((item): item is string => typeof item === 'string')) : [],
      memoryEvidenceOnly: true,
      rawTextStored: false,
    };
  } catch {
    return null;
  }
}

function countRows(store: Store, tableName: string, projectRoot?: string): number {
  const res = projectRoot
    ? store.db.exec(`SELECT COUNT(*) FROM ${tableName} WHERE project_root = ?`, [projectRoot])
    : store.db.exec(`SELECT COUNT(*) FROM ${tableName}`);
  return (res[0]?.values[0]?.[0] as number | undefined) ?? 0;
}

function countStatusKeyMatches(store: Store, projectRoot: string | undefined, pattern: string): number {
  const likePattern = `%${pattern}%`;
  const res = projectRoot
    ? store.db.exec(
      'SELECT COUNT(*) FROM prompt_enhancement_status WHERE project_root = ? AND status_key LIKE ?',
      [projectRoot, likePattern],
    )
    : store.db.exec(
      'SELECT COUNT(*) FROM prompt_enhancement_status WHERE status_key LIKE ?',
      [likePattern],
    );
  return (res[0]?.values[0]?.[0] as number | undefined) ?? 0;
}

function readStatusValue(store: Store, projectRoot: string | undefined, statusKey: string): Record<string, unknown> | null {
  if (!projectRoot) return null;
  const res = store.db.exec(
    `SELECT status_value
       FROM prompt_enhancement_status
      WHERE project_root = ? AND status_key = ? AND schema_version <= ?`,
    [projectRoot, statusKey, SCHEMA_VERSION],
  );
  const value = res[0]?.values[0]?.[0];
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function sanitizeStatusValue(value: string): string {
  try {
    const parsed = JSON.parse(value);
    const sanitized = sanitizeStatusJson(parsed);
    if (sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)) return JSON.stringify(sanitized);
  } catch {
    // Non-JSON status payloads are replaced so raw text cannot persist through PE status rows.
  }
  return JSON.stringify({ status: 'unsafe_or_non_json_status_value_discarded', rawContentStored: false });
}

function sanitizeStatusJson(value: unknown): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return cleanPublicSafeToken(value) ?? 'unsafe_text_discarded';
  if (Array.isArray(value)) {
    return value
      .map(sanitizeStatusJson)
      .filter((item) => item !== undefined);
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      const safeKey = cleanPublicSafeToken(key);
      if (safeKey) out[safeKey] = sanitizeStatusJson(child);
    }
    return out;
  }
  return undefined;
}

function extractReasonCodes(statusValue: Record<string, unknown> | null): readonly string[] {
  const reasonCodes = statusValue?.reasonCodes;
  return Array.isArray(reasonCodes) ? cleanPublicSafeTokens(reasonCodes.filter((item): item is string => typeof item === 'string')) : [];
}

function extractAt(statusValue: Record<string, unknown> | null): number | null {
  return typeof statusValue?.at === 'number' ? statusValue.at : null;
}

function latestNumber(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return Math.max(left, right);
}

function estimatePromptEnhancementBytes(store: Store, projectRoot?: string): number {
  let total = 0;
  for (const table of peTables()) {
    const res = projectRoot
      ? store.db.exec(`SELECT * FROM ${table} WHERE project_root = ?`, [projectRoot])
      : store.db.exec(`SELECT * FROM ${table}`);
    for (const row of res[0]?.values ?? []) total += JSON.stringify(row).length;
  }
  return total;
}

function listMemoryProjects(store: Store): string[] {
  const res = store.db.exec('SELECT DISTINCT project_root FROM prompt_enhancement_memory ORDER BY project_root ASC');
  return (res[0]?.values ?? []).map((row) => row[0] as string);
}

function findBytePressureVictim(store: Store, projectRoot?: string): { projectRoot: string; signalKey: string } | null {
  const projectClause = projectRoot ? 'AND project_root = ?' : '';
  const params = projectRoot ? [projectRoot] : [];
  const res = store.db.exec(
    `SELECT project_root, signal_key
       FROM prompt_enhancement_memory
      WHERE protection_state = 'none'
        AND status IN ('candidate', 'decayed', 'malformed_ignored', 'disabled_by_policy')
        ${projectClause}
      ORDER BY updated_at ASC, signal_key ASC
      LIMIT 1`,
    params,
  );
  const row = res[0]?.values[0];
  return row ? { projectRoot: row[0] as string, signalKey: row[1] as string } : null;
}

function tableExists(store: Store, tableName: string): boolean {
  const res = store.db.exec(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    [tableName],
  );
  return Boolean(res[0]?.values[0]);
}

function sourceUseExists(store: Store, sourceUseId: string): boolean {
  const res = store.db.exec(
    'SELECT 1 FROM prompt_enhancement_source_use WHERE source_use_id = ? LIMIT 1',
    [sourceUseId],
  );
  return Boolean(res[0]?.values[0]);
}

function peTables(): readonly string[] {
  return [
    'prompt_enhancement_memory',
    'prompt_enhancement_source_use',
    'prompt_enhancement_generated_origin',
    'prompt_enhancement_feedback',
    'prompt_enhancement_status',
  ];
}

function assertProjectSignal(projectRoot: string, signalKey: string): void {
  assertNonEmpty('project_root_required', projectRoot);
  assertPublicSafeToken('signal_key_public_safe_token_required', signalKey);
}

function assertMemoryEvidenceInput(input: PromptEnhancementMemoryEvidenceInput): void {
  assertProjectSignal(input.projectRoot, input.signalKey);
  assertOneOf('evidence_kind_known_value_required', input.evidenceKind, MEMORY_EVIDENCE_KINDS);
  assertOneOf('current_evidence_state_known_value_required', input.currentEvidenceState, MEMORY_EVIDENCE_STATES);
  assertOneOf('confidence_band_known_value_required', input.confidenceBand, MEMORY_CONFIDENCE_BANDS);
  assertOneOf('source_strength_known_value_required', input.sourceStrength, MEMORY_SOURCE_STRENGTHS);
  if (input.protectionState !== undefined) assertOneOf('protection_state_known_value_required', input.protectionState, MEMORY_PROTECTION_STATES);
  if (input.fatigueState !== undefined) assertOneOf('fatigue_state_known_value_required', input.fatigueState, MEMORY_FATIGUE_STATES);
  if (input.suppressionState !== undefined) assertOneOf('suppression_state_known_value_required', input.suppressionState, MEMORY_SUPPRESSION_STATES);
  if (input.status !== undefined) assertOneOf('memory_status_known_value_required', input.status, MEMORY_STATUSES);
}

function assertSourceUseInput(input: PromptEnhancementSourceUseInput): void {
  assertPublicSafeToken('source_use_id_public_safe_token_required', input.sourceUseId);
  assertNonEmpty('project_root_required', input.projectRoot);
  assertPublicSafeToken('enhancement_id_public_safe_token_required', input.enhancementId);
  assertPublicSafeToken('body_id_public_safe_token_required', input.bodyId);
  assertPublicSafeToken('source_kind_public_safe_token_required', input.sourceKind);
  assertPublicSafeToken('source_id_public_safe_token_required', input.sourceId);
  assertOneOf('source_use_kind_known_value_required', input.useKind, SOURCE_USE_KINDS);
}

function assertGeneratedOriginInput(input: PromptEnhancementGeneratedOriginInput): void {
  assertPublicSafeToken('generated_origin_id_public_safe_token_required', input.generatedOriginId);
  assertNonEmpty('project_root_required', input.projectRoot);
  assertPublicSafeToken('enhancement_id_public_safe_token_required', input.enhancementId);
  assertPublicSafeToken('body_id_public_safe_token_required', input.bodyId);
  assertPublicSafeToken('generated_origin_state_public_safe_token_required', input.generatedOriginState);
  assertPublicSafeToken('delivery_channel_public_safe_token_required', input.deliveryChannel);
  assertPublicSafeToken('prompt_submit_processing_policy_public_safe_token_required', input.promptSubmitProcessingPolicy);
  assertPublicSafeTokens('source_use_id_public_safe_token_required', input.sourceUseIds ?? []);
  assertPublicSafeTokens('action_id_public_safe_token_required', input.actionIds ?? []);
  if (input.fallbackState !== undefined) assertPublicSafeToken('fallback_state_public_safe_token_required', input.fallbackState);
  if (input.privacyStoragePolicy !== undefined) assertPublicSafeToken('privacy_storage_policy_public_safe_token_required', input.privacyStoragePolicy);
}

function assertFeedbackInput(input: PromptEnhancementFeedbackInput): void {
  assertPublicSafeToken('feedback_event_id_public_safe_token_required', input.feedbackEventId);
  assertNonEmpty('project_root_required', input.projectRoot);
  assertPublicSafeToken('enhancement_id_public_safe_token_required', input.enhancementId);
  assertPublicSafeToken('body_id_public_safe_token_required', input.bodyId);
  assertOneOf('feedback_category_known_value_required', input.feedbackCategory, FEEDBACK_CATEGORIES);
  assertPublicSafeToken('feedback_scope_key_public_safe_token_required', input.feedbackScopeKey);
  assertOneOf('feedback_learning_eligibility_known_value_required', input.learningEligibility, FEEDBACK_LEARNING_ELIGIBILITY);
  assertOneOf('feedback_safety_impact_state_known_value_required', input.safetyImpactState, FEEDBACK_SAFETY_IMPACT_STATES);
}

function assertPreparedBodyInput(input: PromptEnhancementPreparedBodyInput): void {
  assertPublicSafeToken('prepared_body_id_public_safe_token_required', input.preparedBodyId);
  assertNonEmpty('project_root_required', input.projectRoot);
  assertPublicSafeToken('enhancement_id_public_safe_token_required', input.enhancementId);
  assertPublicSafeToken('body_id_public_safe_token_required', input.bodyId);
  assertPublicSafeToken('generated_origin_state_public_safe_token_required', input.generatedOriginState);
  assertPublicSafeToken('delivery_channel_public_safe_token_required', input.deliveryChannel);
  assertPublicSafeToken('prompt_submit_processing_policy_public_safe_token_required', input.promptSubmitProcessingPolicy);
  assertPublicSafeTokens('source_use_id_public_safe_token_required', input.sourceUseIds ?? []);
  assertPublicSafeTokens('action_id_public_safe_token_required', input.actionIds ?? []);
  if (input.fallbackState !== undefined) assertPublicSafeToken('fallback_state_public_safe_token_required', input.fallbackState);
  if (input.privacyStoragePolicy !== undefined) assertPublicSafeToken('privacy_storage_policy_public_safe_token_required', input.privacyStoragePolicy);
}

function assertExposureInput(input: PromptEnhancementExposureInput): void {
  assertPublicSafeToken('exposure_event_id_public_safe_token_required', input.exposureEventId);
  assertNonEmpty('project_root_required', input.projectRoot);
  assertPublicSafeToken('enhancement_id_public_safe_token_required', input.enhancementId);
  assertPublicSafeToken('body_id_public_safe_token_required', input.bodyId);
  assertPublicSafeToken('exposure_state_public_safe_token_required', input.exposureState);
  assertPublicSafeToken('action_availability_state_public_safe_token_required', input.actionAvailabilityState);
}

function assertActionInput(input: PromptEnhancementActionInput): void {
  assertPublicSafeToken('action_event_id_public_safe_token_required', input.actionEventId);
  assertNonEmpty('project_root_required', input.projectRoot);
  assertPublicSafeToken('enhancement_id_public_safe_token_required', input.enhancementId);
  assertPublicSafeToken('body_id_public_safe_token_required', input.bodyId);
  assertOneOf('feedback_category_known_value_required', input.actionCategory, FEEDBACK_CATEGORIES);
  if (input.feedbackScopeKey !== undefined) assertPublicSafeToken('feedback_scope_key_public_safe_token_required', input.feedbackScopeKey);
  if (input.learningEligibility !== undefined) assertOneOf('feedback_learning_eligibility_known_value_required', input.learningEligibility, FEEDBACK_LEARNING_ELIGIBILITY);
  if (input.safetyImpactState !== undefined) assertOneOf('feedback_safety_impact_state_known_value_required', input.safetyImpactState, FEEDBACK_SAFETY_IMPACT_STATES);
}

function assertMemoryUseInput(input: PromptEnhancementMemoryUseInput): void {
  assertPublicSafeToken('source_use_id_public_safe_token_required', input.sourceUseId);
  assertPublicSafeToken('enhancement_id_public_safe_token_required', input.enhancementId);
  assertPublicSafeToken('body_id_public_safe_token_required', input.bodyId);
}

function assertNonEmpty(errorCode: string, value: string): void {
  if (value.trim().length === 0) throw new Error(errorCode);
}

function assertPublicSafeToken(errorCode: string, value: string): void {
  if (cleanPublicSafeToken(value) === null) throw new Error(errorCode);
}

function assertPublicSafeTokens(errorCode: string, values: readonly string[]): void {
  for (const value of values) assertPublicSafeToken(errorCode, value);
}

function assertOneOf(errorCode: string, value: string, allowedValues: readonly string[]): void {
  if (!allowedValues.includes(value)) throw new Error(errorCode);
}

function isNegativeFeedbackCategory(category: PromptEnhancementFeedbackCategory): boolean {
  return [
    'not_relevant_enough',
    'too_much_or_too_long',
    'too_long',
    'too_shallow',
    'not_project_grounded',
    'wrong_tone',
    'section_removed_by_edit',
    'user_deleted_generated_section',
    'action_result_rejected',
    'reject',
    'remove',
    'not_needed',
  ].includes(category);
}

function unionStrings(left: readonly string[], right: readonly string[]): readonly string[] {
  return [...new Set([...left, ...right].filter((item) => item.trim().length > 0))].sort();
}
