import type { AdvisoryStatus } from './advisory-store-reader.js';

/**
 * Windsurf delivery poller.
 *
 * On Windsurf the terminal popup (Cascade `post_cascade_response` → `nexpath stop`)
 * is the PRIMARY advisory surface, exactly like Cursor/CLI. But the read-only
 * Cascade hook can't carry the popup's selection back into Cascade, and the
 * extension never sees `stop`'s stdout. So this poller, reading the shared store,
 * does two things:
 *
 *   1. **Bridge the popup selection.** When the user picks an option in the popup,
 *      Layer C's `stop` persists it to `session_states.lastInjectedPrompt`. The
 *      poller injects that into Cascade (and clears any fallback). This is what
 *      makes the popup work end-to-end on Windsurf.
 *
 *   2. **Fallback ONLY when the popup didn't deliver.** `stop` marks the advisory
 *      `status='shown'` the moment it runs. So when an advisory is `shown` but no
 *      selection arrives within a short grace, the popup failed/was dismissed —
 *      then (and only then) the poller arms the in-editor status-bar fallback. An
 *      advisory still `pending` (popup not run yet) never arms the fallback.
 *
 * Read-only on the store; no `vscode` import (fully dependency-injected for tests).
 */

export interface AdvisoryPollerDeps {
  /**
   * Candidate project roots to check. Pass both the canonicalised and raw
   * workspace path — the Cascade hook's `auto`/`stop` may record either.
   */
  projectRoots: string[];
  /**
   * Read the latest advisory's metadata (created_at + status) for a root.
   * Option-INDEPENDENT on purpose: since the option `auto`→`stop` move the row
   * carries no generated options, but the bridge only needs to detect that an
   * advisory exists (the selection is read separately via `readInjected`). Wire
   * this to `readLatestAdvisoryMeta`, NOT `readLatestAdvisory`.
   */
  readAdvisory: (projectRoot: string) => Promise<AdvisoryStatus | null>;
  /**
   * OPTIONAL (owner ruling 2026-08-11 — Windsurf must behave like the CLI,
   * popup-first): newest PE row's metadata, ANY status (wire to
   * `readLatestPromptEnhancementMeta`). A PE-ONLY turn stores no advisory row,
   * so without this the freshness gate below never opens and a "Use enhanced"
   * popup selection (persisted to the same `lastInjectedPrompt`, `stop.ts`) is
   * never bridged into Cascade. This dep widens the SELECTION-BRIDGE gate only:
   * a fresh PE row lets step 1 run. It NEVER feeds step 2 — fallback arming
   * stays keyed on advisory rows alone, because the in-editor fallback renders
   * advisory options and a PE popup dismissal must not surface it (a PE turn
   * leaves the same-turn advisory `pending` and queued for the NEXT Stop —
   * arming it early would double-surface it). Absent ⇒ decisions are
   * byte-identical to the shipped poller.
   */
  readPeEventMeta?: (projectRoot: string) => Promise<{ createdAt: number } | null>;
  /** Read the popup's persisted selection (`session_states.lastInjectedPrompt`). */
  readInjected: (projectRoot: string) => Promise<string | null>;
  /** Inject the popup's selected prompt into Cascade (and clear the fallback). */
  onSelection: (prompt: string) => void | Promise<void>;
  /** Arm the in-editor fallback (popup ran but produced no selection). */
  onArm: (projectRoot: string) => void | Promise<void>;
  /** Poll interval in ms (default 2000). */
  intervalMs?: number;
  /**
   * Grace after the popup is marked `shown` before arming the fallback (ms).
   * Gives the user time to pick from the popup; default 6000.
   */
  graceMs?: number;
  /** Injectable clock — only advisories parked AFTER start() are considered. */
  now?: () => number;
  setIntervalFn?: (cb: () => void, ms: number) => unknown;
  clearIntervalFn?: (handle: unknown) => void;
}

export interface AdvisoryPoller {
  start(): void;
  stop(): void;
  pollOnce(): Promise<void>;
}

