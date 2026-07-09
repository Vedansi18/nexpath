// ============================================================================
// nexpath advisory panel — panel.js
// ----------------------------------------------------------------------------
// Visual reference: nexpath-popup.html (approved). Contract wiring unchanged
// from panel.skeleton.js. This revision closes the 4 CLI-parity gaps from
// v0.1.5-UI-DEV-cli-parity-gaps.md / v0.1.5-ui-panel-cli-parity-brief.md §7:
//   1. centered placement — engine's job; we simply don't set our own position.
//   2. fixed width/min-height so the box doesn't resize between L1/L2/L3/confirm.
//   3. "Send to your agent now / Copy to clipboard" confirm screen after a pick.
//   4. draggable header, emitting { type:'move', dx, dy }.
// Plus: keydown scoped to the panel via e.composedPath().includes(el).
// Ship alongside panel.d.ts (unchanged).
// ============================================================================

const LEVEL_SUBTITLE = {
  L1: '',
  L2: '— lighter options',
  L3: '— minimum viable step',
};

const LEVEL_ORDER = ['L1', 'L2', 'L3'];

// Palette carried over 1:1 from the approved nexpath-popup.html mockup.
const STYLES = `
  .np-root {
    font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, "Liberation Mono", ui-monospace, monospace;
    font-size: 12.5px;
    line-height: 15px;
    color: #f5f5f4;
    background: #310823;
    /* #2: fixed size across L1/L2/L3/confirm — do not let content reflow the box.
       No position/inset here — the engine centers the host; we just size to content. */
    width: 620px;
    min-height: 460px;
    max-width: calc(100vw - 24px);
    padding: 16px 20px 16px 12px;
    border-radius: 10px;
    box-shadow: 0 20px 50px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.04);
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    transition: opacity .15s ease, transform .15s ease;
  }
  .np-root * { box-sizing: border-box; }
  .np-root.np-hidden { opacity: 0; transform: scale(.98); pointer-events: none; }

  .np-wordmark {
    display:flex; align-items:center; gap:6px; font-weight:700; letter-spacing:.5px;
    padding-left:6px; cursor: grab; -webkit-user-select:none; user-select:none;
  }
  .np-wordmark:active { cursor: grabbing; }
  .np-wordmark .tri { color:#2cc7dd; font-size:11px; }
  .np-hr { border:none; border-top:1px solid rgba(154,167,167,.28); margin:6px 0 10px; flex: 0 0 auto; }

  .np-body-wrap { flex: 1 1 auto; display:flex; flex-direction:column; min-height:0; }
  .np-root.np-busy .np-body-wrap { opacity:.4; pointer-events:none; }

  .np-row { display:flex; }
  .np-rail { flex:0 0 20px; color:#2a667b; padding-left:2px; }
  .np-content { flex:1 1 auto; min-width:0; overflow-wrap: break-word; }

  .np-pinch-row .np-content { color:#2cc7dd; font-weight:700; }
  .np-pinch-row .np-rail { color:#2cc7dd; }
  .np-subtitle { color:#9ba7a7; font-weight:400; font-size:11px; margin-left:6px; }

  .np-question-row { margin-top:2px; }
  .np-question-row .np-content { color:#f5f5f4; font-weight:700; }

  .np-why-row .np-content { color:#9ba7a7; }

  .np-options { margin-top:10px; }

  .np-option { margin-top:6px; cursor:pointer; }
  .np-option .np-label-row { display:flex; }
  .np-option .np-bullet { flex:0 0 20px; color:#7d8686; }
  .np-option.np-focused .np-bullet { color:#1ca46d; }
  .np-option .np-label { color:#a8a9a8; }
  .np-option.np-focused .np-label { color:#f5f5f4; font-weight:600; }

  .np-body-row .np-content { color:#8a8f8f; font-style:italic; }
  .np-hint-row .np-content { color:#9ba7a7; font-style:italic; }

  .np-control { margin-top:8px; cursor:pointer; }
  .np-control .np-label-row { display:flex; }
  .np-control .np-bullet { flex:0 0 20px; color:#7d8686; }
  .np-control.np-focused .np-bullet { color:#1ca46d; }
  .np-control .np-label { color:#a8a9a8; }
  .np-control.np-focused .np-label { color:#f5f5f4; }
  .np-control .np-control-sub { color:#7a8494; font-size:11px; margin-left:4px; }

  .np-footer {
    margin-top:auto; padding-top:8px; padding-left:20px; font-size:11px; font-style:italic;
    color:#6f7373; border-top:1px solid rgba(154,167,167,.16); flex: 0 0 auto;
  }
  .np-footer a { color:#c9a96a; cursor:pointer; text-decoration:none; }
  .np-footer a:hover { text-decoration:underline; }
  .np-footer .np-sep { margin:0 4px; opacity:.6; }

  .np-spinner { margin-top:10px; padding-left:20px; color:#9ba7a7; font-style:italic; }

  /* Confirm screen */
  .np-confirm-hint { color:#9ba7a7; font-style:italic; padding-left:20px; margin-bottom:14px; }
  .np-back { margin-top:14px; padding-left:20px; font-size:11px; font-style:italic; color:#7a8494; cursor:pointer; }
  .np-back:hover { color:#c9a96a; }
`;

