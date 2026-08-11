import { describe, expect, it, beforeEach } from 'vitest';
import { openStore, type Store } from './db.js';
import {
  upsertPendingPromptSequence,
  getActivePendingPromptSequence,
  updatePendingPromptSequenceState,
  deletePendingPromptSequencesForProject,
} from './pending-sequences.js';
import { deletePromptEnhancementProjectRows } from './prompt-enhancement.js';
import {
  applyPromptEnhancementSequenceRuntimeActionV1,
  createPromptEnhancementSequenceRuntimeStateV1,
  type PromptEnhancementSequenceRuntimeStateV1,
} from '../prompt-enhancement/sequence-runtime.js';
import {
  emptyPromptEnhancementSequencePayloadV1,
  type PromptEnhancementSequencePayloadV1,
} from '../prompt-enhancement/sequence-payload.js';

const PROJECT = '/tmp/pending-seq-proj';
const ORIGINAL_LENGTH = 120;

function plannedItems(count: number): PromptEnhancementSequencePayloadV1['items'] {
  const base = {
    sourcePointRanges: [], roleLabel: null, complexity: 'not_complex',
    complexityReason: null, actionRiskKind: null, authorityMode: 'plan_or_review',
    requiresConfirmationFloor: false, decompositionGroupId: 'g1',
  } as const;
  return Array.from({ length: count }, (_, index) => (index === 0
    ? { ...base, itemKind: 'first_task', originalSliceRef: { start: 0, end: ORIGINAL_LENGTH }, dependencyOrder: 0, generatedWording: null, itemValidationGraph: null }
    : { ...base, itemKind: 'task', originalSliceRef: { start: 1, end: 20 }, dependencyOrder: index, generatedWording: 'w', itemValidationGraph: {} }
  )) as unknown as PromptEnhancementSequencePayloadV1['items'];
}

function payload(
  overrides: Partial<PromptEnhancementSequencePayloadV1> = {},
): PromptEnhancementSequencePayloadV1 {
  return { ...emptyPromptEnhancementSequencePayloadV1(ORIGINAL_LENGTH), ...overrides };
}
const OTHER_PROJECT = '/tmp/pending-seq-other';

function createdState(
  overrides: Partial<PromptEnhancementSequenceRuntimeStateV1> = {},
): PromptEnhancementSequenceRuntimeStateV1 {
  const created = createPromptEnhancementSequenceRuntimeStateV1({
    sequenceId: 'seq-1', enhancementId: 'enh-1', projectRoot: PROJECT, sessionId: 'sess-1', itemCount: 3,
  });
  if (!created.ok) throw new Error('fixture state invalid');
  return { ...created.state, ...overrides };
}

