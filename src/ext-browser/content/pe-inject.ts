/**
 * Content-side wiring for the prompt-enhancement panel (PB4) — the sibling of
 * inject.ts's advisory wiring, kept in its own module so the shipped advisory
 * flow is not edited (PE-BR-15). Runs in the MAIN world alongside inject.ts
 * (imported from it, same bundle) and talks to the isolated-world
 * main-world-injector via window events, exactly like the advisory panel:
 *
 *   SW ─ show-pe ─▶ injector ─ 'nexpath:sw-message' ─▶ here → mount/render panel
 *   panel command ─ 'nexpath:pe-command-out' ─▶ injector ─ runtime msg ─▶ SW
 *   SW ─ pe-inject ─▶ here → echo-guard notice → inject kit paste + auto-submit
 *
 * Fail-open rules carried in:
 *  - terminal clicks (use enhanced / use original / close) arm a watchdog: if
 *    the SW never answers (MV3 teardown mid-popup), the panel closes and a
 *    toast says nothing was sent — unvalidated text is NEVER injected locally;
 *  - every terminal click also fires a one-way notice so the pending-PE row is
 *    consumed by whichever SW instance is alive;
 *  - a keepalive heartbeat runs while the panel is open so that teardown is
 *    rare in the first place.
 */

import { isPeCloseMsg, isPeInjectMsg, isShowPeMsg } from './ipc.js';
import { mountNexpathPePanel } from '../ui/pe-panel.js';
import type { PePanelControllerV1, PePanelEventV1 } from '../ui/pe-contract.js';
import { injectPromptText } from './inject-dispatch.js';
import { showToast } from './agents/inject-kit.js';

const KEEPALIVE_INTERVAL_MS = 20_000;
/** How long a terminal click may wait for the SW before failing open (closed). */
const TERMINAL_WATCHDOG_MS = 12_000;
const SUPPORTED_SCHEMA_VERSION = 1;

let controller: PePanelControllerV1 | null = null;
let panelHost: HTMLDivElement | null = null;
let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
let watchdogTimer: ReturnType<typeof setTimeout> | null = null;

function stopKeepalive(): void {
  if (keepaliveTimer !== null) {
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
  }
}

function startKeepalive(): void {
  stopKeepalive();
  keepaliveTimer = setInterval(() => {
    if (!controller?.isOpen()) {
      stopKeepalive();
      return;
    }
    window.dispatchEvent(new CustomEvent('nexpath:pe-keepalive-out'));
  }, KEEPALIVE_INTERVAL_MS);
}

function clearWatchdog(): void {
  if (watchdogTimer !== null) {
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
  }
}

function armTerminalWatchdog(): void {
  clearWatchdog();
  watchdogTimer = setTimeout(() => {
    // The SW never came back — never inject unvalidated text; close, say so.
    console.warn('[nexpath] PE popup: no response from the service worker — closing, nothing sent');
    showToast('Nexpath: connection lost — nothing was sent.');
    closePanel();
  }, TERMINAL_WATCHDOG_MS);
}

function closePanel(): void {
  clearWatchdog();
  stopKeepalive();
  controller?.hide();
}

function moveHostBy(dx: number, dy: number): void {
  if (!panelHost) return;
  const r = panelHost.getBoundingClientRect();
  panelHost.style.left = `${Math.round(r.left + dx)}px`;
  panelHost.style.top = `${Math.round(r.top + dy)}px`;
  panelHost.style.transform = 'none';
}

function recenterHost(): void {
  if (!panelHost) return;
  panelHost.style.left = '50%';
  panelHost.style.top = '50%';
  panelHost.style.transform = 'translate(-50%, -50%)';
}

function handlePanelEvent(event: PePanelEventV1): void {
  if (event.type === 'move') {
    moveHostBy(event.dx, event.dy);
    return;
  }
  // One user command → one short-lived runtime message (the injector attaches
  // the project root + forwards). Panel goes busy until the SW's next view —
  // EXCEPT feedback: it's non-terminal and produces no re-render (the SW only
  // records a content-free signal), so the panel must stay interactive.
  if (event.command.type !== 'feedback_suggested') controller?.setBusy(true);
  window.dispatchEvent(new CustomEvent('nexpath:pe-command-out', {
    detail: { viewSeq: event.viewSeq, command: event.command },
  }));
  const t = event.command.type;
  if (t === 'use_current' || t === 'use_original' || t === 'close') {
    // Terminal: also record the outcome one-way (survives SW teardown), and
    // arm the fail-open watchdog for the answer.
    window.dispatchEvent(new CustomEvent('nexpath:pe-terminal-out', { detail: { outcome: t } }));
    armTerminalWatchdog();
  }
}

/** Lazily create the closed shadow host + mount the PE panel once. */
function ensureMounted(): PePanelControllerV1 {
  if (controller) return controller;
  panelHost = document.createElement('div');
  panelHost.id = 'nexpath-pe-panel-host';
  panelHost.style.cssText =
    'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
    'z-index:2147483647;max-height:calc(100vh - 40px);overflow-y:auto;';
  document.body.appendChild(panelHost);
  const shadow = panelHost.attachShadow({ mode: 'closed' });
  const mountEl = document.createElement('div');
  shadow.appendChild(mountEl);
  controller = mountNexpathPePanel(mountEl, { onEvent: handlePanelEvent });
  return controller;
}

export function setupPeListener(): void {
  window.addEventListener('nexpath:sw-message', (ev) => {
    const msg = (ev as CustomEvent<unknown>).detail;

    if (isShowPeMsg(msg)) {
      if (msg.payload.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
        console.warn(`[nexpath] PE view schemaVersion mismatch: got ${String(msg.payload.schemaVersion)}, expected ${SUPPORTED_SCHEMA_VERSION}. Ignoring.`);
        return;
      }
      clearWatchdog(); // a fresh view answers whatever command was in flight
      const ctrl = ensureMounted();
      if (panelHost && !panelHost.isConnected) document.body.appendChild(panelHost);
      if (!ctrl.isOpen()) recenterHost(); // first show centers; re-renders keep the drag position
      ctrl.show(msg.payload);
      startKeepalive();
      // Ack AFTER the mount so the SW's first-render bookkeeping (consume row,
      // mark cooldown) reflects a panel that actually exists on screen.
      window.dispatchEvent(new CustomEvent('nexpath:pe-view-ack'));
      return;
    }

    if (isPeCloseMsg(msg)) {
      closePanel();
      return;
    }

    if (isPeInjectMsg(msg)) {
      clearWatchdog();
      // Echo guard BEFORE the text lands (advisory-select parity): the SW
      // records it as the last seen prompt so the auto-submitted echo dedups
      // instead of re-entering the pipeline (and re-preparing a PE).
      window.dispatchEvent(new CustomEvent('nexpath:prompt-injected-notice', { detail: { text: msg.text } }));
      closePanel();
      void injectPromptText(msg.text)
        .catch(() => { /* clipboardFallback inside the kit already handles paste failure */ });
      return;
    }
  });

  window.addEventListener('pagehide', () => {
    clearWatchdog();
    stopKeepalive();
    controller?.destroy();
    controller = null;
    panelHost?.remove();
    panelHost = null;
  });
}
