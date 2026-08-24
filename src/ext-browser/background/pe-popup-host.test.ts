/**
 * PB4 — browser PE popup host, tested against the REAL engine state machine.
 *
 * `runBrowserPePopup` here runs the actual `runPromptEnhancementCliSubmitPopupV1`
 * over a REAL keyless prepare result (deterministic path, offline), with a fake
 * tab that scripts panel commands — so view projection, the command mailbox,
 * the synthesized edit_body, F2 smooth send and the terminal outcomes are all
 * proven against the engine's own popup logic, not a mock of it.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { LogPort } from '../../core/ports/log.port.js';
import type { PendingPeRecord } from '../adapters/pe-pending-store.js';
import { buildBrowserPeRequest, prepareBrowserPe, type BrowserPeContext } from './pe-prepare.js';
import {
  buildPePanelView,
  deliverPePanelCommand,
  isPePopupOpen,
  runBrowserPePopup,
} from './pe-popup-host.js';
import type { PePanelCommandV1, PePanelViewV1 } from '../ui/pe-contract.js';

function makeLog(): { log: LogPort; events: Array<[string, Record<string, unknown> | undefined]> } {
  const events: Array<[string, Record<string, unknown> | undefined]> = [];
  const push = (key: string, data?: Record<string, unknown>) => { events.push([key, data]); };
  return { log: { debug: push, info: push, warn: push }, events };
}

const ROOT = 'https://bolt.new/~/sb1-pe-popup-test';

let record: PendingPeRecord;

beforeAll(async () => {
  const ctx: BrowserPeContext = {
    projectRoot: ROOT,
    promptText: 'add a login page with email and password to the app',
    sessionId: 'sess-popup-1',
    promptCount: 6,
    currentStage: 'implementation',
    prevStage: 'implementation',
    triggerKind: 'absence',
    effectiveFlagType: 'absence:tests_before_merge',
    firedKey: 'absence:tests_before_merge@implementation',
    triggerConfidence: 0.9,
    classifierState: 'fire_recommended',
    profile: null,
    configuredRole: 'founder',
    detectedLanguage: undefined,
    streamBOutputs: [],
    triggerEligibility: 'fresh_trigger_eligible',
    recentPromptRefs: ['prompt:3', 'prompt:4', 'prompt:5'],
  };
  const request = buildBrowserPeRequest(ctx);
  const prep = await prepareBrowserPe(request);
  if (prep.safeFallback) throw new Error('fixture prepare fell back — engine drift');
  record = {
    sessionId: 'sess-popup-1',
    promptCount: 6,
    status: 'pending',
    createdAt: 1000,
    request,
    result: prep.result,
  };
});

/**
 * A scripted tab: acks every show-pe render and answers each rendered view by
 * delivering the next command from the script (as the content script would).
 */
function scriptedTab(log: LogPort, commands: Array<(view: PePanelViewV1) => PePanelCommandV1 | null>): {
  sendToTab: (msg: unknown) => Promise<unknown>;
  views: PePanelViewV1[];
  sent: unknown[];
} {
  const views: PePanelViewV1[] = [];
  const sent: unknown[] = [];
  let step = 0;
  const sendToTab = async (msg: unknown): Promise<unknown> => {
    sent.push(msg);
    const m = msg as { type?: string; payload?: PePanelViewV1 };
    if (m.type !== 'nexpath:show-pe' || !m.payload) return { ok: true };
    const view = m.payload;
    views.push(view);
    const script = commands[step];
    if (script) {
      const command = script(view);
      step += 1;
      if (command) {
        // Deliver on the next tick — the loop must have registered its waiter.
        setTimeout(() => { deliverPePanelCommand(log, ROOT, view.viewSeq, command); }, 0);
      }
    }
    return { rendered: true };
  };
  return { sendToTab, views, sent };
}