describe('pending-sequences store', () => {
  let store: Store;

  beforeEach(async () => {
    store = await openStore(':memory:');
  });

  it('upserts one row per project and reads it back typed', () => {
    expect(upsertPendingPromptSequence(store, createdState(), payload())).toBe(true);
    // Second upsert replaces — never accumulates.
    expect(upsertPendingPromptSequence(store, createdState({ sequenceId: 'seq-2' }), payload())).toBe(true);
    const row = getActivePendingPromptSequence(store, PROJECT, 'sess-1');
    expect(row).toMatchObject({
      projectRoot: PROJECT,
      sessionId: 'sess-1',
      sequenceId: 'seq-2',
      enhancementId: 'enh-1',
      itemCount: 3,
      currentItemIndex: 0,
      status: 'awaiting_response',
      lastActionId: null,
    });
    const all = store.db.exec('SELECT COUNT(*) FROM pending_prompt_sequences');
    expect(all[0].values[0][0]).toBe(1);
  });

  it('refuses to write an invalid state (fail-closed, nothing stored)', () => {
    expect(upsertPendingPromptSequence(store, createdState({ itemCount: 1 }), payload())).toBe(false);
    expect(getActivePendingPromptSequence(store, PROJECT)).toBeNull();
  });

  it('scrubs a row from another session and returns null (no cross-session resurrection)', () => {
    upsertPendingPromptSequence(store, createdState(), payload());
    expect(getActivePendingPromptSequence(store, PROJECT, 'sess-OTHER')).toBeNull();
    // The stale row was deleted, not just hidden.
    const all = store.db.exec('SELECT COUNT(*) FROM pending_prompt_sequences');
    expect(all[0].values[0][0]).toBe(0);
  });

  it('scrubs a corrupt row fail-closed', () => {
    upsertPendingPromptSequence(store, createdState(), payload());
    store.db.run("UPDATE pending_prompt_sequences SET status = 'weird'");
    // Corrupt status is not in the active filter → absent without scrub…
    expect(getActivePendingPromptSequence(store, PROJECT, 'sess-1')).toBeNull();
    store.db.run("UPDATE pending_prompt_sequences SET status = 'item_pending', item_count = 0");
    // …while an in-filter row with corrupt counts is scrubbed on read.
    expect(getActivePendingPromptSequence(store, PROJECT, 'sess-1')).toBeNull();
    const all = store.db.exec("SELECT COUNT(*) FROM pending_prompt_sequences WHERE item_count = 0");
    expect(all[0].values[0][0]).toBe(0);
  });

  it('persists machine transitions and hides terminal rows from the active read', () => {
    upsertPendingPromptSequence(store, createdState(), payload());
    const row = getActivePendingPromptSequence(store, PROJECT, 'sess-1');
    expect(row).not.toBeNull();

    // Stop decision moment → offer item 1 (explicit typed action, persisted).
    const offered = applyPromptEnhancementSequenceRuntimeActionV1(createdState(), { type: 'advance_to_next_item', actionId: 'a1' });
    expect(offered.ok).toBe(true);
    if (!offered.ok) return;
    expect(updatePendingPromptSequenceState(store, row!.id, offered.state)).toBe(true);
    expect(getActivePendingPromptSequence(store, PROJECT, 'sess-1')).toMatchObject({
      currentItemIndex: 1,
      status: 'item_pending',
      lastActionId: 'a1',
    });

    // Cancel → terminal → no longer active.
    const cancelled = applyPromptEnhancementSequenceRuntimeActionV1(offered.state, { type: 'cancel_sequence', actionId: 'a2' });
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    expect(updatePendingPromptSequenceState(store, row!.id, cancelled.state)).toBe(true);
    expect(getActivePendingPromptSequence(store, PROJECT, 'sess-1')).toBeNull();
  });

  it('reports false when updating a row that no longer exists (no silent no-op)', () => {
    expect(updatePendingPromptSequenceState(store, 9999, createdState())).toBe(false);
  });

  it('isolates projects: another project cannot see or delete this sequence', () => {
    upsertPendingPromptSequence(store, createdState(), payload());
    expect(getActivePendingPromptSequence(store, OTHER_PROJECT)).toBeNull();
    expect(deletePendingPromptSequencesForProject(store, OTHER_PROJECT)).toBe(0);
    expect(getActivePendingPromptSequence(store, PROJECT, 'sess-1')).not.toBeNull();
    expect(deletePendingPromptSequencesForProject(store, PROJECT)).toBe(1);
    expect(getActivePendingPromptSequence(store, PROJECT, 'sess-1')).toBeNull();
  });

  it('is cleared by the existing store-delete cleanup (project scope)', () => {
    upsertPendingPromptSequence(store, createdState(), payload());
    const deleted = deletePromptEnhancementProjectRows(store, PROJECT);
    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(getActivePendingPromptSequence(store, PROJECT, 'sess-1')).toBeNull();
  });
  it('round-trips the payload columns and keeps them across a state transition', () => {
    const planned = payload({
      suggestedNextPromptPolicy: 'rendered_after_explicit_acceptance',
      promptDirectives: [{ start: 0, end: 12 }],
      offerDisposition: 'accepted',
    });
    expect(upsertPendingPromptSequence(store, createdState(), planned)).toBe(true);
    expect(getActivePendingPromptSequence(store, PROJECT, 'sess-1')?.payload).toEqual(planned);

    // The transition writer touches status/index/action only, so the payload survives it —
    // this is the loss path the destructive upsert closes, checked from the other side.
    const row = getActivePendingPromptSequence(store, PROJECT, 'sess-1');
    const offered = applyPromptEnhancementSequenceRuntimeActionV1(createdState(), { type: 'advance_to_next_item', actionId: 'a1' });
    expect(offered.ok).toBe(true);
    if (!offered.ok) return;
    expect(updatePendingPromptSequenceState(store, row!.id, offered.state)).toBe(true);
    expect(getActivePendingPromptSequence(store, PROJECT, 'sess-1')?.payload).toEqual(planned);
  });

  it('refuses to write an invalid payload (fail-closed, nothing stored)', () => {
    expect(upsertPendingPromptSequence(store, createdState(), payload({ originalLength: -5 }))).toBe(false);
    expect(getActivePendingPromptSequence(store, PROJECT)).toBeNull();
  });

  it('scrubs a row whose payload JSON is malformed rather than reading it as empty', () => {
    // Reading a corrupt column as an empty list would serve a sequence whose items were
    // silently lost — the row is corrupt and scrubs like any other.
    upsertPendingPromptSequence(store, createdState(), payload());
    store.db.run("UPDATE pending_prompt_sequences SET items_json = '{not json'");
    expect(getActivePendingPromptSequence(store, PROJECT, 'sess-1')).toBeNull();
    const all = store.db.exec('SELECT COUNT(*) FROM pending_prompt_sequences');
    expect(all[0].values[0][0]).toBe(0);
  });

  it('scrubs a row whose stored payload violates a structural rule', () => {
    upsertPendingPromptSequence(store, createdState(), payload());
    store.db.run("UPDATE pending_prompt_sequences SET suggested_next_prompt_policy = 'invented'");
    expect(getActivePendingPromptSequence(store, PROJECT, 'sess-1')).toBeNull();
  });
  it('refuses a payload whose list length disagrees with the row item count', () => {
    // The list and the count are one quantity stored twice; only the pair catches a mismatch,
    // which is why the payload is validated against the state rather than alone.
    const threeItems = payload({ items: plannedItems(3), suggestedNextPromptPolicy: 'rendered_after_explicit_acceptance' });
    expect(upsertPendingPromptSequence(store, createdState({ itemCount: 4 }), threeItems)).toBe(false);
    expect(getActivePendingPromptSequence(store, PROJECT)).toBeNull();
    expect(upsertPendingPromptSequence(store, createdState({ itemCount: 3 }), threeItems)).toBe(true);
  });

  it('scrubs a stored row whose item count is edited away from its list', () => {
    const threeItems = payload({ items: plannedItems(3), suggestedNextPromptPolicy: 'rendered_after_explicit_acceptance' });
    expect(upsertPendingPromptSequence(store, createdState({ itemCount: 3 }), threeItems)).toBe(true);
    store.db.run('UPDATE pending_prompt_sequences SET item_count = 7');
    expect(getActivePendingPromptSequence(store, PROJECT, 'sess-1')).toBeNull();
  });

  it('keeps a terminal stub readable — it is exempt from the item bounds', () => {
    // A non-accepted row records an offer that never activated; the bounds would scrub it as it
    // was written.
    const stub = payload({ offerDisposition: 'not_engaged', originalLength: 0 });
    expect(upsertPendingPromptSequence(store, createdState(), stub)).toBe(true);
    expect(getActivePendingPromptSequence(store, PROJECT, 'sess-1')?.payload.offerDisposition)
      .toBe('not_engaged');
  });
});
