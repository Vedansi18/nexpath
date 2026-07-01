import { isShowAdvisoryMsg } from './ipc.js';
import { mountStubPanel } from '../ui/stub-panel.js';

const SUPPORTED_SCHEMA_VERSION = 1;

let panelRoot: HTMLDivElement | null = null;

function removePanel(): void {
  panelRoot?.remove();
  panelRoot = null;
}

window.addEventListener('nexpath:sw-message', (ev) => {
  const msg = (ev as CustomEvent<unknown>).detail;
  if (!isShowAdvisoryMsg(msg)) return;

  // Guard against schema mismatches — log and bail rather than crash.
  if (msg.payload.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    console.warn(
      `[nexpath] Advisory schemaVersion mismatch: got ${msg.payload.schemaVersion}, expected ${SUPPORTED_SCHEMA_VERSION}. Ignoring.`,
    );
    return;
  }

  removePanel();

  panelRoot = document.createElement('div');
  panelRoot.id = 'nexpath-panel-root';
  document.body.appendChild(panelRoot);

  // mountStubPanel returns the closed ShadowRoot reference (root.shadowRoot is null for closed).
  mountStubPanel(panelRoot, msg.payload, () => removePanel());
});
