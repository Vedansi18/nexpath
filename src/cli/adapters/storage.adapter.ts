import type { Store } from '../../store/db.js';
import { saveStore } from '../../store/db.js';
import { getProject } from '../../store/projects.js';
import type { StoragePort } from '../../core/ports/storage.port.js';
import type { SessionState } from '../../core/classifier/types.js';

/**
 * SqlJsStorageAdapter — wires StoragePort to the existing sql.js Store.
 *
 * Passed into core pipeline functions (SessionStateManager, etc.) instead of the raw Store.
 * The original Store type is still used by legacy code and tests — zero regression.
 */
export class SqlJsStorageAdapter implements StoragePort {
  constructor(private readonly store: Store) {}

  loadSessionState(projectRoot: string): SessionState | null {
    const result = this.store.db.exec(
      'SELECT state_json FROM session_states WHERE project_root = ?',
      [projectRoot],
    );
    const row = result[0]?.values[0];
    if (!row) return null;
    try {
      return JSON.parse(row[0] as string) as SessionState;
    } catch {
      return null;
    }
  }

  saveSessionState(state: SessionState): void {
    this.store.db.run(
      `INSERT INTO session_states (project_root, session_id, state_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(project_root) DO UPDATE SET
         session_id = excluded.session_id,
         state_json = excluded.state_json,
         updated_at = excluded.updated_at`,
      [state.projectRoot, state.sessionId, JSON.stringify(state), Date.now()],
    );
    saveStore(this.store);
  }

  getProjectDetectedLanguage(projectRoot: string): string | undefined {
    return getProject(this.store, projectRoot)?.detectedLanguage ?? undefined;
  }
}
