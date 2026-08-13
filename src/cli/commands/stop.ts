import OpenAI from 'openai';
import { platform } from 'node:process';
import type { Store } from '../../store/db.js';
import { openStore, closeStore, releaseStoreLock, reacquireStoreLock, DEFAULT_DB_PATH } from '../../store/db.js';
import { getPendingAdvisory, markAdvisoryShown } from '../../store/pending-advisories.js';
import {
  getPendingPromptEnhancement,
  markPromptEnhancementShown,
  type PendingPromptEnhancement,
} from '../../store/pending-prompt-enhancements.js';
import { isFeedbackEligible, markFeedbackShown } from '../../store/feedback-cadence.js';
import { recordAdvisoryFired, recordOptionSelected, recordActionSignal } from '../../store/feedback-signals.js';
import { sendFeedback } from '../../telemetry/feedback-send.js';
import { runFeedbackPopup, type FeedbackRenderFn, type FeedbackResult } from '../../decision-session/feedback-popup.js';
import { createFeedbackRenderFn } from '../../decision-session/feedback-tty.js';
import { runDecisionSession } from '../../decision-session/DecisionSession.js';
import type { SelectFn } from '../../decision-session/DecisionSession.js';
import { createTtySelectFn } from '../../decision-session/TtySelectFn.js';
import { getConfig } from '../../store/config.js';
import { detectLanguage, resolveLanguage, LANG_WINDOW, LANG_DETECT_INTERVAL } from '../../classifier/LanguageDetector.js';
import { SessionStateManager } from '../../classifier/SessionStateManager.js';
import { getRecentPrompts } from '../../store/prompts.js';
import { getProject, setDetectedLanguage } from '../../store/projects.js';
import { logger, initLogger } from '../../logger.js';
import type { LogLevel } from '../../logger.js';
import { writeHookStats } from '../../store/hook-stats.js';
import { writeTelemetry } from '../../telemetry/index.js';
import { triggerOpportunisticSync } from '../../telemetry/OpportunisticSync.js';
import { flushIfTelemetryOn, flushLifecycle } from '../../telemetry/lifecycle-flush.js';
import { recentPromptMetadata } from '../../telemetry/recent-prompts.js';
import { readStdin, recordPromptEnhancementCliFeedbackV1, recordPromptEnhancementShownMemoryV1, markPromptEnhancementUsedMemoryV1, recordPromptEnhancementStopBridgeDeliveryV1 } from './auto.js';
import {
  resolvePromptEnhancementCliHostCapabilityV1,
  runPromptEnhancementCliPopupHostLaunchV1,
} from '../prompt-enhancement-host.js';
import {
  validatePromptEnhancementCliPopupResultV1,
  runPromptEnhancementCliSubmitPopupV1,
  type PromptEnhancementCliPopupResultV1,
} from '../../prompt-enhancement/cli-submit-popup.js';
import { emitPromptEnhancementCostObservabilityV1 } from '../../prompt-enhancement/cost-measurement.js';
import { evaluatePromptEnhancementMpsIntakeDecisionV1 } from '../../prompt-enhancement/intake-decision.js';
import { buildPromptEnhancementCliMpsIntakeEvidenceV1 } from '../../prompt-enhancement/cli-mps-intake-evidence.js';
import { runPromptEnhancementCliMpsFirstPopupV1, buildPromptEnhancementMpsCancelFeedbackEventV1, promptEnhancementMpsActionSignalKindV1 } from '../../prompt-enhancement/cli-mps-run.js';
import { intakePromptEnhancementSequenceOnFirstSendV1 } from '../../prompt-enhancement/sequence-intake.js';
import { upsertPendingPromptSequence, getActivePendingPromptSequence } from '../../store/pending-sequences.js';
import { evaluatePromptEnhancementFutureSequenceRuntimeGateV1 } from '../../prompt-enhancement/future-sequence-runtime-gate.js';
import { PROMPT_ENHANCEMENT_CONTRACT_VERSION, type PromptEnhancementFutureSequenceRuntimeEventV1 } from '../../prompt-enhancement/contracts.js';
import type { GeneratedOptions } from '../../decision-session/OptionGenerator.js';
import { resolveContentSource, selectionRegister } from '../../decision-session/selection-registry.js';
import { autogenAwareLookup, pinchSignalTypeForFlag } from '../../decision-session/content-template-source.js';
import { runAutogenForFire } from '../../decision-session/auto-template-generator.js';
import { loadRightGoodProfile } from '../../classifier/right-good-aggregator.js';
import { generateFromEngine, buildEngineGrounding, composeDeterministicOptions } from '../../decision-session/engine-option-generator.js';
import { resolveRecord } from '../../decision-session/content-template-engine.js';
import { appendVariantServedEvent } from '../../telemetry/param-events.js';
import { activePinFor, applyPinToLookup, applyPinToLevel, type ActivePin } from '../../decision-session/experiment-config.js';
import { resolvePinchFields } from '../../decision-session/signal-pinch-fields.js';
import { getWhyHelpForSignalType } from '../../decision-session/why-help-by-signal-type.js';
import type { WhyHelpEntry } from '../../decision-session/why-help.js';
import { getUserDepthLevel } from '../../store/user-depth-level.js';
import type { MaturityLevel } from '../../decision-session/content-template-schema.js';
import type { PromptRecord } from '../../classifier/types.js';
import { resolveOpenAIKey, getKeySource } from '../../config/ApiKeyResolver.js';

