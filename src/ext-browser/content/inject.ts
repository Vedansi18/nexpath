import { isShowAdvisoryMsg } from './ipc.js';
import { mountStubPanel } from '../ui/stub-panel.js';

/**
 * Handles SW → content messages forwarded by main-world-injector.ts via CustomEvent,
 * and manages panel lifecycle.
 */

let panelRoot: HTMLDivElement | null = null;

function removePanel(): void {
  panelRoot?.remove();
  panelRoot = null;
}

window.addEventListener('nexpath:sw-message', (ev) => {
  const msg = (ev as CustomEvent<unknown>).detail;
  if (!isShowAdvisoryMsg(msg)) return;

  removePanel();

  panelRoot = document.createElement('div');
  panelRoot.id = 'nexpath-panel-root';
  document.body.appendChild(panelRoot);

  mountStubPanel(panelRoot, msg.payload, () => removePanel());
});
