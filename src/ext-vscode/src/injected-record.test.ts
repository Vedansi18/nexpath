import { describe, it, expect } from 'vitest';
import { createInjectedRecordStore } from './injected-record.js';

describe('createInjectedRecordStore', () => {
  it('reports no echo before anything has been recorded', () => {
    const store = createInjectedRecordStore();
    expect(store.isRecentEcho('/proj', 'hello')).toBe(false);
  });

  it('recognises an exact-text echo within the window', () => {
    const store = createInjectedRecordStore(60_000);
    store.record('/proj', 'the enhanced body', 1_000);
    expect(store.isRecentEcho('/proj', 'the enhanced body', 1_500)).toBe(true);
  });

  it('does not match a different text, even for the same project', () => {
    const store = createInjectedRecordStore(60_000);
    store.record('/proj', 'the enhanced body', 1_000);
    expect(store.isRecentEcho('/proj', 'a different prompt', 1_500)).toBe(false);
  });

  it('does not match the same text for a different project (PE-scoped per project)', () => {
    const store = createInjectedRecordStore(60_000);
    store.record('/proj-a', 'the enhanced body', 1_000);
    expect(store.isRecentEcho('/proj-b', 'the enhanced body', 1_500)).toBe(false);
  });

  it('expires exactly outside the window', () => {
    const store = createInjectedRecordStore(60_000);
    store.record('/proj', 'the enhanced body', 1_000);
    expect(store.isRecentEcho('/proj', 'the enhanced body', 1_000 + 60_000)).toBe(true); // inclusive boundary
    expect(store.isRecentEcho('/proj', 'the enhanced body', 1_000 + 60_001)).toBe(false);
  });

  it('is non-consuming: repeated checks within the window all match (fixes the single-shot CLI guard flaw)', () => {
    const store = createInjectedRecordStore(60_000);
    store.record('/proj', 'the enhanced body', 1_000);
    expect(store.isRecentEcho('/proj', 'the enhanced body', 1_100)).toBe(true);
    expect(store.isRecentEcho('/proj', 'the enhanced body', 1_200)).toBe(true);
    expect(store.isRecentEcho('/proj', 'the enhanced body', 1_300)).toBe(true);
  });

  it('a later record for the same project replaces the previous one', () => {
    const store = createInjectedRecordStore(60_000);
    store.record('/proj', 'first body', 1_000);
    store.record('/proj', 'second body', 2_000);
    expect(store.isRecentEcho('/proj', 'first body', 2_100)).toBe(false);
    expect(store.isRecentEcho('/proj', 'second body', 2_100)).toBe(true);
  });

  it('two independently-created stores do not share state', () => {
    const storeA = createInjectedRecordStore();
    const storeB = createInjectedRecordStore();
    storeA.record('/proj', 'text', 1_000);
    expect(storeB.isRecentEcho('/proj', 'text', 1_000)).toBe(false);
  });

  it('uses the real clock when now is omitted (smoke test)', () => {
    const store = createInjectedRecordStore();
    store.record('/proj', 'text');
    expect(store.isRecentEcho('/proj', 'text')).toBe(true);
  });

  it('defaults the window to exactly 60s when windowMs is omitted (every other test pins its own explicit windowMs, so nothing else proves this)', () => {
    const store = createInjectedRecordStore();
    store.record('/proj', 'the enhanced body', 1_000);
    expect(store.isRecentEcho('/proj', 'the enhanced body', 1_000 + 60_000)).toBe(true);
    expect(store.isRecentEcho('/proj', 'the enhanced body', 1_000 + 60_001)).toBe(false);
  });
});

