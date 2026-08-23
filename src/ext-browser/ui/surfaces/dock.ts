// ============================================================================
// nexpath surface dock — host + closed shadow root + mount-once controller.
// ----------------------------------------------------------------------------
// Sub-phase D1.1 of the CLI-parity static UI plan. This file owns exactly three
// things and deliberately nothing else:
//
//   1. the host element that sits in the agent page's DOM,
//   2. the CLOSED shadow root that isolates our CSS from that page,
//   3. a controller that is mounted ONCE per content-script lifetime.
//
// Mirrors `content/inject.ts`'s `ensurePanelMounted()` rather than reinventing
// it: same host-element-then-closed-shadow-then-mount-element shape, same
// mount-once discipline. The advisory panel keeps using that function; this dock
// is a separate host for the four new surfaces (PE / MPS-1 / MPS-2 / PEF), so
// nothing here touches the shipped panel or its frozen contract.
//
// Explicitly NOT in this file yet — each is a later sub-phase, and adding it
// early would make the dock look finished when it is not:
//   D1.3  collapse affordance.
//   D1.4  close button.
//   D1.5  re-attach guard + `pagehide` teardown. `destroy()` exists here because
//         it is part of the controller; WIRING it to page lifecycle is D1.5.
//   D2    the `STYLES` string. `show()`/`hide()` below toggle raw `display` —
//         that is plumbing, not visual design, and D2 may replace it with a
//         class-based transition like the panel's `.np-hidden`.
//   D3/D4 surface rendering. Renderers draw into `controller.mountEl`; the dock
//         never inspects or owns what they put there.
// ============================================================================

/** Host element id. Stable so a stale instance's host can be identified (see below). */
export const NEXPATH_DOCK_HOST_ID = 'nexpath-dock-host';

// ── D1.2 — dock geometry ────────────────────────────────────────────────────
// The four numbers below are the CLI's own docked-popup constants, not new ones.
// Source: `src/decision-session/screen-geometry.ts`. They are re-declared rather
// than imported: that module is CLI/Node code, and C-5 keeps this layer free of
// cross-layer imports. Keep them in sync by hand if the CLI ever changes them.

/** Fraction of the viewport width the dock occupies. CLI `DEFAULT_POPUP_WIDTH_RATIO`. */
export const DOCK_WIDTH_RATIO = 0.6;

/** Ultrawide guard: 60% of a very wide screen stays readable. CLI `POPUP_MAX_WIDTH_PX`. */
export const DOCK_MAX_WIDTH_PX = 1600;

/**
 * Readability floor. CLI `POPUP_MIN_COLS` (80 cells) x `DEFAULT_CELL_WIDTH_PX` (10px).
 * What should happen on a viewport narrower than this is the breakpoint model —
 * deliberately deferred to D7.4. Until then the viewport clamp below simply wins,
 * exactly as it does in the CLI.
 */
export const DOCK_MIN_WIDTH_PX = 800;

/**
 * Fraction of the viewport height the dock occupies. The CLI uses 100% of the
 * WORKING area — the screen minus the taskbar / menu bar. A browser viewport has
 * no such furniture to subtract, so 90% of it is the faithful equivalent, not a
 * deviation (owner requirement, and recorded in the analysis doc).
 */
export const DOCK_HEIGHT_RATIO = 0.9;

/** Above the agent's own UI. Same value the advisory panel host uses. */
export const DOCK_Z_INDEX = 2147483647;

/**
 * Inline geometry for the host element.
 *
 * WHY INLINE, NEVER A STYLESHEET: the host itself lives in the agent page's light
 * DOM — only its shadow CONTENTS are isolated — so a page rule such as
 * `#nexpath-dock-host { display: none }` matches it. An inline declaration beats a
 * page stylesheet, which is what keeps the dock ours. `content/inject.ts` sets the
 * advisory panel's host the same way, for the same reason.
 *
 * CLAMP-ORDER PARITY: the CLI computes the width imperatively
 * (`computeDockedPopupGeometry`):
 *
 *     w = min( max( min(0.6 * V, 1600), 800 ), V )
 *       60%  ->  cap at 1600  ->  floor at 800  ->  never exceed the viewport
 *
 * CSS resolves a used width as `max(min-width, min(max-width, width))`, so the
 * declarations below evaluate to:
 *
 *     w = max( min(800, V), min(1600, 0.6 * V) )
 *
 * Those two expressions agree for every viewport width V — `min(800px, 100%)` is
 * what supplies the CLI's final "never exceed the viewport" step, which a bare
 * `min-width: 800px` would break (min-width otherwise always wins in CSS).
 * `dock.test.ts` pins the equivalence by evaluating both forms across a range of
 * widths, so a future edit to either side cannot silently drift.
 *
 * Letting CSS do this also means the dock re-resolves on window resize with no
 * listener to own, leak, or forget to remove.
 *
 * VERTICAL PLACEMENT: the CLI docks flush to the top of the work area because its
 * popup is 100% of that height — there is nothing left over to place. At 90% there
 * is 10%, so it is split evenly rather than dumped at the bottom, which would read
 * as a layout bug.
 *
 * THE BOX-MODEL RESET IS NOT DECORATION. Inline styling only protects the properties
 * it actually declares, and everything else on the host is still the agent page's to
 * set. Verified against a page stylesheet: `div { padding: 20px; margin: 30px;
 * border: 5px }` all applied to the host and moved/grew the docked box —
 * `margin` alone defeats `right:0`. Rules that broad (`div`, `body > div`, a `*`
 * reset) are ordinary on real sites, so the declared geometry only holds if these
 * are pinned too. With padding and border at zero, `box-sizing` no longer changes
 * anything, so it is deliberately not declared. `transform` is here because a page
 * transform relocates or scales the whole box.
 *
 * Still reachable by the page and NOT addressed here: `visibility`, `opacity`,
 * `pointer-events`, `filter`, `clip-path`. Those are visibility and interaction
 * rather than geometry — recorded for D2 and D6.
 */
