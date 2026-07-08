// ============================================================================
// nexpath advisory panel — panel.js
// ----------------------------------------------------------------------------
// Visual reference: nexpath-popup.html (approved — see
// v0.1.5-ui-panel-integration-changes.md). Contract wiring: unchanged from
// panel.skeleton.js — same export, same controller, same onEvent payloads.
// Ship alongside panel.d.ts.
// ============================================================================

/** Level subtitles — hardcoded, exactly like the CLI. */
const LEVEL_SUBTITLE = {
  L1: '',
  L2: '— lighter options',
  L3: '— minimum viable step',
};

const LEVEL_ORDER = ['L1', 'L2', 'L3'];

// Palette + type carried over 1:1 from the approved nexpath-popup.html mockup.
// (Confirms §6 of the integration-changes doc: the plum surface is intentional —
// keeping it, not the brief's slate suggestion.)
const STYLES = `
  .np-root {
    font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, "Liberation Mono", ui-monospace, monospace;
    font-size: 12.5px;
    line-height: 15px;
    color: #f5f5f4;
    background: #310823;
    width: 380px;
    max-width: calc(100vw - 24px);
    padding: 14px 16px 14px 10px;
    border-radius: 10px;
    box-shadow: 0 20px 50px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.04);
    box-sizing: border-box;
    transition: opacity .15s ease, transform .15s ease;
  }
  .np-root * { box-sizing: border-box; }
  .np-root.np-hidden { opacity: 0; transform: translateY(4px) scale(.98); pointer-events: none; }

  .np-wordmark { display:flex; align-items:center; gap:6px; font-weight:700; letter-spacing:.5px; padding-left:6px; }
  .np-wordmark .tri { color:#2cc7dd; font-size:11px; }
  .np-hr { border:none; border-top:1px solid rgba(154,167,167,.28); margin:6px 0 10px; }

  .np-row { display:flex; }
  .np-rail { flex:0 0 18px; color:#2a667b; padding-left:2px; }
  .np-content { flex:1 1 auto; min-width:0; overflow-wrap: break-word; }

  .np-pinch-row .np-content { color:#2cc7dd; font-weight:700; }
  .np-pinch-row .np-rail { color:#2cc7dd; }
  .np-subtitle { color:#9ba7a7; font-weight:400; font-size:11px; margin-left:6px; }

  .np-question-row { margin-top:2px; }
  .np-question-row .np-content { color:#f5f5f4; font-weight:700; }

  .np-why-row .np-content { color:#9ba7a7; }
  .np-why-row:first-of-type { margin-top: 2px; }

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
    margin-top:14px; padding-left:20px; font-size:11px; font-style:italic;
    color:#6f7373; border-top:1px solid rgba(154,167,167,.16); padding-top:8px;
  }
  .np-footer a { color:#c9a96a; cursor:pointer; text-decoration:none; }
  .np-footer a:hover { text-decoration:underline; }
  .np-footer .np-sep { margin:0 4px; opacity:.6; }

  .np-root.np-busy .np-options,
  .np-root.np-busy .np-control,
  .np-root.np-busy .np-footer { opacity:.4; pointer-events:none; }
  .np-spinner { margin-top:10px; padding-left:20px; color:#9ba7a7; font-style:italic; }
`;

/**
 * The ONE export. Called once per content-script lifetime.
 * @param {HTMLElement} root - render INTO this element only (never document.body/window).
 * @param {{ onEvent: (e: object) => void }} opts
 * @returns {{ show(payload): void, setBusy(isBusy): void, hide(): void, destroy(): void }}
 */