describe('runBrowserPePopup — the engine loop over the panel bridge', () => {
  it('renders the locked view shape and Use-enhanced (unedited) resolves selected_current with the engine body (F2 smooth send)', async () => {
    const { log } = makeLog();
    const onFirstRendered = vi.fn().mockResolvedValue(undefined);
    const { sendToTab, views } = scriptedTab(log, [
      (view) => ({ type: 'use_current', bodyText: view.bodyText }),
    ]);
    const { result: outcome, mpsFirstPopupSent } = await runBrowserPePopup({ log, projectRoot: ROOT, apiKey: null, record, sendToTab, onFirstRendered });

    expect(mpsFirstPopupSent).toBe(false);
    expect(outcome.state).toBe('selected_current');
    if (outcome.state !== 'selected_current') return;
    expect(outcome.bodyText.length).toBeGreaterThan(100);

    expect(onFirstRendered).toHaveBeenCalledTimes(1);
    expect(views.length).toBeGreaterThanOrEqual(1);
    const v = views[0]!;
    expect(v.title).toBe('Nexpath · Prompt enhancement');
    expect(v.editorHeading).toBe('Use enhanced prompt');
    expect(v.bodyText).toBe(outcome.bodyText);
    expect(v.bodyEditable).toBe(true);
    expect(v.viewSeq).toBe(1);
    // The engine's directional adjust row survives the whitelist projection.
    expect(v.directional.map((d) => d.actionType)).toEqual(
      expect.arrayContaining(['shorter', 'more_thorough', 'more_project_grounded']),
    );
    expect(isPePopupOpen(ROOT)).toBe(false); // mailbox torn down
  });

  it('an EDITED body goes through the engine edit path and comes back as the selected text', async () => {
    const { log } = makeLog();
    const edited = 'add a login page with email and password to the app, and write unit tests for the auth flow first';
    const { sendToTab } = scriptedTab(log, [
      (view) => ({ type: 'use_current', bodyText: `${view.bodyText}\n\nExtra constraint: ${edited}` }),
    ]);
    const { result: outcome } = await runBrowserPePopup({
      log, projectRoot: ROOT, apiKey: null, record, sendToTab,
      onFirstRendered: vi.fn().mockResolvedValue(undefined),
    });
    expect(outcome.state).toBe('selected_current');
    if (outcome.state !== 'selected_current') return;
    expect(outcome.bodyText).toContain('Extra constraint:');
  });

  it('Use-original resolves selected_original; close resolves closed_no_send; the panel is told to close', async () => {
    for (const [command, expected] of [
      [{ type: 'use_original' }, 'selected_original'],
      [{ type: 'close' }, 'closed_no_send'],
    ] as const) {
      const { log } = makeLog();
      const { sendToTab, sent } = scriptedTab(log, [() => ({ ...command })]);
      const { result: outcome } = await runBrowserPePopup({
        log, projectRoot: ROOT, apiKey: null, record, sendToTab,
        onFirstRendered: vi.fn().mockResolvedValue(undefined),
      });
      expect(outcome.state).toBe(expected);
      expect(sent.some((m) => (m as { type?: string }).type === 'nexpath:pe-close')).toBe(true);
    }
  });

  it('an unreachable panel on the FIRST render resolves not_shown and never marks first-rendered', async () => {
    const { log } = makeLog();
    const onFirstRendered = vi.fn();
    const { result: outcome } = await runBrowserPePopup({
      log, projectRoot: ROOT, apiKey: null, record,
      sendToTab: () => Promise.reject(new Error('no receiving end')),
      onFirstRendered,
    });
    expect(outcome).toMatchObject({ state: 'not_shown' });
    expect(onFirstRendered).not.toHaveBeenCalled();
    expect(isPePopupOpen(ROOT)).toBe(false);
  });

  it('a second popup for the same root while one is open resolves not_shown (double-open guard)', async () => {
    const { log } = makeLog();
    let releaseFirst: ((cmd: PePanelCommandV1) => void) | null = null;
    const holdTab = async (msg: unknown): Promise<unknown> => {
      const m = msg as { type?: string; payload?: PePanelViewV1 };
      if (m.type === 'nexpath:show-pe' && m.payload && !releaseFirst) {
        const seq = m.payload.viewSeq;
        releaseFirst = (cmd) => { deliverPePanelCommand(log, ROOT, seq, cmd); };
      }
      return { ok: true };
    };
    const first = runBrowserPePopup({
      log, projectRoot: ROOT, apiKey: null, record, sendToTab: holdTab,
      onFirstRendered: vi.fn().mockResolvedValue(undefined),
    });
    await vi.waitFor(() => expect(isPePopupOpen(ROOT)).toBe(true));
    const second = await runBrowserPePopup({
      log, projectRoot: ROOT, apiKey: null, record, sendToTab: holdTab,
      onFirstRendered: vi.fn(),
    });
    expect(second.result).toMatchObject({ state: 'not_shown', reasonCodes: ['popup_already_open'] });
    releaseFirst!({ type: 'close' });
    await expect(first).resolves.toMatchObject({ result: { state: 'closed_no_send' } });
  });
});

