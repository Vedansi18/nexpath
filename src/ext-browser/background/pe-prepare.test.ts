/**
 * PB3 — browser PE preparation seam, tested against the REAL engine.
 *
 * Every prepare here runs the actual `src/prompt-enhancement` facade offline
 * (keyless = the engine's own deterministic path; no network, no key). The
 * only mocked engine entry is `preparePromptEnhancement`, and only via a
 * passthrough that individual tests can override to force the facade-error /
 * invalid-result branches — everything else is the shipped chain, so these
 * tests break if the browser request builder drifts from what the engine's
 * validators accept (the exact failure PB3 exists to prevent).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const { engineOverride } = vi.hoisted(() => ({
  engineOverride: { prepare: undefined as undefined | (() => unknown) },
}));
vi.mock('./pe-engine.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./pe-engine.js')>();
  return {
    ...actual,
    preparePromptEnhancement: (req: unknown) =>
      engineOverride.prepare
        ? engineOverride.prepare()
        : actual.preparePromptEnhancement(req as never),
  };
});

import type { LogPort } from '../../core/ports/log.port.js';
import { SIGNAL_MAP } from '../../core/classifier/signals.js';
import {
  applyPromptEnhancementAction,
  isPromptEnhancementSequenceShapedTextV1,
  refreshEngineKeyEnv,
  validatePromptEnhancementPrepareRequestV1,
} from './pe-engine.js';
import {
  buildBrowserPeRequest,
  prepareAndStoreBrowserPe,
  prepareBrowserPe,
  type BrowserPeContext,
} from './pe-prepare.js';

afterEach(() => {
  engineOverride.prepare = undefined;
  vi.unstubAllGlobals();
});

function makeLog(): { log: LogPort; events: Array<[string, Record<string, unknown> | undefined]> } {
  const events: Array<[string, Record<string, unknown> | undefined]> = [];
  const push = (key: string, data?: Record<string, unknown>) => { events.push([key, data]); };
  return { log: { debug: push, info: push, warn: push }, events };
}

const eventNames = (events: Array<[string, unknown]>) => events.map(([k]) => k);

/** A fire-path context mirroring what runPromptSubmitPipeline assembles. */
function fireCtx(overrides: Partial<BrowserPeContext> = {}): BrowserPeContext {
  return {
    projectRoot: 'https://bolt.new/~/sb1-pe-test',
    promptText: 'add a login page with email and password to the app',
    sessionId: 'sess-pe-1',
    promptCount: 5,
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
    recentPromptRefs: ['prompt:2', 'prompt:3', 'prompt:4'],
    ...overrides,
  };
}

const SEQUENCE_PROMPT =
  'first build the login page, then add a database, then deploy the whole thing to production';

describe('buildBrowserPeRequest — validator round-trip (real engine validators)', () => {
  const shapes: Array<[string, BrowserPeContext]> = [
    ['fire/stage_transition', fireCtx({
      triggerKind: 'stage_transition',
      effectiveFlagType: 'stage_transition',
      firedKey: 'stage_transition:implementation→release',
      currentStage: 'release',
      prevStage: 'implementation',
    })],
    ['fire/absence', fireCtx()],
    ['fallback/sequence-shaped', fireCtx({
      promptText: SEQUENCE_PROMPT,
      classifierState: 'not_applicable',
      triggerEligibility: 'blocked_by_dedup',
    })],
  ];
  for (const [name, ctx] of shapes) {
    it(`${name} produces a request the engine's own validator accepts`, () => {
      const v = validatePromptEnhancementPrepareRequestV1(buildBrowserPeRequest(ctx));
      expect(v.ok, `reasons: ${v.ok ? '' : v.reasonCodes.join(', ')}`).toBe(true);
    });
  }

  it('the extension host surface + store-less honesty survive into the request', () => {
    const req = buildBrowserPeRequest(fireCtx());
    const json = JSON.stringify(req);
    expect(json).toContain('extension_bridge');
    // The browser has no CLI DB — the request must declare PE tables missing,
    // never presume the store-backed snapshot's defaults.
    expect(JSON.stringify(req).includes('"missingPromptEnhancementTables":[]')).toBe(false);
  });
});