export function mountNexpathPanel(root, { onEvent }) {
  // ── instance state ────────────────────────────────────────────────────────
  let payload = null;
  let currentLevel = 'L1';
  let focusedIndex = 0;
  const expanded = new Set();
  let busy = false;

  // ── DOM scaffold (built once) ─────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = STYLES;
  root.appendChild(style);

  const el = document.createElement('div');
  el.className = 'np-root np-hidden';
  el.tabIndex = -1; // focusable so keyboard nav is scoped to the panel (see onKeyDown)
  root.appendChild(el);

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

  // ── event emitters (frozen contract — payload shapes unchanged) ────────────
  function emitSelect(opt)   { onEvent({ type: 'select', optionId: opt.id, body: opt.body }); }
  function emitCopy(opt)     { onEvent({ type: 'copy', optionId: opt.id }); }
  function emitSkip()        { onEvent({ type: 'skip' }); }
  function emitDismiss()     { onEvent({ type: 'dismiss' }); }
  function emitDisable()     { onEvent({ type: 'disable-project' }); }
  function emitSettings()    { onEvent({ type: 'open-settings' }); }
  function emitShowSimpler() {
    onEvent({ type: 'show-simpler' });
    const i = LEVEL_ORDER.indexOf(currentLevel);
    if (i < LEVEL_ORDER.length - 1) {
      currentLevel = LEVEL_ORDER[i + 1];
      focusedIndex = 0;
      render();
    }
  }

  function activate(row) {
    if (busy || !row) return;
    if (row.kind === 'option') emitSelect(row.opt);
    else if (row.kind === 'show-simpler') emitShowSimpler();
    else if (row.kind === 'skip') emitSkip();
  }

  // ── render ────────────────────────────────────────────────────────────────
  function render() {
    if (!payload) return;
    const rows = focusables();
    if (focusedIndex >= rows.length) focusedIndex = rows.length - 1;

    el.innerHTML = '';

    // Wordmark + divider.
    const head = document.createElement('div');
    head.innerHTML = `<div class="np-wordmark"><span class="tri">▲</span>NEXPATH</div><hr class="np-hr">`;
    el.appendChild(head);

    // Pinch label row (+ level subtitle on L2/L3).
    const pinchRow = document.createElement('div');
    pinchRow.className = 'np-row np-pinch-row';
    pinchRow.innerHTML =
      `<div class="np-rail">◆</div>` +
      `<div class="np-content">${escapeHtml(payload.pinchLabel)}` +
      (LEVEL_SUBTITLE[currentLevel] ? `<span class="np-subtitle">${LEVEL_SUBTITLE[currentLevel]}</span>` : '') +
      `</div>`;
    el.appendChild(pinchRow);

    // Question row.
    const qRow = document.createElement('div');
    qRow.className = 'np-row np-question-row';
    qRow.innerHTML = `<div class="np-rail">│</div><div class="np-content">${escapeHtml(payload.question)}</div>`;
    el.appendChild(qRow);

    // Why-help block — omit entirely when null. Preserve line breaks.
    if (payload.whyHelp) {
      payload.whyHelp.split('\n').forEach((line) => {
        const whyRow = document.createElement('div');
        whyRow.className = 'np-row np-why-row';
        whyRow.innerHTML = `<div class="np-rail">│</div><div class="np-content">${escapeHtml(line)}</div>`;
        el.appendChild(whyRow);
      });
    }

    // Options for the current level + controls.
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
          hintRow.innerHTML = `<div class="np-rail"></div><div class="np-content">press Space for details${expanded.has(opt.id) ? '' : ''}</div>`;
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

    el.appendChild(optionsWrap);

    // Footer — the two CLI shortcuts as clickable links.
    const footer = document.createElement('div');
    footer.className = 'np-footer';
    footer.innerHTML =
      `don't need nexpath here? <a data-np="disable">Disable for this project</a>` +
      `<span class="np-sep">·</span><a data-np="settings">Adjust frequency or role</a>`;
    footer.querySelector('[data-np="disable"]').addEventListener('click', emitDisable);
    footer.querySelector('[data-np="settings"]').addEventListener('click', emitSettings);
    el.appendChild(footer);

    // Busy state.
    el.classList.toggle('np-busy', busy);
    if (busy) {
      const s = document.createElement('div');
      s.className = 'np-spinner';
      s.textContent = 'Working…';
      el.appendChild(s);
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // ── keyboard (per-instance; scoped to the panel; removed in destroy) ─────────
  // INTEGRATION PATCH (engine side, 2026-07-08): scoped from a document-level
  // capture listener to the panel element, and only handle keys that originated
  // inside the panel (composedPath). Without this, while the advisory is visible
  // the panel's preventDefault() on Space/Enter/Arrows hijacked the user's typing
  // in the agent's own chat box — i.e. it interfered with the host page. Now it
  // can only ever act on keys pressed while the panel itself has focus.
  // (UI dev: please fold this into source. show() focuses the panel so arrow-key
  //  nav still works out of the box; clicking back into the page releases it.)
  function onKeyDown(e) {
    if (el.classList.contains('np-hidden') || busy) return;
    if (!e.composedPath || !e.composedPath().includes(el)) return; // only our own keys
    const rows = focusables();
    if (e.key === 'ArrowDown') { focusedIndex = Math.min(rows.length - 1, focusedIndex + 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { focusedIndex = Math.max(0, focusedIndex - 1); render(); e.preventDefault(); }
    else if (e.key === 'Enter') { activate(rows[focusedIndex]); e.preventDefault(); }
    else if (e.key === 'Escape') { emitDismiss(); e.preventDefault(); }
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

  // ── the controller the engine drives ───────────────────────────────────────
  return {
    show(nextPayload) {
      if (!nextPayload || nextPayload.schemaVersion !== 1) return;
      payload = nextPayload;
      currentLevel = 'L1';
      focusedIndex = 0;
      expanded.clear();
      busy = false;
      el.classList.remove('np-hidden');
      render();
      // Focus the panel so arrow-key nav works immediately; scoped keydown (above)
      // means keys are handled only while this panel holds focus.
      try { el.focus({ preventScroll: true }); } catch { el.focus(); }
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
      el.remove();
      style.remove();
      payload = null;
    },
  };
}
