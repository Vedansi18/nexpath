import type { Store } from '../store/db.js';
import { getConfig } from '../store/config.js';

/**
 * Telemetry is opt-in and OFF by default: `telemetry.enabled` defaults to
 * `'false'` in DEFAULT_CONFIG, so this returns `true` only when a stored value
 * has explicitly set it to something other than `'false'`.
 */
export function isTelemetryEnabled(store: Store): boolean {
  return getConfig(store.db, 'telemetry.enabled') !== 'false';
}
