// ============================================================================
// D7.1 — the surfaces harness: a real browser exercising the real code.
// ----------------------------------------------------------------------------
// jsdom computes no layout, so everything C-2 promises — the header shrinking
// before the options band starves, one row always visible, long tokens wrapping
// instead of widening the frame — can only be PROVEN here. This page mounts the
// actual dock, chrome and controller (no copies, no mocks) and carries an
// automated sweep that renders every surface across a content × viewport
// matrix and measures the result with getBoundingClientRect.
//
// It lives INSIDE src/ext-browser/ui/surfaces/ because C-5 forbids touching
// anything outside this layer — the existing panel harness is not modified.
// Dev-only: nothing imports it, it reaches no bundle, and its build output is
// git-ignored beside it.
//
// Run: `node build.mjs` in this directory, then open index.html (any static
// server). `?sweep=1` runs the matrix on load and prints one line of JSON —
// `SWEEP {"pass":…,"fail":…}` — to the console for automation.
// ============================================================================

import { mountNexpathDock } from '../dock.js';
import { installChromeStyles } from '../chrome.js';
import { renderSurface } from '../surface-view.js';
import { createSurfaceController, type SurfaceEvent } from '../surface-controller.js';
import type { SurfaceId, SurfaceModel } from '../surface-model.js';
import { PE_FIXTURE } from '../fixtures/pe.js';
import { MPS_FIRST_FIXTURE, MPS_CONTINUATION_FIXTURE } from '../fixtures/mps.js';
import { PEF_FIXTURE } from '../fixtures/pef.js';

const FIXTURES: Record<SurfaceId, SurfaceModel> = {
  prompt_enhancement: PE_FIXTURE,
  mps_first: MPS_FIRST_FIXTURE,
  mps_continuation: MPS_CONTINUATION_FIXTURE,
  prompt_enhancement_feedback: PEF_FIXTURE,
};

/** The first field's text swapped — the harness's own tiny stand-in for the
 * held `withBodyText`, so the committed harness stays free of held imports. */
function withBody(model: SurfaceModel, text: string): SurfaceModel {
  let done = false;
  return {
    ...model,
    rows: model.rows.map((r) => (!done && r.kind === 'field' ? ((done = true), { ...r, text }) : r)),
  };
}

// ── interactive mode ─────────────────────────────────────────────────────────

function mountInteractive(): void {
  const dock = mountNexpathDock();
  const shadow = dock.mountEl.getRootNode() as ShadowRoot;
  installChromeStyles(shadow);

  const log = document.getElementById('log')!;
  const controller = createSurfaceController(dock.mountEl, {
    registry: FIXTURES,
    initial: 'prompt_enhancement',
    onEvent(e: SurfaceEvent): void {
      const line = document.createElement('div');
      line.textContent = JSON.stringify(e);
      log.prepend(line);
    },
  });
  dock.show();

  for (const id of Object.keys(FIXTURES) as SurfaceId[]) {
    const button = document.createElement('button');
    button.textContent = id;
    button.addEventListener('click', () => controller.setSurface(id));
    document.getElementById('picker')!.appendChild(button);
  }
}

// ── the sweep (D7.2 + D7.3) ──────────────────────────────────────────────────

/** The content matrix the plan names, plus the escapeHtml payload. */
const CONTENT_CASES: ReadonlyArray<readonly [string, string]> = [
  ['empty', ''],
  ['one line', 'One short line.'],
  ['50 lines', Array.from({ length: 50 }, (_, i) => `line ${i + 1} of fifty`).join('\n')],
  ['500 lines', Array.from({ length: 500 }, (_, i) => `line ${i + 1} of five hundred`).join('\n')],
  ['5000-char paragraph', 'word '.repeat(1000).trim()],
  ['2000-char unbroken token', 'x'.repeat(2000)],
  ['RTL + CJK', 'שלום עולם مرحبا بالعالم\n漢字とカタカナが混ざった行です\nمزيج של שפות 中文'],
  ['markup payload', 'a < b & "c" > d <script>alert(1)</script>'],
];

/** Viewport-shaped boxes. 230 and 180 are the panel bug's reproduction range. */
const SIZES: ReadonlyArray<readonly [number, number]> = [
  [2560, 1080], [1920, 1080], [1440, 800], [1024, 600],
  [800, 400], [600, 300], [360, 230], [360, 180],
];

interface CellResult {
  surface: string; content: string; w: number; h: number;
  headerVisible: boolean; rowVisible: boolean; footerVisible: boolean;
  noHOverflow: boolean; notGrown: boolean; noScriptRan: boolean;
}

