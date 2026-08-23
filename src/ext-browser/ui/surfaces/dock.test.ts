// @vitest-environment jsdom

import { describe, it, expect, afterEach } from 'vitest';
import {
  mountNexpathDock,
  getNexpathDock,
  NEXPATH_DOCK_HOST_ID,
  DOCK_WIDTH_RATIO,
  DOCK_MAX_WIDTH_PX,
  DOCK_MIN_WIDTH_PX,
  DOCK_HEIGHT_RATIO,
  DOCK_Z_INDEX,
} from './dock.js';

/** Hosts currently in the page, by the dock's stable id. */
function hosts(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`#${NEXPATH_DOCK_HOST_ID}`)];
}

afterEach(() => {
  // The dock is a module-level singleton; leaving one mounted would leak into the
  // next test. destroy() is also what clears the singleton, so this covers both.
  getNexpathDock()?.destroy();
  document.body.innerHTML = '';
});

describe('mountNexpathDock — host element', () => {
  it('appends exactly one host, carrying the stable id', () => {
    mountNexpathDock();

    expect(hosts()).toHaveLength(1);
    expect(hosts()[0]!.parentElement).toBe(document.body);
  });

  it('starts hidden so an unpositioned host never flashes into the page layout', () => {
    const dock = mountNexpathDock();

    expect(hosts()[0]!.style.display).toBe('none');
    expect(dock.isVisible()).toBe(false);
  });

});

describe('mountNexpathDock — dock geometry (D1.2)', () => {
  it('carries the CLI\'s own docked-popup values, not invented ones', () => {
    // These are re-declared rather than imported (C-5 keeps this layer free of
    // cross-layer imports), so the "keep in sync by hand" note in dock.ts needs
    // teeth. Literals on purpose: every other geometry test derives from these
    // constants, so without this one a wrong value would agree with itself.
    // Source: src/decision-session/screen-geometry.ts.
    expect(DOCK_WIDTH_RATIO).toBe(0.6);       // DEFAULT_POPUP_WIDTH_RATIO
    expect(DOCK_MAX_WIDTH_PX).toBe(1600);     // POPUP_MAX_WIDTH_PX
    expect(DOCK_MIN_WIDTH_PX).toBe(800);      // POPUP_MIN_COLS 80 x DEFAULT_CELL_WIDTH_PX 10
    expect(DOCK_HEIGHT_RATIO).toBe(0.9);      // browser equivalent of 100% of the work area
    expect(DOCK_Z_INDEX).toBe(2147483647);
  });

  it('docks flush right, fixed, above the agent UI', () => {
    mountNexpathDock();
    const style = hosts()[0]!.style;

    expect(style.position).toBe('fixed');
    expect(style.right).toBe('0px');
    expect(style.zIndex).toBe(String(DOCK_Z_INDEX));
  });

  it('sizes from the CLI constants, not hard-coded literals', () => {
    mountNexpathDock();
    const style = hosts()[0]!.style;

    expect(style.width).toBe(`${DOCK_WIDTH_RATIO * 100}%`);
    expect(style.maxWidth).toBe(`${DOCK_MAX_WIDTH_PX}px`);
    expect(style.height).toBe(`${DOCK_HEIGHT_RATIO * 100}%`);
  });

  it('floors the width without letting it exceed the viewport', () => {
    // A bare `min-width: 800px` would always win in CSS and overflow a narrow
    // viewport; min(...) is what supplies the CLI's final viewport clamp.
    mountNexpathDock();

    expect(hosts()[0]!.style.minWidth).toBe(`min(${DOCK_MIN_WIDTH_PX}px,100%)`);
  });

  it('splits the leftover height evenly instead of dumping it at the bottom', () => {
    mountNexpathDock();

    const expectedTop = (100 - DOCK_HEIGHT_RATIO * 100) / 2;
    expect(hosts()[0]!.style.top).toBe(`${expectedTop}%`);
  });

  it('declares the geometry INLINE, where a page stylesheet cannot outrank it', () => {
    mountNexpathDock();
    const host = hosts()[0]!;

    // Every geometry property is on the element's own style attribute.
    for (const prop of ['position', 'top', 'right', 'width', 'max-width', 'min-width', 'height', 'z-index']) {
      expect(host.style.getPropertyValue(prop), prop).not.toBe('');
    }
  });

  it('pins the box model, so a broad page rule cannot move or grow the docked box', () => {
    // Verified exposure: inline styling protects only the properties it declares, and
    // `div { padding; margin; border }` — the kind of rule ordinary sites ship — was
    // observed applying to the host. `margin` alone defeats `right:0`.
    const pageCss = document.createElement('style');
    pageCss.textContent = 'div { padding: 20px; margin: 30px; border: 5px solid red; }';
    document.head.appendChild(pageCss);

    mountNexpathDock();
    const computed = getComputedStyle(hosts()[0]!);

    expect(computed.padding).toBe('0px');
    expect(computed.margin).toBe('0px');
    expect(computed.borderTopWidth).toBe('0px');

    pageCss.remove();
  });

  it('pins transform, so a page cannot relocate or scale the dock', () => {
    const pageCss = document.createElement('style');
    pageCss.textContent = `#${NEXPATH_DOCK_HOST_ID} { transform: scale(0.2) translateX(-500px); }`;
    document.head.appendChild(pageCss);

    mountNexpathDock();

    expect(getComputedStyle(hosts()[0]!).transform).toBe('none');

    pageCss.remove();
  });

  it('the CSS clamp resolves exactly like the CLI computeDockedPopupGeometry order', () => {
    // The comment in dock.ts claims these two forms agree. Pin that claim, so an
    // edit to either the constants or the declarations cannot silently drift.
    const cliOrder = (viewport: number): number => {
      let w = Math.round(viewport * DOCK_WIDTH_RATIO);
      w = Math.min(w, DOCK_MAX_WIDTH_PX);   // ultrawide cap
      w = Math.max(w, DOCK_MIN_WIDTH_PX);   // readability floor
      w = Math.min(w, viewport);            // never exceed the work area
      return w;
    };
    // CSS used width = max(min-width, min(max-width, width)),
    // with min-width itself being min(800px, 100%).
    const cssOrder = (viewport: number): number => {
      const width = Math.round(viewport * DOCK_WIDTH_RATIO);
      const minWidth = Math.min(DOCK_MIN_WIDTH_PX, viewport);
      return Math.max(minWidth, Math.min(DOCK_MAX_WIDTH_PX, width));
    };

    for (const viewport of [320, 600, 800, 900, 1024, 1280, 1440, 1920, 2560, 3440, 5120]) {
      expect(cssOrder(viewport), `viewport ${viewport}px`).toBe(cliOrder(viewport));
    }
  });

  it('the clamp actually bites at each boundary', () => {
    const used = (viewport: number): number => {
      const width = Math.round(viewport * DOCK_WIDTH_RATIO);
      return Math.max(Math.min(DOCK_MIN_WIDTH_PX, viewport), Math.min(DOCK_MAX_WIDTH_PX, width));
    };

    expect(used(600)).toBe(600);                  // narrower than the floor: viewport wins
    expect(used(1000)).toBe(DOCK_MIN_WIDTH_PX);   // 60% would be 600: floor wins
    expect(used(2000)).toBe(1200);                // plain 60%
    expect(used(4000)).toBe(DOCK_MAX_WIDTH_PX);   // 60% would be 2400: cap wins
  });
});