/**
 * nexpath stop — Claude Code Stop hook handler.
 *
 * Fires every time Claude finishes a response.  The handler:
 *   1. Exits immediately when stop_hook_active is true (loop guard).
 *   2. Looks up a pending advisory for the project (stored by the auto hook).
 *   3. If found: marks it shown, opens /dev/tty, renders the decision session UI.
 *   4. If the user picks "Send to your agent": writes { decision: "block", reason }
 *      so Claude Code receives the prompt as the next user turn.
 *      If the user picks "Copy to clipboard": text is already in clipboard
 *      (copied by the popup window); exits 0, Claude stops normally.
 *   5. On dismiss / skip / no advisory: exits 0 silently (Claude stops normally).
 */

// ── Helpers ────────────────────────────────────────────────────────────────────

// ── Types ──────────────────────────────────────────────────────────────────────

export interface StopPayload {
  session_id?:             string;
  cwd:                     string;
  hook_event_name:         string;
  stop_hook_active:        boolean;
  last_assistant_message?: string;
}

export type StopOutcome =
  | { outcome: 'loop_guard' }
  | { outcome: 'no_pending' }
  | { outcome: 'no_tty' }
  | { outcome: 'blocked';       reason: string }
  | { outcome: 'clipboard_only' }
  | { outcome: 'feedback_shown' }
  | { outcome: 'prompt_enhancement_shown' }
  | { outcome: 'skipped' }
  // MPS-6: a sequence's own continuation Stop was exempted from the loop guard and routed to the
  // continuation launcher, which is fail-closed in v1 (gate blocked) — nothing rendered, the row is
  // left as-is. Distinct from `loop_guard` so a gate-blocked continuation is legible in logs/tests.
  | { outcome: 'mps_continuation_gated' };

/**
 * Outcome of showing the deferred PE popup on the Stop hook (owner decision B-i).
 * `inject` → the user chose the enhanced prompt; its text is injected as a new Claude turn.
 * `shown`  → the popup was shown but nothing is injected (original / close).
 * `not_shown` → no usable popup host (e.g. no GUI terminal); the advisory path may still run.
 */
export type PromptEnhancementStopDecision =
  | { kind: 'inject'; text: string }
  | { kind: 'shown' }
  | { kind: 'not_shown' };

/** Injectable Stop-hook PE popup launcher (production wires the real host; tests mock it). */
export type PromptEnhancementStopLaunchFn =
  (pending: PendingPromptEnhancement) => Promise<PromptEnhancementStopDecision>;

/**
 * Injectable feedback popup dependencies. `render` is the terminal renderer
 * (null when none is available, e.g. no TTY); `send` transmits the rating.
 */
export interface FeedbackDeps {
  render: FeedbackRenderFn | null;
  send:   (store: Store, rating: number) => Promise<boolean>;
}

// ── Core logic ─────────────────────────────────────────────────────────────────

/**
 * Run the Stop hook pipeline.
 *
 * @param payload   Parsed Stop hook JSON payload from Claude Code stdin
 * @param store     Open SQLite store (caller manages lifecycle)
 * @param selectFn  Optional select replacement (injected in tests)
 */