describe('deliverPePanelCommand — mailbox discipline', () => {
  it('rejects commands with no live popup, an invalid shape, or a stale viewSeq', async () => {
    const { log, events } = makeLog();
    expect(deliverPePanelCommand(log, ROOT, 1, { type: 'close' })).toBe(false);
    expect(events.map(([k]) => k)).toContain('pe_command_no_popup');

    let liveSeq = 0;
    const tab = async (msg: unknown): Promise<unknown> => {
      const m = msg as { type?: string; payload?: PePanelViewV1 };
      if (m.type === 'nexpath:show-pe' && m.payload) {
        liveSeq = m.payload.viewSeq;
        setTimeout(() => {
          // Invalid shape and a stale seq are both dropped; the correct one lands.
          expect(deliverPePanelCommand(log, ROOT, liveSeq, { type: 'launch_missiles' })).toBe(false);
          expect(deliverPePanelCommand(log, ROOT, liveSeq + 7, { type: 'close' })).toBe(false);
          expect(deliverPePanelCommand(log, ROOT, liveSeq, { type: 'close' })).toBe(true);
        }, 0);
      }
      return { ok: true };
    };
    const { result: outcome } = await runBrowserPePopup({
      log, projectRoot: ROOT, apiKey: null, record, sendToTab: tab,
      onFirstRendered: vi.fn().mockResolvedValue(undefined),
    });
    expect(outcome.state).toBe('closed_no_send');
    const names = events.map(([k]) => k);
    expect(names).toContain('pe_command_invalid');
    expect(names).toContain('pe_command_stale');
  });
});

describe('buildPePanelView — whitelist projection', () => {
  it('never leaks engine internals (session, identity ids, validation graphs) into the panel payload', async () => {
    const { log } = makeLog();
    const { sendToTab, views } = scriptedTab(log, [() => ({ type: 'close' })]);
    await runBrowserPePopup({
      log, projectRoot: ROOT, apiKey: null, record, sendToTab,
      onFirstRendered: vi.fn().mockResolvedValue(undefined),
    });
    const v = views[0]! as unknown as Record<string, unknown>;
    for (const forbidden of ['session', 'identity', 'validationGraph', 'controls', 'model', 'request', 'result']) {
      expect(v[forbidden], `panel view must not carry "${forbidden}"`).toBeUndefined();
    }
    const json = JSON.stringify(v);
    expect(json).not.toContain('validationDecisionId');
    expect(json).not.toContain(record.result.enhancementId);
  });
});

// ── PB6: MPS-1 sequence offer ─────────────────────────────────────────────────
import { buildPromptEnhancementHandoffMetadataV1 } from '../../prompt-enhancement/handoff-metadata.js';
import {
  buildPromptEnhancementCliMpsIntakeEvidenceV1,
  evaluatePromptEnhancementMpsIntakeDecisionV1,
} from './pe-engine.js';
import { buildBrowserMpsOffer, buildPeSequenceOfferView } from './pe-popup-host.js';
import type { PeSequenceOfferViewV1 } from '../ui/pe-contract.js';

