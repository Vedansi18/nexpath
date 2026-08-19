import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { reacquireStoreLock, releaseStoreLock } from './db.js';
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
      const indexNames = store.db.exec(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_pe_%' ORDER BY name ASC",
      )[0]?.values.map((row) => row[0]);
      expect(indexNames).toEqual(expect.arrayContaining([
        'idx_pe_memory_project_updated',
        'idx_pe_memory_project_status_updated',
        'idx_pe_source_use_project_body',
        'idx_pe_source_use_project_source',
        'idx_pe_source_use_project_created',
        'idx_pe_generated_origin_project_body',
        'idx_pe_generated_origin_project_created',
        'idx_pe_feedback_project_body',
        'idx_pe_feedback_project_category',
        'idx_pe_feedback_project_scope',
        'idx_pe_status_project_updated',
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
        reasonCodes: ['duplicate_replay_must_not_relearn'],
        now: 102,
      });

      const feedbackSignalCount = store.db.exec('SELECT COUNT(*) FROM feedback_signals')[0]?.values[0]?.[0];
      const row = getPromptEnhancementMemory(store, '/repo/a', 'debugging_observation_gap');
      const feedbackRawFlags = store.db.exec('SELECT raw_text_stored FROM prompt_enhancement_feedback ORDER BY feedback_event_id ASC')[0]?.values;

      expect(feedbackSignalCount).toBe(0);
      expect(feedbackRawFlags).toEqual([[0], [0]]);
      expect(row?.evidenceCount).toBe(1);
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

  it('keeps raw-looking text out of PE memory and source-use metadata', async () => {
    const store = await openStore(':memory:');
    try {
      recordPromptEnhancementMemoryEvidence(store, {
        projectRoot: '/repo/a',
        signalKey: 'safe_signal_key',
        evidenceKind: 'positive',
        currentEvidenceState: 'live_current',
        confidenceBand: 'high',
        sourceStrength: 'strong',
        promptIntent: 'debug intent with raw words',
        templateFamily: 'debug_family',
        sourceIds: ['source:safe', 'raw source excerpt should not persist'],
        sectionIds: ['section:safe', 'generated body text should not persist'],
        reasonCodes: ['safe_reason', 'raw custom feedback should not persist'],
        now: 100,
      });
      recordPromptEnhancementSourceUse(store, {
        sourceUseId: 'source-use-1',
        projectRoot: '/repo/a',
        enhancementId: 'enh-1',
        bodyId: 'body-1',
        bodyRevision: 1,
        sourceKind: 'source_a_point_ref',
        sourceId: 'source:safe',
        sectionIds: ['section:safe', 'raw section label should not persist'],
        useKind: 'body_section',
        reasonCodes: ['safe_source_reason', 'raw prompt text should not persist'],
        now: 101,
      });

      const row = getPromptEnhancementMemory(store, '/repo/a', 'safe_signal_key');
      expect(row?.provenance).toMatchObject({
        promptIntent: undefined,
        templateFamily: 'debug_family',
        sourceIds: ['source:safe'],
        sectionIds: ['section:safe'],
      });
      expect(row?.reasonCodes).toEqual(['safe_reason']);
      const sourceUse = store.db.exec(
        'SELECT section_ids_json, reason_codes_json FROM prompt_enhancement_source_use WHERE source_use_id = ?',
        ['source-use-1'],
      )[0]?.values[0];
      expect(sourceUse?.[0]).toBe('["section:safe"]');
      expect(sourceUse?.[1]).toBe('["safe_source_reason"]');
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
      })).toThrow('source_use_id_public_safe_token_required');
      expect(() => recordPromptEnhancementMemoryEvidence(store, {
        projectRoot: '/repo/a',
        signalKey: ' signal-a ',
        evidenceKind: 'positive',
        currentEvidenceState: 'historical_candidate',
        confidenceBand: 'low',
        sourceStrength: 'weak',
      })).toThrow('signal_key_public_safe_token_required');
      expect(() => recordPromptEnhancementGeneratedOrigin(store, {
        generatedOriginId: 'origin-1',
        projectRoot: '/repo/a',
        enhancementId: '',
        bodyId: 'body-1',
        bodyRevision: 1,
        generatedOriginState: 'pe_generated_body',
        deliveryChannel: 'cli_stop_bridge',
        promptSubmitProcessingPolicy: 'pe_generated_delivery_skip_classification',
      })).toThrow('enhancement_id_public_safe_token_required');
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
      })).toThrow('body_id_public_safe_token_required');
      expect(() => recordPromptEnhancementSourceUse(store, {
        sourceUseId: 'source-use-raw',
        projectRoot: '/repo/a',
        enhancementId: 'enh-1',
        bodyId: 'body-1',
        bodyRevision: 1,
        sourceKind: 'content template fact',
        sourceId: 'ct:debug',
        useKind: 'body_section',
      })).toThrow('source_kind_public_safe_token_required');
      expect(() => recordPromptEnhancementSourceUse(store, {
        sourceUseId: 'source-use-raw',
        projectRoot: '/repo/a',
        enhancementId: 'enh-1',
        bodyId: 'body-1',
        bodyRevision: 1,
        sourceKind: 'content_template_fact',
        sourceId: 'raw source excerpt should not persist',
        useKind: 'body_section',
      })).toThrow('source_id_public_safe_token_required');
      expect(() => recordPromptEnhancementGeneratedOrigin(store, {
        generatedOriginId: 'origin-raw',
        projectRoot: '/repo/a',
        enhancementId: 'enh-1',
        bodyId: 'body-1',
        bodyRevision: 1,
        generatedOriginState: 'pe_generated_body',
        deliveryChannel: 'cli_stop_bridge',
        promptSubmitProcessingPolicy: 'pe_generated_delivery_skip_classification',
        sourceUseIds: ['source-use-1', 'raw source use should not persist'],
      })).toThrow('source_use_id_public_safe_token_required');
      expect(() => recordPromptEnhancementGeneratedOrigin(store, {
        generatedOriginId: ' origin-raw ',
        projectRoot: '/repo/a',
        enhancementId: 'enh-1',
        bodyId: 'body-1',
        bodyRevision: 1,
        generatedOriginState: 'pe_generated_body',
        deliveryChannel: 'cli_stop_bridge',
        promptSubmitProcessingPolicy: 'pe_generated_delivery_skip_classification',
      })).toThrow('generated_origin_id_public_safe_token_required');
      expect(() => recordPromptEnhancementGeneratedOrigin(store, {
        generatedOriginId: 'origin-raw',
        projectRoot: '/repo/a',
        enhancementId: 'enh-1',
        bodyId: 'body-1',
        bodyRevision: 1,
        generatedOriginState: 'pe_generated_body',
        deliveryChannel: 'cli_stop_bridge',
        promptSubmitProcessingPolicy: 'pe_generated_delivery_skip_classification',
        actionIds: ['use_current', 'raw action label should not persist'],
      })).toThrow('action_id_public_safe_token_required');
      expect(() => recordPromptEnhancementFeedbackEvent(store, {
        feedbackEventId: 'feedback-raw',
        projectRoot: '/repo/a',
        enhancementId: 'enh-1',
        bodyId: 'body-1',
        bodyRevision: 1,
        feedbackCategory: 'custom_typed',
        feedbackScopeKey: 'raw custom feedback should not persist',
        learningEligibility: 'pending_policy',
        safetyImpactState: 'unknown',
      })).toThrow('feedback_scope_key_public_safe_token_required');
      expect(() => recordPromptEnhancementMemoryEvidence(store, {
        projectRoot: '/repo/a',
        signalKey: 'signal-a',
        evidenceKind: 'raw_feedback_text' as never,
        currentEvidenceState: 'historical_candidate',
        confidenceBand: 'low',
        sourceStrength: 'weak',
      })).toThrow('evidence_kind_known_value_required');
      expect(() => recordPromptEnhancementMemoryEvidence(store, {
        projectRoot: '/repo/a',
        signalKey: 'signal-a',
        evidenceKind: 'positive',
        currentEvidenceState: 'raw source sentence' as never,
        confidenceBand: 'low',
        sourceStrength: 'weak',
      })).toThrow('current_evidence_state_known_value_required');
      expect(() => recordPromptEnhancementSourceUse(store, {
        sourceUseId: 'source-use-kind',
        projectRoot: '/repo/a',
        enhancementId: 'enh-1',
        bodyId: 'body-1',
        bodyRevision: 1,
        sourceKind: 'content_template_fact',
        sourceId: 'ct:debug',
        useKind: 'raw_action_label' as never,
      })).toThrow('source_use_kind_known_value_required');
      expect(() => recordPromptEnhancementFeedbackEvent(store, {
        feedbackEventId: 'feedback-category',
        projectRoot: '/repo/a',
        enhancementId: 'enh-1',
        bodyId: 'body-1',
        bodyRevision: 1,
        feedbackCategory: 'raw_feedback_category' as never,
        feedbackScopeKey: 'scope-a',
        learningEligibility: 'pending_policy',
        safetyImpactState: 'unknown',
      })).toThrow('feedback_category_known_value_required');
      expect(() => recordPromptEnhancementFeedbackEvent(store, {
        feedbackEventId: 'feedback-learning',
        projectRoot: '/repo/a',
        enhancementId: 'enh-1',
        bodyId: 'body-1',
        bodyRevision: 1,
        feedbackCategory: 'custom_typed',
        feedbackScopeKey: 'scope-a',
        learningEligibility: 'raw_learning_claim' as never,
        safetyImpactState: 'unknown',
      })).toThrow('feedback_learning_eligibility_known_value_required');
      expect(() => setPromptEnhancementStatus(store, {
        projectRoot: '/repo/a',
        statusKey: 'raw status key should not persist',
        statusValue: JSON.stringify({ safe: 'value' }),
      })).toThrow('status_key_public_safe_token_required');

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
        rowCapState: 'over_row_cap_pruned',
        byteThresholdState: 'within_bounds',
        lastCleanupOutcome: 'row_cap_enforced_without_prompt_fifo',
        memoryRows: 2,
        globalMemoryRows: 2,
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
      recordMemory(store, '/repo/a', 'corrupt-state', 100);
      recordMemory(store, '/repo/a', 'policy-disabled', 100);
      recordMemory(store, '/repo/a', 'malformed-status', 100);
      store.db.run(
        'UPDATE prompt_enhancement_memory SET schema_version = ? WHERE project_root = ? AND signal_key = ?',
        [999, '/repo/a', 'newer-schema'],
      );
      store.db.run(
        'UPDATE prompt_enhancement_memory SET provenance_json = ? WHERE project_root = ? AND signal_key = ?',
        ['{"memoryEvidenceOnly":false,"rawTextStored":true}', '/repo/a', 'corrupt-provenance'],
      );
      store.db.run(
        'UPDATE prompt_enhancement_memory SET current_evidence_state = ? WHERE project_root = ? AND signal_key = ?',
        ['raw prompt text should not be trusted', '/repo/a', 'corrupt-state'],
      );
      store.db.run(
        'UPDATE prompt_enhancement_memory SET status = ? WHERE project_root = ? AND signal_key = ?',
        ['disabled_by_policy', '/repo/a', 'policy-disabled'],
      );
      store.db.run(
        'UPDATE prompt_enhancement_memory SET status = ? WHERE project_root = ? AND signal_key = ?',
        ['malformed_ignored', '/repo/a', 'malformed-status'],
      );

      expect(getPromptEnhancementMemory(store, '/repo/a', 'newer-schema')).toBeNull();
      expect(getPromptEnhancementMemory(store, '/repo/a', 'corrupt-provenance')).toBeNull();
      expect(getPromptEnhancementMemory(store, '/repo/a', 'corrupt-state')).toBeNull();
      expect(getPromptEnhancementMemory(store, '/repo/a', 'policy-disabled')).toBeNull();
      expect(getPromptEnhancementMemory(store, '/repo/a', 'malformed-status')).toBeNull();
      expect(queryRelevantPromptEnhancementMemory(store, '/repo/a', [
        'newer-schema',
        'corrupt-provenance',
        'corrupt-state',
        'policy-disabled',
        'malformed-status',
      ])).toEqual([]);
    } finally {
      closeStore(store);
    }
  });

  it('uses neutral no-data fallback for newer or corrupt lifecycle rows', async () => {
    const store = await openStore(':memory:');
    try {
      recordPromptEnhancementSourceUse(store, {
        sourceUseId: 'source-use-safe',
        projectRoot: '/repo/a',
        enhancementId: 'enh-1',
        bodyId: 'body-1',
        bodyRevision: 1,
        sourceKind: 'content_template_fact',
        sourceId: 'ct:safe',
        useKind: 'body_section',
        memoryEvidence: true,
        now: 100,
      });
      recordPromptEnhancementFeedbackEvent(store, {
        feedbackEventId: 'feedback-safe',
        projectRoot: '/repo/a',
        enhancementId: 'enh-1',
        bodyId: 'body-1',
        bodyRevision: 1,
        feedbackCategory: 'accept_send',
        feedbackScopeKey: 'scope-safe',
        learningEligibility: 'eligible_scoped',
        safetyImpactState: 'none',
        memoryEvidence: true,
        now: 101,
      });
      recordPromptEnhancementGeneratedOrigin(store, {
        generatedOriginId: 'origin-safe',
        projectRoot: '/repo/a',
        enhancementId: 'enh-1',
        bodyId: 'body-1',
        bodyRevision: 1,
        generatedOriginState: 'pe_generated_body',
        deliveryChannel: 'cli_stop_bridge',
        promptSubmitProcessingPolicy: 'pe_generated_delivery_skip_classification',
        now: 102,
      });
      store.db.run(
        'UPDATE prompt_enhancement_source_use SET source_kind = ?, use_kind = ? WHERE source_use_id = ?',
        ['raw source excerpt should not return', 'raw use kind should not return', 'source-use-safe'],
      );
      store.db.run(
        'UPDATE prompt_enhancement_feedback SET feedback_category = ?, raw_text_stored = 1 WHERE feedback_event_id = ?',
        ['raw custom feedback should not return', 'feedback-safe'],
      );
      store.db.run(
        'UPDATE prompt_enhancement_generated_origin SET generated_origin_state = ? WHERE generated_origin_id = ?',
        ['raw generated body should not resolve', 'origin-safe'],
      );
      recordPromptEnhancementSourceUse(store, {
        sourceUseId: 'source-use-newer',
        projectRoot: '/repo/a',
        enhancementId: 'enh-1',
        bodyId: 'body-1',
        bodyRevision: 1,
        sourceKind: 'stage_or_absence_signal',
        sourceId: 'absence:safe',
        useKind: 'trust_cue',
        memoryEvidence: true,
        now: 103,
      });
      recordPromptEnhancementFeedbackEvent(store, {
        feedbackEventId: 'feedback-newer',
        projectRoot: '/repo/a',
        enhancementId: 'enh-1',
        bodyId: 'body-1',
        bodyRevision: 1,
        feedbackCategory: 'wrong_tone',
        feedbackScopeKey: 'scope-safe',
        learningEligibility: 'eligible_scoped',
        safetyImpactState: 'none',
        memoryEvidence: true,
        now: 104,
      });
      store.db.run('UPDATE prompt_enhancement_source_use SET schema_version = ? WHERE source_use_id = ?', [999, 'source-use-newer']);
      store.db.run('UPDATE prompt_enhancement_feedback SET schema_version = ? WHERE feedback_event_id = ?', [999, 'feedback-newer']);

      const sourceSummary = getPromptEnhancementSourceUseSummary(store, '/repo/a', 'body-1');
      const feedbackSummary = getPromptEnhancementFeedbackSummary(store, '/repo/a', 'scope-safe');
      const serialized = JSON.stringify({ sourceSummary, feedbackSummary });

      expect(sourceSummary).toMatchObject({ totalSourceUses: 0, memoryEvidenceRows: 0 });
      expect(sourceSummary.sourceKindCounts).toEqual([]);
      expect(sourceSummary.useKindCounts).toEqual([]);
      expect(feedbackSummary).toMatchObject({ totalEvents: 0, memoryEvidenceEvents: 0, rawTextStoredEvents: 0 });
      expect(feedbackSummary.categoryCounts).toEqual([]);
      expect(resolvePromptEnhancementGeneratedOrigin(store, {
        projectRoot: '/repo/a',
        bodyId: 'body-1',
        bodyRevision: 1,
      })).toBeNull();
      expect(serialized).not.toContain('raw source excerpt');
      expect(serialized).not.toContain('raw use kind');
      expect(serialized).not.toContain('raw custom feedback');
      expect(() => getPromptEnhancementSourceUseSummary(store, '/repo/a', 'raw body id should fail')).toThrow('body_id_public_safe_token_required');
      expect(() => getPromptEnhancementFeedbackSummary(store, '/repo/a', 'raw scope should fail')).toThrow('feedback_scope_key_public_safe_token_required');
    } finally {
      closeStore(store);
    }
  });

  it('enforces default PE memory row caps on writes without using prompt FIFO cleanup', async () => {
    const store = await openStore(':memory:');
    try {
      store.db.run('BEGIN TRANSACTION');
      try {
        for (let index = 0; index < 1000; index += 1) {
          insertMemoryRowDirectly(store, '/repo/a', `signal-${index}`, index);
        }
        store.db.run('COMMIT');
      } catch (error) {
        store.db.run('ROLLBACK');
        throw error;
      }
      recordMemory(store, '/repo/a', 'signal-1000', 1000);
      recordMemory(store, '/repo/b', 'other-project-signal', 2000);

      const statusA = getPromptEnhancementStoreStatus(store, '/repo/a');
      expect(statusA).toMatchObject({
        memoryRows: 1000,
        rowCapState: 'over_row_cap_pruned',
        capState: 'over_row_cap_pruned',
        lastCleanupOutcome: 'row_cap_enforced_without_prompt_fifo',
      });
      expect(statusA.reasonCodes).toContain('row_cap_enforced_without_prompt_fifo');
      expect(getPromptEnhancementMemory(store, '/repo/a', 'signal-0')).toBeNull();
      expect(getPromptEnhancementMemory(store, '/repo/a', 'signal-1000')).not.toBeNull();
      expect(getPromptEnhancementMemory(store, '/repo/b', 'other-project-signal')).not.toBeNull();
      expect(store.db.exec('SELECT COUNT(*) FROM prompts')[0]?.values[0]?.[0]).toBe(0);
    } finally {
      closeStore(store);
    }
  });

  it('enforces default global PE memory row caps on writes without using prompt FIFO cleanup', async () => {
    const store = await openStore(':memory:');
    try {
      store.db.run('BEGIN TRANSACTION');
      try {
        for (let index = 0; index < 1000; index += 1) {
          insertMemoryRowDirectly(store, '/repo/a', `signal-a-${index}`, index);
          insertMemoryRowDirectly(store, '/repo/b', `signal-b-${index}`, index + 1000);
          insertMemoryRowDirectly(store, '/repo/c', `signal-c-${index}`, index + 2000);
        }
        store.db.run('COMMIT');
      } catch (error) {
        store.db.run('ROLLBACK');
        throw error;
      }

      recordMemory(store, '/repo/d', 'signal-d-3000', 3000);

      const status = getPromptEnhancementStoreStatus(store);
      expect(status).toMatchObject({
        globalMemoryRows: 3000,
        rowCapState: 'over_row_cap_pruned',
        capState: 'over_row_cap_pruned',
        lastCleanupOutcome: 'row_cap_enforced_without_prompt_fifo',
      });
      expect(status.reasonCodes).toContain('row_cap_enforced_without_prompt_fifo');
      expect(getPromptEnhancementMemory(store, '/repo/a', 'signal-a-0')).toBeNull();
      expect(getPromptEnhancementMemory(store, '/repo/d', 'signal-d-3000')).not.toBeNull();
      expect(store.db.exec('SELECT COUNT(*) FROM prompts')[0]?.values[0]?.[0]).toBe(0);
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
      expect(getPromptEnhancementStoreStatus(store, '/repo/a')).toMatchObject({
        rowCapState: 'within_bounds',
        byteThresholdState: 'over_byte_threshold_pruned',
        lastCleanupOutcome: 'byte_cap_enforced_without_prompt_fifo',
        memoryRows: 1,
        globalMemoryRows: 1,
      });
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

  it('sanitizes PE status rows so they cannot become a raw-text store', async () => {
    const store = await openStore(':memory:');
    try {
      setPromptEnhancementStatus(store, {
        projectRoot: '/repo/a',
        statusKey: 'last_raw_attempt',
        statusValue: 'raw generated body should not persist',
        now: 100,
      });
      setPromptEnhancementStatus(store, {
        projectRoot: '/repo/a',
        statusKey: 'last_structured_attempt',
        statusValue: JSON.stringify({
          reasonCodes: ['safe_reason', 'raw source excerpt should not persist'],
          fallbackCode: 'fallback_safe',
          rawPrompt: 'delete production database',
          nested: { safeKey: 'safe_value', rawField: 'custom feedback with spaces' },
        }),
        now: 101,
      });

      const rows = store.db.exec(
        'SELECT status_key, status_value FROM prompt_enhancement_status WHERE project_root = ? ORDER BY status_key',
        ['/repo/a'],
      )[0]?.values ?? [];
      const serialized = JSON.stringify(rows);
      expect(serialized).not.toContain('raw generated body');
      expect(serialized).not.toContain('delete production database');
      expect(serialized).not.toContain('raw source excerpt');
      expect(serialized).not.toContain('custom feedback with spaces');
      expect(serialized).toContain('unsafe_or_non_json_status_value_discarded');
      expect(serialized).toContain('safe_reason');
      expect(getPromptEnhancementStoreStatus(store, '/repo/a').reasonCodes).toEqual([]);
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
      expect(markPromptEnhancementMemoryUsed(store, '/repo/a', 'missing_repro_steps', 250, {
        sourceUseId: 'memory-use-1',
        enhancementId: 'enh-1',
        bodyId: 'body-1',
        bodyRevision: 2,
        reasonCodes: ['duplicate_replay_must_not_touch_memory'],
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

  it('reacquires and reloads the disk store before writing PE action after a long popup wait', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nexpath-pe-long-popup-'));
    cleanupDirs.push(dir);
    const dbPath = join(dir, 'prompt-store.db');
    let popupStore: Store | null = await openStore(dbPath);
    try {
      recordPromptEnhancementPreparedBody(popupStore, {
        preparedBodyId: 'prepared-before-popup',
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
        sourceUseIds: ['source-use-prepared'],
        actionIds: ['action-use-current'],
        fallbackState: 'not_fallback',
        privacyStoragePolicy: 'raw_text_excluded_by_default',
        now: 100,
      });

      releaseStoreLock(popupStore);
      const concurrentStore = await openStore(dbPath);
      try {
        recordPromptEnhancementSourceUse(concurrentStore, {
          sourceUseId: 'source-use-concurrent',
          projectRoot: '/repo/a',
          enhancementId: 'enh-1',
          bodyId: 'body-1',
          bodyRevision: 1,
          sourceKind: 'content_template_fact',
          sourceId: 'ct:debug',
          useKind: 'body_section',
          now: 150,
        });
      } finally {
        closeStore(concurrentStore);
      }

      await reacquireStoreLock(popupStore);
      recordPromptEnhancementAction(popupStore, {
        actionEventId: 'action-use-current',
        projectRoot: '/repo/a',
        enhancementId: 'enh-1',
        bodyId: 'body-1',
        bodyRevision: 1,
        actionCategory: 'accept_send',
        feedbackScopeKey: 'body-1',
        learningEligibility: 'not_eligible',
        safetyImpactState: 'none',
        now: 200,
      });
      closeStore(popupStore);
      popupStore = null;

      const reopened = await openStore(dbPath);
      try {
        expect(resolvePromptEnhancementGeneratedOrigin(reopened, {
          projectRoot: '/repo/a',
          bodyId: 'body-1',
          bodyRevision: 1,
        })).toMatchObject({
          generatedOriginId: 'prepared-before-popup',
          actionIds: ['action-use-current'],
          fallbackState: 'not_fallback',
        });
        expect(getPromptEnhancementSourceUseSummary(reopened, '/repo/a', 'body-1')).toMatchObject({
          totalSourceUses: 1,
        });
        expect(getPromptEnhancementFeedbackSummary(reopened, '/repo/a', 'body-1')).toMatchObject({
          totalEvents: 1,
          categoryCounts: [{ feedbackCategory: 'accept_send', count: 1 }],
        });
      } finally {
        closeStore(reopened);
      }
    } finally {
      if (popupStore) closeStore(popupStore);
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

function insertMemoryRowDirectly(store: Store, projectRoot: string, signalKey: string, now: number): void {
  store.db.run(
    `INSERT INTO prompt_enhancement_memory
       (project_root, signal_key, schema_version, evidence_count, positive_count, negative_count,
        current_evidence_state, confidence_band, source_strength, protection_state, fatigue_state,
        suppression_state, last_used_at, last_evidence_at, decay_after, status, reason_codes_json,
        provenance_json, created_at, updated_at)
     VALUES (?, ?, 1, 1, 1, 0, 'historical_candidate', 'low', 'weak', 'none', 'none', 'none',
       NULL, ?, NULL, 'candidate', '[]', ?, ?, ?)`,
    [
      projectRoot,
      signalKey,
      now,
      JSON.stringify({
        sourceIds: [],
        sectionIds: [],
        memoryEvidenceOnly: true,
        rawTextStored: false,
      }),
      now,
      now,
    ],
  );
}
