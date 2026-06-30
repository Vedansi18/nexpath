/**
 * UI Mock Harness — development-only.
 *
 * Loads a fixture advisory payload and mounts the panel in a real browser tab
 * so UI developers can iterate without needing the full extension pipeline.
 *
 * Usage: serve this file with any static dev server (e.g. `vite`, `npx serve`).
 * The panel module must be built first:
 *   npm run build:ui        (outputs dist/ui.js exporting mountNexpathPanel)
 *
 * Fixture files live in ./fixtures/*.json — edit them to test different states.
 */

import type { AdvisoryPayload, PanelEvent, MountNexpathPanel } from '../ui-contract.js';

// ── Fixture loader ─────────────────────────────────────────────────────────────

const FIXTURE_NAMES = [
  'stage-transition-prd',
  'absence-test-creation',
  'absence-spec-before-code',
  'beginner-profile',
  'hardcore-pro-profile',
  'frustrated-mood',
] as const;

type FixtureName = typeof FIXTURE_NAMES[number];

async function loadFixture(name: FixtureName): Promise<AdvisoryPayload> {
  const res = await fetch(`./fixtures/${name}.json`);
  if (!res.ok) throw new Error(`Failed to load fixture: ${name}`);
  return res.json() as Promise<AdvisoryPayload>;
}

// ── Harness bootstrap ─────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  // Load the UI module dynamically — built output must be available at ./ui.js
  const uiModule = await import('../../../ext-browser/ui/ui.js' as string) as { mountNexpathPanel: MountNexpathPanel };
  const { mountNexpathPanel } = uiModule;

  const params    = new URLSearchParams(window.location.search);
  const fixtureName = (params.get('fixture') ?? 'stage-transition-prd') as FixtureName;

  const payload = await loadFixture(fixtureName);

  const root = document.getElementById('nexpath-harness-root');
  if (!root) throw new Error('Missing #nexpath-harness-root element in HTML');

  // ── Event log ────────────────────────────────────────────────────────────────
  const eventLog = document.getElementById('nexpath-harness-log');
  function logEvent(event: PanelEvent): void {
    const entry = document.createElement('pre');
    entry.textContent = JSON.stringify(event, null, 2);
    eventLog?.prepend(entry);

    if (event.type === 'option_selected') {
      console.log('[nexpath harness] option_selected:', event.selectedText);
    } else {
      console.log('[nexpath harness] event:', event.type);
    }
  }

  // ── Mount ────────────────────────────────────────────────────────────────────
  const controller = mountNexpathPanel(root, payload, logEvent);
  console.log('[nexpath harness] panel mounted. fixture:', fixtureName);
  console.log('[nexpath harness] payload:', payload);

  // Expose unmount on window for manual testing in devtools
  (window as unknown as Record<string, unknown>)['nexpathUnmount'] = () => {
    controller.unmount();
    console.log('[nexpath harness] panel unmounted');
  };
}

bootstrap().catch((err: unknown) => {
  console.error('[nexpath harness] bootstrap failed:', err);
});
