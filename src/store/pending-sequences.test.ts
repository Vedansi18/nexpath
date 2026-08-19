import { describe, expect, it, beforeEach } from 'vitest';
import { openStore, type Store } from './db.js';
import {
  upsertPendingPromptSequence,
  getActivePendingPromptSequence,
  updatePendingPromptSequenceState,
  deletePendingPromptSequencesForProject,
  recordPromptEnhancementSequenceOfferDeclined,
  getPromptEnhancementSequenceOfferDisposition,
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
    complexityReason: null, actionRiskKinds: [], authorityMode: 'plan_or_review',
    requiresConfirmationFloor: false, decompositionGroupId: 'g1',
  } as const;
  return Array.from({ length: count }, (_, index) => (index === 0
    ? { ...base, itemKind: 'first_task', originalSliceRef: { start: 0, end: ORIGINAL_LENGTH }, dependencyOrder: 0, generatedWording: null, itemValidationGraph: null, itemSafetyClauseRef: null }
    : { ...base, itemKind: 'task', originalSliceRef: { start: 1, end: 20 }, dependencyOrder: index, generatedWording: 'w', itemValidationGraph: {}, itemSafetyClauseRef: null }
  )) as unknown as PromptEnhancementSequencePayloadV1['items'];
}

function withItemField(
  items: PromptEnhancementSequencePayloadV1['items'],
  index: number,
  field: string,
  value: unknown,
): PromptEnhancementSequencePayloadV1['items'] {
  return items.map((item, i) => (i === index ? { ...item, [field]: value } : item)) as
    PromptEnhancementSequencePayloadV1['items'];
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

  it('exempts a non-accepted payload from the item bounds — but only on a TERMINAL row', () => {
    // A row recording an offer that never activated carries no items; without the exemption the
    // bounds would refuse it. The exemption is paired with the status, or the row would be exempt
    // from the bounds AND still reachable by the active read: a live sequence with nothing to serve.
    const stub = payload({ offerDisposition: 'not_engaged', originalLength: 0 });
    expect(upsertPendingPromptSequence(store, createdState({ status: 'cancelled' }), stub)).toBe(true);
  });

  it('refuses a declined disposition on a row that is still active', () => {
    // Every individual check passes this: the count is valid, the bounds are exempted, and the
    // status is in the active filter. Only the pairing catches it — and since the writer now spares
    // non-accepted rows from replacement, such a row would never be cleaned up.
    const stub = payload({ offerDisposition: 'rejected', originalLength: 0 });
    expect(upsertPendingPromptSequence(store, createdState({ status: 'item_pending' }), stub)).toBe(false);
    expect(upsertPendingPromptSequence(store, createdState({ status: 'awaiting_response' }), stub)).toBe(false);
    expect(getActivePendingPromptSequence(store, PROJECT, 'sess-1')).toBeNull();
  });

  it('scrubs a stored row that was made active while declaring a declined offer', () => {
    // The read only ever sees active rows, so a non-accepted one there is corrupt by construction.
    expect(upsertPendingPromptSequence(store, createdState(), payload())).toBe(true);
    store.db.run("UPDATE pending_prompt_sequences SET offer_disposition = 'rejected'");
    expect(getActivePendingPromptSequence(store, PROJECT, 'sess-1')).toBeNull();
  });

  it('still accepts a COMPLETED sequence, which is terminal and accepted', () => {
    // The rule is one-directional: a declined offer must be terminal, but a terminal row is not
    // required to be declined — a finished sequence is exactly that.
    expect(upsertPendingPromptSequence(store, createdState({ status: 'completed' }), payload())).toBe(true);
  });

  it('never selects a terminal row, so its scrub-on-read cannot reach one', () => {
    // The active filter is what keeps a terminal record out of the read path entirely — it is not
    // hidden by validation, it is never selected, so it is also never scrubbed.
    expect(upsertPendingPromptSequence(store, createdState(), payload())).toBe(true);
    store.db.run("UPDATE pending_prompt_sequences SET status = 'cancelled', offer_disposition = 'not_engaged'");
    expect(getActivePendingPromptSequence(store, PROJECT, 'sess-1')).toBeNull();
    const all = store.db.exec('SELECT COUNT(*) FROM pending_prompt_sequences');
    expect(all[0].values[0][0]).toBe(1);
  });

  it('refuses a second write that changes stored wording or a stored verdict', () => {
    // null -> value is the one legal transition; an item that comes back must come back
    // identical, and a verdict must not change on unchanged text.
    const first = payload({ items: plannedItems(3), suggestedNextPromptPolicy: 'rendered_after_explicit_acceptance' });
    expect(upsertPendingPromptSequence(store, createdState({ itemCount: 3 }), first)).toBe(true);

    const rewritten = payload({
      items: withItemField(plannedItems(3), 1, 'generatedWording', 'something else'),
      suggestedNextPromptPolicy: 'rendered_after_explicit_acceptance',
    });
    expect(upsertPendingPromptSequence(store, createdState({ itemCount: 3 }), rewritten)).toBe(false);

    const reverdicted = payload({
      items: withItemField(plannedItems(3), 2, 'itemValidationGraph', { changed: true }),
      suggestedNextPromptPolicy: 'rendered_after_explicit_acceptance',
    });
    expect(upsertPendingPromptSequence(store, createdState({ itemCount: 3 }), reverdicted)).toBe(false);

    // The stored row is untouched by either refusal.
    expect(getActivePendingPromptSequence(store, PROJECT, 'sess-1')?.payload.items).toEqual(first.items);
  });

  it('allows an identical rewrite — freezing a value is not freezing the row', () => {
    const planned = payload({ items: plannedItems(3), suggestedNextPromptPolicy: 'rendered_after_explicit_acceptance' });
    expect(upsertPendingPromptSequence(store, createdState({ itemCount: 3 }), planned)).toBe(true);
    // Rebuilt from scratch rather than reused, so a key-order difference would show up here — it
    // must not read as a change, or a legal repeat write would be refused.
    expect(upsertPendingPromptSequence(store, createdState({ itemCount: 3 }), payload({
      items: plannedItems(3), suggestedNextPromptPolicy: 'rendered_after_explicit_acceptance',
    }))).toBe(true);
    expect(getActivePendingPromptSequence(store, PROJECT, 'sess-1')?.payload.items).toEqual(planned.items);
  });

  it('reports the first frozen field it finds, whichever item carries it', () => {
    // null -> value is the legal transition, but on a valid stored row it is unreachable: every
    // item except the first is already required to carry both a wording and a verdict. So on a
    // servable row the rule reduces to identical-or-refused, which is what is exercised here.
    const first = payload({ items: plannedItems(3), suggestedNextPromptPolicy: 'rendered_after_explicit_acceptance' });
    expect(upsertPendingPromptSequence(store, createdState({ itemCount: 3 }), first)).toBe(true);
    // The change is on the LAST item, so the scan cannot pass by stopping at the first one.
    expect(upsertPendingPromptSequence(store, createdState({ itemCount: 3 }), payload({
      items: withItemField(plannedItems(3), 2, 'generatedWording', 'late change'),
      suggestedNextPromptPolicy: 'rendered_after_explicit_acceptance',
    }))).toBe(false);
  });

  it('still reads back a row written before the payload columns existed', () => {
    // The migration's whole point is that an in-flight sequence is not silently ended. Proving the
    // columns arrive is not enough — a back-filled row must survive the read, and the defaults it
    // gets are exactly the pre-planner shape the validator has to accept.
    expect(upsertPendingPromptSequence(store, createdState(), payload())).toBe(true);
    store.db.run(
      `UPDATE pending_prompt_sequences
       SET items_json = '[]', prompt_directives_json = '[]',
           suggested_next_prompt_policy = 'not_generated', original_length = 0,
           offer_disposition = 'accepted'`,
    );
    expect(getActivePendingPromptSequence(store, PROJECT, 'sess-1')).toMatchObject({
      itemCount: 3,
      payload: { items: [], originalLength: 0, suggestedNextPromptPolicy: 'not_generated' },
    });
  });

  it('does not freeze a LATER sequence against an earlier one in the same project', () => {
    // A terminal row is never removed by the read path, so the previous sequence is still stored
    // when the next one is written. Comparing across the two would freeze one sequence's plan onto
    // a different sequence — and a single declined offer would refuse every later sequence here.
    const declined = payload({ offerDisposition: 'not_engaged', originalLength: 0 });
    expect(upsertPendingPromptSequence(store, createdState({ sequenceId: 'seq-1', status: 'cancelled' }), declined)).toBe(true);
    expect(upsertPendingPromptSequence(store, createdState({ sequenceId: 'seq-2' }), payload())).toBe(true);
    expect(getActivePendingPromptSequence(store, PROJECT, 'sess-1')).toMatchObject({
      sequenceId: 'seq-2',
      payload: { offerDisposition: 'accepted' },
    });
  });

  it('does not freeze a later sequence against an earlier one that carried different wording', () => {
    const planned = payload({ items: plannedItems(3), suggestedNextPromptPolicy: 'rendered_after_explicit_acceptance' });
    expect(upsertPendingPromptSequence(store, createdState({ sequenceId: 'seq-1', itemCount: 3 }), planned)).toBe(true);
    const different = payload({
      items: withItemField(plannedItems(3), 1, 'generatedWording', 'a different plan entirely'),
      suggestedNextPromptPolicy: 'rendered_after_explicit_acceptance',
    });
    // Different sequence id — this is a new plan, not a rewrite of the old one.
    expect(upsertPendingPromptSequence(store, createdState({ sequenceId: 'seq-2', itemCount: 3 }), different)).toBe(true);
    expect(getActivePendingPromptSequence(store, PROJECT, 'sess-1')?.payload.items).toEqual(different.items);
  });

  it('refuses a second write that changes what the user did with the offer', () => {
    // A mid-sequence cancel changes the sequence's status, not the record of the offer.
    expect(upsertPendingPromptSequence(store, createdState(), payload())).toBe(true);
    expect(upsertPendingPromptSequence(store, createdState(), payload({ offerDisposition: 'rejected' })))
      .toBe(false);
    expect(getActivePendingPromptSequence(store, PROJECT, 'sess-1')?.payload.offerDisposition)
      .toBe('accepted');
  });
  it('writes a declined offer as a terminal stub with nothing but the id and the decision', () => {
    expect(recordPromptEnhancementSequenceOfferDeclined(store, {
      projectRoot: PROJECT, sessionId: 'sess-1', sequenceId: 'seq-1', enhancementId: 'enh-1',
      disposition: 'not_engaged',
    })).toBe(true);
    const row = store.db.exec(
      `SELECT item_count, current_item_index, status, last_action_id, items_json,
              prompt_directives_json, suggested_next_prompt_policy, original_length, offer_disposition
       FROM pending_prompt_sequences`,
    )[0].values[0];
    expect(row).toEqual([0, 0, 'cancelled', null, '[]', '[]', 'not_generated', 0, 'not_engaged']);
  });

  it('uses cancelled, never abandoned — a closed popup is not inferred abandonment', () => {
    recordPromptEnhancementSequenceOfferDeclined(store, {
      projectRoot: PROJECT, sessionId: 'sess-1', sequenceId: 'seq-1', enhancementId: 'enh-1',
      disposition: 'rejected',
    });
    const status = store.db.exec('SELECT status FROM pending_prompt_sequences')[0].values[0][0];
    expect(status).toBe('cancelled');
    expect(status).not.toBe('abandoned');
  });

  it('refuses anything outside the two declined values, and blank identifiers', () => {
    // `accepted` is not a stub: that case is a real sequence written by intake with its items.
    expect(recordPromptEnhancementSequenceOfferDeclined(store, {
      projectRoot: PROJECT, sessionId: 'sess-1', sequenceId: 'seq-1', enhancementId: 'enh-1',
      disposition: 'accepted' as never,
    })).toBe(false);
    expect(recordPromptEnhancementSequenceOfferDeclined(store, {
      projectRoot: PROJECT, sessionId: '  ', sequenceId: 'seq-1', enhancementId: 'enh-1',
      disposition: 'rejected',
    })).toBe(false);
    expect(store.db.exec('SELECT COUNT(*) FROM pending_prompt_sequences')[0].values[0][0]).toBe(0);
  });

  it('keeps the stub off the active path, so the scrub can never reach it', () => {
    // The bounds a servable row must satisfy would refuse an empty stub, and the read would delete
    // it as corrupt. Terminal status is what keeps it out of that read entirely.
    recordPromptEnhancementSequenceOfferDeclined(store, {
      projectRoot: PROJECT, sessionId: 'sess-1', sequenceId: 'seq-1', enhancementId: 'enh-1',
      disposition: 'rejected',
    });
    expect(getActivePendingPromptSequence(store, PROJECT, 'sess-1')).toBeNull();
    expect(store.db.exec('SELECT COUNT(*) FROM pending_prompt_sequences')[0].values[0][0]).toBe(1);
  });

  it('is written once — a disagreeing second write is refused, an identical one is a no-op', () => {
    const args = {
      projectRoot: PROJECT, sessionId: 'sess-1', sequenceId: 'seq-1', enhancementId: 'enh-1',
    } as const;
    expect(recordPromptEnhancementSequenceOfferDeclined(store, { ...args, disposition: 'rejected' })).toBe(true);
    expect(recordPromptEnhancementSequenceOfferDeclined(store, { ...args, disposition: 'not_engaged' })).toBe(false);
    expect(recordPromptEnhancementSequenceOfferDeclined(store, { ...args, disposition: 'rejected' })).toBe(true);
    expect(store.db.exec('SELECT COUNT(*) FROM pending_prompt_sequences')[0].values[0][0]).toBe(1);
    expect(getPromptEnhancementSequenceOfferDisposition(store, PROJECT, 'seq-1')).toBe('rejected');
  });

  it('does not end a running sequence when a different offer is declined', () => {
    // The ordinary writer replaces every row for the project. A stub must not, or declining one
    // offer would silently end an unrelated sequence that is still in flight.
    expect(upsertPendingPromptSequence(store, createdState({ sequenceId: 'live' }), payload())).toBe(true);
    expect(recordPromptEnhancementSequenceOfferDeclined(store, {
      projectRoot: PROJECT, sessionId: 'sess-1', sequenceId: 'declined-one', enhancementId: 'enh-2',
      disposition: 'not_engaged',
    })).toBe(true);
    expect(getActivePendingPromptSequence(store, PROJECT, 'sess-1')).toMatchObject({ sequenceId: 'live' });
    expect(getPromptEnhancementSequenceOfferDisposition(store, PROJECT, 'declined-one')).toBe('not_engaged');
  });

  it('survives the next offer — the record is not erased by the sequence after it', () => {
    // Every write used to delete all rows for the project, so a disposition lived only until the
    // next offer. The record cannot be reconstructed later, so losing it loses it for good.
    expect(recordPromptEnhancementSequenceOfferDeclined(store, {
      projectRoot: PROJECT, sessionId: 'sess-1', sequenceId: 'declined', enhancementId: 'enh-1',
      disposition: 'rejected',
    })).toBe(true);
    expect(upsertPendingPromptSequence(store, createdState({ sequenceId: 'next-one' }), payload())).toBe(true);
    expect(getPromptEnhancementSequenceOfferDisposition(store, PROJECT, 'declined')).toBe('rejected');
    expect(getActivePendingPromptSequence(store, PROJECT, 'sess-1')).toMatchObject({ sequenceId: 'next-one' });
  });

  it('still replaces the previous ACCEPTED row — one active sequence per project is unchanged', () => {
    expect(upsertPendingPromptSequence(store, createdState({ sequenceId: 'first' }), payload())).toBe(true);
    expect(upsertPendingPromptSequence(store, createdState({ sequenceId: 'second' }), payload())).toBe(true);
    const rows = store.db.exec("SELECT COUNT(*) FROM pending_prompt_sequences WHERE offer_disposition = 'accepted'");
    expect(rows[0].values[0][0]).toBe(1);
    expect(getActivePendingPromptSequence(store, PROJECT, 'sess-1')).toMatchObject({ sequenceId: 'second' });
  });

  it('keeps several declined offers side by side with one live sequence', () => {
    for (const id of ['a', 'b', 'c']) {
      expect(recordPromptEnhancementSequenceOfferDeclined(store, {
        projectRoot: PROJECT, sessionId: 'sess-1', sequenceId: id, enhancementId: 'enh-' + id,
        disposition: id === 'b' ? 'rejected' : 'not_engaged',
      })).toBe(true);
    }
    expect(upsertPendingPromptSequence(store, createdState({ sequenceId: 'live' }), payload())).toBe(true);
    expect(getPromptEnhancementSequenceOfferDisposition(store, PROJECT, 'a')).toBe('not_engaged');
    expect(getPromptEnhancementSequenceOfferDisposition(store, PROJECT, 'b')).toBe('rejected');
    expect(getPromptEnhancementSequenceOfferDisposition(store, PROJECT, 'c')).toBe('not_engaged');
    expect(getActivePendingPromptSequence(store, PROJECT, 'sess-1')).toMatchObject({ sequenceId: 'live' });
  });

  it('refuses to transition a record of an offer that was never taken', () => {
    // The writer takes a raw id and only touches status, so without the guard one wrong id turns
    // the record into a live sequence — which the read then refuses to serve AND scrubs, losing the
    // one thing that cannot be reconstructed afterwards.
    expect(recordPromptEnhancementSequenceOfferDeclined(store, {
      projectRoot: PROJECT, sessionId: 'sess-1', sequenceId: 'seq-1', enhancementId: 'enh-1',
      disposition: 'rejected',
    })).toBe(true);
    const id = store.db.exec('SELECT id FROM pending_prompt_sequences')[0].values[0][0] as number;
    expect(updatePendingPromptSequenceState(store, id, createdState({ status: 'item_pending' }))).toBe(false);

    // The record is intact and still terminal.
    expect(getPromptEnhancementSequenceOfferDisposition(store, PROJECT, 'seq-1')).toBe('rejected');
    expect(store.db.exec('SELECT status FROM pending_prompt_sequences')[0].values[0][0]).toBe('cancelled');
    // And nothing became visible to the active read on the way.
    expect(getActivePendingPromptSequence(store, PROJECT, 'sess-1')).toBeNull();
  });

  it('still transitions an ordinary accepted sequence', () => {
    // The guard must not narrow the real path it sits on.
    expect(upsertPendingPromptSequence(store, createdState(), payload())).toBe(true);
    const row = getActivePendingPromptSequence(store, PROJECT, 'sess-1');
    const offered = applyPromptEnhancementSequenceRuntimeActionV1(createdState(), { type: 'advance_to_next_item', actionId: 'a1' });
    expect(offered.ok).toBe(true);
    if (!offered.ok) return;
    expect(updatePendingPromptSequenceState(store, row!.id, offered.state)).toBe(true);
    expect(getActivePendingPromptSequence(store, PROJECT, 'sess-1')).toMatchObject({
      currentItemIndex: 1, status: 'item_pending', lastActionId: 'a1',
    });
  });

  it('refuses to record a decline against a sequence that was already sent', () => {
    // Write-once runs in both directions on the same id. A sequence with a real row was accepted,
    // and a later popup-close handler must not rewrite that into a decline.
    expect(upsertPendingPromptSequence(store, createdState({ sequenceId: 'seq-1' }), payload())).toBe(true);
    expect(recordPromptEnhancementSequenceOfferDeclined(store, {
      projectRoot: PROJECT, sessionId: 'sess-1', sequenceId: 'seq-1', enhancementId: 'enh-1',
      disposition: 'rejected',
    })).toBe(false);
    expect(getPromptEnhancementSequenceOfferDisposition(store, PROJECT, 'seq-1')).toBe('accepted');
    expect(getActivePendingPromptSequence(store, PROJECT, 'sess-1')).toMatchObject({ sequenceId: 'seq-1' });
  });

  it('refuses to accept a sequence whose offer was already recorded as declined', () => {
    // The other direction of the same rule, on the writer that carries the payload.
    expect(recordPromptEnhancementSequenceOfferDeclined(store, {
      projectRoot: PROJECT, sessionId: 'sess-1', sequenceId: 'seq-1', enhancementId: 'enh-1',
      disposition: 'not_engaged',
    })).toBe(true);
    expect(upsertPendingPromptSequence(store, createdState({ sequenceId: 'seq-1' }), payload())).toBe(false);
    expect(getPromptEnhancementSequenceOfferDisposition(store, PROJECT, 'seq-1')).toBe('not_engaged');
  });

  it('reads null for an offer that has no row at all', () => {
    // The absence is the record: no modelled popup outcome was reached. It is not abandonment.
    expect(getPromptEnhancementSequenceOfferDisposition(store, PROJECT, 'never-written')).toBeNull();
  });

  // MPS continuation content foundation (sub-11, 2026-08-14): two additive nullable side columns
  // — the redacted original + the handoffKind — round-trip through the active read, and an old row
  // (columns NULL) reads back as null. Local store only; nothing else about the row changes.
  describe('continuation side fields — redacted original + handoffKind', () => {
    it('round-trips both side values through the active read', () => {
      expect(upsertPendingPromptSequence(store, createdState(), payload(), {
        redactedOriginalPromptText: 'the original prompt text, redacted length-preserving',
        handoffKind: 'compact_sequence_summary_candidate',
      })).toBe(true);
      const row = getActivePendingPromptSequence(store, PROJECT, 'sess-1');
      expect(row?.redactedOriginalPromptText).toBe('the original prompt text, redacted length-preserving');
      expect(row?.handoffKind).toBe('compact_sequence_summary_candidate');
    });

    it('reads both as null when the upsert omits them (old-style row)', () => {
      // No side fields supplied — the two columns default to NULL and read back as null, never
      // undefined and never a crash.
      expect(upsertPendingPromptSequence(store, createdState(), payload())).toBe(true);
      const row = getActivePendingPromptSequence(store, PROJECT, 'sess-1');
      expect(row?.redactedOriginalPromptText).toBeNull();
      expect(row?.handoffKind).toBeNull();
    });
  });
});
