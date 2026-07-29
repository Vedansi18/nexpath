import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  closeStore,
  deleteAllPromptEnhancementMemory,
  deleteAllPromptEnhancementRows,
  deletePromptEnhancementMemoryForProject,
  deletePromptEnhancementProjectRows,
  deletePromptEnhancementStatusForProject,
  deletePromptEnhancementSourceUseForProject,
  getPromptEnhancementMemory,
  getPromptEnhancementFeedbackSummary,
  getPromptEnhancementSchemaVersionState,
  getPromptEnhancementSourceUseSummary,
  getPromptEnhancementStoreStatus,
  getSql,
  markPromptEnhancementMemoryUsed,
  openStore,
  prunePromptEnhancementFeedbackAndSourceUse,
  prunePromptEnhancementMemory,
  prunePromptEnhancementRows,
  queryRelevantPromptEnhancementMemory,
  recordPromptEnhancementFeedbackEvent,
  recordPromptEnhancementGeneratedOrigin,
  recordPromptEnhancementAction,
  recordPromptEnhancementExposure,
  recordPromptEnhancementMemoryEvidence,
  recordPromptEnhancementMemoryFeedback,
  recordPromptEnhancementPreparedBody,
  recordPromptEnhancementSourceUse,
  resolvePromptEnhancementGeneratedOrigin,
  resetAllPromptEnhancementRows,
  resetPromptEnhancementProjectRows,
  setPromptEnhancementStatus,
  type Store,
} from './index.js';

let cleanupDirs: string[] = [];