export async function runStop(
  payload:       StopPayload,
  store:         Store,
  selectFn?:     SelectFn,
  openai?:       OpenAI,
  feedbackDeps?: FeedbackDeps,
  peLaunch?:     PromptEnhancementStopLaunchFn,
): Promise<StopOutcome> {
  // Load session state up front — BEFORE the loop guard — so the MPS-6 exemption below can look up an
  // active session-scoped sequence, and so the PE popup + advisory lookups further down stay
  // session-scoped (a record queued in one session must not surface in an unrelated later one).
  const mgr = SessionStateManager.load(store, payload.cwd);

  // 1. Loop guard — Claude is continuing because of a previous Stop block; let it land.
  //    MPS-6 (2026-08-13): a sequence delivers each item by BLOCKING the Stop, which is exactly what
  //    sets `stop_hook_active` on the NEXT event — so a blanket return here would swallow the sequence's
  //    OWN continuation. When the evidence (an active session-scoped sequence — the runtime row, never
  //    inferred from timing) exists, route ONLY to the continuation launcher below: the advisory, the
  //    standalone feedback popup, and the pending-PE popup all stay closed on this event, and no other
  //    normal Stop side effect runs. Absence FAILS CLOSED — no active sequence → the loop guard behaves
  //    exactly as today. This is a routing decision, not a kill switch: feedback / language detection /
  //    lifecycle telemetry are untouched on non-sequence Stops.
  if (payload.stop_hook_active) {
    const activeSequence = getActivePendingPromptSequence(store, payload.cwd, mgr.current.sessionId);
    if (activeSequence) {
      // MPS continuation launcher (moved here by MPS-6 — the continuation Stop is the stop_hook_active
      // event). FAIL-CLOSED in v1: the runtime gate always returns allowed:false and the per-item body
      // is not generated yet, so nothing renders — we look up the gate, log its outcome, and leave the
      // row as-is. When the gate lifts (P5) the interactive continuation shell renders here instead. No
      // advisory, feedback, or PE popup is reached on this event.
      //
      // MPS-11 sub-phase 1b (Phase C): the launcher now validates a REAL continuation event built from
      // the live row + payload before it consults evidence, instead of passing nothing. The event's
      // fields carry their HONEST v1 values — a Stop is not an explicit user action
      // (`explicit_user_action_absent`), the future-hold commit contract is not proven on the CLI host
      // yet (door #8 → `host_hold_commit_not_proven`), and a fired Stop is not completion proof
      // (`stop_or_response_finished_is_non_proof`). These stay diagnostics; they do not flip `allowed`.
      // Evidence is passed as an explicit empty read: no production source sets any of the eleven
      // runtime-evidence flags in v1 (owner sign-offs / register rows / host-hold proof / passed
      // fixtures do not exist as real reads yet), so the gate stays blocked by evidence ABSENCE, not by
      // passing nothing — and it will open naturally, with no change here, once a real evidence reader
      // supplies those flags. ⛔ No flag is asserted true; no handoff is fabricated (the row stores
      // ids/counts/status only — a typed handoff is a create-path concern, not this seam).
      const continuationEvent: PromptEnhancementFutureSequenceRuntimeEventV1 = {
        contractVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
        projectScope: payload.cwd,
        requestId: activeSequence.enhancementId,
        sequenceId: activeSequence.sequenceId,
        // Canonical per-item identity: the store keys items by (sequenceId, currentItemIndex).
        sequenceItemId: `${activeSequence.sequenceId}#${activeSequence.currentItemIndex}`,
        currentItemIndex: activeSequence.currentItemIndex,
        createdAtMs: activeSequence.createdAt,
        idempotencyKey: `${activeSequence.sequenceId}:${activeSequence.currentItemIndex}`,
        explicitUserActionState: 'absent',
        continuationActionState: 'continue_current_item',
        terminalTransitionState: 'none',
        hostCapabilityState: 'stop_bridge_only',
        stopEventState: 'stop_fired_non_proof',
        stateFreshness: 'current',
      };
      const gate = evaluatePromptEnhancementFutureSequenceRuntimeGateV1({
        schemaVersion: PROMPT_ENHANCEMENT_CONTRACT_VERSION,
        operation: 'continue_current_item',
        requestId: activeSequence.enhancementId,
        projectRoot: payload.cwd,
        event: continuationEvent,
        evidence: {}, // Phase-C seam: real read, no runtime-evidence flag satisfied in v1 → fail-closed.
      });
      logger.debug('stop_mps_continuation_gate', {
        cwd: payload.cwd,
        sequenceId: activeSequence.sequenceId,
        currentItemIndex: activeSequence.currentItemIndex,
        itemCount: activeSequence.itemCount,
        allowed: gate.allowed,
        // Full missing-gate list + count (no silent slice) so a debugger can tell how many gates are
        // missing, not just the first few.
        missingGateCodeCount: gate.missingGateCodes.length,
        missingGateCodes: gate.missingGateCodes,
      });
      // No render, no advance, no mutation — the row is left as-is for the next Stop (fail-closed v1).
      return { outcome: 'mps_continuation_gated' };
    }
    logger.debug('stop_loop_guard', { cwd: payload.cwd });
    return { outcome: 'loop_guard' };
  }

  // 1.3. Feedback popup — when due, show it in place of the advisory this turn.
  //      A rating is sent; either outcome resets the cadence. Skipped (without
  //      consuming the cadence) when no renderer is available.
  if (isFeedbackEligible(store)) {
    const fbRender = feedbackDeps ? feedbackDeps.render : createFeedbackRenderFn();
    const fbSend   = feedbackDeps ? feedbackDeps.send   : sendFeedback;
    if (fbRender) {
      // The popup blocks for user input; don't hold the global DB lock across it.
      // Release before, re-acquire + reload after, so other sessions are not
      // blocked and their concurrent writes are not clobbered. No-op for :memory:.
      releaseStoreLock(store);
      let result: FeedbackResult;
      try {
        result = await runFeedbackPopup({ render: fbRender });
      } finally {
        await reacquireStoreLock(store);
      }
      if (result.outcome === 'selected') {
        // The feedback click is the consent gate: flush any buffered lifecycle
        // events (install + advisory + option-selected), then send the rating.
        // Flush regardless of telemetry.enabled — this explicit action is the consent.
        await flushLifecycle(store);
        await fbSend(store, result.rating);
      }
      markFeedbackShown(store);
      logger.info('stop_feedback_shown', { cwd: payload.cwd, selected: result.outcome === 'selected' });
      return { outcome: 'feedback_shown' };
    }
  }

  // 1.4. Pending Prompt Enhancement popup (owner decision B-i, 2026-08-04) — deferred from the
  //      UserPromptSubmit hook. Shown after Claude's response, before the advisory. One-popup
  //      priority: feedback → PE → advisory. "Use enhanced" injects the enhanced prompt as a new
  //      turn (block decision); original/close inject nothing; no usable host falls through to the
  //      advisory. The launcher renders in-process on /dev/tty (like the advisory) or, with no
  //      direct TTY, spawns a GUI terminal; a fully headless session has no host and falls through.
  //      Store-lock handling lives in the launcher: the in-process popup holds the lock (matching
  //      the advisory), while the spawned path releases it so the child process can reach the DB.
  if (peLaunch) {
    const pendingPe = getPendingPromptEnhancement(store, payload.cwd, mgr.current.sessionId);
    if (pendingPe) {
      let decision: PromptEnhancementStopDecision;
      try {
        decision = await peLaunch(pendingPe);
      } catch (err) {
        logger.debug('stop_prompt_enhancement_error', { cwd: payload.cwd, error: String(err) });
        decision = { kind: 'not_shown' };
      }
      if (decision.kind === 'inject') {
        // Consume the record only now that it was actually displayed/injected, so a host that
        // could not display it (e.g. an unsupported platform → not_shown) leaves the record
        // pending for the next Stop instead of burning it silently.
        markPromptEnhancementShown(store, pendingPe.id);
        // D1 (P9-G1 / resolves P9-G2): record source-use + generated-origin BEFORE transport via
        // the typed Stop-bridge delivery contract — the audit/lineage tables the ad-hoc path never
        // wrote live. Best-effort: an audit-write failure must never lose the injection (4d).
        try {
          const delivered = recordPromptEnhancementStopBridgeDeliveryV1(store, pendingPe);
          logger.debug('stop_prompt_enhancement_delivery_recorded', {
            cwd: payload.cwd,
            outcome: delivered.outcome,
            sourceUseCount: delivered.sourceUseIds.length,
            sourceUseRecordedBeforeTransport: delivered.invariants.sourceUseRecordedBeforeTransport,
            generatedOriginId: delivered.generatedOrigin?.generatedOriginId,
          });
        } catch (err) {
          logger.debug('stop_prompt_enhancement_delivery_record_failed', { cwd: payload.cwd, error: String(err) });
        }
        // Record the injected enhanced prompt so the next UserPromptSubmit recognises it as an
        // echo and does not prepare another PE for it (mirrors the advisory injection at the
        // bottom of this function — otherwise the enhanced turn would re-trigger the PE popup).
        // NB: the typed origin guard (resolvePromptEnhancementPromptSubmitOrigin) is evidence-based
        // (generatedOriginId), which the CLI text-injection cannot carry — it becomes authoritative
        // on the EXTENSION delivery path (Vedansi handoff). The CLI echo stays text-based here.
        SessionStateManager.load(store, payload.cwd).setInjectedPrompt(store, decision.text);
        logger.info('stop_prompt_enhancement_injected', { cwd: payload.cwd });
        return { outcome: 'blocked', reason: decision.text };
      }
      if (decision.kind === 'shown') {
        // Displayed (incl. dismissed / use-original) → consume so a Stop re-fire cannot re-show it.
        markPromptEnhancementShown(store, pendingPe.id);
        logger.info('stop_prompt_enhancement_shown', { cwd: payload.cwd });
        return { outcome: 'prompt_enhancement_shown' };
      }
      // not_shown → no usable PE host this turn; the record stays PENDING (not marked shown) so a
      // later Stop with a working host can still show it. Fall through to the advisory path below.
    }
  }

  // (1.45. MPS continuation launcher moved to the loop-guard exemption at the top of runStop — MPS-6,
  //  2026-08-13. The continuation Stop is the `stop_hook_active` event, so the launcher must run there.)

  // 1.5. Language detection — runs post-response, invisible latency
  //      Only fires when >= LANG_DETECT_INTERVAL prompts have been captured for this project.
  const recentPrompts = getRecentPrompts(store, payload.cwd, LANG_WINDOW);
  if (recentPrompts.length >= LANG_DETECT_INTERVAL) {
    const currentDetected = getProject(store, payload.cwd)?.detectedLanguage ?? undefined;
    const detected = detectLanguage(recentPrompts.map((p) => p.text), currentDetected);
    setDetectedLanguage(store, payload.cwd, detected);
    logger.debug('stop_lang_detected', { cwd: payload.cwd, detected: detected ?? null });
    writeTelemetry(payload.cwd, 'language_detected', { detectedLanguage: detected ?? null }, store);
  }

  // 1.7. Read decision_session_count for help-line gating in the decision session UI
  const decisionSessionCount = getProject(store, payload.cwd)?.decisionSessionCount ?? 0;

  // 2. Session state (`mgr`) was loaded up front (before the loop guard) so the MPS-6 sequence check,
  //    the PE popup, and the advisory lookup are all session-scoped; it is reused here.

  // 3. Check for a pending advisory stored by the auto hook
  logger.debug('stop_pending_lookup', {
    cwd: payload.cwd,
    sessionId: mgr.current.sessionId,
  });
  const advisory = getPendingAdvisory(store, payload.cwd, mgr.current.sessionId);
  if (!advisory) {
    const projectPending = getPendingAdvisory(store, payload.cwd);
    logger.debug('stop_pending_miss', {
      cwd: payload.cwd,
      sessionId: mgr.current.sessionId,
      projectPending: projectPending !== null,
      pendingSessionId: projectPending?.sessionId ?? null,
    });
    logger.debug('stop_no_pending', { cwd: payload.cwd });
    writeTelemetry(payload.cwd, 'stop_no_pending', undefined, store);
    return { outcome: 'no_pending' };
  }

  logger.debug('stop_pending_hit', {
    cwd: payload.cwd,
    sessionId: mgr.current.sessionId,
    advisoryId: advisory.id,
  });
  // 3. Mark as shown immediately — prevents duplicate UI on rapid Stop re-fires
  markAdvisoryShown(store, advisory.id);

  // 3.5. Advisory frequency gate — honour opt-out / frequency setting even for
  //      already-queued pending advisories (e.g. user pressed Ctrl+X on a prior
  //      advisory while a second was already pending in the DB).
  const freq =
    getConfig(store.db, `advisory_frequency:${payload.cwd}`) ??
    getConfig(store.db, 'advisory_frequency') ??
    'every_event';
  if (freq === 'off') {
    logger.info('stop_freq_gate', { cwd: payload.cwd, reason: 'freq_off' });
    return { outcome: 'skipped' };
  }

  // 4. TTY resolution — Stop hook stdin is always piped; open /dev/tty directly
  let effectiveSelectFn: SelectFn | undefined = selectFn;
  if (!effectiveSelectFn) {
    if (process.env['NEXPATH_SIM'] === '1') {
      // Sim mode: skip TTY entirely — runLevel intercepts NEXPATH_SIM before calling selectFn
      effectiveSelectFn = () => Promise.resolve('');
      logger.debug('stop_tty_resolved', { method: 'sim' });
    } else {
      const ttySel = createTtySelectFn(store, payload.cwd);
      if (!ttySel) {
        logger.info('stop_no_tty', { cwd: payload.cwd });
        return { outcome: 'no_tty' };
      }
      effectiveSelectFn = ttySel;
      logger.debug('stop_tty_resolved', { method: 'direct_tty' });
    }
  }

  // 5. Generate decision options — runs after Claude's response, within stop's 600s window
  const langOverride  = getConfig(store.db, 'language_override');
  const detectedLang  = getProject(store, payload.cwd)?.detectedLanguage ?? undefined;
  const effectiveLang = resolveLanguage(langOverride, detectedLang);

  // Dispatch: every signal is migrated, so the fired advisory's record serves it via the engine.
  // The record signalType comes from the flag (the `absence:` convention) or, for a stage transition
  // (no absence: key), from the destination stage — both via pinchSignalTypeForFlag, which needs no
  // static content (the B11 cutover removed it).
  const recordSignalType = pinchSignalTypeForFlag(advisory.flagType, advisory.stage);
  // The engine now serves role-tailored content directly (B11 `roleOverrides` — context_loss's
  // founder / indie_hacker / pm variants), so there is no role-precedence static guard: every
  // migrated signal, role-tailored or not, takes the engine path (the role is passed below).
  let generatedOptions: GeneratedOptions | null = null;
  // A migrated signal owns its popup question + per-class why-help in the record (no matching
  // static DecisionContent) — thread them to runDecisionSession as overrides.
  let questionOverride: string | undefined;
  let whyHelpOverride: WhyHelpEntry | null | undefined;
  const register = selectionRegister(mgr.current.profile?.nature);
  if (recordSignalType && resolveContentSource(recordSignalType) === 'content-template') {
    // An active experiment pin makes the served variant deterministic for this
    // installation: it can force the record source and/or the maturity level.
    // Fail-open — a missing/malformed config means no pinning.
    let activePin: ActivePin | null = null;
    try { activePin = activePinFor(store, recordSignalType); } catch { activePin = null; }
    const baseLookup = autogenAwareLookup(store, payload.cwd, recordSignalType);
    const lookup = activePin ? applyPinToLookup(baseLookup, activePin.pin) : baseLookup;
    const baseLevel = (getUserDepthLevel(store, payload.cwd)?.currentLevel ?? 2) as MaturityLevel;
    const level = activePin ? applyPinToLevel(baseLevel, activePin.pin) : baseLevel;
    const role   = mgr.current.profile?.role ?? undefined;
    // Popup question + per-class why-help are static (no LLM). The question comes from the
    // register-keyed pinch-fields map (the migrated question/pinchFallback layer), not the record.
    questionOverride = resolvePinchFields(recordSignalType, register)?.question;
    whyHelpOverride = getWhyHelpForSignalType(recordSignalType);
    // The engine grounding/weave needs an LLM client; on ANY failure (missing key, API error)
    // degrade below — the Stop hook must never crash on option gen.
    try {
      const promptHistory = mgr.current.promptHistory as PromptRecord[];
      const facts = await buildEngineGrounding(store, payload.cwd, promptHistory, openai);
      generatedOptions = await generateFromEngine({ lookup, level, register, role, facts, factCap: 3 }, openai);
    } catch (err) {
      logger.debug('stop_engine_option_gen_error', { error: String(err) });
      generatedOptions = null;
    }
    let composePath: 'llm' | 'deterministic' = 'llm';
    if (!generatedOptions) {
      // The grounded engine failed (missing key / API error). Serve a DETERMINISTIC engine composition
      // from the record — no LLM, register/role-aware, safeguard-carrying — so the fallback needs no
      // static content. (Records are the whole content layer after the B11 cutover.)
      generatedOptions = composeDeterministicOptions({ lookup, level, register, role });
      composePath = 'deterministic';
    }
    // Record WHICH content variant was served (identity only — level / register /
    // role / record source / compose path; never any option text) so downstream
    // measurement can compare served variants against outcomes. Best-effort —
    // never blocks the popup.
    if (generatedOptions) {
      try {
        const served = resolveRecord(lookup);
        if (served) {
          appendVariantServedEvent(store, {
            projectRoot:     payload.cwd,
            sessionId:       mgr.current.sessionId,
            promptIndex:     Math.max(0, mgr.current.promptCount - 1),
            signalKey:       recordSignalType,
            stage:           mgr.current.currentStage,
            stageConfidence: mgr.current.stageConfidence,
            variant: {
              level, register, role, source: served.source, path: composePath,
              ...(activePin ? { experiment: activePin.experimentId } : {}),
            },
          });
        }
      } catch { /* variant logging is non-fatal */ }
    }
  }

  writeTelemetry(payload.cwd, 'stop_advisory_shown', {
    flagType:         advisory.flagType,
    stage:            advisory.stage,
    generatedOptions: !!generatedOptions,
  }, store);
  recordAdvisoryFired(store, payload.cwd);
  // On-mode: emit the advisory-fired event now (backdated). Off-mode buffers it
  // for the feedback-consent flush. Fire-and-forget so the popup is never blocked.
  void flushIfTelemetryOn(store).catch(() => {});

  const dsResult = await runDecisionSession(
    {
      stage:                advisory.stage,
      flagType:             advisory.flagType,
      pinchLabel:           advisory.pinchLabel,
      sessionId:            advisory.sessionId,
      projectRoot:          payload.cwd,
      promptCount:          advisory.promptCount,
      decisionSessionCount,
      generatedOptions:     generatedOptions ?? undefined,
      questionOverride,
      whyHelpOverride,
      profile:              mgr.current.profile,
      // Phase 4 — Item B: last-5 prompt metadata for decision_session_started.
      recentPrompts:        recentPromptMetadata(mgr.current.promptHistory),
    },
    store,
    effectiveSelectFn,
  );

  // Per-user auto-gen loop — after the popup, off its critical path. The current
  // fire already served (the preset, or a previously-cached per-user record); this
  // runs the one-time ranking and lazily generates the fired topic's per-user record
  // so the NEXT fire of a selected topic serves it. Best-effort — never breaks the outcome.
  if (recordSignalType && resolveContentSource(recordSignalType) === 'content-template') {
    await runAutogenForFire({
      store,
      projectRoot:  payload.cwd,
      signalType:   recordSignalType,
      currentLevel: (getUserDepthLevel(store, payload.cwd)?.currentLevel ?? 2) as MaturityLevel,
      rightGood:    loadRightGoodProfile(store, payload.cwd),
      client:       openai,
    });
  }

  if (dsResult.outcome === 'selected') {
    // Record the selection (timestamp only — no option text or index).
    recordOptionSelected(store, payload.cwd);
    // On-mode: emit the option-selected event now; off-mode buffers it for the
    // feedback-consent flush. Fire-and-forget so the block decision is not delayed.
    void flushIfTelemetryOn(store).catch(() => {});
    // Store injected text in session — auto reads and clears this on its next invocation
    // to skip all pipeline processing for the advisory-injected prompt.
    mgr.setInjectedPrompt(store, dsResult.selectedPrompt);
    logger.info('stop_blocked', { cwd: payload.cwd, reason: dsResult.selectedPrompt });
    return { outcome: 'blocked', reason: dsResult.selectedPrompt };
  }

  if (dsResult.outcome === 'clipboard_only') {
    // Copy-to-clipboard is also engagement with an option (timestamp only).
    recordOptionSelected(store, payload.cwd);
    logger.info('stop_clipboard_only', { cwd: payload.cwd });
    return { outcome: 'clipboard_only' };
  }

  logger.info('stop_skipped', { cwd: payload.cwd });
  return { outcome: 'skipped' };
}

