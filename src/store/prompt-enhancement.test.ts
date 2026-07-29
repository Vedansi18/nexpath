import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  closeStore,
  deleteAllPromptEnhancementMemory,
  deletePromptEnhancementProjectRows,
  deletePromptEnhancementStatusForProject,
  getPromptEnhancementMemory,
  getPromptEnhancementSchemaVersionState,
  getPromptEnhancementStoreStatus,
  markPromptEnhancementMemoryUsed,
  openStore,
  prunePromptEnhancementMemory,
  queryRelevantPromptEnhancementMemory,
  recordPromptEnhancementFeedbackEvent,
  recordPromptEnhancementGeneratedOrigin,
  recordPromptEnhancementMemoryEvidence,
  recordPromptEnhancementMemoryFeedback,
  recordPromptEnhancementSourceUse,
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
        sourceUseIds: ['source-use-1'],
        reasonCodes: ['origin_guard_required'],
        now: 101,
      });

      const status = getPromptEnhancementStoreStatus(store, '/repo/a');
      expect(status).toMatchObject({
        memoryRows: 0,
        sourceUseRows: 1,
        generatedOriginRows: 1,
        feedbackRows: 0,
        rawContentStoredByDefault: false,
        oldStoreSurfacesAreAuthority: false,
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
      expect(deleteAllPromptEnhancementMemory(store)).toBe(2);
      expect(getPromptEnhancementStoreStatus(store).memoryRows).toBe(0);
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
