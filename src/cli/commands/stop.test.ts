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

vi.mock('../../telemetry/lifecycle-flush.js', () => ({
  flushIfTelemetryOn: vi.fn().mockResolvedValue(undefined),
  flushLifecycle:     vi.fn().mockResolvedValue(undefined),
}));

// The engine path (migrated signals) is mocked to null like the static generateOptionList above,
// so these flow tests stay deterministic and never make a live LLM call — regardless of which
// signals are in MIGRATED_SIGNALS. A null return exercises the static-content fallback in runLevel.
vi.mock('../../decision-session/engine-option-generator.js', () => ({
  generateFromEngine: vi.fn().mockResolvedValue(null),
  buildEngineGrounding: vi.fn().mockResolvedValue([]),
  // The deterministic fallback — mocked to null so flow tests fall through to the static generate
  // path (also mocked null) and exercise the static-content fallback. Its real behavior is unit-tested.
  composeDeterministicOptions: vi.fn().mockReturnValue(null),
}));

import { openStore } from '../../store/db.js';
import type { Store } from '../../store/db.js';
import { runStop } from './stop.js';
import type { StopPayload } from './stop.js';
import { upsertPendingAdvisory, getPendingAdvisory } from '../../store/pending-advisories.js';
import { upsertPendingPromptEnhancement, getPendingPromptEnhancement } from '../../store/pending-prompt-enhancements.js';
import { buildPromptEnhancementRequestForAuto } from './auto.js';
import { preparePromptEnhancement } from '../../prompt-enhancement/facade.js';
import type { PromptEnhancementStopLaunchFn } from './stop.js';
import { getSkippedSessions } from '../../store/skipped-sessions.js';
import { SKIP_NOW } from '../../decision-session/options.js';
import { CLIPBOARD_ONLY } from '../../decision-session/DecisionSession.js';
import type { SelectFn } from '../../decision-session/DecisionSession.js';
import * as TtySelectFnModule from '../../decision-session/TtySelectFn.js';
import { insertPrompt } from '../../store/prompts.js';
import { upsertProject, getProject } from '../../store/projects.js';
import { LANG_DETECT_INTERVAL } from '../../classifier/LanguageDetector.js';
import { writeTelemetry } from '../../telemetry/index.js';
import { recentPromptMetadata } from '../../telemetry/recent-prompts.js';
import { generateFromEngine, composeDeterministicOptions } from '../../decision-session/engine-option-generator.js';
import { SessionStateManager } from '../../classifier/SessionStateManager.js';
import { generateOptionList } from '../../decision-session/OptionGenerator.js';
import { flushIfTelemetryOn } from '../../telemetry/lifecycle-flush.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makePayload(overrides: Partial<StopPayload> = {}): StopPayload {
  return {
    session_id:          'sess-001',
    cwd:                 '/test/project',
    hook_event_name:     'Stop',
    stop_hook_active:    false,
    last_assistant_message: 'Done.',
    ...overrides,
  };
}

function makeAdvisory(projectRoot = '/test/project') {
  return {
    projectRoot,
    stage:       'implementation' as const,
    flagType:    'absence:test_creation' as const,
    pinchLabel:  'Hold up.',
    sessionId:   'sess-001',
    promptCount: 5,
  };
}

function mockSelect(value: string): SelectFn {
  return vi.fn().mockResolvedValue(value);
}

function mockCancel(): SelectFn {
  return vi.fn().mockResolvedValue(Symbol('cancel'));
}

function insertAdvisory(store: Store, projectRoot = '/test/project') {
  const mgr = SessionStateManager.load(store, projectRoot);
  mgr.setDetectedLanguage(store, undefined); // persist session to DB so runStop finds same UUID
  upsertPendingAdvisory(store, { ...makeAdvisory(projectRoot), sessionId: mgr.current.sessionId });
}

async function insertPendingPe(store: Store, projectRoot = '/test/project') {
  const session = SessionStateManager.load(store, projectRoot);
  session.setDetectedLanguage(store, undefined); // persist session to DB so runStop finds the same UUID (matches insertAdvisory)
  const request = buildPromptEnhancementRequestForAuto({
    auto: { promptText: 'implement the login flow', projectRoot, currentAgentMode: 'workspace-write' },
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
      signalsPresent: [], signalsAbsent: [], fireRecommendation: true,
      selectedSignalKey: '', reason: 'test', degraded: false,
    },
    streamBOutputs: [],
  });
  const result = await preparePromptEnhancement(request);
  upsertPendingPromptEnhancement(store, { projectRoot, sessionId: session.current.sessionId, promptCount: 5, request, result });
}

