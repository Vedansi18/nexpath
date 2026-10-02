import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// The environment probe runs on a session's first prompt. A history import bootstraps the
// session with the imported count, so without care the probe would wait a whole session on an
// imported project. It must run on the prompt that imported Cursor or Devin Local history — and
// keep today's behaviour when the import held Claude Code history only.
const importState = vi.hoisted(() => ({ fromOtherAgents: 0, imported: 0 }));

vi.mock('../../store/historical-import.js', () => ({
  importHistoricalPrompts: vi.fn(async (store: unknown, projectRoot: string) => {
    const { SessionStateManager } = await import('../../classifier/SessionStateManager.js');
    if (importState.imported > 0) {
      SessionStateManager.bootstrapFromHistory(store as never, projectRoot, [], importState.imported);
    }
    return { imported: importState.imported, fromOtherAgents: importState.fromOtherAgents };
  }),
}));

vi.mock('../../env/env-trajectory.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../env/env-trajectory.js')>();
  return { ...actual, recordEnvTrajectory: vi.fn(() => undefined) };
});

const { openStore } = await import('../../store/index.js');
const { runAuto } = await import('./auto.js');
const { recordEnvTrajectory } = await import('../../env/env-trajectory.js');
const { importHistoricalPrompts } = await import('../../store/historical-import.js');

type StoreHandle = Awaited<ReturnType<typeof openStore>>;

describe('runAuto — the environment probe after a history import', () => {
  let store: StoreHandle;
  beforeEach(async () => { store = await openStore(':memory:'); });
  afterEach(() => { store.db.close(); vi.clearAllMocks(); });

  it('passes the live prompt to the import', async () => {
    importState.imported = 0; importState.fromOtherAgents = 0;
    await runAuto({ promptText: 'add a settings page', projectRoot: '/test/probe-a' }, store);
    expect(importHistoricalPrompts).toHaveBeenCalledWith(store, '/test/probe-a', expect.objectContaining({ livePrompt: 'add a settings page' }));
  });

  it('runs on the prompt that imported Cursor or Devin Local history', async () => {
    importState.imported = 12; importState.fromOtherAgents = 7;
    await runAuto({ promptText: 'add a settings page', projectRoot: '/test/probe-b' }, store);
    expect(recordEnvTrajectory).toHaveBeenCalledTimes(1);
  });

  it('keeps today\'s behaviour when the import held Claude Code history only (control)', async () => {
    importState.imported = 12; importState.fromOtherAgents = 0;
    await runAuto({ promptText: 'add a settings page', projectRoot: '/test/probe-c' }, store);
    expect(recordEnvTrajectory).not.toHaveBeenCalled();
  });

  it('runs on a project\'s first prompt when nothing was imported, as today', async () => {
    importState.imported = 0; importState.fromOtherAgents = 0;
    await runAuto({ promptText: 'add a settings page', projectRoot: '/test/probe-d' }, store);
    expect(recordEnvTrajectory).toHaveBeenCalledTimes(1);
  });
});