// ── CLI entry point ────────────────────────────────────────────────────────────

export function registerStopCommand(program: import('commander').Command): void {
  program
    .command('stop')
    .description('Handle Claude Code Stop hook — show pending decision session UI if present')
    .option('--db <path>', 'Database path', DEFAULT_DB_PATH)
    .action(async (opts: { db: string }) => {
      const raw = await readStdin();
      if (!raw) process.exit(0);

      let payload: StopPayload;
      try {
        payload = JSON.parse(raw) as StopPayload;
      } catch {
        process.exit(0);
        return;
      }

      // Resolve OPENAI_API_KEY through the 4-layer chain (env → project .env →
      // OS keychain → 0600 fallback file). Matches the auto hook contract so the
      // stop hook works for every key source, not just project .env.
      await resolveOpenAIKey(payload.cwd);

      const store = await openStore(opts.db);
      const logLevel = getConfig(store.db, 'log_level') as LogLevel | undefined;
      initLogger('stop', logLevel);

      const keySource = await getKeySource(payload.cwd);
      const keyFound  = !!process.env['OPENAI_API_KEY'];
      logger.debug('env_load', { cwd: payload.cwd, keySource, keyFound });

      if (!keyFound) {
        logger.warn('openai_api_key_missing', {
          cwd:        payload.cwd,
          actionable: 'Set OPENAI_API_KEY in the shell, in the project\'s .env file, or via the OS keychain — decision option generation will fall back to static text until a key is configured.',
        });
      }

      // Owner decision B-i: the deferred PE popup is shown here on the Stop hook. Launch the
      // real spawned-terminal PE host; "Use enhanced" returns the enhanced body to inject as a
      // new turn. A GUI terminal is required — with no usable host the PE is skipped and the
      // advisory path runs instead.
      const peLaunch: PromptEnhancementStopLaunchFn = async (pending) => {
        const capability = resolvePromptEnhancementCliHostCapabilityV1();
        // Diagnosability (2026-08-06): record WHICH host branch the PE popup takes + whether the
        // pending row can open MPS — the two facts a missing-MPS report needs from the log.
        logger.debug('stop_pe_launch', {
          cwd: payload.cwd,
          capabilityState: capability.state,
          method: capability.state === 'available' ? capability.method : 'none',
          handoffPresent: Boolean(pending.result.uiView.handoffAndSequenceSummary),
        });
        if (capability.state === 'unavailable') return { kind: 'not_shown' };
        let popup: PromptEnhancementCliPopupResultV1;
        if (capability.method === 'direct_tty') {
          // MPS first popup (owner ruling 2026-08-06: CLI surface complete; extension surface stays
          // with host_transport). For a compound multi-intent prompt the engine emits a typed
          // handoff/sequence summary; when the CLI-scoped intake gate permits, show the MPS
          // sequence popup first — Enter injects the enhanced first prompt, Esc falls through to
          // the regular PE popup (full editing lives there). Fail-closed on any gate block.
          if (pending.result.uiView.handoffAndSequenceSummary) {
            const mpsEvidence = buildPromptEnhancementCliMpsIntakeEvidenceV1(pending.result);
            const mpsGate = evaluatePromptEnhancementMpsIntakeDecisionV1({
              surface: 'cli_stop_bridge',
              evidence: mpsEvidence ? [...mpsEvidence] : undefined,
            });
            logger.debug('stop_mps_intake_gate', {
              cwd: payload.cwd,
              renderPermission: mpsGate.renderPermission,
              reasonCodes: mpsGate.reasonCodes.slice(0, 6),
            });
            if (mpsGate.renderPermission === 'mps_render_permitted') {
              const mps = await runPromptEnhancementCliMpsFirstPopupV1({
                result: pending.result,
                // NF Plan B — content-free capture of the in-popup APPLY action (mps_apply_details),
                // mirroring the PE popup. The terminal outcome is captured just below.
                actionSignalSink: (kind, occurredAt) => recordActionSignal(store, payload.cwd, kind, occurredAt),
              });
              logger.info('stop_mps_first_popup', { cwd: payload.cwd, outcome: mps.state });
              // NF Plan B (B-3): content-free per-action capture of the MPS outcome (send/cancel/decline),
              // buffered locally, sent on the feedback-consent flush. Edits/not_shown map to undefined.
              const mpsActionKind = promptEnhancementMpsActionSignalKindV1(mps.state);
              if (mpsActionKind) recordActionSignal(store, payload.cwd, mpsActionKind);
              if (mps.state === 'send' && mps.bodyText.trim().length > 0) {
                recordPromptEnhancementShownMemoryV1(store, payload.cwd, pending.request);
                markPromptEnhancementUsedMemoryV1(store, payload.cwd, pending.request);
                // Continuation bookkeeping (2026-08-08): the user EXPLICITLY sent the first
                // sequence prompt — record the local pending-sequence row (ids/counts only,
                // never prompt text). Fail-closed typed no-op on any invalid handoff; the row
                // authorizes nothing by itself (the runtime gate stays the popup authority),
                // and nothing reads it until the continuation launcher exists.
                const sequenceIntake = intakePromptEnhancementSequenceOnFirstSendV1({
                  result: pending.result,
                  projectRoot: payload.cwd,
                  // The pending PE row's session is the one that prepared this sequence — the
                  // continuation row binds to it (a foreign-session row is scrubbed on read).
                  sessionId: pending.sessionId,
                });
                if (sequenceIntake.state === 'sequence_recorded') {
                  upsertPendingPromptSequence(store, sequenceIntake.runtime, sequenceIntake.payload);
                }
                logger.debug('stop_mps_sequence_intake', {
                  cwd: payload.cwd,
                  state: sequenceIntake.state,
                  ...(sequenceIntake.state === 'sequence_recorded'
                    ? { itemCount: sequenceIntake.runtime.itemCount }
                    : { reasonCode: sequenceIntake.reasonCode }),
                });
                return { kind: 'inject', text: mps.bodyText };
              }
              if (mps.state === 'cancelled') {
                // Cancel ends the flow (owner request 2026-08-06): the MPS shell already showed
                // the PEF feedback popup — the PE popup must NOT open. Record any collected
                // feedback (best-effort) and report shown, no injection.
                if (mps.feedback) {
                  const feedbackEvent = buildPromptEnhancementMpsCancelFeedbackEventV1(pending.result, mps.feedback, Date.now());
                  if (feedbackEvent) {
                    try {
                      await recordPromptEnhancementCliFeedbackV1(store, payload.cwd, feedbackEvent, pending.request);
                    } catch { /* feedback recording is best-effort — never blocks the cancel */ }
                  }
                }
                recordPromptEnhancementShownMemoryV1(store, payload.cwd, pending.request);
                return { kind: 'shown' };
              }
              // declined (Esc) / not_shown -> fall through to the regular PE popup below.
            }
          }
          // Primary path: render the PE popup in-process on /dev/tty (the same channel the
          // advisory uses on the Stop hook). The store lock stays held for the duration, matching
          // the advisory popup; feedback is recorded through the store-backed sink.
          popup = await runPromptEnhancementCliSubmitPopupV1({
            request: pending.request,
            result: pending.result,
            feedbackSink: (event) => recordPromptEnhancementCliFeedbackV1(store, payload.cwd, event, pending.request),
            // NF Plan B (B-2): content-free per-action telemetry — buffered locally, sent on the
            // feedback-consent flush (store-backed sink; in-process popup on the Stop hook).
            actionSignalSink: (kind, occurredAt) => recordActionSignal(store, payload.cwd, kind, occurredAt),
            costObservabilitySink: (result) => emitPromptEnhancementCostObservabilityV1(result, 'popup_action', logger),
            // F3 (2026-08-07): the popup keeps a failed action silent on screen — the typed
            // reason codes land here so the log stays the diagnosable source of truth.
            actionDiagnosticsSink: (event) => logger.debug('pe_action_failed', {
              cwd: payload.cwd,
              actionType: event.actionType,
              state: event.state,
              reasonCodes: event.reasonCodes.slice(0, 8),
            }),
          });
        } else {
          // No direct TTY but a GUI session exists: spawn a terminal popup. Release the DB lock
          // across the blocking child so the child process (its own connection) can reach the DB.
          releaseStoreLock(store);
          try {
            const launch = await runPromptEnhancementCliPopupHostLaunchV1({
              capability,
              request: pending.request,
              result: pending.result,
              cliEntryPath: process.argv[1] ?? '',
              dbPath: opts.db,
            });
            if (launch.state !== 'completed') return { kind: 'not_shown' };
            popup = launch.output.result;
          } finally {
            await reacquireStoreLock(store);
          }
        }
        // A popup that never actually rendered (e.g. no usable console) returns not_shown. Report it
        // honestly as not_shown — so the record stays pending and the advisory path runs — instead of
        // the previous false "shown" that consumed the record while nothing appeared on screen.
        if (validatePromptEnhancementCliPopupResultV1(popup) && popup.state === 'not_shown') {
          logger.debug('stop_prompt_enhancement_not_rendered', {
            cwd: payload.cwd,
            reasonCodes: 'reasonCodes' in popup ? popup.reasonCodes : undefined,
          });
          return { kind: 'not_shown' };
        }
        // The popup rendered: record that its Source-A signals were shown so the
        // missing-signal memory accumulates cross-session (E3/3.2b).
        recordPromptEnhancementShownMemoryV1(store, payload.cwd, pending.request);
        if (
          validatePromptEnhancementCliPopupResultV1(popup)
          && popup.state === 'selected_current'
          && typeof popup.bodyText === 'string'
          && popup.bodyText.length > 0
        ) {
          // The enhanced body was kept and injected: mark its Source-A signals used.
          markPromptEnhancementUsedMemoryV1(store, payload.cwd, pending.request);
          return { kind: 'inject', text: popup.bodyText };
        }
        return { kind: 'shown' };
      };

      try {
        const result = await runStop(payload, store, undefined, undefined, undefined, peLaunch);
        writeHookStats(payload.cwd, result.outcome);

        if (result.outcome === 'blocked') {
          process.stderr.write('\n[nexpath] Prompt sent to Claude\n');
          // sql.js (WASM) keeps the event loop alive after db.close(), so the
          // process never exits naturally. Claude Code's 60-second hook timeout
          // would kill us and discard stdout. Force-exit after the write so the
          // block decision reaches Claude Code on a clean exit.
          //
          // 🔒 MPS-9: any state needed for the delivery / pointer / cancel flow MUST be persisted
          // BEFORE this force-exit. `closeStore` → `saveStore` → `writeFileSync` is SYNCHRONOUS, so
          // every store write made during runStop is flushed to disk on the line below, before
          // process.exit(0). ⛔ NEVER launch sequence work as a fire-and-forget promise on this path
          // (cf. the `triggerOpportunisticSync` anti-pattern below) — process.exit(0) would kill an
          // un-awaited promise and silently lose the state. If sequence work must run here, `await` it
          // before this `closeStore`.
          closeStore(store);
          process.stdout.write(
            JSON.stringify({ decision: 'block', reason: result.reason }) + '\n',
          );
          process.exit(0);
        }

        if (result.outcome === 'clipboard_only') {
          if (platform === 'win32') {
            process.stderr.write('\n[nexpath] Copied to clipboard — paste and edit in Claude terminal\n');
          }
        }
        // ⚠️ MPS-9: this fire-and-forget shape is the exact anti-pattern the blocked-path guard above
        // warns against. It is fine HERE — best-effort telemetry on a NON-force-exit path (the `finally`
        // below closes the store after) — but sequence delivery/pointer/cancel state must NEVER be
        // launched this way before a force-exit.
        void triggerOpportunisticSync(store).catch(() => {});
        // All other outcomes → exit 0 (Claude stops normally)
      } finally {
        closeStore(store);
      }
    });
}
