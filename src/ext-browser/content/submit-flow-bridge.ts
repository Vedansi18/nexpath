/**
 * HB1 — the ISOLATED-world half of the submit-flow switch.
 *
 * Resolves the switch for this page's site and pushes the answer into the MAIN
 * world (which cannot read async storage at submit time), keeps it
 * fresh, and forwards the page's read-back to the ring buffer.
 *
 * ── RC15: NEVER RESOLVE CONFIG ONCE AT BOOT ─────────────────────────────────
 * MV3 restarts constantly and a developer flipping a key mid-session must not
 * have to reload every tab. `storage.onChanged` re-resolves and re-pushes, so
 * the page world tracks the key rather than a snapshot of it.
 *
 * ── ORDERING ────────────────────────────────────────────────────────────────
 * Two independent async things race at page load: this resolution, and the
 * main-world module script loading. Either can win, so both directions are
 * covered — we push as soon as we resolve, AND we answer the page's
 * `nexpath:submit-flow-request` (which it sends on load) with the current value.
 * A monotonic `seq` makes a late-arriving stale push a no-op on the page side.
 *
 * ── HB1 SCOPE ───────────────────────────────────────────────────────────────
 * Push and observe only. Nothing consumes the value yet; no existing call path
 * changes. The gated fetch path is HB2.
 */
import browser from 'webextension-polyfill';
import { resolveAgentFromHostname } from './agents/agent-hosts.js';
import { resolveSubmitFlow, submitFlowStorageKeys, type SubmitFlowResolution } from '../adapters/submit-flow-config.js';
import {
  SUBMIT_FLOW_PUSH_TYPE,
  SUBMIT_FLOW_REQUEST_TYPE,
  SUBMIT_FLOW_STATE_TYPE,
} from '../inject/submit-flow-page.js';

export interface SubmitFlowBridgeDeps {
  win?: Window;
  /** Agent/site string for this page (defaults to the live hostname mapping). */
  site?: string;
  resolve?: (site: string) => Promise<SubmitFlowResolution>;
  /** Subscribe to storage changes; returns nothing. Tests inject. */
  onStorageChanged?: (cb: (changes: Record<string, unknown>, area: string) => void) => void;
  /** Forward the page's read-back to the SW. Failures are swallowed. */
  sendToSw?: (msg: unknown) => void;
}

export interface SubmitFlowBridgeHandle {
  /** Re-resolve and push. Exposed for tests and for future explicit refreshes. */
  refresh(): Promise<void>;
  /** The last resolution pushed, or null before the first one completes. */
  last(): SubmitFlowResolution | null;
}

function defaultSendToSw(msg: unknown): void {
  try {
    void browser.runtime.sendMessage(msg).catch(() => { /* SW asleep — diagnostics only */ });
  } catch {
    /* extension context invalidated mid-navigation */
  }
}

function defaultOnStorageChanged(cb: (changes: Record<string, unknown>, area: string) => void): void {
  try {
    browser.storage.onChanged.addListener(cb as Parameters<typeof browser.storage.onChanged.addListener>[0]);
  } catch {
    /* no storage events available — the load-time resolution still applies */
  }
}

export function setupSubmitFlowBridge(deps: SubmitFlowBridgeDeps = {}): SubmitFlowBridgeHandle {
  const win = deps.win ?? window;
  const resolve = deps.resolve ?? resolveSubmitFlow;
  const sendToSw = deps.sendToSw ?? defaultSendToSw;
  const onStorageChanged = deps.onStorageChanged ?? defaultOnStorageChanged;
  const watched = new Set(submitFlowStorageKeys());

  // Resolved lazily so an SPA navigation between sites re-reads the hostname
  // rather than a value frozen at content-script load.
  const siteOf = (): string =>
    deps.site ?? resolveAgentFromHostname(win.location.hostname);

  let seq = 0;
  let last: SubmitFlowResolution | null = null;

  const push = (resolution: SubmitFlowResolution): void => {
    seq += 1;
    try {
      win.postMessage(
        { type: SUBMIT_FLOW_PUSH_TYPE, enabled: resolution.enabled, source: resolution.source, seq },
        win.location.origin,
      );
    } catch {
      /* opaque origin — nothing to push to; page stays disarmed, which is safe */
    }
  };

  const refresh = async (): Promise<void> => {
    let resolution: SubmitFlowResolution;
    try {
      resolution = await resolve(siteOf());
    } catch {
      // Fail-open, and never as an unhandled rejection: leave the page in
      // whatever state it already holds — DISARMED if this was the first
      // attempt, which is the safe direction. `resolveSubmitFlow` itself never
      // rejects; this covers an injected or future resolver that does.
      return;
    }
    last = resolution;
    push(resolution);
  };

  // The page asks on load (it may have loaded after our first push), and reports
  // back what it believes after each accepted push.
  win.addEventListener('message', (ev: MessageEvent) => {
    if (ev.source !== win) return;
    const msg = ev.data as { type?: unknown } | null;
    if (msg === null || typeof msg !== 'object') return;

    if (msg.type === SUBMIT_FLOW_REQUEST_TYPE) {
      if (last !== null) push(last);
      else void refresh();
      return;
    }

    if (msg.type === SUBMIT_FLOW_STATE_TYPE) {
      // A9 read-back: what the PAGE believes, forwarded verbatim to the ring
      // buffer. Deliberately not compared against `last` here — the value of this
      // record is that it is the page's own answer, not ours.
      const state = msg as { armed?: unknown; source?: unknown; seq?: unknown };
      sendToSw({
        type: SUBMIT_FLOW_STATE_TYPE,
        site: siteOf(),
        armed: state.armed === true,
        source: typeof state.source === 'string' ? state.source : 'unknown',
        seq: typeof state.seq === 'number' ? state.seq : -1,
      });
    }
  });

  onStorageChanged((changes, area) => {
    if (area !== 'local') return;
    if (!Object.keys(changes).some((k) => watched.has(k))) return;
    void refresh();
  });

  void refresh();

  return { refresh, last: () => last };
}