export function mountNexpathPanel(root, { onEvent }) {
  // ── instance state ────────────────────────────────────────────────────────
  let payload = null;
  let currentLevel = 'L1';
  let focusedIndex = 0;
  const expanded = new Set();
  let busy = false;

  let view = 'options';        // 'options' | 'confirm'
  let pendingOption = null;    // option awaiting send/copy decision
  let confirmFocusedIndex = 0; // 0 = send now, 1 = copy

  // ── DOM scaffold (built once) ─────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = STYLES;
  root.appendChild(style);

  const el = document.createElement('div');
  el.className = 'np-root np-hidden';
  el.tabIndex = -1;              // focusable so composedPath() scoping works even if the
  el.style.outline = 'none';     // engine forgets to focus us; we focus ourselves on show().
  root.appendChild(el);

  const head = document.createElement('div');
  head.innerHTML = `<div class="np-wordmark"><span class="tri">▲</span>NEXPATH</div>`;
  const hr = document.createElement('hr');
  hr.className = 'np-hr';
  el.appendChild(head);
  el.appendChild(hr);

  const bodyWrap = document.createElement('div');
  bodyWrap.className = 'np-body-wrap';
  el.appendChild(bodyWrap);

  // ── helpers ───────────────────────────────────────────────────────────────
  function levelOptions() {
    return (payload && payload.levels && payload.levels[currentLevel]) || [];
  }

  function focusables() {
    const rows = levelOptions().map((opt) => ({ kind: 'option', opt }));
    if (LEVEL_ORDER.indexOf(currentLevel) < LEVEL_ORDER.length - 1) {
      rows.push({ kind: 'show-simpler' });
    }
    rows.push({ kind: 'skip' });
    return rows;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // ── event emitters (frozen contract — payload shapes unchanged) ────────────
  function emitSelect(opt)   { onEvent({ type: 'select', optionId: opt.id, body: opt.body }); }
  function emitCopy(opt)     { onEvent({ type: 'copy', optionId: opt.id }); }
  function emitSkip()        { onEvent({ type: 'skip' }); }
  function emitDismiss()     { onEvent({ type: 'dismiss' }); }
  function emitDisable()     { onEvent({ type: 'disable-project' }); }
  function emitSettings()    { onEvent({ type: 'open-settings' }); }
  function emitMove(dx, dy)  { onEvent({ type: 'move', dx, dy }); }
  function emitShowSimpler() {
    onEvent({ type: 'show-simpler' });
    const i = LEVEL_ORDER.indexOf(currentLevel);
    if (i < LEVEL_ORDER.length - 1) {
      currentLevel = LEVEL_ORDER[i + 1];
      focusedIndex = 0;
      render();
    }
  }

  // ── activation ────────────────────────────────────────────────────────────
  // #3: picking an option no longer selects immediately — it opens the confirm screen.
  function activate(row) {
    if (busy || !row) return;
    if (row.kind === 'option') {
      pendingOption = row.opt;
      view = 'confirm';
      confirmFocusedIndex = 0;
      render();
    } else if (row.kind === 'show-simpler') {
      emitShowSimpler();
    } else if (row.kind === 'skip') {
      emitSkip();
    }
  }

  function activateConfirm(index) {
    if (busy || !pendingOption) return;
    if (index === 0) {
      emitSelect(pendingOption);
    } else {
      emitCopy(pendingOption);
      // Copy keeps the panel open (per contract) — return to the option list.
      view = 'options';
      pendingOption = null;
      render();
    }
  }

  function backFromConfirm() {
    view = 'options';
    pendingOption = null;
    render();
  }

  // ── render: options view ─────────────────────────────────────────────────
  function renderOptionsView() {
    const rows = focusables();
    if (focusedIndex >= rows.length) focusedIndex = rows.length - 1;

    const pinchRow = document.createElement('div');
    pinchRow.className = 'np-row np-pinch-row';
    pinchRow.innerHTML =
      `<div class="np-rail">◆</div>` +
      `<div class="np-content">${escapeHtml(payload.pinchLabel)}` +
      (LEVEL_SUBTITLE[currentLevel] ? `<span class="np-subtitle">${LEVEL_SUBTITLE[currentLevel]}</span>` : '') +
      `</div>`;
    bodyWrap.appendChild(pinchRow);

    const qRow = document.createElement('div');
    qRow.className = 'np-row np-question-row';
    qRow.innerHTML = `<div class="np-rail">│</div><div class="np-content">${escapeHtml(payload.question)}</div>`;
    bodyWrap.appendChild(qRow);

    if (payload.whyHelp) {
      payload.whyHelp.split('\n').forEach((line) => {
        const whyRow = document.createElement('div');
        whyRow.className = 'np-row np-why-row';
        whyRow.innerHTML = `<div class="np-rail">│</div><div class="np-content">${escapeHtml(line)}</div>`;
        bodyWrap.appendChild(whyRow);
      });
    }

    const optionsWrap = document.createElement('div');
    optionsWrap.className = 'np-options';

    rows.forEach((row, i) => {
      const focused = i === focusedIndex;

      if (row.kind === 'option') {
        const opt = row.opt;
        const node = document.createElement('div');
        node.className = 'np-option' + (focused ? ' np-focused' : '');

        const labelRow = document.createElement('div');
        labelRow.className = 'np-label-row';
        labelRow.innerHTML =
          `<div class="np-bullet">${focused ? '●' : '○'}</div>` +
          `<div class="np-label">${escapeHtml(opt.title)}</div>`;
        labelRow.addEventListener('click', () => { focusedIndex = i; activate(row); });
        node.appendChild(labelRow);

        if (expanded.has(opt.id)) {
          const bodyRow = document.createElement('div');
          bodyRow.className = 'np-row np-body-row';
          bodyRow.innerHTML = `<div class="np-rail">│</div><div class="np-content">↳ ${escapeHtml(opt.body)}</div>`;
          node.appendChild(bodyRow);
        }

        if (focused) {
          const hintRow = document.createElement('div');
          hintRow.className = 'np-row np-hint-row';
          hintRow.innerHTML = `<div class="np-rail"></div><div class="np-content">press Space for details</div>`;
          node.appendChild(hintRow);
        }

        optionsWrap.appendChild(node);
      } else {
        const node = document.createElement('div');
        node.className = 'np-control' + (focused ? ' np-focused' : '');
        const labelRow = document.createElement('div');
        labelRow.className = 'np-label-row';
        if (row.kind === 'show-simpler') {
          labelRow.innerHTML = `<div class="np-bullet">${focused ? '●' : '○'}</div><div class="np-label">Show simpler options →</div>`;
        } else {
          labelRow.innerHTML =
            `<div class="np-bullet">${focused ? '●' : '○'}</div>` +
            `<div class="np-label">Skip for now<span class="np-control-sub">  — nexpath optimize will remind you</span></div>`;
        }
        labelRow.addEventListener('click', () => { focusedIndex = i; activate(row); });
        node.appendChild(labelRow);
        optionsWrap.appendChild(node);
      }
    });

    bodyWrap.appendChild(optionsWrap);

    const footer = document.createElement('div');
    footer.className = 'np-footer';
    footer.innerHTML =
      `don't need nexpath here? <a data-np="disable">Disable for this project</a>` +
      `<span class="np-sep">·</span><a data-np="settings">Adjust frequency or role</a>`;
    footer.querySelector('[data-np="disable"]').addEventListener('click', emitDisable);
    footer.querySelector('[data-np="settings"]').addEventListener('click', emitSettings);
    bodyWrap.appendChild(footer);
  }

  // ── render: confirm view (#3) ─────────────────────────────────────────────
  function renderConfirmView() {
    const hint = document.createElement('div');
    hint.className = 'np-confirm-hint';
    hint.textContent = '↵ hit enter to send directly to your agent';
    bodyWrap.appendChild(hint);

    const pinchRow = document.createElement('div');
    pinchRow.className = 'np-row np-pinch-row';
    pinchRow.innerHTML = `<div class="np-rail">◆</div><div class="np-content">What would you like to do?</div>`;
    bodyWrap.appendChild(pinchRow);

    const optionsWrap = document.createElement('div');
    optionsWrap.className = 'np-options';

    const choices = [
      { label: 'Send to your agent now' },
      { label: 'Copy to clipboard — edit before sending' },
    ];
    choices.forEach((choice, i) => {
      const focused = i === confirmFocusedIndex;
      const node = document.createElement('div');
      node.className = 'np-option' + (focused ? ' np-focused' : '');
      const labelRow = document.createElement('div');
      labelRow.className = 'np-label-row';
      labelRow.innerHTML =
        `<div class="np-bullet">${focused ? '●' : '○'}</div>` +
        `<div class="np-label">${choice.label}</div>`;
      labelRow.addEventListener('click', () => { confirmFocusedIndex = i; activateConfirm(i); });
      node.appendChild(labelRow);
      optionsWrap.appendChild(node);
    });

    bodyWrap.appendChild(optionsWrap);

    const back = document.createElement('div');
    back.className = 'np-back';
    back.textContent = '← back  (Esc)';
    back.addEventListener('click', backFromConfirm);
    bodyWrap.appendChild(back);
  }

  // ── render (dispatch) ────────────────────────────────────────────────────
  function render() {
    if (!payload) return;
    bodyWrap.innerHTML = '';

    if (view === 'confirm') {
      renderConfirmView();
    } else {
      renderOptionsView();
    }

    el.classList.toggle('np-busy', busy);
    const oldSpinner = el.querySelector('.np-spinner');
    if (oldSpinner) oldSpinner.remove();
    if (busy) {
      const s = document.createElement('div');
      s.className = 'np-spinner';
      s.textContent = 'Working…';
      el.appendChild(s);
    }
  }

  // ── keyboard (per-instance; removed in destroy; scoped to this panel) ──────
  function onKeyDown(e) {
    if (el.classList.contains('np-hidden') || busy) return;
    // Scope to this panel only — don't hijack typing elsewhere on the host page.
    if (typeof e.composedPath === 'function' && !e.composedPath().includes(el)) return;

    // CLI-parity keyboard shortcut: Ctrl+X = disable for this project (TtySelectFn \x18).
    // Works in any view. (The CLI's Ctrl+T for frequency/role is NOT bound here: Ctrl+T is
    // the browser's own new-tab shortcut and can't be reliably intercepted by page JS, so
    // "Adjust frequency or role" stays a clickable footer link instead.)
    if ((e.ctrlKey || e.metaKey) && (e.key === 'x' || e.key === 'X')) {
      emitDisable(); e.preventDefault(); return;
    }

    if (view === 'confirm') {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        confirmFocusedIndex = confirmFocusedIndex === 0 ? 1 : 0;
        render(); e.preventDefault();
      } else if (e.key === 'Enter') {
        activateConfirm(confirmFocusedIndex); e.preventDefault();
      } else if (e.key === 'Escape') {
        backFromConfirm(); e.preventDefault();
      }
      return;
    }

    const rows = focusables();
    if (e.key === 'ArrowDown') { focusedIndex = Math.min(rows.length - 1, focusedIndex + 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { focusedIndex = Math.max(0, focusedIndex - 1); render(); e.preventDefault(); }
    else if (e.key === 'Enter') { activate(rows[focusedIndex]); e.preventDefault(); }
    else if (e.key === 'Escape') { emitSkip(); e.preventDefault(); } // CLI parity: Esc = skip (was dismiss)
    else if (e.key === ' ') {
      const row = rows[focusedIndex];
      if (row && row.kind === 'option') {
        if (expanded.has(row.opt.id)) expanded.delete(row.opt.id); else expanded.add(row.opt.id);
        render();
      }
      e.preventDefault();
    }
  }
  document.addEventListener('keydown', onKeyDown, true);

  // ── draggable header (#4) ────────────────────────────────────────────────
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  function onHeaderPointerDown(e) {
    if (busy) return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    head.setPointerCapture && head.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function onHeaderPointerMove(e) {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    if (dx !== 0 || dy !== 0) emitMove(dx, dy);
  }
  function onHeaderPointerUp(e) {
    dragging = false;
    head.releasePointerCapture && e.pointerId != null && head.releasePointerCapture(e.pointerId);
  }
  head.addEventListener('pointerdown', onHeaderPointerDown);
  head.addEventListener('pointermove', onHeaderPointerMove);
  head.addEventListener('pointerup', onHeaderPointerUp);
  head.addEventListener('pointercancel', onHeaderPointerUp);

  // ── the controller the engine drives ───────────────────────────────────────
  return {
    show(nextPayload) {
      if (!nextPayload || nextPayload.schemaVersion !== 1) return;
      payload = nextPayload;
      currentLevel = 'L1';
      focusedIndex = 0;
      expanded.clear();
      busy = false;
      view = 'options';
      pendingOption = null;
      confirmFocusedIndex = 0;
      el.classList.remove('np-hidden');
      render();
      el.focus({ preventScroll: true });
    },

    setBusy(isBusy) {
      busy = !!isBusy;
      render();
    },

    hide() {
      el.classList.add('np-hidden');
    },

    destroy() {
      document.removeEventListener('keydown', onKeyDown, true);
      head.removeEventListener('pointerdown', onHeaderPointerDown);
      head.removeEventListener('pointermove', onHeaderPointerMove);
      head.removeEventListener('pointerup', onHeaderPointerUp);
      head.removeEventListener('pointercancel', onHeaderPointerUp);
      el.remove();
      style.remove();
      payload = null;
    },
  };
}
