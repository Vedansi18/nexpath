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
//   D1.2  dock geometry (60% x 90%, flush right, the clamp order ported from
//         `decision-session/screen-geometry.ts`). Until then the host carries NO
//         positioning at all and is a static in-flow block at the end of <body>.
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
  // No positioning, size, or z-index here — that is D1.2. Hidden until the first
  // show() so an unpositioned host never flashes into the page's layout flow.
  host.style.display = 'none';
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
      // (D1.2 may change WHICH value; it must stay an explicit one.)
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
