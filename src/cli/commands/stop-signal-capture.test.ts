import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../telemetry/index.js', () => ({
  writeTelemetry: vi.fn(),
  TELEMETRY_PATH: '/mock/telemetry.jsonl',
}));

vi.mock('../../telemetry/recent-prompts.js', () => ({
  recentPromptMetadata: vi.fn().mockReturnValue([]),
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
import { SKIP_NOW } from '../../decision-session/options.js';
import { CLIPBOARD_ONLY } from '../../decision-session/DecisionSession.js';
import type { SelectFn } from '../../decision-session/DecisionSession.js';
import * as TtySelectFnModule from '../../decision-session/TtySelectFn.js';
import { setConfig } from '../../store/config.js';
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

const mockSelect = (value: string): SelectFn => vi.fn().mockResolvedValue(value);

let store: Store;
beforeEach(async () => { store = await openStore(':memory:'); });
afterEach(() => { closeStore(store); vi.restoreAllMocks(); });

describe('usage recording', () => {
  it('records activity on a normal turn (even with no advisory)', async () => {
    await runStop(makePayload(), store);
    expect(readCadence(store).lastActivityAt).not.toBeNull();
  });

  it('does not record activity on the loop guard', async () => {
    await runStop(makePayload({ stop_hook_active: true }), store);
    expect(readCadence(store).lastActivityAt).toBeNull();
  });

  it('accumulates usage globally across turns within the idle cap', async () => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_000_000);
    await runStop(makePayload({ cwd: '/proj-a' }), store);
    nowSpy.mockReturnValue(1_000_000 + 60_000);
    await runStop(makePayload({ cwd: '/proj-b' }), store); // different project → same global counter
    expect(readCadence(store).activeMs).toBe(60_000);
  });

  it('records activity even when the advisory frequency is off', async () => {
    setConfig(store, 'advisory_frequency', 'off');
    insertAdvisory(store);
    const result = await runStop(makePayload(), store, mockSelect(SKIP_NOW));
    expect(result.outcome).toBe('skipped');
    expect(readCadence(store).lastActivityAt).not.toBeNull();
    // Freq-gated advisory is never shown → no fire recorded.
    expect(readSignals(store, CWD).advisoryFireTs).toHaveLength(0);
  });

  it('records activity but no fire when there is no TTY', async () => {
    insertAdvisory(store);
    vi.spyOn(TtySelectFnModule, 'createTtySelectFn').mockReturnValue(null);
    const result = await runStop(makePayload(), store); // no selectFn → resolves TTY
    expect(result.outcome).toBe('no_tty');
    expect(readCadence(store).lastActivityAt).not.toBeNull();
    expect(readSignals(store, CWD).advisoryFireTs).toHaveLength(0);
  });
});

describe('advisory-fire and option-select recording', () => {
  it('records an advisory fire when the advisory is shown then skipped', async () => {
    insertAdvisory(store);
    await runStop(makePayload(), store, mockSelect(SKIP_NOW));
    const signals = readSignals(store, CWD);
    expect(signals.advisoryFireTs).toHaveLength(1);
    expect(signals.optionSelectTs).toHaveLength(0);
  });

  it('records both a fire and a selection when a content option is chosen', async () => {
    insertAdvisory(store);
    const result = await runStop(makePayload(), store, mockSelect('write tests first'));
    expect(result.outcome).toBe('blocked');
    const signals = readSignals(store, CWD);
    expect(signals.advisoryFireTs).toHaveLength(1);
    expect(signals.optionSelectTs).toHaveLength(1);
  });

  it('records a fire AND a selection when the option is copied to clipboard', async () => {
    insertAdvisory(store);
    const result = await runStop(makePayload(), store, mockSelect(CLIPBOARD_ONLY));
    expect(result.outcome).toBe('clipboard_only');
    const signals = readSignals(store, CWD);
    expect(signals.advisoryFireTs).toHaveLength(1);
    expect(signals.optionSelectTs).toHaveLength(1);   // clipboard-copy counts as engagement
  });

  it('accumulates a fire per shown advisory across turns', async () => {
    insertAdvisory(store);
    await runStop(makePayload(), store, mockSelect(SKIP_NOW));
    insertAdvisory(store);
    await runStop(makePayload(), store, mockSelect(SKIP_NOW));
    expect(readSignals(store, CWD).advisoryFireTs).toHaveLength(2);
  });

  it('records no signals when there is no pending advisory', async () => {
    await runStop(makePayload(), store);
    expect(readSignals(store, CWD)).toEqual({ advisoryFireTs: [], optionSelectTs: [] });
  });
});
