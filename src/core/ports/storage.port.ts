import type { SessionState } from '../classifier/types.js';

/**
 * StoragePort — abstracts all persistence operations needed by the core pipeline.
 *
 * CLI implementation: SqlJsStorageAdapter (wraps better-sqlite3 / sql.js Store).
 * Browser implementation: IdbStorageAdapter (wraps IndexedDB).
 */
export interface StoragePort {
  loadSessionState(projectRoot: string): SessionState | null;
  saveSessionState(state: SessionState): void;
  /** Returns the last detected language code for a project, or undefined. */
  getProjectDetectedLanguage(projectRoot: string): string | undefined;
}