describe('mountNexpathDock — closed shadow root', () => {
  it('attaches a CLOSED root, so the page cannot reach in through host.shadowRoot', () => {
    mountNexpathDock();

    expect(hosts()[0]!.shadowRoot).toBeNull();
  });

  it('puts mountEl inside that closed root, out of the page document', () => {
    const dock = mountNexpathDock();
    const root = dock.mountEl.getRootNode() as ShadowRoot;

    expect(root).toBeInstanceOf(ShadowRoot);
    expect(root.mode).toBe('closed');
    expect(root.host).toBe(hosts()[0]);
    // Connected to the page, yet not findable from the document — the isolation
    // boundary the host exists to create.
    expect(dock.mountEl.isConnected).toBe(true);
    expect(document.contains(dock.mountEl)).toBe(false);
  });

  it('gives renderers an element, never the shadow root itself', () => {
    const dock = mountNexpathDock();

    expect(dock.mountEl).toBeInstanceOf(HTMLElement);
    expect(dock.mountEl.parentNode).toBe(dock.mountEl.getRootNode());
  });
});

describe('mountNexpathDock — mount once', () => {
  it('returns the same controller and creates no second host', () => {
    const first = mountNexpathDock();
    const second = mountNexpathDock();

    expect(second).toBe(first);
    expect(second.mountEl).toBe(first.mountEl);
    expect(hosts()).toHaveLength(1);
  });

  it('preserves what a renderer already drew when mount is called again', () => {
    const first = mountNexpathDock();
    first.mountEl.textContent = 'rendered by a surface';

    expect(mountNexpathDock().mountEl.textContent).toBe('rendered by a surface');
  });

  it('removes a stale host left by a previous content-script instance', () => {
    // A prior instance's host: same id, unreachable shadow root, not ours.
    const stale = document.createElement('div');
    stale.id = NEXPATH_DOCK_HOST_ID;
    stale.attachShadow({ mode: 'closed' });
    document.body.appendChild(stale);

    const dock = mountNexpathDock();

    expect(hosts()).toHaveLength(1);
    expect(stale.isConnected).toBe(false);
    expect(hosts()[0]).toBe((dock.mountEl.getRootNode() as ShadowRoot).host);
  });

  it('getNexpathDock reports the mounted dock without mounting one itself', () => {
    expect(getNexpathDock()).toBeNull();
    expect(hosts()).toHaveLength(0);

    const dock = mountNexpathDock();

    expect(getNexpathDock()).toBe(dock);
  });
});

