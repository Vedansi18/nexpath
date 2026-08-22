/**
 * Browser PE popup host — the service worker's mirror of the CLI's
 * `prompt-enhancement-popup-host` child process, with the ENGINE'S OWN popup
 * state machine (`runPromptEnhancementCliSubmitPopupV1`) doing all the logic.
 * The browser contributes exactly one thing: an injected `interaction` whose
 * `next(view)` pushes a whitelisted view to the content-script panel and
 * resolves with the user's next command. Everything else — F2 smooth send,
 * directional refinements, the go-back stack, F3 silent action failures,
 * sendability validation — is the CLI's shipped code path.
 *
 * A2 posture (SW must not be the only holder of the decision): the panel's
 * terminal clicks are ALSO reported through a one-way notice that consumes the
 * pending row on whatever SW instance is alive, the content side keeps a
 * fail-open timeout (nothing is ever sent on a dead SW), and while the popup
 * is open the content script heartbeats so MV3 keeps this instance alive.
 * Residual risk — a refinement round-trip dying with the SW — degrades to the
 * CLI's own F3 behaviour: previous body kept, reason in the log.
 */

import type { LogPort } from '../../core/ports/log.port.js';
import type {
  PromptEnhancementPrepareRequestV1,
  PromptEnhancementPrepareResultV1,
} from '../../prompt-enhancement/contracts.js';
import type { PendingPeRecord } from '../adapters/pe-pending-store.js';
import {
  emitPromptEnhancementCostObservabilityV1,
  refreshEngineKeyEnv,
  runPromptEnhancementCliSubmitPopupV1,
  type PromptEnhancementCliPopupCommandV1,
  type PromptEnhancementCliPopupInteractionV1,
  type PromptEnhancementCliPopupResultV1,
  type PromptEnhancementCliPopupViewV1,
} from './pe-engine.js';
import {
  PE_PANEL_SCHEMA_VERSION,
  isPePanelCommandV1,
  type PePanelCommandV1,
  type PePanelViewV1,
} from '../ui/pe-contract.js';

// ── Command mailbox ─────────────────────────────────────────────────────────────
//
// One live popup per project root. The panel posts commands as short-lived
// runtime messages; the popup loop's interaction awaits them here. Stale-guard:
// a command is accepted only when its echoed viewSeq matches the seq of the
// LAST view pushed — anything else is a late reply from a superseded render
// and is dropped with a log line (the plan's stale-result discipline).

interface Mailbox {
  expectedSeq: number;
  waiter: ((command: PePanelCommandV1) => void) | null;
  queued: PePanelCommandV1 | null;
}

const mailboxes = new Map<string, Mailbox>();

/** True while a popup loop is live for this root (guards double-open). */
export function isPePopupOpen(projectRoot: string): boolean {
  return mailboxes.has(projectRoot);
}

/**
 * Entry point for `nexpath:pe-command` messages. Returns true when the command
 * was delivered to a live popup loop.
 */
export function deliverPePanelCommand(
  log: LogPort,
  projectRoot: string,
  viewSeq: number,
  command: unknown,
): boolean {
  const box = mailboxes.get(projectRoot);
  if (!box) {
    log.debug('pe_command_no_popup', { projectRoot });
    return false;
  }
  if (!isPePanelCommandV1(command)) {
    log.debug('pe_command_invalid', { projectRoot });
    return false;
  }
  if (viewSeq !== box.expectedSeq) {
    log.debug('pe_command_stale', { projectRoot, viewSeq, expectedSeq: box.expectedSeq });
    return false;
  }
  if (box.waiter) {
    const w = box.waiter;
    box.waiter = null;
    w(command);
  } else if (box.queued === null) {
    box.queued = command;
  } else {
    // Two commands in flight for one view — the panel disables inputs while
    // busy, so this is a double-click race; keep the first, drop the second.
    log.debug('pe_command_dropped_duplicate', { projectRoot });
    return false;
  }
  return true;
}

// ── View projection ─────────────────────────────────────────────────────────────

/** Whitelist the engine's render view down to what the panel may see. */
export function buildPePanelView(
  view: PromptEnhancementCliPopupViewV1,
  viewSeq: number,
): PePanelViewV1 {
  const model = view.model;
  const directional = model.controls.directional
    .filter((d) =>
      d.action.actionType === 'shorter'
      || d.action.actionType === 'more_thorough'
      || d.action.actionType === 'more_project_grounded')
    .map((d) => ({
      actionType: d.action.actionType as 'shorter' | 'more_thorough' | 'more_project_grounded',
      label: d.action.label,
      availability: d.uiAvailabilityState,
    }));
  const out: PePanelViewV1 = {
    schemaVersion: PE_PANEL_SCHEMA_VERSION,
    viewSeq,
    title: model.title,
    editorHeading: model.editorHeading,
    bodyText: view.editedBodyText,
    bodyEditable: model.body.editable,
    hasAdditionalDetails: model.controls.additionalDetails !== undefined,
    additionalDetailsText: view.additionalDetailsText,
    directional,
    refinement: view.refinement === true,
    trustCues: model.publicCopy.trustCues.map((c) => c.publicSafeText),
  };
  if (model.pinchLabel) out.pinchLabel = model.pinchLabel.text;
  if (model.whyHelp) out.whyHelp = model.whyHelp.text;
  if (view.publicNotice) out.publicNotice = view.publicNotice;
  if (model.providerFailureNotice) out.providerFailureNotice = model.providerFailureNotice;
  return out;
}

// ── The interaction bridge ──────────────────────────────────────────────────────

