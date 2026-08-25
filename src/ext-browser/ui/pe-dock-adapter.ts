/**
 * The bridge between the popup engine flow and the UI developer's dock (PR #1)
 * — the "producer" their typed model was designed for. It implements the same
 * controller contract my pe-panel exposed (PePanelControllerV1), so the
 * content-script wiring (pe-inject.ts) and everything SW-side stay byte-
 * identical; only the RENDERER changed.
 *
 *   my PePanelViewV1 / PeSequenceOfferViewV1  ──producers──▶  their SurfaceModel
 *   their SurfaceEvents / activation hook     ──mapping───▶  my PePanelCommandV1
 *
 * Flow decisions carried in (owner-approved 2026-08-25):
 *  - PEF-backed-by-signals: Esc / Use-original on the PE surface and Cancel on
 *    the MPS offer open the PEF feedback surface first (CLI §8.3); a category
 *    click records the content-free pe_feedback_suggested signal, then the
 *    remembered terminal command completes the flow; Esc on PEF skips straight
 *    to the terminal. v1 renders ONLY the two fixed categories — the CLI's
 *    free-text "Other" row is omitted because the browser stores no feedback
 *    text (typed feedback rows deferred, PE-BR-11).
 *  - Details-apply is the CLI's LOCAL merge (their controller does it); the
 *    merged body reaches the engine as its own edit_body command, so the
 *    engine's editedBodyText tracks what the user sees.
 *  - The dock's ✕ (window furniture) maps to plain close on every surface —
 *    window dismissal is not the CLI's Esc and skips PEF.
 *  - The activation hook returns 'refuse' after emitting, which suppresses the
 *    fixture era's "static build" notices; the engine's re-render is the echo.
 */

import type {
  PePanelAnyViewV1,
  PePanelCommandV1,
  PePanelControllerV1,
  PePanelEventV1,
  PeSequenceOfferViewV1,
  PePanelViewV1,
} from './pe-contract.js';
import type { SurfaceModel, SurfaceRow } from './surfaces/surface-model.js';
import { mountNexpathDock, type NexpathDockController } from './surfaces/dock.js';
import { installChromeStyles } from './surfaces/chrome.js';
import {
  createSurfaceController,
  type SurfaceController,
  type SurfaceEvent,
} from './surfaces/surface-controller.js';
import { fieldScroller } from './surfaces/surface-view.js';
import { BODY_HINT, DETAILS_HINT, EDIT_KEYS_HINT, PE_FOOTER } from './surfaces/fixtures/pe.js';
import { PEF_FOOTER } from './surfaces/fixtures/pef.js';
import { MPS_FIRST_FOOTER } from './surfaces/fixtures/mps.js';

const PEF_CATEGORY_BY_LABEL: Record<string, 'not_relevant_enough' | 'too_much_or_too_long'> = {
  'Not relevant enough': 'not_relevant_enough',
  'Too much or too long': 'too_much_or_too_long',
};

/** The terminal that completes the flow once the PEF surface resolves. */
type PendingTerminal = { type: 'close' } | { type: 'use_original' } | { type: 'mps_cancel' };

// ── producers: my views → their models ─────────────────────────────────────────

export function peSurfaceModel(view: PePanelViewV1): SurfaceModel {
  // The engine's editability verdict is SEND-PATH semantics, not styling: a
  // read-only fallback body (`editabilityState: 'read_only_fallback'`) rejects
  // every edit_body, and the host's translate() rightly never synthesizes one
  // for an uneditable body. Rendering such a body editable let the user type
  // text the send silently discarded (live on Replit + Lovable, 2026-08-25).
  // The CLI locks its WHOLE editor in this state — body and details together —
  // so both fields mirror that here.
  const locked = !view.bodyEditable;
  const rows: SurfaceRow[] = [
    {
      kind: 'field',
      label: view.editorHeading,
      text: view.bodyText,
      hints: { whenFocused: [`${EDIT_KEYS_HINT} · ${BODY_HINT}`] },
      ...(locked ? { readOnly: true } : {}),
    },
  ];
  if (view.hasAdditionalDetails) {
    rows.push({
      kind: 'field',
      label: 'Additional details',
      text: view.additionalDetailsText,
      hints: { always: [DETAILS_HINT], whenFocused: [EDIT_KEYS_HINT] },
      blankBefore: true,
      ...(locked ? { readOnly: true } : {}),
    });
  }
  for (const d of view.directional) {
    // Availability travels via the row label lookup in the activation hook;
    // rows render CLI-style regardless (disabled = silent guard, never hidden).
    rows.push({ kind: 'action', label: d.label, blankBefore: d === view.directional[0] });
  }
  if (view.refinement) rows.push({ kind: 'action', label: 'Go back' });
  rows.push({ kind: 'action', label: 'Use original prompt', act: 'use-original', blankBefore: true });

  const model: SurfaceModel = {
    id: 'prompt_enhancement',
    label: 'Prompt enhancement',
    rows,
    footer: PE_FOOTER,
  };
  if (view.pinchLabel) model.pinch = view.pinchLabel;
  if (view.whyHelp) model.whyHelp = view.whyHelp;
  if (view.trustCues.length > 0) model.trustCues = view.trustCues;
  if (view.providerFailureNotice) model.providerFailure = view.providerFailureNotice;
  return model;
}

