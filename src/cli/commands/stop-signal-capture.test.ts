import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../telemetry/index.js', () => ({
  writeTelemetry: vi.fn(),
  TELEMETRY_PATH: '/mock/telemetry.jsonl',
}));

vi.mock('../../telemetry/recent-prompts.js', () => ({
  recentPromptMetadata: vi.fn().mockReturnValue([]),
}));

vi.mock('../../telemetry/lifecycle-flush.js', () => ({
  flushIfTelemetryOn: vi.fn().mockResolvedValue(undefined),
  flushLifecycle:     vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../decision-session/OptionGenerator.js', () => ({
  generateOptionList: vi.fn().mockResolvedValue(null),
}));

import { openStore, closeStore } from '../../store/db.js';
import type { Store } from '../../store/db.js';
import { runStop } from './stop.js';
import type { StopPayload } from './stop.js';
import { upsertPendingAdvisory } from '../../store/pending-advisories.js';
import { SessionStateManager } from '../../classifier/SessionStateManager.js';
import { readSignals } from '../../store/feedback-signals.js';
import { readCadence } from '../../store/feedback-cadence.js';

const CWD = '/test/project';

function makePayload(overrides: Partial<StopPayload> = {}): StopPayload {
  return {
    session_id:             'sess-001',
    cwd:                    CWD,
    hook_event_name:        'Stop',
    stop_hook_active:       false,
    last_assistant_message: 'Done.',
    ...overrides,
  };
}

function insertAdvisory(store: Store) {
  const mgr = SessionStateManager.load(store, CWD);
  mgr.setDetectedLanguage(store, undefined); // persist session so runStop finds same UUID
  upsertPendingAdvisory(store, {
    projectRoot: CWD,
    stage:       'implementation',
    flagType:    'absence:test_creation',
    pinchLabel:  'Hold up.',
    sessionId:   mgr.current.sessionId,
    promptCount: 5,
  });
}

let store: Store;
beforeEach(async () => { store = await openStore(':memory:'); });
afterEach(() => { closeStore(store); vi.restoreAllMocks(); });

describe('usage is NOT recorded by the stop hook', () => {
  it('does not touch the usage accumulator (usage lives on the auto hook now)', async () => {
    await runStop(makePayload(), store);
    expect(readCadence(store).lastActivityAt).toBeNull();
  });
});

// MPS-7: the old Decision-Session advisory render is removed, and with it the advisory-fire /
// option-select recording that lived there. A pending advisory is now consumed silently, so no fire or
// selection signal is ever recorded on the Stop hook.
describe('MPS-7: the disabled advisory records no fire or selection signal', () => {
  it('a pending advisory is consumed (advisory_disabled) and records no fire/selection', async () => {
    insertAdvisory(store);
    const result = await runStop(makePayload(), store);
    expect(result.outcome).toBe('advisory_disabled');
    expect(readSignals(store, CWD)).toEqual({ advisoryFireTs: [], optionSelectTs: [] });
  });

  it('records no signals when there is no pending advisory', async () => {
    await runStop(makePayload(), store);
    expect(readSignals(store, CWD)).toEqual({ advisoryFireTs: [], optionSelectTs: [] });
  });
});
