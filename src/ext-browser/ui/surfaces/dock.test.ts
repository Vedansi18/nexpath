// @vitest-environment jsdom

import { describe, it, expect, afterEach } from 'vitest';
import { mountNexpathDock, getNexpathDock, NEXPATH_DOCK_HOST_ID } from './dock.js';

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

  it('carries no positioning yet — geometry is D1.2, not this sub-phase', () => {
    mountNexpathDock();
    const style = hosts()[0]!.style;

    expect(style.position).toBe('');
    expect(style.width).toBe('');
    expect(style.height).toBe('');
    expect(style.zIndex).toBe('');
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