export function mpsSurfaceModel(view: PeSequenceOfferViewV1): SurfaceModel {
  const rows: SurfaceRow[] = [
    {
      kind: 'field',
      label: view.heading,
      text: view.bodyText,
      hints: { whenFocused: [`${EDIT_KEYS_HINT} · ${BODY_HINT}`] },
    },
  ];
  if (view.remainingTaskCount > 0) {
    rows.push({ kind: 'note', text: 'Sequence plan', indent: 2, tone: 'plain', blankBefore: true });
    for (const line of view.taskSummaryLines) {
      rows.push({ kind: 'note', text: line, indent: 4, tone: 'dim' });
    }
  }
  rows.push({
    kind: 'action',
    label: view.cancelLabel,
    act: 'cancel-sequence',
    tone: 'cancel',
    blankBefore: true,
  });

  const model: SurfaceModel = {
    id: 'mps_first',
    label: 'Multi-prompt sequence',
    rows,
    footer: MPS_FIRST_FOOTER,
  };
  if (view.pinchLabel) model.pinch = view.pinchLabel;
  if (view.whyHelp) model.whyHelp = view.whyHelp;
  if (view.providerFailureNotice) model.providerFailure = view.providerFailureNotice;
  return model;
}

/** v1 PEF: the two fixed categories only (content-free signals; no free text). */
export function pefSurfaceModel(): SurfaceModel {
  return {
    id: 'prompt_enhancement_feedback',
    label: 'Prompt enhancement feedback',
    fieldIndent: 6,
    hintIndent: 6,
    rows: [
      { kind: 'action', label: 'Not relevant enough' },
      { kind: 'action', label: 'Too much or too long' },
    ],
    footer: PEF_FOOTER,
  };
}

// ── the adapter ────────────────────────────────────────────────────────────────

export interface PeDockAdapterOptions {
  onEvent: (event: PePanelEventV1) => void;
  /** Document override for tests. */
  doc?: Document;
}

