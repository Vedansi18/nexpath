/**
 * PE-scoped record of what the extension itself just injected into the host's
 * chat input (analysis F6, part of VED-PE-10).
 *
 * A delivered PE body re-enters the watcher as an indistinguishable fresh
 * `ChatHistoryEvent` — nothing today records what the extension injected. The
 * only existing protection is Layer C's `isInjectedPromptEcho` (`auto.ts`), a
 * normalised text-similarity match that is also **single-shot**:
 * `clearInjectedPrompt` runs before the match, so the guard is consumed
 * whether or not it actually matched. The analysis names a concrete failure
 * from this: two open Cursor windows both watching the same `state.vscdb`
 * both emit every bubble, so the first duplicate consumes the single-shot
 * guard and the genuine echo re-enters full classification.
 *
 * This module is a non-consuming, window-based check instead: it never
 * "uses up" a match, so every echo within the window is suppressed, not just
 * the first. Deliberately in-memory and per-process (no store write) — a
 * short-lived echo guard, not a durable record. PE-scoped and fail-safe:
 * Decision Session behaviour is entirely unaffected, since nothing here is
 * consulted on that path.
 */

const DEFAULT_ECHO_WINDOW_MS = 60_000; // mirrors chat-history-watcher's own dedup window

interface InjectedEntry {
  text:       string;
  injectedAt: number;
}

export interface InjectedRecordStore {
  /** Record that `text` was just injected into `projectRoot`'s chat input. */
  record(projectRoot: string, text: string, now?: number): void;
  /**
   * True when `text` exactly matches the most recently recorded PE injection
   * for `projectRoot`, within the echo window. Pure read — never consumes
   * the record, so repeated echoes within the window all match.
   */
  isRecentEcho(projectRoot: string, text: string, now?: number): boolean;
}

/** Create a fresh, empty store. `windowMs` is injectable for tests. */
export function createInjectedRecordStore(
  windowMs: number = DEFAULT_ECHO_WINDOW_MS,
): InjectedRecordStore {
  const lastInjected = new Map<string, InjectedEntry>();

  return {
    record(projectRoot, text, now = Date.now()) {
      lastInjected.set(projectRoot, { text, injectedAt: now });
    },
    isRecentEcho(projectRoot, text, now = Date.now()) {
      const entry = lastInjected.get(projectRoot);
      if (!entry) return false;
      if (entry.text !== text) return false;
      return now - entry.injectedAt <= windowMs;
    },
  };
}