export function createAdvisoryPoller(deps: AdvisoryPollerDeps): AdvisoryPoller {
  const now = deps.now ?? (() => Date.now());
  const intervalMs = deps.intervalMs ?? 2000;
  const graceMs = deps.graceMs ?? 6000;
  const setIntervalFn = deps.setIntervalFn ?? ((cb, ms) => setInterval(cb, ms) as unknown);
  const clearIntervalFn =
    deps.clearIntervalFn ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));

  let handle: unknown = null;
  let inFlight = false;
  let startedAt = 0;
  let lastInjectedValue: string | null = null;
  let armedAt = 0;          // createdAt of the advisory whose fallback we've armed
  let handledAt = 0;        // createdAt of an advisory whose selection we injected
  let shownAt = 0;          // createdAt of the advisory we're timing for "shown"
  let shownFirstSeen = 0;   // when we first observed that advisory as `shown`

  async function pollOnce(): Promise<void> {
    if (inFlight) return;
    inFlight = true;
    try {
      // Newest advisory across candidate roots.
      let best: { root: string; advisory: AdvisoryStatus } | null = null;
      for (const root of deps.projectRoots) {
        let advisory: AdvisoryStatus | null;
        try { advisory = await deps.readAdvisory(root); } catch { advisory = null; }
        if (advisory && (!best || advisory.createdAt > best.advisory.createdAt)) {
          best = { root, advisory };
        }
      }
      const freshAdvisory = best !== null && best.advisory.createdAt > startedAt;

      // PE-only turns (no advisory row) still have a popup whose "Use enhanced"
      // selection must bridge — a fresh PE row opens the gate for step 1 ONLY.
      // Consulted just when no fresh advisory exists: when one does, the flow
      // below is exactly the shipped flow, PE rows unread.
      let peEventRoot: string | null = null;
      if (!freshAdvisory && deps.readPeEventMeta) {
        let bestPe: { root: string; createdAt: number } | null = null;
        for (const root of deps.projectRoots) {
          let pe: { createdAt: number } | null;
          try { pe = await deps.readPeEventMeta(root); } catch { pe = null; }
          if (pe && (!bestPe || pe.createdAt > bestPe.createdAt)) {
            bestPe = { root, createdAt: pe.createdAt };
          }
        }
        if (bestPe && bestPe.createdAt > startedAt) peEventRoot = bestPe.root;
      }

      if (!freshAdvisory && peEventRoot === null) return; // nothing parked since start

      let injected: string | null = null;
      const bridgeRoot = freshAdvisory ? best!.root : (peEventRoot as string);
      try { injected = await deps.readInjected(bridgeRoot); } catch { injected = null; }

      // 1. Popup selection → inject into Cascade (once), clear fallback.
      if (injected && injected !== lastInjectedValue) {
        lastInjectedValue = injected;
        await deps.onSelection(injected);
        if (freshAdvisory) handledAt = Math.max(handledAt, best!.advisory.createdAt);
      } else if (!injected) {
        lastInjectedValue = null; // auto cleared it → allow the next selection
      }

      // 2. Fallback only when the popup ran (`shown`) but yielded no selection.
      //    Advisory rows ONLY — a PE event never arms the in-editor fallback.
      if (!freshAdvisory) return;
      const at = best!.advisory.createdAt;
      if (at <= armedAt || at <= handledAt) return; // already armed / handled by popup
      if (best!.advisory.status !== 'shown') return; // popup hasn't run yet → wait
      if (shownAt !== at) { shownAt = at; shownFirstSeen = now(); }
      if (!injected && now() - shownFirstSeen >= graceMs) {
        await deps.onArm(best!.root);
        armedAt = at;
      }
    } finally {
      inFlight = false;
    }
  }

  return {
    start(): void {
      if (handle !== null) return;
      startedAt = now();
      handle = setIntervalFn(() => { void pollOnce(); }, intervalMs);
    },
    stop(): void {
      if (handle !== null) { clearIntervalFn(handle); handle = null; }
    },
    pollOnce,
  };
}