/** The PE fixture result with an engine-built sequence handoff grafted in —
 * the same construction the engine's own first-popup tests use. */
function sequenceRecord(): PendingPeRecord {
  const result = structuredClone(record.result);
  const handoff = buildPromptEnhancementHandoffMetadataV1({
    handoffDecisionId: `${result.enhancementId}:mps-handoff`,
    requestId: result.requestId,
    projectRoot: result.projectRoot,
    currentBody: result.currentBody,
    safetySummary: result.safetySummary,
    handoffKind: 'first_prompt_handoff_candidate',
    summary: {
      summaryId: `${result.enhancementId}:mps-summary`,
      publicSafeText: 'Two remaining setup tasks are available as metadata.',
      remainingTaskCount: 2,
      taskRoleLabels: ['database', 'deploy'],
    },
  });
  result.uiView = { ...result.uiView, handoffAndSequenceSummary: handoff };
  return { ...record, result };
}

describe('MPS-1 sequence offer (PB6 — popup-host order: offer first, PE after Esc)', () => {
  it('renders the offer view first; Send resolves selected_current with the sent text + the sequence identity', async () => {
    const { log } = makeLog();
    const rec = sequenceRecord();
    const { sendToTab, views } = scriptedTab(log, [
      (view) => {
        const offer = view as unknown as PeSequenceOfferViewV1;
        expect(offer.kind).toBe('sequence_offer');
        expect(offer.title).toBe('Nexpath · Multi-prompt sequence');
        expect(offer.remainingTaskCount).toBe(2);
        expect(offer.cancelLabel).toBe('Use original prompt');
        return { type: 'mps_send', bodyText: `${offer.bodyText} — edited before send` } as never;
      },
    ]);
    const outcome = await runBrowserPePopup({
      log, projectRoot: ROOT, apiKey: null, record: rec, sendToTab,
      onFirstRendered: vi.fn().mockResolvedValue(undefined),
    });
    expect(outcome.mpsFirstPopupSent).toBe(true);
    expect(outcome.result.state).toBe('selected_current');
    if (outcome.result.state !== 'selected_current') return;
    expect(outcome.result.bodyText).toContain('— edited before send');
    expect(outcome.mpsIdentity).toMatchObject({
      requestId: rec.result.requestId,
      currentBodyId: rec.result.currentBody.currentBodyId,
      bodyRevision: rec.result.currentBody.bodyRevision,
      remainingTaskCount: 2,
    });
    expect(views).toHaveLength(1); // the PE popup never opened
  });

  it('Esc (decline) falls through to the regular PE popup (CLI keyboard map)', async () => {
    const { log, events } = makeLog();
    const { sendToTab, views } = scriptedTab(log, [
      () => ({ type: 'mps_decline' }) as never,
      (view) => ({ type: 'use_original' }),
    ]);
    const outcome = await runBrowserPePopup({
      log, projectRoot: ROOT, apiKey: null, record: sequenceRecord(), sendToTab,
      onFirstRendered: vi.fn().mockResolvedValue(undefined),
    });
    expect(outcome.mpsFirstPopupSent).toBe(false);
    expect(outcome.result.state).toBe('selected_original');
    expect(views).toHaveLength(2);
    expect((views[0] as unknown as PeSequenceOfferViewV1).kind).toBe('sequence_offer');
    expect((views[1] as unknown as Record<string, unknown>)['kind']).toBeUndefined(); // the PE view
    expect(events.map(([, d]) => d?.['kind'])).toContain('mps_decline');
  });

  it('Cancel ENDS the flow — the PE popup never opens after a cancel (owner request 2026-08-06)', async () => {
    const { log, events } = makeLog();
    const { sendToTab, views } = scriptedTab(log, [
      () => ({ type: 'mps_cancel' }) as never,
    ]);
    const outcome = await runBrowserPePopup({
      log, projectRoot: ROOT, apiKey: null, record: sequenceRecord(), sendToTab,
      onFirstRendered: vi.fn().mockResolvedValue(undefined),
    });
    expect(outcome.mpsFirstPopupSent).toBe(false);
    expect(outcome.result.state).toBe('closed_no_send');
    expect(views).toHaveLength(1);
    expect(events.map(([, d]) => d?.['kind'])).toContain('mps_cancel');
  });

  it('a result with NO sequence handoff renders no offer (straight to the PE popup)', async () => {
    const { log } = makeLog();
    expect(buildBrowserMpsOffer(log, ROOT, record.result)).toBeNull();
  });

  it('FAIL-CLOSED pin: the extension_host surface stays blocked without the host_runtime evidence', () => {
    const rec = sequenceRecord();
    const cliEvidence = buildPromptEnhancementCliMpsIntakeEvidenceV1(rec.result);
    expect(cliEvidence).toBeDefined();
    const gate = evaluatePromptEnhancementMpsIntakeDecisionV1({
      surface: 'extension_host',
      evidence: cliEvidence ? [...cliEvidence] : undefined, // NO host_runtime row
    });
    expect(gate.renderPermission).toBe('mps_blocked_fail_closed');
    expect(gate.reasonCodes.join(',')).toContain('host_runtime');
  });

  it('the offer view is a whitelisted projection — no identity ids leak to the page', () => {
    const { log } = makeLog();
    const rec = sequenceRecord();
    const model = buildBrowserMpsOffer(log, ROOT, rec.result);
    expect(model).not.toBeNull();
    const view = buildPeSequenceOfferView(model!, 1);
    const json = JSON.stringify(view);
    expect(json).not.toContain(rec.result.currentBody.currentBodyId);
    expect(json).not.toContain(rec.result.requestId);
    expect(json).not.toContain('handoffDecisionId');
  });
});

