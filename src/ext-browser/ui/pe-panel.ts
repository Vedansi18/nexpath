/**
 * nexpath prompt-enhancement panel — the browser rendering of the CLI popup's
 * locked layout (cli-submit-popup's target frame + the enhancement-popup UI
 * layout decision):
 *
 *   ▲ NEXPATH CLI                       (locked family wordmark, drag handle)
 *   Nexpath · Prompt enhancement        (engine title, verbatim)
 *   [pinch]  [why-help]                 (collapse absent rows)
 *   Use enhanced prompt                 (editor heading, verbatim)
 *   <ONE editable enhanced body>
 *   Additional details + Apply to prompt
 *   Adjust this version: Shorter · More thorough · More project-grounded
 *   [Use original prompt]  [Use enhanced prompt]     ✕ / Esc = close, no send
 *
 * Rendering rules carried from the decisions:
 *  - ONE body. No option list, no show-simpler, no variants (uiView invariant).
 *  - Dirty DETAILS disable "Use enhanced" — apply or clear, never silently
 *    sent or dropped.
 *  - Directional rows render only what the engine's controls carry, honouring
 *    availability (anything not 'available' is disabled, never hidden — the
 *    CLI popup lists them greyed the same way).
 *  - Esc = close-no-send; keydown is panel-scoped via composedPath (the
 *    shipped advisory panel's lesson) and stopPropagation'd so host-page
 *    hotkeys never fire underneath.
 *  - The advisory panel (panel.js) is untouched; this is a sibling with the
 *    same visual family (monospace, #310823, cyan accents, fixed width).
 *
 * The panel is DUMB by design: every user action becomes a command event; all
 * popup logic (F2 smooth send, refinement go-back stack, action failures)
 * lives in the engine's own state machine in the service worker.
 */

import type {
  PePanelAnyViewV1,
  PePanelCommandV1,
  PePanelControllerV1,
  PePanelEventV1,
  PeSequenceOfferViewV1,
  PePanelViewV1,
} from './pe-contract.js';

const STYLES = `
  .npe-root {
    font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, "Liberation Mono", ui-monospace, monospace;
    font-size: 12.5px;
    line-height: 16px;
    color: #f5f5f4;
    background: #310823;
    width: 620px;
    max-height: calc(100vh - 40px);
    max-width: calc(100vw - 24px);
    padding: 16px 20px;
    border-radius: 10px;
    box-shadow: 0 20px 50px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.04);
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    transition: opacity .15s ease, transform .15s ease;
  }
  .npe-root * { box-sizing: border-box; }
  .npe-root.npe-hidden { opacity: 0; transform: scale(.98); pointer-events: none; }
  .npe-root.npe-busy .npe-main { opacity: .4; pointer-events: none; }

  .npe-head { display:flex; align-items:center; }
  .npe-wordmark {
    display:flex; align-items:center; gap:6px; font-weight:700; letter-spacing:.5px;
    cursor: grab; -webkit-user-select:none; user-select:none; flex:1 1 auto;
  }
  .npe-wordmark:active { cursor: grabbing; }
  .npe-wordmark .tri { color:#2cc7dd; font-size:11px; }
  .npe-close {
    flex:0 0 auto; background:none; border:none; color:#9aa7a7; font:inherit;
    font-size:14px; cursor:pointer; padding:0 2px; line-height:1;
  }
  .npe-close:hover { color:#f5f5f4; }
  .npe-hr { border:none; border-top:1px solid rgba(154,167,167,.28); margin:6px 0 10px; flex:0 0 auto; }

  .npe-main { flex:1 1 auto; min-height:0; overflow-y:auto; display:flex; flex-direction:column; gap:8px;
    scrollbar-width: thin; scrollbar-color: #5a3a52 transparent; }
  .npe-main::-webkit-scrollbar { width:8px; }
  .npe-main::-webkit-scrollbar-thumb { background:#5a3a52; border-radius:4px; }

  .npe-title { font-weight:700; }
  .npe-pinch { color:#2cc7dd; }
  .npe-whyhelp { color:#c8b8c3; white-space:pre-wrap; }
  .npe-notice { color:#e8c07a; white-space:pre-wrap; }
  .npe-heading { font-weight:700; margin-top:2px; }
  .npe-muted { color:#9aa7a7; font-size:11.5px; }

  .npe-body, .npe-details {
    width:100%; background:#240619; color:#f5f5f4; border:1px solid rgba(154,167,167,.35);
    border-radius:6px; padding:8px; font:inherit; resize:vertical;
  }
  .npe-body { min-height:120px; }
  .npe-body:disabled { opacity:.6; }
  .npe-details { min-height:44px; }
  .npe-body:focus, .npe-details:focus { outline:1px solid #2cc7dd; }

  .npe-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .npe-btn {
    background:#4a1136; color:#f5f5f4; border:1px solid rgba(154,167,167,.4);
    border-radius:6px; padding:4px 10px; font:inherit; cursor:pointer;
  }
  .npe-btn:hover:not(:disabled) { border-color:#2cc7dd; }
  .npe-btn:disabled { opacity:.45; cursor:default; }
  .npe-btn-primary { background:#0e5a6b; border-color:#2cc7dd; font-weight:700; }
  .npe-link { background:none; border:none; color:#c9a96a; font:inherit; cursor:pointer; padding:0; }
  .npe-link:hover { text-decoration:underline; }

  .npe-footer { display:flex; gap:10px; justify-content:flex-end; margin-top:10px; flex:0 0 auto; }
  .npe-hint { color:#9aa7a7; font-size:11px; margin-top:6px; text-align:right; }
`;

