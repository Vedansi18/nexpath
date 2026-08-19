import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// The backfill reads session files the coding agent is actively writing and
// rotating, and it runs AHEAD of the live prompt's insert. This file mocks the
// importer into failing — the realistic case is a file listed by readdir that is
// gone or unreadable when it is opened — and pins the guarantee that matters:
// the user's current prompt is still stored and the run still completes. Mocked
// at module scope, so it lives in its own file rather than disturbing the real
// backfill fixtures in auto.test.ts.
vi.mock('../../store/historical-import.js', () => ({
  importHistoricalPrompts: vi.fn(async () => {
    throw Object.assign(new Error("ENOENT: no such file or directory, open 'session.jsonl'"), { code: 'ENOENT' });
  }),
}));

const { openStore } = await import('../../store/index.js');
const { getRecentPrompts } = await import('../../store/prompts.js');
const { runAuto } = await import('./auto.js');
const { importHistoricalPrompts } = await import('../../store/historical-import.js');

type StoreHandle = Awaited<ReturnType<typeof openStore>>;

describe('runAuto — a failing historical backfill never costs the live prompt', () => {
  let store: StoreHandle;

  beforeEach(async () => { store = await openStore(':memory:'); });
  afterEach(() => { store.db.close(); vi.clearAllMocks(); });

  it('stores the current prompt and completes even though the import threw', async () => {
    const projectRoot = '/test/backfill-failure';

    const result = await runAuto(
      { promptText: 'the checkout page throws a null error after login', projectRoot },
      store,
    );

    expect(importHistoricalPrompts).toHaveBeenCalledTimes(1);
    expect(result).toBeDefined();
    const texts = getRecentPrompts(store, projectRoot, 10).map((r) => r.text);
    expect(texts).toContain('the checkout page throws a null error after login');
  });

  it('the next prompt is unaffected — the failure is not sticky', async () => {
    const projectRoot = '/test/backfill-failure-2';

    await runAuto({ promptText: 'first prompt', projectRoot }, store);
    await runAuto({ promptText: 'second prompt', projectRoot }, store);

    const texts = getRecentPrompts(store, projectRoot, 10).map((r) => r.text);
    expect(texts).toContain('first prompt');
    expect(texts).toContain('second prompt');
  });
});