// Owner decision B-i: the deferred PE popup is shown on the Stop hook, before the advisory.
describe('runStop — deferred Prompt Enhancement popup (B-i)', () => {
  let store: Store;
  beforeEach(async () => { store = await openStore(':memory:'); });
  afterEach(() => { store.db.close(); });

  const inject = (text: string): PromptEnhancementStopLaunchFn => vi.fn().mockResolvedValue({ kind: 'inject', text });
  const shown = (): PromptEnhancementStopLaunchFn => vi.fn().mockResolvedValue({ kind: 'shown' });
  const notShown = (): PromptEnhancementStopLaunchFn => vi.fn().mockResolvedValue({ kind: 'not_shown' });

  it('injects the enhanced prompt as a new turn when the user picks Use enhanced', async () => {
    await insertPendingPe(store);
    const result = await runStop(makePayload(), store, undefined, undefined, undefined, inject('ENHANCED PROMPT BODY'));
    expect(result).toEqual({ outcome: 'blocked', reason: 'ENHANCED PROMPT BODY' });
  });

  it('marks the pending PE shown so a Stop re-fire does not re-show it', async () => {
    await insertPendingPe(store);
    await runStop(makePayload(), store, undefined, undefined, undefined, inject('BODY'));
    expect(getPendingPromptEnhancement(store, '/test/project')).toBeNull();
  });

  it('arms the injected-prompt echo guard so the enhanced turn does not re-trigger a PE', async () => {
    await insertPendingPe(store);
    await runStop(makePayload(), store, undefined, undefined, undefined, inject('ENHANCED BODY TEXT'));
    // The enhanced body is recorded as the last injected prompt; auto's -1 guard uses it to skip.
    expect(SessionStateManager.load(store, '/test/project').current.lastInjectedPrompt).toBe('ENHANCED BODY TEXT');
  });

  it('returns prompt_enhancement_shown when the popup shows but nothing is sent', async () => {
    await insertPendingPe(store);
    const result = await runStop(makePayload(), store, undefined, undefined, undefined, shown());
    expect(result).toEqual({ outcome: 'prompt_enhancement_shown' });
  });

  it('falls through to the advisory path when no PE host is available', async () => {
    await insertPendingPe(store); // pending PE exists, but the host cannot show it
    // No advisory seeded → falling through reaches the advisory lookup and finds nothing.
    const result = await runStop(makePayload(), store, undefined, undefined, undefined, notShown());
    expect(result).toEqual({ outcome: 'no_pending' });
  });

  it('leaves the pending PE PENDING on not_shown so a later Stop can retry it (Bug 2 — no silent loss)', async () => {
    await insertPendingPe(store);
    // Host could not display it this turn (e.g. an unsupported platform → not_shown).
    await runStop(makePayload(), store, undefined, undefined, undefined, notShown());
    // The record must NOT be consumed — a working host on a later Stop can still show it.
    expect(getPendingPromptEnhancement(store, '/test/project')).not.toBeNull();
  });

  it('consumes the pending PE only after it was actually shown (Bug 2 — mark after launch)', async () => {
    await insertPendingPe(store);
    await runStop(makePayload(), store, undefined, undefined, undefined, shown());
    // Displayed → consumed so a Stop re-fire cannot re-show it.
    expect(getPendingPromptEnhancement(store, '/test/project')).toBeNull();
  });

  it('ignores a pending PE queued under a different session (Bug 4 — session-scoped lookup)', async () => {
    await insertPendingPe(store);
    // Re-point the stored PE to a foreign session id, as if it were queued in an unrelated session.
    store.db.run("UPDATE pending_prompt_enhancements SET session_id = 'sess-unrelated-xyz'");
    const launch = notShown(); // spy — must NOT run for a foreign-session PE
    const result = await runStop(makePayload(), store, undefined, undefined, undefined, launch);
    expect(launch).not.toHaveBeenCalled();
    expect(result).toEqual({ outcome: 'no_pending' });
  });

  it('takes priority over the advisory (one popup per Stop): PE injects, advisory stays pending', async () => {
    await insertPendingPe(store);
    insertAdvisory(store);
    const result = await runStop(makePayload(), store, undefined, undefined, undefined, inject('ENH'));
    expect(result).toEqual({ outcome: 'blocked', reason: 'ENH' });
    // The advisory was not consumed this turn — it remains for a later Stop.
    expect(getPendingAdvisory(store, '/test/project')).not.toBeNull();
  });

  it('does not show the PE popup when no launcher is wired (default runStop)', async () => {
    await insertPendingPe(store);
    // No peLaunch arg → PE step skipped; with no advisory, outcome is no_pending.
    const result = await runStop(makePayload(), store);
    expect(result).toEqual({ outcome: 'no_pending' });
    // The pending PE is untouched (not consumed) when there is no launcher.
    expect(getPendingPromptEnhancement(store, '/test/project')).not.toBeNull();
  });
});

// ── runStop — loop guard ──────────────────────────────────────────────────────