/**
 * Translate one panel command into the engine loop's command, synthesizing an
 * `edit_body` first whenever the panel's body text drifted from the loop's —
 * the loop only learns of edits through edit_body, and the panel sends the
 * live text with every action instead of chatting on each keystroke.
 */
function translate(
  command: PePanelCommandV1,
  loopView: PromptEnhancementCliPopupViewV1,
): { first: PromptEnhancementCliPopupCommandV1; stash?: PromptEnhancementCliPopupCommandV1 } {
  const bodyText = 'bodyText' in command ? command.bodyText : undefined;
  const needsEdit = bodyText !== undefined
    && loopView.model.body.editable
    && bodyText.trim().length > 0
    && bodyText !== loopView.editedBodyText;
  const main: PromptEnhancementCliPopupCommandV1 =
    command.type === 'apply_details' ? { type: 'apply_details', text: command.detailsText }
    : command.type === 'use_current' ? { type: 'use_current' }
    : command.type === 'shorter' ? { type: 'shorter' }
    : command.type === 'more_thorough' ? { type: 'more_thorough' }
    : command.type === 'more_project_grounded' ? { type: 'more_project_grounded' }
    : command.type === 'use_original' ? { type: 'use_original' }
    : command.type === 'go_back' ? { type: 'go_back' }
    : { type: 'close' };
  if (needsEdit) return { first: { type: 'edit_body', text: bodyText }, stash: main };
  return { first: main };
}

export interface BrowserPePopupDeps {
  log: LogPort;
  projectRoot: string;
  apiKey: string | null;
  record: PendingPeRecord;
  /** tabs.sendMessage bound to the popup's tab; resolves with the content ack. */
  sendToTab: (msg: unknown) => Promise<unknown>;
  /** First successful render: consume the row + mark the cooldown. */
  onFirstRendered: () => Promise<void>;
  /** Injectable engine runner (tests); defaults to the real state machine. */
  runPopup?: typeof runPromptEnhancementCliSubmitPopupV1;
}

/**
 * Run the engine popup loop against the content-script panel. Resolves with
 * the CLI popup result; `not_shown` means the first render never reached the
 * panel and the pending row was left untouched (stop.ts's not_shown = keep).
 */
export async function runBrowserPePopup(
  deps: BrowserPePopupDeps,
): Promise<PromptEnhancementCliPopupResultV1> {
  const { log, projectRoot, record } = deps;
  if (mailboxes.has(projectRoot)) {
    log.debug('pe_popup_already_open', { projectRoot });
    return { state: 'not_shown', reasonCodes: ['popup_already_open'] };
  }
  const box: Mailbox = { expectedSeq: 0, waiter: null, queued: null };
  mailboxes.set(projectRoot, box);

  let seq = 0;
  let firstRenderOk = false;
  let renderFailed = false;
  let stashed: PromptEnhancementCliPopupCommandV1 | null = null;

  const interaction: PromptEnhancementCliPopupInteractionV1 = {
    next: async (view: PromptEnhancementCliPopupViewV1) => {
      seq += 1;
      box.expectedSeq = seq;
      box.queued = null;
      const payload = buildPePanelView(view, seq);
      try {
        await deps.sendToTab({ type: 'nexpath:show-pe', projectRoot, payload });
        if (!firstRenderOk) {
          firstRenderOk = true;
          await deps.onFirstRendered();
          log.debug('pe_popup_shown', { projectRoot, promptCount: record.promptCount });
        }
      } catch (err) {
        // No reachable panel. Before anything rendered → not_shown (row stays
        // pending). Mid-popup (tab closed) → close, nothing sent.
        renderFailed = true;
        log.debug('pe_popup_render_failed', { projectRoot, error: String(err) });
        return { type: 'close' };
      }
      if (stashed) {
        const cmd = stashed;
        stashed = null;
        return cmd;
      }
      const panelCommand = box.queued !== null
        ? Promise.resolve((() => { const q = box.queued as PePanelCommandV1; box.queued = null; return q; })())
        : new Promise<PePanelCommandV1>((resolve) => { box.waiter = resolve; });
      const received = await panelCommand;
      const { first, stash } = translate(received, view);
      if (stash) stashed = stash;
      return first;
    },
    close: () => {
      void deps.sendToTab({ type: 'nexpath:pe-close', projectRoot }).catch(() => { /* panel gone */ });
    },
  };

  try {
    refreshEngineKeyEnv(deps.apiKey);
    const runPopup = deps.runPopup ?? runPromptEnhancementCliSubmitPopupV1;
    const result = await runPopup({
      request: record.request as PromptEnhancementPrepareRequestV1,
      result: record.result as PromptEnhancementPrepareResultV1,
      interaction,
      // E9/CLI parity: per-action cost observability through the SW log (which
      // is also the persisted ring buffer).
      costObservabilitySink: (r) => {
        emitPromptEnhancementCostObservabilityV1(r, 'popup_action', log as never);
      },
      // F3: action failures render nothing — codes go to the log for post-hoc
      // diagnosis (mirror of the CLI host's actionDiagnosticsSink).
      actionDiagnosticsSink: (event) => log.debug('pe_action_failed', {
        projectRoot,
        actionType: event.actionType,
        state: event.state,
        reasonCodes: event.reasonCodes.slice(0, 8),
      }),
      // NF Plan B: content-free per-action signals (kind + timestamp only).
      actionSignalSink: (kind, occurredAt) => log.debug('pe_action_signal', { kind, occurredAt }),
    });
    if (renderFailed && !firstRenderOk) {
      return { state: 'not_shown', reasonCodes: ['panel_unreachable'] };
    }
    return result;
  } finally {
    interaction.close();
    mailboxes.delete(projectRoot);
  }
}
