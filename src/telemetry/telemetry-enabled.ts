import type { Store } from '../store/db.js';
import { getConfig } from '../store/config.js';

/**
 * True unless telemetry has been explicitly disabled. Defaults to on, matching
 * the `telemetry.enabled` config default.
 */
export function isTelemetryEnabled(store: Store): boolean {
  return getConfig(store.db, 'telemetry.enabled') !== 'false';
}