export function mountNexpathPeDock(opts: PeDockAdapterOptions): PePanelControllerV1 {
  let dock: NexpathDockController | null = null;
  let surfaces: SurfaceController | null = null;
  let view: PePanelAnyViewV1 | null = null;
  let busy = false;
  let busyOverlay: HTMLDivElement | null = null;
  let pendingTerminal: PendingTerminal | null = null;
  /** One-shot: the NEXT show() is the engine's echo of a details apply — the
   * rebuild parks the view at the top, but the CLI's apply behaviour is "the
   * view scrolls to where the details landed" (cli-submit-popup.ts:1037), so
   * that one rebuild must follow the caret (parked at the body's end). */
  let followCaretOnNextShow = false;

  const doc = opts.doc ?? document;

  const emitCommand = (command: PePanelCommandV1): void => {
    if (!view || busy) return;
    opts.onEvent({ type: 'command', viewSeq: view.viewSeq, command });
  };

  /** Complete a PEF resolution: fire the remembered terminal (if any). */
  const completePending = (): void => {
    const terminal = pendingTerminal;
    pendingTerminal = null;
    if (terminal) emitCommand(terminal);
  };

  const directionalByLabel = (label: string): PePanelViewV1['directional'][number] | undefined =>
    view && !('kind' in view) ? view.directional.find((d) => d.label === label) : undefined;

  /** Their activation hook — my commands come out of here, their notices never fire. */
  const resolveActivation = (
    model: SurfaceModel,
    row: SurfaceRow,
    bodyText: string,
  ): { model: SurfaceModel } | 'refuse' | null => {
    if (row.kind === 'note') return 'refuse';

    if (model.id === 'prompt_enhancement_feedback') {
      if (row.kind === 'action') {
        const category = PEF_CATEGORY_BY_LABEL[row.label];
        if (category) emitCommand({ type: 'feedback_suggested', category });
        completePending();
        return 'refuse';
      }
      return 'refuse';
    }

    if (row.kind === 'field') {
      // Only the BODY field's Enter is ours (send); the details field falls
      // through to the controller's CLI-parity local merge.
      const isBody = model.rows.find((r) => r.kind === 'field') === row;
      if (!isBody) return null;
      if (bodyText.trim().length === 0) return 'refuse'; // BF-1 silent guard
      emitCommand(model.id === 'mps_first'
        ? { type: 'mps_send', bodyText }
        : { type: 'use_current', bodyText });
      return 'refuse';
    }

    // Action rows.
    if (row.act === 'use-original') {
      pendingTerminal = { type: 'use_original' };
      return { model: pefSurfaceModel() };
    }
    if (row.act === 'cancel-sequence') {
      pendingTerminal = { type: 'mps_cancel' };
      return { model: pefSurfaceModel() };
    }
    if (row.label === 'Go back') {
      emitCommand({ type: 'go_back' });
      return 'refuse';
    }
    const directional = directionalByLabel(row.label);
    if (directional) {
      if (directional.availability !== 'available') return 'refuse'; // CLI silent guard
      emitCommand({ type: directional.actionType, bodyText });
      return 'refuse';
    }
    return 'refuse'; // unknown rows never fall to the fixture-era notice
  };

  const onSurfaceEvent = (event: SurfaceEvent): void => {
    switch (event.type) {
      case 'apply-details':
        // The controller already merged locally (CLI parity); tell the engine
        // so its editedBodyText tracks what the user now sees. The engine's
        // re-render echo rebuilds this surface — keep the CLI's scrolled-to-
        // the-merge position across that rebuild.
        followCaretOnNextShow = true;
        emitCommand({ type: 'edit_body', bodyText: event.mergedBody });
        return;
      case 'cancelled':
        // Esc on the PE surface: the controller has switched to PEF itself.
        pendingTerminal = { type: 'close' };
        return;
      case 'declined':
        // Esc on the MPS offer with no editor focused.
        emitCommand({ type: 'mps_decline' });
        return;
      case 'feedback-skipped':
        completePending();
        return;
      default:
        return; // send/use-original/cancel-sequence/feedback are hook-intercepted
    }
  };

  const ensureDock = (): NexpathDockController => {
    if (dock) return dock;
    // Stale-dock sweep: an extension reload leaves the previous content-script
    // generation's MAIN-world module alive on SPA pages, and its window-event
    // listeners still mount THEIR dock on the next show — two identical docks
    // stack and the user types into whichever paints on top while only ours
    // talks to a live service worker. Any host from another generation dies
    // here, before ours mounts (its orphaned controller then toggles a
    // detached element — harmless).
    for (const stale of doc.querySelectorAll('#nexpath-dock-host')) stale.remove();
    dock = mountNexpathDock({
      doc,
      onEvent: () => {
        // The dock's ✕ — window furniture, not the CLI's Esc: plain close.
        emitCommand(view && 'kind' in view ? { type: 'mps_decline' } : { type: 'close' });
        dock?.hide();
      },
    });
    // The CLI frame's stylesheet lives in chrome.ts and must be installed into
    // the dock's shadow root ONCE, exactly as the harness does — without it the
    // surfaces render as unstyled transparent text over the agent page
    // (live-caught on Bolt, 2026-08-25).
    installChromeStyles(dock.mountEl.getRootNode() as ShadowRoot);
    return dock;
  };

  const setBusyOverlay = (on: boolean): void => {
    const host = surfaces?.element.parentElement ?? null;
    if (!host) return;
    if (on) {
      if (busyOverlay) return;
      busyOverlay = doc.createElement('div');
      busyOverlay.className = 'np-busy-overlay';
      busyOverlay.style.cssText =
        'position:absolute;inset:0;background:rgba(20,3,15,.45);cursor:progress;z-index:10;';
      host.style.position = 'relative';
      host.appendChild(busyOverlay);
    } else {
      busyOverlay?.remove();
      busyOverlay = null;
    }
  };

  return {
    show(v: PePanelAnyViewV1): void {
      busy = false;
      view = v;
      pendingTerminal = null;
      const d = ensureDock();
      // The dock must be VISIBLE before the surface renders: the controller's
      // render() focuses the active field, and focus() inside a display:none
      // subtree is a silent no-op — the popup then opens with the keyboard
      // still in the agent page and every arrow key dead until the user
      // clicks it (live on Replit + Lovable, 2026-08-25). Everything below
      // runs in the same task, so no intermediate frame ever paints.
      d.show();
      surfaces?.destroy();
      const isOffer = 'kind' in v;
      const registry = isOffer
        ? { mps_first: mpsSurfaceModel(v), prompt_enhancement_feedback: pefSurfaceModel() }
        : { prompt_enhancement: peSurfaceModel(v), prompt_enhancement_feedback: pefSurfaceModel() };
      surfaces = createSurfaceController(d.mountEl, {
        registry,
        initial: isOffer ? 'mps_first' : 'prompt_enhancement',
        doc,
        onEvent: onSurfaceEvent,
        resolveActivation,
      });
      setBusyOverlay(false);
      if (followCaretOnNextShow) {
        followCaretOnNextShow = false;
        const bodyField = surfaces.element.querySelector('textarea');
        if (bodyField) fieldScroller.follow(bodyField);
      }
    },
    setBusy(b: boolean): void {
      busy = b;
      setBusyOverlay(b);
    },
    hide(): void {
      dock?.hide();
    },
    destroy(): void {
      surfaces?.destroy();
      surfaces = null;
      dock?.destroy();
      dock = null;
      view = null;
    },
    isOpen: () => dock?.isVisible() ?? false,
  };
}