function within(inner: DOMRect, outer: DOMRect): boolean {
  // "Visible" = some of it lies inside the box (1px tolerance).
  return inner.bottom > outer.top + 1 && inner.top < outer.bottom - 1
    && inner.right > outer.left + 1 && inner.left < outer.right - 1;
}

function sweepCell(surface: SurfaceModel, label: string, contentName: string, w: number, h: number): CellResult {
  const box = document.createElement('div');
  box.style.cssText = `width:${w}px;height:${h}px;overflow:hidden;position:relative;`;
  document.getElementById('sweep-stage')!.appendChild(box);

  const frame = renderSurface(document, surface, { focusIndex: 0 });
  box.appendChild(frame);

  const boxRect = box.getBoundingClientRect();
  const frameRect = frame.getBoundingClientRect();
  const header = frame.querySelector('.np-header')!.getBoundingClientRect();
  const bullets = [...frame.querySelectorAll('.np-scroll .np-bullet')].map((b) => b.getBoundingClientRect());
  const footer = frame.querySelector('.np-footer .np-dim')!.getBoundingClientRect();

  const result: CellResult = {
    surface: label, content: contentName, w, h,
    headerVisible: within(header, boxRect),
    // The panel bug's metric: at least one option row must remain visible.
    rowVisible: bullets.some((b) => within(b, boxRect)),
    footerVisible: within(footer, boxRect),
    noHOverflow: frame.scrollWidth <= frame.clientWidth + 1 && frameRect.width <= boxRect.width + 1,
    notGrown: frameRect.height <= boxRect.height + 1,
    noScriptRan: !(window as unknown as Record<string, unknown>)['__pwned'],
  };

  box.remove();
  return result;
}

export function runSweep(): { pass: number; fail: number; failures: CellResult[] } {
  installChromeStyles(document.head);
  const failures: CellResult[] = [];
  let pass = 0;

  const surfaces: ReadonlyArray<readonly [string, SurfaceModel]> = [
    ['PE', PE_FIXTURE], ['MPS-1', MPS_FIRST_FIXTURE],
    ['MPS-2', MPS_CONTINUATION_FIXTURE], ['PEF', PEF_FIXTURE],
  ];

  for (const [label, fixture] of surfaces) {
    // The full size grid with the fixture's own content…
    for (const [w, h] of SIZES) {
      const cell = sweepCell(fixture, label, 'fixture', w, h);
      if (cell.headerVisible && cell.rowVisible && cell.footerVisible && cell.noHOverflow && cell.notGrown && cell.noScriptRan) pass += 1;
      else failures.push(cell);
    }
    // …and the content matrix at a wide, a narrow and the bug-range size.
    for (const [contentName, text] of CONTENT_CASES) {
      for (const [w, h] of [[1440, 800], [600, 300], [360, 230]] as const) {
        const cell = sweepCell(withBody(fixture, text), label, contentName, w, h);
        if (cell.headerVisible && cell.rowVisible && cell.footerVisible && cell.noHOverflow && cell.notGrown && cell.noScriptRan) pass += 1;
        else failures.push(cell);
      }
    }
  }

  return { pass, fail: failures.length, failures };
}

function renderSweepReport(): void {
  const { pass, fail, failures } = runSweep();
  const banner = document.getElementById('banner')!;
  banner.textContent = fail === 0
    ? `SWEEP PASS — ${pass}/${pass + fail} cells green`
    : `SWEEP FAIL — ${fail} of ${pass + fail} cells failed`;
  banner.className = fail === 0 ? 'pass' : 'fail';

  const detail = document.getElementById('failures')!;
  for (const f of failures) {
    const row = document.createElement('div');
    const flags = Object.entries(f)
      .filter(([k, v]) => v === false && k !== 'surface' && k !== 'content')
      .map(([k]) => k).join(', ');
    row.textContent = `${f.surface} · ${f.content} · ${f.w}×${f.h} → ${flags}`;
    detail.appendChild(row);
  }
  // One line for automation.
  console.log('SWEEP ' + JSON.stringify({ pass, fail }));
}

// ── boot ─────────────────────────────────────────────────────────────────────

// Boot only on the harness page itself. The guard is what lets a test import
// `runSweep` without the module trying to mount into a page that is not there.
if (document.getElementById('bar') && document.getElementById('sweep-stage')) {
  if (new URLSearchParams(location.search).get('sweep') === '1') {
    renderSweepReport();
  } else {
    mountInteractive();
  }
}