describe('createInjectedRecordStore — resolveOriginGuardState (P8, typed-origin echo guard)', () => {
  const origin = { currentBodyId: 'body-1', bodyRevision: 3 };

  it('reports not_delivered before anything has been recorded', () => {
    const store = createInjectedRecordStore(60_000);
    expect(store.resolveOriginGuardState('/proj', 'hello')).toBe('not_delivered');
  });

  it('reports next_submit_processed_as_delivery_echo when text matches AND a typed origin was recorded', () => {
    const store = createInjectedRecordStore(60_000);
    store.record('/proj', 'the enhanced body', 1_000, origin);
    expect(store.resolveOriginGuardState('/proj', 'the enhanced body', 1_500)).toBe(
      'next_submit_processed_as_delivery_echo',
    );
  });

  it('a text match ALONE never triggers the guard — a DS injection (no origin recorded) reports not_delivered even on exact text match', () => {
    const store = createInjectedRecordStore(60_000);
    store.record('/proj', 'the enhanced body', 1_000); // no origin passed — DS-style injection
    expect(store.resolveOriginGuardState('/proj', 'the enhanced body', 1_500)).toBe('not_delivered');
  });

  it('a text match ALONE never triggers the guard — explicit null origin behaves the same as omitted', () => {
    const store = createInjectedRecordStore(60_000);
    store.record('/proj', 'the enhanced body', 1_000, null);
    expect(store.resolveOriginGuardState('/proj', 'the enhanced body', 1_500)).toBe('not_delivered');
  });

  it('reports next_submit_mismatch_cleared when text differs, even with a typed origin recorded', () => {
    const store = createInjectedRecordStore(60_000);
    store.record('/proj', 'the enhanced body', 1_000, origin);
    expect(store.resolveOriginGuardState('/proj', 'a different prompt', 1_500)).toBe(
      'next_submit_mismatch_cleared',
    );
  });

  it('reports next_submit_mismatch_cleared when the typed origin exists but the window expired', () => {
    const store = createInjectedRecordStore(60_000);
    store.record('/proj', 'the enhanced body', 1_000, origin);
    expect(store.resolveOriginGuardState('/proj', 'the enhanced body', 1_000 + 60_001)).toBe(
      'next_submit_mismatch_cleared',
    );
  });

  it('is scoped per project — a typed origin recorded for one project never guards another', () => {
    const store = createInjectedRecordStore(60_000);
    store.record('/proj-a', 'the enhanced body', 1_000, origin);
    expect(store.resolveOriginGuardState('/proj-b', 'the enhanced body', 1_500)).toBe('not_delivered');
  });

  it('is non-consuming, like isRecentEcho', () => {
    const store = createInjectedRecordStore(60_000);
    store.record('/proj', 'the enhanced body', 1_000, origin);
    expect(store.resolveOriginGuardState('/proj', 'the enhanced body', 1_100)).toBe(
      'next_submit_processed_as_delivery_echo',
    );
    expect(store.resolveOriginGuardState('/proj', 'the enhanced body', 1_200)).toBe(
      'next_submit_processed_as_delivery_echo',
    );
  });

  it('a later record (with a new origin) replaces the previous one entirely, same as isRecentEcho', () => {
    const store = createInjectedRecordStore(60_000);
    store.record('/proj', 'first body', 1_000, { currentBodyId: 'body-1', bodyRevision: 1 });
    store.record('/proj', 'second body', 2_000, { currentBodyId: 'body-2', bodyRevision: 5 });
    expect(store.resolveOriginGuardState('/proj', 'first body', 2_100)).toBe('next_submit_mismatch_cleared');
    expect(store.resolveOriginGuardState('/proj', 'second body', 2_100)).toBe(
      'next_submit_processed_as_delivery_echo',
    );
  });

  it('a later record WITHOUT an origin correctly clears a previously-armed typed guard', () => {
    const store = createInjectedRecordStore(60_000);
    store.record('/proj', 'first body', 1_000, origin);
    store.record('/proj', 'second body', 2_000); // no origin — e.g. a DS injection overwrote it
    expect(store.resolveOriginGuardState('/proj', 'second body', 2_100)).toBe('not_delivered');
  });
});
