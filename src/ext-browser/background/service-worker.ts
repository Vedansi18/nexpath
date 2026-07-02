import browser from 'webextension-polyfill';
import { classifyPrompt } from '../../core/classifier/PromptClassifier.js';
import { SessionStateManager } from '../../core/session-state.js';
import { shouldFireStage2, runStage2 } from '../../core/stage2.js';
import { generatePinchLabel } from '../../core/decision/pinch.js';
import { resolveDecisionContent } from '../../decision-session/options.js';
import { IdbStorageAdapter } from '../adapters/storage-idb.js';
import { makeMemoryStoragePort } from '../adapters/memory-storage.js';
import { FetchLLMAdapter } from '../adapters/llm-fetch.js';
import { ChromeStorageKeyAdapter } from '../adapters/storage-chrome.js';
import { BrowserClockAdapter } from '../adapters/clock-browser.js';
import { ConsoleLogAdapter } from '../adapters/log-console.js';
import { OffscreenEmbeddingAdapter } from '../adapters/embedding-offscreen.js';
import { ContentScriptUIAdapter } from '../content/panel-adapter.js';
import {
  isPromptSubmitMsg,
  isResponseStopMsg,
} from '../content/ipc.js';
import type { AdvisoryPayload } from '../../core/ports/ui.port.js';
import type { Stage } from '../../core/classifier/types.js';

const idb = new IdbStorageAdapter();
const keyStore = new ChromeStorageKeyAdapter();
const clock = new BrowserClockAdapter();
const log = new ConsoleLogAdapter('[nexpath-sw]');

// ── Offscreen document management (Chrome only) ────────────────────────────────

const OFFSCREEN_URL = 'offscreen/offscreen.html';

// chrome.offscreen has no cross-browser equivalent (Chrome-only API, no Firefox support) —
// stays as chrome.*, not webextension-polyfill, deliberately. Already feature-detected below.
type ChromeWithOffscreen = typeof chrome & {
  offscreen: {
    createDocument(opts: { url: string; reasons: string[]; justification: string }): Promise<void>;
    hasDocument(): Promise<boolean>;
  };
};

async function ensureOffscreen(): Promise<void> {
  const offscreenApi = (chrome as ChromeWithOffscreen).offscreen;
  if (!offscreenApi) return; // Firefox — no offscreen API

  // hasDocument() prevents double-create errors when the SW restarts.
  if (await offscreenApi.hasDocument()) return;

  await offscreenApi.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['WORKERS'],
    justification: 'Runs Transformers.js embedding model outside the service worker',
  });
}

// ── First-install: open options page ──────────────────────────────────────────

browser.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    browser.runtime.openOptionsPage();
  }
});

// ── Main message listener ──────────────────────────────────────────────────────

browser.runtime.onMessage.addListener(
  (msg: unknown, sender, sendResponse: (r?: unknown) => void) => {
    if (isPromptSubmitMsg(msg)) {
      log.debug('prompt_submit_received', { agent: msg.agent, projectRoot: msg.projectRoot });
      const tabId = sender.tab?.id ?? msg.tabId;
      handlePromptSubmit(msg.promptText, msg.projectRoot, msg.agent, tabId)
        .then(() => sendResponse({ ok: true }))
        .catch((err: unknown) => {
          log.warn('prompt_submit_error', { error: String(err) });
          sendResponse({ ok: false });
        });
      return true; // keep channel open for async response
    }

    if (isResponseStopMsg(msg)) {
      // No pipeline action in B2 skeleton — acknowledge and return. Logged explicitly
      // so response-stop receipt is directly visible/testable, not just inferred.
      log.debug('response_stop_received', { agent: msg.agent, projectRoot: msg.projectRoot });
      sendResponse({ ok: true });
      return false;
    }

    return false;
  },
);

// ── Prompt submission pipeline ─────────────────────────────────────────────────