describe('NexpathDockController — show / hide', () => {
  it('show reveals the host and hide conceals it', () => {
    const dock = mountNexpathDock();

    dock.show();
    expect(hosts()[0]!.style.display).toBe('block');
    expect(dock.isVisible()).toBe(true);

    dock.hide();
    expect(hosts()[0]!.style.display).toBe('none');
    expect(dock.isVisible()).toBe(false);
  });

  it('show wins over an agent page rule targeting our host', () => {
    // The host is in the page's light DOM — only its shadow contents are isolated —
    // so page CSS can match it. Clearing the inline display would hand the decision
    // to that rule and show() would fail silently.
    const pageCss = document.createElement('style');
    pageCss.textContent = `#${NEXPATH_DOCK_HOST_ID} { display: none; }`;
    document.head.appendChild(pageCss);

    const dock = mountNexpathDock();
    dock.show();

    expect(getComputedStyle(hosts()[0]!).display).toBe('block');

    pageCss.remove();
  });

  it('hide tears nothing down — the host, the root and rendered content survive', () => {
    const dock = mountNexpathDock();
    dock.mountEl.textContent = 'still here';
    dock.show();

    dock.hide();

    expect(hosts()).toHaveLength(1);
    expect(dock.mountEl.isConnected).toBe(true);
    expect(dock.mountEl.textContent).toBe('still here');
  });

  it('never clobbers the geometry — show/hide write only `display`', () => {
    const dock = mountNexpathDock();
    const style = hosts()[0]!.style;

    dock.show();
    dock.hide();
    dock.show();

    expect(style.position).toBe('fixed');
    expect(style.right).toBe('0px');
    expect(style.width).toBe(`${DOCK_WIDTH_RATIO * 100}%`);
    expect(style.maxWidth).toBe(`${DOCK_MAX_WIDTH_PX}px`);
    expect(style.minWidth).toBe(`min(${DOCK_MIN_WIDTH_PX}px,100%)`);
    expect(style.height).toBe(`${DOCK_HEIGHT_RATIO * 100}%`);
    expect(style.zIndex).toBe(String(DOCK_Z_INDEX));
  });

  it('is idempotent — repeated show / hide keep the same state', () => {
    const dock = mountNexpathDock();

    dock.show();
    dock.show();
    expect(dock.isVisible()).toBe(true);

    dock.hide();
    dock.hide();
    expect(dock.isVisible()).toBe(false);
  });
});

describe('NexpathDockController — destroy', () => {
  it('removes the host from the page', () => {
    const dock = mountNexpathDock();
    dock.show();

    dock.destroy();

    expect(hosts()).toHaveLength(0);
    expect(dock.mountEl.isConnected).toBe(false);
    expect(dock.isVisible()).toBe(false);
  });

  it('clears the singleton, so a later mount starts a fresh lifetime', () => {
    const first = mountNexpathDock();
    first.destroy();

    expect(getNexpathDock()).toBeNull();

    const second = mountNexpathDock();

    expect(second).not.toBe(first);
    expect(second.mountEl).not.toBe(first.mountEl);
    expect(hosts()).toHaveLength(1);
  });

  it('makes every later call a safe no-op', () => {
    const dock = mountNexpathDock();
    dock.destroy();

    expect(() => {
      dock.show();
      dock.hide();
      dock.destroy();
    }).not.toThrow();
    expect(dock.isVisible()).toBe(false);
    expect(hosts()).toHaveLength(0);
  });

  it('is one-shot — a late destroy() from a stale reference cannot unmount the newer dock', () => {
    const first = mountNexpathDock();
    first.destroy();
    const second = mountNexpathDock();

    first.destroy(); // stale reference, called after a remount

    expect(getNexpathDock()).toBe(second);
    expect(second.mountEl.isConnected).toBe(true);
    expect(hosts()).toHaveLength(1);
  });

  it('a destroyed dock cannot be re-shown, even if its orphaned host is re-attached', () => {
    // The host is detached but still referenced — exactly the situation D1.5's
    // re-attach guard will create when it re-appends a host an SPA re-render tore
    // out. A destroyed dock must stay dead through that.
    const dock = mountNexpathDock();
    const hostEl = hosts()[0]!;
    dock.destroy();

    dock.show();

    expect(hostEl.style.display).toBe('none');
    document.body.appendChild(hostEl);
    expect(hostEl.style.display).toBe('none');
    expect(dock.isVisible()).toBe(false);
  });

  it('a stale show()/hide() cannot resurrect or disturb the newer dock either', () => {
    const first = mountNexpathDock();
    first.destroy();
    const second = mountNexpathDock();
    second.show();

    first.show();
    first.hide();

    expect(second.isVisible()).toBe(true);
    expect(hosts()).toHaveLength(1);
    expect(hosts()[0]!.style.display).toBe('block');
  });
});
