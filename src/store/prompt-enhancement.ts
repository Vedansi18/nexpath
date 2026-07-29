import { saveStore, type Store } from './db.js';
import { SCHEMA_VERSION } from './schema.js';

export type PromptEnhancementMemoryEvidenceState = 'live_current' | 'historical_candidate' | 'feedback_derived' | 'unknown_neutral';
export type PromptEnhancementMemoryConfidenceBand = 'low' | 'medium' | 'high';
export type PromptEnhancementMemorySourceStrength = 'weak' | 'moderate' | 'strong';
export type PromptEnhancementMemoryProtectionState = 'none' | 'current_source_a' | 'safety_protected' | 'mandatory_protected' | 'high_risk_protected';
export type PromptEnhancementMemoryFatigueState = 'none' | 'candidate' | 'fatigued';
export type PromptEnhancementMemorySuppressionState = 'none' | 'candidate_scoped' | 'suppressed_scoped';
export type PromptEnhancementMemoryStatus = 'qualified' | 'candidate' | 'decayed' | 'disabled_by_policy' | 'malformed_ignored';

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
  useKind: 'body_section' | 'trust_cue' | 'fallback_reason' | 'handoff_metadata';
  memoryEvidence?: boolean;
  reasonCodes?: readonly string[];
  now?: number;
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
  sourceUseIds?: readonly string[];
  reasonCodes?: readonly string[];
  now?: number;
}

export interface PromptEnhancementFeedbackInput {
  feedbackEventId: string;
  projectRoot: string;
  enhancementId: string;
  bodyId: string;
  bodyRevision: number;
  feedbackCategory:
    | 'accept_send'
    | 'edit'
    | 'skip_cancel'
    | 'reject'
    | 'remove'
    | 'not_needed'
    | 'directional_action'
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
  feedbackScopeKey: string;
  learningEligibility: 'eligible_scoped' | 'not_eligible' | 'pending_policy';
  safetyImpactState: 'none' | 'safety_floor_touched' | 'source_floor_touched' | 'unknown';
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
  memoryRows: number;
  sourceUseRows: number;
  generatedOriginRows: number;
  feedbackRows: number;
  statusRows: number;
  estimatedBytes: number;
  capState: 'within_bounds' | 'over_row_cap_pruned' | 'policy_disabled_or_no_data';
  telemetryPolicy: 'ids_enums_counts_status_timing_only';
  rawContentStoredByDefault: false;
  oldStoreSurfacesAreAuthority: false;
  reasonCodes: readonly string[];
}

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
  const stableSignalKeys = [...new Set(signalKeys.filter((signalKey) => signalKey.trim().length > 0))];
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
  assertProjectSignal(input.projectRoot, input.signalKey);
  const now = input.now ?? Date.now();
  const existing = getPromptEnhancementMemory(store, input.projectRoot, input.signalKey);
  const positiveDelta = input.evidenceKind === 'positive' ? 1 : 0;
  const negativeDelta = input.evidenceKind === 'negative' ? 1 : 0;
  const existingProvenance = existing?.provenance;
  const provenance = {
    promptIntent: input.promptIntent ?? existingProvenance?.promptIntent,
    templateFamily: input.templateFamily ?? existingProvenance?.templateFamily,
    sourceIds: unionStrings(existingProvenance?.sourceIds ?? [], input.sourceIds ?? []),
    sectionIds: unionStrings(existingProvenance?.sectionIds ?? [], input.sectionIds ?? []),
    memoryEvidenceOnly: true as const,
    rawTextStored: false as const,
  };
  const reasonCodes = unionStrings(existing?.reasonCodes ?? [], input.reasonCodes ?? []);
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
): boolean {
  assertProjectSignal(projectRoot, signalKey);
  store.db.run(
    `UPDATE prompt_enhancement_memory
        SET last_used_at = ?, updated_at = ?
      WHERE project_root = ? AND signal_key = ? AND schema_version <= ?`,
    [now, now, projectRoot, signalKey, SCHEMA_VERSION],
  );
  const changed = store.db.getRowsModified();
  if (changed > 0) {
    setPromptEnhancementStatus(store, {
      projectRoot,
      statusKey: 'last_memory_used',
      statusValue: JSON.stringify({ signalKey, at: now }),
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
  recordPromptEnhancementFeedbackEvent(store, input);
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
        use_kind, memory_evidence, schema_version, reason_codes_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.sourceUseId,
      input.projectRoot,
      input.enhancementId,
      input.bodyId,
      input.bodyRevision,
      input.sourceKind,
      input.sourceId,
      input.useKind,
      input.memoryEvidence === true ? 1 : 0,
      SCHEMA_VERSION,
      JSON.stringify(input.reasonCodes ?? []),
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
        delivery_channel, prompt_submit_processing_policy, learning_eligible, source_use_ids_json,
        schema_version, reason_codes_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      JSON.stringify(input.sourceUseIds ?? []),
      SCHEMA_VERSION,
      JSON.stringify(input.reasonCodes ?? []),
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
      at: now,
    }),
    now,
  });
  saveStore(store);
}