async function handlePromptSubmit(
  promptText: string,
  projectRoot: string,
  agent: string,
  tabId: number,
): Promise<void> {
  const now = clock.now();

  // ── Step 1: Load persisted session state ────────────────────────────────────
  const [loadedState, lang, apiKey] = await Promise.all([
    idb.loadSessionState(projectRoot),
    idb.getProjectDetectedLanguage(projectRoot),
    keyStore.getKey('openai_api_key'),
  ]);

  // ── Step 2: Build sync in-memory port ───────────────────────────────────────
  const memHandle = makeMemoryStoragePort(loadedState, lang);

  // ── Step 3: Classify prompt (Tier 1 + optional Tier 3 via offscreen) ────────
  let embeddingAdapter: OffscreenEmbeddingAdapter | undefined;
  try {
    await ensureOffscreen();
    embeddingAdapter = new OffscreenEmbeddingAdapter();
  } catch {
    // Offscreen not available (Firefox MV3) — fall through without embedding
  }

  const classification = await classifyPrompt(promptText, {
    // tidfClassifier omitted — not available in browser (uses node:module)
    embeddingClassifier: embeddingAdapter,
  });

  // ── Step 4: Update session state (sync) ─────────────────────────────────────
  const prevStageBeforeUpdate = SessionStateManager.load(memHandle.port, projectRoot, now).current.currentStage;

  const mgr = SessionStateManager.load(memHandle.port, projectRoot, now);
  const prevStage: Stage | undefined = mgr.current.currentStage !== classification.stage
    ? mgr.current.currentStage
    : undefined;

  mgr.processPrompt(memHandle.port, promptText, classification, now);

  // ── Step 5: PERSIST before any further awaits (SW ephemerality rule) ────────
  const stateAfterClassify = memHandle.getLatestState();
  if (stateAfterClassify) {
    await idb.saveSessionState(stateAfterClassify);
    if (stateAfterClassify.detectedLanguage) {
      await idb.saveProjectDetectedLanguage(projectRoot, stateAfterClassify.detectedLanguage);
    }
  }

  log.debug('prompt_classified', {
    stage: classification.stage,
    confidence: classification.confidence,
    tier: classification.tier,
    promptCount: mgr.current.promptCount,
  });

  // ── Step 6: Decide whether Stage 2 should run ───────────────────────────────
  const trigger = shouldFireStage2(
    mgr.current as import('../../core/classifier/types.js').SessionState,
    prevStage,
    [], // newAbsenceFlags — AbsenceDetector not wired in B2 skeleton
  );

  if (!trigger) return;
  if (!apiKey) {
    log.debug('stage2_skipped_no_key', {});
    return;
  }

  // ── Step 7: Run Stage 2 LLM analysis ────────────────────────────────────────
  const llm = new FetchLLMAdapter(apiKey);
  const state = mgr.current as import('../../core/classifier/types.js').SessionState;

  let stage2Out: import('../../core/stage2.js').Stage2Output;
  try {
    stage2Out = await runStage2(
      {
        state,
        flagType: trigger.kind === 'stage_transition'
          ? 'stage_transition'
          : `absence:${trigger.qualifyingFlags?.[0]?.signalKey ?? 'unknown'}`,
        prevStage: prevStage ?? state.currentStage,
        promptHistory: [...state.promptHistory],
      },
      llm,
      log,
    );
  } catch (err) {
    log.warn('stage2_error', { error: String(err) });
    return;
  }

  if (!stage2Out.fire_decision_session) return;

  // Persist state again after LLM call
  const stateAfterStage2 = memHandle.getLatestState();
  if (stateAfterStage2) {
    await idb.saveSessionState(stateAfterStage2);
  }

  // ── Step 8: Build advisory payload ──────────────────────────────────────────
  const flagType = trigger.kind === 'stage_transition'
    ? ('stage_transition' as const)
    : (`absence:${trigger.qualifyingFlags?.[0]?.signalKey ?? 'unknown'}` as `absence:${string}`);

  const content = resolveDecisionContent(
    state.currentStage,
    flagType,
    state.profile ?? undefined,
    prevStage,
  );

  const pinchLabel = await generatePinchLabel(
    state.currentStage,
    flagType,
    llm,
    state.profile ?? undefined,
    state.detectedLanguage,
  ).catch(() => content.pinchFallback);

  const payload: AdvisoryPayload = {
    schemaVersion: 1,
    advisoryId: globalThis.crypto.randomUUID(),
    pinchLabel,
    stage: state.currentStage,
    options: [
      ...(content.L1[0] ? [{ id: 'l1-0', level: 'L1' as const, title: content.L1[0].option, body: content.L1[0].descBase }] : []),
      ...(content.L2[0] ? [{ id: 'l2-0', level: 'L2' as const, title: content.L2[0].option, body: content.L2[0].descBase }] : []),
      ...(content.L3[0] ? [{ id: 'l3-0', level: 'L3' as const, title: content.L3[0].option, body: content.L3[0].descBase }] : []),
    ],
    meta: {
      agent,
      frequency: 'optimum',
    },
  };

  // ── Step 9: Record advisory fired + persist ──────────────────────────────────
  mgr.markAdvisoryFired(memHandle.port);

  const stateAfterMark = memHandle.getLatestState();
  if (stateAfterMark) {
    await idb.saveSessionState(stateAfterMark);
  }

  // ── Step 10: Show advisory in the tab ───────────────────────────────────────
  if (!tabId) {
    log.warn('show_advisory_no_tab', {});
    return;
  }

  const ui = new ContentScriptUIAdapter(tabId);
  try {
    const event = await ui.showAdvisory(payload);
    log.debug('advisory_dismissed', { eventType: event.type, advisoryId: payload.advisoryId });

    if (trigger.kind === 'stage_transition' || trigger.kind === 'absence') {
      const sessionKey = trigger.kind === 'stage_transition'
        ? `stage_transition:${prevStageBeforeUpdate}→${state.currentStage}`
        : `absence:${trigger.qualifyingFlags?.[0]?.signalKey ?? 'unknown'}@${state.currentStage}`;
      mgr.markDecisionSessionFired(memHandle.port, sessionKey);

      const finalState = memHandle.getLatestState();
      if (finalState) {
        await idb.saveSessionState(finalState);
      }
    }
  } catch (err) {
    log.warn('show_advisory_error', { error: String(err) });
  }
}