describe('prepareBrowserPe — boundary wrapper (fail-open contract)', () => {
  it('a task-shaped prompt reaches a real show disposition keyless (deterministic path)', async () => {
    const prep = await prepareBrowserPe(buildBrowserPeRequest(fireCtx()));
    expect(prep.safeFallback).toBe(false);
    if (prep.safeFallback) return;
    expect(prep.disposition).toBe('show_current_body');
    expect(prep.result.uiView.body.sendPolicy).toBe('send_current');
    expect(prep.result.uiView.body.text.length).toBeGreaterThan(100);
  });

  it('a corrupted request is reduced to safeFallback invalid_request with reason codes', async () => {
    const req = buildBrowserPeRequest(fireCtx());
    (req as { schemaVersion: unknown }).schemaVersion = 999;
    const prep = await prepareBrowserPe(req);
    expect(prep.safeFallback).toBe(true);
    if (!prep.safeFallback) return;
    expect(prep.reasonCode).toBe('invalid_request');
    expect(prep.validationReasonCodes?.length ?? 0).toBeGreaterThan(0);
  });

  it('a facade throw is reduced to safeFallback facade_error (never propagates)', async () => {
    engineOverride.prepare = () => { throw new Error('boom'); };
    const prep = await prepareBrowserPe(buildBrowserPeRequest(fireCtx()));
    expect(prep).toMatchObject({ safeFallback: true, reasonCode: 'facade_error' });
  });

  it('a result failing the result validator is reduced to safeFallback invalid_result', async () => {
    engineOverride.prepare = () => ({ garbage: true });
    const prep = await prepareBrowserPe(buildBrowserPeRequest(fireCtx()));
    expect(prep).toMatchObject({ safeFallback: true, reasonCode: 'invalid_result' });
  });
});

describe('prepareAndStoreBrowserPe — park-without-showing (owner decision B-i)', () => {
  it('show disposition → row parked with session identity + validated request/result', async () => {
    const { log, events } = makeLog();
    const upsert = vi.fn().mockResolvedValue(undefined);
    const ctx = fireCtx();
    const prep = await prepareAndStoreBrowserPe(log, null, ctx, upsert);
    expect(prep.safeFallback).toBe(false);
    expect(upsert).toHaveBeenCalledTimes(1);
    const [root, record] = upsert.mock.calls[0] as [string, {
      sessionId: string; promptCount: number; request: unknown; result: { disposition: string };
    }];
    expect(root).toBe(ctx.projectRoot);
    expect(record.sessionId).toBe('sess-pe-1');
    expect(record.promptCount).toBe(5);
    expect(validatePromptEnhancementPrepareRequestV1(record.request as never).ok).toBe(true);
    expect(record.result.disposition).toBe('show_current_body');
    expect(eventNames(events)).toEqual(
      expect.arrayContaining(['pe_prepare_boundary', 'pe_pending_stored']),
    );
  });

  it('no_popup display decision is NEVER stored (blink defense) and is logged as skipped', async () => {
    const { log, events } = makeLog();
    const upsert = vi.fn().mockResolvedValue(undefined);
    // Routes deterministically to no_popup (cosmetic micro-tweak, no primary intent).
    const ctx = fireCtx({ promptText: 'make the header bold and change the theme color to dark blue' });
    const prep = await prepareAndStoreBrowserPe(log, null, ctx, upsert);
    expect(prep.safeFallback).toBe(false);
    expect(prep.disposition).toBe('no_popup_not_applicable');
    expect(upsert).not.toHaveBeenCalled();
    expect(eventNames(events)).toContain('pe_prepare_skipped_no_popup');
    expect(eventNames(events)).not.toContain('pe_pending_stored');
  });

  it('a store write failure is swallowed and logged — the submit pipeline stays intact', async () => {
    const { log, events } = makeLog();
    const upsert = vi.fn().mockRejectedValue(new Error('storage gone'));
    const prep = await prepareAndStoreBrowserPe(log, null, fireCtx(), upsert);
    expect(prep.safeFallback).toBe(false);
    expect(eventNames(events)).toContain('pe_pending_store_failed');
  });

  it('safeFallback never reaches the store', async () => {
    engineOverride.prepare = () => { throw new Error('boom'); };
    const { log, events } = makeLog();
    const upsert = vi.fn();
    const prep = await prepareAndStoreBrowserPe(log, null, fireCtx(), upsert);
    expect(prep.safeFallback).toBe(true);
    expect(upsert).not.toHaveBeenCalled();
    expect(eventNames(events)).toContain('pe_prepare_boundary');
  });

  it('the boundary log carries the trigger eligibility label (CLI observability parity)', async () => {
    const { log, events } = makeLog();
    await prepareAndStoreBrowserPe(
      log, null, fireCtx({ triggerEligibility: 'blocked_by_post_advisory_cooldown' }), vi.fn(),
    );
    const boundary = events.find(([k]) => k === 'pe_prepare_boundary');
    expect(boundary?.[1]?.['eligibility']).toBe('blocked_by_post_advisory_cooldown');
  });

  it('with a key present + dead network, the call still resolves (A3 fail-open)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const { log } = makeLog();
    const upsert = vi.fn().mockResolvedValue(undefined);
    await expect(
      prepareAndStoreBrowserPe(log, `sk-test-${'a'.repeat(24)}`, fireCtx(), upsert),
    ).resolves.toBeDefined();
  });
});

describe('sequence-shape gate seam (drives the SW blocked-exit fallback)', () => {
  it('a multi-step sequence prompt is sequence-shaped; a one-liner is not', () => {
    expect(isPromptEnhancementSequenceShapedTextV1(SEQUENCE_PROMPT)).toBe(true);
    expect(isPromptEnhancementSequenceShapedTextV1('fix the typo in the readme')).toBe(false);
  });
});

