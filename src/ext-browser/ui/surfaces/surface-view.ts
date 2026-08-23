// ============================================================================
// Renders a SurfaceModel into the CLI frame.
// ----------------------------------------------------------------------------
// Sub-phases D3.2, D3.3 and D3.4: the row order, the editable fields, and the
// focus model.
//
// ONE RENDERER, NOT FOUR. The four CLI surfaces share a single line grammar —
// header, rule, blank, pinch, cues, why-help, rows, footer — so a surface module
// supplies a model and never a renderer. D4 adds three more fixtures, not three
// more of these.
//
// WHAT LIVES WHERE. `chrome.ts` knows how a row is made; this file knows which
// rows a frame has and in what order. Nothing here reaches for a colour or a
// class name.
// ============================================================================

import {
  buildBlankRow,
  buildBulletRow,
  buildFooterRow,
  buildFrame,
  buildHeader,
  buildHintRow,
  buildTextRow,
} from './chrome.js';
import type { SurfaceModel, SurfaceState } from './surface-model.js';

/**
 * Grow a textarea to fit its content (D3.3).
 *
 * The frame never grows with it: the field lives inside `.np-scroll`, which is
 * the only part of the frame allowed to take space, and which scrolls once the
 * band is full. Reset to `auto` first, or the height only ever ratchets upward —
 * `scrollHeight` of an already-tall box includes the slack.
 *
 * jsdom reports `scrollHeight` as 0, so this cannot be proven in a unit test;
 * the live proof is D7's content sweep.
 */
export function autoGrow(field: HTMLTextAreaElement): void {
  field.style.height = 'auto';
  field.style.height = `${field.scrollHeight}px`;
}

/** The editable field beneath a `field` row's label. */
function buildField(doc: Document, text: string): HTMLElement {
  const row = doc.createElement('div');
  row.className = 'np-row';

  const field = doc.createElement('textarea');
  field.className = 'np-content np-indent np-field';
  field.value = text;
  field.rows = 1;
  // Auto-grow on creation and on every edit. The listener dies with the element,
  // which is discarded whole when a surface re-renders.
  field.addEventListener('input', () => autoGrow(field));
  autoGrow(field);

  row.appendChild(field);
  return row;
}

/**
 * Render a surface into a detached frame element.
 *
 * Returns the frame; the caller appends it to the dock's `mountEl`. Pure: it
 * reads the model and the focus index and touches nothing else.
 */
export function renderSurface(doc: Document, model: SurfaceModel, state: SurfaceState): HTMLElement {
  const { frame, fixedTop, scroll, footer } = buildFrame(doc);

  // Clamp and truncate, exactly as the CLI does (`cli-submit-popup.ts:725-727`).
  // Without it an out-of-range index focuses NOTHING — no filled bullet, no hint
  // line, and a frame that looks broken rather than merely mis-focused. D6 drives
  // this index, and an off-by-one there is ordinary; the CLI guards for the same
  // reason. An empty row list keeps -1, which focuses nothing because there is
  // nothing to focus.
  const focusIndex = model.rows.length === 0
    ? -1
    : Math.max(0, Math.min(model.rows.length - 1, Math.trunc(state.focusIndex)));

  // ── header region ────────────────────────────────────────────────────────
  for (const row of buildHeader(doc, model.label)) fixedTop.appendChild(row);
  fixedTop.appendChild(buildBlankRow(doc));

  if (model.pinch) fixedTop.appendChild(buildTextRow(doc, model.pinch, 'pinch'));
  for (const cue of model.trustCues ?? []) fixedTop.appendChild(buildTextRow(doc, cue));
  // Multi-line, one row per line — the CLI splits it the same way so a long
  // why-help block stays readable instead of becoming one run-on line.
  if (model.whyHelp) {
    for (const line of model.whyHelp.split('\n')) fixedTop.appendChild(buildTextRow(doc, line, 'why'));
  }
  if (model.providerFailure) fixedTop.appendChild(buildTextRow(doc, model.providerFailure, 'caution'));

  fixedTop.appendChild(buildBlankRow(doc));

  // ── rows ─────────────────────────────────────────────────────────────────
  model.rows.forEach((row, index) => {
    const focused = index === focusIndex;
    if (row.blankBefore) scroll.appendChild(buildBlankRow(doc));
    scroll.appendChild(buildBulletRow(doc, row.label, focused));

    if (row.kind !== 'field') return;

    scroll.appendChild(buildField(doc, row.text));
    for (const hint of row.hints?.always ?? []) scroll.appendChild(buildHintRow(doc, hint));
    if (focused) {
      for (const hint of row.hints?.whenFocused ?? []) scroll.appendChild(buildHintRow(doc, hint));
    }
  });

  // ── footer ───────────────────────────────────────────────────────────────
  footer.appendChild(buildBlankRow(doc));
  footer.appendChild(buildFooterRow(doc, model.footer));

  return frame;
}