describe('feedback v1 signal interception (PB5)', () => {
  it('feedback_suggested is logged as a content-free signal and does NOT enter the engine loop', async () => {
    const { log, events } = makeLog();
    let seq = 0;
    const tab = async (msg: unknown): Promise<unknown> => {
      const m = msg as { type?: string; payload?: PePanelViewV1 };
      if (m.type === 'nexpath:show-pe' && m.payload) {
        seq = m.payload.viewSeq;
        setTimeout(() => {
          // First a feedback command (must be consumed host-side, loop keeps
          // waiting on the SAME view), then the terminal close.
          deliverPePanelCommand(log, ROOT, seq, { type: 'feedback_suggested', category: 'not_relevant_enough' });
          setTimeout(() => { deliverPePanelCommand(log, ROOT, seq, { type: 'close' }); }, 0);
        }, 0);
      }
      return { ok: true };
    };
    const { result } = await runBrowserPePopup({
      log, projectRoot: ROOT, apiKey: null, record, sendToTab: tab,
      onFirstRendered: vi.fn().mockResolvedValue(undefined),
    });
    expect(result.state).toBe('closed_no_send');
    const signal = events.find(([k, d]) => k === 'pe_action_signal' && d?.['kind'] === 'pe_feedback_suggested');
    expect(signal?.[1]).toMatchObject({ category: 'not_relevant_enough' });
    // Only ONE view was ever rendered — the feedback never caused an engine round-trip.
  });
});

describe('PB2 storage-quota sanity — realistic pending-PE payload size', () => {
  it('a real prepared record serializes well under the storage.local budget', () => {
    const serialized = JSON.stringify({
      sessionId: record.sessionId, promptCount: record.promptCount, status: 'pending',
      createdAt: record.createdAt, request: record.request, result: record.result,
    });
    const bytes = new TextEncoder().encode(serialized).length;
    // Realistic engine result today ≈ tens of KB. chrome.storage.local default
    // quota is 10 MB total; flag loudly (fail) if a contract change ever pushes
    // one row past 1 MB — the IDB fallback lever gets pulled then, not silently.
    expect(bytes).toBeGreaterThan(5_000);
    expect(bytes).toBeLessThan(1_000_000);
  });
});
