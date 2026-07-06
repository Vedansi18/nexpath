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
import { resolveFrequencyConfig, type AdvisoryFrequencyLevel } from '../../config/GlobalConfig.js';
import type { AdvisoryPayload } from '../../core/ports/ui.port.js';
import type { Stage, UserRole } from '../../core/classifier/types.js';

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
  // webextension-polyfill's OnMessageListenerCallback requires the 3-arg form to
  // return the literal `true` unconditionally (its type contract, not `boolean`) —
  // returning `false` here doesn't match any of OnMessageListener's 3 shapes and is
  // a genuine type error, invisible until 2026-07-02 (see tsconfig.ext-browser.json
  // header comment for why this was never caught before).
  (msg: unknown, sender, sendResponse: (r?: unknown) => void): true => {
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
      return true;
    }

    sendResponse(undefined);
    return true;
  },
);

// ── Prompt submission pipeline ─────────────────────────────────────────────────

// Cross-page duplicate window: Bolt's landing page captures the first prompt, then
// hard-navigates to the new project page whose generation POST /api/chat/v2 carries
// that same prompt as the newest user message — a fresh content-script instance
// captures it again. The per-page capture-kit funnel cannot span a navigation, so
// the SW (which survives it) is the only place this dedup can live. Trade-off: the
// same text submitted twice deliberately within the window also collapses — same
// accepted limitation as the kit's own lastEmittedText guard.
const CROSS_PAGE_PROMPT_DEDUP_MS = 120_000;

function lastPromptKeyFor(projectRoot: string): string {
  return `nexpath_last_prompt::${projectRoot}`;
}