describe('runStop — loop guard', () => {
  let store: Store;

  beforeEach(async () => { store = await openStore(':memory:'); });
  afterEach(() => { store.db.close(); });

  it('returns loop_guard when stop_hook_active is true', async () => {
    const result = await runStop(makePayload({ stop_hook_active: true }), store);
    expect(result.outcome).toBe('loop_guard');
  });

  it('does not check DB when stop_hook_active is true', async () => {
    // Even if there is a pending advisory, loop guard fires first
    insertAdvisory(store);
    const result = await runStop(makePayload({ stop_hook_active: true }), store);
    expect(result.outcome).toBe('loop_guard');
    // Advisory should still be pending (not consumed)
    const advisory = getPendingAdvisory(store, '/test/project');
    expect(advisory).not.toBeNull();
  });
});

// ── runStop — no_tty ─────────────────────────────────────────────────────────

describe('runStop — no_tty', () => {
  let store: Store;

  beforeEach(async () => { store = await openStore(':memory:'); });
  afterEach(() => {
    store.db.close();
    vi.restoreAllMocks();
  });

  it('returns no_tty when createTtySelectFn returns null and no selectFn injected', async () => {
    insertAdvisory(store);
    vi.spyOn(TtySelectFnModule, 'createTtySelectFn').mockReturnValue(null);
    // Do NOT pass selectFn so the real TTY resolution path is taken
    const result = await runStop(makePayload(), store);
    expect(result.outcome).toBe('no_tty');
  });

  it('marks advisory as shown even when TTY is unavailable', async () => {
    insertAdvisory(store);
    vi.spyOn(TtySelectFnModule, 'createTtySelectFn').mockReturnValue(null);
    await runStop(makePayload(), store);
    // Advisory should be marked shown so it doesn't re-show on next Stop
    expect(getPendingAdvisory(store, '/test/project')).toBeNull();
  });
});

// ── runStop — no pending advisory ─────────────────────────────────────────────

describe('runStop — no pending advisory', () => {
  let store: Store;

  beforeEach(async () => { store = await openStore(':memory:'); });
  afterEach(() => { store.db.close(); });

  it('returns no_pending when DB has no advisory for this project', async () => {
    const result = await runStop(makePayload(), store);
    expect(result.outcome).toBe('no_pending');
  });

  it('returns no_pending after advisory has been marked shown', async () => {
    insertAdvisory(store);
    // First call marks it shown
    await runStop(makePayload(), store, mockSelect(SKIP_NOW));
    // Second call: advisory is now 'shown', not 'pending'
    const result = await runStop(makePayload(), store, mockSelect(SKIP_NOW));
    expect(result.outcome).toBe('no_pending');
  });

  it('returns no_pending when advisory session_id does not match current session (cross-session guard)', async () => {
    // makeAdvisory() uses hardcoded sessionId 'sess-001'; runStop loads a fresh session with a different UUID
    upsertPendingAdvisory(store, makeAdvisory());
    const result = await runStop(makePayload(), store);
    expect(result.outcome).toBe('no_pending');
  });
});

// ── runStop — user picks option ───────────────────────────────────────────────