afterEach(() => {
  for (const dir of cleanupDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  cleanupDirs = [];
});

describe('prompt-enhancement store, memory, and feedback contract', () => {
  it('creates focused PE-owned tables in the existing sql.js store', async () => {
    const store = await openStore(':memory:');
    try {
      const state = getPromptEnhancementSchemaVersionState(store);

      expect(state.tableStates).toEqual(expect.arrayContaining([
        { tableName: 'prompt_enhancement_memory', exists: true },
        { tableName: 'prompt_enhancement_source_use', exists: true },
        { tableName: 'prompt_enhancement_generated_origin', exists: true },
        { tableName: 'prompt_enhancement_feedback', exists: true },
        { tableName: 'prompt_enhancement_status', exists: true },
      ]));
    } finally {
      closeStore(store);
    }
  });

  it('migrates existing PE lifecycle tables to carry section, action, fallback, and privacy metadata', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nexpath-pe-migration-'));
    cleanupDirs.push(dir);
    const dbPath = join(dir, 'prompt-store.db');
    const SQL = await getSql();
    const oldDb = new SQL.Database();
    oldDb.run(`
      CREATE TABLE prompt_enhancement_source_use (
        source_use_id TEXT PRIMARY KEY,
        project_root TEXT NOT NULL,
        enhancement_id TEXT NOT NULL,
        body_id TEXT NOT NULL,
        body_revision INTEGER NOT NULL,
        source_kind TEXT NOT NULL,
        source_id TEXT NOT NULL,
        use_kind TEXT NOT NULL,
        memory_evidence INTEGER NOT NULL DEFAULT 0,
        schema_version INTEGER NOT NULL,
        reason_codes_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE prompt_enhancement_generated_origin (
        generated_origin_id TEXT PRIMARY KEY,
        project_root TEXT NOT NULL,
        enhancement_id TEXT NOT NULL,
        body_id TEXT NOT NULL,
        body_revision INTEGER NOT NULL,
        generated_origin_state TEXT NOT NULL,
        delivery_channel TEXT NOT NULL,
        prompt_submit_processing_policy TEXT NOT NULL,
        learning_eligible INTEGER NOT NULL DEFAULT 0,
        source_use_ids_json TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        reason_codes_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    writeFileSync(dbPath, oldDb.export());
    oldDb.close();

    const store = await openStore(dbPath);
    try {
      const sourceUseColumns = store.db.exec('PRAGMA table_info(prompt_enhancement_source_use)')[0]?.values.map((row) => row[1]);
      const originColumns = store.db.exec('PRAGMA table_info(prompt_enhancement_generated_origin)')[0]?.values.map((row) => row[1]);
      expect(sourceUseColumns).toContain('section_ids_json');
      expect(originColumns).toEqual(expect.arrayContaining([
        'learning_eligibility_json',
        'action_ids_json',
        'fallback_state',
        'privacy_storage_policy',
      ]));
    } finally {
      closeStore(store);
    }
  });

  it('merges aggregate memory by project_root plus signal_key without durable intent or family keys', async () => {
    const store = await openStore(':memory:');
    try {
      recordPromptEnhancementMemoryEvidence(store, {
        projectRoot: '/repo/a',
        signalKey: 'debugging_observation_gap',
        evidenceKind: 'positive',
        currentEvidenceState: 'live_current',
        confidenceBand: 'high',
        sourceStrength: 'strong',
        protectionState: 'current_source_a',
        status: 'qualified',
        promptIntent: 'debug_and_verify',
        templateFamily: 'debug_maintenance',
        sourceIds: ['source-a'],
        sectionIds: ['section-a'],
        reasonCodes: ['live_current_source_a'],
        now: 100,
      });
      recordPromptEnhancementMemoryEvidence(store, {
        projectRoot: '/repo/a',
        signalKey: 'debugging_observation_gap',
        evidenceKind: 'negative',
        currentEvidenceState: 'feedback_derived',
        confidenceBand: 'medium',
        sourceStrength: 'moderate',
        promptIntent: 'feature_planning',
        templateFamily: 'feature_build',
        sourceIds: ['source-b'],
        sectionIds: ['section-b'],
        reasonCodes: ['scoped_feedback_candidate'],
        now: 200,
      });
      recordPromptEnhancementMemoryEvidence(store, {
        projectRoot: '/repo/b',
        signalKey: 'debugging_observation_gap',
        evidenceKind: 'positive',
        currentEvidenceState: 'historical_candidate',
        confidenceBand: 'low',
        sourceStrength: 'weak',
        status: 'candidate',
        now: 300,
      });

      const row = getPromptEnhancementMemory(store, '/repo/a', 'debugging_observation_gap');
      expect(row).toMatchObject({
        projectRoot: '/repo/a',
        signalKey: 'debugging_observation_gap',
        evidenceCount: 2,
        positiveCount: 1,
        negativeCount: 1,
        currentEvidenceState: 'feedback_derived',
      });
      expect(row?.provenance).toMatchObject({
        promptIntent: 'feature_planning',
        templateFamily: 'feature_build',
        memoryEvidenceOnly: true,
        rawTextStored: false,
      });
      expect(row?.provenance.sourceIds).toEqual(['source-a', 'source-b']);
      expect(queryRelevantPromptEnhancementMemory(store, '/repo/a', ['debugging_observation_gap'])).toHaveLength(1);
      expect(queryRelevantPromptEnhancementMemory(store, '/repo/b', ['debugging_observation_gap'])).toHaveLength(1);
    } finally {
      closeStore(store);
    }
  });

  it('keeps source-use and generated-origin rows separate from memory evidence', async () => {
    const store = await openStore(':memory:');
    try {
      recordPromptEnhancementSourceUse(store, {
        sourceUseId: 'source-use-1',
        projectRoot: '/repo/a',
        enhancementId: 'enh-1',
        bodyId: 'body-1',
        bodyRevision: 1,
        sourceKind: 'content_template_fact',
        sourceId: 'ct:debug',
        sectionIds: ['section:context', 'section:verification'],
        useKind: 'body_section',
        memoryEvidence: false,
        reasonCodes: ['source_use_only'],
        now: 100,
      });
      recordPromptEnhancementGeneratedOrigin(store, {
        generatedOriginId: 'origin-1',
        projectRoot: '/repo/a',
        enhancementId: 'enh-1',
        bodyId: 'body-1',
        bodyRevision: 1,
        generatedOriginState: 'pe_generated_body',
        deliveryChannel: 'cli_stop_bridge',
        promptSubmitProcessingPolicy: 'pe_generated_delivery_skip_classification',
        learningEligibilityFlags: {
          promptHistory: false,
          profile: false,
          stage: false,
          language: false,
          missingSignalMemory: false,
          feedback: false,
          telemetry: false,
          sourceUseTracking: true,
        },
        sourceUseIds: ['source-use-1'],
        actionIds: ['use_current', 'use_original'],
        fallbackState: 'not_fallback',
        privacyStoragePolicy: 'raw_text_excluded_by_default',
        reasonCodes: ['origin_guard_required'],
        now: 101,
      });

      const status = getPromptEnhancementStoreStatus(store, '/repo/a');
      expect(status).toMatchObject({
        schemaVersion: 1,
        enabledState: 'local_store_enabled',
        memoryRows: 0,
        sourceUseRows: 1,
        generatedOriginRows: 1,
        feedbackRows: 0,
        rawContentStoredByDefault: false,
        oldStoreSurfacesAreAuthority: false,
      });
      expect(store.db.exec(
        'SELECT section_ids_json FROM prompt_enhancement_source_use WHERE source_use_id = ?',
        ['source-use-1'],
      )[0]?.values[0]?.[0]).toBe('["section:context","section:verification"]');
      expect(resolvePromptEnhancementGeneratedOrigin(store, {
        projectRoot: '/repo/a',
        bodyId: 'body-1',
        bodyRevision: 1,
      })).toMatchObject({
        sourceUseIds: ['source-use-1'],
        learningEligibilityFlags: {
          promptHistory: false,
          profile: false,
          stage: false,
          language: false,
          missingSignalMemory: false,
          feedback: false,
          telemetry: false,
          sourceUseTracking: true,
        },
        actionIds: ['use_current', 'use_original'],
        fallbackState: 'not_fallback',
        privacyStoragePolicy: 'raw_text_excluded_by_default',
      });
    } finally {
      closeStore(store);
    }
  });

  it('records PE feedback without using product feedback tables or raw text memory', async () => {
    const store = await openStore(':memory:');
    try {
      recordPromptEnhancementFeedbackEvent(store, {
        feedbackEventId: 'feedback-1',
        projectRoot: '/repo/a',
        enhancementId: 'enh-1',
        bodyId: 'body-1',
        bodyRevision: 1,
        feedbackCategory: 'custom_typed',
        feedbackScopeKey: 'debugging_observation_gap',
        learningEligibility: 'pending_policy',
        safetyImpactState: 'unknown',
        memoryEvidence: false,
        reasonCodes: ['custom_feedback_not_memory'],
        now: 100,
      });
      recordPromptEnhancementMemoryFeedback(store, {
        feedbackEventId: 'feedback-2',
        projectRoot: '/repo/a',
        enhancementId: 'enh-1',
        bodyId: 'body-1',
        bodyRevision: 1,
        feedbackCategory: 'not_relevant_enough',
        feedbackScopeKey: 'debugging_observation_gap',
        learningEligibility: 'eligible_scoped',
        safetyImpactState: 'none',
        memoryEvidence: true,
        reasonCodes: ['typed_feedback_category'],
        now: 101,
      });

      const feedbackSignalCount = store.db.exec('SELECT COUNT(*) FROM feedback_signals')[0]?.values[0]?.[0];
      const row = getPromptEnhancementMemory(store, '/repo/a', 'debugging_observation_gap');
      const feedbackRawFlags = store.db.exec('SELECT raw_text_stored FROM prompt_enhancement_feedback ORDER BY feedback_event_id ASC')[0]?.values;

      expect(feedbackSignalCount).toBe(0);
      expect(feedbackRawFlags).toEqual([[0], [0]]);
      expect(row?.negativeCount).toBe(1);
      expect(row?.reasonCodes).toContain('feedback_candidate_not_global_preference');
    } finally {
      closeStore(store);
    }
  });

  it('records prepared body, exposure, and action through explicit PE store ports idempotently', async () => {
    const store = await openStore(':memory:');
    try {
      recordPromptEnhancementPreparedBody(store, {
        preparedBodyId: 'prepared-1',
        projectRoot: '/repo/a',
        enhancementId: 'enh-1',
        bodyId: 'body-1',
        bodyRevision: 1,
        generatedOriginState: 'pe_generated_body',
        deliveryChannel: 'cli_stop_bridge',
        promptSubmitProcessingPolicy: 'pe_generated_delivery_skip_classification',
        learningEligible: false,
        sourceUseIds: ['source-use-1'],
        learningEligibilityFlags: {
          promptHistory: false,
          profile: false,
          stage: false,
          language: false,
          missingSignalMemory: false,
          feedback: false,
          telemetry: false,
          sourceUseTracking: true,
        },
        actionIds: ['use_current', 'use_original', 'close'],
        fallbackState: 'fallback_available_not_used',
        privacyStoragePolicy: 'raw_text_excluded_by_default',
        reasonCodes: ['prepared_before_popup'],
        now: 100,
      });
      recordPromptEnhancementExposure(store, {
        exposureEventId: 'exposure-1',
        projectRoot: '/repo/a',
        enhancementId: 'enh-1',
        bodyId: 'body-1',
        bodyRevision: 1,
        exposureState: 'popup_current_body_shown',
        actionAvailabilityState: 'actions_available',
        now: 101,
      });
      recordPromptEnhancementExposure(store, {
        exposureEventId: 'exposure-1',
        projectRoot: '/repo/a',
        enhancementId: 'enh-1',
        bodyId: 'body-1',
        bodyRevision: 1,
        exposureState: 'popup_current_body_shown',
        actionAvailabilityState: 'actions_available',
        now: 102,
      });
      recordPromptEnhancementAction(store, {
        actionEventId: 'action-1',
        projectRoot: '/repo/a',
        enhancementId: 'enh-1',
        bodyId: 'body-1',
        bodyRevision: 1,
        actionCategory: 'use_original',
        now: 103,
      });

      expect(getPromptEnhancementStoreStatus(store, '/repo/a')).toMatchObject({
        generatedOriginRows: 1,
        feedbackRows: 2,
      });
      expect(store.db.exec('SELECT COUNT(*) FROM feedback_signals')[0]?.values[0]?.[0]).toBe(0);
      expect(store.db.exec('SELECT SUM(raw_text_stored) FROM prompt_enhancement_feedback')[0]?.values[0]?.[0]).toBe(0);
      expect(resolvePromptEnhancementGeneratedOrigin(store, {
        projectRoot: '/repo/a',
        bodyId: 'body-1',
        bodyRevision: 1,
      })).toMatchObject({
        actionIds: ['use_current', 'use_original', 'close'],
        fallbackState: 'fallback_available_not_used',
        privacyStoragePolicy: 'raw_text_excluded_by_default',
      });
    } finally {
      closeStore(store);
    }
  });

  it('resolves generated-origin identity without text-only authority', async () => {
    const store = await openStore(':memory:');
    try {
      recordPromptEnhancementPreparedBody(store, {
        preparedBodyId: 'prepared-1',
        projectRoot: '/repo/a',
        enhancementId: 'enh-1',
        bodyId: 'body-1',
        bodyRevision: 2,
        generatedOriginState: 'user_edited_pe_body',
        deliveryChannel: 'cli_stop_bridge',
        promptSubmitProcessingPolicy: 'pe_generated_delivery_skip_classification',
        learningEligible: true,
        sourceUseIds: ['source-use-1', 'source-use-2'],
        learningEligibilityFlags: {
          promptHistory: false,
          profile: false,
          stage: false,
          language: false,
          missingSignalMemory: false,
          feedback: true,
          telemetry: false,
          sourceUseTracking: true,
        },
        actionIds: ['send_current'],
        fallbackState: 'not_fallback',
        privacyStoragePolicy: 'raw_text_excluded_by_default',
        reasonCodes: ['body_revision_bound'],
        now: 100,
      });

      expect(resolvePromptEnhancementGeneratedOrigin(store, {
        projectRoot: '/repo/a',
        bodyId: 'body-1',
        bodyRevision: 2,
      })).toMatchObject({
        generatedOriginId: 'prepared-1',
        projectRoot: '/repo/a',
        enhancementId: 'enh-1',
        bodyId: 'body-1',
        bodyRevision: 2,
        generatedOriginState: 'user_edited_pe_body',
        learningEligible: true,
        sourceUseIds: ['source-use-1', 'source-use-2'],
        learningEligibilityFlags: {
          promptHistory: false,
          profile: false,
          stage: false,
          language: false,
          missingSignalMemory: false,
          feedback: true,
          telemetry: false,
          sourceUseTracking: true,
        },
        actionIds: ['send_current'],
        fallbackState: 'not_fallback',
        privacyStoragePolicy: 'raw_text_excluded_by_default',
        reasonCodes: ['body_revision_bound'],
      });
      expect(resolvePromptEnhancementGeneratedOrigin(store, {
        projectRoot: '/repo/a',
        bodyId: 'body-1',
        bodyRevision: 3,
      })).toBeNull();
    } finally {
      closeStore(store);
    }
  });

  it('returns public-safe feedback and source-use summaries', async () => {
    const store = await openStore(':memory:');
    try {
      recordPromptEnhancementSourceUse(store, {
        sourceUseId: 'source-use-1',
        projectRoot: '/repo/a',
        enhancementId: 'enh-1',
        bodyId: 'body-1',
        bodyRevision: 1,
        sourceKind: 'content_template_fact',
        sourceId: 'ct:debug',
        useKind: 'body_section',
        memoryEvidence: true,
        now: 100,
      });
      recordPromptEnhancementSourceUse(store, {
        sourceUseId: 'source-use-2',
        projectRoot: '/repo/a',
        enhancementId: 'enh-1',
        bodyId: 'body-1',
        bodyRevision: 1,
        sourceKind: 'stage_or_absence_signal',
        sourceId: 'absence:debug',
        useKind: 'trust_cue',
        memoryEvidence: false,
        now: 101,
      });
      recordPromptEnhancementAction(store, {
        actionEventId: 'action-accept',
        projectRoot: '/repo/a',
        enhancementId: 'enh-1',
        bodyId: 'body-1',
        bodyRevision: 1,
        actionCategory: 'accept_send',
        feedbackScopeKey: 'scope-a',
        learningEligibility: 'eligible_scoped',
        safetyImpactState: 'none',
        memoryEvidence: true,
        now: 102,
      });

      expect(getPromptEnhancementSourceUseSummary(store, '/repo/a', 'body-1')).toMatchObject({
        projectRoot: '/repo/a',
        bodyId: 'body-1',
        totalSourceUses: 2,
        memoryEvidenceRows: 1,
      });
      expect(getPromptEnhancementSourceUseSummary(store, '/repo/a', 'body-1').sourceKindCounts).toEqual([
        { sourceKind: 'content_template_fact', count: 1 },
        { sourceKind: 'stage_or_absence_signal', count: 1 },
      ]);
      expect(getPromptEnhancementFeedbackSummary(store, '/repo/a', 'scope-a')).toMatchObject({
        projectRoot: '/repo/a',
        feedbackScopeKey: 'scope-a',
        totalEvents: 1,
        memoryEvidenceEvents: 1,
        rawTextStoredEvents: 0,
      });
      expect(getPromptEnhancementFeedbackSummary(store, '/repo/a', 'scope-a').categoryCounts).toEqual([
        { feedbackCategory: 'accept_send', count: 1 },
      ]);
    } finally {
      closeStore(store);
    }
  });

  it('supports stable PE feedback categories without raw custom feedback storage', async () => {
    const store = await openStore(':memory:');
    try {
      recordPromptEnhancementMemoryFeedback(store, {
        feedbackEventId: 'feedback-grounding',
        projectRoot: '/repo/a',
        enhancementId: 'enh-1',
        bodyId: 'body-1',
        bodyRevision: 1,
        feedbackCategory: 'not_project_grounded',
        feedbackScopeKey: 'grounding_scope',
        learningEligibility: 'eligible_scoped',
        safetyImpactState: 'none',
        memoryEvidence: true,
        now: 100,
      });
      recordPromptEnhancementMemoryFeedback(store, {
        feedbackEventId: 'feedback-tone',
        projectRoot: '/repo/a',
        enhancementId: 'enh-1',
        bodyId: 'body-1',
        bodyRevision: 1,
        feedbackCategory: 'wrong_tone',
        feedbackScopeKey: 'tone_scope',
        learningEligibility: 'eligible_scoped',
        safetyImpactState: 'none',
        memoryEvidence: true,
        now: 101,
      });
      recordPromptEnhancementMemoryFeedback(store, {
        feedbackEventId: 'feedback-accept',
        projectRoot: '/repo/a',
        enhancementId: 'enh-1',
        bodyId: 'body-1',
        bodyRevision: 1,
        feedbackCategory: 'accept_send',
        feedbackScopeKey: 'positive_scope',
        learningEligibility: 'eligible_scoped',
        safetyImpactState: 'none',
        memoryEvidence: true,
        now: 102,
      });

      expect(getPromptEnhancementMemory(store, '/repo/a', 'grounding_scope')?.negativeCount).toBe(1);
      expect(getPromptEnhancementMemory(store, '/repo/a', 'tone_scope')?.negativeCount).toBe(1);
      expect(getPromptEnhancementMemory(store, '/repo/a', 'positive_scope')?.positiveCount).toBe(1);
      expect(store.db.exec('SELECT SUM(raw_text_stored) FROM prompt_enhancement_feedback')[0]?.values[0]?.[0]).toBe(0);
    } finally {
      closeStore(store);
    }
  });

  it('rejects invalid typed identities before mutating PE rows', async () => {
    const store = await openStore(':memory:');
    try {
      expect(() => recordPromptEnhancementMemoryEvidence(store, {
        projectRoot: ' ',
        signalKey: 'signal-a',
        evidenceKind: 'positive',
        currentEvidenceState: 'historical_candidate',
        confidenceBand: 'low',
        sourceStrength: 'weak',
      })).toThrow('project_root_required');
      expect(() => recordPromptEnhancementSourceUse(store, {
        sourceUseId: '',
        projectRoot: '/repo/a',
        enhancementId: 'enh-1',
        bodyId: 'body-1',
        bodyRevision: 1,
        sourceKind: 'content_template_fact',
        sourceId: 'ct:debug',
        useKind: 'body_section',
      })).toThrow('source_use_id_required');
      expect(() => recordPromptEnhancementGeneratedOrigin(store, {
        generatedOriginId: 'origin-1',
        projectRoot: '/repo/a',
        enhancementId: '',
        bodyId: 'body-1',
        bodyRevision: 1,
        generatedOriginState: 'pe_generated_body',
        deliveryChannel: 'cli_stop_bridge',
        promptSubmitProcessingPolicy: 'pe_generated_delivery_skip_classification',
      })).toThrow('enhancement_id_required');
      expect(() => recordPromptEnhancementFeedbackEvent(store, {
        feedbackEventId: 'feedback-1',
        projectRoot: '/repo/a',
        enhancementId: 'enh-1',
        bodyId: ' ',
        bodyRevision: 1,
        feedbackCategory: 'custom_typed',
        feedbackScopeKey: 'scope-a',
        learningEligibility: 'pending_policy',
        safetyImpactState: 'unknown',
      })).toThrow('body_id_required');

      expect(getPromptEnhancementStoreStatus(store).memoryRows).toBe(0);
      expect(getPromptEnhancementStoreStatus(store).sourceUseRows).toBe(0);
      expect(getPromptEnhancementStoreStatus(store).generatedOriginRows).toBe(0);
      expect(getPromptEnhancementStoreStatus(store).feedbackRows).toBe(0);
      expect(getPromptEnhancementStoreStatus(store).statusRows).toBe(0);
    } finally {
      closeStore(store);
    }
  });

  it('prunes low-value stale rows while preserving protected current or safety rows', async () => {
    const store = await openStore(':memory:');
    try {
      recordMemory(store, '/repo/a', 'stale-low', 100, { decayAfter: 150 });
      recordMemory(store, '/repo/a', 'protected-safety', 100, {
        protectionState: 'safety_protected',
        decayAfter: 150,
      });
      recordMemory(store, '/repo/a', 'recent-low', 300);

      const result = prunePromptEnhancementMemory(store, {
        projectRoot: '/repo/a',
        olderThan: 250,
        maxRowsPerProject: 2,
        now: 300,
      });

      expect(result.reasonCodes).toEqual(expect.arrayContaining([
        'stale_low_value_rows_pruned',
        'row_cap_enforced_without_prompt_fifo',
      ]));
      expect(getPromptEnhancementMemory(store, '/repo/a', 'stale-low')).toBeNull();
      expect(getPromptEnhancementMemory(store, '/repo/a', 'protected-safety')).not.toBeNull();
      expect(getPromptEnhancementMemory(store, '/repo/a', 'recent-low')).not.toBeNull();
      expect(getPromptEnhancementStoreStatus(store, '/repo/a').statusRows).toBeGreaterThan(0);
      expect(getPromptEnhancementStoreStatus(store, '/repo/a')).toMatchObject({
        capState: 'over_row_cap_pruned',
        lastPruneAt: 300,
        lastDecayAt: 300,
      });
      expect(getPromptEnhancementStoreStatus(store, '/repo/a').reasonCodes).toEqual(expect.arrayContaining([
        'stale_low_value_rows_pruned',
        'row_cap_enforced_without_prompt_fifo',
      ]));
    } finally {
      closeStore(store);
    }
  });

  it('prunes PE feedback, source-use, and generated-origin lifecycle rows without prompt FIFO cleanup', async () => {
    const store = await openStore(':memory:');
    try {
      recordPromptEnhancementSourceUse(store, {
        sourceUseId: 'source-use-old-a',
        projectRoot: '/repo/a',
        enhancementId: 'enh-a',
        bodyId: 'body-a',
        bodyRevision: 1,
        sourceKind: 'content_template_fact',
        sourceId: 'ct:a',
        useKind: 'body_section',
        now: 100,
      });
      recordPromptEnhancementGeneratedOrigin(store, {
        generatedOriginId: 'origin-old-a',
        projectRoot: '/repo/a',
        enhancementId: 'enh-a',
        bodyId: 'body-a',
        bodyRevision: 1,
        generatedOriginState: 'pe_generated_body',
        deliveryChannel: 'cli_stop_bridge',
        promptSubmitProcessingPolicy: 'pe_generated_delivery_skip_classification',
        now: 101,
      });
      recordPromptEnhancementFeedbackEvent(store, {
        feedbackEventId: 'feedback-old-a',
        projectRoot: '/repo/a',
        enhancementId: 'enh-a',
        bodyId: 'body-a',
        bodyRevision: 1,
        feedbackCategory: 'skip_cancel',
        feedbackScopeKey: 'scope-a',
        learningEligibility: 'not_eligible',
        safetyImpactState: 'none',
        now: 102,
      });
      recordPromptEnhancementSourceUse(store, {
        sourceUseId: 'source-use-old-b',
        projectRoot: '/repo/b',
        enhancementId: 'enh-b',
        bodyId: 'body-b',
        bodyRevision: 1,
        sourceKind: 'content_template_fact',
        sourceId: 'ct:b',
        useKind: 'body_section',
        now: 100,
      });

      const result = prunePromptEnhancementFeedbackAndSourceUse(store, {
        projectRoot: '/repo/a',
        olderThan: 200,
        now: 300,
      });

      expect(result).toMatchObject({
        deletedRows: 3,
        decayedRows: 0,
      });
      expect(result.reasonCodes).toContain('lifecycle_rows_pruned_without_prompt_fifo');
      expect(getPromptEnhancementStoreStatus(store, '/repo/a')).toMatchObject({
        sourceUseRows: 0,
        generatedOriginRows: 0,
        feedbackRows: 0,
        lastPruneAt: 300,
      });
      expect(getPromptEnhancementStoreStatus(store, '/repo/b').sourceUseRows).toBe(1);
      expect(store.db.exec('SELECT COUNT(*) FROM prompts')[0]?.values[0]?.[0]).toBe(0);
    } finally {
      closeStore(store);
    }
  });

  it('prunes all PE row classes through the combined reset-safe prune port', async () => {
    const store = await openStore(':memory:');
    try {
      recordMemory(store, '/repo/a', 'memory-old', 100);
      recordPromptEnhancementFeedbackEvent(store, {
        feedbackEventId: 'feedback-old',
        projectRoot: '/repo/a',
        enhancementId: 'enh-a',
        bodyId: 'body-a',
        bodyRevision: 1,
        feedbackCategory: 'reject',
        feedbackScopeKey: 'memory-old',
        learningEligibility: 'not_eligible',
        safetyImpactState: 'none',
        now: 100,
      });

      const result = prunePromptEnhancementRows(store, {
        projectRoot: '/repo/a',
        olderThan: 200,
        now: 300,
      });

      expect(result.deletedRows).toBe(2);
      expect(getPromptEnhancementStoreStatus(store, '/repo/a')).toMatchObject({
        memoryRows: 0,
        feedbackRows: 0,
      });
    } finally {
      closeStore(store);
    }
  });

  it('uses neutral no-memory fallback for newer or corrupt aggregate rows', async () => {
    const store = await openStore(':memory:');
    try {
      recordMemory(store, '/repo/a', 'newer-schema', 100);
      recordMemory(store, '/repo/a', 'corrupt-provenance', 100);
      store.db.run(
        'UPDATE prompt_enhancement_memory SET schema_version = ? WHERE project_root = ? AND signal_key = ?',
        [999, '/repo/a', 'newer-schema'],
      );
      store.db.run(
        'UPDATE prompt_enhancement_memory SET provenance_json = ? WHERE project_root = ? AND signal_key = ?',
        ['{"memoryEvidenceOnly":false,"rawTextStored":true}', '/repo/a', 'corrupt-provenance'],
      );

      expect(getPromptEnhancementMemory(store, '/repo/a', 'newer-schema')).toBeNull();
      expect(getPromptEnhancementMemory(store, '/repo/a', 'corrupt-provenance')).toBeNull();
      expect(queryRelevantPromptEnhancementMemory(store, '/repo/a', ['newer-schema', 'corrupt-provenance'])).toEqual([]);
    } finally {
      closeStore(store);
    }
  });

  it('enforces PE byte pressure independently of prompt FIFO cleanup', async () => {
    const store = await openStore(':memory:');
    try {
      recordMemory(store, '/repo/a', 'old-low-a', 100, { sourceIds: ['source-a'.repeat(30)] });
      recordMemory(store, '/repo/a', 'old-low-b', 101, { sourceIds: ['source-b'.repeat(30)] });
      recordMemory(store, '/repo/a', 'protected', 50, {
        protectionState: 'mandatory_protected',
        sourceIds: ['protected'.repeat(30)],
      });

      const result = prunePromptEnhancementMemory(store, {
        projectRoot: '/repo/a',
        maxEstimatedBytes: 1,
        now: 300,
      });

      expect(result.reasonCodes).toContain('byte_cap_enforced_without_prompt_fifo');
      expect(result.deletedRows).toBe(2);
      expect(getPromptEnhancementMemory(store, '/repo/a', 'old-low-a')).toBeNull();
      expect(getPromptEnhancementMemory(store, '/repo/a', 'old-low-b')).toBeNull();
      expect(getPromptEnhancementMemory(store, '/repo/a', 'protected')).not.toBeNull();
      expect(store.db.exec('SELECT COUNT(*) FROM prompts')[0]?.values[0]?.[0]).toBe(0);
    } finally {
      closeStore(store);
    }
  });

  it('updates bounded PE status rows through typed ports', async () => {
    const store = await openStore(':memory:');
    try {
      recordMemory(store, '/repo/a', 'signal-a', 100);
      recordPromptEnhancementFeedbackEvent(store, {
        feedbackEventId: 'feedback-1',
        projectRoot: '/repo/a',
        enhancementId: 'enh-1',
        bodyId: 'body-1',
        bodyRevision: 1,
        feedbackCategory: 'custom_typed',
        feedbackScopeKey: 'signal-a',
        learningEligibility: 'pending_policy',
        safetyImpactState: 'unknown',
        memoryEvidence: false,
        now: 101,
      });
      setPromptEnhancementStatus(store, {
        projectRoot: '/repo/a',
        statusKey: 'last_error',
        statusValue: JSON.stringify({ errorCode: 'fixture_error', rawContentStored: false }),
        now: 102,
      });

      const rows = store.db.exec(
        'SELECT status_key, status_value FROM prompt_enhancement_status WHERE project_root = ? ORDER BY status_key',
        ['/repo/a'],
      )[0]?.values ?? [];
      expect(rows.map((row) => row[0])).toEqual([
        'last_error',
        'last_feedback_event',
        'last_memory_evidence',
      ]);
      expect(rows.map((row) => String(row[1]))).toEqual(expect.arrayContaining([
        expect.stringContaining('"rawContentStored":false'),
      ]));
      expect(deletePromptEnhancementStatusForProject(store, '/repo/a')).toBe(3);
      expect(getPromptEnhancementStoreStatus(store, '/repo/a').statusRows).toBe(0);
      expect(getPromptEnhancementMemory(store, '/repo/a', 'signal-a')).not.toBeNull();
    } finally {
      closeStore(store);
    }
  });

  it('reports public-safe fallback and error counts in PE status/debug', async () => {
    const store = await openStore(':memory:');
    try {
      setPromptEnhancementStatus(store, {
        projectRoot: '/repo/a',
        statusKey: 'last_fallback',
        statusValue: JSON.stringify({ fallbackCode: 'no_memory', rawContentStored: false, at: 100 }),
        now: 100,
      });
      setPromptEnhancementStatus(store, {
        projectRoot: '/repo/a',
        statusKey: 'last_error',
        statusValue: JSON.stringify({ errorCode: 'fixture_error', rawContentStored: false, at: 101 }),
        now: 101,
      });

      expect(getPromptEnhancementStoreStatus(store, '/repo/a')).toMatchObject({
        fallbackCount: 1,
        errorCount: 1,
        rawContentStoredByDefault: false,
        telemetryPolicy: 'ids_enums_counts_status_timing_only',
      });
    } finally {
      closeStore(store);
    }
  });

  it('deletes PE rows idempotently by project without touching old store rows', async () => {
    const store = await openStore(':memory:');
    try {
      store.db.run(
        "INSERT INTO feedback_signals (project_root, kind, occurred_at) VALUES (?, 'advisory_fired', ?)",
        ['/repo/a', 10],
      );
      recordMemory(store, '/repo/a', 'signal-a', 100);
      recordMemory(store, '/repo/b', 'signal-b', 100);
      recordPromptEnhancementSourceUse(store, {
        sourceUseId: 'source-use-a',
        projectRoot: '/repo/a',
        enhancementId: 'enh-a',
        bodyId: 'body-a',
        bodyRevision: 1,
        sourceKind: 'stage_or_absence_signal',
        sourceId: 'absence:a',
        useKind: 'body_section',
      });

      expect(deletePromptEnhancementProjectRows(store, '/repo/a')).toBe(4);
      expect(deletePromptEnhancementProjectRows(store, '/repo/a')).toBe(0);
      expect(getPromptEnhancementMemory(store, '/repo/a', 'signal-a')).toBeNull();
      expect(getPromptEnhancementMemory(store, '/repo/b', 'signal-b')).not.toBeNull();
      expect(store.db.exec('SELECT COUNT(*) FROM feedback_signals')[0]?.values[0]?.[0]).toBe(1);
      expect(deleteAllPromptEnhancementMemory(store)).toBe(1);
      expect(getPromptEnhancementStoreStatus(store).memoryRows).toBe(0);
      expect(getPromptEnhancementStoreStatus(store).statusRows).toBe(1);
    } finally {
      closeStore(store);
    }
  });

  it('keeps memory-specific delete helpers narrower than lifecycle cleanup', async () => {
    const store = await openStore(':memory:');
    try {
      recordMemory(store, '/repo/a', 'signal-a', 100);
      recordPromptEnhancementSourceUse(store, {
        sourceUseId: 'source-use-a',
        projectRoot: '/repo/a',
        enhancementId: 'enh-a',
        bodyId: 'body-a',
        bodyRevision: 1,
        sourceKind: 'source_a_point_ref',
        sourceId: 'point:a',
        useKind: 'body_section',
      });

      expect(deletePromptEnhancementMemoryForProject(store, '/repo/a')).toBe(1);
      expect(getPromptEnhancementStoreStatus(store, '/repo/a')).toMatchObject({
        memoryRows: 0,
        sourceUseRows: 1,
        statusRows: 2,
      });
      expect(deletePromptEnhancementProjectRows(store, '/repo/a')).toBe(3);
    } finally {
      closeStore(store);
    }
  });

  it('cleans generated-origin with source-use helpers and exposes reset aliases', async () => {
    const store = await openStore(':memory:');
    try {
      recordPromptEnhancementSourceUse(store, {
        sourceUseId: 'source-use-a',
        projectRoot: '/repo/a',
        enhancementId: 'enh-a',
        bodyId: 'body-a',
        bodyRevision: 1,
        sourceKind: 'content_template_fact',
        sourceId: 'ct:a',
        useKind: 'body_section',
      });
      recordPromptEnhancementGeneratedOrigin(store, {
        generatedOriginId: 'origin-a',
        projectRoot: '/repo/a',
        enhancementId: 'enh-a',
        bodyId: 'body-a',
        bodyRevision: 1,
        generatedOriginState: 'pe_generated_body',
        deliveryChannel: 'cli_stop_bridge',
        promptSubmitProcessingPolicy: 'pe_generated_delivery_skip_classification',
      });

      expect(deletePromptEnhancementSourceUseForProject(store, '/repo/a')).toBe(2);
      expect(getPromptEnhancementStoreStatus(store, '/repo/a')).toMatchObject({
        sourceUseRows: 0,
        generatedOriginRows: 0,
      });

      recordMemory(store, '/repo/a', 'signal-a', 100);
      recordMemory(store, '/repo/b', 'signal-b', 100);
      expect(resetPromptEnhancementProjectRows(store, '/repo/a')).toBe(4);
      expect(getPromptEnhancementMemory(store, '/repo/a', 'signal-a')).toBeNull();
      expect(getPromptEnhancementMemory(store, '/repo/b', 'signal-b')).not.toBeNull();
      expect(deleteAllPromptEnhancementRows(store)).toBe(2);
      expect(resetAllPromptEnhancementRows(store)).toBe(0);
    } finally {
      closeStore(store);
    }
  });

  it('binds a used memory row to a body source-use ref without making it memory evidence', async () => {
    const store = await openStore(':memory:');
    try {
      recordMemory(store, '/repo/a', 'missing_repro_steps', 100, {
        status: 'qualified',
      });

      expect(markPromptEnhancementMemoryUsed(store, '/repo/a', 'missing_repro_steps', 200, {
        sourceUseId: 'memory-use-1',
        enhancementId: 'enh-1',
        bodyId: 'body-1',
        bodyRevision: 2,
        reasonCodes: ['section:verification'],
      })).toBe(true);
      expect(markPromptEnhancementMemoryUsed(store, '/repo/a', 'unknown-signal', 201, {
        sourceUseId: 'memory-use-missing',
        enhancementId: 'enh-1',
        bodyId: 'body-1',
        bodyRevision: 2,
      })).toBe(false);

      const sourceSummary = getPromptEnhancementSourceUseSummary(store, '/repo/a', 'body-1');
      expect(sourceSummary).toMatchObject({
        totalSourceUses: 1,
        memoryEvidenceRows: 0,
      });
      expect(sourceSummary.sourceKindCounts).toEqual([{ sourceKind: 'memory_ref', count: 1 }]);
      expect(getPromptEnhancementStoreStatus(store, '/repo/a')).toMatchObject({
        memoryRows: 1,
        sourceUseRows: 1,
      });
      expect(getPromptEnhancementMemory(store, '/repo/a', 'missing_repro_steps')?.lastUsedAt).toBe(200);
    } finally {
      closeStore(store);
    }
  });

  it('persists PE aggregate rows in disk-backed stores after explicit saves', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nexpath-pe-store-'));
    cleanupDirs.push(dir);
    const dbPath = join(dir, 'prompt-store.db');
    let store: Store | null = await openStore(dbPath);
    try {
      recordMemory(store, '/repo/a', 'disk-signal', 100);
      closeStore(store);
      store = null;

      const reopened = await openStore(dbPath);
      try {
        expect(getPromptEnhancementMemory(reopened, '/repo/a', 'disk-signal')?.evidenceCount).toBe(1);
        expect(markPromptEnhancementMemoryUsed(reopened, '/repo/a', 'disk-signal', 200)).toBe(true);
      } finally {
        closeStore(reopened);
      }
    } finally {
      if (store) closeStore(store);
    }
  });
});

function recordMemory(
  store: Store,
  projectRoot: string,
  signalKey: string,
  now: number,
  overrides: Partial<Parameters<typeof recordPromptEnhancementMemoryEvidence>[1]> = {},
): void {
  recordPromptEnhancementMemoryEvidence(store, {
    projectRoot,
    signalKey,
    evidenceKind: 'positive',
    currentEvidenceState: 'historical_candidate',
    confidenceBand: 'low',
    sourceStrength: 'weak',
    status: 'candidate',
    now,
    ...overrides,
  });
}
