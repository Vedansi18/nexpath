import type { StoragePort } from '../../core/ports/storage.port.js';
import type { SessionState } from '../../core/classifier/types.js';

/**
 * Sync-over-async bridge for the service worker pipeline.
 *
 * The core pipeline requires a synchronous StoragePort, but IndexedDB is async.
 * Pattern:
 *   1. Caller loads state from IDB asynchronously before any core call.
 *   2. makeMemoryStoragePort() wraps that preloaded state into a sync port.
 *   3. Core pipeline functions run synchronously against the in-memory port.
 *   4. After each async boundary, caller flushes state back to IDB via getLatestState().
 *
 * This preserves the StoragePort interface unchanged (no B1 regressions).
 */

export interface MemoryStorageHandle {
  /** The sync StoragePort to pass into core pipeline functions. */
  port: StoragePort;
  /** Returns the current in-memory session state (null if none loaded/saved yet). */
  getLatestState(): SessionState | null;
}

export function makeMemoryStoragePort(
  preloadedState: SessionState | null,
  preloadedLanguage?: string | undefined,
): MemoryStorageHandle {
  let currentState: SessionState | null = preloadedState;
  const languageCache: Record<string, string | undefined> = {};

  if (preloadedState && preloadedLanguage !== undefined) {
    languageCache[preloadedState.projectRoot] = preloadedLanguage;
  }

  const port: StoragePort = {
    loadSessionState(projectRoot: string): SessionState | null {
      if (currentState && currentState.projectRoot === projectRoot) {
        return currentState;
      }
      return null;
    },

    saveSessionState(state: SessionState): void {
      currentState = state;
    },

    getProjectDetectedLanguage(projectRoot: string): string | undefined {
      return languageCache[projectRoot];
    },
  };

  return {
    port,
    getLatestState: () => currentState,
  };
}
