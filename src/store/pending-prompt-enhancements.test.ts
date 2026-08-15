import { describe, expect, it, beforeEach } from 'vitest';
import { openStore, type Store } from './db.js';
import {
  upsertPendingPromptEnhancement,
  getPendingPromptEnhancement,
  markPromptEnhancementShown,
} from './pending-prompt-enhancements.js';
import { buildPromptEnhancementRequestForAuto } from '../cli/commands/auto.js';
import { preparePromptEnhancement } from '../prompt-enhancement/facade.js';
import { SessionStateManager } from '../classifier/SessionStateManager.js';
import type { PromptEnhancementPrepareRequestV1, PromptEnhancementPrepareResultV1 } from '../prompt-enhancement/contracts.js';

async function validPayload(store: Store, projectRoot: string): Promise<{
  request: PromptEnhancementPrepareRequestV1;
  result: PromptEnhancementPrepareResultV1;
}> {
  const session = SessionStateManager.load(store, projectRoot);
  const request = buildPromptEnhancementRequestForAuto({
    auto: { promptText: 'implement the auth token refresh path', projectRoot, currentAgentMode: 'workspace-write' },
    store,
    session,
    project: null,
    effectiveLanguage: 'en',
    configuredRole: null,
    effectiveFlagType: 'stage_transition',
    firedKey: 'stage_transition:idea→implementation',
    previousStage: 'idea',
    trigger: { kind: 'stage_transition' },
    stageResult: {
      classification: { stage: 'implementation', confidence: 0.9, tier: 3, allScores: {} },
      signalsPresent: [],
      signalsAbsent: [],
      fireRecommendation: true,
      selectedSignalKey: '',
      reason: 'test',
      degraded: false,
    },
    streamBOutputs: [],
  });
  const result = await preparePromptEnhancement(request);
  return { request, result };
}

describe('pending_prompt_enhancements store', () => {
  let store: Store;
  beforeEach(async () => { store = await openStore(':memory:'); });

  it('creates the pending_prompt_enhancements table', () => {
    const rows = store.db.exec(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pending_prompt_enhancements'",
    );
    expect(rows[0]?.values.length).toBe(1);
  });

  it('round-trips the typed request and result through upsert → get', async () => {
    const { request, result } = await validPayload(store, '/test/pe-stop-roundtrip');
    upsertPendingPromptEnhancement(store, {
      projectRoot: '/test/pe-stop-roundtrip',
      sessionId: 'sess-1',
      promptCount: 3,
      request,
      result,
    });

    const loaded = getPendingPromptEnhancement(store, '/test/pe-stop-roundtrip');
    expect(loaded).not.toBeNull();
    expect(loaded!.sessionId).toBe('sess-1');
    expect(loaded!.promptCount).toBe(3);
    expect(loaded!.status).toBe('pending');
    expect(loaded!.request).toEqual(request);
    expect(loaded!.result).toEqual(result);
  });

  it('keeps only one pending PE per project (upsert replaces)', async () => {
    const { request, result } = await validPayload(store, '/test/pe-stop-single');
    upsertPendingPromptEnhancement(store, { projectRoot: '/test/pe-stop-single', sessionId: 's1', promptCount: 1, request, result });
    upsertPendingPromptEnhancement(store, { projectRoot: '/test/pe-stop-single', sessionId: 's2', promptCount: 2, request, result });
    const rows = store.db.exec("SELECT COUNT(*) FROM pending_prompt_enhancements WHERE project_root = '/test/pe-stop-single'");
    expect(rows[0]!.values[0]![0]).toBe(1);
    expect(getPendingPromptEnhancement(store, '/test/pe-stop-single')!.sessionId).toBe('s2');
  });

  it('filters by sessionId when provided', async () => {
    const { request, result } = await validPayload(store, '/test/pe-stop-session');
    upsertPendingPromptEnhancement(store, { projectRoot: '/test/pe-stop-session', sessionId: 'only-this', promptCount: 1, request, result });
    expect(getPendingPromptEnhancement(store, '/test/pe-stop-session', 'only-this')).not.toBeNull();
    expect(getPendingPromptEnhancement(store, '/test/pe-stop-session', 'other')).toBeNull();
  });

  it('fails closed (returns null) when stored JSON is corrupt', async () => {
    const { request, result } = await validPayload(store, '/test/pe-stop-corrupt');
    upsertPendingPromptEnhancement(store, { projectRoot: '/test/pe-stop-corrupt', sessionId: 's', promptCount: 1, request, result });
    store.db.run("UPDATE pending_prompt_enhancements SET result_json = '{not valid' WHERE project_root = '/test/pe-stop-corrupt'");
    expect(getPendingPromptEnhancement(store, '/test/pe-stop-corrupt')).toBeNull();
  });

  it('marks a pending PE as shown so it is no longer returned', async () => {
    const { request, result } = await validPayload(store, '/test/pe-stop-shown');
    upsertPendingPromptEnhancement(store, { projectRoot: '/test/pe-stop-shown', sessionId: 's', promptCount: 1, request, result });
    const pending = getPendingPromptEnhancement(store, '/test/pe-stop-shown')!;
    markPromptEnhancementShown(store, pending.id);
    expect(getPendingPromptEnhancement(store, '/test/pe-stop-shown')).toBeNull();
  });
});