export function recordPromptEnhancementFeedbackEvent(store: Store, input: PromptEnhancementFeedbackInput): void {
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
      JSON.stringify(input.reasonCodes ?? []),
      now,
    ],
  );
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
): { deletedRows: number; decayedRows: number; reasonCodes: readonly string[] } {
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

export function deletePromptEnhancementMemoryForProject(store: Store, projectRoot: string): number {
  assertNonEmpty('project_root_required', projectRoot);
  return deletePromptEnhancementProjectRows(store, projectRoot);
}

export function deleteAllPromptEnhancementMemory(store: Store): number {
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

export function setPromptEnhancementStatus(store: Store, input: PromptEnhancementStatusInput): void {
  if (!input.projectRoot || !input.statusKey) {
    throw new Error('projectRoot and statusKey are required');
  }
  const now = input.now ?? Date.now();
  store.db.run(
    `INSERT INTO prompt_enhancement_status
       (project_root, status_key, status_value, schema_version, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(project_root, status_key) DO UPDATE SET
       status_value = excluded.status_value,
       schema_version = excluded.schema_version,
       updated_at = excluded.updated_at`,
    [input.projectRoot, input.statusKey, input.statusValue, SCHEMA_VERSION, now],
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
  store.db.run('DELETE FROM prompt_enhancement_source_use');
  const deletedRows = store.db.getRowsModified();
  saveStore(store);
  return deletedRows;
}

export function deletePromptEnhancementSourceUseForProject(store: Store, projectRoot: string): number {
  assertNonEmpty('project_root_required', projectRoot);
  store.db.run('DELETE FROM prompt_enhancement_source_use WHERE project_root = ?', [projectRoot]);
  const deletedRows = store.db.getRowsModified();
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
  return {
    projectRoot,
    memoryRows,
    sourceUseRows,
    generatedOriginRows,
    feedbackRows,
    statusRows,
    estimatedBytes: estimatePromptEnhancementBytes(store, projectRoot),
    capState: memoryRows + sourceUseRows + generatedOriginRows + feedbackRows + statusRows === 0
      ? 'policy_disabled_or_no_data'
      : 'within_bounds',
    telemetryPolicy: 'ids_enums_counts_status_timing_only',
    rawContentStoredByDefault: false,
    oldStoreSurfacesAreAuthority: false,
    reasonCodes: [],
  };
}

export function getPromptEnhancementDebugSummary(store: Store, projectRoot?: string): PromptEnhancementStoreStatus {
  return getPromptEnhancementStoreStatus(store, projectRoot);
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
  const reasonCodes = parseStringArray(row[16] as string);
  const provenance = parseProvenance(row[17] as string);
  if (!provenance) return null;
  return {
    projectRoot: row[0] as string,
    signalKey: row[1] as string,
    schemaVersion,
    evidenceCount: row[3] as number,
    positiveCount: row[4] as number,
    negativeCount: row[5] as number,
    currentEvidenceState: row[6] as PromptEnhancementMemoryEvidenceState,
    confidenceBand: row[7] as PromptEnhancementMemoryConfidenceBand,
    sourceStrength: row[8] as PromptEnhancementMemorySourceStrength,
    protectionState: row[9] as PromptEnhancementMemoryProtectionState,
    fatigueState: row[10] as PromptEnhancementMemoryFatigueState,
    suppressionState: row[11] as PromptEnhancementMemorySuppressionState,
    lastUsedAt: row[12] as number | null,
    lastEvidenceAt: row[13] as number | null,
    decayAfter: row[14] as number | null,
    status: row[15] as PromptEnhancementMemoryStatus,
    reasonCodes,
    provenance,
    createdAt: row[18] as number,
    updatedAt: row[19] as number,
  };
}

function parseStringArray(value: string): readonly string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function parseProvenance(value: string): PromptEnhancementMemoryRow['provenance'] | null {
  try {
    const parsed = JSON.parse(value) as Partial<PromptEnhancementMemoryRow['provenance']>;
    if (parsed.memoryEvidenceOnly !== true || parsed.rawTextStored !== false) return null;
    return {
      promptIntent: typeof parsed.promptIntent === 'string' ? parsed.promptIntent : undefined,
      templateFamily: typeof parsed.templateFamily === 'string' ? parsed.templateFamily : undefined,
      sourceIds: Array.isArray(parsed.sourceIds) ? parsed.sourceIds.filter((item): item is string => typeof item === 'string') : [],
      sectionIds: Array.isArray(parsed.sectionIds) ? parsed.sectionIds.filter((item): item is string => typeof item === 'string') : [],
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
  assertNonEmpty('signal_key_required', signalKey);
}

function assertSourceUseInput(input: PromptEnhancementSourceUseInput): void {
  assertNonEmpty('source_use_id_required', input.sourceUseId);
  assertNonEmpty('project_root_required', input.projectRoot);
  assertNonEmpty('enhancement_id_required', input.enhancementId);
  assertNonEmpty('body_id_required', input.bodyId);
  assertNonEmpty('source_kind_required', input.sourceKind);
  assertNonEmpty('source_id_required', input.sourceId);
}

function assertGeneratedOriginInput(input: PromptEnhancementGeneratedOriginInput): void {
  assertNonEmpty('generated_origin_id_required', input.generatedOriginId);
  assertNonEmpty('project_root_required', input.projectRoot);
  assertNonEmpty('enhancement_id_required', input.enhancementId);
  assertNonEmpty('body_id_required', input.bodyId);
  assertNonEmpty('generated_origin_state_required', input.generatedOriginState);
  assertNonEmpty('delivery_channel_required', input.deliveryChannel);
  assertNonEmpty('prompt_submit_processing_policy_required', input.promptSubmitProcessingPolicy);
}

function assertFeedbackInput(input: PromptEnhancementFeedbackInput): void {
  assertNonEmpty('feedback_event_id_required', input.feedbackEventId);
  assertNonEmpty('project_root_required', input.projectRoot);
  assertNonEmpty('enhancement_id_required', input.enhancementId);
  assertNonEmpty('body_id_required', input.bodyId);
  assertNonEmpty('feedback_scope_key_required', input.feedbackScopeKey);
}

function assertNonEmpty(errorCode: string, value: string): void {
  if (value.trim().length === 0) throw new Error(errorCode);
}

function isNegativeFeedbackCategory(category: PromptEnhancementFeedbackInput['feedbackCategory']): boolean {
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
