/**
 * nexpath — Shadow-DOM advisory panel
 * Implements MountNexpathPanel exactly per src/ext-browser/ui/ui-contract.ts.
 * Vanilla ES module. No framework, no external CSS, no network calls,
 * no chrome.* / browser.* APIs, no storage APIs. Self-contained.
 */

// Real Stage enum has 8 values (core/classifier/types.ts). A hand-mapped
// lookup with a graceful fallback formatter means an unmapped/future stage
// value never silently disappears — it still renders as a readable label.
const LEVELS = ['L1', 'L2', 'L3'];
const STAGE_LABELS = {
  idea: 'Idea',
  prd: 'PRD',
  architecture: 'Architecture',
  task_breakdown: 'Task Breakdown',
  implementation: 'Implementation',
  review_testing: 'Review & Testing',
  release: 'Release',
  feedback_loop: 'Feedback Loop',
};

function formatStage(stage) {
  if (Object.prototype.hasOwnProperty.call(STAGE_LABELS, stage)) return STAGE_LABELS[stage];
  return String(stage)
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

const CSS = `
:host, * { box-sizing: border-box; }

.np-root {
  --np-bg: #161A24;
  --np-surface: #1B2130;
  --np-surface-raised: #212840;
  --np-border: #2B3242;
  --np-border-soft: #232939;
  --np-text: #EDEFF3;
  --np-text-dim: #9BA3B4;
  --np-text-faint: #6B7484;
  --np-accent: #FFB454;
  --np-accent-ink: #2A1B04;
  --np-accent-soft: rgba(255, 180, 84, 0.14);
  --np-accent-border: rgba(255, 180, 84, 0.38);
  --np-radius: 14px;
  --np-radius-sm: 8px;
  --np-font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif;
  --np-font-mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;

  position: fixed;
  top: 20px;
  right: 20px;
  width: 340px;
  z-index: 2147483647;
  font-family: var(--np-font-sans);
  color: var(--np-text);
  -webkit-font-smoothing: antialiased;
  pointer-events: none;
}

.np-root[data-visible="true"] { pointer-events: auto; }

.np-card {
  background: var(--np-bg);
  border: 1px solid var(--np-border);
  border-radius: var(--np-radius);
  box-shadow: 0 12px 40px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.3);
  overflow: hidden;
  opacity: 0;
  transform: translateX(24px) scale(0.98);
  transition: opacity 220ms cubic-bezier(.2,.8,.2,1), transform 220ms cubic-bezier(.2,.8,.2,1);
  position: relative;
}

.np-root[data-visible="true"] .np-card {
  opacity: 1;
  transform: translateX(0) scale(1);
}

.np-root[data-closing="true"] .np-card {
  opacity: 0;
  transform: translateX(16px) scale(0.98);
  transition: opacity 180ms ease, transform 180ms ease;
}

@media (prefers-reduced-motion: reduce) {
  .np-card, .np-level, .np-busy { transition: none !important; }
}

/* ── Header ───────────────────────────── */
.np-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--np-border-soft);
}

.np-brand {
  font-family: var(--np-font-mono);
  font-size: 12px;
  letter-spacing: 0.06em;
  color: var(--np-text-faint);
  text-transform: lowercase;
  display: flex;
  align-items: center;
  gap: 6px;
}

.np-brand::before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--np-accent);
  box-shadow: 0 0 0 3px var(--np-accent-soft);
  flex-shrink: 0;
}

.np-dismiss {
  appearance: none;
  border: none;
  background: transparent;
  color: var(--np-text-faint);
  width: 24px;
  height: 24px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
.np-dismiss:hover { background: var(--np-surface-raised); color: var(--np-text); }
.np-dismiss:focus-visible { outline: 2px solid var(--np-accent); outline-offset: 1px; }
.np-dismiss svg { width: 13px; height: 13px; }

/* ── Stage label ──────────────────────── */
.np-stage {
  padding: 9px 14px;
  border-bottom: 1px solid var(--np-border-soft);
  font-family: var(--np-font-mono);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--np-accent);
}

/* ── Pinch label ──────────────────────── */
.np-pinch {
  padding: 16px 14px 4px;
  font-size: 18px;
  font-weight: 650;
  letter-spacing: -0.01em;
  line-height: 1.3;
  color: var(--np-text);
}

/* ── Body ─────────────────────────────── */
.np-body { padding: 10px 14px 4px; }

.np-level-tag {
  font-family: var(--np-font-mono);
  font-size: 10.5px;
  color: var(--np-accent);
  background: var(--np-accent-soft);
  border: 1px solid var(--np-accent-border);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  border-radius: 100px;
  margin-bottom: 10px;
  letter-spacing: 0.02em;
}

.np-level-dots { display: inline-flex; gap: 3px; }
.np-level-dots span {
  width: 4px; height: 4px; border-radius: 50%;
  background: currentColor; opacity: 0.3;
}
.np-level-dots span[data-filled="true"] { opacity: 1; }

.np-level {
  transition: opacity 130ms ease;
}
.np-level[data-fading="true"] { opacity: 0; }

.np-title {
  margin: 0 0 8px;
  font-size: 14.5px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--np-text);
}

.np-option-body {
  margin: 0 0 14px;
  font-size: 14px;
  line-height: 1.55;
  color: var(--np-text-dim);
}

/* ── Actions ──────────────────────────── */
.np-actions-primary {
  display: flex;
  gap: 8px;
  padding: 0 14px 12px;
}

.np-select {
  flex: 1;
  appearance: none;
  border: 1px solid var(--np-accent);
  background: var(--np-accent);
  color: var(--np-accent-ink);
  font-family: var(--np-font-sans);
  font-size: 13.5px;
  font-weight: 600;
  padding: 9px 12px;
  border-radius: var(--np-radius-sm);
  cursor: pointer;
  transition: filter 120ms ease, transform 80ms ease;
}
.np-select:hover { filter: brightness(1.06); }
.np-select:active { transform: scale(0.98); }
.np-select:focus-visible { outline: 2px solid var(--np-text); outline-offset: 2px; }

.np-copy {
  appearance: none;
  border: 1px solid var(--np-border);
  background: var(--np-surface);
  color: var(--np-text-dim);
  font-family: var(--np-font-sans);
  font-size: 13.5px;
  font-weight: 500;
  padding: 9px 12px;
  border-radius: var(--np-radius-sm);
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
}
.np-copy:hover { background: var(--np-surface-raised); color: var(--np-text); border-color: #3A4257; }
.np-copy:focus-visible { outline: 2px solid var(--np-accent); outline-offset: 2px; }

.np-actions-secondary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px 14px;
}

.np-simpler, .np-skip {
  appearance: none;
  border: none;
  background: transparent;
  font-family: var(--np-font-sans);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  padding: 4px 2px;
  border-radius: 4px;
}
.np-simpler { color: var(--np-text-dim); }
.np-simpler:hover { color: var(--np-text); }
.np-simpler:focus-visible, .np-skip:focus-visible { outline: 2px solid var(--np-accent); outline-offset: 2px; }
.np-simpler[data-hidden="true"] { visibility: hidden; }

.np-skip { color: var(--np-text-faint); }
.np-skip:hover { color: var(--np-text-dim); }

/* ── Error state ──────────────────────── */
.np-error {
  padding: 16px 14px 18px;
  font-size: 13px;
  color: var(--np-text-dim);
  line-height: 1.5;
}
.np-error strong { color: var(--np-text); }

/* ── Disabled / busy ──────────────────── */
.np-root[data-busy="true"] .np-card button:not(.np-dismiss) {
  pointer-events: none;
  opacity: 0.5;
}
.np-root[data-busy="true"] .np-dismiss { pointer-events: none; opacity: 0.4; }

.np-busy {
  position: absolute;
  inset: 0;
  background: rgba(22, 26, 36, 0.72);
  backdrop-filter: blur(1.5px);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 160ms ease;
  font-size: 13px;
  color: var(--np-text-dim);
}
.np-root[data-busy="true"] .np-busy { opacity: 1; pointer-events: auto; }

.np-spinner {
  width: 15px;
  height: 15px;
  border-radius: 50%;
  border: 2px solid var(--np-border);
  border-top-color: var(--np-accent);
  animation: np-spin 750ms linear infinite;
}
@keyframes np-spin { to { transform: rotate(360deg); } }
`;

/**
 * @param {HTMLElement} root
 * @param {{ onEvent: (e: any) => void }} options
 */
export const mountNexpathPanel = (root, { onEvent }) => {
  let payload = null;
  let levelIndex = 0;
  let busy = false;
  let visible = false;
  let levelTransitioning = false;
  let lastFocused = null;
  let hideTimer = null;

  // ── Build static DOM once ──────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = CSS;
  root.appendChild(style);

  const rootEl = document.createElement('div');
  rootEl.className = 'np-root';
  rootEl.setAttribute('data-visible', 'false');
  rootEl.hidden = true;

  rootEl.innerHTML = `
    <div class="np-card" role="dialog" aria-modal="true" aria-labelledby="np-pinch-label">
      <div class="np-header">
        <div class="np-brand">nexpath</div>
        <button type="button" class="np-dismiss" aria-label="Dismiss advisory">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3 3L13 13M13 3L3 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
        </button>
      </div>

      <div class="np-stage" data-stage></div>

      <div id="np-pinch-label" class="np-pinch" role="heading" aria-level="2" data-pinch></div>

      <div class="np-body">
        <div class="np-level" data-level-wrap>
          <span class="np-level-tag">
            <span data-level-text>L1</span>
            <span class="np-level-dots" data-level-dots aria-hidden="true"></span>
          </span>
          <h3 class="np-title" data-title></h3>
          <p class="np-option-body" data-body></p>
        </div>
      </div>

      <div class="np-actions-primary">
        <button type="button" class="np-select" data-select>Use this option</button>
        <button type="button" class="np-copy" data-copy>Copy</button>
      </div>

      <div class="np-actions-secondary">
        <button type="button" class="np-simpler" data-simpler>Show simpler →</button>
        <button type="button" class="np-skip" data-skip>Skip</button>
      </div>

      <div class="np-busy" data-busy-overlay aria-live="polite">
        <div class="np-spinner"></div>
        <span>Applying…</span>
      </div>

      <div class="np-error" data-error hidden>
        <strong>Advisory could not be shown.</strong><br/>
        <span data-error-detail></span>
      </div>
    </div>
  `;

  root.appendChild(rootEl);

  const els = {
    card: rootEl.querySelector('.np-card'),
    dismiss: rootEl.querySelector('[aria-label="Dismiss advisory"]'),
    stage: rootEl.querySelector('[data-stage]'),
    pinch: rootEl.querySelector('[data-pinch]'),
    bodyWrap: rootEl.querySelector('.np-body'),
    levelWrap: rootEl.querySelector('[data-level-wrap]'),
    levelText: rootEl.querySelector('[data-level-text]'),
    levelDots: rootEl.querySelector('[data-level-dots]'),
    title: rootEl.querySelector('[data-title]'),
    body: rootEl.querySelector('[data-body]'),
    select: rootEl.querySelector('[data-select]'),
    copy: rootEl.querySelector('[data-copy]'),
    simpler: rootEl.querySelector('[data-simpler]'),
    skip: rootEl.querySelector('[data-skip]'),
    actionsPrimary: rootEl.querySelector('.np-actions-primary'),
    actionsSecondary: rootEl.querySelector('.np-actions-secondary'),
    error: rootEl.querySelector('[data-error]'),
    errorDetail: rootEl.querySelector('[data-error-detail]'),
  };

  // Focus tracked inside our own subtree must be resolved through the
  // ShadowRoot that actually contains `root` — `document.activeElement`
  // stops at the shadow boundary (even more so for mode:'closed') and would
  // never match our own buttons, silently breaking the focus trap in a real
  // browser even though a flat (non-shadow) test harness can't reveal it.
  function getActiveElement() {
    const rootNode = typeof root.getRootNode === 'function' ? root.getRootNode() : null;
    if (rootNode && 'activeElement' in rootNode) return rootNode.activeElement;
    return document.activeElement;
  }

  // ── Rendering ───────────────────────────────────────────────────
  function renderStage() {
    els.stage.textContent = formatStage(payload.stage);
  }

  function currentOption() {
    return payload.options[levelIndex];
  }

  function renderLevel({ animate } = { animate: false }) {
    const opt = currentOption();
    const apply = () => {
      els.levelText.textContent = opt.level;
      els.levelDots.innerHTML = LEVELS.map((_, i) =>
        `<span data-filled="${i <= levelIndex}"></span>`
      ).join('');
      els.title.textContent = opt.title;
      els.body.textContent = opt.body;
      const atLast = levelIndex >= payload.options.length - 1;
      els.simpler.setAttribute('data-hidden', String(atLast));
      els.simpler.disabled = atLast;
      els.simpler.setAttribute('aria-hidden', String(atLast));
    };

    if (!animate) {
      apply();
      return;
    }
    levelTransitioning = true;
    els.levelWrap.setAttribute('data-fading', 'true');
    window.setTimeout(() => {
      apply();
      els.levelWrap.setAttribute('data-fading', 'false');
      levelTransitioning = false;
    }, 130);
  }

  function focusableElements() {
    return Array.from(
      els.card.querySelectorAll('button:not([disabled])')
    ).filter((el) => el.offsetParent !== null || el === getActiveElement());
  }

  function trapFocus(e) {
    if (e.key !== 'Tab') return;
    const focusables = focusableElements();
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = getActiveElement();
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function onKeydown(e) {
    if (busy) {
      if (e.key === 'Tab') e.preventDefault();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      emitDismiss();
      return;
    }
    trapFocus(e);
  }

  // ── Event emitters ──────────────────────────────────────────────
  function emitSelect() {
    if (busy || !payload) return;
    const opt = currentOption();
    onEvent({ type: 'select', optionId: opt.id, body: opt.body });
  }
  function emitSkip() {
    if (busy || !payload) return;
    onEvent({ type: 'skip' });
  }
  function emitDismiss() {
    if (busy) return;
    onEvent({ type: 'dismiss' });
  }
  function emitCopy() {
    if (busy || !payload) return;
    const opt = currentOption();
    onEvent({ type: 'copy', optionId: opt.id });
  }
  function emitShowSimpler() {
    if (busy || !payload || levelTransitioning) return;
    if (levelIndex >= payload.options.length - 1) return;
    levelIndex += 1;
    renderLevel({ animate: true });
    onEvent({ type: 'show-simpler' });
  }

  els.select.addEventListener('click', emitSelect);
  els.skip.addEventListener('click', emitSkip);
  els.dismiss.addEventListener('click', emitDismiss);
  els.copy.addEventListener('click', emitCopy);
  els.simpler.addEventListener('click', emitShowSimpler);
  els.card.addEventListener('keydown', onKeydown);

  function setErrorState(isError, payloadRaw) {
    els.error.hidden = !isError;
    els.stage.hidden = isError;
    els.pinch.hidden = isError;
    els.bodyWrap.hidden = isError;
    els.actionsPrimary.hidden = isError;
    els.actionsSecondary.hidden = isError;
    if (isError) {
      const got = payloadRaw && 'schemaVersion' in payloadRaw ? JSON.stringify(payloadRaw.schemaVersion) : 'none';
      els.errorDetail.textContent = `Unsupported payload version (expected schemaVersion 1, got ${got}).`;
    }
  }

  // ── Public controller ───────────────────────────────────────────
  function show(newPayload) {
    if (hideTimer) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }

    if (!visible) {
      lastFocused = document.activeElement;
    }

    if (!newPayload || newPayload.schemaVersion !== 1) {
      payload = null;
      setErrorState(true, newPayload);
      rootEl.hidden = false;
      rootEl.setAttribute('data-closing', 'false');
      requestAnimationFrame(() => {
        rootEl.setAttribute('data-visible', 'true');
      });
      visible = true;
      window.setTimeout(() => els.dismiss.focus(), 60);
      return;
    }

    setErrorState(false);
    payload = newPayload;
    levelIndex = 0;

    renderStage();
    els.pinch.textContent = payload.pinchLabel;
    renderLevel({ animate: false });

    rootEl.hidden = false;
    rootEl.setAttribute('data-closing', 'false');
    requestAnimationFrame(() => {
      rootEl.setAttribute('data-visible', 'true');
    });
    visible = true;

    window.setTimeout(() => {
      els.select.focus();
    }, 60);
  }

  function setBusy(isBusy) {
    busy = Boolean(isBusy);
    rootEl.setAttribute('data-busy', String(busy));
    // Real disabling (not just CSS pointer-events) so keyboard activation
    // (Enter/Space) and assistive tech both respect the busy state, per §8.4/§8.7.
    [els.select, els.copy, els.simpler, els.skip, els.dismiss].forEach((btn) => {
      if (busy) {
        btn.setAttribute('disabled', '');
      } else {
        btn.removeAttribute('disabled');
        // Don't re-enable "Show simpler" if we're already at the last level.
        if (btn === els.simpler && payload && levelIndex >= payload.options.length - 1) {
          btn.setAttribute('disabled', '');
        }
      }
    });
  }

  function hide() {
    if (!visible) return;
    rootEl.setAttribute('data-closing', 'true');
    rootEl.setAttribute('data-visible', 'false');
    visible = false;
    hideTimer = window.setTimeout(() => {
      rootEl.hidden = true;
    }, 200);
    try {
      if (lastFocused && typeof lastFocused.focus === 'function') {
        lastFocused.focus();
      }
    } catch (_e) {
      /* no-op: focus restore is best-effort */
    }
  }

  function destroy() {
    if (hideTimer) window.clearTimeout(hideTimer);
    els.select.removeEventListener('click', emitSelect);
    els.skip.removeEventListener('click', emitSkip);
    els.dismiss.removeEventListener('click', emitDismiss);
    els.copy.removeEventListener('click', emitCopy);
    els.simpler.removeEventListener('click', emitShowSimpler);
    els.card.removeEventListener('keydown', onKeydown);
    rootEl.remove();
    style.remove();
    payload = null;
  }

  return { show, setBusy, hide, destroy };
};