export const DOCK_HOST_GEOMETRY_CSS = [
  'position:fixed',
  `top:${(100 - DOCK_HEIGHT_RATIO * 100) / 2}%`,
  'right:0',
  `width:${DOCK_WIDTH_RATIO * 100}%`,
  `max-width:${DOCK_MAX_WIDTH_PX}px`,
  `min-width:min(${DOCK_MIN_WIDTH_PX}px,100%)`,
  `height:${DOCK_HEIGHT_RATIO * 100}%`,
  `z-index:${DOCK_Z_INDEX}`,
  'margin:0',
  'padding:0',
  'border:0',
  'transform:none',
].join(';') + ';';

export interface NexpathDockController {
  /**
   * The element surface renderers draw into. It lives INSIDE the closed shadow
   * root, so it is unreachable from the agent page's `document` — that boundary
   * is the whole reason the host exists.
   */
  readonly mountEl: HTMLElement;

  /** Make the dock visible. Safe to call repeatedly. */
  show(): void;

  /** Hide the dock WITHOUT tearing it down — `show()` may be called again. */
  hide(): void;

  /** True while the dock is showing. False before the first `show()`. */
  isVisible(): boolean;

  /**
   * Remove the host from the page and end this dock's lifetime. After this,
   * every method on this controller is a safe no-op; a fresh `mountNexpathDock()`
   * starts a new lifetime.
   */
  destroy(): void;
}

/**
 * The live controller for this content-script instance, or null when no dock is
 * mounted. Module-level so repeated `mountNexpathDock()` calls in one instance
 * return the same dock — that is what "mount once" means here.
 */
let current: NexpathDockController | null = null;

/**
 * Create the dock, or return the one already mounted in this instance.
 *
 * @param doc - Document to mount into. Defaults to the ambient `document`;
 *              parameterised only so tests can supply their own.
 */
export function mountNexpathDock(doc: Document = document): NexpathDockController {
  if (current) return current;

  // A stale content-script instance from a prior extension reload can still be
  // alive in an already-open tab, holding a host we can never reach again (its
  // shadow root is closed, and its module scope is not ours). Left in place it
  // would sit in the DOM as a second, permanently inert dock. Its host is
  // identifiable by id, so drop it before creating ours — this is what keeps
  // "mount once" true across instances, not just within one.
  // (`content/inject.ts` solves the same problem for the panel one level up,
  // with its `__nexpathInjectBootstrapped` bootstrap guard.)
  doc.getElementById(NEXPATH_DOCK_HOST_ID)?.remove();

  const host = doc.createElement('div');
  host.id = NEXPATH_DOCK_HOST_ID;
  // Geometry first, hidden second — one cssText write, so the host is never in the
  // page with a size but no placement. `display` is then owned by show()/hide(),
  // which write the single property and leave the rest of this block intact.
  host.style.cssText = DOCK_HOST_GEOMETRY_CSS + 'display:none;';
  doc.body.appendChild(host);

  // CLOSED, matching the panel: the agent page cannot reach into our DOM through
  // `host.shadowRoot`, and page CSS cannot select into it. The cost is that our
  // own key handling must be element-scoped rather than document-scoped —
  // `composedPath()` hides a closed root's internals from any listener outside
  // it. That is a D6 concern; noted here because the closed mode is what causes it.
  const shadow = host.attachShadow({ mode: 'closed' });

  // Renderers get this element, never the shadow root itself — same split the
  // panel uses, so a renderer can freely clear its own subtree without touching
  // anything the dock owns (the D2 <style> node will live beside it, not in it).
  const mountEl = doc.createElement('div');
  shadow.appendChild(mountEl);

  let visible = false;
  let destroyed = false;

  const controller: NexpathDockController = {
    mountEl,

    show(): void {
      if (destroyed) return;
      // An explicit inline value, never ''. The host element itself lives in the
      // agent page's light DOM — only its shadow CONTENTS are isolated — so a page
      // rule like `#nexpath-dock-host { display: none }` applies to it. Clearing
      // the inline value hands the decision to that rule and show() fails
      // silently. Inline beats a page stylesheet, so this keeps the dock ours.
      // `block` suits the fixed, explicitly-sized box D1.2 declares above.
      host.style.display = 'block';
      visible = true;
    },

    hide(): void {
      if (destroyed) return;
      host.style.display = 'none';
      visible = false;
    },

    isVisible(): boolean {
      return !destroyed && visible;
    },

    destroy(): void {
      // One-shot. This early return is what makes a late second destroy() — say
      // from a stale reference held after a remount — harmless: it never reaches
      // the teardown below, so it cannot touch a newer dock.
      if (destroyed) return;
      destroyed = true;
      visible = false;
      host.remove();
      // Unconditional, and safe: `current` can only be some OTHER controller if a
      // second dock was mounted, and `mountNexpathDock` refuses to create one
      // while `current` is set — so by the time another exists, this one has
      // already run the line below. Guarding with `current === controller` here
      // would be unreachable code.
      current = null;
    },
  };

  current = controller;
  return controller;
}

/**
 * The dock mounted in this instance, or null. Exists so a caller can ask without
 * mounting as a side effect — `mountNexpathDock()` always creates one.
 */
export function getNexpathDock(): NexpathDockController | null {
  return current;
}
