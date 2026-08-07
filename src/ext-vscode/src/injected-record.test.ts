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
});