async function handlePromptSubmit(
  promptText: string,
  projectRoot: string,
  agent: string,
  tabId: number,
): Promise<void> {
  const now = clock.now();

  // ── Step 1: Load persisted session state + config ───────────────────────────
  const [loadedState, lang, apiKey, freqRaw, roleRaw, lastPromptRaw] = await Promise.all([
    idb.loadSessionState(projectRoot),
    idb.getProjectDetectedLanguage(projectRoot),
    keyStore.getKey('openai_api_key'),
    keyStore.getKey('advisory_frequency'),
    keyStore.getKey('role'),
    keyStore.getKey(lastPromptKeyFor(projectRoot)),
  ]);

  // ── Step 1.2: Cross-page duplicate guard (see CROSS_PAGE_PROMPT_DEDUP_MS) ───
  if (lastPromptRaw) {
    try {
      const last = JSON.parse(lastPromptRaw) as { text?: unknown; at?: unknown };
      if (last.text === promptText && typeof last.at === 'number' && now - last.at < CROSS_PAGE_PROMPT_DEDUP_MS) {
        log.debug('prompt_submit_deduped', { projectRoot, ageMs: now - last.at });
        return;
      }
    } catch {
      // malformed record — treat as absent
    }
  }
  await keyStore.setKey(lastPromptKeyFor(projectRoot), JSON.stringify({ text: promptText, at: now }));

  // ── Step 1.5: Resolve frequency + role config — mirrors cli/commands/auto.ts's
  // step 1.5 exactly (same fallback default, same resolveFrequencyConfig call) so
  // the browser's advisory-firing gating is the same logic as the CLI's, just fed
  // from browser.storage.local instead of the sql.js config table.
  const freq = (freqRaw ?? 'every_event') as AdvisoryFrequencyLevel;
  const freqConfig = resolveFrequencyConfig(freq);
  const configuredRole = roleRaw as UserRole | null;

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

  // freqConfig.minStageChangeConfidence mirrors auto.ts's step 3 exactly — same
  // gate the CLI uses to decide whether a cross-stage classification is confident
  // enough to actually move currentStage.
  mgr.processPrompt(memHandle.port, promptText, classification, now, freqConfig.minStageChangeConfidence);

  // Inject the configured role into an existing profile — mirrors auto.ts's step
  // 2.7. A no-op today: LLM profile classification isn't wired into the browser
  // skeleton yet (mgr.current.profile stays null), so this only takes effect once
  // that lands, but the wiring is correct now rather than needing revisiting then.
  const currentProfileForRole = mgr.current.profile;
  if (currentProfileForRole !== null) {
    mgr.setProfile({ ...currentProfileForRole, role: configuredRole });
  }

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

  // ── Step 5.5: Frequency off fast-exit + minimum-prompt guard — mirrors auto.ts's
  // step 4.5 exactly (same order, same gate values from freqConfig). ──────────────
  if (freq === 'off') {
    log.debug('advisory_freq_blocked', { freq });
    return;
  }
  if (mgr.current.promptCount < freqConfig.minPromptsBeforeAdvisory) {
    log.debug('advisory_min_prompts_blocked', {
      promptCount: mgr.current.promptCount,
      minRequired: freqConfig.minPromptsBeforeAdvisory,
    });
    return;
  }

  // ── Step 6: Decide whether Stage 2 should run ───────────────────────────────
  const trigger = shouldFireStage2(
    mgr.current as import('../../core/classifier/types.js').SessionState,
    prevStage,
    [], // newAbsenceFlags — AbsenceDetector not wired in B2 skeleton
    freqConfig.stage2S1LowConfidence,
  );

  if (!trigger) return;

  // ── Step 6.3: Dedup — already fired this exact stage_transition/absence event
  // this session? — mirrors auto.ts's step 6 (buildFiredKey + hasFiredDecisionSession).
  // Uses prevStageBeforeUpdate (captured before processPrompt ran) as the true prior
  // stage, matching the key format markDecisionSessionFired writes below at Step 10.
  const preCheckFiredKey = trigger.kind === 'stage_transition'
    ? `stage_transition:${prevStageBeforeUpdate}→${mgr.current.currentStage}`
    : `absence:${trigger.qualifyingFlags?.[0]?.signalKey ?? 'unknown'}@${mgr.current.currentStage}`;
  if (mgr.hasFiredDecisionSession(preCheckFiredKey)) {
    log.debug('advisory_dedup_blocked', { firedKey: preCheckFiredKey });
    return;
  }

  // ── Step 6.5: Advisory frequency gate — mirrors auto.ts's step 6.5 exactly. ───
  if (freq === 'major_only' && trigger.kind !== 'stage_transition') {
    log.debug('advisory_freq_blocked', { freq, flagType: trigger.kind });
    return;
  }
  if (freq === 'once_per_session' && mgr.current.firedDecisionSessions.length > 0) {
    log.debug('advisory_freq_blocked', { freq, flagType: trigger.kind });
    return;
  }

  // ── Step 6.6: Post-advisory cooldown — mirrors auto.ts's step 6.6 exactly. ────
  const lastAdvisory = mgr.current.lastAdvisoryPromptIndex ?? -1;
  if (lastAdvisory >= 0 && mgr.current.promptCount - lastAdvisory < freqConfig.postAdvisoryCooldown) {
    log.debug('advisory_cooldown_blocked', {
      promptCount: mgr.current.promptCount,
      lastAdvisoryAt: lastAdvisory,
      cooldownRemaining: freqConfig.postAdvisoryCooldown - (mgr.current.promptCount - lastAdvisory),
    });
    return;
  }

  // ── Step 6.7: Session advisory cap — profile-aware ceiling — mirrors auto.ts's
  // step 6.7 exactly. isVibeProfile stays false today (profile classification isn't
  // wired in the browser yet), so this always uses sessionAdvisoryCapDefault for now.
  const isVibeProfile =
    mgr.current.profile?.nature === 'beginner' ||
    mgr.current.profile?.nature === 'cool_geek';
  const advisoryCap = isVibeProfile
    ? freqConfig.sessionAdvisoryCapVibe
    : freqConfig.sessionAdvisoryCapDefault;
  const advisoryCount = mgr.current.advisoryCount ?? 0;
  if (advisoryCount >= advisoryCap) {
    log.debug('advisory_cap_blocked', { advisoryCount, advisoryCap });
    return;
  }

  if (!apiKey) {
    log.debug('stage2_skipped_no_key', {});
    return;
  }

  // ── Step 7: Run Stage 2 LLM analysis ────────────────────────────────────────
  const llm = new FetchLLMAdapter(apiKey);
  const state = mgr.current as import('../../core/classifier/types.js').SessionState;

  log.debug('stage2_started', {
    trigger: trigger.kind,
    prevStage: prevStageBeforeUpdate,
    stage: mgr.current.currentStage,
  });

  let stage2Out: import('../../core/stage2.js').Stage2Output;
  try {
    // Stage2Input's actual shape (confirmed against core/stage2.ts, 2026-07-02 — the
    // object literal here previously omitted required fields `detectedStage`/`confidence`
    // and included nonexistent fields `prevStage`/`promptHistory`, silently invisible
    // because tsconfig.ext-browser.json was never invoked; buildStage2Prompt's
    // `confidence.toFixed(2)` crashed on the resulting undefined at runtime, confirmed
    // live). `flagType` is the bare category only ('stage_transition' | 'absence') —
    // NOT the same as core/stage2.ts's separate `FlagType` template-literal type used
    // by resolveDecisionContent/generatePinchLabel below; the specific signal is carried
    // via `qualifyingFlags` instead.
    stage2Out = await runStage2(
      {
        state,
        detectedStage: classification.stage,
        confidence: classification.confidence,
        flagType: trigger.kind === 'stage_transition' ? 'stage_transition' : 'absence',
        qualifyingFlags: trigger.kind === 'absence' ? trigger.qualifyingFlags : undefined,
      },
      llm,
      log,
      // Frequency-derived overrides — mirrors auto.ts's step 7 exactly, instead of
      // always using runStage2's hardcoded defaults regardless of the user's setting.
      { minConfidence: freqConfig.stage2MinConfidence, contextWindow: freqConfig.stage2ContextWindow },
    );
  } catch (err) {
    log.warn('stage2_error', { error: String(err) });
    return;
  }

  // The LLM's verdict was previously invisible when it declined — the single most
  // important pipeline decision must always leave a log line (found via a live manual
  // test where "no panel" was indistinguishable from a crash).
  log.debug('stage2_result', {
    fire: stage2Out.fire_decision_session,
    stage: stage2Out.stage,
    confidence: stage2Out.stage_confidence,
    reason: stage2Out.reason,
  });

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
      frequency: freq,
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
    log.debug('advisory_showing', { tabId, advisoryId: payload.advisoryId, stage: payload.stage });
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