const DIRECTIONAL_ORDER: ReadonlyArray<PePanelViewV1['directional'][number]['actionType']> = [
  'shorter', 'more_thorough', 'more_project_grounded',
];

export interface PePanelOptions {
  onEvent: (event: PePanelEventV1) => void;
}

export function mountNexpathPePanel(root: HTMLElement, opts: PePanelOptions): PePanelControllerV1 {
  const doc = root.ownerDocument;
  let view: PePanelAnyViewV1 | null = null;
  let open = false;
  let busy = false;

  const el = doc.createElement('div');
  el.className = 'npe-root npe-hidden';
  const style = doc.createElement('style');
  style.textContent = STYLES;
  root.appendChild(style);
  root.appendChild(el);

  const emitCommand = (command: PePanelCommandV1): void => {
    if (!view || busy) return;
    opts.onEvent({ type: 'command', viewSeq: view.viewSeq, command });
  };

  // ── Drag (wordmark handle → move events, engine moves the host) ─────────────
  let dragFrom: { x: number; y: number } | null = null;
  const onDragMove = (ev: MouseEvent): void => {
    if (!dragFrom) return;
    opts.onEvent({ type: 'move', dx: ev.clientX - dragFrom.x, dy: ev.clientY - dragFrom.y });
    dragFrom = { x: ev.clientX, y: ev.clientY };
  };
  const onDragEnd = (): void => { dragFrom = null; };
  doc.addEventListener('mousemove', onDragMove);
  doc.addEventListener('mouseup', onDragEnd);

  // ── Panel-scoped keys: Esc = close-no-send. stopPropagation so host-page
  //    hotkeys under the popup never fire (the shipped panel's lesson). ────────
  const onKeydown = (ev: KeyboardEvent): void => {
    if (!open || !ev.composedPath().includes(el)) return;
    ev.stopPropagation();
    if (ev.key === 'Escape') {
      ev.preventDefault();
      // CLI keyboard map: on the sequence offer Esc DECLINES (falls through to
      // the enhancement popup); on the PE view Esc closes with nothing sent.
      emitCommand(view && 'kind' in view && view.kind === 'sequence_offer'
        ? { type: 'mps_decline' }
        : { type: 'close' });
    }
  };
  doc.addEventListener('keydown', onKeydown, true);

  function currentBodyText(): string {
    const body = el.querySelector<HTMLTextAreaElement>('.npe-body');
    return body ? body.value : (view?.bodyText ?? '');
  }

  /** Locked wordmark head (drag handle + ✕) — shared by both view kinds. */
  function renderHead(onClose: () => void): void {
    const head = doc.createElement('div');
    head.className = 'npe-head';
    const wordmark = doc.createElement('div');
    wordmark.className = 'npe-wordmark';
    const tri = doc.createElement('span');
    tri.className = 'tri';
    tri.textContent = '▲';
    wordmark.appendChild(tri);
    wordmark.appendChild(doc.createTextNode('NEXPATH CLI'));
    wordmark.addEventListener('mousedown', (ev) => {
      dragFrom = { x: ev.clientX, y: ev.clientY };
      ev.preventDefault();
    });
    const close = doc.createElement('button');
    close.className = 'npe-close';
    close.textContent = '✕';
    close.title = 'Close (no send)';
    close.addEventListener('click', onClose);
    head.appendChild(wordmark);
    head.appendChild(close);
    el.appendChild(head);
    el.appendChild(Object.assign(doc.createElement('hr'), { className: 'npe-hr' }));
  }

  function render(v: PePanelViewV1): void {
    view = v;
    el.textContent = '';
    renderHead(() => emitCommand({ type: 'close' }));

    const main = doc.createElement('div');
    main.className = 'npe-main';
    el.appendChild(main);

    const line = (className: string, text: string): void => {
      const d = doc.createElement('div');
      d.className = className;
      d.textContent = text;
      main.appendChild(d);
    };

    line('npe-title', v.title);
    if (v.pinchLabel) line('npe-pinch', v.pinchLabel);
    if (v.whyHelp) line('npe-whyhelp', v.whyHelp);
    if (v.providerFailureNotice) line('npe-notice', v.providerFailureNotice);
    if (v.publicNotice) line('npe-notice', v.publicNotice);

    // ── The ONE editable enhanced body ──────────────────────────────────────────
    line('npe-heading', v.editorHeading);
    const body = doc.createElement('textarea');
    body.className = 'npe-body';
    body.value = v.bodyText;
    body.disabled = !v.bodyEditable;
    body.setAttribute('aria-label', v.editorHeading);
    main.appendChild(body);

    // ── Additional details + Apply to prompt (dirty details gate Use-enhanced) ──
    let details: HTMLTextAreaElement | null = null;
    let applyBtn: HTMLButtonElement | null = null;
    if (v.hasAdditionalDetails) {
      line('npe-heading', 'Additional details');
      details = doc.createElement('textarea');
      details.className = 'npe-details';
      details.value = v.additionalDetailsText;
      details.setAttribute('aria-label', 'Additional details');
      main.appendChild(details);
      const row = doc.createElement('div');
      row.className = 'npe-row';
      applyBtn = doc.createElement('button');
      applyBtn.className = 'npe-btn';
      applyBtn.textContent = 'Apply to prompt';
      applyBtn.addEventListener('click', () => {
        emitCommand({
          type: 'apply_details',
          bodyText: currentBodyText(),
          detailsText: details!.value,
        });
      });
      row.appendChild(applyBtn);
      main.appendChild(row);
    }

    // ── Adjust row (directional refinements, engine-supplied only) ─────────────
    if (v.directional.length > 0) {
      const row = doc.createElement('div');
      row.className = 'npe-row';
      const label = doc.createElement('span');
      label.className = 'npe-muted';
      label.textContent = 'Adjust this version:';
      row.appendChild(label);
      const byType = new Map(v.directional.map((d) => [d.actionType, d]));
      for (const actionType of DIRECTIONAL_ORDER) {
        const d = byType.get(actionType);
        if (!d) continue;
        const b = doc.createElement('button');
        b.className = 'npe-btn';
        b.textContent = d.label;
        b.disabled = d.availability !== 'available';
        b.addEventListener('click', () => {
          emitCommand({ type: actionType, bodyText: currentBodyText() });
        });
        row.appendChild(b);
      }
      main.appendChild(row);
    }

    if (v.refinement) {
      const back = doc.createElement('button');
      back.className = 'npe-link';
      back.textContent = '← Go back to the previous version';
      back.addEventListener('click', () => emitCommand({ type: 'go_back' }));
      main.appendChild(back);
    }

    // Feedback v1 (PB5): the CLI popup's two SUGGESTED categories, recorded as
    // content-free signals — no free-text field (typed feedback rows deferred,
    // PE-BR-11). Non-terminal: the popup stays open; the row acknowledges.
    if (v.hasFeedback) {
      const row = doc.createElement('div');
      row.className = 'npe-row';
      const label = doc.createElement('span');
      label.className = 'npe-muted';
      label.textContent = 'Feedback:';
      row.appendChild(label);
      const options: ReadonlyArray<['not_relevant_enough' | 'too_much_or_too_long', string]> = [
        ['not_relevant_enough', 'Not relevant enough'],
        ['too_much_or_too_long', 'Too much / too long'],
      ];
      for (const [category, text] of options) {
        const b = doc.createElement('button');
        b.className = 'npe-link';
        b.textContent = text;
        b.addEventListener('click', () => {
          emitCommand({ type: 'feedback_suggested', category });
          label.textContent = 'Feedback: thanks — noted.';
          row.querySelectorAll('button').forEach((btn) => { btn.disabled = true; });
        });
        row.appendChild(b);
      }
      main.appendChild(row);
    }

    for (const cue of v.trustCues) line('npe-muted', cue);

    // ── Footer ─────────────────────────────────────────────────────────────────
    const footer = doc.createElement('div');
    footer.className = 'npe-footer';
    const useOriginal = doc.createElement('button');
    useOriginal.className = 'npe-btn';
    useOriginal.textContent = 'Use original prompt';
    useOriginal.addEventListener('click', () => emitCommand({ type: 'use_original' }));
    const useEnhanced = doc.createElement('button');
    useEnhanced.className = 'npe-btn npe-btn-primary';
    useEnhanced.textContent = 'Use enhanced prompt';
    useEnhanced.addEventListener('click', () => {
      emitCommand({ type: 'use_current', bodyText: currentBodyText() });
    });
    footer.appendChild(useOriginal);
    footer.appendChild(useEnhanced);
    el.appendChild(footer);

    const hint = doc.createElement('div');
    hint.className = 'npe-hint';
    hint.textContent = 'Esc closes without sending';
    el.appendChild(hint);

    // Dirty-details rule: while the details text differs from the view's, the
    // enhanced body must not be sendable — Apply or clear, never silent.
    if (details) {
      const applyDirtyGate = (): void => {
        const dirty = details!.value !== v.additionalDetailsText;
        useEnhanced.disabled = dirty;
        useEnhanced.title = dirty ? 'Apply or clear the additional details first' : '';
        if (applyBtn) applyBtn.disabled = !dirty;
      };
      details.addEventListener('input', applyDirtyGate);
      applyDirtyGate();
    }
  }

  /** MPS-1 sequence offer (locked §3.3 rendered for the browser): first prompt
   * + plan + Send / continue-to-enhancement (Esc) / cancel ('Use original
   * prompt', the model's own row label). No sequence runtime exists here. */
  function renderOffer(v: PeSequenceOfferViewV1): void {
    view = v;
    el.textContent = '';
    // ✕ on the offer = decline (fall through to the enhancement popup) — the
    // offer has no silent-close outcome of its own in the CLI keyboard map.
    renderHead(() => emitCommand({ type: 'mps_decline' }));

    const main = doc.createElement('div');
    main.className = 'npe-main';
    el.appendChild(main);

    const line = (className: string, text: string): void => {
      const d = doc.createElement('div');
      d.className = className;
      d.textContent = text;
      main.appendChild(d);
    };

    line('npe-title', v.title);
    if (v.pinchLabel) line('npe-pinch', v.pinchLabel);
    if (v.whyHelp) line('npe-whyhelp', v.whyHelp);
    if (v.providerFailureNotice) line('npe-notice', v.providerFailureNotice);

    line('npe-heading', v.heading);
    const body = doc.createElement('textarea');
    body.className = 'npe-body';
    body.value = v.bodyText;
    body.setAttribute('aria-label', v.heading);
    main.appendChild(body);

    if (v.remainingTaskCount > 0) {
      line('npe-heading', `Then ${v.remainingTaskCount} more prompt${v.remainingTaskCount === 1 ? '' : 's'} in this sequence:`);
      for (const summary of v.taskSummaryLines) line('npe-muted', summary);
    }

    const footer = doc.createElement('div');
    footer.className = 'npe-footer';
    const cancel = doc.createElement('button');
    cancel.className = 'npe-btn';
    cancel.textContent = v.cancelLabel;
    cancel.addEventListener('click', () => emitCommand({ type: 'mps_cancel' }));
    const send = doc.createElement('button');
    send.className = 'npe-btn npe-btn-primary';
    send.textContent = 'Send first prompt';
    send.addEventListener('click', () => emitCommand({ type: 'mps_send', bodyText: currentBodyText() }));
    footer.appendChild(cancel);
    footer.appendChild(send);
    el.appendChild(footer);

    const hint = doc.createElement('div');
    hint.className = 'npe-hint';
    hint.textContent = 'Esc continues to the enhancement popup';
    el.appendChild(hint);
  }

  return {
    show(v: PePanelAnyViewV1): void {
      busy = false;
      el.classList.remove('npe-busy');
      if ('kind' in v) renderOffer(v);
      else render(v);
      open = true;
      el.classList.remove('npe-hidden');
      el.querySelector<HTMLTextAreaElement>('.npe-body')?.focus();
    },
    setBusy(b: boolean): void {
      busy = b;
      el.classList.toggle('npe-busy', b);
    },
    hide(): void {
      open = false;
      el.classList.add('npe-hidden');
    },
    destroy(): void {
      open = false;
      doc.removeEventListener('mousemove', onDragMove);
      doc.removeEventListener('mouseup', onDragEnd);
      doc.removeEventListener('keydown', onKeydown, true);
      el.remove();
      style.remove();
    },
    isOpen: () => open,
  };
}