describe('signalMeaningByRef — what an absent practice means (same call as the CLI builder)', () => {
  const APPROVED = ['feature_scope_before_build', 'idea_scoping', 'implementation_checkpoint', 'incremental_build', 'spec_before_code', 'user_feedback_review'];
  const absenceCtx = (signal: string) => fireCtx({
    effectiveFlagType: `absence:${signal}`,
    firedKey: `absence:${signal}@implementation`,
  });

  it('an approved signal carries its description on the request, which the validator accepts', () => {
    for (const signal of APPROVED) {
      const req = buildBrowserPeRequest(absenceCtx(signal));
      expect(req.sourceSignals.signalMeaningByRef?.[`absence:${signal}`], signal).toBe(SIGNAL_MAP.get(signal)?.description);
      const v = validatePromptEnhancementPrepareRequestV1(req);
      expect(v.ok, `${signal}: ${v.ok ? '' : v.reasonCodes.join(', ')}`).toBe(true);
    }
  });

  it('a body no model worded is byte-identical with or without the field — for every signal, approved or not', async () => {
    const strip = (r: ReturnType<typeof buildBrowserPeRequest>) => {
      const { signalMeaningByRef: _drop, ...rest } = r.sourceSignals;
      return { ...r, sourceSignals: rest } as typeof r;
    };
    for (const signal of [...SIGNAL_MAP.keys()]) {
      const withField = await prepareBrowserPe(buildBrowserPeRequest(absenceCtx(signal)));
      const without = await prepareBrowserPe(strip(buildBrowserPeRequest(absenceCtx(signal))));
      expect(withField.safeFallback, signal).toBe(without.safeFallback);
      if (withField.safeFallback || without.safeFallback) continue;
      expect(withField.result.uiView.body.text, signal).toBe(without.result.uiView.body.text);
    }
  });

  it('a popup action re-composes without the description, so Shorter / More project-grounded read as they always did', async () => {
    for (const signal of APPROVED) {
      const req = buildBrowserPeRequest(absenceCtx(signal));
      const { signalMeaningByRef: _drop, ...rest } = req.sourceSignals;
      const bare = { ...req, sourceSignals: rest } as typeof req;
      const base = await prepareBrowserPe(req);
      expect(base.safeFallback, signal).toBe(false);
      if (base.safeFallback) continue;
      for (const actionType of ['shorter', 'more_thorough', 'more_project_grounded']) {
        const entry = base.result.availableActions.find((a) => a.actionType === actionType);
        if (!entry) continue;
        const act = (r: typeof req) => applyPromptEnhancementAction({
          ...r,
          action: entry,
          currentBodyBinding: {
            currentBodyId: base.result.currentBody.currentBodyId,
            bodyRevision: base.result.currentBody.bodyRevision,
            validationDecisionId: base.result.validationDecisionId,
            editedBodyText: base.result.currentBody.text,
            actionSubmittedAtMs: 2,
            realUserInitiated: true,
            sectionSpanEditEvents: [],
          },
        } as never);
        const withField = await act(req);
        const without = await act(bare);
        expect(withField.currentBody.text, `${signal}/${actionType}`).toBe(without.currentBody.text);
        expect(withField.currentBody.text, `${signal}/${actionType}`).not.toContain('means:');
      }
    }
  });

  it('the writer IS still sent the description for an approved signal, and nothing extra for any other', async () => {
    const sent: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      sent.push(String(init?.body ?? ''));
      return new Response(JSON.stringify({
        id: 'x', object: 'chat.completion', created: 0, model: 'm',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    refreshEngineKeyEnv(`sk-${'x'.repeat(40)}`);
    try {
      await prepareBrowserPe(buildBrowserPeRequest(absenceCtx('spec_before_code')));
      expect(sent.some((body) => body.includes('spec before code means: Writing the behavior spec'))).toBe(true);
      sent.length = 0;
      await prepareBrowserPe(buildBrowserPeRequest(absenceCtx('tests_before_merge')));
      expect(sent.some((body) => body.includes('means:'))).toBe(false);
    } finally {
      refreshEngineKeyEnv(null);
    }
  });

  it('a stage-change popup comes out byte-identical with or without the field (no stage line is approved)', async () => {
    const stages = ['idea', 'prd', 'architecture', 'task_breakdown', 'implementation', 'review_testing', 'release', 'feedback_loop'] as const;
    for (const to of stages) {
      const ctx = fireCtx({
        triggerKind: 'stage_transition',
        effectiveFlagType: 'stage_transition',
        firedKey: `stage_transition:idea→${to}`,
        currentStage: to,
        prevStage: 'idea',
      });
      const req = buildBrowserPeRequest(ctx);
      const { signalMeaningByRef: _drop, ...rest } = req.sourceSignals;
      const withField = await prepareBrowserPe(req);
      const without = await prepareBrowserPe({ ...req, sourceSignals: rest } as typeof req);
      expect(withField.safeFallback, to).toBe(without.safeFallback);
      if (withField.safeFallback || without.safeFallback) continue;
      expect(withField.result.uiView.body.text, to).toBe(without.result.uiView.body.text);
    }
  });
});