describe('runStop — user picks option', () => {
  let store: Store;

  beforeEach(async () => { store = await openStore(':memory:'); });
  afterEach(() => { store.db.close(); });

  it('returns blocked with reason when user selects a content option', async () => {
    insertAdvisory(store);
    const selectedText = 'write unit tests before continuing';
    const result = await runStop(makePayload(), store, mockSelect(selectedText));
    expect(result.outcome).toBe('blocked');
    if (result.outcome === 'blocked') {
      expect(result.reason).toBe(selectedText);
    }
  });

  it('marks advisory as shown after user picks option', async () => {
    insertAdvisory(store);
    await runStop(makePayload(), store, mockSelect('some option'));
    const advisory = getPendingAdvisory(store, '/test/project');
    expect(advisory).toBeNull(); // shown advisory no longer returned as pending
  });

  it('flushes lifecycle events when an advisory fires (on-mode immediate / off-mode buffer)', async () => {
    vi.mocked(flushIfTelemetryOn).mockClear();
    insertAdvisory(store);
    await runStop(makePayload(), store, mockSelect('some option'));
    expect(flushIfTelemetryOn).toHaveBeenCalledWith(store);
  });

  it('also emits option-selected immediately when an option is chosen (on-mode)', async () => {
    vi.mocked(flushIfTelemetryOn).mockClear();
    insertAdvisory(store);
    const result = await runStop(makePayload(), store, mockSelect('some option'));
    expect(result.outcome).toBe('blocked');
    // advisory-fired flush + option-selected occurrence flush → at least two calls
    expect(vi.mocked(flushIfTelemetryOn).mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

// ── runStop — clipboard only ──────────────────────────────────────────────────

describe('runStop — clipboard_only', () => {
  let store: Store;

  beforeEach(async () => { store = await openStore(':memory:'); });
  afterEach(() => { store.db.close(); });

  it('returns clipboard_only when selectFn returns CLIPBOARD_ONLY sentinel', async () => {
    insertAdvisory(store);
    const result = await runStop(makePayload(), store, mockSelect(CLIPBOARD_ONLY));
    expect(result.outcome).toBe('clipboard_only');
  });

  it('does not record a skipped_sessions row on clipboard_only', async () => {
    insertAdvisory(store);
    await runStop(makePayload(), store, mockSelect(CLIPBOARD_ONLY));
    const rows = getSkippedSessions(store, '/test/project');
    expect(rows).toHaveLength(0);
  });
});

// ── runStop — user skips ──────────────────────────────────────────────────────

describe('runStop — user skips', () => {
  let store: Store;

  beforeEach(async () => { store = await openStore(':memory:'); });
  afterEach(() => { store.db.close(); });

  it('returns skipped when user selects SKIP_NOW', async () => {
    insertAdvisory(store);
    const result = await runStop(makePayload(), store, mockSelect(SKIP_NOW));
    expect(result.outcome).toBe('skipped');
  });

  it('returns skipped on Ctrl+C (cancel symbol)', async () => {
    insertAdvisory(store);
    const result = await runStop(makePayload(), store, mockCancel());
    expect(result.outcome).toBe('skipped');
  });

  it('records a skipped_sessions row when outcome is skipped', async () => {
    insertAdvisory(store);
    const result = await runStop(makePayload(), store, mockSelect(SKIP_NOW));
    expect(result.outcome).toBe('skipped');
    const rows = getSkippedSessions(store, '/test/project');
    expect(rows).toHaveLength(1);
    expect(rows[0].flagType).toBe('absence:test_creation');
    expect(rows[0].stage).toBe('implementation');
  });

  it('does NOT record skipped_sessions when user picks an option', async () => {
    insertAdvisory(store);
    await runStop(makePayload(), store, mockSelect('write unit tests'));
    const rows = getSkippedSessions(store, '/test/project');
    expect(rows).toHaveLength(0);
  });
});

// ── runStop — advisory isolation per project ──────────────────────────────────

describe('runStop — project isolation', () => {
  let store: Store;

  beforeEach(async () => { store = await openStore(':memory:'); });
  afterEach(() => { store.db.close(); });

  it('does not trigger for a different project root', async () => {
    insertAdvisory(store, '/test/project-a');
    const result = await runStop(makePayload({ cwd: '/test/project-b' }), store);
    expect(result.outcome).toBe('no_pending');
  });

  it('triggers for the correct project root', async () => {
    insertAdvisory(store, '/test/project-a');
    insertAdvisory(store, '/test/project-b');
    const result = await runStop(makePayload({ cwd: '/test/project-a' }), store, mockCancel());
    expect(result.outcome).toBe('skipped');
  });
});

// ── runStop — decisionSessionCount wiring (Phase H) ──────────────────────────

describe('runStop — decisionSessionCount wiring', () => {
  let store: Store;

  beforeEach(async () => {
    store = await openStore(':memory:');
    upsertProject(store, { projectRoot: '/test/project', name: 'Test' });
  });
  afterEach(() => { store.db.close(); });

  it('decision_session_count increments after a decision session is shown', async () => {
    insertAdvisory(store);
    expect(getProject(store, '/test/project')?.decisionSessionCount).toBe(0);

    await runStop(makePayload(), store, mockSelect(SKIP_NOW));

    expect(getProject(store, '/test/project')?.decisionSessionCount).toBe(1);
  });

  it('decision_session_count increments even when user picks an option (not just skips)', async () => {
    insertAdvisory(store);
    await runStop(makePayload(), store, mockSelect('write unit tests'));
    expect(getProject(store, '/test/project')?.decisionSessionCount).toBe(1);
  });

  it('decision_session_count does NOT increment when there is no pending advisory', async () => {
    // No advisory → runStop returns no_pending before reaching runDecisionSession
    await runStop(makePayload(), store, mockSelect(SKIP_NOW));
    expect(getProject(store, '/test/project')?.decisionSessionCount).toBe(0);
  });

  it('createTtySelectFn is called with store and projectRoot when TTY path is taken', async () => {
    insertAdvisory(store);
    const spy = vi.spyOn(TtySelectFnModule, 'createTtySelectFn').mockReturnValue(null);
    // No selectFn injected → real TTY path taken → createTtySelectFn called
    await runStop(makePayload(), store);
    expect(spy).toHaveBeenCalledWith(store, '/test/project');
  });
});

// ── Stop hook output format ───────────────────────────────────────────────────

describe('Stop hook output format', () => {
  it('blocked JSON has correct shape for Claude Code Stop hook', () => {
    const reason = 'write tests before shipping';
    const output = JSON.stringify({ decision: 'block', reason });
    const parsed = JSON.parse(output) as { decision: string; reason: string };
    expect(parsed.decision).toBe('block');
    expect(parsed.reason).toBe(reason);
  });
});

// ── runStop — language detection (step 1.5) ───────────────────────────────────

describe('runStop — language detection', () => {
  let store: Store;

  beforeEach(async () => {
    store = await openStore(':memory:');
    upsertProject(store, { projectRoot: '/test/project', name: 'Test' });
  });
  afterEach(() => { store.db.close(); });

  it('does not update detected_language when fewer than LANG_DETECT_INTERVAL prompts exist', async () => {
    // Insert LANG_DETECT_INTERVAL - 1 prompts (threshold not met)
    for (let i = 0; i < LANG_DETECT_INTERVAL - 1; i++) {
      insertPrompt(store, { projectRoot: '/test/project', promptText: 'I want to add a feature' });
    }
    await runStop(makePayload(), store, mockSelect(SKIP_NOW));
    const proj = getProject(store, '/test/project');
    expect(proj?.detectedLanguage).toBeNull(); // detection did not fire
  });

  it('updates detected_language when >= LANG_DETECT_INTERVAL prompts exist', async () => {
    // Insert enough English prompts to meet the threshold
    const englishPrompt = 'I want to add a login page so users can reset their password and access settings';
    for (let i = 0; i < LANG_DETECT_INTERVAL; i++) {
      insertPrompt(store, { projectRoot: '/test/project', promptText: englishPrompt });
    }
    await runStop(makePayload(), store, mockSelect(SKIP_NOW));
    const proj = getProject(store, '/test/project');
    // Detection ran — detectedLanguage should be set (may be 'en' or whatever tinyld returns)
    // We only assert it is no longer null (detection fired)
    expect(proj?.detectedLanguage).not.toBeNull();
  });

  it('detection fires even when no advisory is pending (outcome no_pending)', async () => {
    const englishPrompt = 'I want to add a login page so users can reset their password';
    for (let i = 0; i < LANG_DETECT_INTERVAL; i++) {
      insertPrompt(store, { projectRoot: '/test/project', promptText: englishPrompt });
    }
    // No advisory upserted → outcome should be no_pending
    const result = await runStop(makePayload(), store);
    expect(result.outcome).toBe('no_pending');
    // Detection still fired
    const proj = getProject(store, '/test/project');
    expect(proj?.detectedLanguage).not.toBeNull();
  });

  it('detection does NOT fire when stop_hook_active is true (loop guard exits first)', async () => {
    const englishPrompt = 'I want to add a login page so users can reset their password';
    for (let i = 0; i < LANG_DETECT_INTERVAL; i++) {
      insertPrompt(store, { projectRoot: '/test/project', promptText: englishPrompt });
    }
    const result = await runStop(makePayload({ stop_hook_active: true }), store);
    expect(result.outcome).toBe('loop_guard');
    // Loop guard exited before step 1.5 — detected_language stays null
    const proj = getProject(store, '/test/project');
    expect(proj?.detectedLanguage).toBeNull();
  });
});

// ── runStop — lastInjectedPrompt flag ─────────────────────────────────────────

describe('runStop — lastInjectedPrompt flag', () => {
  let store: Store;

  beforeEach(async () => { store = await openStore(':memory:'); });
  afterEach(() => { store.db.close(); });

  it('sets lastInjectedPrompt in session when user selects an option', async () => {
    const selectedText = 'write unit tests before continuing';
    insertAdvisory(store);
    await runStop(makePayload(), store, mockSelect(selectedText));

    const { SessionStateManager } = await import('../../classifier/SessionStateManager.js');
    const mgr = SessionStateManager.load(store, '/test/project');
    expect(mgr.current.lastInjectedPrompt).toBe(selectedText);
  });

  it('does NOT set lastInjectedPrompt when user skips', async () => {
    insertAdvisory(store);
    await runStop(makePayload(), store, mockSelect(SKIP_NOW));

    const { SessionStateManager } = await import('../../classifier/SessionStateManager.js');
    const mgr = SessionStateManager.load(store, '/test/project');
    expect(mgr.current.lastInjectedPrompt ?? null).toBeNull();
  });

  it('does NOT set lastInjectedPrompt on clipboard_only', async () => {
    insertAdvisory(store);
    await runStop(makePayload(), store, mockSelect(CLIPBOARD_ONLY));

    const { SessionStateManager } = await import('../../classifier/SessionStateManager.js');
    const mgr = SessionStateManager.load(store, '/test/project');
    expect(mgr.current.lastInjectedPrompt ?? null).toBeNull();
  });

  it('does NOT set lastInjectedPrompt when no advisory is pending', async () => {
    await runStop(makePayload(), store, mockSelect('some option'));

    const { SessionStateManager } = await import('../../classifier/SessionStateManager.js');
    const mgr = SessionStateManager.load(store, '/test/project');
    expect(mgr.current.lastInjectedPrompt ?? null).toBeNull();
  });
});

// ── runStop — generated options passed to decision session ────────────────────

describe('runStop — generated options wiring', () => {
  let store: Store;

  beforeEach(async () => { store = await openStore(':memory:'); });
  afterEach(() => { store.db.close(); });

  it('runs the engine option-gen path before the decision session (Phase 5: option gen runs in stop)', async () => {
    // The fixture (absence:test_creation) is migrated, so stop.ts generates options via the engine.
    insertAdvisory(store);
    const result = await runStop(makePayload(), store, mockSelect(SKIP_NOW));
    expect(generateFromEngine).toHaveBeenCalled();
    expect(['blocked', 'skipped']).toContain(result.outcome);
  });

  it('serves options when the engine path yields nothing (deterministic fallback / decision session)', async () => {
    // engine + deterministic fallback are mocked to null here → the decision session serves content
    insertAdvisory(store);
    // runLevel echoes the selected value, so any option string exercises the serve path
    // (engine + deterministic fallback are mocked null here; the static content sets are retired).
    const staticL1First = 'A picked content prompt.';
    const result = await runStop(makePayload(), store, mockSelect(staticL1First));
    expect(result.outcome).toBe('blocked');
    if (result.outcome === 'blocked') {
      expect(result.reason).toBe(staticL1First);
    }
  });

  it('pipeline does not crash when advisory has null stored options (option gen runs live)', async () => {
    // Advisory L1/L2/L3 are null (Phase 4: auto no longer stores them)
    // stop.ts generates options live via generateOptionList — no crash expected
    insertAdvisory(store);
    const result = await runStop(makePayload(), store, mockSelect('A picked content prompt.'));
    expect(['blocked', 'skipped']).toContain(result.outcome);
  });

  it('degrades to the deterministic fallback when the engine option-gen throws — the Stop hook never crashes (B3)', async () => {
    // The fixture (absence:test_creation) is migrated (B3), so stop.ts runs the engine path.
    // Force it to throw; stop.ts must CATCH it, fall back to the deterministic engine composition,
    // and still complete the session — never reject/crash the hook.
    vi.mocked(generateFromEngine).mockRejectedValueOnce(new Error('engine api down'));
    insertAdvisory(store);
    const picked = 'A picked content prompt.';
    const result = await runStop(makePayload(), store, mockSelect(picked));
    expect(result.outcome).toBe('blocked'); // caught → fallback → session ran → user picked
    if (result.outcome === 'blocked') expect(result.reason).toBe(picked);
  });

  it('when the grounded engine throws, the DETERMINISTIC engine fallback is invoked (B11 iii — no static content)', async () => {
    // The engine path throws; stop.ts must fall to composeDeterministicOptions (no LLM, from the record)
    // BEFORE any static generate path — so an engine/key failure serves valid content without static content.
    vi.mocked(generateFromEngine).mockRejectedValueOnce(new Error('engine api down'));
    vi.mocked(composeDeterministicOptions).mockClear();
    insertAdvisory(store);
    const result = await runStop(makePayload(), store, mockSelect(SKIP_NOW));
    expect(composeDeterministicOptions).toHaveBeenCalled();
    expect(result.outcome).toBe('skipped');
  });
});

// ── runStop — context_loss role-through-engine serving (B11: B6 guard removed) ────

describe('runStop — context_loss role-through-engine serving (B11)', () => {
  let store: Store;
  beforeEach(async () => { store = await openStore(':memory:'); });
  afterEach(() => { store.db.close(); vi.restoreAllMocks(); });

  function seedProfile(role: string | null, flagType = 'absence:context_loss') {
    const mgr = SessionStateManager.load(store, '/test/project');
    mgr.setProfile({
      nature: 'hardcore_pro', mood: 'focused', depth: 'high', role,
      precisionOrdinal: 'high', playfulnessOrdinal: 'low',
      precisionScore: 8, playfulnessScore: 2, depthScore: 8, computedAt: 0,
    } as unknown as import('../../classifier/types.js').UserProfile);
    mgr.setDetectedLanguage(store, undefined); // persists state incl. the profile
    upsertPendingAdvisory(store, {
      projectRoot: '/test/project', stage: 'implementation', flagType,
      pinchLabel: 'Hold up.', sessionId: mgr.current.sessionId, promptCount: 5,
    });
  }

  it('a founder user gets the ENGINE for context_loss, with the role threaded (roleOverrides serve the founder variant)', async () => {
    // B11: the role-tailored content is now engine-served via roleOverrides — the old B6 static
    // guard is gone. The founder role must reach generateFromEngine so the resolver picks its variant.
    seedProfile('founder');
    vi.mocked(generateFromEngine).mockClear();
    const result = await runStop(makePayload(), store, mockSelect(SKIP_NOW));
    expect(generateFromEngine).toHaveBeenCalled();
    expect(vi.mocked(generateFromEngine).mock.calls[0][0]).toMatchObject({ role: 'founder' });
    expect(result.outcome).toBe('skipped');
  });

  it('a non-role user gets the ENGINE for context_loss (no role threaded)', async () => {
    seedProfile(null);
    vi.mocked(generateFromEngine).mockClear();
    const result = await runStop(makePayload(), store, mockSelect(SKIP_NOW));
    expect(generateFromEngine).toHaveBeenCalled();
    expect(vi.mocked(generateFromEngine).mock.calls[0][0]).toMatchObject({ role: undefined });
    expect(result.outcome).toBe('skipped');
  });

  it('a pm user on a register-varied signal (decision_fatigue) also gets the ENGINE, role threaded', async () => {
    // decision_fatigue_pattern is register-varied (a PM _FORMAL variant, not role-tailored content);
    // it has no roleOverrides, so the resolver falls through to register/base — but the engine path
    // (and the role thread) is the same for every migrated signal now.
    seedProfile('pm', 'absence:decision_fatigue_pattern');
    vi.mocked(generateFromEngine).mockClear();
    const result = await runStop(makePayload(), store, mockSelect(SKIP_NOW));
    expect(generateFromEngine).toHaveBeenCalled();
    expect(vi.mocked(generateFromEngine).mock.calls[0][0]).toMatchObject({ role: 'pm' });
    expect(result.outcome).toBe('skipped');
  });
});

// ── runStop — B2 stage-transition engine dispatch ────────────────────────────

describe('runStop — B2 stage-transition engine dispatch', () => {
  let store: Store;
  beforeEach(async () => { store = await openStore(':memory:'); });
  afterEach(() => { store.db.close(); vi.restoreAllMocks(); });

  function seedTransition(stage: string) {
    const mgr = SessionStateManager.load(store, '/test/project');
    mgr.setDetectedLanguage(store, undefined); // persist session so runStop finds same UUID
    upsertPendingAdvisory(store, {
      projectRoot: '/test/project', stage: stage as import('../../classifier/types.js').Stage,
      flagType: 'stage_transition', pinchLabel: 'Hold up.', sessionId: mgr.current.sessionId, promptCount: 5,
    });
  }

  it('a stage_transition routes to the ENGINE — record signalType derived from the resolved content (IDEA_TO_PRD)', async () => {
    // stage=prd → the engine serves IDEA_TO_PRD; the dispatch derives the record from the
    // transition's signalType (stage transitions carry no absence: key).
    seedTransition('prd');
    vi.mocked(generateFromEngine).mockClear();
    const result = await runStop(makePayload(), store, mockSelect(SKIP_NOW));
    expect(generateFromEngine).toHaveBeenCalled();
    expect(result.outcome).toBe('skipped');
  });

  it('a transition with no destination-stage content resolves the TASK_REVIEW fallback record → ENGINE', async () => {
    // stage=implementation has no TRANSITION_CONTENT entry → the TASK_REVIEW fallback (migrated) —
    // still engine-served because its signalType is in MIGRATED_SIGNALS.
    seedTransition('implementation');
    vi.mocked(generateFromEngine).mockClear();
    const result = await runStop(makePayload(), store, mockSelect(SKIP_NOW));
    expect(generateFromEngine).toHaveBeenCalled();
    expect(result.outcome).toBe('skipped');
  });
});

// ── runStop — B9 class-8 role-cluster engine dispatch ────────────────────────

describe('runStop — B9 class-8 role-cluster engine dispatch', () => {
  let store: Store;
  beforeEach(async () => { store = await openStore(':memory:'); });
  afterEach(() => { store.db.close(); vi.restoreAllMocks(); });

  function seedRole(role: string, flagType: string) {
    const mgr = SessionStateManager.load(store, '/test/project');
    mgr.setProfile({
      nature: 'hardcore_pro', mood: 'focused', depth: 'high', role,
      precisionOrdinal: 'high', playfulnessOrdinal: 'low',
      precisionScore: 8, playfulnessScore: 2, depthScore: 8, computedAt: 0,
    } as unknown as import('../../classifier/types.js').UserProfile);
    mgr.setDetectedLanguage(store, undefined);
    upsertPendingAdvisory(store, {
      projectRoot: '/test/project', stage: 'implementation',
      flagType: flagType as import('../../classifier/Stage2Trigger.js').FlagType,
      pinchLabel: 'Hold up.', sessionId: mgr.current.sessionId, promptCount: 5,
    });
  }

  it('a class-8 role-cluster signal routes to the ENGINE for a founder (single-register content → NOT kept static like context_loss)', async () => {
    seedRole('founder', 'absence:user_value_check');
    vi.mocked(generateFromEngine).mockClear();
    const result = await runStop(makePayload(), store, mockSelect(SKIP_NOW));
    expect(generateFromEngine).toHaveBeenCalled();
    expect(result.outcome).toBe('skipped');
  });

  it('a sensitive class-8 signal (stakeholder sign-off) routes to the ENGINE for a pm', async () => {
    seedRole('pm', 'absence:stakeholder_alignment_check');
    vi.mocked(generateFromEngine).mockClear();
    const result = await runStop(makePayload(), store, mockSelect(SKIP_NOW));
    expect(generateFromEngine).toHaveBeenCalled();
    expect(result.outcome).toBe('skipped');
  });
});

// ── runStop — NEXPATH_SIM=1 TTY bypass ───────────────────────────────────────

describe('runStop — NEXPATH_SIM=1 TTY bypass', () => {
  let store: Store;

  beforeEach(async () => {
    store = await openStore(':memory:');
    process.env['NEXPATH_SIM'] = '1';
  });
  afterEach(() => {
    store.db.close();
    delete process.env['NEXPATH_SIM'];
    vi.restoreAllMocks();
  });

  it('reaches runDecisionSession without a selectFn when NEXPATH_SIM=1 and advisory is pending', async () => {
    insertAdvisory(store);
    // No selectFn passed — sim bypass must supply one internally
    // NEXPATH_SIM=1 means runLevel auto-selects; result is 'blocked' or 'skipped'
    const result = await runStop(makePayload(), store);
    expect(['blocked', 'skipped']).toContain(result.outcome);
  });

  it('returns no_pending without reaching TTY resolution when no advisory queued', async () => {
    const result = await runStop(makePayload(), store);
    expect(result.outcome).toBe('no_pending');
  });
});

// ── runStop — telemetry events ────────────────────────────────────────────────

describe('runStop — telemetry events', () => {
  let store: Store;

  beforeEach(async () => {
    store = await openStore(':memory:');
    vi.mocked(writeTelemetry).mockClear();
    vi.mocked(generateOptionList).mockClear();
    vi.mocked(recentPromptMetadata).mockClear();
  });
  afterEach(() => {
    store.db.close();
    vi.restoreAllMocks();
  });

  it('emits stop_no_pending when no advisory is queued', async () => {
    await runStop(makePayload(), store);
    expect(writeTelemetry).toHaveBeenCalledWith('/test/project', 'stop_no_pending', undefined, expect.anything());
  });

  it('does not emit stop_no_pending when an advisory is present', async () => {
    insertAdvisory(store);
    await runStop(makePayload(), store, mockSelect(SKIP_NOW));
    const calls = vi.mocked(writeTelemetry).mock.calls;
    expect(calls.some(([, evt]) => evt === 'stop_no_pending')).toBe(false);
  });

  it('emits stop_advisory_shown with flagType, stage, generatedOptions before decision session', async () => {
    insertAdvisory(store);
    await runStop(makePayload(), store, mockSelect(SKIP_NOW));
    expect(writeTelemetry).toHaveBeenCalledWith(
      '/test/project',
      'stop_advisory_shown',
      expect.objectContaining({
        flagType:         'absence:test_creation',
        stage:            'implementation',
        generatedOptions: false,
      }),
      expect.anything(),
    );
  });

  it('emits stop_advisory_shown with generatedOptions:true when option gen succeeds', async () => {
    vi.mocked(generateFromEngine).mockResolvedValueOnce({
      l1: ['opt a'], l2: ['opt b'], l3: ['opt c'],
    });
    insertAdvisory(store);
    await runStop(makePayload(), store, mockSelect(SKIP_NOW));
    expect(writeTelemetry).toHaveBeenCalledWith(
      '/test/project',
      'stop_advisory_shown',
      expect.objectContaining({ generatedOptions: true }),
      expect.anything(),
    );
  });

  it('emits language_detected when >= LANG_DETECT_INTERVAL prompts exist', async () => {
    upsertProject(store, { projectRoot: '/test/project', name: 'Test' });
    const englishPrompt = 'I want to add a login page so users can reset their password and access settings';
    for (let i = 0; i < LANG_DETECT_INTERVAL; i++) {
      insertPrompt(store, { projectRoot: '/test/project', promptText: englishPrompt });
    }
    await runStop(makePayload(), store);
    expect(writeTelemetry).toHaveBeenCalledWith(
      '/test/project',
      'language_detected',
      expect.objectContaining({ detectedLanguage: expect.anything() }),
      expect.anything(),
    );
  });

  it('does not emit language_detected when below LANG_DETECT_INTERVAL prompts', async () => {
    upsertProject(store, { projectRoot: '/test/project', name: 'Test' });
    for (let i = 0; i < LANG_DETECT_INTERVAL - 1; i++) {
      insertPrompt(store, { projectRoot: '/test/project', promptText: 'Add a feature' });
    }
    await runStop(makePayload(), store);
    const calls = vi.mocked(writeTelemetry).mock.calls;
    expect(calls.some(([, evt]) => evt === 'language_detected')).toBe(false);
  });

  // ── Phase 4 — stop.ts plumbs recentPrompts into runDecisionSession input ────

  it('decision_session_started carries recentPrompts populated from session state', async () => {
    // Sentinel return — if stop.ts drops the `recentPrompts` line in its
    // runDecisionSession input, the helper is never called and/or the
    // payload defaults to []. Either way, this assertion fails.
    const sentinel = [
      { index: 99, classifiedStage: 'planning' as const, confidence: 0.5, capturedAt: 100 },
    ];
    vi.mocked(recentPromptMetadata).mockReturnValueOnce(sentinel);

    insertAdvisory(store);
    await runStop(makePayload(), store, mockSelect(SKIP_NOW));

    expect(recentPromptMetadata).toHaveBeenCalledTimes(1);
    expect(writeTelemetry).toHaveBeenCalledWith(
      '/test/project',
      'decision_session_started',
      expect.objectContaining({ recentPrompts: sentinel }),
      expect.anything(),
    );
  });
});
